import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './icons';
import type { Diagnostics } from './types';

type SnapshotState = { snapshot?: Diagnostics; receivedAt: number | null; error: string; transition: 'connected' | 'reconnected' | 'restarted' };
export type DiagnosticsView = SnapshotState & { state: 'loading' | 'connected' | 'reconnected' | 'restarted' | 'disconnected' | 'stale'; checking: boolean; refresh: () => Promise<void> };
const stamp = (value?: string | number | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
function expired(value: SnapshotState, now: number) {
  if (!value.snapshot || value.receivedAt === null) return true;
  const observed = Date.parse(value.snapshot.observedAt), ttl = value.snapshot.staleAfterMs;
  return !Number.isFinite(observed) || !Number.isFinite(ttl) || ttl <= 0 || now - observed > ttl || now - value.receivedAt > ttl;
}

// A receipt proves only that this backend answered. Never promote configuration,
// fixtures, or a provider return into current-deployment live acceptance.
export function useDiagnostics() {
  const initial: SnapshotState = { receivedAt: null, error: '', transition: 'connected' };
  const [value, setValue] = useState<SnapshotState>(initial), [checking, setChecking] = useState(false), [now, setNow] = useState(Date.now);
  const current = useRef(initial), alive = useRef(true), retired = useRef(new Set<string>()), request = useRef(0), settled = useRef(0), refreshLock = useRef(false);
  useEffect(() => { alive.current = true; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; clearInterval(timer); }; }, []);
  const begin = useCallback(() => ++request.current, []);
  const accept = useCallback((snapshot: Diagnostics | undefined, ticket: number) => {
    if (!alive.current || ticket < settled.current) return false;
    if (!snapshot) { settled.current = ticket; const next = { ...current.current, error: '服务尚未提供诊断快照，请联系部署管理员更新服务' }; current.current = next; setValue(next); return true; }
    if (retired.current.has(snapshot.instanceId)) return false;
    const previous = current.current;
    const restarted = !!previous.snapshot && previous.snapshot.instanceId !== snapshot.instanceId;
    if (restarted && previous.snapshot) retired.current.add(previous.snapshot.instanceId);
    const reconnected = !!previous.error || (!!previous.snapshot && expired(previous, Date.now()));
    const next: SnapshotState = { snapshot, receivedAt: Date.now(), error: '', transition: restarted ? 'restarted' : reconnected ? 'reconnected' : previous.transition };
    settled.current = ticket; current.current = next; setValue(next); setNow(Date.now()); return true;
  }, []);
  const fail = useCallback((error: unknown, ticket: number) => {
    if (!alive.current || ticket < settled.current) return;
    settled.current = ticket;
    const next = { ...current.current, error: error instanceof Error ? error.message : '无法读取服务诊断，请检查网络后重试' };
    current.current = next; setValue(next); setNow(Date.now());
  }, []);
  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true; setChecking(true); const ticket = begin();
    try { accept(await api<Diagnostics>('/diagnostics'), ticket); }
    catch (error) { fail(error, ticket); }
    finally { refreshLock.current = false; if (alive.current) setChecking(false); }
  }, [accept, begin, fail]);
  const state: DiagnosticsView['state'] = value.error ? 'disconnected' : !value.snapshot ? 'loading' : expired(value, now) ? 'stale' : value.transition;
  return { view: { ...value, state, checking, refresh }, begin, accept, fail };
}
const connectionLabels: Record<DiagnosticsView['state'], string> = { loading: '等待服务状态', connected: '后端可达', reconnected: '后端已重新连接', restarted: '检测到服务重启', disconnected: '服务已断开', stale: '状态已过期' };
export function diagnosticConnectionLabel(view: DiagnosticsView) { return connectionLabels[view.state]; }
const evidenceLabels = { passed: '包内本地夹具验证通过', missing: '未提供包内验证证据', stale: '包内验证证据已过期或不匹配', invalid: '包内验证证据无效' };
const schedulerLabels = { stopped: '已停止', starting: '正在启动', healthy: '心跳正常', degraded: '调度异常', stale: '心跳已过期' };
const providerReturnLabels = { not_observed: '本进程尚未观察到请求结果', succeeded: '本进程收到成功返回', failed: '本进程收到失败返回', cancelled: '本进程观察到取消' };
const overallLabels = { setup_required: '仍需完成配置', degraded: '存在运行阻塞', configured_unverified: '已配置 · 在线验收未完成' };
const connectorLabels: Record<string, string> = { disabled: '已停用', ready: '配置就绪 · 未验证连接', adapter_missing: '缺少服务端适配器', credential_missing: '凭据引用未就绪', capability_mismatch: '动作超出适配器范围' };

export function DiagnosticsPanel({ view, compact = false, onManage }: { view: DiagnosticsView; compact?: boolean; onManage?: (tab: 'connectors' | 'schedules' | 'runs' | 'capabilities') => void }) {
  const value = view.snapshot, old = view.state === 'disconnected' || view.state === 'stale';
  return <section className={`runtime-diagnostics ${compact ? 'diagnostics-compact' : ''}`} aria-label="运行诊断" data-connection-state={view.state} aria-busy={view.checking}>
    <div className="diagnostics-heading"><h3>运行诊断</h3><button type="button" className="icon-button" aria-label="刷新运行诊断" title="只读取本地状态，不调用模型或连接器" disabled={view.checking} onClick={() => void view.refresh()}><Icon name="refresh" size={18} /></button></div>
    <div className={`diagnostics-connection diagnostics-${view.state}`} role="status"><span className="diagnostics-dot" />{connectionLabels[view.state]}{view.checking && <span> · 正在读取…</span>}</div>
    <p className="diagnostics-safety">只读取服务状态，不测试模型、不执行连接器、不产生模型调用费用。</p>
    {view.error && <p className="management-error" role="alert">{view.error}。检查网络与服务进程后，点击刷新运行诊断。</p>}
    {old && <p className="diagnostics-warning">{value ? '下方为上次快照，不能代表当前可用。' : '尚无可用快照。'}最后成功读取：{stamp(view.receivedAt)}</p>}
    {view.state === 'restarted' && <p className="diagnostics-warning">服务实例已变化，已更新当前快照。请检查中断的运行记录；诊断不会重放中断运行。</p>}
    {value && <>
      <p className="diagnostics-summary">{overallLabels[value.overall]}{old ? '（上次快照）' : ''}</p>
      <dl className="diagnostics-facts"><dt>后端快照时间</dt><dd>{stamp(value.observedAt)}</dd><dt>本次服务启动</dt><dd>{stamp(value.startedAt)}</dd><dt>配置</dt><dd>{value.provider.configured ? '模型已配置' : '模型尚未配置'} · {value.provider.provider} · {value.provider.model}</dd><dt>本地证据</dt><dd>{evidenceLabels[value.provider.localVerification.status]}{value.provider.localVerification.checkedAt && ` · ${stamp(value.provider.localVerification.checkedAt)}`}</dd><dt>在线验收</dt><dd>当前部署未验证</dd></dl>
      <p className="diagnostics-boundary">包内夹具只验证本地实现；配置存在和请求成功返回都不代表真实模型、工具或当前部署已通过在线验收。</p>
      {!compact && <>
        <section className="management-card"><h3>模型观察</h3><p>{providerReturnLabels[value.provider.lastObservation.status]}{value.provider.lastObservation.code && ` · ${value.provider.lastObservation.code}`}</p><p>观察时间：{stamp(value.provider.lastObservation.observedAt)}</p><p>仅记录当前进程的提供方返回，不验证工具兼容、账单额度或真实服务可达性。</p></section>
        <section className="management-card" data-diagnostic="storage"><h3>本地存储</h3><dl><dt>写入状态</dt><dd>{value.storage.state === 'open' ? '存储已打开' : value.storage.state === 'writes-stopped' ? '写入已停止' : '存储已关闭'}</dd><dt>持久性</dt><dd>{value.storage.durability === 'confirmed' ? '已有写入持久性已确认' : '持久性不确定'}</dd><dt>数据库版本</dt><dd>{value.storage.schemaVersion}</dd><dt>单写进程</dt><dd>{value.storage.exclusiveWriter ? '已持有独占写锁' : '未确认'}</dd><dt>实时写入探测</dt><dd>未执行</dd></dl>{value.storage.warnings.map(item => <p className="diagnostics-warning" key={item.code}>{item.code} · {item.message}</p>)}</section>
        <section className="management-card" data-diagnostic="scheduler"><h3>定时调度</h3><dl><dt>调度状态</dt><dd>{schedulerLabels[value.scheduler.state]}</dd><dt>自动计时器</dt><dd>{value.scheduler.automaticTimer ? '已运行' : '未运行'}</dd><dt>目标分发器</dt><dd>{value.scheduler.dispatchConfigured ? '已配置' : '未配置'}</dd><dt>上次完成检查</dt><dd>{stamp(value.scheduler.lastCompletedAt)}</dd><dt>启用 / 阻塞</dt><dd>{value.scheduler.enabled} / {value.scheduler.blocked}</dd></dl>{value.scheduler.lastError && <p className="diagnostics-warning">{value.scheduler.lastError.code} · {value.scheduler.lastError.message}</p>}<p>只在服务进程运行期间调度，诊断刷新不会启动或执行定时任务。</p>{onManage && <button type="button" className="text-button" onClick={() => onManage('schedules')}>查看定时任务</button>}</section>
        <section className="management-card" data-diagnostic="connectors"><h3>连接器配置</h3><p>共 {value.connectors.total} 个 · 启用 {value.connectors.enabled} 个 · 配置就绪 {value.connectors.configured} 个 · 阻塞 {value.connectors.blocked} 个</p><p>外部连接未验证，刷新不会执行适配器。</p>{value.connectors.items.map(item => <p key={item.id}>{item.name} · {connectorLabels[item.status] || item.status}</p>)}{onManage && <button type="button" className="text-button" onClick={() => onManage('connectors')}>查看连接器</button>}</section>
        <section className="management-card"><h3>恢复与访问</h3><p>恢复标记：{value.recovery.restored ? '当前数据来自恢复' : '未发现恢复标记'}</p><p>访问模式：{value.access.mode === 'enterprise' ? '企业访问' : '本地访问'}</p><p>正式部署、备份恢复和独立安全复核仍需分别验收。</p></section>
      </>}
      {!!value.blockers.length && <section className="diagnostics-blockers"><h3>下一步</h3><ul>{(compact ? value.blockers.slice(0, 2) : value.blockers).map(item => <li key={`${item.component}-${item.code}`}><strong>{item.message}</strong><span>{item.action}</span></li>)}</ul></section>}
      {compact && onManage && <button type="button" className="text-button" onClick={() => onManage('capabilities')}>查看完整运行诊断<Icon name="chevron" size={14} /></button>}
    </>}
  </section>;
}
