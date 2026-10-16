import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMarketValidation } from '../server/market-validation-assessment.mjs';
import { marketPlan } from './fixtures/market-validation-plan-data.mjs';
import { validatePlanInput } from '../plugins/workspace-market-validation/src/plan.mjs';
// Pure synthetic contract examples; none proves an external market average,
// real payment, live acquisition or elapsed seven-day business acceptance.
function fixture(metric = 'sales_units') {
  const selection = { metric, category: 'synthetic cups', region: 'synthetic region', channelId: 'synthetic channel',
    unit: metric === 'sales_units' ? 'net_paid_units_per_168h' : 'net_paid_orders_per_valid_visit', benchmarkWindow: { from: '2026-09-23T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' }, benchmarkSourceId: 'reviewed-fixture', validVisitDefinition: 'Bot-filtered exact-channel unique valid visits', minimumValidVisits: 100 };
  const scope = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-08T00:00:00.000Z', resultAssessment: selection,
    marketBenchmark: { ...selection, coverage: { ...selection.benchmarkWindow }, sourceId: 'reviewed-fixture', evidenceKind: 'real', reviewed: true, evidenceRef: 'synthetic-only-benchmark', windowHours: 168, value: metric === 'sales_units' ? 100 : 0.1, observedAt: '2026-09-30T00:00:00.000Z' } };
  const sample = { measurement: { status: 'observed_not_adjudicated', gaps: [] }, outcomes: { status: 'available', dataLagSeconds: 0, coverage: { from: scope.startAt, to: scope.endAt }, sourceId: 'synthetic-outcomes',
    metrics: { netPaidUnits: 70, netPaidOrders: 7 }, resultEvidence: { evidenceKind: 'real', paymentStatus: 'net_paid_verified', evidenceRef: 'synthetic-only-payment', coverageRatio: 1, validVisitDefinition: selection.validVisitDefinition, validVisits: 100, qualifiedInquiries: 0 } } };
  return { scope, sample, windowComplete: true };
}
test('explicit units or conversion passes only with real paid-contract evidence and comparable reviewed benchmark at >=70%', () => {
  for (const metric of ['sales_units', 'conversion_rate']) {
    const f = fixture(metric), result = assessMarketValidation(f);
    assert.equal(result.status, 'passed'); assert.ok(result.ratio >= .7); assert.equal(result.goalVerified, false);
    assert.equal(result.benchmark.evidenceRef, 'synthetic-only-benchmark'); assert.equal(result.evidence[0].evidenceRef, 'synthetic-only-payment');
    f.sample.outcomes.metrics.netPaidUnits = 69; f.sample.outcomes.metrics.netPaidOrders = 6;
    assert.equal(assessMarketValidation(f).status, 'below_benchmark');
  }
});
test('missing selection, benchmark, mismatched dimensions, payment/coverage/delay and short window never pass', () => {
  const changes = [f => delete f.scope.resultAssessment, f => delete f.scope.marketBenchmark,
    ...['metric', 'category', 'region', 'channelId', 'unit', 'sourceId', 'evidenceKind', 'validVisitDefinition'].map(k => f => f.scope.marketBenchmark[k] = 'wrong'),
    f => f.scope.marketBenchmark.value = 0, f => f.scope.marketBenchmark.value = NaN, f => f.scope.marketBenchmark.windowHours = 24,
    f => f.scope.marketBenchmark.coverage.to = f.scope.startAt, f => delete f.scope.marketBenchmark.coverage, f => f.scope.marketBenchmark.reviewed = false, f => f.scope.marketBenchmark.observedAt = f.scope.endAt,
    f => delete f.sample.outcomes.resultEvidence, f => f.sample.outcomes.status = 'unconfigured',
    f => f.sample.outcomes.dataLagSeconds = 30, f => f.sample.outcomes.resultEvidence.coverageRatio = .9,
    f => f.sample.outcomes.resultEvidence.validVisits = 2, f => f.sample.outcomes.resultEvidence.validVisitDefinition = 'unfiltered', f => f.sample.outcomes.metrics.netPaidOrders = null,
    f => f.sample.outcomes.metrics.netPaidUnits = null, f => f.windowComplete = false];
  for (const change of changes) { const f = fixture(); change(f); const r = assessMarketValidation(f); assert.equal(r.status, 'insufficient_evidence'); assert.equal(r.goalVerified, false); assert.ok(r.gaps.length); }
});
test('measured zero traffic is an anomaly; sufficient traffic and zero orders/inquiries is low demand pending review; inquiries suggest strategy without causal assertion', () => {
  const f = fixture(); f.sample.outcomes.metrics = { netPaidUnits: 0, netPaidOrders: 0 };
  f.sample.outcomes.resultEvidence.validVisits = 0; assert.equal(assessMarketValidation(f).status, 'traffic_anomaly');
  f.sample.outcomes.resultEvidence.validVisits = 100; assert.equal(assessMarketValidation(f).status, 'low_demand_pending_review');
  f.sample.outcomes.resultEvidence.qualifiedInquiries = 3;
  assert.equal(assessMarketValidation(f).status, 'strategy_optimization_needed');
  f.sample.outcomes.resultEvidence.qualifiedInquiries = null; assert.equal(assessMarketValidation(f).status, 'insufficient_evidence');
  f.sample.outcomes.resultEvidence.validVisits = null; f.sample.outcomes.metrics.netPaidOrders = null;
  assert.equal(assessMarketValidation(f).status, 'insufficient_evidence');
});
test('plan choice is explicit and optional; model cannot embed approved numeric market averages', () => {
  const plan = marketPlan('b2c'), input = { productId: '11111111-1111-4111-8111-111111111111', documents: [], requestId: 'fixture', sources: [{ kind: 'factory-product', recordId: '11111111-1111-4111-8111-111111111111', revision: 1, workspaceId: 'synthetic', projectionSha256: 'a'.repeat(64), api: '/synthetic' }], plan };
  validatePlanInput(input); plan.paths[0].resultAssessment = fixture().scope.resultAssessment; validatePlanInput(input);
  plan.paths[0].resultAssessment.marketAverage = 100; assert.throws(() => validatePlanInput(input)); delete plan.paths[0].resultAssessment.marketAverage;
  plan.paths[0].resultAssessment.metric = 'conversion_rate'; assert.throws(() => validatePlanInput(input));
  plan.paths[0].resultAssessment.metric = 'sales_units'; plan.paths[0].resultAssessment.benchmarkWindow.to = plan.paths[0].resultAssessment.benchmarkWindow.from; assert.throws(() => validatePlanInput(input));
});

test('required measurement gaps or contradictory paid counts cannot pass or imply low demand', () => {
  const missing = fixture(); missing.sample.measurement = { status: 'insufficient_evidence', gaps: [{ metric: 'checkouts', status: 'unconfigured', reason: 'SELECTED_METRIC_NOT_MEASURED' }] };
  const result = assessMarketValidation(missing); assert.equal(result.status, 'insufficient_evidence'); assert.equal(result.provisional, true); assert.equal(result.goalVerified, false);
  assert.deepEqual(result.requiredMetricGaps, missing.sample.measurement.gaps); assert.ok(result.gaps.includes('REQUIRED_METRIC_NOT_MEASURED:checkouts'));
  delete missing.sample.measurement; assert.equal(assessMarketValidation(missing).status, 'insufficient_evidence');
  const contradiction = fixture(); contradiction.sample.outcomes.metrics.netPaidOrders = 0;
  const invalid = assessMarketValidation(contradiction); assert.equal(invalid.status, 'insufficient_evidence'); assert.equal(invalid.provisional, true); assert.ok(invalid.gaps.includes('NET_PAID_COUNTS_INCONSISTENT'));
});
test('conversion proportion and benchmark use the same 0..1 bound; over-one order conversion input is rejected', () => {
  const f = fixture('conversion_rate'); f.sample.outcomes.metrics = { netPaidOrders: 101, netPaidUnits: 101 };
  const invalid = assessMarketValidation(f); assert.equal(invalid.status, 'insufficient_evidence'); assert.equal(invalid.provisional, true); assert.ok(invalid.gaps.includes('CONVERSION_RATE_OUT_OF_RANGE'));
  f.sample.outcomes.metrics = { netPaidOrders: 100, netPaidUnits: 100 }; f.scope.marketBenchmark.value = 1;
  const upper = assessMarketValidation(f); assert.equal(upper.status, 'passed'); assert.equal(upper.observed, 1);
  f.scope.marketBenchmark.value = 1.01; assert.equal(assessMarketValidation(f).status, 'insufficient_evidence');
});
