import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAgentStore } from '../server/agent/store.mjs';

test('Agent read projection tracks the original Pi conversation/run linkage without a synthetic event', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-agent-link-projection-'));
  let projection;
  t.after(async () => {
    try { await projection?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  projection = await openAgentStore(path.join(directory, 'agent'));
  const actor = { workspaceId: 'local', subject: 'local-operator' };
  const task = {
    id: 'original-agent-task', ...actor, type: 'procurement',
    title: 'Track original Pi run', input: { product: 'Bottle' },
    status: 'queued', summary: null, createdAt: new Date().toISOString(),
    finishedAt: null, result: { state: 'queued' }, requestKey: 'same-business-request',
    conversationId: null, steps: [{ key: 'requirements', runId: null }],
    deliverables: [], events: [],
  };

  await projection.sync(task, 1);
  assert.deepEqual(projection.getTask(task.id, actor).workspace, {
    conversationId: null, runIds: [], authority: 'workspace-store',
  });

  // Original Host admission persists these references before the next public
  // stage/outbox event. The projection must not silently return the old IDs.
  task.conversationId = 'original-conversation';
  await projection.sync(task, 2);
  assert.equal(projection.getTask(task.id, actor).workspace.conversationId, 'original-conversation');

  task.steps[0].runId = 'original-pi-run';
  await projection.sync(task, 3);
  assert.deepEqual(projection.getTask(task.id, actor).workspace, {
    conversationId: 'original-conversation', runIds: ['original-pi-run'], authority: 'workspace-store',
  });
  assert.deepEqual(projection.events(task.id), [], 'Linkage changes must not fabricate progress events.');
  assert.equal(projection.getTask(task.id, { ...actor, subject: 'other-member' }), null,
    'The projection remains scoped to the existing Workspace member.');
});
