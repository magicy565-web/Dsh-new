import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { api, submit, terminal, taskFixture, until, inspectPi, PI_API, TOKEN_A } from './fixtures/pi-task-helpers.mjs';

const delegate = (task = 'Only explicit child public text', id = 'delegate-one') => fauxAssistantMessage(fauxToolCall('workspace_delegate', { task }, { id }), { stopReason: 'toolUse' });
const toolNames = request => request.messages.filter(row => row.role === 'system').flatMap(row => row.toolsAdded || []).map(tool => tool.name);

test('official foreground child has empty tools, isolated text and provider affinity, and shares three original governed requests', async t => {
  const sessions = [], ceilings = [];
  const f = await taskFixture(t, { responses: [(request, options) => {
    sessions.push(options.sessionId); ceilings.push(options.maxTokens); assert.ok(toolNames(request).includes('workspace_delegate'));
    return delegate();
  }, (request, options) => {
    sessions.push(options.sessionId); ceilings.push(options.maxTokens); assert.deepEqual(toolNames(request), []);
    assert.deepEqual(request.messages.filter(row => row.role === 'user').map(row => row.content), ['Only explicit child public text']);
    assert.match(request.messages[0].sections.instructions, /no tools, files, external actions or delegation authority/);
    return fauxAssistantMessage('Child confirmed answer');
  }, (request, options) => {
    sessions.push(options.sessionId); ceilings.push(options.maxTokens); const result = request.messages.at(-1); assert.equal(result.role, 'toolResult'); assert.equal(result.isError, false);
    const receipt = JSON.parse(result.content[0].text); assert.equal(receipt.answer, 'Child confirmed answer'); assert.equal(receipt.providerSessionId, sessions[1]);
    return fauxAssistantMessage('Parent confirms actual original child receipt');
  }] });
  const task = await submit(f, 'official-child', { delegation: true }); const done = await terminal(f, task.runId);
  assert.equal(done.status, 'succeeded', JSON.stringify(done.error)); assert.equal(f.faux.state.callCount, 3); assert.equal(done.reply.runtime.modelTurns, 2);
  assert.deepEqual(done.events.filter(row => row.type.startsWith('pi.tool.')).map(row => [row.type, row.toolName]), [['pi.tool.started', 'workspace_delegate'], ['pi.tool.finished', 'workspace_delegate']]);
  assert.equal(sessions[0], sessions[2]); assert.notEqual(sessions[0], sessions[1]);
  const receipts = done.reply.runtime.delegations; assert.equal(receipts.length, 1); assert.deepEqual(receipts[0].tools, []); assert.equal(receipts[0].background, false); assert.equal(receipts[0].businessGoalAchieved, false);
  await f.app.close(); const saved = await inspectPi(f.directory, task.conversationId);
  assert.equal(saved.record.active.requests.length, 3); assert.deepEqual(saved.record.active.requests.map(row => row.maxTokens), ceilings);
  assert.equal(saved.record.active.maxTokens, 1600); assert.equal(done.outputTokens, saved.record.active.requests.reduce((sum, row) => sum + row.usage.completionTokens, 0));
  assert.deepEqual(saved.record.active.delegationRequests, [receipts[0].ownerToolTaskId]); assert.deepEqual(saved.record.active.delegations, receipts);
  assert.equal(saved.conversations.length, 2); const child = saved.conversations.find(row => row.id === receipts[0].childConversationId);
  assert.equal(child.owner.taskId, receipts[0].ownerToolTaskId); assert.equal(saved.submissions.length, 1); assert.equal(saved.submissions[0].requestId, receipts[0].requestId);
});

test('default development fixture performs the actual owned child path and records its confirmed receipt', async t => {
  const f = await startPiDevelopment(); t.after(() => f.close());
  const task = await submit(f, 'default-child', { delegation: true }); const done = await terminal(f, task.runId);
  assert.equal(done.status, 'succeeded'); assert.equal(f.faux.state.callCount, 3); assert.equal(done.reply.runtime.delegations.length, 1);
  assert.match(done.reply.runtime.delegations[0].answer, /Controlled faux child result/);
});

test('unselected delegation is refused without creating a child or invoking its model', async t => {
  const f = await taskFixture(t, { responses: [request => { assert.ok(!toolNames(request).includes('workspace_delegate')); return delegate(); }, fauxAssistantMessage('Refused unselected tool')] });
  const task = await submit(f, 'unselected-child'); const done = await terminal(f, task.runId);
  assert.equal(done.status, 'succeeded'); assert.equal(f.faux.state.callCount, 2); assert.equal(done.reply.runtime.delegations, undefined);
  await f.app.close(); const saved = await inspectPi(f.directory, task.conversationId); assert.equal(saved.conversations.length, 1); assert.equal(saved.submissions.length, 0);
});

test('one child cap persists, blocks a second child, and does not add a fifth model request', async t => {
  const f = await taskFixture(t, { responses: [delegate(), fauxAssistantMessage('First child answer'), delegate('Second unauthorized child', 'delegate-two'), request => {
    const result = request.messages.at(-1); assert.equal(result.role, 'toolResult'); assert.equal(result.isError, true); return fauxAssistantMessage('Second child refused');
  }] });
  const task = await submit(f, 'one-child-cap', { delegation: true }); const done = await terminal(f, task.runId);
  assert.equal(done.status, 'succeeded'); assert.equal(f.faux.state.callCount, 4); assert.equal(done.reply.runtime.delegations.length, 1);
  await f.app.close(); const saved = await inspectPi(f.directory, task.conversationId);
  assert.equal(saved.conversations.length, 2); assert.equal(saved.record.active.requests.length, 4); assert.equal(saved.record.active.delegationRequests.length, 1);
});

test('parent and child together exhaust the original four-request limit with no extra quota', async t => {
  const input = () => fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: 'unselected' }), { stopReason: 'toolUse' });
  const f = await taskFixture(t, { responses: [delegate(), fauxAssistantMessage('Child answer'), input(), input(), fauxAssistantMessage('Must never dispatch')] });
  const task = await submit(f, 'shared-four-requests', { delegation: true }); const done = await terminal(f, task.runId);
  assert.equal(done.status, 'failed'); assert.equal(done.error.code, 'TOKEN_BUDGET'); assert.equal(f.faux.state.callCount, 4);
  await f.app.close(); const saved = await inspectPi(f.directory, task.conversationId);
  assert.equal(saved.record.active.requests.length, 4); assert.equal(saved.conversations.length, 2); assert.equal(saved.record.active.maxTokens, 1600);
});

test('original credential expiry between parent intent and tool execution prevents child/model dispatch', async t => {
  let clock = Date.now();
  const f = await taskFixture(t, { accessClock: () => clock, principals: [{ subject: 'local-operator', workspaceId: 'local',
    tokenSha256: createHash('sha256').update(TOKEN_A).digest('hex'), scopes: ['agent:read', 'agent:submit'], expiresAt: new Date(clock + 1000).toISOString() }],
    responses: [() => { clock += 2000; return delegate(); }] });
  const task = await submit(f, 'expired-before-child', { delegation: true });
  await until(() => f.app.runtime.getRun(task.runId).run.status !== 'running');
  const run = f.app.runtime.getRun(task.runId).run; assert.equal(run.status, 'blocked'); assert.equal(run.error.code, 'PI_TASK_AUTHORIZATION_REVOKED'); assert.equal(f.faux.state.callCount, 1);
  await f.app.close(); const saved = await inspectPi(f.directory, task.conversationId); assert.equal(saved.conversations.length, 1); assert.equal(saved.submissions.length, 0);
});

test('explicit original parent cancellation aborts the actual owned child provider signal and durable child work', async t => {
  let entered = false, aborted = false;
  const f = await taskFixture(t, { responses: [delegate(), async (_request, options) => {
    entered = true; await new Promise(resolve => options.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' });
  }] });
  const task = await submit(f, 'cancel-child', { delegation: true }); await until(() => entered);
  assert.equal((await api(f, PI_API + '/tasks/' + task.runId + '/cancel', {})).status, 200); await until(() => aborted);
  assert.equal((await terminal(f, task.runId)).status, 'cancelled'); assert.equal(f.faux.state.callCount, 2);
  await f.app.close(); const saved = await inspectPi(f.directory, task.conversationId);
  assert.equal(saved.conversations.length, 2); assert.ok(saved.tasks.every(row => row.state.status === 'terminal'));
  assert.equal(saved.submissions[0].status, 'unanswered'); assert.equal(saved.record.active.requests[1].usage, null);
});

async function killFixture(t, mode) {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-child-sigkill-');
  const child = spawn(process.execPath, ['test/fixtures/pi-subagent-crash-child.mjs', directory, mode], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; await fs.rm(directory, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('Pi child crash fixture stalled: ' + stderr)), 7000);
    child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0])); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Pi child crash fixture exited: ' + stderr)); });
  });
  child.kill('SIGKILL'); assert.equal((await exited)[1], 'SIGKILL'); return { directory, ready };
}

test('actual SIGKILL pending-child recovery reuses owned IDs, original reply and unknown reservation', async t => {
  const { directory, ready } = await killFixture(t, 'pending-child'); const before = await inspectPi(directory, ready.conversationId);
  assert.equal(before.record.active.requests.length, 2); assert.equal(before.record.active.requests[1].usage, null); assert.equal(before.conversations.length, 2);
  const originalChild = before.conversations.find(row => row.owner); const originalSubmission = before.submissions[0];
  const f = await startPiDevelopment({ dataDirectory: directory, seedApprovalConnector: false, responses: [(request, options) => {
    assert.equal(options.sessionId, ready.childSessionId); assert.deepEqual(toolNames(request), []); assert.equal(request.messages.at(-1).content, 'Explicit original child text');
    return fauxAssistantMessage('Recovered original child answer');
  }, fauxAssistantMessage('Recovered parent answer with confirmed original child')] }); t.after(() => f.close());
  assert.equal(f.app.runtime.getRun(ready.runId).run.status, 'interrupted'); assert.equal(f.faux.state.callCount, 0);
  assert.equal((await api(f, PI_API + '/tasks/' + ready.runId + '/resume', { requestId: 'recover-original-child' })).status, 200);
  const done = await terminal(f, ready.runId); assert.equal(done.status, 'succeeded', JSON.stringify(done.error)); assert.equal(f.faux.state.callCount, 2);
  assert.equal(done.reply.id, ready.replyId); assert.equal(done.reply.runtime.nativeTaskId, ready.nativeTaskId); assert.equal(done.reply.runtime.delegations[0].childConversationId, originalChild.id);
  assert.equal(done.reply.runtime.delegations[0].submissionId, originalSubmission.id); assert.equal(done.outputTokens, 1600); assert.equal(done.usage.completionTokens, null);
  await f.close(); const after = await inspectPi(directory, ready.conversationId);
  assert.equal(after.conversations.length, 2); assert.equal(after.submissions.length, 1); assert.equal(after.record.active.requests.length, 4); assert.equal(after.record.active.requests[1].usage, null);
  assert.deepEqual(after.record.active.delegationRequests, before.record.active.delegationRequests); assert.equal(after.provider.sessionId, before.provider.sessionId);
});

test('actual SIGKILL completed-cache recovery adds zero model requests and zero children', async t => {
  const { directory, ready } = await killFixture(t, 'cached-final'); const before = await inspectPi(directory, ready.conversationId);
  assert.equal(before.record.active.requests.length, 3); assert.equal(before.record.active.delegations.length, 1);
  const f = await startPiDevelopment({ dataDirectory: directory, responses: [], seedApprovalConnector: false }); t.after(() => f.close());
  assert.equal(f.app.runtime.getRun(ready.runId).run.status, 'interrupted');
  assert.equal((await api(f, PI_API + '/tasks/' + ready.runId + '/resume', { requestId: 'recover-completed-child' })).status, 200);
  const done = await terminal(f, ready.runId); assert.equal(done.status, 'succeeded', JSON.stringify(done.error)); assert.equal(f.faux.state.callCount, 0);
  assert.equal(done.reply.id, ready.replyId); assert.equal(done.reply.runtime.nativeTaskId, ready.nativeTaskId); assert.equal(done.outputTokens, ready.outputTokens); assert.deepEqual(done.usage, ready.usage);
  assert.deepEqual(done.reply.runtime.delegations, before.record.active.delegations);
  await f.close(); const after = await inspectPi(directory, ready.conversationId);
  assert.deepEqual(after.record.active.requests, before.record.active.requests); assert.deepEqual(after.conversations, before.conversations); assert.deepEqual(after.submissions, before.submissions);
});

test('rotated original member binding cannot recover a cached child with a new credential and makes zero model calls', async t => {
  const { directory, ready } = await killFixture(t, 'cached-final');
  const f = await taskFixture(t, { directory, responses: [] });
  assert.equal(f.app.runtime.getRun(ready.runId).run.status, 'interrupted');
  const response = await api(f, PI_API + '/tasks/' + ready.runId + '/resume', { requestId: 'new-binding-cannot-adopt' });
  assert.equal(response.status, 403); assert.equal(response.json.code, 'PI_TASK_AUTHORIZATION_REVOKED'); assert.equal(f.faux.state.callCount, 0);
  assert.equal(f.app.runtime.getRun(ready.runId).run.status, 'interrupted'); assert.equal(f.app.store.read().runs.length, 1);
  await f.app.close();
});
