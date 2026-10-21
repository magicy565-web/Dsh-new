import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createRuntime } from '../server/runtime.mjs';
import { createEnterpriseMemoryLedger } from '../server/enterprise-memory-ledger.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check) { for (let count = 0; count < 500; count++) { if (await check()) return; await sleep(5); } throw new Error('Fixture condition timed out'); }

const productId = '11111111-1111-4111-8111-111111111111';
const admin = { subject: 'owner', role: 'admin', workspaceId: 'local' };
function productSource(revision = 1) {
  const product = { id: productId, revision, status: 'draft', name: 'Linen' };
  const canonical = `{"id":"${productId}","name":"Linen","revision":${revision},"status":"draft"}`;
  return { kind: 'product', ref: productId, revision, version: revision, sha256: createHash('sha256').update(canonical).digest('hex') };
}

async function fixture(t, { capture = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-memory-runtime-'));
  const store = await openStore(directory);
  const library = {
    getProduct: id => ({ product: store.read().businessLibrary.products.find(item => item.id === id) }),
    getDocument: id => ({ document: store.read().businessLibrary.documents.find(item => item.id === id) }),
  };
  const ledger = createEnterpriseMemoryLedger({ store, library, workspaceId: 'local' });
  await store.update(state => { state.businessLibrary.products.push({ id: productId, revision: 1, status: 'draft', name: 'Linen' }); });
  const saved = await ledger.remember({
    requestId: 'task-memory-1', audience: 'internal', subjectType: 'product', subjectId: productId,
    factKey: 'material', statement: 'The product uses 120 GSM linen.', source: productSource(),
  }, admin);
  const seen = [];
  const runtime = await createRuntime({
    store,
    provider: { configured: true, complete: async ({ messages }) => { if (capture) seen.push(messages); return { content: 'Fixture answer' }; } },
    enterpriseMemory: ledger,
    memoryWorkspaceId: 'local',
  });
  t.after(async () => { await runtime.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { runtime, store, saved, seen };
}

test('fixture: every run pins enterprise memory into its prompt snapshot', async t => {
  const { runtime, saved, seen } = await fixture(t, { capture: true });
  const { conversation } = await runtime.createConversation({});
  const sent = await runtime.sendMessage(conversation.id, { content: 'What material does the product use?', requestId: 'memory-run-1' });
  await until(() => runtime.getRun(sent.run.id).run.status === 'succeeded');
  const run = runtime.getRun(sent.run.id).run;
  assert.equal(run.inputContextSnapshot.enterpriseFacts.length, 1);
  assert.equal(run.inputContextSnapshot.enterpriseFacts[0].id, saved.memory.id);
  assert.match(run.inputContextSnapshot.enterpriseRevision, /^[a-f0-9]{64}$/u);
  const block = seen[0].find(message => message.role === 'system' && message.content.startsWith('ENTERPRISE OPERATING MEMORY'));
  assert.ok(block, 'the provider received the enterprise memory block');
  assert.match(block.content, /120 GSM linen/u);
  assert.match(block.content, new RegExp(saved.memory.id, 'u'));
});

test('fixture: a changed source is excluded from the next run instead of being presented as current', async t => {
  const { runtime, store } = await fixture(t);
  const { conversation } = await runtime.createConversation({});
  const first = await runtime.sendMessage(conversation.id, { content: 'What material?', requestId: 'memory-run-2a' });
  await until(() => runtime.getRun(first.run.id).run.status === 'succeeded');
  assert.equal(runtime.getRun(first.run.id).run.inputContextSnapshot.enterpriseFacts.length, 1);
  await store.update(state => { state.businessLibrary.products[0].revision = 2; });
  const second = await runtime.sendMessage(conversation.id, { content: 'And now?', requestId: 'memory-run-2b' });
  await until(() => ['succeeded', 'failed', 'blocked', 'interrupted'].includes(runtime.getRun(second.run.id).run.status));
  const run = runtime.getRun(second.run.id).run;
  assert.equal(run.inputContextSnapshot.enterpriseFacts.length, 0);
  assert.equal(run.inputContextSnapshot.enterpriseWarning?.code, 'MEMORY_SOURCE_SKIPPED');
});
