import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAIN_ANALYSIS_GOAL, brainAnalysisGoalInput, observationFingerprint, createObservationGate } from '../server/brain-analysis.mjs';
import { assertTemplateDefinition } from '../server/schedule-template.mjs';

const ref = (id, revision, extra = {}) => ({ kind: 'metric', id, revision, sha256: 'a'.repeat(64), fields: ['id'], windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-10-01T00:00:00.000Z', ...extra });

test('the analysis goal is a bounded template definition the scheduler accepts', () => {
  const definition = { ...brainAnalysisGoalInput(), inputContext: { memoryIds: [] } };
  const fail = (status, code) => { throw Object.assign(new Error(code), { code }); };
  assert.doesNotThrow(() => assertTemplateDefinition(definition, { memories: [] }, fail));
  assert.ok(BRAIN_ANALYSIS_GOAL.maxSteps >= 1 && BRAIN_ANALYSIS_GOAL.maxSteps <= 8);
  assert.ok(BRAIN_ANALYSIS_GOAL.maxOutputTokens >= 1600 && BRAIN_ANALYSIS_GOAL.maxOutputTokens <= 128000);
  assert.notEqual(brainAnalysisGoalInput(), BRAIN_ANALYSIS_GOAL, 'a fresh copy is returned');
});

test('the observation fingerprint ignores ordering but follows revisions and windows', () => {
  const a = ref('supply-inquiry-pipeline', 'r1'), b = ref('library-product-completeness', 'r2');
  assert.equal(observationFingerprint([a, b]), observationFingerprint([b, a]));
  assert.notEqual(observationFingerprint([a, b]), observationFingerprint([{ ...a, revision: 'r1-next' }, b]));
  assert.notEqual(observationFingerprint([a, b]), observationFingerprint([{ ...a, windowEnd: '2026-10-02T00:00:00.000Z' }, b]));
  assert.equal(observationFingerprint([]), observationFingerprint([]));
});

const analysisGoal = 'goal-analysis';
const schedule = { id: 'schedule-1', goalId: analysisGoal };
const stateWith = runs => ({ capabilities: { scheduleRuns: runs } });

test('the gate only governs its own analysis schedule', () => {
  const gate = createObservationGate({ goalId: analysisGoal, readFingerprint: () => 'f1' });
  assert.deepEqual(gate({ id: 's2', goalId: 'other-goal' }, stateWith([])), { run: true, reason: 'NOT_ANALYSIS_SCHEDULE' });
});

test('the first occurrence has no baseline and runs', () => {
  const gate = createObservationGate({ goalId: analysisGoal, readFingerprint: () => 'f1' });
  assert.deepEqual(gate(schedule, stateWith([])), { run: true, reason: 'NO_BASELINE', fingerprint: 'f1' });
});

test('unchanged observations skip, changed observations run', () => {
  let fingerprint = 'f1';
  const gate = createObservationGate({ goalId: analysisGoal, readFingerprint: () => fingerprint });
  const previous = [{ scheduleId: 'schedule-1', analysisFingerprint: 'f1' }];
  assert.equal(gate(schedule, stateWith(previous)).run, false);
  assert.equal(gate(schedule, stateWith(previous)).reason, 'OBSERVATION_UNCHANGED');
  fingerprint = 'f2';
  assert.equal(gate(schedule, stateWith(previous)).run, true);
  assert.equal(gate(schedule, stateWith(previous)).reason, 'OBSERVATIONS_CHANGED');
  // a run from another schedule is not a baseline for this one
  assert.equal(gate(schedule, stateWith([{ scheduleId: 'other', analysisFingerprint: 'f2' }])).reason, 'NO_BASELINE');
});

test('the gate refuses an incomplete configuration', () => {
  assert.throws(() => createObservationGate({ readFingerprint: () => 'f' }), /analysis goal id/);
  assert.throws(() => createObservationGate({ goalId: 'g' }), /fingerprint reader/);
});
