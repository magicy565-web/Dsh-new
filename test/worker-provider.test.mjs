import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWorkerProvider, createNativeWorkerConnectorAdapter, loadNativeWorkerModules } from '../server/worker-provider.mjs';

const sourceRoot = process.env.DSH_TEST_SOURCE_ROOT || fileURLToPath(new URL('../../muse-development/deepseek-harness-enterprise/', import.meta.url));
const packagePath = path.join(sourceRoot, 'packages/experimental/muse-worker/package.json');
const hasNative = existsSync(path.join(sourceRoot, 'packages/experimental/muse-worker/lib/types/multi-engine.js'));
const principal = { role: 'worker', subject: 'explicit-fixture-identity', workerId: 'fixture-worker', ownerId: 'fixture-owner' };
function catalog(statePath) {
  return { operatorId: 'fixture-operator', statePath, leaseMs: 30_000, requestMaxBytes: 8192, responseMaxBytes: 16384,
    workflows: { fixture_research: { kind: 'public_research', query: 'Explicit public fixture question', acceptance: 'Fixture sources only',
      budgetCredits: 10, resultMaxBytes: 1024, resultTaskKey: 'research', tasks: {
        research: { query: 'Explicit public subtask fixture', acceptance: 'Provide fixture citation', requiredCapability: 'research',
          ceilingCredits: 3, maxAttempts: 2, minimumSources: 1, dependencies: [] },
      } } },
    operatorEnrollments: [{ workerId: principal.workerId, ownerId: principal.ownerId, verifiedCapabilities: ['research'],
      allowedWorkflowKeys: ['fixture_research'], allowedOperatorIds: ['fixture-operator'], maxConcurrency: 1, priceCredits: 3, maxAvailabilityMs: 120_000 }],
  };
}
async function nativeFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-worker-fixture-'));
  const configuration = catalog(path.join(dir, 'worker-state.json'));
  // Identity labels belong only to this test. Production supplies its own verifier.
  const verifyIdentity = async request => request.headers.get('authorization') === 'Fixture verified' ? principal : null;
  const options = { enabled: true, packagePath, configuration, verifyIdentity };
  const provider = createWorkerProvider(options);
  t.after(async () => { await provider.close(); await rm(dir, { recursive: true, force: true }); });
  return { provider, options, dir };
}
function request(route, body, authorized = true) {
  return new Request(`https://fixture.invalid/v1/worker/${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { authorization: 'Fixture verified' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function register(provider) {
  const response = await provider.gateway(request('register', { capabilities: ['research'], priceCredits: 3,
    concurrency: 1, availableUntil: Date.now() + 60_000 }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true });
}
const submission = () => ({ taskKey: 'fixture_research', jobId: 'fixture-job', idempotencyKey: 'fixture-request', deadlineAt: Date.now() + 60_000 });

test('fixture: default worker adapter is disabled and performs no module loading or external action', async () => {
  let loaded = false;
  const provider = createWorkerProvider({ loadModules() { loaded = true; } });
  assert.equal(provider.status().status, 'setup_required');
  await assert.rejects(provider.submit(submission()), { code: 'WORKER_SETUP_REQUIRED' });
  assert.equal((await provider.gateway(request('claim', { requestId: 'fixture' }))).status, 503);
  assert.equal(loaded, false); await provider.close();
});

test('fixture: enabling workers requires reviewed catalog and host identity verifier', () => {
  for (const options of [{}, { configuration: catalog('/tmp/fixture-only.json') },
    { configuration: { ...catalog('/tmp/fixture-only.json'), token: 'do-not-admit' }, verifyIdentity: async () => principal }]) {
    assert.throws(() => createWorkerProvider({ enabled: true, packagePath: '/fixture/package.json', ...options }), { code: 'WORKER_SETUP' });
  }
});

test('fixture: connector binds approved resource and durable idempotency without forwarding credentials', async () => {
  const calls = [];
  const provider = { configured: true,
    async submit(value) { calls.push(value); return { state: 'queued' }; },
    async get(id) { return { jobId: id, state: 'leased' }; },
    async cancel(id) { return { jobId: id, state: 'cancel_requested' }; },
    async result(id) { return { jobId: id, state: 'succeeded', independentlyVerified: false }; },
  };
  const adapter = createNativeWorkerConnectorAdapter({ workerProvider: provider });
  const payload = { taskKey: 'fixture_research', jobId: 'fixture-job', deadlineAt: Date.now() + 60_000 };
  await adapter.execute({ action: 'submit', resource: payload.taskKey, payload, idempotencyKey: 'durable-run', credentials: { PRIVATE: 'SECRET' } });
  assert.deepEqual(calls, [{ ...payload, idempotencyKey: 'durable-run' }]);
  await assert.rejects(adapter.execute({ action: 'submit', resource: 'wrong', payload, idempotencyKey: 'durable-run' }), { code: 'WORKER_UNAPPROVED_TASK' });
  await assert.rejects(adapter.execute({ action: 'submit', resource: payload.taskKey, payload: { ...payload, query: 'private prompt' }, idempotencyKey: 'durable-run' }), { code: 'WORKER_UNAPPROVED_TASK' });
  await assert.rejects(adapter.execute({ action: 'cancel', resource: 'fixture-job', payload: { jobId: 'different' } }), { code: 'WORKER_INVALID' });
  await assert.rejects(adapter.execute({ action: 'status', resource: 'fixture-job', signal: AbortSignal.abort() }), { code: 'CANCELLED' });
  assert.deepEqual(await adapter.execute({ action: 'cancel', resource: 'fixture-job' }), { jobId: 'fixture-job', state: 'cancel_requested' });
});

test('real native built exports with local fixtures: approved tasks, gateway identity, restart and untrusted results', { skip: !hasNative }, async t => {
  const { provider, options } = await nativeFixture(t);
  const native = await loadNativeWorkerModules(packagePath);
  assert.equal(typeof native.MultiWorkerEngine.open, 'function');
  assert.equal((await provider.gateway(request('claim', { requestId: 'fixture' }, false))).status, 401);
  await register(provider);
  await assert.rejects(provider.submit({ ...submission(), query: 'UNAPPROVED PRIVATE TEXT' }), { code: 'WORKER_UNAPPROVED_TASK' });
  const approved = submission();
  assert.equal((await provider.submit(approved)).state, 'leased');
  const response = await provider.gateway(request('claim', { requestId: 'fixture-claim' }));
  assert.equal(response.status, 200); const { attempt } = await response.json();
  assert.equal(attempt.query, 'Explicit public subtask fixture');
  await provider.close();
  const restarted = createWorkerProvider(options); t.after(() => restarted.close());
  const replay = await restarted.gateway(request('claim', { requestId: 'fixture-claim' }));
  assert.equal((await replay.json()).attempt.attemptId, attempt.attemptId);
  const output = { summary: 'Unverified fixture finding', sources: ['https://example.com/fixture'] };
  const completed = await restarted.gateway(request(`attempts/${attempt.attemptId}/complete`, { result: output }));
  assert.equal(completed.status, 200);
  const result = await restarted.result(approved.jobId);
  assert.equal(result.state, 'succeeded'); assert.equal(result.independentlyVerified, false);
  assert.deepEqual(result.result, output);
  assert.equal((await restarted.submit(approved)).state, 'succeeded');
  const snapshot = JSON.parse(await readFile(options.configuration.statePath, 'utf8'));
  assert.equal(snapshot.jobs[approved.jobId].budget.chargedCredits, 3);
  await restarted.close();
});

test('real native built exports with local fixtures: cancellation remains requested until worker stop acknowledgment', { skip: !hasNative }, async t => {
  const { provider } = await nativeFixture(t);
  await register(provider); const approved = submission(); await provider.submit(approved);
  const { attempt } = await (await provider.gateway(request('claim', { requestId: 'fixture-claim' }))).json();
  assert.equal((await provider.cancel(approved.jobId)).state, 'cancel_requested');
  const rejected = await provider.gateway(request(`attempts/${attempt.attemptId}/complete`, { result: { summary: 'late', sources: ['https://example.com'] } }));
  assert.equal(rejected.status, 409);
  const stopped = await provider.gateway(request(`attempts/${attempt.attemptId}/cancel-ack`, {}));
  assert.equal(stopped.status, 200); assert.equal((await provider.get(approved.jobId)).state, 'cancelled');
});

test('fixture: shutdown joins lazy engine startup instead of abandoning its ownership lock', async () => {
  let resolveOpen; let closes = 0;
  const provider = createWorkerProvider({ enabled: true, packagePath: '/fixture/package.json', configuration: catalog('/tmp/fixture-state.json'),
    verifyIdentity: async () => principal,
    loadModules: async () => ({ MultiWorkerEngine: { open: () => new Promise(resolve => { resolveOpen = resolve; }) }, createMultiWorkerGateway: () => async () => new Response('{}') }),
  });
  const pending = provider.get('fixture-job');
  await new Promise(resolve => setImmediate(resolve));
  const closing = provider.close(); resolveOpen({ async close() { closes++; } });
  await closing; await assert.rejects(pending, { code: 'WORKER_CLOSED' }); assert.equal(closes, 1);
});
