import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  // All publicly materialized fields must be tracked, even if no new event,
  // run ID, task status or result field accompanies an authoritative edit.
  task.title = 'Corrected authoritative title';
  task.input.product = 'Corrected original product';
  await projection.sync(task, 4);
  const updated = projection.getTask(task.id, actor);
  assert.equal(updated.title, task.title);
  assert.equal(updated.input.product, task.input.product);
  assert.deepEqual(projection.events(task.id), []);

  const published = { seq: 1, kind: 'progress', payload: { stage: 'requirements', done: false },
    ts: new Date().toISOString(), sourceKey: 'requirements:progress' };
  task.events.push(published);
  await projection.sync(task, 5);
  assert.deepEqual(projection.events(task.id).map(({ seq, kind, payload, ts }) => ({ seq, kind, payload, ts })),
    [{ seq: published.seq, kind: published.kind, payload: published.payload, ts: published.ts }]);
  const delivered = structuredClone(projection.events(task.id));
  // A committed event is append-only, even if an old event changes its value
  // without changing the sequence/count. The former cache skipped this check.
  published.payload.done = true;
  await assert.rejects(projection.sync(task, 6), /previously delivered event cannot change/i);
  assert.deepEqual(projection.events(task.id), delivered, 'Failed event validation must roll back SQLite.');

  published.payload.done = false;
  const content = '# Immutable original artifact';
  const file = { name: 'evidence.md', content, bytes: Buffer.byteLength(content, 'utf8'),
    sha256: createHash('sha256').update(content).digest('hex'),
    url: '/api/agent/v1/tasks/' + task.id + '/artifacts/evidence.md' };
  task.deliverables.push(file);
  await projection.sync(task, 7);
  const publishedFiles = projection.listArtifacts(task.id);
  assert.deepEqual(publishedFiles, [{ name: file.name, bytes: file.bytes, url: file.url }]);
  file.url = '/api/agent/v1/tasks/' + task.id + '/artifacts/other.md';
  await assert.rejects(projection.sync(task, 8), /published agent artifact metadata cannot change/i);
  assert.deepEqual(projection.listArtifacts(task.id), publishedFiles,
    'An altered download URL must not replace or fork an already published artifact.');
  file.url = publishedFiles[0].url;
  task.subject = 'other-member';
  await assert.rejects(projection.sync(task, 9), /original agent task owner changed/i);
  assert.equal(projection.getTask(task.id, { ...actor, subject: 'other-member' }), null,
    'The projection must never reassign a task by changing its owner columns.');
  assert.equal(projection.getTask(task.id, actor).workspace.runIds[0], 'original-pi-run');
});
