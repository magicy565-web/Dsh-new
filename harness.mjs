#!/usr/bin/env node
// Workspace Harness entry: boot a composition (default harness.local.yml) and serve.
import { createHarness } from './packages/harness-kernel/src/app.mjs';

const USAGE = `Usage: node harness.mjs [options]

Options:
  -c, --composition <file>  Composition file (default: harness.local.yml).
      --root <dir>          Workspace root for plugin resolution (default: cwd).
  -h, --help                Print this text.
`;

function parseArgs(argv) {
  const options = { composition: 'harness.local.yml', root: process.cwd(), help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--composition' || argument === '-c') options.composition = argv[++index];
    else if (argument.startsWith('--composition=')) options.composition = argument.slice('--composition='.length);
    else if (argument === '--root' || argument === '-r') options.root = argv[++index];
    else if (argument.startsWith('--root=')) options.root = argument.slice('--root='.length);
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.composition) throw new Error('--composition requires a file path.');
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
    harness = await createHarness({
      compositionPath: options.composition,
      root: options.root,
      logger: console,
    });
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
  console.log(`harness "${harness.composition.name}" listening on ${started.address.url}`);
  console.log(`health: ${health.status}`);
  for (const plugin of health.plugins) console.log(`  plugin ${plugin.id}: ${plugin.status}${plugin.error ? ` (${plugin.error})` : ''}`);
  for (const check of health.checks) console.log(`  check ${check.name}: ${check.status}${check.detail ? ` (${check.detail})` : ''}`);
  console.log('press Ctrl+C to stop');

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
