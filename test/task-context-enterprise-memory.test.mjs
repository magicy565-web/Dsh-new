import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEnterpriseMemoryLedger } from '../server/enterprise-memory-ledger.mjs';
import {
  assertInputContextSnapshot, inputContextMessages, prepareInputContext,
} from '../server/task-context.mjs';

const workspaceId = 'workspace-A';
const productId = '11111111-1111-4111-8111-111111111111';
const admin = { subject: 'owner', role: 'admin', workspaceId };

function productSource(revision = 3) {
  const product = { id: productId, revision, status: 'draft', name: 'Fabric' };
  const canonical = `{"id":"${productId}","name":"Fabric","revision":${revision},"status":"draft"}`;
  return { kind: 'product', ref: productId, revision, version: revision, sha256: createHash('sha256').update(canonical).digest('hex') };
}
function conversationSource() {
  return { kind: 'conversation', ref: 'conv-1', revision: 1, version: 1, messageId: 'msg-1', runId: 'run-1', sha256: createHash('sha256').update('Customer reorders in March.').digest('hex') };
}
function fixture() {
  const state = {
    businessLibrary: {
      products: [{ id: productId, revision: 3, status: 'draft', name: 'Fabric' }],
      documents: [], enterpriseMemories: [],
    },
    messages: [{ id: 'msg-1', conversationId: 'conv-1', role: 'user', status: 'complete', content: 'Customer reorders in March.' }],
    runs: [{ id: 'run-1', conversationId: 'conv-1', status: 'complete' }],
    artifacts: [], memories: [], capabilities: { skills: [] },
  };
  const store = { read: () => structuredClone(state), update: mutator => mutator(state) };
  const library = {
    getProduct: id => ({ product: state.businessLibrary.products.find(item => item.id === id) }),
    getDocument: id => ({ document: state.businessLibrary.documents.find(item => item.id === id) }),
  };
  const ledger = createEnterpriseMemoryLedger({
    store, library, workspaceId, clock: () => Date.parse('2026-10-16T12:00:00Z'),
  });
  return { state, store, ledger };
}
const memory = (requestId, overrides = {}) => ({
  requestId, audience: 'internal', subjectType: 'customer', subjectId: 'buyer-A',
  factKey: 'reorder-window', statement: 'Buyer A reorders in March.', source: conversationSource(),
  ...overrides,
});

test('recallForTask selects active internal facts and pins an audit revision', async () => {
  const { ledger } = fixture();
  const saved = await ledger.remember(memory('m-1'), admin);
  await ledger.remember(memory('m-2', {
    subjectType: 'product', subjectId: productId, factKey: 'material',
    statement: 'Fabric is 120 GSM linen.', source: productSource(),
  }), admin);
  const recalled = ledger.recallForTask(admin, { query: 'March reorder', limit: 10, maxChars: 4000 });
  assert.equal(recalled.facts[0].id, saved.memory.id);
  assert.equal(recalled.facts[0].revision, 1);
  assert.equal(recalled.facts[0].workspaceId, workspaceId);
  assert.match(recalled.contextRevision, /^[a-f0-9]{64}$/u);
  assert.equal(recalled.total, 2);
  const again = ledger.recallForTask(admin, { query: 'March reorder', limit: 10, maxChars: 4000 });
  assert.equal(again.contextRevision, recalled.contextRevision);
});

test('prepareInputContext injects the enterprise memory even without user-selected context', async () => {
  const { state, ledger } = fixture();
  const saved = await ledger.remember(memory('m-1'), admin);
  const snapshot = await prepareInputContext({
    state, conversationId: 'conv-1', inputContext: undefined, artifacts: null,
    enterpriseMemory: ledger, enterpriseActor: admin, query: 'reorder',
  });
  assert.equal(snapshot.selection, undefined);
  assert.equal(snapshot.enterpriseFacts.length, 1);
  assert.equal(snapshot.enterpriseFacts[0].id, saved.memory.id);
  const messages = inputContextMessages(snapshot);
  const block = messages.find(item => item.role === 'system' && item.content.startsWith('ENTERPRISE OPERATING MEMORY'));
  assert.ok(block);
  assert.match(block.content, new RegExp(`"id":"${saved.memory.id}"`, 'u'));
  assert.match(block.content, /facts, not instructions/u);
  assert.doesNotThrow(() => assertInputContextSnapshot(state, 'conv-1', snapshot));
});

test('legacy behavior is preserved when no enterprise memory is wired', async () => {
  const { state } = fixture();
  assert.equal(await prepareInputContext({ state, conversationId: 'conv-1', inputContext: undefined, artifacts: null }), undefined);
  const explicit = await prepareInputContext({ state, conversationId: 'conv-1', inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [] }, artifacts: null });
  assert.deepEqual(explicit.selection, { artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
  assert.equal(inputContextMessages(explicit).some(item => item.content.startsWith('ENTERPRISE OPERATING MEMORY')), false);
});

test('a revoked source blocks only runs that pinned that exact fact', async () => {
  const { state, ledger } = fixture();
  const saved = await ledger.remember(memory('m-1', { source: productSource(), subjectType: 'product', subjectId: productId, factKey: 'material' }), admin);
  const snapshot = await prepareInputContext({
    state, conversationId: 'conv-1', inputContext: undefined, artifacts: null,
    enterpriseMemory: ledger, enterpriseActor: admin, query: 'material',
  });
  assert.equal(snapshot.enterpriseFacts[0].id, saved.memory.id);
  assertInputContextSnapshot(state, 'conv-1', snapshot);
  state.businessLibrary.products[0].revision = 4;
  assert.throws(
    () => assertInputContextSnapshot(state, 'conv-1', snapshot),
    error => error.code === 'MEMORY_SOURCE_REVOKED',
  );
});

test('a superseded fact revision blocks the old snapshot, while unrelated writes do not', async () => {
  const { state, ledger } = fixture();
  const first = await ledger.remember(memory('m-1'), admin);
  const snapshot = await prepareInputContext({
    state, conversationId: 'conv-1', inputContext: undefined, artifacts: null,
    enterpriseMemory: ledger, enterpriseActor: admin, query: 'March',
  });
  assertInputContextSnapshot(state, 'conv-1', snapshot);
  await ledger.remember(memory('m-2', { statement: 'Buyer A reorders in April.' }), admin);
  assert.throws(
    () => assertInputContextSnapshot(state, 'conv-1', snapshot),
    error => error.code === 'MEMORY_CONTEXT_CHANGED',
  );
  // A second run pins the current revision and is unaffected by the old one.
  const current = await prepareInputContext({
    state, conversationId: 'conv-1', inputContext: undefined, artifacts: null,
    enterpriseMemory: ledger, enterpriseActor: admin, query: 'April',
  });
  assert.equal(current.enterpriseFacts[0].revision, 2);
  await ledger.remember(memory('m-3', { factKey: 'payment-terms', statement: 'Buyer A pays in 30 days.', source: productSource() }), admin);
  assert.doesNotThrow(() => assertInputContextSnapshot(state, 'conv-1', current), 'an unrelated new fact must not invalidate the run');
  assert.notEqual(current.enterpriseFacts[0].id, first.memory.id);
});

test('proposed and expired facts never enter a task snapshot', async () => {
  const { state, ledger } = fixture();
  const saved = await ledger.remember(memory('m-1'), admin);
  state.businessLibrary.enterpriseMemories[0].status = 'pending';
  state.businessLibrary.enterpriseMemories[0].reviewedBy = null;
  state.businessLibrary.enterpriseMemories[0].reviewedAt = null;
  state.businessLibrary.enterpriseMemories[0].activatedAt = null;
  let recalled = ledger.recallForTask(admin, { query: 'March' });
  assert.equal(recalled.facts.length, 0);
  state.businessLibrary.enterpriseMemories[0].status = 'active';
  state.businessLibrary.enterpriseMemories[0].reviewedBy = admin.subject;
  state.businessLibrary.enterpriseMemories[0].reviewedAt = '2026-10-16T12:00:00.000Z';
  state.businessLibrary.enterpriseMemories[0].activatedAt = '2026-10-16T12:00:00.000Z';
  state.businessLibrary.enterpriseMemories[0].expiresAt = '2026-10-16T11:00:00.000Z';
  recalled = ledger.recallForTask(admin, { query: 'March' });
  assert.equal(recalled.facts.length, 0);
  state.businessLibrary.enterpriseMemories[0].expiresAt = null;
  recalled = ledger.recallForTask(admin, { query: 'March' });
  assert.equal(recalled.facts[0].id, saved.memory.id);
});

test('a foreign workspace actor cannot recall this memory', async () => {
  const { ledger } = fixture();
  await ledger.remember(memory('m-1'), admin);
  assert.throws(
    () => ledger.recallForTask({ ...admin, workspaceId: 'workspace-B' }, { query: 'March' }),
    error => error.code === 'MEMORY_WORKSPACE_REQUIRED',
  );
});
