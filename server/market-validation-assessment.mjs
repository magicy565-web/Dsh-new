// Pure evidence assessment, separate from human goal verification. Inputs come
// from the original frozen plan/launch and reviewed outcome adapter, never tools.
export function assessMarketValidation({ scope, sample, windowComplete }) {
  const result = { status: 'insufficient_evidence', goalVerified: false, threshold: 0.7, ratio: null,
    observed: null, benchmark: null, difference: null, evidence: [], gaps: [], recommendations: [] };
  const gap = value => result.gaps.push(value);
  const selection = scope.resultAssessment;
  const outcomes = sample.outcomes, proof = outcomes?.resultEvidence;
  const metrics = outcomes?.metrics || {};
  const visits = proof?.validVisits ?? null, inquiries = proof?.qualifiedInquiries ?? null;
  const units = metrics.netPaidUnits ?? null, orders = metrics.netPaidOrders ?? null;
  const complete = outcomes?.status === 'available' && outcomes.dataLagSeconds === 0
    && outcomes.coverage?.from === scope.startAt && outcomes.coverage?.to === scope.endAt;
  // Retained Shopify quantities and B2B inquiries are never payment evidence.
  const counts = Number.isSafeInteger(orders) && orders >= 0 && Number.isSafeInteger(units) && units >= orders && (orders === 0) === (units === 0);
  if (orders !== null && units !== null && !counts) gap('NET_PAID_COUNTS_INCONSISTENT');
  const required = sample.measurement;
  const requiredComplete = required?.status === 'observed_not_adjudicated' && Array.isArray(required.gaps) && required.gaps.length === 0;
  result.requiredMetricGaps = Array.isArray(required?.gaps) ? structuredClone(required.gaps) : [];
  if (!requiredComplete) gap('REQUIRED_MEASUREMENT_INCOMPLETE');
  for (const item of result.requiredMetricGaps) gap('REQUIRED_METRIC_NOT_MEASURED:' + item.metric);
  const paid = counts && complete && proof?.evidenceKind === 'real' && proof?.paymentStatus === 'net_paid_verified'
    && typeof proof.evidenceRef === 'string' && proof.evidenceRef.length > 0 && proof.coverageRatio === 1;
  if (!windowComplete) gap('WINDOW_NOT_ENDED');
  if (!complete || proof?.coverageRatio !== 1) gap('COMPLETE_WINDOW_COVERAGE_REQUIRED');
  if (!paid || orders === null || units === null) gap('REAL_NET_PAID_COHORT_REQUIRED');
  if (visits === null) gap('VALID_TRAFFIC_NOT_CONNECTED');
  if (inquiries === null) gap('INQUIRY_OUTCOME_NOT_CONNECTED');
  if (proof?.evidenceRef) result.evidence.push({ sourceId: outcomes.sourceId, evidenceRef: proof.evidenceRef, coverage: outcomes.coverage });
  if (!selection) gap('ASSESSMENT_METRIC_NOT_SELECTED');
  const benchmark = scope.marketBenchmark;
  const comparable = selection && benchmark?.evidenceKind === 'real' && benchmark.reviewed === true
    && typeof benchmark.evidenceRef === 'string' && benchmark.evidenceRef.length > 0
    && ['metric', 'category', 'region', 'channelId', 'unit', 'validVisitDefinition'].every(k => benchmark[k] === selection[k])
    && benchmark.coverage?.from === selection.benchmarkWindow?.from && benchmark.coverage?.to === selection.benchmarkWindow?.to
    && Number.isFinite(Date.parse(benchmark.coverage?.from)) && Date.parse(benchmark.coverage.to) - Date.parse(benchmark.coverage.from) === 168 * 3600000
    && Date.parse(benchmark.coverage.to) <= Date.parse(scope.startAt) && Date.parse(benchmark.observedAt) >= Date.parse(benchmark.coverage.to)
    && benchmark.sourceId === selection.benchmarkSourceId && benchmark.windowHours === 168
    && Number.isFinite(benchmark.value) && benchmark.value > 0
    && (selection.metric !== 'conversion_rate' || benchmark.value <= 1)
    && Number.isFinite(Date.parse(benchmark.observedAt)) && Date.parse(benchmark.observedAt) <= Date.parse(scope.startAt);
  if (!comparable) gap('COMPARABLE_TRUSTED_BENCHMARK_REQUIRED');
  else result.benchmark = { value: benchmark.value, sourceId: benchmark.sourceId, evidenceRef: benchmark.evidenceRef,
    coverage: benchmark.coverage, metric: benchmark.metric, unit: benchmark.unit, category: benchmark.category, region: benchmark.region,
    channelId: benchmark.channelId, windowHours: benchmark.windowHours, observedAt: benchmark.observedAt, validVisitDefinition: benchmark.validVisitDefinition };
  const enoughTraffic = Number.isSafeInteger(visits) && visits >= 0 && selection && Number.isSafeInteger(selection.minimumValidVisits) && selection.minimumValidVisits > 0 && proof.validVisitDefinition === selection.validVisitDefinition && visits >= selection.minimumValidVisits;
  if (!enoughTraffic) gap('VALID_TRAFFIC_SAMPLE_INSUFFICIENT');
  const conversionInRange = selection?.metric !== 'conversion_rate' || Number.isSafeInteger(visits) && visits >= 0 && counts && orders <= visits;
  if (!conversionInRange) gap('CONVERSION_RATE_OUT_OF_RANGE');
  if (windowComplete && requiredComplete && conversionInRange && paid && orders > 0 && comparable && enoughTraffic) {
    result.observed = selection.metric === 'sales_units' ? units : orders / visits;
    result.ratio = result.observed / benchmark.value;
    result.difference = { thresholdValue: benchmark.value * result.threshold, deltaFromThreshold: result.observed - benchmark.value * result.threshold, unit: selection.unit };
    result.status = result.ratio >= result.threshold ? 'passed' : 'below_benchmark';
    result.recommendations.push(result.status === 'passed' ? 'review_continuation_with_human' : 'review_offer_and_acquisition_strategy');
  } else if (windowComplete && requiredComplete && conversionInRange && complete && paid && orders === 0 && visits === 0) {
    result.status = 'traffic_anomaly'; result.recommendations.push('check_acquisition_delivery_and_collection');
  } else if (windowComplete && requiredComplete && conversionInRange && complete && paid && orders === 0 && inquiries > 0) {
    result.status = 'strategy_optimization_needed'; result.recommendations.push('review_price_offer_followup_and_checkout_without_assuming_cause');
  } else if (windowComplete && requiredComplete && conversionInRange && complete && paid && orders === 0 && inquiries === 0 && enoughTraffic) {
    result.status = 'low_demand_pending_review'; result.recommendations.push('review_demand_with_traffic_quality_and_sample_uncertainty');
  } else result.recommendations.push('connect_missing_evidence_and_review_sample_coverage');
  result.provisional = !windowComplete || result.gaps.some(g => g !== 'INQUIRY_OUTCOME_NOT_CONNECTED');
  return result;
}
