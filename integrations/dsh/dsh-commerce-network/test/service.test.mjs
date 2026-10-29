import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { CommerceStore } from '../store.js';
import { createCommerceService } from '../service.js';
import { createHttpHandler } from '../http.js';
import { callApi, unwrap } from '../src/api.mjs';

export function fixture({ filename = ':memory:', clock = Date.now, resourceAdapter = null } = {}) {
  const workspaceId = randomUUID(), sessionId = `session-${randomUUID()}`, otherWorkspace = randomUUID(), otherSession = `session-${randomUUID()}`;
  const rows = [{ id: workspaceId, sessionIds: [sessionId] }, { id: otherWorkspace, sessionIds: [otherSession] }];
  const registry = { list: () => rows, get: id => rows.find(w => w.id === id) };
  const store = new CommerceStore(filename), service = createCommerceService({ store, registry, clock, resourceAdapter });
  const execution = () => ({ agent: { session: { id: sessionId } }, callId: `call_${randomUUID()}`, signal: new AbortController().signal });
  let projectId = null;
  const state = () => service.state(sessionId, projectId || undefined);
  const command = (name, payload, options = {}) => service.command(sessionId, { projectId, requestId: randomUUID(), expectedRevision: state().revision, command: name, payload, ...options });
  const tool = (name, payload, options = {}) => service.toolCommand({ projectId, requestId: randomUUID(), expectedRevision: state().revision, command: name, payload, ...options }, execution());
  async function setup({ maximumMinor = 0, resources = true } = {}) {
    const plan = await tool('apply_plan', {
      title: 'Isolated test network', goal: 'Verify real gateway behavior with synthetic records',
      parties: [{ id: 'factory_fixture', type: 'factory', displayName: 'Fixture Factory' }, { id: 'provider_fixture', type: 'provider', displayName: 'Fixture Provider' }, { id: 'distributor_fixture', type: 'distributor', displayName: 'Fixture Distributor', marketCode: 'US' }],
      agents: [{ id: 'agent_fixture', providerPartyId: 'provider_fixture', displayName: 'Fixture Worker', skills: ['public_web_research', 'read_granted_product_context'] }],
      products: [{ id: 'product_fixture', name: 'Fixture Product', description: 'Explicit synthetic product context', source: 'test-only' }],
      routes: [{ id: 'route_fixture', name: 'US wholesale', market: 'US', channel: 'wholesale', productIds: ['product_fixture'] }],
      workOrders: [{ id: 'work_fixture', requesterPartyId: 'factory_fixture', agentServiceId: 'agent_fixture', title: 'Fixture public research', brief: 'Return an explicit test report; do not contact anyone.', allowedActions: ['public_web_research'], allowedResourceRefs: resources ? ['product:product_fixture'] : [], maximumMinor, currency: 'USD', ttlSeconds: 86400 }],
    });
    projectId = plan.projectId;
    if (maximumMinor) await command('set_budget', { maximumMinor, currency: 'USD' });
    const issued = await command('issue_agent_credential', { agentServiceId: 'agent_fixture' });
    const token = issued.credential.token;
    await service.worker(token, 'connect', { requestId: randomUUID() });
    return { token, issued, plan };
  }
  async function approve(orderId = 'work_fixture') {
    const preview = await service.review(sessionId, projectId, orderId);
    return command('approve_order', { orderId, reviewDigest: preview.reviewDigest }, { expectedRevision: preview.networkRevision });
  }
  async function dispatch(orderId = 'work_fixture') { await approve(orderId); return tool('dispatch_order', { orderId }); }
  return { service, store, registry, rows, sessionId, workspaceId, otherWorkspace, otherSession, state, command, tool, setup, approve, dispatch, execution, get projectId() { return projectId; } };
}

test('durable native plan → credential handshake → approved exact scope → real delivery → owner acceptance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-flow-')), filename = join(dir, 'commerce.sqlite');
  const f = fixture({ filename });
  try {
    assert.equal(f.state().projects.length, 0);
    const { token } = await f.setup({ maximumMinor: 1500 });
    assert.equal(f.state().commerceNetwork.agentServices[0].status, 'connected');
    await f.dispatch();
    const queued = f.state().commerceNetwork.workOrders[0];
    assert.equal(queued.status, 'queued');
    assert.equal(queued.nativeDispatch.sessionId, f.sessionId);
    assert.equal(f.state().budget.reservedMinor, 1500);
    const claimId = randomUUID();
    const claimed = await f.service.worker(token, 'claim', { requestId: claimId });
    assert.equal(claimed.order.resources[0].content.description, 'Explicit synthetic product context');
    assert.equal(claimed.order.status, 'claimed');
    assert.equal((await f.service.worker(token, 'claim', { requestId: claimId })).order.leaseId, claimed.order.leaseId);
    await f.service.worker(token, 'heartbeat', { requestId: randomUUID(), orderId: claimed.order.id, leaseId: claimed.order.leaseId });
    const content = 'Synthetic verification report. No real leads or customer contacts were used.';
    const result = await f.service.worker(token, 'deliver', { requestId: randomUUID(), orderId: claimed.order.id, leaseId: claimed.order.leaseId, title: 'Fixture delivery', content, actualMinor: 700, sourceUrls: ['https://example.com/'] });
    assert.equal(result.deliverable.sha256, createHash('sha256').update(content).digest('hex'));
    assert.equal(f.state().commerceNetwork.workOrders[0].status, 'delivered');
    assert.equal(f.state().budget.accruedMinor, 0);
    await f.command('accept_delivery', { orderId: claimed.order.id });
    assert.equal(f.state().budget.reservedMinor, 0);
    assert.equal(f.state().budget.accruedMinor, 700);
    assert.equal(f.state().budget.paymentStatus, 'not_connected');
    assert.equal(f.state().deliverables[0].content, undefined);
    assert.equal(f.state().deliverables[0].contentBytes, Buffer.byteLength(content));
    assert.equal(f.service.delivery(f.sessionId, f.projectId, result.deliverable.id).content, content);
    const raw = f.store.db.prepare('SELECT secret_hash FROM commerce_credential').get();
    assert.equal(raw.secret_hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(JSON.stringify(f.state()).includes(token), false);
    f.service.close();
    const reopened = new CommerceStore(filename);
    const restored = createCommerceService({ store: reopened, registry: f.registry });
    assert.equal(restored.state(f.sessionId).commerceNetwork.workOrders[0].status, 'accepted');
    assert.equal(restored.state(f.sessionId).deliverables[0].content, undefined);
    assert.equal(restored.delivery(f.sessionId, f.projectId, result.deliverable.id).content, content);
    restored.close();
    assert.equal(readFileSync(filename).includes(Buffer.from(token)), false);
  } finally { f.service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('human decisions and credentials cannot be obtained through native model tools; browser cannot dispatch', async () => {
  const f = fixture();
  try {
    await f.setup();
    for (const command of ['issue_agent_credential', 'approve_order', 'accept_delivery', 'set_budget', 'revoke_agent']) {
      await assert.rejects(f.tool(command, { orderId: 'work_fixture', agentServiceId: 'agent_fixture' }), e => e.code === 'OWNER_ACTION_REQUIRED');
    }
    await assert.rejects(f.command('dispatch_order', { orderId: 'work_fixture' }), e => e.code === 'NATIVE_DISPATCH_REQUIRED');
    await assert.rejects(f.command('approve_order', { orderId: 'work_fixture' }), e => e.code === 'REVIEW_CHANGED');
    assert.equal(f.state().commerceNetwork.workOrders[0].status, 'proposed');
  } finally { f.service.close(); }
});

test('credential secrets are shown once, rotation invalidates old token, token scope cannot choose another project', async () => {
  const f = fixture();
  try {
    const { token } = await f.setup();
    const requestId = randomUUID(), expectedRevision = f.state().revision;
    const issued = await f.command('issue_agent_credential', { agentServiceId: 'agent_fixture' }, { requestId, expectedRevision });
    const replay = await f.command('issue_agent_credential', { agentServiceId: 'agent_fixture' }, { requestId, expectedRevision });
    assert.equal(replay.credential.token, null);
    await assert.rejects(f.service.worker(token, 'connect', { requestId: randomUUID() }), e => e.code === 'WORKER_UNAUTHORIZED');
    await assert.rejects(f.service.worker(issued.credential.token, 'connect', { requestId: randomUUID(), projectId: 'elsewhere' }), e => e.code === 'INPUT');
    assert.equal(f.service.state(f.otherSession).projects.length, 0);
    assert.throws(() => f.service.state(f.otherSession, f.projectId), e => e.code === 'PROJECT_NOT_FOUND');
  } finally { f.service.close(); }
});

test('revocation blocks actual delivery and new reads; leased work needs an authenticated stop acknowledgement', async () => {
  const f = fixture();
  try {
    const { token } = await f.setup({ maximumMinor: 1000 }); await f.dispatch();
    const { order } = await f.service.worker(token, 'claim', { requestId: randomUUID() });
    await f.service.worker(token, 'heartbeat', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId });
    await f.command('revoke_agent', { agentServiceId: 'agent_fixture' });
    assert.equal(f.state().commerceNetwork.workOrders[0].status, 'stop_requested');
    assert.equal(f.state().budget.reservedMinor, 1000);
    await assert.rejects(f.service.worker(token, 'deliver', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId, title: 'No', content: 'Rejected' }), e => e.code === 'WORKER_UNAUTHORIZED');
    await assert.rejects(f.service.worker(token, 'resources', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId }), e => e.code === 'WORKER_UNAUTHORIZED');
    assert.equal((await f.service.worker(token, 'status', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId })).stopRequested, true);
    await f.service.worker(token, 'stopped', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId });
    assert.equal(f.state().commerceNetwork.workOrders[0].status, 'cancelled');
    assert.equal(f.state().budget.reservedMinor, 0);
  } finally { f.service.close(); }
});

test('expired worker lease fails durably and never automatically dispatches duplicate external work', async () => {
  let timestamp = Date.now(); const f = fixture({ clock: () => timestamp });
  try {
    const { token } = await f.setup(); await f.dispatch();
    const { order } = await f.service.worker(token, 'claim', { requestId: randomUUID() });
    timestamp += 120_001;
    assert.equal(f.state().commerceNetwork.workOrders[0].status, 'failed');
    assert.equal(f.state().commerceNetwork.workOrders[0].stopUnconfirmed, true);
    assert.equal((await f.service.worker(token, 'claim', { requestId: randomUUID() })).order, null);
    await assert.rejects(f.service.worker(token, 'heartbeat', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId }));
    await assert.rejects(f.tool('dispatch_order', { orderId: order.id }));
  } finally { f.service.close(); }
});

test('budget reservation is atomic and charged amounts cannot exceed owner approval', async () => {
  const f = fixture();
  try {
    const { token } = await f.setup({ maximumMinor: 1000 }); await f.dispatch();
    await f.tool('propose_order', { id: 'second', requesterPartyId: 'factory_fixture', agentServiceId: 'agent_fixture', title: 'Second', brief: 'Second test', allowedActions: ['public_web_research'], maximumMinor: 1, currency: 'USD' });
    await assert.rejects(f.approve('second'), e => e.code === 'BUDGET_EXCEEDED');
    const { order } = await f.service.worker(token, 'claim', { requestId: randomUUID() });
    await f.service.worker(token, 'heartbeat', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId });
    await assert.rejects(f.service.worker(token, 'deliver', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId, title: 'Result', content: 'Content', actualMinor: 1001 }), e => e.code === 'INPUT');
    assert.equal(f.state().deliverables.length, 0);
    await f.service.worker(token, 'deliver', { requestId: randomUUID(), orderId: order.id, leaseId: order.leaseId, title: 'Result', content: 'Actual test bytes', actualMinor: 1000 });
    await f.command('reject_delivery', { orderId: order.id, reason: 'Fixture rejection' });
    assert.equal(f.state().budget.reservedMinor, 0); assert.equal(f.state().budget.accruedMinor, 0);
    await f.approve('second');
  } finally { f.service.close(); }
});

test('business CAS, idempotency and layout CAS are independent and conflict-safe', async () => {
  const f = fixture();
  try {
    await f.setup();
    const expectedRevision = f.state().revision, requestId = randomUUID();
    await f.command('upsert_party', { id: 'factory_2', type: 'factory', displayName: 'Second fixture' }, { requestId, expectedRevision });
    const replay = await f.command('upsert_party', { id: 'factory_2', type: 'factory', displayName: 'Second fixture' }, { requestId, expectedRevision });
    assert.equal(replay.receipt.replayed, true);
    await assert.rejects(f.command('upsert_party', { id: 'factory_2', type: 'factory', displayName: 'Changed' }, { requestId, expectedRevision }), e => e.code === 'REQUEST_ID_CONFLICT');
    await assert.rejects(f.command('set_budget', { maximumMinor: 10, currency: 'USD' }, { expectedRevision }), e => e.code === 'REVISION_CONFLICT');
    const layout = { projectId: f.projectId, requestId: randomUUID(), expectedLayoutRevision: 0, nodes: [{ id: 'factory:factory_fixture', position: { x: 10, y: 20 } }], viewport: { x: 0, y: 0, zoom: 1 } };
    const rev = f.state().revision;
    f.service.layout(f.sessionId, layout); assert.equal(f.state().revision, rev);
    assert.equal(f.state().canvasLayouts[0].revision, 1);
    assert.throws(() => f.service.layout(f.sessionId, { ...layout, requestId: randomUUID() }), e => e.code === 'LAYOUT_CONFLICT');
    assert.throws(() => f.service.layout(f.sessionId, { ...layout, requestId: randomUUID(), expectedLayoutRevision: 1, nodes: [{ id: 'factory:unauthorized', position: { x: 0, y: 0 } }] }), e => e.code === 'LAYOUT_INPUT');
  } finally { f.service.close(); }
});

test('partial plan failures roll back all records and removed native sessions cannot reuse tools', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.tool('apply_plan', { title: 'Rollback', parties: [{ id: 'f', type: 'factory', displayName: 'f' }], routes: [{ id: 'r', name: 'r', market: 'US', channel: 'retail', productIds: ['missing'] }] }), e => e.code === 'PRODUCT_NOT_FOUND');
    assert.equal(f.state().projects.length, 0);
    f.rows[0].sessionIds = [];
    assert.throws(() => f.service.toolRead({}, f.execution()), e => e.code === 'SESSION_REQUIRED');
  } finally { f.service.close(); }
});

test('official prefixed native SessionIds resolve only through current registry membership', () => {
  const f = fixture();
  try {
    assert.match(f.sessionId, /^session-[a-f0-9-]{36}$/);
    assert.equal(f.service.state(f.sessionId).workspaceId, f.workspaceId);
    assert.throws(() => f.service.state(`session-${randomUUID()}`), e => e.code === 'SESSION_REQUIRED');
    assert.throws(() => f.service.state(f.sessionId.replace('session-', '')), e => e.code === 'SESSION_REQUIRED');
    f.rows[0].sessionIds.push('session-42');
    assert.equal(f.service.state('session-42').workspaceId, f.workspaceId);
    assert.throws(() => f.service.state('session-43'), e => e.code === 'SESSION_REQUIRED');
  } finally { f.service.close(); }
});

test('43 large accepted deliveries keep canvas and owner responses readable; individual HTTP reads preserve exact bytes', async t => {
  let now = Date.now();
  const f = fixture({ clock: () => now });
  t.after(() => f.service.close());
  const { token } = await f.setup({ resources: false });
  const content = 'Synthetic delivery <script>untrusted()</script>\n'.padEnd(100_000, 'x');
  const sourceUrls = Array.from({ length: 50 }, (_, index) => `https://example.com/source/${index}`);
  let lastId;
  for (let index = 0; index < 43; index++) {
    now += 60_001; // Stay within the real per-credential request window.
    const orderId = index === 0 ? 'work_fixture' : `large_${index}`;
    if (index > 0) await f.tool('propose_order', {
      id: orderId, requesterPartyId: 'factory_fixture', agentServiceId: 'agent_fixture',
      title: `Synthetic delivery ${index}`, brief: 'Store explicit test content; no outreach.',
      allowedActions: ['public_web_research'], allowedResourceRefs: [], maximumMinor: 0,
    });
    await f.dispatch(orderId);
    const { order } = await f.service.worker(token, 'claim', { requestId: randomUUID(), orderId });
    const lease = { orderId, leaseId: order.leaseId };
    await f.service.worker(token, 'heartbeat', { requestId: randomUUID(), ...lease });
    const result = await f.service.worker(token, 'deliver', { requestId: randomUUID(), ...lease, title: `Synthetic delivery ${index}`, content, sourceUrls });
    lastId = result.deliverable.id;
    await f.command('accept_delivery', { orderId });
  }
  assert.ok(JSON.stringify(f.store.load(f.workspaceId)).length > 4 * 1024 * 1024, 'fixture must reproduce the original oversized payload');
  const handler = createHttpHandler(f.service, { authorize: ({ headers }) => headers.cookie === 'owner=fixture' ? null : 401 });
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`, originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options = {}) => originalFetch(new URL(url, base), {
    ...options, headers: { ...options.headers, cookie: 'owner=fixture', ...(options.method === 'POST' ? { origin: base } : {}) },
  }));
  const params = new URLSearchParams({ sessionId: f.sessionId, projectId: f.projectId });
  const state = unwrap(await callApi(`/workspace?${params}`));
  assert.equal(state.deliverables.length, 43);
  assert.ok(JSON.stringify(state).length < 512 * 1024, 'canvas remains small even with maximum-size text and source lists');
  for (const row of state.deliverables) {
    assert.equal(Object.hasOwn(row, 'content'), false);
    assert.equal(Object.hasOwn(row, 'sourceUrls'), false);
    assert.equal(row.contentBytes, Buffer.byteLength(content));
    assert.equal(row.sourceCount, sourceUrls.length);
  }
  const owner = unwrap(await callApi('/command', { body: { sessionId: f.sessionId, projectId: f.projectId, requestId: randomUUID(), expectedRevision: state.revision, command: 'set_budget', payload: { maximumMinor: 0, currency: 'USD' } } }));
  assert.equal(owner.receipt.projectId, f.projectId);
  assert.equal(owner.deliverables.length, 43);
  assert.equal(Object.hasOwn(owner.deliverables[0], 'content'), false);
  const delivery = unwrap(await callApi(`/delivery?${params}&deliveryId=${lastId}`));
  assert.equal(delivery.id, lastId);
  assert.equal(delivery.content, content);
  assert.deepEqual(delivery.sourceUrls, sourceUrls);
  assert.equal(delivery.sha256, createHash('sha256').update(delivery.content).digest('hex'));
  const native = f.service.toolDeliveryRead({ projectId: f.projectId, deliveryId: lastId }, f.execution());
  assert.deepEqual(native, delivery, 'native tools retain explicit full-content inspection');
  assert.equal((await originalFetch(`${base}/commerce-network-api/delivery?${params}&deliveryId=${lastId}`)).status, 401);
  assert.equal((await originalFetch(`${base}/commerce-network-api/delivery?${params}&deliveryId=${lastId}&workspaceId=${f.workspaceId}`, { headers: { cookie: 'owner=fixture' } })).status, 400);
  assert.equal((await originalFetch(`${base}/commerce-network-api/delivery?sessionId=${f.otherSession}&projectId=${f.projectId}&deliveryId=${lastId}`, { headers: { cookie: 'owner=fixture' } })).status, 404);
});

test('delivery reads are explicit, read-only and confined to current project and native membership', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const { token } = await f.setup(); await f.dispatch();
  const { order } = await f.service.worker(token, 'claim', { requestId: randomUUID() });
  const lease = { orderId: order.id, leaseId: order.leaseId };
  await f.service.worker(token, 'heartbeat', { requestId: randomUUID(), ...lease });
  const content = '交付内容 🧵 — exact Unicode bytes';
  const { deliverable } = await f.service.worker(token, 'deliver', { requestId: randomUUID(), ...lease, title: 'Scoped delivery', content });
  const input = { projectId: f.projectId, deliveryId: deliverable.id };
  const revision = f.state().revision;
  assert.equal(f.service.delivery(f.sessionId, f.projectId, deliverable.id).content, content);
  assert.equal(f.service.toolDeliveryRead(input, f.execution()).content, content);
  assert.equal(f.state().revision, revision);
  assert.equal(f.state().commerceNetwork.workOrders[0].status, 'delivered', 'reading does not accept a delivery');
  assert.equal(f.state().deliverables[0].contentBytes, Buffer.byteLength(content));
  const another = await f.command('create_project', { title: 'Another isolated project' });
  assert.throws(() => f.service.delivery(f.sessionId, another.projectId, deliverable.id), { code: 'DELIVERY_NOT_FOUND' });
  await f.service.command(f.otherSession, { command: 'create_project', payload: { id: f.projectId, title: 'Same ID in a separate workspace' }, expectedRevision: 0, requestId: randomUUID() });
  assert.throws(() => f.service.delivery(f.otherSession, f.projectId, deliverable.id), { code: 'DELIVERY_NOT_FOUND' });
  assert.throws(() => f.service.delivery(f.sessionId, f.projectId, 'missing'), { code: 'DELIVERY_NOT_FOUND' });
  assert.throws(() => f.service.delivery(f.sessionId, undefined, deliverable.id), { code: 'INPUT' });
  assert.throws(() => f.service.delivery(f.sessionId, f.projectId, '../delivery'), { code: 'INPUT' });
  assert.throws(() => f.service.toolDeliveryRead({ ...input, workspaceId: f.workspaceId }, f.execution()), { code: 'INPUT' });
  assert.throws(() => f.service.toolDeliveryRead(input, { agent: { session: { id: f.sessionId } } }), { code: 'TOOL_IDENTITY_REQUIRED' });
  f.rows[0].sessionIds = [];
  assert.throws(() => f.service.delivery(f.sessionId, f.projectId, deliverable.id), { code: 'SESSION_REQUIRED' });
  assert.throws(() => f.service.toolDeliveryRead(input, f.execution()), { code: 'SESSION_REQUIRED' });
});
