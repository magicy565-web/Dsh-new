import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createNativeMuseBinding, validateNativeMuseConfiguration, quarantineNativeMuse } from '../server/muse-worker-native.mjs';

const actor = { subject: 'reviewed-owner', nativeAgentId: 'original-session' };
const foreignActor = { subject: 'other-owner', nativeAgentId: 'other-original-session' };
const key = 'native-binding-fixture-key_01234567890123456789';
const hash = value => createHash('sha256').update(value).digest('hex');
const config = { workerId: 'muse-rest-fixture', ownerId: 'personal-muse-fixture', tokenDigest: hash(key),
  enabled: true, scopeReviewed: true, externalBudgetVerified: true };
const base = '/api/muse-worker/v1';

// Explicit memory fixture: these tests verify native actor/lifecycle boundaries,
// not filesystem durability, Cordis boot, real Muse authorization or execution.
function parent(boundActor = actor) {
  const context = new AsyncLocalStorage();
  let epoch = 1, active = true, queue = Promise.resolve(), writes = 0;
  let state = { artifacts: [], activity: [], workerOrders: [{ id: 'foreign-order',
    createdBy: foreignActor.subject, workerId: 'foreign-worker', status: 'draft' }] };
  const current = () => { const token = context.getStore();
    if (!token || token.epoch !== epoch || token.subject !== boundActor.subject)
      throw Object.assign(Error('Native binding epoch changed.'), { status: 503, code: 'WORKSPACE_PLUGIN_STALE' });
    if (token.active && !active) throw Object.assign(Error('Native scope paused.'), { status: 409, code: 'WORKSPACE_PLUGIN_PAUSED' });
  };
  const store = { read: () => structuredClone(state),
    update(callback) {
      current();
      const result = queue.then(async () => { current(); const next = structuredClone(state);
        const value = await callback(next); state = next; writes++; return structuredClone(value); });
      queue = result.catch(() => {}); return result;
    },
    close() { throw Error('Do not close the parent writer.'); },
  };
  const files = new Map();
  const artifacts = {
    async create(input, options) {
      current();
      const bytes = input.base64 === undefined ? Buffer.from(input.content, 'utf8') : Buffer.from(input.base64, 'base64');
      const artifact = { id: randomUUID(), filename: input.filename, requestId: input.requestId,
        metadata: input.metadata, workerOwner: options.workerOwner };
      await store.update(next => { options.check(next); next.artifacts.push(artifact); });
      files.set(artifact.id, bytes); return { artifact };
    },
    download(id) { current(); return { bytes: files.get(id) }; },
    close() { throw Error('Do not close parent artifacts.'); },
  };
  const capturedEpoch = epoch;
  function run(callback, options) {
    return context.run({ ...boundActor, epoch: capturedEpoch, active: options.active }, async () => {
      current(); const value = await callback(); current(); return value;
    });
  }
  return { store, artifacts, run, writes: () => writes,
    revoke() { epoch++; }, pause() { active = false; },
    addForeign: callback => context.run({ ...boundActor, epoch, active: false }, () => store.update(callback)),
  };
}
function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body));
}
async function readBody(req, maximum) {
  if (req.headers['content-type'] !== 'application/json') throw Object.assign(Error('Send JSON.'), { status: 415, code: 'JSON_REQUIRED' });
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw Object.assign(Error('Too large.'), { status: 413, code: 'BODY_TOO_LARGE' }); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function setup(t, overrides = {}) {
  const boundActor = overrides.actor ?? actor;
  const services = parent(boundActor);
  const binding = createNativeMuseBinding({ ...services, config, actor: boundActor, operators: [boundActor, foreignActor],
    expectedHost: 'workspace.native-fixture.test', readBody, respond, ...overrides });
  const server = http.createServer(async (req, res) => {
    try {
      if (await binding.handle(req, res, new URL(req.url, 'http://localhost').pathname)) return;
      respond(res, 404, { error: { code: 'ORIGINAL_ROUTE_UNCHANGED' } });
    } catch (error) { respond(res, error.status ?? 500, { error: { code: error.code ?? 'INTERNAL_ERROR' } }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await binding.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  async function call(path, method = 'GET', body, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method,
        headers: { Host: 'workspace.native-fixture.test', Authorization: 'Bearer ' + key,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return { ...services, binding, desk: binding.bindDesk(boundActor), call };
}
async function dispatch(desk, requestId) {
  const { order } = await desk.create({ requestId, serviceId: 'buyer-discovery', product: 'Protocol fixture',
    market: 'US', objective: 'Local fixture; no real external work.', budgetCredits: 10,
    deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true });
  await desk.approve(order.id, { confirmed: true }); await desk.dispatch(order.id); return order.id;
}

test('native binding requires reviewed exact owner and explicit boolean gates before any write', () => {
  const services = parent(), options = { ...services, config, actor, operators: [actor],
    expectedHost: 'workspace.native-fixture.test', readBody, respond };
  assert.throws(() => createNativeMuseBinding({ ...options, actor: foreignActor }), /explicit reviewed native owner/);
  assert.throws(() => validateNativeMuseConfiguration({ ...config, enabled: 'true' }, actor, [actor]), /boolean gates/);
  const nativeOwner = { subject: 'owner@native.test', nativeAgentId: 'original/session' };
  assert.equal(validateNativeMuseConfiguration(config, nativeOwner, [nativeOwner]).workerId, config.workerId);
  assert.throws(() => createNativeMuseBinding({ ...options, config: { ...config, unexpected: true } }), /explicit reviewed/);
  assert.throws(() => createNativeMuseBinding({ ...options, dotWorkerConfig: { tokenDigest: config.tokenDigest } }), /never share a Bearer/);
  const binding = createNativeMuseBinding(options);
  assert.throws(() => binding.bindDesk(foreignActor), { code: 'MUSE_OWNER_REQUIRED' });
  assert.equal(services.writes(), 0);
});

test('REST uses parent native actor and rejects Host, browser credentials and duplicate headers', async t => {
  const { binding, call, store } = await setup(t);
  assert.equal((await call(base + '/identity')).status, 200);
  assert.equal(typeof store.read().museLastSeenAt, 'string');
  assert.equal((await call(base + '/identity', 'GET', undefined, { Host: 'evil.invalid' })).status, 403);
  assert.equal((await call(base + '/identity', 'GET', undefined, { Authorization: '' })).status, 401);
  assert.equal((await call(base + '/identity', 'GET', undefined, { Cookie: 'employee-cookie=fixture' })).status, 403);
  await assert.rejects(binding.handle({ method: 'GET', url: base + '/identity', headers: { host: 'workspace.native-fixture.test' },
    socket: { remoteAddress: '127.0.0.1' }, rawHeaders: ['Host', 'workspace.native-fixture.test', 'Authorization', 'one', 'Authorization', 'two'] }, {}, base + '/identity'), { code: 'MW_AMBIGUOUS_HEADER' });
  await assert.rejects(binding.handle({ method: 'GET', url: base + '/identity', headers: { host: 'workspace.native-fixture.test' },
    socket: { remoteAddress: '192.0.2.1' }, rawHeaders: [] }, {}, base + '/identity'), { code: 'MW_INGRESS_REQUIRED' });
  assert.equal((await call('/api/bootstrap')).body.error.code, 'ORIGINAL_ROUTE_UNCHANGED');
});

test('fixed Muse owner cannot inspect or mutate another WorkerDesk order', async t => {
  const { desk, store } = await setup(t); const before = store.read();
  assert.deepEqual(await desk.list(), []);
  await assert.rejects(desk.get('foreign-order'), { code: 'ORDER_NOT_FOUND' });
  await assert.rejects(desk.cancel('foreign-order'), { code: 'ORDER_NOT_FOUND' });
  await assert.rejects(desk.create({ workerId: 'foreign-worker' }), { code: 'WORKER_UNAVAILABLE' });
  assert.deepEqual(store.read(), before);
});

test('parent pause blocks admission and captured epoch revocation blocks cached REST and business handles', async t => {
  const { desk, call, store, pause, revoke } = await setup(t);
  pause();
  await assert.rejects(dispatch(desk, 'paused-order'), { code: 'WORKSPACE_PLUGIN_PAUSED' });
  assert.equal((await call(base + '/identity')).status, 200);
  revoke(); const before = store.read();
  assert.equal((await call(base + '/inbox')).body.error.code, 'WORKSPACE_PLUGIN_STALE');
  await assert.rejects(desk.list(), { code: 'WORKSPACE_PLUGIN_STALE' });
  assert.deepEqual(store.read(), before);
});

test('owned upload, manual acceptance and opportunity import retain owner and preserve foreign data', async t => {
  const { desk, call, store, addForeign } = await setup(t);
  const orderId = await dispatch(desk, 'owned-order');
  const claim = (await call(base + '/tasks/' + orderId + '/claim', 'POST', { requestId: 'claim-original' })).body;
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId,
    deliverables: [{ name: 'Fixture table', type: 'table', summary: 'Synthetic native binding fixture.' }],
    evidence: [{ title: 'Fixture source', url: 'https://www.loc.gov/about/', detail: 'Protocol fixture.' }],
    prospects: [{ name: 'Synthetic Company', country: 'US', website: 'https://www.loc.gov',
      sourceUrl: 'https://www.loc.gov/about/', fitReason: 'Synthetic local protocol fixture.' }] }));
  const attempt = { attemptId: claim.attemptId, fence: claim.fence };
  const upload = await call(base + '/tasks/' + orderId + '/upload-file', 'POST', { ...attempt,
    uploadId: 'owned-file', filename: 'fixture.json', base64: bytes.toString('base64'), sha256: hash(bytes) });
  assert.equal(upload.status, 201);
  const artifact = store.read().artifacts[0];
  assert.equal(artifact.metadata.museOwnerSubject, actor.subject);
  assert.equal(artifact.metadata.museNativeAgentId, actor.nativeAgentId);
  assert.deepEqual(artifact.workerOwner, { subject: actor.subject, workerId: config.workerId });
  assert.deepEqual((await desk.download(artifact.id)).bytes, bytes);
  assert.equal((await call(base + '/tasks/' + orderId + '/submit-result', 'POST', { ...attempt,
    requestId: 'submit-original', summary: 'Local native binding fixture.', sources: ['https://www.loc.gov/about/'],
    toolEvidence: [], evidenceNote: 'No real Muse execution; synthetic native lifecycle test.' })).status, 200);
  assert.equal((await desk.refresh(orderId)).order.status, 'review_required');
  assert.equal((await desk.accept(orderId, { confirmed: true })).order.status, 'accepted');
  const foreignOpportunity = { id: 'foreign-opportunity', sourceOrderId: 'foreign-order',
    duplicateKey: 'synthetic company|loc.gov', status: 'candidate', privateField: 'foreign-preserved' };
  await addForeign(state => { state.workerOpportunities = [foreignOpportunity];
    state.artifacts.push({ id: 'foreign-artifact', metadata: {} });
    state.artifacts.push({ id: 'forged-metadata-artifact', metadata: {
      museOwnerSubject: actor.subject, museNativeAgentId: actor.nativeAgentId } }); });
  const imported = await desk.promote(orderId, { confirmed: true, requestId: 'import-owned', indices: [0] });
  assert.equal(imported.createdCount, 1);
  assert.notEqual(imported.importedIds[0], foreignOpportunity.id);
  assert.equal((await desk.opportunities()).length, 1);
  assert.deepEqual(store.read().workerOpportunities.find(item => item.id === foreignOpportunity.id), foreignOpportunity);
  await assert.rejects(desk.review(foreignOpportunity.id, { confirmed: true, decision: 'rejected' }), { code: 'OPPORTUNITY_NOT_FOUND' });
  await assert.rejects(desk.download('foreign-artifact'), { code: 'MW_FILE_NOT_FOUND' });
  await assert.rejects(desk.download('forged-metadata-artifact'), { code: 'MW_FILE_NOT_FOUND' });
});

test('disabled approval gates allow identity and empty inbox without admitting an order', async t => {
  const { call, desk, store } = await setup(t, { config: { ...config, enabled: false, scopeReviewed: false, externalBudgetVerified: false } });
  const identity = await call(base + '/identity');
  assert.equal(identity.status, 200); assert.equal(identity.body.approved, false);
  assert.deepEqual((await call(base + '/inbox')).body.tasks, []);
  await assert.rejects(dispatch(desk, 'not-authorized'), { code: 'WORKER_UNAVAILABLE' });
  assert.equal(store.read().workerOrders.length, 1);
});

test('native restart quarantine expires the original lease without replacing the attempt or receipt', async t => {
  const { desk, call, store, addForeign } = await setup(t);
  const orderId = await dispatch(desk, 'quarantine-order');
  const claim = (await call(base + '/tasks/' + orderId + '/claim', 'POST', { requestId: 'original-attempt' })).body;
  const originalTask = store.read().museTasks[0];
  await addForeign(state => quarantineNativeMuse(state, 'plugin-reattach'));
  const task = store.read().museTasks[0];
  assert.equal(task.attemptId, originalTask.attemptId); assert.equal(task.fence, originalTask.fence);
  assert.equal(task.leaseUntil, null); assert.equal(task.status, 'blocked');
  assert.equal((await call(base + '/tasks/' + orderId)).body.canExecute, false);
  assert.equal((await call(base + '/tasks/' + orderId + '/heartbeat', 'POST', {
    attemptId: claim.attemptId, fence: claim.fence, requestId: 'old-heartbeat' })).status, 409);
  assert.equal((await call(base + '/tasks/' + orderId + '/claim', 'POST', { requestId: 'replacement-attempt' })).status, 409);
  assert.equal(store.read().workerOrders.find(item => item.id === orderId).remoteJobId, orderId);
  await desk.cancel(orderId);
  assert.equal((await call(base + '/tasks/' + orderId + '/confirm-stop', 'POST', {
    attemptId: claim.attemptId, fence: claim.fence, requestId: 'original-stop' })).status, 200);
  assert.equal(store.read().museTasks[0].status, 'stopped');
});

test('native owner and session IDs keep their original syntax without widening public task IDs', async t => {
  const nativeOwner = { subject: 'owner@native.test', nativeAgentId: 'original/session' };
  const { desk, call, store } = await setup(t, { actor: nativeOwner });
  const id = await dispatch(desk, 'native-syntax-order');
  assert.equal(store.read().workerOrders.find(item => item.id === id).createdBy, nativeOwner.subject);
  assert.equal((await call(base + '/inbox')).body.tasks[0].taskRef, id);
  await assert.rejects(desk.create({ serviceId: 'buyer-discovery', requestId: 'invalid/public-id' }), { code: 'INVALID_INPUT' });
});
