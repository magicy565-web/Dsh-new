import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNativeOwnerTransport } from './owner-session-transport.mjs';
import { serveOwnerRpc } from './owner-rpc.mjs';

export function ownerChildEnvironment(environment) {
  // Do not inherit the login host's provider keys, Worker tokens, signing keys,
  // debug hooks or unrelated connector environment into Pi.
  const allowed = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'SystemRoot', 'WINDIR',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'WORKSPACE_PI_DATA_DIR'];
  return { ...Object.fromEntries(allowed.filter(key => environment[key] !== undefined).map(key => [key, environment[key]])), WORKSPACE_PI_OWNER_RPC_FD: '3' };
}

/** Called ONLY by an existing trusted login host that already owns this native
 * Session. No signer or credentials are provisioned, extended, copied to disk
 * or passed on argv/environment. There is no new public login endpoint.
 */
export function launchWithExistingOwnerSession({ origin, token, session, conversationId, mode = 'tui', environment = process.env, stdio = 'inherit', fetchImpl = fetch }) {
  if (session?.mode !== 'enterprise' || session.authenticated !== true || session.user?.role !== 'admin') throw new Error('EXISTING_OWNER_SESSION_REQUIRED');
  if (!['tui', 'diagnose'].includes(mode)) throw new Error('OWNER_LAUNCH_MODE_INVALID');
  if (mode === 'tui' && (stdio !== 'inherit' || !process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('OWNER_TTY_REQUIRED');
  const request = createNativeOwnerTransport({ origin, token, scope: { workspaceId: session.workspaceId, subject: session.user.id, conversationId } }, { fetchImpl });
  const env = ownerChildEnvironment(environment);
  const script = fileURLToPath(new URL(mode === 'tui' ? './launch.mjs' : './diagnose.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], { env, stdio: [stdio, stdio, stdio, 'pipe'] });
  serveOwnerRpc(child.stdio[3], request);
  child.once('exit', () => child.stdio[3].destroy());
  return child;
}
