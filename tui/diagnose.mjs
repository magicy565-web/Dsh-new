import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceClient, loadOwnerTransport } from './workspace-client.mjs';

export const OWNER_GUIDANCE = Object.freeze({
  EXISTING_OWNER_TRANSPORT_REQUIRED: '由已经登录的可信 Host 调用 owner-host-launch.mjs；缺少 Host 交接时尚有接线工作。不要提供 Worker Bearer 或 ingress 私钥。',
  EXISTING_OWNER_SESSION_REQUIRED: '先通过原企业安全登录恢复原 owner/admin 会话，再由原 Host 重新打开 TUI。',
  OWNER_SESSION_EXPIRED: '原会话已过期或撤销；在原安全入口重新登录，再由 Host 重新打开 TUI。任务和原请求仍保留。',
  SESSION_REQUIRED: '原会话已过期或撤销；使用原安全登录重新建立会话。',
  OWNER_HOST_DISCONNECTED: '原授权 Host 管道已断开；从原 Host 重新打开 TUI，不要复制会话凭据。',
  OWNER_SESSION_IDENTITY_MISMATCH: '当前会话不是已绑定的原 workspace/owner/admin。恢复准确原身份，不扩大账号权限。',
  OWNER_ORIGINAL_CONVERSATION_MISMATCH: '恢复原 owner 的原 Muse conversation binding；不能新建替代身份或绑定其他会话。',
  MW_ORIGINAL_BINDING_REQUIRED: '服务器未挂载原 Muse owner/conversation binding；由运维核对已有私有配置和原会话数据，不能用模型或新身份替代。',
  OWNER_INGRESS_JSON_REQUIRED: '目标没有返回原 native ingress JSON；可能是浏览器登录重定向、错误域名或尚未挂载 native 会话转发。',
  OWNER_INGRESS_REDIRECT_REJECTED: '请求被重定向；先核对原 native HTTPS ingress。诊断不会携带会话跟随重定向。',
  AUTH_REQUIRED: '请求未经过原可信签名 ingress；单独 cookie/token 不能直连企业后端。',
  CSRF_REJECTED: '原会话 CSRF 校验失败；通过原 Host 重新登录，不关闭校验。',
});

export async function diagnose({ transport = loadOwnerTransport } = {}) {
  const source = await readFile(new URL('../deploy/muse-native-overlay/client/workspace-api.py', import.meta.url));
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const report = { mode: 'read-only', businessWrites: 0, realMuseVerified: false,
    consumer: { sourceSha256, reviewedSourceMatch: sourceSha256 === '0fb492b9e8860c850f7e236537a6df9b84fa84919655331ab1c62f70fc67888c',
      contract: 'workspace.muse.pull.v1', serverPath: '/api/muse-worker/v1',
      execution: 'one-shot pull CLI; no listener, automatic claim or wake loop', remoteInstalledVersionVerified: false },
    owner: { status: 'blocked' }, muse: { status: 'not_checked' },
    sessionPolicy: 'Original defaults: 15-minute idle, 8-hour absolute; backend restart revokes sessions. Task recovery is not continued authentication.' };
  let request;
  try {
    request = await transport();
    const client = createWorkspaceClient(request);
    const identity = await client.connect();
    const { muse } = await client.connection();
    report.owner = { status: 'verified_existing_session', workspaceId: identity.workspaceId, conversationId: identity.conversationId };
    report.muse = { status: muse?.installed === true ? muse.approved === true ? 'original_binding_approved' : 'original_binding_not_approved' : 'original_binding_missing',
      workerId: muse?.workerId || null, lastSeenAt: muse?.lastSeenAt || null, onlineVerified: false,
      next: '在真实 Muse 已有 Secure Vault/authd 环境执行原 CLI identity、inbox 两个 GET。不能由此推断已监听、领取或完成任务。' };
  } catch (error) {
    const code = /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'OWNER_DIAGNOSTIC_FAILED';
    report.owner = { status: 'blocked', code, next: OWNER_GUIDANCE[code] || '核对原 Host、native HTTPS ingress、owner 会话与原会话绑定；保持现有权限。' };
  } finally { request?.close?.(); }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await diagnose(); console.log(JSON.stringify(result, null, 2)); if (result.owner.status === 'blocked') process.exitCode = 2; }
  catch { console.error('OWNER_DIAGNOSTIC_FAILED'); process.exitCode = 2; }
}
