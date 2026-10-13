import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentCoordinator } from '../server/agent/engine.mjs';
import { getPreset } from '../server/agent/presets.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await delay(5);
  }
  throw new Error('Timed out: ' + reason);
}

test('restarted Agent never reattaches Pi autonomously; explicit member resume reuses original run and checkpoint', async t => {
  const actor = { subject: 'existing-member', workspaceId: 'existing-workspace', role: 'operator' };
  const preset = getPreset('procurement');
  const originalRun = {
    id: 'original-pi-run', status: 'interrupted', conversationId: 'existing-conversation',
    assistantId: 'original-assistant', piSubmissionId: 'original-durable-submission',
  };
  const task = {
    id: 'existing-business-task', subject: actor.subject, workspaceId: actor.workspaceId,
    type: 'procurement', title: 'Explicit restart permission', mode: 'model',
    input: { product: 'Stainless steel bottle', spec: '500 ml', quantity: 100, market: 'US' },
    preset, status: 'running', attempt: 1, conversationId: originalRun.conversationId,
    createdAt: new Date().toISOString(), finishedAt: null, budget: { maxSteps: 4, maxOutputTokens: 6400 },
    steps: preset.stages.map((stage, index) => ({
      key: stage.key, title: stage.title, requestId: 'step-' + index,
      status: index ? 'pending' : 'running', runId: index ? null : originalRun.id, output: null,
    })),
    deliverables: [], events: [], summary: null,
  };
  let authority = {
    meta: { sequence: 0 }, runs: [originalRun],
    workspaceAgentTasks: { version: 1, tasks: [task] },
  };
  const subscribers = new Set();
  let writing = Promise.resolve();
  const store = {
    read() { return structuredClone(authority); },
    update(fn) {
      const work = writing.then(() => {
        const next = structuredClone(authority);
        const result = fn(next);
        next.meta.sequence += 1;
        authority = next;
        queueMicrotask(() => { for (const subscriber of subscribers) subscriber(); });
        return structuredClone(result);
      });
      writing = work.catch(() => {});
      return work;
    },
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
  };
  const projection = { async legacyTasks() { return []; }, async sync() {} };
  let recoveryCalls = 0;
  const runtime = {
    sendMessage() { throw new Error('Must not submit another model run for an interrupted checkpoint.'); },
    createConversation() { throw new Error('Must not create a replacement conversation.'); },
    async recoverPiRun(id) {
      recoveryCalls++;
      assert.equal(id, originalRun.id);
      await store.update(state => {
        const run = state.runs.find(item => item.id === id);
        assert.equal(run.piSubmissionId, originalRun.piSubmissionId);
        run.status = 'running';
      });
      return { run: store.read().runs[0] };
    },
  };
  const auth = {
    legacyBindings: [],
    resolveTaskActor(row) {
      assert.equal(row.subject, actor.subject);
      assert.equal(row.workspaceId, actor.workspaceId);
      return actor;
    },
  };
  const coordinator = await createAgentCoordinator({
    store, runtime, projection, auth, provider: { kind: 'pi-durable', configured: true },
  });
  t.after(() => coordinator.close());
  await until(() => store.read().workspaceAgentTasks.tasks[0].status === 'interrupted', 'safe startup projection');
  let current = store.read().workspaceAgentTasks.tasks[0];
  assert.equal(recoveryCalls, 0);
  assert.equal(current.result?.reason, 'AGENT_EXPLICIT_RESUME_REQUIRED');
  assert.equal(current.result?.resumable, true);
  assert.equal(current.deliverables.length, 1, 'Partial original document is retained.');
  assert.equal(store.read().runs[0].piSubmissionId, originalRun.piSubmissionId);
  const oldEvents = current.events;
  await delay(40);
  assert.equal(recoveryCalls, 0, 'Read-only startup may not trigger a later deferred model call.');
  await assert.rejects(coordinator.resume(task.id, { ...actor, subject: 'different-member' }),
    { status: 404 });
  assert.equal(recoveryCalls, 0);
  const resumed = await coordinator.resume(task.id, actor);
  assert.equal(resumed.id, task.id);
  await until(() => recoveryCalls === 1, 'one explicitly admitted resume');
  current = store.read().workspaceAgentTasks.tasks[0];
  assert.equal(store.read().runs.length, 1);
  assert.equal(store.read().runs[0].id, originalRun.id);
  assert.equal(store.read().runs[0].piSubmissionId, originalRun.piSubmissionId);
  assert.equal(current.attempt, 2);
  assert.deepEqual(current.events.slice(0, oldEvents.length), oldEvents,
    'Recovery must only append to previously published event history.');
  assert.equal(current.deliverables.length, 1);
  await delay(30);
  assert.equal(recoveryCalls, 1, 'One member action may only admit one original recovery.');
});
