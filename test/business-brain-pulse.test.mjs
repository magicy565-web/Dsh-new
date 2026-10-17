import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBusinessPulse } from '../plugins/workspace-goal-intelligence/src/pulse.mjs';

const source = { kind: 'metric', id: 'supply-inquiry-aging', revision: '1', sha256: 'x'.repeat(64), fields: ['metricType'] };
const draft = {
  status: 'proposal-only',
  goalId: null,
  businessGoalVerified: false,
  problem: '有超时询盘需要核对。',
  sourceRefs: [source],
  hypotheses: [
    { id: 'h1', explanation: '跟进可能中断：需要核对记录。', supportingEvidence: ['metric:supply-inquiry-aging'], contradictingEvidence: [], missingEvidence: ['FOLLOWUP_EVENT_DATA'] },
    { id: 'h2', explanation: '动作可能没有回写。', supportingEvidence: ['metric:supply-inquiry-aging'], contradictingEvidence: [], missingEvidence: ['COMMUNICATION_LOG'] },
    { id: 'h3', explanation: '客户可能暂时没有回复。', supportingEvidence: ['metric:supply-inquiry-aging'], contradictingEvidence: [], missingEvidence: ['CUSTOMER_RESPONSE_CONTEXT'] }
  ],
  options: [
    { id: 'investigate', title: '先核对原因', kind: 'investigate', capability: 'analysis', description: '补证据。', evidenceIds: ['metric:supply-inquiry-aging'], risk: 'low', requirements: [] },
    { id: 'wait', title: '继续观察', kind: 'wait', capability: 'none', description: '等待下一窗口。', evidenceIds: ['metric:supply-inquiry-aging'], risk: 'low', requirements: [] }
  ],
  recommendation: { optionId: 'investigate', rationale: '先补证据。', verification: { metricId: 'metric:supply-inquiry-aging', observationDays: 7, stopConditions: ['出现新结果'] } }
};

test('pulse attaches a decision preview to evidence-backed cards and keeps the home capped at three', () => {
  const diagnosis = {
    signals: [
      {
        kind: 'inquiry-aging',
        evidenceId: 'metric:supply-inquiry-aging',
        sourceRef: source,
        priority: 96,
        window: { start: '2026-09-16T00:00:00.000Z', end: '2026-10-16T00:00:00.000Z' },
        current: { stale: 3, pending: 4, eligible: 8, progressed: 4, staleThresholdDays: 7 }
      },
      {
        kind: 'product-completeness',
        evidenceId: 'metric:product',
        sourceRef: { ...source, id: 'product' },
        priority: 88,
        current: { incomplete: 2, total: 5, active: 5, complete: 3, archived: 0, missingImages: 1, missingSkus: 1, missingDocuments: 2, missingSupply: 1 }
      },
      {
        kind: 'inquiry-pipeline',
        evidenceId: 'metric:pipeline',
        sourceRef: { ...source, id: 'pipeline' },
        priority: 91,
        current: { pending: 2, unknown: 0, eligible: 6, progressed: 4 }
      },
      {
        kind: 'inquiry-outcome',
        evidenceId: 'metric:outcome',
        sourceRef: { ...source, id: 'outcome' },
        priority: 95,
        current: { unknown: 1 }
      }
    ]
  };
  const cards = buildBusinessPulse({
    context: { context: null, sources: [{ evidenceId: 'metric:supply-inquiry-aging', reference: source }] },
    diagnosis,
    decisionDrafts: [draft]
  });
  assert.equal(cards.length, 3);
  assert.deepEqual(cards[0].decisionDraft?.recommendation.optionId, 'investigate');
});
