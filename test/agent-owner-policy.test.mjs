import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentOwnerPolicy } from '../server/agent/privacy.mjs';

const a = { subject: 'a', workspaceId: 'enterprise' }, b = { subject: 'b', workspaceId: 'enterprise' };
function fixture() {
  const state = { workspaceAgentTasks: { version: 1, tasks: [{ id: 'task-a', subject: 'a', workspaceId: 'enterprise', conversationId: 'conversation-a' }] },
    conversations: [{ id: 'conversation-a', createdBy: 'a' }, { id: 'ordinary-shared' }],
    runs: [{ id: 'run-a', conversationId: 'conversation-a', agentTaskId: 'task-a', agentPresetContext: { taskId: 'task-a', input: 'private input' } }],
    messages: [{ id: 'message-a', conversationId: 'conversation-a', runId: 'run-a', content: 'private reply' }],
    artifacts: [{ id: 'artifact-a', sourceRunId: 'run-a' }, { id: 'shared-file' }], activity: [{ id: 'activity-a', artifactId: 'artifact-a' }],
    capabilities: { approvals: [{ id: 'approval-a', binding: { runId: 'run-a' } }] } };
  return { state, policy: createAgentOwnerPolicy({ read: () => state }) };
}
test('Agent ownership filters original bootstrap run/message/artifact relationships without hiding unrelated enterprise resources', () => {
  const { state, policy } = fixture(), filtered = policy.filterBootstrap(state, b);
  assert.equal(filtered.workspaceAgentTasks.tasks.length, 0); assert.equal(filtered.runs.length, 0); assert.equal(filtered.messages.length, 0);
  assert.deepEqual(filtered.conversations, [{ id: 'ordinary-shared' }]); assert.deepEqual(filtered.artifacts, [{ id: 'shared-file' }]);
  assert.equal(filtered.activity.length, 0); assert.equal(filtered.capabilities.approvals.length, 0);
  assert.deepEqual(policy.filterBootstrap(state, a), state); assert.equal(state.runs.length, 1);
});
test('original run/conversation endpoints and selected ID references return indistinguishable 404 for a different member', () => {
  const { policy } = fixture();
  for (const fn of [() => policy.assertRun(b, 'run-a'), () => policy.assertConversation(b, 'conversation-a'), () => policy.guardHttp('/api/runs/run-a/retry', b), () => policy.guardHttp('/api/conversations/ordinary-shared/messages', b, { inputContext: { artifacts: [{ id: 'artifact-a' }] } })]) assert.throws(fn, { status: 404, code: 'NOT_FOUND' });
  assert.doesNotThrow(() => policy.guardHttp('/api/runs/run-a/retry', a));
  assert.equal(policy.ownsTask(a, 'task-a'), true); assert.equal(policy.ownsTask({ ...a, workspaceId: 'another' }, 'task-a'), false);
});
test('orphaned Agent invocation cannot leak as ordinary shared history after a corrupt or removed business link', () => {
  const { state, policy } = fixture(); state.workspaceAgentTasks.tasks = [];
  const filtered = policy.filterResponse({ runs: state.runs, messages: state.messages, conversations: state.conversations }, a);
  assert.equal(filtered.runs.length, 0); assert.equal(filtered.messages.length, 0);
  assert.deepEqual(filtered.conversations, [{ id: 'ordinary-shared' }]);
});
test('queued and archived tasks without conversations do not hide unrelated shared records with empty references', () => {
  const { state, policy } = fixture();
  state.workspaceAgentTasks.tasks.push({ id: 'queued-a', subject: 'a', workspaceId: 'enterprise', conversationId: null }, { id: 'archived-a', subject: 'a', workspaceId: 'enterprise' });
  const response = { runs: [{ id: 'shared-run', goalId: null }], artifacts: [{ id: 'shared-output', sourceRunId: null }], settings: { model: 'fixture' } };
  assert.deepEqual(policy.filterResponse(response, b), response);
});
