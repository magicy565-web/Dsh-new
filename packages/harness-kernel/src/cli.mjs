// `wh` CLI: list a composition without mounting it, or doctor it (load + health, no serve).
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { HarnessError } from '../../harness-contracts/src/index.mjs';
import { createHarness } from './app.mjs';
import { displayPath, readComposition, resolveRows } from './resolve.mjs';
import { applyPatches, digestComposition, readPatch, readPatchJournal, setRowDisabled } from './patch.mjs';
import { installPlugin, listInstalled, readInstallJournal, rollbackPlugin, uninstallPlugin } from './install.mjs';
import { appendAuditEntry } from './audit-state.mjs';
import { installBundle } from './bundle.mjs';
import { composePreset, listPresets, loadPreset, presetSummary } from './presets.mjs';

const STORAGE_STATE_FILE = 'workspace.json';

const USAGE = `Usage: wh <command> [options]

Commands:
  list      Resolve and print composition rows (entry, status, requires/provides). No plugin is mounted.
  plugins   Alias of list; both accept --patch layers.
  doctor    Load the composition (mount plugins, no HTTP serving), report health, then dispose.
  patch     Inspect or edit a patch layer: \`show\`, \`journal\`, \`disable <id>\`, \`enable <id>\` (requires --patch).
  audit     Read the durable audit trail straight from the storage state file (no lock, no mount).
  installed List installed plugin packages in the target directory.
  install   Install (or --upgrade) a local plugin package directory; atomic, digest-checked.
  install-bundle Install every plugin listed in a bundle manifest, with rollback on failure.
  uninstall Move an installed package to a backup directory.
  rollback  Restore an installed package from its newest (or named) backup.
  presets   Agent presets: \`wh presets list\` or \`wh presets show <name>\`.
  help      Print this text.

Options:
  -c, --composition <file>  Composition file (default: harness.local.yml, relative to --root).
  -p, --patch <file>        Composition patch layer; repeatable, applied in order.
      --root <dir>          Workspace root used by the plugin-name resolution rules (default: cwd).
      --state <file>        Storage state file for \`wh audit\` (default: the storage row directory).
      --kind <kind>         \`wh audit\`: only events of this kind (e.g. inquiry, tool, harness).
      --workspace <id>      \`wh audit\`: only events recorded for this workspace.
      --limit <n>           \`wh audit\`: newest n events (default 20, max 200).
      --target <dir>        Plugin package directory for install/uninstall/rollback/installed (default: plugins).
      --backup <dir>        \`wh rollback\`: restore this explicit backup directory.
      --journal             \`wh installed\`: print the install journal instead of the package list.
      --public-key <pem>    \`wh install\`: PEM public key for an offline ed25519 signature check.
      --actor <subject>     Actor recorded in the install journal (default: local-operator).
      --audit-state <file>  Append install/upgrade/uninstall/rollback to this storage state's audit stream.
      --upgrade             \`wh install\`: replace an existing installation (the old one is kept as a backup).
      --json                Machine-readable JSON output.
  -h, --help                Print this text.
`;

function cliLogger(stderr) {
  const write = type => (...args) => {
    const line = args
      .map(argument => (argument instanceof Error ? argument.message : String(argument)))
      .join(' ');
    stderr.write(`[harness:${type}] ${line}\n`);
  };
  return { error: write('error'), warn: write('warn'), info() {}, debug() {} };
}

export function parseArgv(argv = []) {
  const options = {
    command: null,
    args: [],
    composition: 'harness.local.yml',
    patches: [],
    state: null,
    kind: null,
    workspace: null,
    limit: null,
    target: null,
    backup: null,
    upgrade: false,
    journal: false,
    publicKey: null,
    actor: null,
    auditState: null,
    root: null,
    json: false,
    help: false,
  };
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--composition' || argument === '-c') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a file path.`);
      else {
        options.composition = value;
        index += 1;
      }
    } else if (argument.startsWith('--composition=')) {
      options.composition = argument.slice('--composition='.length);
    } else if (argument === '--patch' || argument === '-p') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a file path.`);
      else {
        options.patches.push(value);
        index += 1;
      }
    } else if (argument.startsWith('--patch=')) {
      options.patches.push(argument.slice('--patch='.length));
    } else if (argument === '--state') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a file path.`);
      else {
        options.state = value;
        index += 1;
      }
    } else if (argument.startsWith('--state=')) {
      options.state = argument.slice('--state='.length);
    } else if (argument === '--kind') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a kind.`);
      else {
        options.kind = value;
        index += 1;
      }
    } else if (argument.startsWith('--kind=')) {
      options.kind = argument.slice('--kind='.length);
    } else if (argument === '--workspace') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a workspace id.`);
      else {
        options.workspace = value;
        index += 1;
      }
    } else if (argument.startsWith('--workspace=')) {
      options.workspace = argument.slice('--workspace='.length);
    } else if (argument === '--target') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a directory.`);
      else {
        options.target = value;
        index += 1;
      }
    } else if (argument.startsWith('--target=')) {
      options.target = argument.slice('--target='.length);
    } else if (argument === '--backup') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a directory.`);
      else {
        options.backup = value;
        index += 1;
      }
    } else if (argument.startsWith('--backup=')) {
      options.backup = argument.slice('--backup='.length);
    } else if (argument === '--upgrade') {
      options.upgrade = true;
    } else if (argument === '--journal') {
      options.journal = true;
    } else if (argument === '--public-key') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a PEM file.`);
      else {
        options.publicKey = value;
        index += 1;
      }
    } else if (argument.startsWith('--public-key=')) {
      options.publicKey = argument.slice('--public-key='.length);
    } else if (argument === '--actor') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires an actor subject.`);
      else {
        options.actor = value;
        index += 1;
      }
    } else if (argument.startsWith('--actor=')) {
      options.actor = argument.slice('--actor='.length);
    } else if (argument === '--audit-state') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a state file path.`);
      else {
        options.auditState = value;
        index += 1;
      }
    } else if (argument.startsWith('--audit-state=')) {
      options.auditState = argument.slice('--audit-state='.length);
    } else if (argument === '--limit') {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (!value || value.startsWith('-')) errors.push(`${argument} requires an integer 1-200.`);
      else {
        index += 1;
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) errors.push(`${argument} requires an integer 1-200.`);
        else options.limit = parsed;
      }
    } else if (argument.startsWith('--limit=')) {
      const parsed = Number(argument.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) errors.push('--limit requires an integer 1-200.');
      else options.limit = parsed;
    } else if (argument === '--root' || argument === '-r') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) errors.push(`${argument} requires a directory.`);
      else {
        options.root = value;
        index += 1;
      }
    } else if (argument.startsWith('--root=')) {
      options.root = argument.slice('--root='.length);
    } else if (argument.startsWith('-') && argument !== '-') {
      errors.push(`unknown option: ${argument}`);
    } else if (!options.command) {
      options.command = argument;
    } else if (options.command === 'presets' || options.command === 'patch'
      || options.command === 'install' || options.command === 'install-bundle'
      || options.command === 'uninstall' || options.command === 'rollback') {
      options.args.push(argument);
    } else {
      errors.push(`unexpected argument: ${argument}`);
    }
  }
  return { options, errors };
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function table(rows) {
  const headers = ['ID', 'NAME', 'STATUS', 'ENTRY', 'REQUIRES', 'PROVIDES'];
  const body = rows.map(entry => [
    entry.id,
    entry.name,
    entry.status,
    entry.entry ?? '-',
    entry.requires.length ? entry.requires.join(',') : '-',
    entry.provides.length ? entry.provides.join(',') : '-',
  ]);
  const widths = headers.map((header, index) =>
    Math.min(56, Math.max(header.length, ...body.map(row => String(row[index] ?? '').length))),
  );
  const render = row => row.map((cell, index) => pad(cell, widths[index])).join('  ').trimEnd();
  return [render(headers), render(widths.map(width => '-'.repeat(width))), ...body.map(render)].join('\n');
}

function rowSummary(entry) {
  const summary = {
    id: entry.row.id,
    name: entry.row.name,
    disabled: Boolean(entry.row.disabled),
    status: entry.status,
    entry: entry.entry ?? null,
    requires: entry.manifest ? [...entry.manifest.requires] : [],
    provides: entry.manifest ? [...entry.manifest.provides] : [],
    env: entry.manifest ? [...(entry.manifest.env ?? [])] : [],
  };
  if (entry.manifest) summary.manifestId = entry.manifest.id;
  if (entry.error) summary.error = { code: entry.error.code ?? 'HARNESS_ERROR', message: entry.error.message };
  return summary;
}

/** `wh list`: resolve rows without mounting any plugin (no HTTP server, no apply()). */
export async function runList({ compositionPath, patchPaths = [], root, json = false, stdout = process.stdout } = {}) {
  const { file, composition: base } = await readComposition(compositionPath, { root });
  let composition = base;
  let applied = [];
  if (patchPaths.length) {
    const patches = [];
    for (const patchPath of patchPaths) patches.push((await readPatch(patchPath, { root })).patch);
    const layered = applyPatches(composition, patches);
    composition = layered.composition;
    applied = layered.applied;
  }
  const resolved = await resolveRows(composition.rows, { root, compositionFile: file });
  const document = {
    version: composition.version,
    name: composition.name,
    file: displayPath(root, file),
    server: composition.server,
    digest: digestComposition(composition),
    patches: applied,
    rows: resolved.map(rowSummary),
  };
  if (json) {
    stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return 0;
  }
  const address = `${composition.server.host}:${composition.server.port}`;
  stdout.write(`composition "${composition.name}" (${displayPath(root, file)}) server ${address}\n`);
  stdout.write(`${table(document.rows)}\n`);
  const missing = resolved.filter(entry => entry.status !== 'resolved' && entry.status !== 'disabled');
  if (missing.length) {
    stdout.write(
      `\n${missing.length} row(s) not resolvable yet: ${missing.map(entry => entry.row.id).join(', ')}. ` +
        'The rows are listed with status "missing"/"invalid"; starting the harness will fail closed.\n',
    );
  }
  return 0;
}

/** `wh doctor`: load the composition (mount, no serving), report health, dispose. */
export async function runDoctor({
  compositionPath,
  patchPaths = [],
  root,
  json = false,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const harness = await createHarness({ compositionPath, patchPaths, root, logger: cliLogger(stderr) });
  try {
    const health = harness.healthz();
    const envReads = harness.manifests
      .filter(entry => entry.env.length)
      .map(entry => ({ pluginId: entry.pluginId, manifestId: entry.manifestId, env: [...entry.env] }));
    const document = {
      name: harness.composition.name,
      file: displayPath(root, harness.composition.file),
      server: harness.composition.server,
      status: health.status,
      plugins: health.plugins,
      checks: health.checks,
      envReads,
      routes: harness.http.routeList(),
    };
    if (json) {
      stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    } else {
      stdout.write(`composition "${document.name}" (${document.file}) status: ${document.status}\n`);
      stdout.write('plugins:\n');
      for (const plugin of health.plugins) {
        stdout.write(`  ${plugin.id}: ${plugin.status}${plugin.error ? ` (${plugin.error})` : ''}\n`);
      }
      if (health.checks.length) {
        stdout.write('health checks:\n');
        for (const check of health.checks) {
          stdout.write(`  ${check.name}: ${check.status}${check.detail ? ` (${check.detail})` : ''}\n`);
        }
        if (envReads.length) {
          stdout.write('environment reads (declared names only, never values):\n');
          for (const entry of envReads) stdout.write(`  ${entry.pluginId}: ${entry.env.join(', ')}\n`);
        }
      }
      stdout.write('routes:\n');
      for (const route of document.routes) {
        stdout.write(`  ${route.method} ${route.path}  <- ${route.pluginId}\n`);
      }
    }
    return health.status === 'ok' ? 0 : 1;
  } finally {
    await harness.stop();
  }
}

async function runPresets({ root, args, json, stdout, stderr }) {
  const [subcommand, name] = args;
  if (!subcommand || subcommand === 'list') {
    const presets = await listPresets({ root });
    if (json) {
      stdout.write(`${JSON.stringify(presets.map(presetSummary), null, 2)}\n`);
      return 0;
    }
    if (!presets.length) {
      stdout.write('no presets found (expected presets/*.yml under --root)\n');
      return 0;
    }
    stdout.write('NAME              TITLE                  PLUGINS       TOOLS  SKILLS\n');
    for (const preset of presets) {
      stdout.write(`${pad(preset.name, 18)}${pad(preset.title, 23)}${pad(preset.plugins.map(row => row.id).join(','), 14)}${pad(preset.tools.length, 7)}${preset.skills.length}\n`);
    }
    return 0;
  }
  if (subcommand === 'show') {
    if (!name) {
      stderr.write('wh: presets show requires a preset name\n');
      return 2;
    }
    const preset = await loadPreset(name, { root });
    const composed = await composePreset(preset, { root });
    const summary = presetSummary(preset);
    if (json) {
      stdout.write(`${JSON.stringify({ ...summary, composition: composed.composition.rows }, null, 2)}\n`);
      return 0;
    }
    stdout.write(`preset ${summary.name} (${summary.title})\n`);
    stdout.write(`file: ${displayPath(summary.file, root)}\n`);
    if (summary.extends) stdout.write(`extends: ${summary.extends}\n`);
    stdout.write(`plugins: ${summary.plugins.join(', ') || '-'}\n`);
    stdout.write(`tools: ${summary.tools.join(', ') || '-'}\n`);
    stdout.write(`denyTools: ${summary.denyTools.join(', ') || '-'}\n`);
    stdout.write(`skills: ${summary.skills.join(', ') || '-'}\n`);
    stdout.write(`model: ${summary.model?.provider ?? '-'}${summary.model?.model ? `/${summary.model.model}` : ''}\n`);
    stdout.write(`persona:\n${summary.persona.split('\n').map(line => `  ${line}`).join('\n')}\n`);
    return 0;
  }
  stderr.write(`wh: unknown presets subcommand "${subcommand}"\n`);
  return 2;
}

async function runPatch({ root, args, patchPaths, json, stdout, stderr }) {
  const [subcommand, rowId] = args;
  if (!patchPaths.length) {
    stderr.write('wh: patch requires --patch <file>\n');
    return 2;
  }
  const patchPath = patchPaths[0];
  if (!subcommand || subcommand === 'show') {
    const { file, patch } = await readPatch(patchPath, { root });
    const document = {
      file: displayPath(root, file),
      name: patch.name,
      entries: patch.entries,
      insert: patch.insert.map(row => ({ id: row.id, name: row.name, config: row.config })),
    };
    if (json) {
      stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      return 0;
    }
    stdout.write(`patch ${document.file}${document.name ? ` (${document.name})` : ''}\n`);
    if (!document.entries.length && !document.insert.length) stdout.write('  (empty layer)\n');
    for (const entry of document.entries) stdout.write(`  entry ${entry.id}: ${JSON.stringify({ ...entry, id: undefined })}\n`);
    for (const row of document.insert) stdout.write(`  insert ${row.id}: ${row.name}\n`);
    return 0;
  }
  if (subcommand === 'journal') {
    const entries = await readPatchJournal(patchPath, { root });
    if (json) {
      stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      return 0;
    }
    if (!entries.length) {
      stdout.write(`no journal entries for ${patchPath}\n`);
      return 0;
    }
    for (const entry of entries) {
      stdout.write(`${entry.at} ${entry.event} ${entry.action ?? ''} ${entry.rowId ?? ''} ${entry.afterDigest ?? entry.digest ?? ''}`.trimEnd() + '\n');
    }
    return 0;
  }
  if (subcommand === 'disable' || subcommand === 'enable') {
    if (!rowId) {
      stderr.write(`wh: patch ${subcommand} requires a row id\n`);
      return 2;
    }
    const result = await setRowDisabled(patchPath, rowId, subcommand === 'disable', { root });
    if (json) {
      stdout.write(`${JSON.stringify({ file: result.file, action: result.action, rowId: result.rowId, backup: result.backup ?? null, removed: result.removed === true }, null, 2)}\n`);
      return 0;
    }
    stdout.write(`${result.action} ${result.rowId} in ${result.file}${result.backup ? ` (backup ${result.backup})` : ''}${result.removed ? ' (layer removed)' : ''}\n`);
    return 0;
  }
  stderr.write(`wh: unknown patch subcommand "${subcommand}"\n`);
  return 2;
}

/** Local mirror of the audit schema; the CLI must not depend on the seams package. */
function normalizeAuditRecord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.kind === 'string') {
    return {
      at: entry.at, kind: entry.kind, action: entry.action,
      actor: entry.actor ?? null, ok: entry.ok !== false,
      code: entry.code ?? null, detail: entry.detail ?? null, ref: entry.ref ?? null,
    };
  }
  if (typeof entry.tool === 'string') {
    return {
      at: entry.at, kind: 'tool', action: entry.tool,
      actor: entry.actor ?? null, ok: entry.ok !== false,
      code: entry.errorCode ?? null, detail: entry.approvalId ? { approvalId: entry.approvalId } : null, ref: null,
    };
  }
  return null;
}

/**
 * `wh audit`: read the durable audit trail from the storage state file without
 * mounting anything. Works offline, takes no lock, writes nothing.
 */
export async function runAudit({
  compositionPath, patchPaths = [], state, kind = null, workspace = null, limit = null,
  root, json = false, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let statePath = state ? (isAbsolute(state) ? state : resolvePath(root, state)) : null;
  if (!statePath) {
    const { composition } = await readComposition(compositionPath, { root });
    let effective = composition;
    if (patchPaths.length) {
      const layers = [];
      for (const patchPath of patchPaths) layers.push((await readPatch(patchPath, { root })).patch);
      effective = applyPatches(effective, layers).composition;
    }
    const storageRow = effective.rows.find(row => row.id === 'storage');
    const directory = storageRow?.config?.directory;
    if (typeof directory !== 'string' || !directory) {
      stderr.write('wh: the composition has no storage row with a directory; pass --state <file>\n');
      return 2;
    }
    statePath = resolvePath(isAbsolute(directory) ? directory : resolvePath(root, directory), STORAGE_STATE_FILE);
  }
  let raw;
  try { raw = await readFile(statePath, 'utf8'); }
  catch (error) {
    stderr.write(`wh: cannot read audit state ${displayPath(root, statePath)} (${error?.code ?? error?.message ?? error})\n`);
    return 2;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { stderr.write(`wh: audit state ${displayPath(root, statePath)} is not valid JSON\n`); return 1; }
  const size = limit ?? 20;
  const entries = (Array.isArray(parsed?.harnessAudit) ? parsed.harnessAudit : [])
    .map(normalizeAuditRecord).filter(Boolean)
    .filter(entry => kind === null || entry.kind === kind)
    .filter(entry => workspace === null || entry?.detail?.workspaceId === workspace)
    .slice(-size).reverse();
  if (json) {
    stdout.write(`${JSON.stringify({ file: displayPath(root, statePath), ...(workspace ? { workspace } : {}), events: entries }, null, 2)}\n`);
    return 0;
  }
  stdout.write(`audit ${displayPath(root, statePath)}${workspace ? ` (workspace ${workspace})` : ''}: ${entries.length} event(s)\n`);
  for (const entry of entries) {
    stdout.write(`${entry.at} ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.kind}/${entry.action}${entry.actor?.subject ? ` by ${entry.actor.subject}` : ''}${entry.code ? ` [${entry.code}]` : ''}\n`);
  }
  return 0;
}

/** `wh installed`: installed packages, or the install journal with --journal. */
export async function runInstalled({ root, target = null, journal = false, json = false, stdout = process.stdout } = {}) {
  const directory = target ?? 'plugins';
  if (journal) {
    const entries = await readInstallJournal({ root, target: directory, limit: 50 });
    if (json) {
      stdout.write(`${JSON.stringify({ directory: displayPath(root, directory), journal: entries }, null, 2)}\n`);
      return 0;
    }
    stdout.write(`install journal ${displayPath(root, directory)}: ${entries.length} entr(ies)\n`);
    for (const entry of entries) {
      stdout.write(`${entry.at} ${pad(entry.action, 10)}${pad(entry.id, 24)}${pad(entry.version ?? '-', 10)}${(entry.digest ?? '-').slice(0, 12)}${entry.previousDigest ? ` <- ${String(entry.previousDigest).slice(0, 12)}` : ''}${entry.signed ? (entry.verified ? ' [signed+verified]' : ' [signed]') : ''} by ${entry.actor ?? '-'}\n`);
    }
    return 0;
  }
  const installed = await listInstalled({ root, target: directory });
  if (json) {
    stdout.write(`${JSON.stringify({ directory: displayPath(root, directory), packages: installed }, null, 2)}\n`);
    return 0;
  }
  stdout.write(`installed ${installed.length} package(s) in ${displayPath(root, directory)}\n`);
  for (const item of installed) stdout.write(`${pad(item.id, 24)}${pad(item.version, 10)}${item.digest}\n`);
  return 0;
}

async function recordInstallAudit({ root, auditState, action, actor, pluginId, stderr, detail }) {
  if (!auditState) return null;
  try {
    return await appendAuditEntry(auditState, {
      kind: 'install', action,
      actor: { subject: actor ?? 'local-operator', role: 'operator' },
      ok: true, ref: pluginId, detail,
    }, { root });
  } catch (error) {
    stderr.write(`wh: warning: audit entry not written (${error?.message ?? error})\n`);
    return null;
  }
}

async function runInstall({ root, target, upgrade, args, publicKey = null, actor = null, auditState = null, json, stdout, stderr }) {
  const [source] = args;
  if (!source) {
    stderr.write('wh: install requires a package directory\n');
    return 2;
  }
  let key = null;
  if (publicKey) {
    const keyPath = isAbsolute(publicKey) ? publicKey : resolvePath(root, publicKey);
    key = await readFile(keyPath, 'utf8').catch(() => { throw new HarnessError('HARNESS_PLUGIN_FAILED', `cannot read public key ${displayPath(root, keyPath)}`); });
  }
  const result = await installPlugin({
    sourceDir: isAbsolute(source) ? source : resolvePath(root, source),
    root, target: target ?? 'plugins', upgrade: upgrade === true,
    publicKey: key, actor: actor ?? 'local-operator',
  });
  await recordInstallAudit({
    root, auditState, stderr, actor, pluginId: result.id,
    action: result.backup ? 'upgrade' : 'install',
    detail: {
      pluginId: result.id, version: result.version, target: target ?? 'plugins',
      digest: result.digest, previousDigest: result.previousDigest ?? null,
      signed: result.signature?.signed === true, verified: result.signature?.verified === true, signer: result.signature?.signer ?? null,
    },
  });
  if (json) {
    stdout.write(`${JSON.stringify({ ...result, destination: displayPath(root, result.destination), backup: result.backup ? displayPath(root, result.backup) : null }, null, 2)}\n`);
    return 0;
  }
  stdout.write(`installed ${result.id}@${result.version} (${result.digest.slice(0, 12)}) -> ${displayPath(root, result.destination)}`);
  stdout.write(result.backup ? ` (previous kept at ${displayPath(root, result.backup)})\n` : '\n');
  if (result.signature?.signed) stdout.write(`signature: verified${result.signature.signer ? ` (${result.signature.signer})` : ''}\n`);
  else stdout.write('signature: none (unsigned local package)\n');
  return 0;
}

async function runInstallBundle({ root, target, upgrade, args, publicKey = null, actor = null, auditState = null, json, stdout, stderr }) {
  const [source] = args;
  if (!source) {
    stderr.write('wh: install-bundle requires a bundle directory\n');
    return 2;
  }
  let key = null;
  if (publicKey) {
    const keyPath = isAbsolute(publicKey) ? publicKey : resolvePath(root, publicKey);
    key = await readFile(keyPath, 'utf8').catch(() => { throw new HarnessError('HARNESS_PLUGIN_FAILED', `cannot read public key ${displayPath(root, keyPath)}`); });
  }
  const result = await installBundle({
    bundleDir: isAbsolute(source) ? source : resolvePath(root, source),
    root, target: target ?? 'plugins', upgrade: upgrade === true,
    publicKey: key, actor: actor ?? 'local-operator',
  });
  if (auditState) {
    await recordInstallAudit({
      root, auditState, stderr, actor, pluginId: result.bundle, action: 'bundle-install',
      detail: { bundle: result.bundle, plugins: result.installed.map(item => ({ id: item.id, version: item.version, digest: item.digest })) },
    });
  }
  if (json) {
    stdout.write(`${JSON.stringify({ ...result, directory: displayPath(root, target ?? 'plugins') }, null, 2)}\n`);
    return 0;
  }
  stdout.write(`installed bundle ${result.bundle}: ${result.installed.length} plugin(s)\n`);
  for (const item of result.installed) stdout.write(`  ${pad(item.id, 24)}${pad(item.version, 10)}${item.digest.slice(0, 12)}${item.signed ? ' [signed]' : ''}\n`);
  stdout.write(`providers: ${result.providers.join(', ') || '-'}\n`);
  return 0;
}

async function runUninstall({ root, target, args, actor = null, auditState = null, json, stdout, stderr }) {
  const [id] = args;
  if (!id) {
    stderr.write('wh: uninstall requires a plugin id\n');
    return 2;
  }
  const result = await uninstallPlugin({ id, root, target: target ?? 'plugins', actor: actor ?? 'local-operator' });
  await recordInstallAudit({
    root, auditState, stderr, actor, pluginId: result.id, action: 'uninstall',
    detail: { pluginId: result.id, target: target ?? 'plugins', digest: result.digest ?? null },
  });
  if (json) {
    stdout.write(`${JSON.stringify({ ...result, backup: displayPath(root, result.backup) }, null, 2)}\n`);
    return 0;
  }
  stdout.write(`uninstalled ${result.id}; backup kept at ${displayPath(root, result.backup)}\n`);
  return 0;
}

async function runRollback({ root, target, backup, args, actor = null, auditState = null, json, stdout, stderr }) {
  const [id] = args;
  if (!id) {
    stderr.write('wh: rollback requires a plugin id\n');
    return 2;
  }
  const result = await rollbackPlugin({
    id, root, target: target ?? 'plugins',
    backup: backup ? (isAbsolute(backup) ? backup : resolvePath(root, backup)) : null,
    actor: actor ?? 'local-operator',
  });
  await recordInstallAudit({
    root, auditState, stderr, actor, pluginId: result.id, action: 'rollback',
    detail: { pluginId: result.id, target: target ?? 'plugins', digest: result.digest ?? null },
  });
  if (json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else stdout.write(`restored ${result.id} from ${displayPath(root, result.restoredFrom)}${result.displaced ? ` (displaced current installation to ${displayPath(root, result.displaced)})` : ''}\n`);
  return 0;
}

/**
 * Run the `wh` CLI.
 * @returns {Promise<number>} process exit code
 */
export async function runWh(argv = [],
  { stdout = process.stdout, stderr = process.stderr, root = process.cwd() } = {},
) {
  const { options, errors } = parseArgv(argv);
  if (errors.length) {
    for (const error of errors) stderr.write(`wh: ${error}\n`);
    stderr.write(`\n${USAGE}`);
    return 2;
  }
  if (options.help || options.command === 'help' || !options.command) {
    stdout.write(USAGE);
    return options.command && options.command !== 'help' ? 2 : 0;
  }
  const effectiveRoot = options.root ? (isAbsolute(options.root) ? options.root : resolvePath(root, options.root)) : root;
  const context = {
    compositionPath: options.composition, patchPaths: options.patches, state: options.state,
    kind: options.kind, workspace: options.workspace, limit: options.limit, root: effectiveRoot, json: options.json,
    target: options.target, backup: options.backup, upgrade: options.upgrade,
    journal: options.journal, publicKey: options.publicKey, actor: options.actor, auditState: options.auditState,
    args: options.args, stdout, stderr,
  };
  try {
    if (options.command === 'list' || options.command === 'plugins') return await runList(context);
    if (options.command === 'doctor') return await runDoctor(context);
    if (options.command === 'patch') return await runPatch(context);
    if (options.command === 'audit') return await runAudit(context);
    if (options.command === 'installed') return await runInstalled(context);
    if (options.command === 'install') return await runInstall(context);
    if (options.command === 'install-bundle') return await runInstallBundle(context);
    if (options.command === 'uninstall') return await runUninstall(context);
    if (options.command === 'rollback') return await runRollback(context);
    if (options.command === 'presets') return await runPresets(context);
    stderr.write(`wh: unknown command "${options.command}"\n\n${USAGE}`);
    return 2;
  } catch (error) {
    if (error instanceof HarnessError) {
      stderr.write(`wh: [${error.code}] ${error.message}\n`);
    } else {
      stderr.write(`wh: ${error?.message ?? error}\n`);
    }
    return 1;
  }
}
