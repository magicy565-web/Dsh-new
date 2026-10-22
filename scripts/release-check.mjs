// Release gate: run every verification this product has, in one command.
//
//   node scripts/release-check.mjs [--json <file>] [--skip-tests] [--skip-smokes]
//
// Steps run sequentially with inherited stdio (so their own output stays
// visible); the gate only records exit codes and durations. A stale
// workspace.lock left by a killed process is cleared first, but only after
// proving its owner pid is gone.
import { spawn } from 'node:child_process';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SMOKES = Object.freeze([
  'chat-smoke.mjs',
  'runner-smoke.mjs',
  'guarded-smoke.mjs',
  'schedules-smoke.mjs',
  'ops-smoke.mjs',
  'access-smoke.mjs',
  'factory-smoke.mjs',
  'procurement-smoke.mjs',
  'quotes-smoke.mjs',
  'purchases-smoke.mjs',
  'market-smoke.mjs',
  'inquiry-recovery-smoke.mjs',
  'harness-review-smoke.mjs',
  'files-smoke.mjs',
  'walkthrough.mjs',
  'quote-tool-smoke.mjs',
  'purchase-tool-smoke.mjs',
]);

async function walk(directory, pattern, found = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return found; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, pattern, found);
    else if (entry.isFile() && pattern.test(entry.name)) found.push(full);
  }
  return found;
}

/** Every *.test.mjs the repository ships (plugins, scripts, kernel). */
export async function discoverTests(root = ROOT) {
  const groups = [
    await walk(path.join(root, 'plugins'), /\.test\.mjs$/u),
    await walk(path.join(root, 'scripts'), /\.test\.mjs$/u),
    await walk(path.join(root, 'packages', 'harness-kernel', 'test'), /\.test\.mjs$/u),
  ];
  return groups.flat().map(file => path.relative(root, file).split(path.sep).join('/')).sort();
}

/** The ordered plan the gate will execute. */
export async function buildSteps(root = ROOT, { skipTests = false, skipSmokes = false } = {}) {
  const steps = [];
  if (!skipTests) {
    const tests = await discoverTests(root);
    if (tests.length === 0) throw new Error('No *.test.mjs files were found; refusing to pass a release gate.');
    // One step per file: a hanging file fails its own step instead of stalling the gate.
    for (const file of tests) steps.push({ name: `unit ${file}`, args: ['--test', file] });
  }
  if (!skipSmokes) {
    for (const smoke of SMOKES) {
      const file = path.join(root, 'scripts', smoke);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) steps.push({ name: `smoke ${smoke}`, args: [path.join('scripts', smoke)] });
    }
  }
  steps.push({ name: 'doctor', args: [path.join('packages', 'harness-kernel', 'bin', 'wh.mjs'), 'doctor', '-c', 'harness.local.yml'] });
  return steps;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Clear a lock whose owner is provably gone; never touch a live owner's lock. */
export async function clearStaleLock(directory) {
  const lockPath = path.join(directory, 'workspace.lock');
  let raw;
  try { raw = await readFile(lockPath, 'utf8'); }
  catch { return { cleared: false, reason: 'absent' }; }
  let owner = null;
  try { owner = JSON.parse(raw).pid; }
  catch { return { cleared: false, reason: 'unreadable' }; }
  if (alive(owner)) return { cleared: false, reason: 'owner-alive', owner };
  await unlink(lockPath).catch(() => {});
  return { cleared: true, owner };
}

/** A hung step must fail the gate, never hang it. */
export const STEP_TIMEOUTS = Object.freeze({ unit: 180_000, smoke: 240_000, doctor: 120_000 });

export function timeoutFor(name) {
  if (name.startsWith('smoke ')) return STEP_TIMEOUTS.smoke;
  if (name.startsWith('unit ')) return STEP_TIMEOUTS.unit;
  if (name === 'doctor') return STEP_TIMEOUTS.doctor;
  return STEP_TIMEOUTS.tests;
}

function runStep(node, args, cwd, timeoutMs) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const child = spawn(node, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const finish = result => { clearTimeout(timer); resolve({ ...result, ms: Date.now() - startedAt }); };
    child.on('error', error => finish({ ok: false, error: error.message }));
    child.on('exit', code => finish(timedOut ? { ok: false, code, timedOut: true } : { ok: code === 0, code }));
  });
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonPath = argValue(argv, '--json');
  const skipTests = argv.includes('--skip-tests');
  const skipSmokes = argv.includes('--skip-smokes');
  const node = process.execPath;

  const lock = await clearStaleLock(path.join(ROOT, '.harness-data'));
  if (lock.cleared) console.warn(`release-check: cleared stale workspace.lock (owner pid ${lock.owner} is gone)`);

  const steps = await buildSteps(ROOT, { skipTests, skipSmokes });
  const startedAt = new Date().toISOString();
  const report = { ok: true, startedAt, finishedAt: null, node: process.version, steps: [] };

  for (const step of steps) {
    console.log(`\n=== ${step.name} ===`);
    const result = await runStep(node, step.args, ROOT, timeoutFor(step.name));
    report.steps.push({ name: step.name, args: step.args, ...result });
    if (!result.ok) report.ok = false;
    console.log(`--- ${step.name}: ${result.ok ? 'ok' : 'FAILED'} (${Math.round(result.ms / 1000)}s)`);
  }

  report.finishedAt = new Date().toISOString();
  if (jsonPath) await writeFile(path.resolve(jsonPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failed = report.steps.filter(step => !step.ok);
  console.log(`\nrelease gate: ${report.steps.length - failed.length}/${report.steps.length} steps passed`);
  if (failed.length) {
    for (const step of failed) console.log(`  FAILED: ${step.name}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(`release-check: ${error.message}`);
    process.exitCode = 1;
  });
}
