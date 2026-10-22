// M1 acceptance: a decision's evidence is pinned to the window it was observed
// over, so the decision stays verifiable after the business has moved on. The
// review then supplies a *later* observation window and the outcome loop closes.
//
// This uses the real source adapter and the real Brain over the synthetic
// Store/artifact fixture. It is not a real enterprise or a real model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openFixture, contextInput, model } from './fixtures/goal-brain-fixture.mjs';
import { createBusinessBrain } from '../plugins/workspace-goal-intelligence/src/brain.mjs';
import { createBusinessBrainSourceAdapter } from '../server/business-brain-source-adapter.mjs';
import { same, sourceId } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const DAY = 86400000;
const WORKSPACE = 'enterprise-A';
const GOAL = 'overseas';
const identity = { workspaceId: WORKSPACE };
const call = (brain, method, input = {}, signal) => brain[method](input, signal, model);
const blocked = (promise, code) => assert.rejects(promise, e => e.code === code);

function businessStore() {
  return {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: {
      inquiries: [
        { workspaceId: WORKSPACE, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', status: 'replied', replies: [{ id: 'r0' }] }
      ]
    },
    businessLibrary: { products: [] }
  };
}

/** Brain whose metric evidence comes from the real adapter, everything else from the fixture. */
function pinnedBrain(fixture, adapter) {
  const env = fixture.makeBrain(WORKSPACE);
  const check = ({ sourceRefs, sources, goalIds, goals, operation }) => {
    if (fixture.state.revoked || operation && !fixture.state.writesAllowed) return false;
    for (let i = 0; i < sourceRefs.length; i++) {
      // capture() decorates its copy with evidenceId/authority; the adapter only
      // ever returns the five projected fields.
      const expected = { workspaceId: sources[i].workspaceId, reference: sources[i].reference, observedAt: sources[i].observedAt, validUntil: sources[i].validUntil, values: sources[i].values };
      try { adapter.current({ identity, reference: sourceRefs[i], expected }); } catch { return false; }
    }
    return goalIds.every((id, i) => same(fixture.state.goals.get(JSON.stringify([WORKSPACE, id])), goals[i]));
  };
  return createBusinessBrain({
    ...env.options,
    readSource: async ({ reference }) => adapter.read({ identity, reference }),
    assertCurrent: check,
    assertCommit: check
  });
}

function decisionFor(metricEvidenceId) {
  return {
    id: 'decision-m1', requestId: 'decision-m1-save', expectedRevision: 0, contextRevision: 1, goalId: GOAL,
    sourceRefs: [], problem: 'Inquiry response rate after the follow-up decision',
    hypotheses: [{
      id: 'h1', explanation: 'Faster first response raises the share of inquiries that progress.',
      supportingEvidence: [metricEvidenceId], contradictingEvidence: [], missingEvidence: ['Buyer intent is still unobserved.']
    }],
    options: [
      { id: 'investigate', title: 'Follow up on open inquiries within one day', kind: 'investigate', capability: 'analysis',
        description: 'Observe response rate on a later window before changing supply policy.', evidenceIds: [metricEvidenceId], risk: 'low',
        estimate: { currency: 'USD', costMinor: { min: 0, max: 600 }, incrementalContributionMinor: null, assumptions: ['Planning range, not a quote.'] },
        requirements: ['Owner review before any external action.'] },
      { id: 'wait', title: 'Wait for more inquiry volume', kind: 'wait', capability: 'none', description: 'No change until the cohort matures.',
        evidenceIds: [], risk: 'low', estimate: { currency: 'USD', costMinor: { min: 0, max: 0 }, incrementalContributionMinor: { min: 0, max: 0 }, assumptions: ['Illustrative do-nothing scenario.'] }, requirements: [] }
    ],
    recommendation: { optionId: 'investigate', rationale: 'Observe before concluding anything about cause.', verification: { metricId: 'supply-inquiry-pipeline', observationDays: 7, stopConditions: ['Stop if the cohort stays unresolved.'] } }
  };
}

async function seed(fixture, adapter) {
  fixture.addGoal(WORKSPACE);
  const [pipelineRef] = await adapter.list({ identity });
  const brain = pinnedBrain(fixture, adapter);
  await call(brain, 'contextSave', contextInput([pipelineRef]));
  await call(brain, 'decisionSave', decisionFor(`metric:supply-inquiry-pipeline`));
  return brain;
}

test('a decision stays verifiable after new business activity, and a later window closes the loop', async t => {
  const f = openFixture(); t.after(() => f.close());
  const business = businessStore();
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => business }, workspaceId: WORKSPACE, clock: () => f.state.clock });
  const brain = await seed(f, adapter);
  const pinnedRef = (await call(brain, 'contextRead')).data.context.payload.sourceRefs[0];

  // Five weeks later the business has moved on: new inquiries arrived after the
  // decision, so the "current" window is a different one.
  f.state.clock = Date.parse('2026-11-30T06:00:00.000Z');
  business.supplyNetwork.inquiries.push(
    { workspaceId: WORKSPACE, createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', status: 'replied', replies: [{ id: 'r1' }] },
    { workspaceId: WORKSPACE, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z', status: 'replied', replies: [{ id: 'r2' }] }
  );

  // The decision is still readable, against exactly the window it was saved over.
  const reread = await call(brain, 'decisionRead', { id: 'decision-m1' });
  assert.deepEqual(reread.data.decision.payload.sourceRefs, []);
  assert.deepEqual(reread.data.sources[0].reference, pinnedRef);

  // The review supplies a *later* observation window for the same KPI.
  const freshRef = (await adapter.list({ identity })).find(ref => ref.id === 'supply-inquiry-pipeline');
  const reviewed = await call(brain, 'reviewSave', {
    requestId: 'review-m1', expectedRevision: 0, decisionId: 'decision-m1', decisionRevision: 1,
    sourceRefs: [freshRef], metricEvidenceId: sourceId(freshRef), interpretation: 'supported',
    rationale: 'More inquiries progressed in the observed window; this is an observation, not causal proof.',
    alternativeExplanations: ['Seasonality or buyer mix could explain the change.']
  });
  assert.equal(reviewed.data.assessment.status, 'observed-not-adjudicated');
  assert.equal(reviewed.data.assessment.value, 2);
  assert.equal(reviewed.data.assessment.businessGoalVerified, false);
  assert.equal(reviewed.data.assessment.causalEffect, null);
  assert.equal((await call(brain, 'brief')).data.savedDecisionCards[0].outcomeStatus, 'awaiting-owner-review');
});

test('an outcome window that starts before the decision is still refused', async t => {
  const f = openFixture(); t.after(() => f.close());
  const business = businessStore();
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => business }, workspaceId: WORKSPACE, clock: () => f.state.clock });
  const brain = await seed(f, adapter);
  const pinnedRef = (await call(brain, 'contextRead')).data.context.payload.sourceRefs[0];

  // The pinned window ends before the decision: it can never be an outcome.
  await blocked(call(brain, 'reviewSave', {
    requestId: 'review-early', expectedRevision: 0, decisionId: 'decision-m1', decisionRevision: 1,
    sourceRefs: [pinnedRef], metricEvidenceId: sourceId(pinnedRef), interpretation: 'inconclusive',
    rationale: 'No post-decision window exists yet.', alternativeExplanations: ['The cohort has not matured.']
  }), 'BRAIN_METRIC_WINDOW_INVALID');
});

test('a decision is refused when its pinned evidence window was rewritten underneath it', async t => {
  const f = openFixture(); t.after(() => f.close());
  const business = businessStore();
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => business }, workspaceId: WORKSPACE, clock: () => f.state.clock });
  const brain = await seed(f, adapter);

  // Backfill a row inside the pinned window: the recorded evidence can no longer
  // be reproduced, so the decision must fail closed instead of quietly drifting.
  business.supplyNetwork.inquiries.push({ workspaceId: WORKSPACE, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', status: 'replied', replies: [{ id: 'late' }] });
  f.state.clock = Date.parse('2026-10-20T06:00:00.000Z');
  await blocked(call(brain, 'decisionRead', { id: 'decision-m1' }), 'BRAIN_SOURCE_CHANGED');
});
