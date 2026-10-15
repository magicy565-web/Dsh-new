import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const repository = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(repository, 'packages/workspace-market-validation');
const bun = path.join(repository, 'support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun');
const ompRoot = path.join(repository, 'support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent');
const facts = [];
async function command(executable, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (timedOut) reject(Error('Isolated SDK test timed out: ' + output.slice(-2000))); else resolve({ code, output }); });
  });
}
async function setup(t) {
  const directory = await fs.mkdtemp('/tmp/market-validation-package-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const packageDir = path.join(directory, 'copied-package'), agentDir = path.join(directory, 'agent');
  await fs.cp(source, packageDir, { recursive: true }); await fs.mkdir(agentDir);
  assert.equal(await fs.stat(packageDir + '/node_modules').then(() => true).catch(() => false), false);
  const manifest = JSON.parse(await fs.readFile(packageDir + '/package.json'));
  assert.equal(manifest.scripts, undefined); assert.equal(manifest.dependencies, undefined);
  await fs.writeFile(agentDir + '/config.yml', 'startup:\n  checkUpdate: false\n  setupWizard: false\ntelemetry:\n  otlpExportEnabled: false\nretry:\n  enabled: false\n  modelFallback: false\ncompaction:\n  enabled: false\n  midTurnEnabled: false\neval:\n  py: false\n  autoProvision: false\n');
  const env = { PATH: path.dirname(bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1', PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb', MARKET_PLAN_OMP_ROOT: ompRoot };
  return { directory, packageDir, agentDir, env };
}
async function record(value) {
  facts.push(value);
  if (process.env.MARKET_VALIDATION_PACKAGE_FACTS) await fs.writeFile(process.env.MARKET_VALIDATION_PACKAGE_FACTS, JSON.stringify({ tests: facts }, null, 2) + '\n');
}
for (const engine of ['pi', 'omp']) test(`actual official ${engine} SDK runs composable plan tools with finite keyless callbacks`, { timeout: 60000 }, async t => {
  const p = await setup(t), fixture = path.join(p.directory, 'sdk-fixture.mjs'), config = path.join(p.directory, 'config.json');
  await fs.copyFile(new URL('./fixtures/market-validation-sdk.mjs', import.meta.url), fixture);
  await fs.copyFile(new URL('./fixtures/market-validation-plan-data.mjs', import.meta.url), path.join(p.directory, 'market-validation-plan-data.mjs'));
  const evidenceFile = path.join(p.directory, 'evidence.json');
  await fs.writeFile(config, JSON.stringify({ ...p, engine, ompRoot, evidenceFile,
    piSdk: import.meta.resolve('@earendil-works/pi-coding-agent'), piAi: import.meta.resolve('@earendil-works/pi-ai'), piFaux: import.meta.resolve('@earendil-works/pi-ai/providers/faux') }));
  const result = await command(engine === 'omp' ? bun : process.execPath, [fixture, config], p.env, p.directory);
  assert.equal(result.code, 0, result.output);
  const evidence = JSON.parse(await fs.readFile(evidenceFile)); assert.equal(evidence.saves, 3); assert.equal(evidence.fetchAttempts, 0);
  assert.equal(evidence.zeroToolClarificationTurn, true); await record(evidence);
});
test('actual OMP plugin link loads manifest and Skill alongside native tools, with safe disable and uninstall', { timeout: 180000 }, async t => {
  const p = await setup(t), fixture = path.join(p.directory, 'cli-fixture.mjs');
  await fs.copyFile(new URL('./fixtures/market-validation-cli.mjs', import.meta.url), fixture);
  const invoke = async (args, extra = {}) => {
    const result = await command(bun, [path.join(ompRoot, 'dist/cli.js'), ...args], { ...p.env, ...extra }, p.directory);
    assert.equal(result.code, 0, result.output); return result.output;
  };
  const verify = async absent => {
    const output = await invoke(['--no-title', '--no-prewalk', '--no-lsp', '--no-rules', '--no-session', '--print', '-e', fixture,
      '--tools', ['read', 'bash', 'market_other_plugin', ...absent ? [] : ['workspace_market_validation_product', 'workspace_market_validation_plan_save', 'workspace_market_monitor_request', 'workspace_market_monitor_status', 'workspace_market_monitor_control_request']].join(','),
      '--model', 'market-plan-cli-faux/finite', 'Run only the finite synthetic CLI test.'], { MARKET_PLAN_EXPECT: absent ? 'absent' : 'present' });
    assert.match(output, absent ? /MARKET_PLAN_ABSENT_VERIFIED/ : /MARKET_PLAN_MANIFEST_SKILL_UNCONFIGURED_VERIFIED/);
  };
  const name = '@workspace-agent/pi-market-validation';
  await invoke(['plugin', 'link', p.packageDir]); await verify(false);
  await invoke(['plugin', 'disable', name]); await verify(true);
  await invoke(['plugin', 'enable', name]); await verify(false);
  await invoke(['plugin', 'uninstall', name]); await verify(true);
  await fs.access(p.packageDir + '/package.json');
  await record({ engine: 'omp-cli', version: '18.10.4', actualManifestAndSkill: true, copiedOutsideRepository: true,
    nativeToolsAndOtherPlugin: true, unconfiguredNoAccess: true, disabledThenEnabled: true, uninstalled: true, realModelCalls: 0, paidModelCalls: 0 });
});
