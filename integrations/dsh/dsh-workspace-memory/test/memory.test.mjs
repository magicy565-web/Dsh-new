import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createMemoryService, createStorageAdapter, validateRoot } from '../service.js';
import { registerTools, createHttpHandler, API_PREFIX, domainSpec } from '../index.js';
import { LibraryStore, createLibraryService } from '../../dsh-workspace-library/index.js';

const alpha = '11111111-1111-4111-8111-111111111111', beta = '22222222-2222-4222-8222-222222222222';
function fixture(options = {}) {
  let value = {};
  const global = { get: () => value, async set(next) { value = structuredClone(next); } };
  const storage = createStorageAdapter(global);
  const workspaces = [{ id: alpha, title: 'Alpha', sessionIds: ['session-alpha'] }, { id: beta, title: 'Beta', sessionIds: ['session-beta'] }];
  const registry = { list: () => workspaces, get: id => workspaces.find(item => item.id === id) };
  const service = createMemoryService({ storage, registry, ...options });
  return { service, global, storage, registry };
}
const execution = (id = 'session-alpha', signal = new AbortController().signal) => ({ callId: 'call-native-1', agent: { session: { id } }, signal });
const proposal = (changes = {}) => ({ requestId: randomUUID(), subjectType: 'company', subjectId: 'company', subjectLabel: '演示企业', factKey: 'moq', statement: '起订量为 300 件。', kind: 'fact', ...changes });
const humanProposal = (changes = {}) => proposal({ source: { kind: 'operator', basis: '负责人于今天确认', label: '人工陈述' }, ...changes });
async function approve(service, id, workspace = alpha, changes = {}) {
  return service.review(workspace, id, { requestId: randomUUID(), expectedRevision: (await service.state(workspace)).revision, decision: 'approve', ...changes });
}
async function library(t) {
  const dir = await mkdtemp(join(tmpdir(), 'native-memory-library-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LibraryStore({ dir });
  return { library: createLibraryService(store), store };
}

test('Agent proposals stay pending, are scoped from native sessions and cannot carry authority fields', async () => {
  const { service } = fixture();
  const record = (await service.toolPropose(proposal(), execution())).record;
  assert.equal(record.status, 'proposed');
  assert.equal(record.source.kind, 'conversation');
  assert.equal(record.source.verified, false);
  assert.match(record.source.ref, /conversation:session-alpha#tool:call-native-1/u);
  const labelled = (await service.toolPropose(proposal({ source: { kind: 'conversation', label: '用户确认的偏好' } }), execution())).record;
  assert.equal(labelled.source.kind, 'conversation');
  assert.equal(labelled.source.verified, false);
  assert.equal(labelled.source.label, 'DSH conversation / tool call', 'native host owns the stored label and pointer');
  const recalled = await service.recall({}, execution());
  assert.equal(recalled.items.length, 0);
  assert.equal(recalled.searchScope, 'approved-active-only');
  assert.equal(recalled.population.proposed, 2);
  assert.equal(recalled.population.active, 0);
  assert.equal(JSON.stringify(recalled).includes(record.statement), false, 'population counts never reveal pending statements');
  assert.equal((await service.state(beta)).items.length, 0);
  for (const field of ['activate', 'actor', 'role', 'workspaceId', 'reviewedBy']) {
    await assert.rejects(() => service.toolPropose({ ...proposal(), [field]: true }, execution()), { code: 'MEMORY_INPUT' });
  }
  await assert.rejects(() => service.toolPropose(proposal(), {}), { code: 'MEMORY_WORKSPACE_REQUIRED' });
  await assert.rejects(() => service.toolPropose(proposal(), execution('session-unknown')), { code: 'MEMORY_WORKSPACE_REQUIRED' });
  await assert.rejects(() => service.toolPropose(proposal({ source: { kind: 'conversation', ref: 'forged' } }), execution()), { code: 'MEMORY_INPUT' });
  await assert.rejects(() => service.read(beta, record.id), { code: 'BUSINESS_MEMORY_NOT_FOUND' });
  await service.close();
});

test('human review, stale revisions, stable retries, superseding and revocation govern recall', async () => {
  const { service, global, registry } = fixture();
  const body = humanProposal();
  const first = (await service.propose(alpha, body)).record;
  assert.equal((await service.propose(alpha, body)).record.id, first.id);
  await assert.rejects(() => service.review(alpha, first.id, { requestId: randomUUID(), expectedRevision: 0, decision: 'approve' }), { code: 'MEMORY_REVISION_CONFLICT' });
  const review = { requestId: randomUUID(), expectedRevision: 1, decision: 'approve' };
  await service.review(alpha, first.id, review);
  assert.equal((await service.review(alpha, first.id, review)).idempotent, true);
  assert.equal((await service.recall({}, execution())).items[0].id, first.id);
  const second = (await service.propose(alpha, humanProposal({ statement: '起订量改为 500 件。', supersedesId: first.id }))).record;
  await approve(service, second.id);
  const recalled = await service.recall({}, execution());
  assert.deepEqual(recalled.items.map(item => item.id), [second.id]);
  assert.equal((await service.read(alpha, first.id)).record.status, 'superseded');
  await service.revoke(alpha, second.id, { requestId: randomUUID(), expectedRevision: (await service.state(alpha)).revision, reason: '不再适用' });
  assert.equal((await service.recall({}, execution())).items.length, 0);
  const reopened = createMemoryService({ storage: createStorageAdapter(global), registry });
  assert.equal((await reopened.read(alpha, second.id)).record.status, 'revoked');
  assert.ok(global.get().workspaces[alpha].harnessBusinessMemory);
  await Promise.all([service.close(), reopened.close()]);
});

test('exact native document pins are verified on propose, approval and recall, without substituting latest', async t => {
  const { library: source, store } = await library(t);
  const { service } = fixture({ getLibrary: () => source });
  const document = await source.addDocument({ title: '政策', content: 'MOQ 300' });
  const pin = { kind: 'document', documentId: document.id, version: 1, sha256: document.versions[0].sha256 };
  const record = (await service.toolPropose(proposal({ source: pin }), execution())).record;
  assert.equal(record.source.sha256, pin.sha256);
  await source.addDocumentVersion(document.id, { content: 'MOQ 900' });
  await approve(service, record.id);
  assert.equal((await service.recall({}, execution())).items[0].source.sha256, pin.sha256);
  const revision = (await source.document(document.id)).document.revision;
  await source.updateDocument(document.id, { expectedRevision: revision, changes: { status: 'archived' } });
  const unavailable = await service.recall({}, execution());
  assert.equal(unavailable.items.length, 0);
  assert.equal(unavailable.excluded[0].code, 'REFERENCE_ARCHIVED');
  const pending = await service.propose(alpha, humanProposal({ factKey: 'other' }));
  await assert.rejects(() => service.propose(alpha, humanProposal({ source: pin })), { code: 'REFERENCE_ARCHIVED' });
  assert.equal((await service.state(alpha)).proposed, 1);
  assert.equal(pending.record.status, 'proposed');
  assert.equal((await store.state()).documents[0].versions[0].content, 'MOQ 300');
  await service.close();
});

test('source loss after proposal prevents approval; forged proofs, unsupported sources and corruption fail closed', async t => {
  const { library: source, store } = await library(t);
  let connected = true;
  const { service } = fixture({ getLibrary: () => connected ? source : null });
  const document = await source.addDocument({ title: '政策', content: 'MOQ 300' });
  const pin = { kind: 'document', documentId: document.id, version: 1, sha256: document.versions[0].sha256 };
  const record = (await service.propose(alpha, humanProposal({ source: pin }))).record;
  connected = false;
  await assert.rejects(() => approve(service, record.id), { code: 'MEMORY_SOURCE_UNAVAILABLE' });
  connected = true;
  await assert.rejects(() => service.toolPropose(proposal({ source: { ...pin, verified: true } }), execution()), { code: 'MEMORY_INPUT' });
  await assert.rejects(() => service.toolPropose(proposal({ source: { kind: 'operator', basis: 'pretend' } }), execution()), { code: 'MEMORY_SOURCE_UNSUPPORTED' });
  await approve(service, record.id);
  (await store.state()).documents[0].versions[0].content = 'corrupt';
  assert.equal((await service.recall({}, execution())).excluded[0].code, 'REFERENCE_CHANGED');
  await service.close();
});

test('expiry, budget bounds and cancellation prevent unusable facts from reaching tools', async () => {
  let now = Date.parse('2026-10-26T00:00:00.000Z');
  const { service } = fixture({ clock: () => now });
  const temporary = (await service.propose(alpha, humanProposal({ expiresAt: '2026-10-27T00:00:00.000Z' }))).record;
  await approve(service, temporary.id);
  now += 2 * 86400000;
  assert.equal((await service.recall({}, execution())).items.length, 0);
  const expired = (await service.propose(alpha, humanProposal({ factKey: 'past', expiresAt: '2026-10-25T00:00:00.000Z' }))).record;
  await assert.rejects(() => approve(service, expired.id), { code: 'MEMORY_EXPIRED' });
  for (let index = 0; index < 16; index++) {
    const record = (await service.propose(alpha, humanProposal({ factKey: `fact-${index}`, statement: 'x'.repeat(1900) }))).record;
    await approve(service, record.id);
  }
  const recall = await service.recall({ limit: 50 }, execution());
  assert.ok(recall.items.length < 16);
  assert.ok(Buffer.byteLength(JSON.stringify(recall.items)) < 24_100);
  assert.ok(recall.omitted > 0);
  await assert.rejects(() => service.toolPropose(proposal(), execution('session-alpha', AbortSignal.abort())), { code: 'MEMORY_CANCELLED' });
  await service.close();
  await assert.rejects(() => service.propose(alpha, humanProposal()), { code: 'MEMORY_CANCELLED' });
});

test('native storage adapter serializes cross-workspace writes, isolates snapshots and rolls back failed durability', async () => {
  const { service, global, storage } = fixture();
  await Promise.all(Array.from({ length: 12 }, (_, index) => service.propose(index % 2 ? alpha : beta, humanProposal({ factKey: `f-${index}` }))));
  assert.equal((await service.state(alpha)).proposed, 6);
  assert.equal((await service.state(beta)).proposed, 6);
  const borrowed = storage.read(); borrowed.workspaces[alpha].harnessBusinessMemory.records.length = 0;
  assert.equal((await service.state(alpha)).proposed, 6);
  const old = global.get(); const original = global.set;
  global.set = async () => { throw new Error('disk full'); };
  await assert.rejects(() => service.propose(alpha, humanProposal()), /disk full/u);
  assert.deepEqual(global.get(), old);
  global.set = original;
  assert.equal(validateRoot(global.get()), true);
  assert.equal(domainSpec.global.schema.safeParse({ workspaces: { fake: {} } }).success, false);
  await service.close();
});

test('cancellation during source verification writes no candidate, and recall detects a concurrent revocation', async t => {
  const { library: source } = await library(t);
  let started, release, block = false;
  const entered = () => new Promise(resolve => { started = resolve; });
  const proxy = {
    checkReferenceSet: refs => source.checkReferenceSet(refs),
    async readReferences(refs, options) {
      if (block) { started(); await new Promise(resolve => { release = resolve; }); }
      return source.readReferences(refs, options);
    },
  };
  const { service } = fixture({ getLibrary: () => proxy });
  const doc = await source.addDocument({ title: 'source', content: 'data' });
  const pin = { kind: 'document', documentId: doc.id, version: 1, sha256: doc.versions[0].sha256 };
  const abort = new AbortController();
  block = true;
  const gate = entered();
  const pending = service.toolPropose(proposal({ source: pin }), execution('session-alpha', abort.signal));
  await gate; abort.abort(); release();
  await assert.rejects(() => pending, { code: 'MEMORY_CANCELLED' });
  block = false;
  assert.equal((await service.state(alpha)).records, 0);
  const first = (await service.propose(alpha, humanProposal({ factKey: 'operator' }))).record;
  const second = (await service.propose(alpha, humanProposal({ factKey: 'document', source: pin }))).record;
  await approve(service, second.id); await approve(service, first.id);
  block = true;
  const reading = entered();
  const recall = service.recall({}, execution());
  await reading;
  // Read revision without asking the UI state to verify this intentionally blocked source.
  const revision = 4;
  await service.revoke(alpha, first.id, { requestId: randomUUID(), expectedRevision: revision, reason: 'concurrent revoke' });
  release(); block = false;
  await assert.rejects(() => recall, { code: 'MEMORY_CHANGED' });
  await service.close();
});

test('a source archived during later source IO invalidates the whole selected document set', async t => {
  const { library: source } = await library(t);
  let now = Date.parse('2026-10-26T00:00:00.000Z');
  const first = await source.addDocument({ title: 'first', content: 'first' });
  const second = await source.addDocument({ title: 'second', content: 'second' });
  let duringRecall = false;
  const proxy = {
    checkReferenceSet: refs => source.checkReferenceSet(refs),
    async readReferences(refs, options) {
      const result = await source.readReferences(refs, options);
      if (duringRecall && refs[0].documentId === second.id)
        await source.updateDocument(first.id, { expectedRevision: 1, changes: { status: 'archived' } });
      return result;
    },
  };
  const { service } = fixture({ getLibrary: () => proxy, clock: () => now });
  const records = [];
  for (const [index, doc] of [first, second].entries()) {
    records.push((await service.propose(alpha, humanProposal({ factKey: `source-${index}`, source: { kind: 'document', documentId: doc.id, version: 1, sha256: doc.versions[0].sha256 } }))).record);
  }
  await approve(service, records[1].id); now += 1000; await approve(service, records[0].id);
  duringRecall = true;
  await assert.rejects(() => service.recall({}, execution()), { code: 'REFERENCE_ARCHIVED' });
  await service.close();
});

test('HTTP shares native authentication, fences origin and body fields, and preserves review error codes', async t => {
  const { service } = fixture();
  t.after(() => service.close());
  const server = createServer(createHttpHandler(service, { authorize: req => req.headers.cookie === 'native=yes' ? undefined : 401 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}${API_PREFIX}/workspaces/${alpha}`;
  const send = (path, body, extra = {}) => fetch(url + path, { method: 'POST', headers: { cookie: 'native=yes', 'content-type': 'application/json', origin, ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(origin + API_PREFIX + '/workspaces')).status, 401);
  assert.equal((await send('/proposals', humanProposal(), { origin: 'https://other.example' })).status, 403);
  const response = await send('/proposals', humanProposal());
  const id = (await response.json()).data.record.id;
  assert.equal(response.status, 200);
  const stale = await send(`/memories/${id}/review`, { requestId: randomUUID(), expectedRevision: 0, decision: 'approve' });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'MEMORY_REVISION_CONFLICT');
  assert.equal((await send('/proposals', { ...humanProposal(), actor: { role: 'admin' } })).status, 400);
  assert.equal((await fetch(url + '/state', { headers: { cookie: 'native=yes' } })).status, 200);
  const unsecured = createHttpHandler(service);
  const closedServer = createServer(unsecured);
  await new Promise(resolve => closedServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => closedServer.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${closedServer.address().port}${API_PREFIX}/workspaces`)).status, 401);
});

test('only propose and recall are registered; no model approval or review tool exists', async () => {
  const { service } = fixture();
  const definitions = new Map(), disposers = [];
  registerTools({ effect(fn) { disposers.push(fn()); }, tools: { register(def) { definitions.set(def.name, def); return () => definitions.delete(def.name); } } }, service);
  assert.deepEqual([...definitions.keys()], ['business_memory_propose', 'business_memory_recall']);
  const def = definitions.get('business_memory_propose');
  assert.equal(def.parameters.additionalProperties, false);
  assert.equal((await def.execute(proposal(), execution())).record.status, 'proposed');
  assert.equal((await definitions.get('business_memory_recall').execute({}, execution())).items.length, 0);
  disposers.forEach(dispose => dispose());
  assert.equal(definitions.size, 0);
  await service.close();
});
