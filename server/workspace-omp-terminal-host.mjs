import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serveOwnerRpc } from '../tui/owner-rpc.mjs';
import { verifyWorkspaceOmpRuntime } from '../scripts/workspace-omp.mjs';
import { workspaceOmpPaths } from './workspace-omp-bridge.mjs';

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
// The existing authenticated Host owns Session/CSRF and ingress signing. This
// adapter accepts only its in-memory request closure; it never logs in, signs,
// reads browser cookies or copies credentials into the official terminal.
export function createWorkspaceOmpHostRequest({ origin, session, conversationId = null, request }) {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || typeof request !== 'function'
    || session?.mode !== 'enterprise' || session.authenticated !== true || !session.workspaceId || !session.user?.id
    || !['admin', 'operator', 'viewer'].includes(session.user.role) || conversationId !== null && !identifier(conversationId)) fail('EXISTING_OMP_SESSION_HOST_REQUIRED');
  const scope = { workspaceId: session.workspaceId, subject: session.user.id, role: session.user.role };
  let selected = conversationId;
  return async ({ method, path: target, body, signal }) => {
    const match = target?.match(/^\/api\/conversations\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})\/(messages|cancel|terminal-status|terminal-controls|business-results|business-tasks\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})\/resume)(\?runId=[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})?$/);
    const allowedRead = method === 'GET' && body === undefined && (['/api/session', '/api/conversations/runtime'].includes(target)
      || match && match[1] === selected && ['terminal-status', 'business-results'].includes(match[2]) && (match[2] === 'terminal-status' ? !!match[4] : !match[4]));
    const allowedWrite = method === 'POST' && (target === '/api/conversations' && !selected
      || match && match[1] === selected && !match[4] && ['messages', 'cancel', 'terminal-controls'].includes(match[2])
      || match && match[1] === selected && !match[4] && match[2].startsWith('business-tasks/'));
    if (!allowedRead && !allowedWrite) fail('OMP_HOST_ROUTE_FORBIDDEN');
    const current = await request({ method: 'GET', path: '/api/session', signal });
    if (current.status !== 200 || current.body?.mode !== 'enterprise' || current.body.authenticated !== true
      || current.body.workspaceId !== scope.workspaceId || current.body.user?.id !== scope.subject || current.body.user?.role !== scope.role) fail('OMP_SESSION_EXPIRED_OR_CHANGED');
    const result = target === '/api/session' ? current : await request({ method, path: target, body, signal });
    if (!result || !Number.isInteger(result.status) || Buffer.byteLength(JSON.stringify(result.body) || '') > 2_000_000) fail('OMP_HOST_RECEIPT_INVALID');
    if (target === '/api/conversations' && result.status === 201) {
      if (!identifier(result.body?.conversation?.id)) fail('OMP_HOST_RECEIPT_INVALID');
      selected = result.body.conversation.id;
    }
    return result;
  };
}

export async function launchWorkspaceOmpWithExistingSession({ origin, session, conversationId = null, request, environment = {}, stdio = 'inherit' }) {
  if (stdio !== 'inherit' || !process.stdin.isTTY || !process.stdout.isTTY) fail('OMP_HOST_TTY_REQUIRED');
  const scoped = createWorkspaceOmpHostRequest({ origin, session, conversationId, request });
  const proof = await scoped({ method: 'GET', path: '/api/session', signal: AbortSignal.timeout(15000) });
  if (proof.status !== 200) fail('OMP_SESSION_EXPIRED_OR_CHANGED');
  const paths = workspaceOmpPaths(environment); await verifyWorkspaceOmpRuntime(paths);
  const home = await fs.mkdtemp('/tmp/workspace-omp-enterprise-terminal-');
  const env = { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: home, TMPDIR: home,
    PI_CODING_AGENT_DIR: home + '/agent', WS_AGENT_SESSION_DIR: home, PI_NO_TITLE: '1',
    WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WORKSPACE_OMP_SESSION_RPC_FD: '3', WS_AGENT_URL: origin,
    ...(conversationId ? { WORKSPACE_OMP_CONVERSATION_ID: conversationId } : {}) };
  for (const key of ['LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'PI_PROVIDER', 'PI_MODEL', 'PI_BASE_URL', 'WORKSPACE_OMP_PROFILE']) if (environment[key]) env[key] = environment[key];
  let child;
  try {
    child = spawn(paths.bun, [fileURLToPath(new URL('../scripts/workspace-omp-terminal.mjs', import.meta.url))], {
      cwd: home, env, stdio: ['inherit', 'inherit', 'inherit', 'pipe'] });
    serveOwnerRpc(child.stdio[3], scoped);
    child.once('close', () => { child.stdio[3].destroy(); void fs.rm(home, { recursive: true, force: true }); });
    child.once('error', () => { void fs.rm(home, { recursive: true, force: true }); });
    return child;
  } catch (error) { await fs.rm(home, { recursive: true, force: true }); throw error; }
}
