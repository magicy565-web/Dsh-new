import { promises as fs, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sourceFingerprint } from './source-fingerprint.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A packaged local fixture report is evidence about code, never this deployment's provider. */
export async function readLocalVerification(directory = root) {
  const base = { evidenceKind: 'local-fixtures', scope: 'packaged-code-not-current-deployment' };
  let handle;
  try {
    handle = await fs.open(path.join(directory, 'evidence/local-verification.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16_384) return { ...base, status: 'invalid' };
    const value = JSON.parse(await handle.readFile('utf8'));
    if (value.schemaVersion !== 1 || value.evidenceKind !== base.evidenceKind || value.result !== 'passed'
      || !Number.isFinite(Date.parse(value.checkedAt)) || Date.parse(value.checkedAt) > Date.now() + 60_000
      || value.externalCalls !== false || value.actualBrowser !== false
      || !Array.isArray(value.checks) || value.checks.length !== 2
      || !['backend', 'production-ui-dom'].every(name => value.checks.some(check => check.name === name && Number.isSafeInteger(check.tests) && check.tests > 0 && check.failed === 0 && check.skipped === 0 && check.passed === check.tests))
      || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)) return { ...base, status: 'invalid' };
    if (await sourceFingerprint(directory) !== value.sourceFingerprint) return { ...base, status: 'stale', checkedAt: value.checkedAt };
    return { ...base, status: 'passed', checkedAt: value.checkedAt };
  } catch (error) { return { ...base, status: error.code === 'ENOENT' ? 'missing' : 'invalid' }; }
  finally { await handle?.close(); }
}

/** Pure snapshot builder: no file writes, network calls, timers or provider probes. */
export function operationalDiagnostics({ instanceId, startedAt, now = Date.now(), runtime, storage, capabilities, scheduler, recovery, access, localVerification }) {
  const observedAt = new Date(now).toISOString();
  const provider = { provider: runtime.provider, kind: runtime.kind, model: runtime.model, configured: !!runtime.configured,
    configuration: runtime.configured ? 'present' : 'missing', localVerification,
    liveValidation: { status: 'not_validated', scope: 'current-deployment' }, onlineVerified: false,
    lastObservation: runtime.lastObservation };
  const items = capabilities.connectors.map(({ id, name, status, revision }) => {
    const run = capabilities.connectorRuns?.filter(run => run.connectorId === id && run.connectorRevision === revision).at(-1);
    return { id, name, status, connectionVerified: false, lastRun: run ? { status: run.status, finishedAt: run.finishedAt || null, scope: 'saved-adapter-return' } : null };
  });
  const enabled = capabilities.connectors.filter(item => item.enabled);
  const connectors = { total: items.length, enabled: enabled.length, configured: items.filter(item => item.status === 'ready').length,
    blocked: enabled.filter(item => item.status !== 'ready').length, recentFailures: items.filter(item => ['failed', 'interrupted'].includes(item.lastRun?.status)).length, onlineVerified: false, items };
  const timer = { ...scheduler, dispatchConfigured: capabilities.scheduler.dispatchConfigured,
    enabled: capabilities.schedules.filter(item => item.enabled).length,
    blocked: capabilities.schedules.filter(item => ['blocked', 'interrupted'].includes(item.status)).length };
  if (timer.automaticTimer && timer.state !== 'degraded') {
    const last = Date.parse(timer.lastCompletedAt || startedAt);
    if (now - last > Math.max(15_000, timer.intervalMs * 3)) timer.state = 'stale';
  }
  const blockers = [];
  const add = (code, component, message, action) => blockers.push({ code, component, message, action });
  if (!provider.configured) add('PROVIDER_SETUP_REQUIRED', 'provider', '模型服务配置尚未完成。', '请管理员在服务端安全配置所选模型及新授权凭据，然后重启服务；不要在聊天或表单中输入密钥。');
  if (provider.lastObservation?.status === 'failed') add(provider.lastObservation.code || 'PROVIDER_FAILURE', 'provider', '本进程最近一次模型请求未成功。', '查看运行记录中的错误；修复网络、账户或配置后，由你决定是否重新发起请求。刷新诊断不会重试模型。');
  if (storage.state !== 'open' || storage.durability !== 'confirmed') add('STORAGE_REVIEW_REQUIRED', 'storage', '持久存储状态异常。', '停止新任务并让管理员检查磁盘、权限与备份；不要自动覆盖或恢复数据。');
  for (const warning of storage.warnings) add(warning.code, 'storage', warning.message, '请管理员保留现有文件并按恢复文档检查，不要自动回滚。');
  if (['degraded', 'stale'].includes(timer.state)) add('SCHEDULER_REVIEW_REQUIRED', 'scheduler', '本地调度器未确认正常完成最近一次检查。', '请管理员检查服务与存储；确认运行记录后再决定重试，避免重复执行。');
  if (timer.blocked) add('SCHEDULES_BLOCKED', 'scheduler', `${timer.blocked} 个定时任务已阻断或中断。`, '在定时任务和运行记录中检查原因；修改计划或运行范围后需重新审批。');
  if (connectors.blocked) add('CONNECTORS_NOT_CONFIGURED', 'connectors', `${connectors.blocked} 个已启用连接器配置尚未就绪。`, '查看连接器的适配器、能力声明与服务端凭据绑定；刷新不会连接或执行外部服务。');
  if (connectors.recentFailures) add('CONNECTOR_ACTION_REVIEW_REQUIRED', 'connectors', `${connectors.recentFailures} 个连接器的当前配置最近一次动作失败或中断。`, '检查连接器运行记录及远端结果后再创建新的精确审批；旧许可已经消费，诊断不会重试或证明远端未执行。');
  if (recovery.reviewRequired) add('RESTORE_REVIEW_REQUIRED', 'recovery', '当前数据来自恢复流程，仍需人工复核。', '核对恢复报告、原生权限和产物后逐项恢复所需能力；不要自动重放中断请求。');
  return { schemaVersion: 1, instanceId, startedAt, observedAt, staleAfterMs: 15_000,
    readOnly: true, externalCalls: false,
    overall: blockers.some(item => item.code !== 'PROVIDER_SETUP_REQUIRED') ? 'degraded' : provider.configured ? 'configured_unverified' : 'setup_required',
    provider, storage: { ...storage, exclusiveWriter: true, liveWriteProbe: false }, scheduler: timer, connectors, recovery, access, blockers };
}
