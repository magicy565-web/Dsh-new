#!/usr/bin/env node
// Workspace Harness entry: boot a composition (default harness.local.yml) or an
// agent preset (presets/<name>.yml composed over its base) and serve.
import { createHarness } from './packages/harness-kernel/src/app.mjs';
import { composePreset, loadPreset } from './packages/harness-kernel/src/presets.mjs';

const USAGE = `Usage: node harness.mjs [options]

Options:
  -c, --composition <file>  Composition file (default: harness.local.yml).
  -p, --preset <name>       Agent preset name from presets/ (composed over its base).
      --root <dir>          Workspace root for plugin resolution (default: cwd).
  -h, --help                Print this text.

--composition and --preset are mutually exclusive.
`;

function parseArgs(argv) {
  const options = { composition: null, preset: null, root: process.cwd(), help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--composition' || argument === '-c') options.composition = argv[++index];
    else if (argument.startsWith('--composition=')) options.composition = argument.slice('--composition='.length);
    else if (argument === '--preset' || argument === '-p') options.preset = argv[++index];
    else if (argument.startsWith('--preset=')) options.preset = argument.slice('--preset='.length);
    else if (argument === '--root' || argument === '-r') options.root = argv[++index];
    else if (argument.startsWith('--root=')) options.root = argument.slice('--root='.length);
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.preset !== null && options.composition !== null) throw new Error('--composition and --preset are mutually exclusive.');
  options.composition ??= options.preset === null ? 'harness.local.yml' : null;
  if (!options.composition && !options.preset) throw new Error('--composition requires a file path.');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  let harness;
  try {
    if (options.preset) {
      const preset = await loadPreset(options.preset, { root: options.root });
      const composed = await composePreset(preset, { root: options.root });
      harness = await createHarness({
        composition: composed.document,
        preset: {
          name: preset.name, title: preset.title, persona: preset.persona,
          tools: composed.tools, denyTools: composed.denyTools, skills: composed.skills, model: composed.model,
        },
        root: options.root,
        logger: console,
      });
    } else {
      harness = await createHarness({
        compositionPath: options.composition,
        root: options.root,
        logger: console,
      });
    }
  } catch (error) {
    const code = error?.code ? `[${error.code}] ` : '';
    console.error(`harness failed to load: ${code}${error?.message ?? error}`);
    process.exitCode = 1;
    return;
  }

  const shutdown = async signal => {
    console.log(`\n${signal} received, stopping harness...`);
    try {
      await harness.stop();
      console.log('harness stopped cleanly');
      process.exitCode = 0;
    } catch (error) {
      console.error(`harness failed to stop cleanly: ${error?.message ?? error}`);
      process.exitCode = 1;
    }
  };

  let started;
  try {
    started = await harness.start();
  } catch (error) {
    const code = error?.code ? `[${error.code}] ` : '';
    console.error(`harness failed to start: ${code}${error?.message ?? error}`);
    await harness.stop();
    process.exitCode = 1;
    return;
  }

  const health = harness.healthz();
  if (harness.preset) {
    console.log(`preset "${harness.preset.name}" (${harness.preset.title})`);
    console.log(`  tools: ${harness.preset.tools.join(', ') || '-'}`);
    console.log(`  denyTools: ${harness.preset.denyTools.join(', ') || '-'}`);
    console.log(`  skills: ${harness.preset.skills.join(', ') || '-'}`);
  }
  console.log(`harness "${harness.composition.name}" listening on ${started.address.url}`);
  console.log(`health: ${health.status}`);
  for (const plugin of health.plugins) console.log(`  plugin ${plugin.id}: ${plugin.status}${plugin.error ? ` (${plugin.error})` : ''}`);
  for (const check of health.checks) console.log(`  check ${check.name}: ${check.status}${check.detail ? ` (${check.detail})` : ''}`);
  console.log('press Ctrl+C to stop');

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
