import test from 'node:test';
import assert from 'node:assert/strict';
import { marketServicePlan } from './fixtures/market-validation-plan-data.mjs';
import { validatePlanInput, summarizeMarketReference, buildPreServiceReview, freezeConfirmedServiceTarget } from '../packages/workspace-market-validation/src/plan.mjs';
import { assessMarketValidation } from '../server/market-validation-assessment.mjs';
const productId = '11111111-1111-4111-8111-111111111111';
const input = plan => ({ productId, documents: [], requestId: 'synthetic-pre-service', sources: [{ kind: 'factory-product', recordId: productId, revision: 1, workspaceId: 'synthetic', projectionSha256: 'a'.repeat(64), api: '/synthetic' }], plan });
function frozen(plan = marketServicePlan(productId)) {
  validatePlanInput(input(plan)); const review = buildPreServiceReview(plan)[0];
  const context = { planId: 'original-plan', planRevision: 1, planHash: 'c'.repeat(64), planSha256: 'd'.repeat(64), subject: 'owner', workspaceId: 'workspace', channelId: 'shopify-execution', startedAt: '2026-10-01T00:00:00.000Z' };
  const confirmation = { status: 'approved', evidenceKind: 'real', approvalId: 'synthetic-human-approval', evidenceRef: 'synthetic-not-real-review', approvedBy: 'owner', workspaceId: 'workspace', approvedAt: '2026-09-30T00:00:00.000Z', planId: context.planId, planRevision: 1, planHash: context.planHash,
    targetHash: review.serviceTarget.targetHash, referenceHash: review.serviceTarget.referenceHash, reviewHash: review.serviceTarget.reviewHash };
  return { plan, review, context, confirmation, snapshot: freezeConfirmedServiceTarget(plan.paths[0], confirmation, context) };
}
test('pre-service comparable sample retains mean/median/range/count and explicit 7/28/90-day normalization without calling a provider', () => {
  for (const days of [7, 28, 90]) {
    const plan = marketServicePlan(productId, 1, days); // Keep whole synthetic counts for 90-day source.
    if (days === 90) { for (const row of plan.paths[0].marketReference.products) row.units = Math.round(row.units); plan.paths[0].serviceTarget.targetUnits = Math.round(summarizeMarketReference(plan.paths[0].marketReference).sevenDayReference.mean * .5); plan.paths[0].salesRequirement.target = plan.paths[0].serviceTarget.targetUnits; }
    validatePlanInput(input(plan)); const summary = buildPreServiceReview(plan)[0].marketReferences[0];
    assert.equal(summary.sampleCount, 3); assert.equal(summary.measuredCount, 3); assert.equal(summary.statistics.confidenceInterval, null);
    assert.equal(summary.statistics.mean, plan.paths[0].marketReference.products.reduce((sum, row) => sum + row.units, 0) / 3);
    assert.equal(summary.sevenDayReference.mean, summary.statistics.mean * 7 / days); assert.equal(summary.statistics.interpretation, 'matched_sample_not_population_mean');
    assert.equal(summary.sourceVerification, 'external_claim_not_independently_verified'); assert.ok(summary.limitations.some(item => item.includes('Small')));
  }
});
test('rankings, mismatched region/category/use/price, duplicates, missing sales and model confirmation cannot define a service standard', () => {
  const changes = [p => p.paths[0].marketReference.selection.method = 'bestseller_only', p => p.paths[0].marketReference.selection.zeroSales = 'unknown',
    ...['region', 'leafCategory', 'useCase'].map(key => p => p.paths[0].marketReference.products[0][key] = 'mismatch'), p => p.paths[0].marketReference.products[0].price = '100',
    p => p.paths[0].marketReference.products[1].productId = p.paths[0].marketReference.products[0].productId,
    p => { p.paths[0].marketReference.products[0].units = null; p.paths[0].marketReference.products[0].availability = 'unavailable'; },
    p => p.paths[0].serviceTarget.confirmed = true, p => p.paths[0].serviceTarget.targetUnits = 999, p => p.paths[0].serviceTarget.supplyUnits = 1,
    p => p.budget.status = 'undecided'];
  for (const change of changes) { const plan = marketServicePlan(productId); change(plan); assert.throws(() => validatePlanInput(input(plan))); }
  const ranking = marketServicePlan(productId); ranking.paths[0].marketReference.selection.method = 'bestseller_only'; delete ranking.paths[0].serviceTarget;
  validatePlanInput(input(ranking)); assert.ok(buildPreServiceReview(ranking)[0].marketReferences[0].gaps.includes('BESTSELLER_SELECTION_IS_NOT_MARKET_MEAN'));
});
test('human confirmation binds the pre-service plan/version, target and evidence before start; later target movement is refused', () => {
  const f = frozen(); assert.equal(f.snapshot.proposal.targetUnits, 50);
  for (const key of ['targetHash', 'referenceHash', 'reviewHash', 'planHash', 'approvedBy']) assert.throws(() => freezeConfirmedServiceTarget(f.plan.paths[0], { ...f.confirmation, [key]: 'changed' }, f.context));
  assert.throws(() => freezeConfirmedServiceTarget(f.plan.paths[0], { ...f.confirmation, approvedAt: '2026-10-02T00:00:00.000Z' }, f.context));
  assert.throws(() => freezeConfirmedServiceTarget(f.plan.paths[0], null, f.context));
});
test('35 real-contract net paid units meets 70% of the preconfirmed 50-unit Shopify target; TikTok market attainment remains separate', () => {
  const f = frozen(), scope = { planId: f.context.planId, planRevision: 1, channelId: 'shopify-execution', startAt: f.context.startedAt, endAt: '2026-10-08T00:00:00.000Z', serviceTarget: f.snapshot };
  scope.resultAssessment = { metric: 'sales_units', category: 'cups', region: 'US', channelId: 'shopify-execution', unit: 'net_paid_units_per_168h', benchmarkSourceId: 'trusted-tiktok-reference',
    benchmarkWindow: { from: '2026-09-23T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' }, minimumValidVisits: 100, validVisitDefinition: 'Exact valid visits' };
  scope.marketBenchmark = { metric: 'sales_units', category: 'cups', region: 'US', channelId: 'tiktok_shop', unit: 'net_paid_units_per_168h', sourceId: 'trusted-tiktok-reference', evidenceRef: 'synthetic-only-comparable-source',
    coverage: { ...scope.resultAssessment.benchmarkWindow }, windowHours: 168, value: 100, observedAt: '2026-09-30T00:00:00.000Z', evidenceKind: 'real', reviewed: true, validVisitDefinition: 'Exact valid visits' };
  const sample = { measurement: { status: 'observed_not_adjudicated', gaps: [] }, outcomes: { status: 'available', dataLagSeconds: 0, coverage: { from: scope.startAt, to: scope.endAt }, sourceId: 'synthetic-net-payment', metrics: { netPaidOrders: 1, netPaidUnits: 35 }, resultEvidence: { evidenceKind: 'real', evidenceRef: 'synthetic-payment-not-live', paymentStatus: 'net_paid_verified', coverageRatio: 1, validVisits: 100, validVisitDefinition: 'Exact valid visits', qualifiedInquiries: 0 } } };
  const result = assessMarketValidation({ scope, sample, windowComplete: true }); assert.equal(result.status, 'passed'); assert.equal(result.serviceTargetAssessment.ratio, .7);
  assert.equal(result.crossChannelReference, true); assert.equal(result.marketMeanAttainmentInferred, false); assert.equal(result.marketComparison.status, 'insufficient_evidence'); assert.ok(result.marketComparison.gaps.includes('COMPARABLE_TRUSTED_BENCHMARK_REQUIRED'));  assert.equal(result.goalVerified, false);
  sample.outcomes.metrics.netPaidUnits = 34; assert.equal(assessMarketValidation({ scope, sample, windowComplete: true }).status, 'below_service_target');
  sample.measurement.gaps = [{ metric: 'checkouts', status: 'unavailable' }]; assert.equal(assessMarketValidation({ scope, sample, windowComplete: true }).status, 'insufficient_evidence');
  sample.measurement.gaps = []; scope.serviceTarget.proposal.targetUnits = 40; assert.equal(assessMarketValidation({ scope, sample, windowComplete: true }).status, 'insufficient_evidence');
});

test('TikTok/FastMoss and Amazon/Sorftime references keep separate windows, ASINs, units and statistics; target selects one source', () => {
  const plan = marketServicePlan(productId), path = plan.paths[0], tiktok = path.marketReference, amazon = structuredClone(tiktok);
  amazon.id = 'amazon-reference'; amazon.sourcePlatform = 'amazon'; amazon.identifierKind = 'asin'; amazon.unitsKind = 'reported'; amazon.channelId = 'amazon_marketplace';
  amazon.source.provider = 'synthetic-sorftime'; amazon.source.tool = 'synthetic-amazon-sales'; amazon.source.evidenceRef = 'synthetic-amazon-response';
  amazon.history.days = 90; amazon.history.to = new Date(Date.parse(amazon.history.from) + 90 * 86400000).toISOString(); amazon.source.observedAt = amazon.history.to;
  amazon.salesScope = 'single_listing_or_variant'; amazon.salesDefinition = 'Synthetic reported ASIN units; parent/child scope must be checked with the real provider.';
  amazon.products.forEach((row, i) => { row.productId = 'B00000000' + i; row.evidenceRef = 'synthetic-asin-' + i; row.units = 900 * (i + 1); row.unitsKind = 'reported'; });
  path.marketReferences = [tiktok, amazon]; delete path.marketReference;
  validatePlanInput(input(plan)); const review = buildPreServiceReview(plan)[0];
  assert.equal(review.marketReferences.length, 2); assert.equal(review.statisticsCombinedAcrossPlatforms, false);
  assert.equal(review.marketReferences[0].sevenDayReference.mean, 100); assert.equal(review.marketReferences[1].sevenDayReference.mean, 140);
  assert.equal(review.marketReferences[1].identifierKind, 'asin'); assert.equal(review.marketReferences[1].history.days, 90); assert.equal(review.marketReferences[1].unitsKind, 'reported');
  assert.equal(review.serviceTarget.targetUnits, 50); assert.equal(review.serviceTarget.referenceId, tiktok.id);
  path.serviceTarget.referenceId = amazon.id; path.serviceTarget.targetUnits = 70; path.salesRequirement.target = 70;
  validatePlanInput(input(plan)); assert.equal(buildPreServiceReview(plan)[0].serviceTarget.referenceHash, summarizeMarketReference(amazon).referenceHash);
  amazon.salesUnit = 'orders'; assert.throws(() => validatePlanInput(input(plan)));
  delete path.serviceTarget; assert.equal(buildPreServiceReview(plan)[0].marketReferences[1].salesUnit, 'orders');
  path.serviceTarget = { ...marketServicePlan(productId).paths[0].serviceTarget, referenceId: 'mixed-unlabelled-average' };
 assert.throws(() => validatePlanInput(input(plan)));
});

test('zero sales remain in the sample while missing sales stay null and block reference-derived targets', () => {
  const plan = marketServicePlan(productId), ref = plan.paths[0].marketReference;
  ref.products[0].units = 0; const zero = summarizeMarketReference(ref);
  assert.equal(zero.statistics.minimum, 0); assert.equal(zero.measuredCount, 3); assert.equal(zero.statistics.mean, 920 / 3);
  ref.products[0].units = null; ref.products[0].availability = 'unavailable'; const missing = summarizeMarketReference(ref);
  assert.equal(missing.sampleCount, 3); assert.equal(missing.missingCount, 1); assert.equal(missing.statistics.mean, 460); assert.equal(missing.suitableForTargetProposal, false);
  ref.salesUnit = 'unknown'; assert.ok(summarizeMarketReference(ref).gaps.includes('SOURCE_SALES_UNIT_NOT_CONFIRMED_AS_PRODUCT_UNITS'));
  ref.source.schemaUrl = null; assert.ok(summarizeMarketReference(ref).sourceDocumentationGaps.includes('PROVIDER_SCHEMA_DOCUMENTATION_UNAVAILABLE'));
  ref.channelId = 'shopify-execution'; assert.throws(() => summarizeMarketReference(ref));
});
