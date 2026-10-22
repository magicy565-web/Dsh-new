import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createCapabilityService } from '../server/capabilities.mjs';
import { createRuntime } from '../server/runtime.mjs';

const code = expected => error => error.code === expected;
async function approve(service, id) { const { approval } = await service.requestApproval(service.scheduleApprovalRequest(id)); await service.decideApproval(approval.id, { decision: 'approved', confirmed: true }); await service.enableSchedule(id, { approvalId: approval.id }); return approval; }
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-schedule-template-'));
  let store = await openStore(directory), time = Date.parse('2026-10-04T10:00:00Z'), runtime, capabilities;
  const calls = [];
  const provider = { configured: true, complete: async input => { calls.push(input); return options.complete ? options.complete(input) : { content: JSON.stringify({ done: true, content: `Fresh occurrence ${calls.length}` }), usage: { completionTokens: 40 } }; } };
  const boot = async () => {
    capabilities = await createCapabilityService({ store, clock: () => time, occurrencePrecondition: options.occurrencePrecondition, dispatchGoal: async ({ goalId, requestId, expectedGoalDefinitionHash, scheduleClaim }) => { if (options.beforeDispatch) await options.beforeDispatch({ store, capabilities, scheduleClaim }); return runtime.updateGoal(goalId, { action: 'resume', queued: true, requestId }, { expectedGoalDefinitionHash, scheduleClaim }); } });
    runtime = await createRuntime({ store, provider, capabilities });
  };
  await boot();
  t.after(async () => { await capabilities.close(); await runtime.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const source = (await runtime.createGoal({ title: 'Recurring local report', description: 'Use only selected sources.', maxSteps: 2, maxOutputTokens: 3200 })).goal;
  return { get store() { return store; }, get runtime() { return runtime; }, get service() { return capabilities; }, calls, source,
    advance(ms) { time += ms; },
    async schedule(extra = {}) { return (await capabilities.createSchedule({ title: 'Repeated report', goalId: source.id, kind: 'every', everySeconds: 60, goalMode: 'template', maxOccurrences: 2, ...extra })).schedule; },
    async restart() { await capabilities.close(); await runtime.close(); await store.close(); store = await openStore(directory); await boot(); },
    async finished() { for (let i = 0; i < 500; i++) { const state = store.read(); if (state.goals.filter(goal => goal.scheduleOccurrence).every(goal => ['review_required', 'completed', 'failed', 'blocked', 'awaiting_approval'].includes(goal.status))) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('Inert fixture did not finish'); },
  };
}

test('explicit template repeats completed work with fresh bounded isolated goals and ends at approved total', async t => {
  const f = await fixture(t); const schedule = await f.schedule();
  await f.store.update(state => { state.messages.push({ id: 'not-copied', conversationId: f.source.conversationId, role: 'assistant', content: 'OLD_HISTORY_MUST_NOT_REPEAT', status: 'complete' }); state.memories.push({ id: 'unselected', content: 'UNSELECTED_MEMORY', enabled: true }); state.conversations[0].nativeSessionId = 'do-not-copy'; });
  assert.equal(schedule.enabled, false); assert.equal(f.calls.length, 0);
  const approval = await approve(f.service, schedule.id);
  assert.equal(approval.payload.goalMode, 'template'); assert.equal(approval.payload.standingApproval.remainingOccurrences, 2);
  assert.equal(approval.payload.standingApproval.budgetScope, 'per-occurrence');
  f.advance(60000); const first = await f.service.tick(); await f.finished();
  assert.equal(first.runs[0].status, 'queued'); assert.equal(f.calls.length, 1);
  const firstGoal = f.store.read().goals.find(goal => goal.id === first.runs[0].goalId);
  assert.equal(firstGoal.status, 'review_required'); assert.equal(firstGoal.maxSteps, 2); assert.equal(firstGoal.maxOutputTokens, 3200);
  await f.restart(); await f.service.tick(); assert.equal(f.calls.length, 1);
  f.advance(60000); const second = await f.service.tick(); await f.finished();
  assert.equal(f.calls.length, 2); assert.notEqual(first.runs[0].goalId, second.runs[0].goalId);
  const goals = f.store.read().goals.filter(goal => goal.scheduleOccurrence);
  assert.equal(new Set(goals.map(goal => goal.conversationId)).size, 2);
  assert.deepEqual(goals.map(goal => goal.stepCount), [1, 1]); assert.deepEqual(goals.map(goal => goal.outputTokens), [40, 40]);
  assert.deepEqual(goals.map(goal => goal.scheduleOccurrence.ordinal), [1, 2]);
  assert.equal(goals.every(goal => goal.scheduleOccurrence.sourceGoalId === f.source.id), true);
  for (const call of f.calls) { assert.doesNotMatch(JSON.stringify(call.messages), /OLD_HISTORY_MUST_NOT_REPEAT|UNSELECTED_MEMORY|Fresh occurrence/); assert.equal(call.nativeSessionId, undefined); }
  assert.equal(f.service.getSchedule(schedule.id).status, 'ended');
  assert.equal(f.service.getSchedule(schedule.id).occurrenceCount, 2);
  f.advance(600000); await f.service.tick(); assert.equal(f.calls.length, 2);
  await assert.rejects(approve(f.service, schedule.id), code('SCHEDULE_LIMIT_REACHED'));
});

test('legacy and new default schedules continue same goal and cannot silently become templates', async t => {
  const f = await fixture(t); const { schedule } = await f.service.createSchedule({ title: 'Existing behavior', goalId: f.source.id, kind: 'every', everySeconds: 60 });
  assert.equal(schedule.goalMode, 'resume');
  await approve(f.service, schedule.id); f.advance(60000); await f.service.tick();
  for (let i = 0; i < 100 && f.store.read().goals[0].status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 2));
  f.advance(60000); await f.service.tick(); assert.equal(f.calls.length, 1); assert.equal(f.store.read().goals.length, 1); assert.equal(f.service.getSchedule(schedule.id).enabled, false);
  await assert.rejects(f.service.createSchedule({ title: 'Unsafe default', goalId: f.source.id, kind: 'every', everySeconds: 60, maxOccurrences: 2 }), code('INVALID_INPUT'));
  await assert.rejects(f.schedule({ maxOccurrences: undefined }), code('INVALID_INPUT'));
  await assert.rejects(f.schedule({ kind: 'at', scheduledAt: '2026-10-04T10:04:00Z', everySeconds: undefined }), code('INVALID_INPUT'));
});

test('templates coalesce missed intervals without backlog and atomically skip overlapping occurrences', async t => {
  let finish;
  const f = await fixture(t, { complete: () => new Promise(resolve => { finish = () => resolve({ content: JSON.stringify({ done: true, content: 'done' }) }); }) });
  const schedule = await f.schedule({ maxOccurrences: 3 }); await approve(f.service, schedule.id);
  f.advance(190000); await Promise.all([f.service.tick(), f.service.tick(), f.service.tick()]);
  for (let i = 0; i < 50 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.calls.length, 1); assert.equal(f.service.listScheduleRuns().length, 1); assert.equal(f.service.listScheduleRuns()[0].missedOccurrences, 2);
  assert.equal(f.service.listScheduleRuns()[0].dueAt, '2026-10-04T10:03:00.000Z');
  f.advance(50000); const skipped = await f.service.tick();
  assert.equal(skipped.runs[0].status, 'skipped'); assert.equal(skipped.runs[0].skipReason, 'PREVIOUS_OCCURRENCE_RUNNING');
  assert.equal(f.store.read().goals.length, 2); assert.equal(f.service.getSchedule(schedule.id).occurrenceCount, 1);
  finish(); await f.finished(); await f.service.tick(); assert.equal(f.calls.length, 1);
  f.advance(60000); await f.service.tick();
  for (let i = 0; i < 50 && f.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 2));
  finish(); await f.finished(); assert.equal(f.calls.length, 2);
});

test('standing approvals bind mode, lifetime cap, source input revisions and budgets; edits never reset usage', async t => {
  const f = await fixture(t); const schedule = await f.schedule();
  const { approval } = await f.service.requestApproval(f.service.scheduleApprovalRequest(schedule.id)); await f.service.decideApproval(approval.id, { decision: 'approved', confirmed: true });
  await f.service.updateSchedule(schedule.id, { maxOccurrences: 3 });
  await assert.rejects(f.service.enableSchedule(schedule.id, { approvalId: approval.id }), code('APPROVAL_MISMATCH'));
  await approve(f.service, schedule.id); f.advance(60000); await f.service.tick(); await f.finished();
  await f.service.updateSchedule(schedule.id, { maxOccurrences: 2 }); assert.equal(f.service.getSchedule(schedule.id).occurrenceCount, 1);
  assert.equal(f.service.scheduleApprovalRequest(schedule.id).payload.standingApproval.remainingOccurrences, 1);
  await approve(f.service, schedule.id);
  await f.runtime.updateGoal(f.source.id, { maxOutputTokens: 4000 });
  f.advance(60000); await f.service.tick(); assert.equal(f.calls.length, 1); assert.equal(f.service.getSchedule(schedule.id).lastError.code, 'GOAL_CHANGED');
});

test('unresolved, failed and deleted occurrence goals stop later dispatch; scoped memories cannot cross fresh conversations', async t => {
  const f = await fixture(t); const schedule = await f.schedule(); await approve(f.service, schedule.id); f.advance(60000); const result = await f.service.tick(); await f.finished();
  await f.store.update(state => { state.goals.find(goal => goal.id === result.runs[0].goalId).status = 'awaiting_approval'; });
  f.advance(60000); await f.service.tick(); assert.equal(f.calls.length, 1); assert.equal(f.service.getSchedule(schedule.id).lastError.code, 'PREVIOUS_OCCURRENCE_UNRESOLVED');
  await assert.rejects(approve(f.service, schedule.id), code('PREVIOUS_OCCURRENCE_UNRESOLVED'));
  await f.store.update(state => { state.memories.push({ id: 'scoped', content: 'Only in source conversation', conversationId: f.source.conversationId }); state.goals.find(goal => goal.id === f.source.id).inputContext = { artifacts: [], skills: [], memoryIds: ['scoped'], connectorActions: [] }; });
  const another = await f.schedule(); assert.throws(() => f.service.scheduleApprovalRequest(another.id), code('TEMPLATE_MEMORY_SCOPE'));
});

test('disable between claim and runtime admission blocks model work and does not replay the saved fresh goal', async t => {
  const f = await fixture(t, { beforeDispatch: async ({ capabilities, scheduleClaim }) => capabilities.disableSchedule(scheduleClaim.scheduleId) });
  const schedule = await f.schedule(); await approve(f.service, schedule.id); f.advance(60000);
  const result = await f.service.tick(); assert.equal(result.runs[0].status, 'failed'); assert.equal(f.calls.length, 0);
  assert.equal(f.store.read().goals.filter(goal => goal.scheduleOccurrence).length, 1);
  await f.restart(); f.advance(60000); await f.service.tick(); assert.equal(f.calls.length, 0);
  await assert.rejects(approve(f.service, schedule.id), code('PREVIOUS_OCCURRENCE_UNRESOLVED'));
});

test('a declining precondition skips the occurrence without spending the approved total or calling the model', async t => {
  const f = await fixture(t, { occurrencePrecondition: () => ({ run: false, reason: 'OBSERVATION_UNCHANGED', fingerprint: 'f'.repeat(64) }) });
  const schedule = await f.schedule(); await approve(f.service, schedule.id);
  f.advance(60000);
  const first = await f.service.tick();
  assert.equal(first.runs[0].status, 'skipped');
  assert.equal(first.runs[0].skipReason, 'OBSERVATION_UNCHANGED');
  assert.equal(first.runs[0].goalId, null);
  assert.equal(first.runs[0].analysisFingerprint, 'f'.repeat(64));
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.read().goals.filter(goal => goal.scheduleOccurrence).length, 0);
  const saved = f.service.getSchedule(schedule.id);
  assert.equal(saved.enabled, true);
  assert.equal(saved.status, 'active');
  assert.equal(saved.occurrenceCount ?? 0, 0);
  // The next interval is still schedulable: a skip is not a consumed occurrence.
  f.advance(60000);
  const second = await f.service.tick();
  assert.equal(second.runs[0].status, 'skipped');
  assert.equal(f.calls.length, 0);
});

test('a throwing precondition still runs the bounded occurrence and records the fault', async t => {
  const f = await fixture(t, { occurrencePrecondition: () => { throw new Error('synthetic gate failure'); } });
  const schedule = await f.schedule(); await approve(f.service, schedule.id);
  f.advance(60000);
  const result = await f.service.tick(); await f.finished();
  assert.equal(result.runs[0].status, 'queued');
  assert.equal(result.runs[0].occurrencePreconditionError, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.read().goals.filter(goal => goal.scheduleOccurrence).length, 1);
});
