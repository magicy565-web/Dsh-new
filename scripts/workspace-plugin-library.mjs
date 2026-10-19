#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { DEFAULT_PLUGIN_ROOT } from '../server/workspace-plugin-config.mjs';
import { readPluginInventory } from '../server/plugin-library/inventory.mjs';
import { openPluginControlStore } from '../server/plugin-library/control-store.mjs';
import { applyToolSelection, reconcileToolSelection } from '../server/plugin-library/apply.mjs';

const help = `Workspace plugin library (development candidate)

node scripts/workspace-plugin-library.mjs inventory [--plugin-dir /absolute/reviewed/plugins]
node scripts/workspace-plugin-library.mjs inspect --state-directory /private/control --workspace-id ID
node scripts/workspace-plugin-library.mjs apply --state-directory /private/control --workspace-id ID --request-id ID --expected-revision N --confirm-package-sha256 SHA [--plugin-dir /absolute/reviewed/plugins]
node scripts/workspace-plugin-library.mjs reconcile --state-directory /private/control --workspace-id ID --request-id ID --expected-revision N [--plugin-dir /absolute/reviewed/plugins]

inventory reads source/configuration only; it never loads extension factories.
inspect/apply/reconcile acquire the SAME exclusive control lock as the opted-in Host.
Stop the managed Host before using them. No process is stopped by this command.
apply supports reviewed enable-tools/disable-tools only. It does not install,
upgrade or delete packages, stop backends, authorize data, or run business tools.
A crash barrier is kept until explicit reconciliation. No stale lock is deleted.
The private state directory must already exist with mode 0700 on Linux.
Never point the control directory at business data or another workspace.
`;
class CommandError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const refuse = message => { throw new CommandError(400, 'PLUGIN_CLI_ARGUMENTS_REFUSED', message); };
export function parsePluginLibraryArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) refuse('Arguments must be strings.');
  const [command, ...rest] = argv;
  if (command === '--help' || command === 'help' || command === undefined) {
    if (rest.length) refuse('Unexpected help arguments.');
    return { command: 'help' };
  }
  const allowed = {
    inventory: ['plugin-dir'],
    inspect: ['state-directory', 'workspace-id'],
    apply: ['state-directory', 'workspace-id', 'plugin-dir', 'request-id', 'expected-revision', 'confirm-package-sha256'],
    reconcile: ['state-directory', 'workspace-id', 'plugin-dir', 'request-id', 'expected-revision'],
  };
  if (!Object.hasOwn(allowed, command)) refuse('Use inventory, inspect, apply or reconcile.');
  const options = Object.create(null);
  if (rest.length % 2) refuse('Each option requires one value.');
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].replace(/^--/u, '');
    const value = rest[index + 1];
    if (rest[index] !== '--' + key || !allowed[command].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--'))
      refuse('Unknown, repeated or missing option.');
    options[key] = value;
  }
  for (const key of ['plugin-dir', 'state-directory']) if (options[key] && (!path.isAbsolute(options[key]) || options[key] !== path.resolve(options[key])))
    refuse('Directory options must be canonical absolute paths without dot segments.');
  if (command !== 'inventory' && (!options['state-directory'] || !/^[A-Za-z0-9._@:+|/-]{1,128}$/u.test(options['workspace-id'] || '') || options['workspace-id'] === 'local'))
    refuse('Use an explicit private control directory and enterprise workspace ID.');
  if (['apply', 'reconcile'].includes(command)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(options['request-id'] || '') || !/^(?:0|[1-9]\d*)$/u.test(options['expected-revision'] || '') || !Number.isSafeInteger(Number(options['expected-revision'])))
      refuse('Use an exact recorded request and current integer revision.');
  }
  if (command === 'apply' && !/^[a-f0-9]{64}$/u.test(options['confirm-package-sha256'] || '')) refuse('Independently review and confirm the exact package SHA-256.');
  return { command, options };
}
export async function runPluginLibraryCli(argv, output = value => process.stdout.write(value + '\n')) {
  const { command, options } = parsePluginLibraryArguments(argv);
  if (command === 'help') { output(help); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new CommandError(503, 'PLUGIN_CLI_NODE_VERSION', 'Use the project-supported Node 24 or newer.');
  if (command === 'inventory') { output(JSON.stringify(await readPluginInventory({ root: options['plugin-dir'] || DEFAULT_PLUGIN_ROOT }), null, 2)); return; }
  const control = await openPluginControlStore({ directory: options['state-directory'], workspaceId: options['workspace-id'], ApiError: CommandError });
  try {
    if (command === 'inspect') {
      const state = control.read();
      output(JSON.stringify({ schemaVersion: 1, workspaceId: state.workspaceId, revision: state.revision, intents: state.intents, releaseCount: state.releases.length, receiptCount: state.receipts.length }, null, 2));
      return;
    }
    const input = { control, root: options['plugin-dir'] || path.resolve(DEFAULT_PLUGIN_ROOT), requestId: options['request-id'], expectedRevision: Number(options['expected-revision']), subject: 'os:' + userInfo().username };
    const result = command === 'apply'
      ? await applyToolSelection({ ...input, confirmPackageSha256: options['confirm-package-sha256'] })
      : await reconcileToolSelection(input);
    output(JSON.stringify(result, null, 2));
  } finally { await control.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPluginLibraryCli(process.argv.slice(2)).catch(error => {
    // Filesystem/provider exceptions may contain private paths. Do not echo them.
    const code = typeof error?.code === 'string' && /^PLUGIN_[A-Z0-9_]+$/u.test(error.code) ? error.code : 'PLUGIN_CLI_FAILED';
    process.stderr.write(JSON.stringify({ ok: false, code, message: error instanceof CommandError ? error.message : 'The operation was not confirmed. Inspect the original request and any transaction barrier; no lock or package was automatically removed.' }) + '\n');
    process.exitCode = 1;
  });
}
