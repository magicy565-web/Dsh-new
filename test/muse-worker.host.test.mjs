import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createMuseWorkerHost } from '../server/muse-worker-host.mjs';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';

const key = 'local-muse-host-fixture-credential_123456789';
const dotKey = 'local-dot-host-fixture-credential_123456789';
const hash = value => createHash('sha256').update(value).digest('hex');
const config = { workerId: 'muse-shared-host', ownerId: 'operator', tokenDigest: hash(key),
  enabled: true, scopeReviewed: true, externalBudgetVerified: true };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Explicit in-memory host services. These exercise real transport/bridge/desk
// code but do not prove disk durability or production Cordis compatibility.
function services() {
  let state = { artifacts: [], activity: [] }, queue = Promise.resolve();
  const store = {
    read: () => structuredClone(state),
    update(callback) {
      const task = queue.then(async () => {
        const next = structuredClone(state), result = await callback(next);
        state = next;
        return structuredClone(result);
      });
      queue = task.catch(() => {});
      return task;
    },
    close() { throw Error('The Muse mount must not close the parent store.'); },
  };
  const bytes = new Map();
  const artifacts = {
    async create(input, admission) {
      admission.check(store.read());
      const artifact = { id: randomUUID(), filename: input.filename, metadata: input.metadata };
      await store.update(current => { admission.check(current); current.artifacts.push(artifact); });
      bytes.set(artifact.id, input.base64 === undefined ? Buffer.from(input.content, 'utf8') : Buffer.from(input.base64, 'base64'));
      return { artifact };
    },
    async download(id) { return { bytes: bytes.get(id) }; },
    close() { throw Error('The Muse mount must not close parent artifacts.'); },
  };
  return { store, artifacts };
}
function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req, maximum) {
  const chunks = [];
  let count = 0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > maximum) throw Object.assign(Error('Bound exceeded.'), { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function setup(t, overrides = {}) {
  const parent = services();
  const options = { ...parent, config, readBody, respond, ...overrides };
  let host = createMuseWorkerHost(options), fallbackCalls = 0;
  const desk = createWorkerServiceDesk({ ...parent, adapters: { [host.workerId]: host.adapter } });
  const server = http.createServer(async (req, res) => {
    try {
      if (await host.handle(req, res)) return;
      fallbackCalls++;
      respond(res, 200, { originalHost: true });
    } catch (error) {
      respond(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR' } });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await host.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function call(route, method = 'GET', body, credential = key, extraHeaders = {}) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
      method, headers: { ...(credential ? { Authorization: 'Bearer ' + credential } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  return { ...parent, desk, call, host: () => host, fallbackCalls: () => fallbackCalls,
    async remount() { await host.close(); host = createMuseWorkerHost(options); return host; } };
}
async function dispatch(desk, requestId) {
  const { order } = await desk.create({ serviceId: 'buyer-discovery', requestId,
    product: 'Public fixture catalog', market: 'US', objective: 'Local host lifecycle test',
    budgetCredits: 10, deadlineAt: new Date(Date.now() + 86400_000).toISOString(),
    publicDataConfirmed: true, workerId: config.workerId }, 'operator');
  await desk.approve(order.id, 'operator', { confirmed: true, workerId: config.workerId });
  await desk.dispatch(order.id);
  return order.id;
}
const base = '/api/muse-worker/v1';

test('shared Muse mount keeps original routes and rejects Dot/browser credentials', async t => {
  const { call, fallbackCalls } = await setup(t);
  for (const route of ['/employee', '/mcp', '/api/dot-worker/v1/identity', '/api/muse-worker-other'])
    assert.deepEqual((await call(route)).data, { originalHost: true });
  const identity = await call(base + '/identity/');
  assert.equal(identity.status, 200);
  assert.equal(identity.data.workerId, config.workerId);
  assert.equal(identity.data.contract, 'workspace.muse.pull.v1');
  assert.equal((await call(base + '/identity', 'GET', undefined, dotKey)).status, 401);
  assert.equal((await call(base + '/identity', 'GET', undefined, null)).status, 401);
  assert.equal((await call(base + '/identity', 'GET', undefined, key, { Origin: 'https://www.loc.gov' })).status, 403);
  assert.equal((await call('/api/muse-worker')).data.error.code, 'MW_ROUTE_NOT_FOUND');
  assert.equal((await call('/api/muse-worker/v2/identity')).data.error.code, 'MW_ROUTE_NOT_FOUND');
  assert.equal(fallbackCalls(), 4);
});

test('host factory rejects missing services and identity/credential collisions before any write', () => {
  const parent = services();
  const make = options => createMuseWorkerHost({ ...parent, config, readBody, respond, ...options });
  assert.throws(() => make({ config: null }), /explicit server configuration/);
  assert.throws(() => make({ store: {} }), /durable store/);
  assert.throws(() => make({ artifacts: {} }), /artifact service/);
  assert.throws(() => make({ config: { ...config, tokenDigest: 'invalid' } }), /token digest/);
  assert.throws(() => make({ workerAdapters: { [config.workerId]: {} } }), /identities must be distinct/);
  assert.throws(() => make({ dotWorkerConfig: { workerId: config.workerId } }), /identities must be distinct/);
  assert.throws(() => make({ dotWorkerConfig: { tokenDigest: config.tokenDigest } }), /never share a Bearer/);
  assert.deepEqual(parent.store.read(), { artifacts: [], activity: [] });
});

test('unreviewed shared mount permits identity but cannot authorize a WorkerDesk order', async t => {
  const { call, desk, host } = await setup(t, { config: { ...config, externalBudgetVerified: false } });
  assert.equal((await call(base + '/identity')).data.approved, false);
  assert.deepEqual((await call(base + '/inbox')).data.tasks, []);
  assert.equal(host().adapter.ready, false);
  assert(desk.catalog().every(service => !service.executable));
  await assert.rejects(dispatch(desk, 'unreviewed-order'), { code: 'WORKER_UNAVAILABLE' });
});

test('shared services carry an approved order through claim, file, submission and manual acceptance', async t => {
  const { call, desk, store } = await setup(t);
  const id = await dispatch(desk, 'shared-order');
  assert.equal(store.read().workerOrders[0].remoteJobId, id);
  assert.equal((await call(base + '/inbox')).data.tasks[0].taskRef, id);
  const claim = await call(base + '/tasks/' + id + '/claim', 'POST', { requestId: 'shared-claim' });
  assert.equal(claim.status, 200);
  const attempt = { attemptId: claim.data.attemptId, fence: claim.data.fence };
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId: id,
    deliverables: [{ name: 'Local fixture table', type: 'table', summary: 'Synthetic protocol fixture only.' }],
    evidence: [{ title: 'Public source fixture', url: 'https://www.loc.gov/about/', detail: 'No real research performed.' }],
    prospects: [{ name: 'Synthetic Fixture', country: 'US', website: 'https://www.loc.gov',
      fitReason: 'Local protocol fixture only.', sourceUrl: 'https://www.loc.gov/about/' }],
  }));
  const file = await call(base + '/tasks/' + id + '/upload-file', 'POST', {
    ...attempt, uploadId: 'shared-file', filename: 'report.json', base64: bytes.toString('base64'), sha256: hash(bytes),
  });
  assert.equal(file.status, 201);
  assert.equal(store.read().artifacts[0].metadata.museTaskRef, id);
  const submitted = await call(base + '/tasks/' + id + '/submit-result', 'POST', {
    ...attempt, requestId: 'shared-submit', summary: 'Local shared-host protocol fixture only.',
    sources: ['https://www.loc.gov/about/'], toolEvidence: [],
    evidenceNote: 'Local fixture; no real agent execution or verifiable tool receipts.',
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.reviewRequired, true);
  const refreshed = await desk.refresh(id);
  assert.equal(refreshed.order.status, 'review_required');
  assert.equal(refreshed.order.workerReport.independentlyVerified, false);
  assert.equal((await desk.accept(id, 'operator', { confirmed: true })).order.status, 'accepted');
});

test('unmount preserves the original attempt; remount cannot restart or clear cancellation', async t => {
  const { call, desk, store, host, remount } = await setup(t);
  const id = await dispatch(desk, 'retained-order');
  const claim = (await call(base + '/tasks/' + id + '/claim', 'POST', { requestId: 'retained-claim' })).data;
  await desk.cancel(id);
  const before = store.read();
  await host().close();
  assert.equal(host().adapter.ready, false);
  assert.equal(host().adapter.budgetEnforced, false);
  assert.deepEqual(store.read(), before);
  assert.equal((await call(base + '/tasks/' + id + '/status')).status, 503);
  await assert.rejects(host().adapter.cancel(id), { code: 'MW_GATEWAY_CLOSED' });
  await remount();
  const status = (await call(base + '/tasks/' + id + '/status')).data;
  assert.equal(status.attemptId, claim.attemptId);
  assert.equal(status.fence, claim.fence);
  assert.equal(status.cancellationRequested, true);
  assert.equal((await call(base + '/tasks/' + id + '/claim', 'POST', { requestId: 'replacement-claim' })).status, 409);
  const stopped = await call(base + '/tasks/' + id + '/confirm-stop', 'POST', {
    attemptId: claim.attemptId, fence: claim.fence, requestId: 'retained-stop',
  });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.data.status, 'stopped');
});

test('close fences new HTTP work synchronously and drains accepted parent writes', async () => {
  const parent = services(), entered = deferred(), release = deferred();
  const store = { ...parent.store, async update(callback) {
    entered.resolve();
    await release.promise;
    return parent.store.update(callback);
  } };
  const host = createMuseWorkerHost({ ...parent, store, config, readBody, respond: () => {} });
  const req = { method: 'GET', headers: { authorization: 'Bearer ' + key }, url: base + '/identity' };
  const operation = host.handle(req, {});
  await entered.promise;
  let drained = false;
  const closing = host.close().then(() => { drained = true; });
  assert.equal(host.close(), host.close());
  await assert.rejects(host.handle(req, {}), { code: 'MW_GATEWAY_CLOSED' });
  assert.equal(drained, false);
  assert.equal(parent.store.read().museLastSeenAt, undefined);
  release.resolve();
  assert.equal(await operation, true);
  await closing;
  assert.equal(typeof parent.store.read().museLastSeenAt, 'string');
  await parent.store.update(state => { state.parentStillUsable = true; });
  assert.equal(parent.store.read().parentStillUsable, true);
});

test('close waits for accepted adapter dispatch and rejects a replacement submission', async () => {
  const parent = services(), entered = deferred(), release = deferred();
  const store = { ...parent.store, async update(callback) {
    entered.resolve(); await release.promise; return parent.store.update(callback);
  } };
  const host = createMuseWorkerHost({ ...parent, store, config, readBody, respond });
  const payload = { orderId: 'adapter-original', idempotencyKey: 'adapter-original', serviceId: 'buyer-discovery',
    inputs: { product: 'Public fixture', market: 'US', objective: 'Fixture only' }, acceptance: [],
    deadlineAt: new Date(Date.now() + 86400_000).toISOString(), maxCredits: 10, dataScope: 'public' };
  const accepted = host.adapter.submit(payload);
  await entered.promise;
  const closing = host.close();
  await assert.rejects(host.adapter.submit({ ...payload, orderId: 'replacement' }), { code: 'MW_GATEWAY_CLOSED' });
  release.resolve();
  assert.equal((await accepted).jobId, 'adapter-original');
  await closing;
  assert.deepEqual(parent.store.read().museTasks.map(task => task.id), ['adapter-original']);
});
