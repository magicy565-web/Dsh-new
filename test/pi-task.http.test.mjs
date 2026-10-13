import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { api, submit, terminal, taskFixture, until, PI_API, TOKEN_B } from './fixtures/pi-task-helpers.mjs';

test('generic HTTP task is the original member-owned Runtime run with stable receipts and public text only', async t => {
  const f = await taskFixture(t, { enterprise: true, responses: [fauxAssistantMessage('Real official Pi result for public text.')] });
  const [a, b] = await Promise.all([submit(f, 'same-key'), submit(f, 'same-key')]);
  assert.equal(a.runId, b.runId); assert.equal([a, b].filter(row => row.duplicate).length, 1);
  const done = await terminal(f, a.runId);
  assert.equal(done.status, 'succeeded'); assert.equal(done.reply.runtime.execution, 'agent-prompt'); assert.equal(done.businessGoalAchieved, false);
  assert.equal(f.faux.state.callCount, 1); assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().conversations.length, 1);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  assert.equal((await api(f, PI_API + '/tasks/by-request/same-key')).json.runId, a.runId);
  const conflict = await api(f, PI_API + '/tasks', { title: 'Public synthetic task', content: 'Changed public text', requestId: 'same-key' });
  assert.equal(conflict.status, 409); assert.equal(conflict.json.code, 'IDEMPOTENCY_CONFLICT');
  for (const route of ['/tasks/' + a.runId, '/tasks/by-request/same-key']) assert.equal((await api(f, PI_API + route, undefined, { token: TOKEN_B })).status, 404);
  for (const action of ['cancel', 'resume', 'decision', 'continue']) assert.equal((await api(f, PI_API + '/tasks/' + a.runId + '/' + action, {}, { token: TOKEN_B })).status, 404);
  const bootstrap = await f.workspace('/api/bootstrap'); assert.equal(bootstrap.status, 200); assert.ok(!JSON.stringify(bootstrap.json).includes(a.runId)); assert.ok(!JSON.stringify(bootstrap.json).includes(a.conversationId));
  for (const route of ['/api/runs/' + a.runId, '/api/conversations/' + a.conversationId]) assert.equal((await f.workspace(route)).status, 404);
});

test('invalid Pi inputs are 4xx, create no state, and leave the server usable', async t => {
  const f = await taskFixture(t, { responses: [fauxAssistantMessage('Still usable')] });
  const valid = { title: 'Public', content: 'Public text', requestId: 'valid' };
  for (const body of [null, [], 'text', {}, { ...valid, inputContext: {} }, { ...valid, piTaskContext: {} }, { ...valid, content: 'x'.repeat(20001) }, { ...valid, title: 'x'.repeat(161) },
    { ...valid, requestId: 'invalid key' }, { ...valid, delegation: 'true' }, { ...valid, connectorActions: [null] }, { ...valid, connectorActions: [{}] }, { ...valid, connectorActions: false },
    { ...valid, content: 'api_key=synthetic-never-real-key' }, { ...valid, title: 'password=synthetic-never-real-password' }]) {
    const response = await api(f, PI_API + '/tasks', body); assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.app.store.read().conversations.length, 0); assert.equal(f.faux.state.callCount, 0);
  const task = await submit(f, 'usable'); assert.equal((await terminal(f, task.runId)).status, 'succeeded');
  for (const action of ['cancel', 'resume', 'decision', 'continue']) assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/' + action, null)).status, 400);
});

test('generic public-text Pi task does not egress ambient original files, skills or memories', async t => {
  const f = await taskFixture(t, { responses: [request => {
    const sent = JSON.stringify(request); assert.ok(!sent.includes('AMBIENT_PRIVATE_FILE')); assert.ok(!sent.includes('AMBIENT_PRIVATE_MEMORY')); assert.ok(!sent.includes('AMBIENT_PRIVATE_SKILL'));
    return fauxAssistantMessage('Only explicit public text was supplied');
  }] });
  await f.app.artifacts.create({ filename: 'original-private.txt', content: 'AMBIENT_PRIVATE_FILE', mimeType: 'text/plain' });
  await f.app.runtime.createMemory({ content: 'AMBIENT_PRIVATE_MEMORY', category: 'general' });
  await f.app.store.update(state => { state.capabilities.skills.push({ id: 'ambient-private-skill', name: 'Private skill', instructions: 'AMBIENT_PRIVATE_SKILL', enabled: true, revision: 1 }); });
  const task = await submit(f, 'no-ambient-input'); assert.equal((await terminal(f, task.runId)).status, 'succeeded'); assert.equal(f.faux.state.callCount, 1);
  assert.deepEqual(f.app.runtime.getRun(task.runId).run.inputContext, { artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
});

test('the trusted creation marker isolates a Pi conversation even when original run admission fails', async t => {
  const f = await taskFixture(t, { enterprise: true });
  const originalSend = f.app.runtime.sendMessage;
  f.app.runtime.sendMessage = async () => { throw Object.assign(new Error('Synthetic admission interruption'), { status: 409, code: 'FIXTURE_ADMISSION_INTERRUPTED' }); };
  const response = await api(f, PI_API + '/tasks', { title: 'Private ownership marker', content: 'Explicit public text', requestId: 'admission-gap' });
  f.app.runtime.sendMessage = originalSend;
  assert.equal(response.status, 409); assert.equal(f.app.store.read().runs.length, 0);
  const conversation = f.app.store.read().conversations[0]; assert.deepEqual(conversation.piTaskOwner, { subject: 'member-a', workspaceId: 'pi-enterprise-test' });
  const bootstrap = await f.workspace('/api/bootstrap'); assert.equal(bootstrap.status, 200); assert.ok(!JSON.stringify(bootstrap.json).includes(conversation.id));
  assert.equal((await f.workspace('/api/conversations/' + conversation.id)).status, 404);
  // An ordinary creation receipt using the same host prefix cannot adopt it.
  await assert.rejects(f.app.runtime.createConversation({ title: conversation.title, requestId: 'pi-' + createHash('sha256').update('admission-gap').digest('hex'), inputContext: conversation.inputContext }, { subject: 'member-a', workspaceId: 'pi-enterprise-test' }), error => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('actual original approval and separate continuation save one local file with one exact receipt', async t => {
  const f = await startPiDevelopment(); t.after(() => f.close());
  const task = await submit(f, 'local-approval', { content: 'LOCAL_APPROVAL_FIXTURE', connectorActions: [{ connectorId: f.approvalConnectorId, action: 'create_file' }] });
  const waiting = await terminal(f, task.runId); assert.equal(waiting.status, 'awaiting_approval'); assert.equal(waiting.proposals.length, 1);
  const proposalId = waiting.proposals[0].id;
  assert.equal(f.app.capabilities.listConnectorRuns().length, 0); assert.equal(f.app.artifacts.list().artifacts.length, 0);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/continue', { proposalId, requestId: 'unapproved' })).status, 403);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/decision', { proposalId, decision: 'approved', confirmed: false })).status, 400);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/decision', { proposalId, decision: 'approved', confirmed: true })).status, 200);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 0); assert.equal(f.faux.state.callCount, 1);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/continue', { proposalId })).status, 400);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/continue', { proposalId, requestId: 'approved-execution' })).status, 200);
  const done = await terminal(f, task.runId); assert.equal(done.status, 'succeeded', JSON.stringify(done.error));
  assert.equal(done.proposals.length, 1); assert.equal(done.proposals[0].status, 'succeeded'); assert.equal(f.app.capabilities.listConnectorRuns().length, 1);
  assert.equal(f.app.artifacts.list().artifacts.length, 1); assert.equal(done.businessGoalAchieved, false);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/continue', { proposalId, requestId: 'approved-execution' })).status, 200);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 1); assert.equal(f.faux.state.callCount, 2);
});

test('default development fixture cancels the actual provider signal and preserves explicit-directory restart', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-task-restart-'); let f;
  t.after(async () => { await f?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  f = await startPiDevelopment({ dataDirectory: directory });
  const task = await submit(f, 'restart-original', { content: 'WAIT_FOR_CANCEL' }); await until(() => f.faux.state.callCount === 1);
  await f.close(); f = await startPiDevelopment({ dataDirectory: directory });
  const interrupted = await api(f, PI_API + '/tasks/' + task.runId); assert.equal(interrupted.json.status, 'interrupted'); assert.equal(f.faux.state.callCount, 0);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/resume', { requestId: 'original-resume' })).status, 200);
  await until(() => f.faux.state.callCount === 1);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/cancel', {})).status, 200);
  assert.equal((await terminal(f, task.runId)).status, 'cancelled');
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().messages.filter(row => row.role === 'user').length, 1);
});
