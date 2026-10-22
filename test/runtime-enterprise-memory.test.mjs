import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createRuntime } from '../server/runtime.mjs';
import { createEnterpriseMemoryLedger } from '../server/enterprise-memory-ledger.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check) { for (let count = 0; count < 500; count++) { if (await check()) return; await sleep(5); } throw new Error('Fixture condition timed out'); }

const productId = '11111111-1111-4111-8111-111111111111';
const admin = { subject: 'owner', role: 'admin', workspaceId: 'local' };
function productSource(revision = 1) {
  const canonical = `{"id":"${productId}","name":"Linen","revision":${revision},"status":"draft"}`;
  return { kind: 'product', ref: productId, revision, version: revision, sha256: createHash('sha256').update(canonical).digest('hex') };
}

async function fixture(t, { capture = false, provider = null, maxConcurrentRuns = 3 } = {}) {
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
    maxConcurrentRuns,
    provider: provider ?? {
      configured: true,
      complete: async ({ messages }) => { if (capture) seen.push(messages); return { content: 'Fixture answer' }; },
    },
    enterpriseMemory: ledger,
    memoryWorkspaceId: 'local',
  });
  t.after(async () => { await runtime.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { runtime, store, saved, seen, ledger };
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

test('fixture: a queued run cannot dispatch after its pinned memory source is revoked', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const { runtime, store } = await fixture(t, {
    maxConcurrentRuns: 1,
    provider: {
      configured: true,
      complete: async () => { calls += 1; if (calls === 1) await gate; return { content: 'Fixture answer' }; },
    },
  });
  const firstConversation = (await runtime.createConversation({})).conversation;
  const secondConversation = (await runtime.createConversation({})).conversation;
  const first = await runtime.sendMessage(firstConversation.id, { content: 'First task', requestId: 'memory-queued-1' });
  await until(() => runtime.getRun(first.run.id).run.status === 'running' && calls === 1);
  const second = await runtime.sendMessage(secondConversation.id, { content: 'Second task', requestId: 'memory-queued-2', queued: true });
  assert.equal(runtime.getRun(second.run.id).run.status, 'queued');
  assert.equal(runtime.getRun(second.run.id).run.inputContextSnapshot.enterpriseFacts.length, 1);
  await store.update(state => { state.businessLibrary.products[0].revision = 2; });
  release();
  await until(() => ['failed', 'blocked'].includes(runtime.getRun(second.run.id).run.status));
  assert.equal(runtime.getRun(second.run.id).run.error?.code, 'MEMORY_SOURCE_REVOKED');
  assert.equal(calls, 1, 'the revoked queued run never reached the provider');
});

test('fixture: retry prepares fresh enterprise memory and never reuses the failed snapshot', async t => {
  let calls = 0; const seen = [];
  const { runtime, saved } = await fixture(t, {
    provider: {
      configured: true,
      complete: async ({ messages }) => {
        calls += 1;
        seen.push(messages);
        if (calls === 1) throw new Error('Fixture provider failure');
        return { content: 'Retried fixture answer' };
      },
    },
  });
  const { conversation } = await runtime.createConversation({});
  const first = await runtime.sendMessage(conversation.id, { content: 'What material?', requestId: 'memory-retry-1' });
  await until(() => runtime.getRun(first.run.id).run.status === 'failed');
  const retried = await runtime.retryRun(first.run.id, { requestId: randomUUID() });
  await until(() => runtime.getRun(retried.run.id).run.status === 'succeeded');
  const retriedRun = runtime.getRun(retried.run.id).run;
  assert.equal(retriedRun.inputContextSnapshot.enterpriseFacts.length, 1);
  assert.equal(retriedRun.inputContextSnapshot.enterpriseFacts[0].id, saved.memory.id);
  const block = seen.at(-1).find(message => message.role === 'system' && message.content.startsWith('ENTERPRISE OPERATING MEMORY'));
  assert.ok(block);
});

test('fixture: updating conversation inputs still prepares enterprise memory', async t => {
  const { runtime } = await fixture(t);
  const { conversation } = await runtime.createConversation({});
  const updated = await runtime.updateConversationInputContext(conversation.id, {
    inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [] },
  });
  assert.deepEqual(updated.conversation.inputContext, { artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
  const sent = await runtime.sendMessage(conversation.id, { content: 'What material?', requestId: 'memory-update-context-1' });
  await until(() => runtime.getRun(sent.run.id).run.status === 'succeeded');
  assert.equal(runtime.getRun(sent.run.id).run.inputContextSnapshot.enterpriseFacts.length, 1);
});
