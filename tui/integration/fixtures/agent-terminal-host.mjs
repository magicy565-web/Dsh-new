import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supplierFixture, actor, origin } from './supplier-owner.mjs';
import { syntheticProvider } from './synthetic-provider.mjs';
import { launchWithExistingOwnerSession, ownerChildEnvironment } from '../../owner-host-launch.mjs';
import { serveOwnerRpc } from '../../owner-rpc.mjs';
import { MODEL_TOOL_NAMES } from '../../extensions/workspace-agent.mjs';

const directory = process.env.PI_SUPPLIER_FIXTURE_DIRECTORY;
const profileDirectory = process.env.PI_CODING_AGENT_DIR;
if (!directory?.startsWith('/tmp/') || !profileDirectory?.startsWith('/tmp/')) throw new Error('SYNTHETIC_FIXTURE_PATH_REQUIRED');
const f = await supplierFixture({ directory, snapshotFile: process.env.PI_SUPPLIER_FIXTURE_STATE });
const provider = await syntheticProvider({ profileDirectory, reportFile: process.env.PI_SUPPLIER_PROVIDER_REPORT });
let child;
try {
  if (process.env.PI_SUPPLIER_UNATTENDED === '1') {
    // Raw native Pi noninteractive fixture proves execute() rejects even if a
    // caller bypasses the production launcher's TUI-only entry restrictions.
    const root = fileURLToPath(new URL('../../', import.meta.url));
    child = spawn(process.execPath, [path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
      '--offline', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve',
      '--tools', MODEL_TOOL_NAMES.join(','), '--extension', path.join(root, 'extensions/workspace-muse.mjs'), '--no-session', '--mode', 'json', '--print',
      'Save synthetic supplier facts [fixture:unattended]'], { env: { ...ownerChildEnvironment(process.env), WORKSPACE_PI_MODE: 'agent' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    serveOwnerRpc(child.stdio[3], f.transport());
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  } else {
    child = launchWithExistingOwnerSession({ origin, token: f.token, session: (await f.http('/api/session')).body,
      conversationId: actor.nativeAgentId, mode: 'tui', environment: { ...process.env, WORKSPACE_PI_MODE: 'agent' }, fetchImpl: f.fetchImpl });
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => { child.once('exit', code => resolve(code ?? 1)); child.once('error', reject); });
} finally { await f.close(); await provider.close(); }
