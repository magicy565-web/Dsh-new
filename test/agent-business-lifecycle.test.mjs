import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { api, taskFixture, until, TOKEN_B, inspectPi } from './fixtures/pi-task-helpers.mjs';

const BASE = '/api/agent/v1/tasks';
const input = { product: 'Public synthetic lifecycle cup', spec: 'Public supplied specification', quantity: 10 };
const task = (f, id) => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === id);
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：本阶段仅整理明确提供的产品资料，未覆盖信息需逐项核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议核对原始材料并确认下一步。', sources: [] }], questions: [{ text: '是否可以补充原始报价与证据来源？', sources: [] }],
}), { stopReason: 'toolUse' });
async function submit(f, key, fields = input) {
  const response = await api(f, BASE, { type: 'procurement', title: 'Public synthetic lifecycle', input: fields }, { headers: { 'Idempotency-Key': key } });
  assert.equal(response.status, 201, JSON.stringify(response.json)); return response.json.taskId;
}

test('cancel aborts the original running stage, retains documents/budget, persists across restart and cannot resume or replace the task', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-business-cancel-'); let f;
  t.after(async () => { await f?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  f = await startPiDevelopment({ dataDirectory: directory, seedApprovalConnector: false });
  const id = await submit(f, 'cancel-original-business', { ...input, requirements: 'WAIT_FOR_BUSINESS_RESTART' });
  await until(() => f.faux.state.callCount === 3 && task(f, id)?.steps[2].runId);
  const before = structuredClone(task(f, id)), originalRuns = f.app.store.read().runs.length;
  assert.equal(before.deliverables.length, 1);
  const [first, repeated] = await Promise.all([api(f, `${BASE}/${id}/cancel`, {}), api(f, `${BASE}/${id}/cancel`, {})]);
  assert.equal(first.status, 200); assert.equal(repeated.status, 200);
  assert.equal(first.json.status, 'cancelled'); assert.equal(first.json.result.resumable, false);
  await until(() => f.app.runtime.getRun(before.steps[2].runId).run.status === 'cancelled');
  const saved = structuredClone(task(f, id));
  const ended = await api(f, `${BASE}/${id}/events`);
  assert.equal(ended.status, 200); assert.match(ended.bytes.toString(), /AGENT_TASK_CANCELLED/);
  assert.deepEqual(saved.deliverables, before.deliverables); assert.deepEqual(saved.budget, before.budget);
  assert.equal(saved.events.filter(row => row.sourceKey === 'cancelled').length, 1);
  assert.equal((await api(f, `${BASE}/${id}/resume`, { requestId: 'cannot-resume-cancelled' })).status, 409);
  const replay = await submit(f, 'cancel-original-business', { ...input, requirements: 'WAIT_FOR_BUSINESS_RESTART' });
  assert.equal(replay, id); assert.equal(f.faux.state.callCount, 3); assert.equal(f.app.store.read().runs.length, originalRuns);
  assert.equal(task(f, id).steps[3].runId, undefined);
  await f.close(); const ledger = await inspectPi(directory, saved.conversationId);
  f = await startPiDevelopment({ dataDirectory: directory, seedApprovalConnector: false });
  const reloaded = await api(f, `${BASE}/${id}`); assert.equal(reloaded.json.status, 'cancelled');
  assert.equal(f.faux.state.callCount, 0); assert.deepEqual(task(f, id).deliverables, saved.deliverables);
  assert.equal((await api(f, `${BASE}/${id}/cancel`, {})).status, 200);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.app.store.read().runs.length, originalRuns);
  await f.close(); const reloadedLedger = await inspectPi(directory, saved.conversationId);
  assert.deepEqual(reloadedLedger.record.records, ledger.record.records, 'No repeated reservation or settlement after replay/restart.');
  assert.equal(reloadedLedger.submissions.length, ledger.submissions.length);
});

test('new business lifecycle routes retain member isolation and reject changed input and invalid stable request IDs', async t => {
  const readOnlyToken = 'public-synthetic-lifecycle-read-only';
  const f = await taskFixture(t, { enterprise: true, principals: [
    { subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: createHash('sha256').update('pi-public-synthetic-test-member-a').digest('hex'), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-b', workspaceId: 'pi-enterprise-test', tokenSha256: createHash('sha256').update(TOKEN_B).digest('hex'), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: createHash('sha256').update(readOnlyToken).digest('hex'), scopes: ['agent:read'] },
  ], responses: [async (_context, options) => {
    await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }] });
  const id = await submit(f, 'enterprise-business-lifecycle'); await until(() => f.faux.state.callCount === 1);
  for (const action of ['cancel', 'resume']) assert.equal((await api(f, `${BASE}/${id}/${action}`, {}, { token: TOKEN_B })).status, 404);
  assert.equal((await api(f, `${BASE}/${id}`, undefined, { token: TOKEN_B })).status, 404);
  assert.equal((await api(f, `${BASE}/${id}`, undefined, { token: readOnlyToken })).status, 200);
  for (const action of ['cancel', 'resume']) assert.equal((await api(f, `${BASE}/${id}/${action}`, {}, { token: readOnlyToken })).status, 403);
  for (const body of [{ input: { product: 'Changed' } }, { requestId: 'not allowed on cancel' }, null, []])
    assert.equal((await api(f, `${BASE}/${id}/cancel`, body)).status, 400);
  for (const body of [{ model: 'Changed' }, { requestId: null }, { requestId: 'invalid key' }, { requestId: 3 }])
    assert.equal((await api(f, `${BASE}/${id}/resume`, body)).status, 400);
  assert.equal(task(f, id).status, 'running'); assert.equal(f.faux.state.callCount, 1);
  assert.equal((await api(f, `${BASE}/${id}/cancel`, {})).status, 200);
});

test('same stable business resume request reuses original checkpoint, prior document and budget across concurrency and another restart', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-business-resume-'); let f;
  t.after(async () => { await f?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  f = await startPiDevelopment({ dataDirectory: directory, seedApprovalConnector: false });
  const id = await submit(f, 'resume-original-business', { ...input, requirements: 'WAIT_FOR_BUSINESS_RESTART' });
  await until(() => f.faux.state.callCount === 3 && task(f, id)?.steps[2].runId);
  const before = structuredClone(task(f, id)); await f.close();
  f = await startPiDevelopment({ dataDirectory: directory, seedApprovalConnector: false, responses: [complete(), complete()] });
  await until(() => task(f, id).status === 'interrupted'); assert.equal(f.faux.state.callCount, 0);
  const resume = { requestId: 'one-original-business-resume' };
  const answers = await Promise.all([api(f, `${BASE}/${id}/resume`, resume), api(f, `${BASE}/${id}/resume`, resume)]);
  assert.ok(answers.every(row => row.status === 200)); await until(() => task(f, id).status === 'done');
  const done = structuredClone(task(f, id)); assert.equal(done.attempt, 2); assert.equal(done.resumeRequests.length, 1);
  for (const name of ['runId', 'replyId', 'requestId', 'contextFingerprint']) assert.equal(done.steps[2][name], before.steps[2][name]);
  assert.deepEqual(done.budget, before.budget); assert.equal(done.deliverables[0].sha256, before.deliverables[0].sha256);
  assert.equal(f.faux.state.callCount, 2); assert.equal(f.app.store.read().runs.length, 4);
  assert.equal((await api(f, `${BASE}/${id}/resume`, resume)).status, 200);
  assert.equal((await api(f, `${BASE}/${id}/resume`, { requestId: 'different-after-completion' })).status, 409);
  await f.close(); const ledger = await inspectPi(directory, done.conversationId);
  f = await startPiDevelopment({ dataDirectory: directory, seedApprovalConnector: false });
  assert.equal((await api(f, `${BASE}/${id}/resume`, resume)).status, 200); assert.equal(task(f, id).attempt, 2);
  assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().runs.length, 4);
  await f.close(); const after = await inspectPi(directory, done.conversationId);
  assert.deepEqual(after.record.records, ledger.record.records); assert.equal(after.submissions.length, ledger.submissions.length);
});

test('cancel fencing prevents a stage whose admission was already awaiting continuation from creating a replacement run', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const original = f.app.runtime.sendMessage; let entered = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  f.app.runtime.sendMessage = async (...args) => { entered = true; await gate; return original(...args); };
  const id = await submit(f, 'cancel-admission-race'); await until(() => entered);
  const pending = api(f, `${BASE}/${id}/cancel`, {}); await until(() => task(f, id).status === 'cancelled');
  release(); const canceled = await pending; assert.equal(canceled.status, 200);
  assert.equal(task(f, id).status, 'cancelled'); assert.equal(task(f, id).steps[0].runId, undefined);
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.faux.state.callCount, 0);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1);
});

test('a partial Runtime stop failure is not a successful cancellation receipt, and retry stops the same fenced original run', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const id = await submit(f, 'cancel-partial-stop', { ...input, requirements: 'WAIT_FOR_BUSINESS_RESTART' });
  await until(() => f.faux.state.callCount === 3 && task(f, id)?.steps[2].runId);
  const originalCancel = f.app.runtime.cancelRun;
  f.app.runtime.cancelRun = async () => { throw new Error('Explicit synthetic original stop failure.'); };
  const failed = await api(f, `${BASE}/${id}/cancel`, {}); assert.equal(failed.status, 500);
  assert.equal(failed.json.taskId, undefined, 'No fabricated settled cancellation receipt.');
  assert.equal(task(f, id).status, 'cancelled'); assert.equal(task(f, id).result.resumable, false);
  assert.equal(f.faux.state.callCount, 3); assert.equal(f.app.store.read().runs.length, 3);
  f.app.runtime.cancelRun = originalCancel;
  const retried = await api(f, `${BASE}/${id}/cancel`, {}); assert.equal(retried.status, 200);
  assert.equal(f.app.runtime.getRun(task(f, id).steps[2].runId).run.status, 'cancelled');
  assert.equal(f.faux.state.callCount, 3); assert.equal(f.app.store.read().runs.length, 3);
  assert.equal(task(f, id).events.filter(row => row.sourceKey === 'cancelled').length, 1);
});
