import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createNativeMuseBinding } from '../server/muse-worker-native.mjs';
import { createMuseSessionRelay } from '../server/workspace-muse-session-host.mjs';
import { validateMuseSessionReceipts } from '../server/muse-worker-session.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const actor = { subject: 'original-owner', nativeAgentId: 'original-session' };
const key = 'isolated-muse-session-contract-key_0123456789';
const config = { workerId: '33a6f8cc-6017-4282-8444-f59c2e038def', ownerId: 'original-muse',
  tokenDigest: hash(key), enabled: true, scopeReviewed: true, externalBudgetVerified: true };

// Explicit memory contract fixture. Actual Harness persistence has a separate test.
async function fixture(t) {
  let state = { artifacts: [], activity: [], workerOrders: [], conversations: [], messages: [] };
  let epoch = 1, paused = false, flushResult = true, queue = Promise.resolve(), failAck = false;
  const context = new AsyncLocalStorage(), blobs = new Map(), events = [];
  const check = () => {
    const token = context.getStore();
    if (!token || token.epoch !== epoch) throw Object.assign(Error('Stale scope.'), { code: 'WORKSPACE_PLUGIN_STALE' });
    if (token.active && paused) throw Object.assign(Error('Paused.'), { code: 'WORKSPACE_PLUGIN_PAUSED' });
  };
  const store = { read: () => structuredClone(state), update(callback) {
    check(); const token = context.getStore();
    const work = queue.then(() => context.run(token, () => {
      check(); const next = structuredClone(state), result = callback(next);
      if (failAck && next.workspaceMuseSessionReceipts) { failAck = false; throw Error('Simulated business writer failure.'); }
      state = next; return structuredClone(result);
    })); queue = work.catch(() => {}); return work;
  } };
  const artifacts = { async create(input, options) {
    check(); const bytes = Buffer.from(input.base64 ?? Buffer.from(input.content).toString('base64'), 'base64');
    const artifact = { id: randomUUID(), requestId: input.requestId, metadata: input.metadata, workerOwner: options.workerOwner,
      filename: input.filename, currentVersion: 1,
      versions: [{ version: 1, filename: input.filename, sha256: hash(bytes), size: bytes.length }] };
    await store.update(next => { options.check(next); next.artifacts.push(artifact); });
    blobs.set(artifact.id, new Map([[1, bytes]])); return { artifact };
  }, download(id, options = {}) {
    check(); const artifact = state.artifacts.find(a => a.id === id), number = options.version ?? artifact.currentVersion;
    return { artifact: structuredClone(artifact), version: structuredClone(artifact.versions.find(v => v.version === number)),
      filename: artifact.filename, mimeType: 'application/json', bytes: blobs.get(id).get(number) };
  } };
  const bind = () => {
    const pinned = epoch;
    return createNativeMuseBinding({ store, artifacts, config, actor, operators: [actor], expectedHost: 'fixture.test',
      run: (callback, { active }) => context.run({ epoch: pinned, active }, async () => { check(); const result = await callback(); check(); return result; }),
      readBody: async req => { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks)); },
      respond: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } });
  };
  let binding = bind();
  const server = http.createServer(async (req, res) => {
    try { await binding.handle(req, res, new URL(req.url, 'http://fixture.test').pathname); }
    catch (error) { res.writeHead(error.status ?? 500); res.end(JSON.stringify({ error: { code: error.code, message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await binding.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const call = (path, body) => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: server.address().port,
      path: '/api/muse-worker/v1/tasks/' + path, method: 'POST',
      headers: { Host: 'fixture.test', Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } }, response => {
      const chunks = []; response.on('data', c => chunks.push(c)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); request.on('error', reject); request.end(JSON.stringify(body));
  });
  const desk = binding.bindDesk(actor);
  const { order } = await desk.create({ requestId: 'original-order', serviceId: 'channel-validation', product: 'Synthetic public fixture',
    market: 'US', objective: 'Contract fixture; no research or paid execution.', budgetCredits: 5,
    deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true });
  await desk.approve(order.id, { confirmed: true }); await desk.dispatch(order.id);
  const claimed = await call(order.id + '/claim', { requestId: 'original-claim' }); assert.equal(claimed.status, 200);
  const attempt = { attemptId: claimed.body.attemptId, fence: claimed.body.fence };
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId: order.id,
    deliverables: [{ name: 'Fixture report', type: 'report', summary: 'No real research.' }],
    evidence: [{ title: 'Fixture URL', url: 'https://www.loc.gov/about/', detail: 'Synthetic contract evidence.' }] }));
  const upload = await call(order.id + '/upload-file', { ...attempt, uploadId: 'original-upload', filename: 'fixture.json',
    base64: bytes.toString('base64'), sha256: hash(bytes) }); assert.equal(upload.status, 201);
  const result = await call(order.id + '/submit-result', { ...attempt, requestId: 'original-submit', summary: 'Synthetic fixture only.',
    sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Muse execution was not performed; isolated local contract fixture.' });
  assert.equal(result.status, 200);
  const agent = { session: { id: actor.nativeAgentId, ownEvents: () => structuredClone(events) }, send(message, mode, run) {
    assert.equal(mode, 'next-step'); assert.equal(run, false);
    events.push({ type: 'agent/inbox/spliced', data: { inserted: [structuredClone(message)] } });
  } };
  const ctx = { agents: { get: id => id === actor.nativeAgentId ? agent : undefined }, sessions: { flush: async () => flushResult } };
  const service = { muse: { bindSession: a => binding.bindSession(a) } };
  return { store, desk, bytes, ctx, blobs, events, orderId: order.id, artifactId: upload.body.artifactId,
    source: () => binding.bindSession(actor), sourceFor: a => binding.bindSession(a), currentDesk: () => binding.bindDesk(actor), relay: () => createMuseSessionRelay({ ctx, service, actor }),
    change: fn => { fn(state); }, pause: () => { paused = true; }, revoke: () => { epoch++; },
    failFlush: value => { flushResult = !value; }, failNextAck: () => { failAck = true; },
    async remount() { await binding.close(); binding = bind(); } };
}

test('original Muse REST result returns once to original Session and UI, without acceptance or execution', async t => {
  const f = await fixture(t), relay = f.relay();
  assert.equal((await f.source().view())[0].receipt, null);
  await Promise.all([relay.reconcile(), relay.reconcile()]);
  const item = (await f.source().view())[0];
  assert.equal(item.returnedHash, item.receiptHash); assert.equal(item.acceptedAt, null);
  assert.equal(item.status, 'review_required'); assert.equal(item.receipt.independentlyVerified, false);
  assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 1);
  assert.equal(f.store.read().conversations[0].id, actor.nativeAgentId);
  assert.equal(item.receipt.submitHash, f.store.read().museTasks[0].submitHash);
  await relay.reconcile(); await f.remount(); await f.relay().reconcile();
  assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 1);
  await f.currentDesk().accept(f.orderId, { confirmed: true });
  assert.equal((await f.source().view())[0].status, 'accepted');
  assert.equal((await f.source().view())[0].receiptHash, item.receiptHash);
});

test('native persistence failure leaves business unacknowledged and retries the same message', async t => {
  const f = await fixture(t), relay = f.relay(); f.failFlush(true);
  await assert.rejects(relay.reconcile(), { code: 'WORKSPACE_MUSE_PERSISTENCE' });
  assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 0);
  assert.equal((await f.source().view())[0].returnedHash, null);
  f.failFlush(false); await relay.reconcile(); assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 1);
});

test('business acknowledgement failure after native save does not duplicate the original Session notice', async t => {
  const f = await fixture(t), relay = f.relay(); f.failNextAck();
  await assert.rejects(relay.reconcile(), /Simulated business writer failure/);
  assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 0);
  await relay.reconcile(); assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 1);
});

test('exact file download pins first version and actual bytes, never the mutable latest version', async t => {
  const f = await fixture(t); await f.source().refreshSubmitted();
  const file = (await f.source().view())[0].receipt.files[0];
  const newer = Buffer.from('Unrelated newer version'); f.blobs.get(file.id).set(2, newer);
  f.change(state => { const artifact = state.artifacts[0]; artifact.currentVersion = 2;
    artifact.versions.push({ version: 2, filename: 'other.json', sha256: hash(newer) }); });
  assert.deepEqual((await f.source().download({ artifactId: file.id, version: 1, sha256: file.sha256 })).bytes, f.bytes);
  await assert.rejects(f.source().download({ artifactId: file.id, version: 2, sha256: hash(newer) }), { code: 'MW_SESSION_FILE_NOT_FOUND' });
  f.blobs.get(file.id).set(1, Buffer.from('Corrupted bytes'));
  await assert.rejects(f.relay().reconcile(), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  assert.equal(f.events.length, 0); assert.equal(f.store.read().messages.length, 0);
});

test('foreign actor, native Session, original attempt, fence and report tampering are rejected', async t => {
  const f = await fixture(t); await f.source().refreshSubmitted();
  assert.throws(() => f.sourceFor({ ...actor, subject: 'foreign-owner' }), { code: 'MUSE_OWNER_REQUIRED' });
  assert.throws(() => f.sourceFor({ ...actor, nativeAgentId: 'foreign-session' }), { code: 'MUSE_OWNER_REQUIRED' });
  assert.equal(f.ctx.agents.get('foreign-session'), undefined);
  for (const change of [
    state => { state.artifacts[0].metadata.museNativeAgentId = 'foreign-session'; },
    state => { state.museTasks[0].files[0].attemptId = 'different-attempt'; },
    state => { state.museTasks[0].fence = 0; },
    state => { state.museTasks[0].summary = 'Changed evidence'; },
    state => { state.workerOrders[0].museSession.nativeAgentId = 'foreign-session'; },
  ]) {
    const previous = f.store.read(); f.change(change);
    await assert.rejects(f.relay().reconcile(), { code: 'MW_SESSION_RECEIPT_CHANGED' });
    f.change(state => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, previous); });
  }
  await f.relay().reconcile();
  f.change(state => { state.workerOrders[0].workerReport.deliverables[0].summary = 'Changed returned report'; });
  await assert.rejects(f.source().view(), { code: 'MW_SESSION_RECEIPT_CHANGED' }); assert.equal(f.events.length, 1);
});

test('paused scope permits original result reconciliation while changed epoch revokes cached handles', async t => {
  const f = await fixture(t), source = f.source(); f.pause(); await f.relay().reconcile();
  assert((await source.view())[0].returnedHash);
  f.revoke(); await assert.rejects(source.view(), { code: 'WORKSPACE_PLUGIN_STALE' });
  await assert.rejects(f.relay().reconcile(), { code: 'WORKSPACE_PLUGIN_STALE' });
  assert.equal(f.events.length, 1);
});

test('scope change during native flush preserves the original message without acknowledging stale authority', async t => {
  const f = await fixture(t); f.ctx.sessions.flush = async () => { f.revoke(); return true; };
  await assert.rejects(f.relay().reconcile(), { code: 'WORKSPACE_PLUGIN_STALE' });
  assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 0);
  f.ctx.sessions.flush = async () => true; await f.remount(); await f.relay().reconcile();
  assert.equal(f.events.length, 1); assert.equal(f.store.read().messages.length, 1);
});

test('conflicting original native notice or business conversation cannot be replaced', async t => {
  const f = await fixture(t); await f.source().refreshSubmitted();
  const id = f.source().messageId(f.orderId);
  f.events.push({ type: 'agent/inbox/spliced', data: { inserted: [{ id, role: 'user', source: { kind: 'workspace-muse' }, content: [{ type: 'text', text: 'Conflicting original receipt' }] }] } });
  await assert.rejects(f.relay().reconcile(), { code: 'WORKSPACE_MUSE_RECEIPT_CHANGED' });
  f.events.length = 0;
  f.change(state => { state.conversations.push({ id: actor.nativeAgentId, subject: 'foreign-owner', nativeAgentId: actor.nativeAgentId }); });
  await assert.rejects(f.relay().reconcile(), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  assert.equal(f.store.read().messages.length, 0);
});

test('unsupported or altered durable receipt state is preserved and rejected', () => {
  assert.throws(() => validateMuseSessionReceipts({ version: 2, receipts: [] }), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  assert.throws(() => validateMuseSessionReceipts({ version: 1, receipts: [{ receipt: {}, receiptHash: 'wrong' }] }), { code: 'MW_SESSION_RECEIPT_CHANGED' });
});

test('orphaned acknowledged order and missing native notice cannot cause replacement work', async t => {
  const f = await fixture(t); await f.relay().reconcile();
  const original = f.store.read();
  f.change(state => { state.workerOrders = []; });
  await assert.rejects(f.source().view(), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  f.change(state => { Object.assign(state, original); });
  f.events.length = 0;
  await assert.rejects(f.relay().reconcile(), { code: 'WORKSPACE_MUSE_RECEIPT_CHANGED' });
  assert.equal(f.store.read().museTasks.length, 1); assert.equal(f.store.read().messages.length, 1);
});

test('recovery cannot silently discard receipts belonging to a removed actor or changed Worker mount', async t => {
  const f = await fixture(t); await f.relay().reconcile();
  const previous = f.store.read(), saved = previous.workspaceMuseSessionReceipts;
  assert.throws(() => validateMuseSessionReceipts(saved, { operators: [{ subject: 'other-owner', nativeAgentId: 'other-session' }], orders: previous.workerOrders }), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  assert.throws(() => validateMuseSessionReceipts(saved, { operators: [actor], orders: [] }), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  for (const change of [
    state => { state.workerOrders[0].workerId = 'foreign-worker'; },
    state => { state.workerOrders[0].museSession.nativeAgentId = 'foreign-session'; },
    state => { state.workerOrders[0].requestId = 'replacement-request'; },
    state => { state.messages = []; },
    state => { state.messages[0].content = 'Replacement result'; },
    state => { state.conversations[0].subject = 'foreign-owner'; },
  ]) {
    f.change(change); await assert.rejects(f.source().view(), { code: 'MW_SESSION_RECEIPT_CHANGED' });
    f.change(state => { Object.assign(state, structuredClone(previous)); });
  }
  // Self-consistent record/order drift is still rejected against the fixed,
  // original Muse mount instead of being filtered out of its projection.
  f.change(state => {
    const row = state.workspaceMuseSessionReceipts.receipts[0], order = state.workerOrders[0];
    row.workerId = 'foreign-worker'; row.receipt.workerId = 'foreign-worker';
    row.receiptHash = hash(JSON.stringify(row.receipt));
    row.nativeMessageId = 'workspace-muse-result-' + hash(JSON.stringify([actor.subject, actor.nativeAgentId, row.workerId, row.orderId]));
    order.workerId = row.workerId; order.museSession.workerId = row.workerId;
  });
  await assert.rejects(f.source().view(), { code: 'MW_SESSION_RECEIPT_CHANGED' });
  assert.equal(f.events.length, 1); assert.equal(f.store.read().museTasks.length, 1);
});
