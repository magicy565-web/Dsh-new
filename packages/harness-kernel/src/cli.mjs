// `wh` CLI: list a composition without mounting it, or doctor it (load + health, no serve).
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { HarnessError } from '../../harness-contracts/src/index.mjs';
import { createHarness } from './app.mjs';
import { displayPath, readComposition, resolveRows } from './resolve.mjs';
import { applyPatches, readPatch } from './patch.mjs';
import { composePreset, listPresets, loadPreset, presetSummary } from './presets.mjs';

const USAGE = `Usage: wh <command> [options]

Commands:
  list      Resolve and print composition rows (entry, status, requires/provides). No plugin is mounted.
  plugins   Alias of list; both accept --patch layers.
  doctor    Load the composition (mount plugins, no HTTP serving), report health, then dispose.
  presets   Agent presets: \`wh presets list\` or \`wh presets show <name>\`.
  help      Print this text.

Options:
  -c, --composition <file>  Composition file (default: harness.local.yml, relative to --root).
  -p, --patch <file>        Composition patch layer; repeatable, applied in order.
      --root <dir>          Workspace root used by the plugin-name resolution rules (default: cwd).
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
    } else if (options.command === 'presets') {
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
    const document = {
      name: harness.composition.name,
      file: displayPath(root, harness.composition.file),
      server: harness.composition.server,
      status: health.status,
      plugins: health.plugins,
      checks: health.checks,
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
  const context = { compositionPath: options.composition, patchPaths: options.patches, root: effectiveRoot, json: options.json, args: options.args, stdout, stderr };
  try {
    if (options.command === 'list' || options.command === 'plugins') return await runList(context);
    if (options.command === 'doctor') return await runDoctor(context);
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
