import test from 'node:test';
import assert from 'node:assert/strict';
import {draftDecisionFromDiagnosis} from '../plugins/workspace-goal-intelligence/src/decision-planner.mjs';
test('planner stays non-executable and evidence-first',()=>{const r=draftDecisionFromDiagnosis({goalId:'g',diagnosis:{signals:[{evidenceId:'metric:1',gaps:['UNKNOWN_COHORT_OUTCOMES']}]},context:{context:{payload:{goalIds:['g']}}}});assert.equal(r.status,'proposal-only');assert.equal(r.recommendation.optionId,'investigate');assert.equal(r.options.some(x=>x.kind==='wait'),true);assert.equal(r.options.some(x=>x.capability==='external-contact'),false)});
test('planner refuses cold start',()=>{assert.equal(draftDecisionFromDiagnosis({goalId:null,diagnosis:{signals:[]},context:null}).status,'needs-evidence')});

test('planner can preview a decision on cold start without a Goal', () => {
  const r = draftDecisionFromDiagnosis({
    diagnosis: { signals: [{
      id: 'metric:1:followup',
      type: 'followup-aging',
      evidenceId: 'metric:1',
      sourceRef: { kind: 'metric', id: '1', revision: '1', sha256: 'x'.repeat(64), fields: ['metricType'] },
      priority: 96,
      current: { stale: 3, pending: 5 }
    }] }
  });
  assert.equal(r.status, 'proposal-only');
  assert.equal(r.goalId, null);
  assert.equal(r.businessGoalVerified, false);
  assert.equal(r.hypotheses.length, 3);
  assert.equal(r.options.some(option => option.id === 'investigate'), true);
  assert.equal(r.options.some(option => option.id === 'wait'), true);
});

test('planner offers only internal drafting for data-gap signals', () => {
  const r = draftDecisionFromDiagnosis({
    diagnosis: { signals: [{
      id: 'metric:2:product',
      type: 'product-evidence',
      evidenceId: 'metric:2',
      sourceRef: { kind: 'metric', id: '2', revision: '1', sha256: 'x'.repeat(64), fields: ['metricType'] },
      priority: 88,
      current: { incomplete: 2 }
    }] },
    context: { context: { payload: { goalIds: ['g'] } } }
  });
  assert.equal(r.options.some(option => option.capability === 'external-contact'), false);
  assert.equal(r.options.some(option => option.capability === 'draft'), true);
  assert.equal(r.recommendation.optionId, 'investigate');
});


test('each decision preview binds its selected signal evidence instead of unrelated card sources', () => {
  const r = draftDecisionFromDiagnosis({
    goalId: 'g',
    diagnosis: { signals: [
      { id: 'metric:1', type: 'followup-aging', evidenceId: 'metric:1', sourceRef: { kind: 'metric', id: '1', revision: '1', sha256: 'a'.repeat(64), fields: ['metricType'] }, priority: 96 },
      { id: 'metric:2', type: 'product-evidence', evidenceId: 'metric:2', sourceRef: { kind: 'metric', id: '2', revision: '1', sha256: 'b'.repeat(64), fields: ['metricType'] }, priority: 88 }
    ] },
    context: { context: { payload: { goalIds: ['g'] } } }
  });
  assert.deepEqual(r.sourceRefs.map(ref => ref.id), ['1']);
});
