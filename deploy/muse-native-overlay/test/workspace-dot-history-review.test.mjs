import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectReviewedDotHistory, resumeReviewedDotHistory } from '../server/workspace-dot-history-review.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture() {
  const actor = { subject: 'owner', nativeAgentId: 'original-session' };
  const receipt = { requestId: 'original-request', taskRef: 'original-job', nativeAgentId: actor.nativeAgentId,
    goalId: 'original-goal', goalRevision: 1, state: 'succeeded', files: [], completionHash: '2'.repeat(64) };
  const digest = hash(receipt);
  const task = { ...actor, requestId: receipt.requestId, jobId: receipt.taskRef, goalId: receipt.goalId,
    goalRevision: 1, ready: true, receipt, receiptHash: digest, returnedHash: digest,
    acceptedHash: digest, acceptedBy: actor.subject };
  const connection = { id: 'original-connection', provider: 'dot', grantId: 'original-grant',
    authorizationEpoch: 35, pausedAt: 123, revokedAt: null, drainingAt: null };
  const lifecycle = { phase: 'paused', epoch: 43, configurationHash: '1'.repeat(64), previousConfigurationHash: '1'.repeat(64),
    unfinishedDelegations: 0, reconciliationRequired: false, pendingOperations: 0 };
  const goal = { id: receipt.goalId, phase: 'complete', revision: 3 };
  const events = [{ type: 'agent/inbox/spliced', data: { inserted: [{ id: 'workspace-dot-result-original-job',
    source: { kind: 'workspace-dot' }, content: [{ text: JSON.stringify(receipt) }] }] } },
  { type: 'goal/change', data: { operation: 'complete', goal } }];
  const job = { id: receipt.taskRef, state: 'succeeded', connectionId: connection.id,
    attemptId: 'original-attempt', fence: 7, completionHash: receipt.completionHash };
  const writes = [], view = { worker: { id: 'original-worker', connection }, delegations: [job] };
  const service = { status: () => ({ ...lifecycle }), bindActor: () => ({ view: async () => view,
    resumeConnection: async body => { writes.push(['connection', body]); connection.pausedAt = null;
      connection.authorizationEpoch++; return { worker: { connection } }; } }),
  bindDotTasks: () => ({ view: async () => [task] }),
  resume: async body => { writes.push(['scope', body]); lifecycle.epoch++; lifecycle.phase = 'active'; },
  pause: async body => { writes.push(['pause', body]); lifecycle.epoch++; lifecycle.phase = 'paused'; } };
  const agent = { id: actor.nativeAgentId, session: { ownEvents: () => events } };
  const ctx = { agents: { get: id => id === actor.nativeAgentId ? agent : undefined }, goals: { get: () => goal } };
  const review = { expectedEpoch: 43, configurationHash: lifecycle.configurationHash,
    requestId: 'operator-review', connectionId: connection.id, authorizationEpoch: 35 };
  return { options: { ctx, service, operators: [actor], ownerSubject: actor.subject, review },
    actor, receipt, task, connection, lifecycle, goal, events, job, writes, view, agent };
}

test('inspection is read-only; exact approved settled history resumes the original connection without replay', async () => {
  const f = fixture(), before = structuredClone({ task: f.task, events: f.events, job: f.job });
  const inspected = await inspectReviewedDotHistory(f.options);
  assert.equal(f.writes.length, 0);
  f.options.review.historyHash = inspected.historyHash;
  const result = await resumeReviewedDotHistory(f.options);
  assert.equal(result.connection.id, 'original-connection');
  assert.equal(result.connection.authorizationEpoch, 36);
  assert.deepEqual(f.writes.map(item => item[0]), ['scope', 'connection']);
  assert.deepEqual({ task: f.task, events: f.events, job: f.job }, before);
});
test('an already active Host only resumes its original paused Dot connection', async () => {
  const f = fixture(); f.lifecycle.phase = 'active';
  f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  await resumeReviewedDotHistory(f.options);
  assert.deepEqual(f.writes.map(item => item[0]), ['connection']);
  assert.equal(f.lifecycle.phase, 'active'); assert.equal(f.lifecycle.epoch, 43);
});
test('active Host connection failure preserves the active scope without pausing Muse', async () => {
  const f = fixture(); f.lifecycle.phase = 'active';
  f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  f.options.service.bindActor = () => ({ view: async () => f.view,
    resumeConnection: async () => { throw Error('connection storage failure'); } });
  await assert.rejects(resumeReviewedDotHistory(f.options), /storage failure/);
  assert.equal(f.lifecycle.phase, 'active'); assert.deepEqual(f.writes, []);
});

const changes = {
  'stale Host epoch': f => f.options.review.expectedEpoch--,
  'stale connection epoch': f => f.options.review.authorizationEpoch--,
  'changed configuration': f => f.lifecycle.previousConfigurationHash = '3'.repeat(64),
  'unfinished delegation': f => f.lifecycle.unfinishedDelegations = 1,
  'pending native reconciliation': f => f.lifecycle.reconciliationRequired = true,
  'pending operation': f => f.lifecycle.pendingOperations = 1,
  'different original connection': f => f.options.review.connectionId = 'replacement',
  'draining connection': f => f.connection.drainingAt = 999,
  'revoked connection': f => f.connection.revokedAt = 999,
  'unknown owner': f => f.options.ownerSubject = 'other',
  'missing original Agent': f => f.options.ctx.agents.get = () => undefined,
  'unaccepted live Goal': f => f.goal.phase = 'blocked',
  'missing requester acceptance': f => delete f.task.acceptedHash,
  'changed returned receipt': f => f.task.returnedHash = '3'.repeat(64),
  'tampered receipt contents': f => f.receipt.state = 'failed',
  'missing native receipt': f => f.events.shift(),
  'missing durable Goal completion': f => f.events.pop(),
  'cross-owner acceptance': f => f.task.acceptedBy = 'other',
  'orphaned original job': f => f.view.delegations.push({ ...f.job, id: 'unmatched-job' }),
  'incomplete paginated job history': f => f.view.delegations = [],
  'new public bindings in command': f => f.options.review.bindings = [],
  'wrong reviewed history digest': f => f.options.review.historyHash = '0'.repeat(64),
};

function pendingFixture() {
  const f = fixture(), input = { requestId: 'original-undispatched-request', content: 'Original public question', confirmed: true, dataScope: 'public-only' };
  f.events[1].data.goal = structuredClone(f.goal);
  Object.assign(f.goal, { id: 'original-pending-goal', phase: 'active', revision: 1, objective: input.content,
    maxGoalRounds: 1, roundsStarted: 0, activation: 'disarmed', createdAt: 10, updatedAt: 10 });
  f.events.push({ type: 'agent/inbox/spliced', data: { inserted: [{ role: 'user', source: { kind: 'user' },
    id: 'xy-input-' + hash([f.agent.id, input.requestId]), content: [{ type: 'text', text: JSON.stringify(input) }] }] } },
  { type: 'goal/change', data: { operation: 'create', goal: structuredClone(f.goal), roundsStarted: 0, createdAt: 10, updatedAt: 10 } });
  f.options.authorizePublicTask = () => true;
  return { ...f, input };
}
test('exact original public pending input survives recovery without dispatch or Goal mutation', async () => {
  const f = pendingFixture(), before = structuredClone({ events: f.events, task: f.task, goal: f.goal });
  const inspected = await inspectReviewedDotHistory(f.options);
  assert.equal(inspected.summary.native[0].pendingQuestion.requestId, f.input.requestId);
  f.options.review.historyHash = inspected.historyHash;
  await resumeReviewedDotHistory(f.options);
  assert.deepEqual({ events: f.events, task: f.task, goal: f.goal }, before);
});
const pendingChanges = {
  'unconfirmed input': f => { f.input.confirmed = false; f.events[2].data.inserted[0].content[0].text = JSON.stringify(f.input); },
  'different objective': f => f.goal.objective = 'Changed question',
  'false public policy': f => f.options.authorizePublicTask = () => false,
  'missing Host public policy': f => delete f.options.authorizePublicTask,
  'model-generated input': f => f.events[2].data.inserted[0].source.kind = 'assistant',
  'different stable input ID': f => f.events[2].data.inserted[0].id = 'xy-input-' + '0'.repeat(64),
  'duplicate input messages': f => f.events[2].data.inserted.push(structuredClone(f.events[2].data.inserted[0])),
  'already dispatched pending Goal': f => f.view.delegations.push({ ...f.job, id: 'another-job', state: 'queued' }),
  'later Goal replacement': f => f.events.push({ type: 'goal/change', data: { operation: 'create', goal: { id: 'new-goal' } } }),
  'native Goal already armed': f => f.goal.activation = 'armed',
  'native Goal round already started': f => f.goal.roundsStarted = 1,
};
for (const [name, change] of Object.entries(pendingChanges)) test(name + ' denies pending recovery before lifecycle writes', async () => {
  const f = pendingFixture(); f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  change(f); await assert.rejects(resumeReviewedDotHistory(f.options)); assert.deepEqual(f.writes, []);
});
test('a pending question changed after approval cannot retain the approved digest', async () => {
  const f = pendingFixture(); f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  f.input.content = f.goal.objective = 'Changed but still public';
  f.events[2].data.inserted[0].content[0].text = JSON.stringify(f.input);
  f.events[3].data.goal.objective = f.goal.objective;
  await assert.rejects(resumeReviewedDotHistory(f.options), { code: 'WORKSPACE_DOT_HISTORY_REVIEW' });
  assert.deepEqual(f.writes, []);
});
test('concurrent native Goal change during inspection requires fresh review', async () => {
  const f = pendingFixture();
  f.options.authorizePublicTask = () => { f.goal.revision++; return true; };
  await assert.rejects(inspectReviewedDotHistory(f.options), { code: 'WORKSPACE_DOT_HISTORY_REVIEW' });
  assert.deepEqual(f.writes, []);
});
for (const [name, change] of Object.entries(changes)) test(name + ' fails before any lifecycle write', async () => {
  const f = fixture();
  f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  change(f);
  await assert.rejects(resumeReviewedDotHistory(f.options));
  assert.deepEqual(f.writes, []);
});

test('receipt changed after approval requires a new exact review', async () => {
  const f = fixture(); f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  f.job.attemptId = 'changed-attempt';
  await assert.rejects(resumeReviewedDotHistory(f.options), { code: 'WORKSPACE_DOT_HISTORY_REVIEW' });
  assert.deepEqual(f.writes, []);
});

test('connection mutation failure returns the Host to paused and never dispatches replacement work', async () => {
  const f = fixture(); f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  f.options.service.bindActor = () => ({ view: async () => f.view,
    resumeConnection: async () => { throw Error('original storage unavailable'); } });
  await assert.rejects(resumeReviewedDotHistory(f.options), /storage unavailable/);
  assert.equal(f.lifecycle.phase, 'paused'); assert.equal(f.connection.pausedAt, 123);
  assert.deepEqual(f.writes.map(item => item[0]), ['scope', 'pause']);
});

test('an unsuccessful historical task requires exact closure and durable native Goal clearing', async () => {
  const f = fixture(); f.receipt.state = f.job.state = 'cancelled';
  const digest = hash(f.receipt);
  Object.assign(f.task, { receiptHash: digest, returnedHash: digest, closedHash: digest, closedBy: f.actor.subject });
  delete f.task.acceptedHash; delete f.task.acceptedBy;
  f.events[0].data.inserted[0].content[0].text = JSON.stringify(f.receipt);
  f.events[1].data = { operation: 'clear', cleared: { id: f.task.goalId, revision: 3 } };
  f.options.ctx.goals.get = () => undefined;
  f.options.review.historyHash = (await inspectReviewedDotHistory(f.options)).historyHash;
  await resumeReviewedDotHistory(f.options);
  assert.equal(f.writes.length, 2);
});
