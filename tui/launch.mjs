import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => !['--continue', '--resume', '--help', '--version'].includes(arg))) {
  console.error('Use only --continue, --resume, --help or --version. Workspace actions run inside /workspace-muse.');
  process.exit(2);
}
const dataRoot = process.env.WORKSPACE_PI_DATA_DIR || path.join(root, '.data');
if (!path.isAbsolute(dataRoot)) { console.error('WORKSPACE_PI_DATA_DIR must be absolute.'); process.exit(2); }
const privateRoot = path.join(dataRoot, 'pi');
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
const ownerFd = process.env.WORKSPACE_PI_OWNER_RPC_FD === undefined ? null : Number(process.env.WORKSPACE_PI_OWNER_RPC_FD);
if (ownerFd !== null && (!Number.isInteger(ownerFd) || ownerFd < 3 || ownerFd > 64)) { console.error('OWNER_SESSION_PIPE_REQUIRED'); process.exit(2); }
const child = spawn(process.execPath, [
  path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
  '--offline', '--no-extensions', '--no-tools', '--no-mcp', '--no-skills',
  '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve',
  '--extension', path.join(root, 'extensions/workspace-muse.mjs'), ...args,
], { cwd: root, stdio: ownerFd === null ? 'inherit' : ['inherit', 'inherit', 'inherit', ownerFd], env: { ...process.env,
  ...(ownerFd === null ? {} : { WORKSPACE_PI_OWNER_RPC_FD: '3' }), WORKSPACE_PI_DATA_DIR: dataRoot, PI_CODING_AGENT_DIR: privateRoot } });
child.on('error', () => { console.error('Pi could not start. Run npm --prefix tui ci first.'); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
