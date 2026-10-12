import test from 'node:test';
import assert from 'node:assert/strict';
import { createMuseOwnerPolicy, originalMuseScope } from '../server/muse-owner-policy.mjs';
import { prepareInputContext } from '../server/task-context.mjs';

test('persisted receipt provenance closes historical model-output laundering without a mounted connector', async () => {
  const actor = { subject: 'original-owner', nativeAgentId: 'original-conversation' };
  const state = { conversations: [{ id: actor.nativeAgentId, ...actor }], workerOrders: [],
    artifacts: [{ id: 'private-receipt', workerOwner: { workerId: 'original-worker', subject: actor.subject }, metadata: { museNativeAgentId: actor.nativeAgentId } },
      { id: 'old-leaked-output', sourceRunId: 'old-private-input-run', versions: [] }, { id: 'ordinary-file', versions: [] }],
    runs: [{ id: 'old-private-input-run', conversationId: 'ordinary-conversation', inputContextSnapshot: { artifacts: [{ id: 'private-receipt' }] } }],
    messages: [{ id: 'old-private-model-message', runId: 'old-private-input-run', content: 'Private fixture text' }] };
  const scope = originalMuseScope(state);
  assert.equal(scope.modelRuns.has('old-private-input-run'), true);
  assert.equal(scope.artifacts.has('old-leaked-output'), true);
  const policy = createMuseOwnerPolicy({ read: () => state, error: (status, code, message) => Object.assign(new Error(message), { status, code }) });
  assert.equal(policy.filterBootstrap(state, { role: 'admin', subject: actor.subject }).messages.length, 0);
  assert.equal(policy.ownsArtifact(state.artifacts[2]), false);
  let reads = 0;
  await assert.rejects(prepareInputContext({ state, conversationId: 'ordinary-conversation',
    inputContext: { artifacts: [{ id: 'old-leaked-output', version: 1 }] }, artifacts: { read() { reads++; throw Error('No read authorized'); } } }), { code: 'MUSE_OWNER_REQUIRED' });
  assert.equal(reads, 0);
});
