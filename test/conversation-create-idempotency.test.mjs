import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createApp } from '../server/index.mjs';

test('conversation creation retains exact subject/body receipts across concurrency, restart and deletion', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-create-contract-');
  let app = await createApp({ dataDirectory: directory });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = { title: 'Main fixture', requestId: 'one-original-create' };
  const actor = { subject: 'fixture-owner', workspaceId: 'fixture-workspace' };
  const results = await Promise.all([app.runtime.createConversation(request, actor), app.runtime.createConversation(request, actor)]);
  assert.equal(results[0].conversation.id, results[1].conversation.id);
  assert.equal(app.store.read().conversations.length, 1);
  await assert.rejects(app.runtime.createConversation({ ...request, title: 'Other body' }, actor), { code: 'IDEMPOTENCY_CONFLICT' });
  const other = await app.runtime.createConversation(request, { ...actor, subject: 'fixture-other-member' });
  assert.notEqual(other.conversation.id, results[0].conversation.id);
  assert.equal(app.runtime.bootstrap().workspaceConversationCreations, undefined);
  await app.close(); app = await createApp({ dataDirectory: directory });
  const recovered = await app.runtime.createConversation(request, actor);
  assert.equal(recovered.duplicate, true); assert.equal(recovered.conversation.id, results[0].conversation.id);
  await app.runtime.deleteConversation(recovered.conversation.id);
  await assert.rejects(app.runtime.createConversation(request, actor), { code: 'CONVERSATION_DELETED', status: 410 });
  assert.equal(app.store.read().conversations.length, 1);
  assert.equal(app.runtime.listRuns().runs.length, 0);
});

test('HTTP creates dedupe original requests and reject client-provided identity without running a model', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-create-http-');
  const app = await createApp({ dataDirectory: directory });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { port } = await app.listen(0), base = `http://127.0.0.1:${port}`;
  const post = body => fetch(base + '/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { title: 'HTTP fixture', requestId: 'durable-create-fixture' };
  const first = await (await post(body)).json();
  const second = await (await post(body)).json();
  assert.equal(first.conversation.id, second.conversation.id); assert.equal(second.duplicate, true);
  assert.equal(first.conversation.createdBy, 'local-operator');
  assert.equal((await post({ ...body, subject: 'invented-owner' })).status, 400);
  assert.equal(app.store.read().conversations.length, 1); assert.equal(app.runtime.listRuns().runs.length, 0);
});
