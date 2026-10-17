// Native preflight and explicit lock stubs. These are not persistence E2E tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseLocalArguments, runLocalFactory } from '../scripts/workspace-omp-local.mjs';
import { inspectNativeWorkspace } from '../scripts/workspace-omp.mjs';
import { workspaceOmpPaths } from '../server/workspace-omp-runtime.mjs';
import { inspectNativeLock, localSessionPreflight } from '../server/workspace-omp-local-environment.mjs';

const configuration = { providerId: 'workspace-deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com',
  apiKey: 'explicit-synthetic-preflight-only', cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 }, remainingBudgetVerified: true };
async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/omp-environment-test-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(directory + '/out'); await fs.mkdir(directory + '/runtime');
  await fs.writeFile(directory + '/product.md', 'Synthetic public product; delivery pending.\n');
  return { directory, options: parseLocalArguments(['--input', directory + '/product.md', '--output-dir', directory + '/out', 'Read selected material.']) };
}
async function stubRun(t, body, { check = false, synthetic = false, version = '18.10.4' } = {}) {
  const f = await fixture(t), utils = f.directory + '/packages/pi-utils';
  await fs.mkdir(utils + '/src', { recursive: true });
  await fs.writeFile(utils + '/package.json', JSON.stringify({ name: '@oh-my-pi/pi-utils', version, type: 'module' }));
  await fs.writeFile(utils + '/src/file-lock.ts', body);
  const script = `import {runLocalFactorySession} from ${JSON.stringify(new URL('../scripts/workspace-omp-local.mjs', import.meta.url).href)};
    let requests=0; globalThis.fetch=async()=>{requests++;throw Error('PREFLIGHT_NETWORK_FORBIDDEN');};
    const result=await runLocalFactorySession(${JSON.stringify({ options: { ...f.options, check }, configuration,
      directory: f.directory + '/runtime', paths: { packageRoot: f.directory + '/packages/pi-coding-agent' },
      ...(synthetic ? { syntheticResponses: [{ text: 'Must not run.' }] } : {}) })}, {fetchImpl:globalThis.fetch});
    console.log(JSON.stringify({result,requests,calls:globalThis.probeCalls||null}));`;
  const child = spawn(workspaceOmpPaths({}).bun, ['--eval', script], {
    env: { PATH: process.env.PATH, HOME: f.directory, TMPDIR: f.directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  let exit; try { exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
  finally { clearTimeout(timer); }
  assert.equal(exit, 0, errors); const receipt = JSON.parse(output), { result, requests } = receipt;
  assert.equal(result.modelRequests, 0); assert.equal(requests, 0); assert.deepEqual(result.saved, []);
  assert.ok(!JSON.stringify(result).includes(configuration.apiKey)); assert.ok(!JSON.stringify(result).includes('sensitive-probe-path'));
  assert.deepEqual(await fs.readdir(f.directory + '/out'), []);
  assert.ok(!(await fs.readdir(f.directory + '/runtime')).some(name => name.startsWith('native-lock-')));
  if (!check) {
    assert.equal(result.status, 'stopped'); assert.equal(result.reason, 'LOCAL_NATIVE_LOCK_UNAVAILABLE');
    assert.deepEqual(result.toolReceipts, []); assert.equal(result.doNotAutomaticallyRetry, true);
    assert.equal(result.environment.nativeLock.ready, false);
    assert.deepEqual((await fs.readdir(f.directory + '/runtime')).sort(), ['sources', 'writes']);
  }
  return receipt;
}
const success = `globalThis.probeCalls=[]; export function tryAcquireFileLock(){
  globalThis.probeCalls.push('acquire');return {release(){globalThis.probeCalls.push('release');}};}`;

test('stub success must acquire, release, reacquire and release; configuration remains unverified', async t => {
  const { result, calls } = await stubRun(t, success, { check: true });
  assert.deepEqual(calls, ['acquire', 'release', 'acquire', 'release']);
  assert.equal(result.status, 'configured-unverified'); assert.equal(result.preflightReady, true);
  assert.equal(result.persistentSessionVerified, false); assert.equal(result.paidModelVerified, false);
  assert.deepEqual(result.blockers, []); assert.equal(result.plugins.discovered.length, 14);
  assert.deepEqual(result.plugins.enabled, ['workspace-local-materials']);
});
test('native EPERM stops configured execution before Session import, fetch or output', async t => {
  const { result } = await stubRun(t, "export function tryAcquireFileLock(){throw Error('sensitive-probe-path: Operation not permitted (os error 1)');}");
  assert.equal(result.environment.nativeLock.errno, 1); assert.equal(result.environment.nativeLock.phase, 'acquire');
});
test('synthetic responses cannot skip a failing native lock preflight', async t => {
  await stubRun(t, 'export function tryAcquireFileLock(){return null;}', { synthetic: true });
});
test('an unacquired first lease is refused with no alternate lock', async t => {
  const { result } = await stubRun(t, 'export function tryAcquireFileLock(){return null;}');
  assert.equal(result.environment.nativeLock.errno, null); assert.equal(result.environment.nativeLock.phase, 'acquire');
});
test('reacquisition failure is refused after releasing the first lease', async t => {
  const { result, calls } = await stubRun(t, `globalThis.probeCalls=[];let n=0;export function tryAcquireFileLock(){
    globalThis.probeCalls.push('acquire');return ++n===1?{release(){globalThis.probeCalls.push('release');}}:null;}`);
  assert.equal(result.environment.nativeLock.phase, 'reacquire'); assert.deepEqual(calls, ['acquire', 'release', 'acquire']);
});
test('failed lease release is fail-closed even when final cleanup can release it', async t => {
  const { result } = await stubRun(t, `let n=0;export function tryAcquireFileLock(){return {release(){if(++n===1)throw Error('sensitive-probe-path');}};}`);
  assert.equal(result.environment.nativeLock.phase, 'release');
});
test('a failure releasing the second lease is also fail-closed', async t => {
  const { result } = await stubRun(t, `let n=0;export function tryAcquireFileLock(){return {release(){if(++n===2)throw Error('sensitive-probe-path');}};}`);
  assert.equal(result.environment.nativeLock.phase, 'release-reacquired');
});
test('an unreviewed lock package version is refused before lock code loads', async t => {
  const { result, calls } = await stubRun(t, "throw Error('sensitive-probe-path');", { version: '0.0.0' });
  assert.equal(result.environment.nativeLock.phase, 'load'); assert.equal(calls, null);
});
test('model presence gates stay separate from native readiness and never expose a key', () => {
  const ready = { ready: true }, blocked = { ready: false, reason: 'LOCAL_NATIVE_LOCK_UNAVAILABLE' };
  for (const [config, status, blocker] of [
    [configuration, 'configured-unverified', null],
    [{ ...configuration, apiKey: '' }, 'model-unconfigured', 'LOCAL_MODEL_COST_AND_BUDGET_REQUIRED'],
    [{ ...configuration, cost: null }, 'model-unconfigured', 'LOCAL_MODEL_COST_AND_BUDGET_REQUIRED'],
    [{ ...configuration, remainingBudgetVerified: false }, 'model-unconfigured', 'LOCAL_MODEL_COST_AND_BUDGET_REQUIRED'],
    [{ ...configuration, model: 'unsupported' }, 'provider-unsupported', 'LOCAL_PINNED_DEEPSEEK_REQUIRED'],
  ]) {
    const a = localSessionPreflight(config, ready), b = localSessionPreflight(config, blocked);
    assert.equal(a.modelStatus, status); assert.equal(a.status, status); assert.equal(a.preflightReady, !blocker);
    assert.deepEqual(a.blockers, blocker ? [blocker] : []); assert.equal(b.status, 'environment-unavailable');
    assert.equal(b.preflightReady, false); assert.equal(b.modelStatus, status);
    assert.equal(b.persistentSessionVerified, false); assert.ok(!JSON.stringify(b).includes(configuration.apiKey));
  }
});
test('actual fixed native probe preserves an existing saved Session byte-for-byte', { timeout: 15000 }, async t => {
  const f = await fixture(t), session = 'Preserve this existing synthetic Session byte-for-byte.\n';
  await fs.writeFile(f.options.sessionFile, session, { mode: 0o600 });
  const result = await runLocalFactory({ options: { ...f.options, check: true }, configuration });
  assert.equal(result.modelStatus, 'configured-unverified'); assert.equal(result.modelRequests, 0);
  assert.equal(result.environment.nativeLock.implementation, 'omp:18.10.4:pi-utils/file-lock');
  assert.equal(result.preflightReady, result.environment.nativeLock.ready);
  assert.equal(result.status, result.preflightReady ? 'configured-unverified' : 'environment-unavailable');
  assert.deepEqual(result.blockers, result.preflightReady ? [] : ['LOCAL_NATIVE_LOCK_UNAVAILABLE']);
  assert.equal(result.persistentSessionVerified, false); assert.deepEqual(result.saved, []);
  assert.equal(result.localSession.exists, true); assert.equal(result.localSession.resumed, false);
  assert.equal(await fs.readFile(f.options.sessionFile, 'utf8'), session);
  assert.deepEqual(await fs.readdir(f.directory + '/out'), ['factory-session.jsonl']);
  assert.ok(!JSON.stringify(result).includes(configuration.apiKey));
});
test('default check retains plugin discovery when model configuration is invalid', { timeout: 15000 }, async () => {
  const result = await inspectNativeWorkspace({ PI_PROVIDER: 'unsupported', DEEPSEEK_API_KEY: configuration.apiKey });
  assert.equal(result.status, 'offline-preview-ready'); assert.equal(result.plugins.length, 14);
  assert.equal(result.localSessionPrerequisites.modelStatus, 'configuration-invalid');
  assert.equal(result.localSessionPrerequisites.preflightReady, false); assert.equal(result.modelRequests, 0);
  assert.ok(!JSON.stringify(result).includes(configuration.apiKey));
});
test('default check sanitizes probe-directory cleanup errors and retains plugin discovery', { timeout: 15000 }, async t => {
  const original = fs.rm, directories = [];
  t.after(async () => { fs.rm = original; for (const directory of directories) await original(directory, { recursive: true, force: true }); });
  t.mock.method(fs, 'rm', async (directory, options) => {
    if (path.basename(directory).startsWith('workspace-omp-preflight-')) {
      directories.push(directory); throw Error('sensitive-probe-path: cleanup failed');
    }
    return original(directory, options);
  });
  const result = await inspectNativeWorkspace({});
  assert.equal(result.status, 'offline-preview-ready'); assert.equal(result.plugins.length, 14);
  assert.equal(result.localSessionPrerequisites.environment.nativeLock.phase, 'cleanup-directory');
  assert.equal(result.localSessionPrerequisites.status, 'environment-unavailable');
  assert.equal(result.localSessionPrerequisites.preflightReady, false);
  assert.ok(!JSON.stringify(result).includes('sensitive-probe-path'));
});
test('a probe child that cannot start returns a sanitized unavailable receipt', async () => {
  const result = await inspectNativeLock({ bun: '/nonexistent/preflight-bun', packageRoot: '/sensitive-probe-path' });
  assert.equal(result.ready, false); assert.equal(result.phase, 'probe-process');
  assert.ok(!JSON.stringify(result).includes('sensitive-probe-path'));
});
test('malformed or oversized probe output cannot report native readiness', async t => {
  const f = await fixture(t);
  for (const [name, body] of [
    ['malformed', "console.log('sensitive-probe-path');"],
    ['oversized', "console.log(JSON.stringify({ready:true,implementation:'omp:18.10.4:pi-utils/file-lock',extra:'x'.repeat(5000)}));"],
  ]) {
    const bun = f.directory + '/' + name;
    await fs.writeFile(bun, '#!' + process.execPath + '\n' + body, { mode: 0o700 });
    const result = await inspectNativeLock({ bun, packageRoot: '/sensitive-probe-path' });
    assert.equal(result.ready, false); assert.equal(result.phase, 'probe-process');
    assert.ok(!JSON.stringify(result).includes('sensitive-probe-path'));
  }
});
test('a probe child that times out is stopped and cannot report readiness', { timeout: 15000 }, async t => {
  const f = await fixture(t), bun = f.directory + '/waiting-probe';
  await fs.writeFile(bun, '#!' + process.execPath + '\nsetInterval(()=>{},1000);', { mode: 0o700 });
  const result = await inspectNativeLock({ bun, packageRoot: '/sensitive-probe-path' });
  assert.equal(result.ready, false); assert.equal(result.phase, 'probe-process');
});
