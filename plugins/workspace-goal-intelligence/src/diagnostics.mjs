import { fail, safeJson, timestamp } from './contracts.mjs';
import { cohortConversion } from './economics.mjs';
import { extractBusinessSignals } from './signals.mjs';

const int = value => Number.isSafeInteger(value) && value >= 0;
const counts = value => value && ['eligible', 'converted', 'pending', 'unknown'].every(k => int(value[k]));
const fields = new Set(['metricType', 'windowStart', 'windowEnd', 'eligible', 'converted', 'pending', 'unknown', 'baseline', 'segment']);
const baselineFields = new Set(['windowStart', 'windowEnd', 'eligible', 'converted', 'pending', 'unknown']);
const segmentFields = new Set(['productId', 'market', 'channel']);
const closed = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.has(k));

function windowOf(row, now) {
  const start = timestamp(row.windowStart);
  const end = timestamp(row.windowEnd);
  if (!(start < end) || end > now) fail('BRAIN_METRIC_WINDOW_INVALID');
  return { start, end };
}

export function analyzeInquiryFunnel(source, now = Date.now()) {
  if (source?.reference?.kind !== 'metric') fail('BRAIN_METRIC_INVALID');
  const v = safeJson(source.values, 16 * 1024);
  if (!closed(v, fields) || !['inquiry-funnel-v1','commerce-product-cohort-v1'].includes(v.metricType) || !counts(v) || !closed(v.segment, segmentFields) || !['productId', 'market', 'channel'].every(k => typeof v.segment[k] === 'string' && v.segment[k].trim())) fail('BRAIN_METRIC_INVALID');
  const { start } = windowOf(v, now);
  const current = cohortConversion(v);
  let prior = null;
  let descriptiveRateDelta = null;
  let comparisonStatus = 'no-baseline';
  if (v.baseline !== null) {
    if (!closed(v.baseline, baselineFields) || !counts(v.baseline)) fail('BRAIN_METRIC_INVALID');
    const previousWindow = windowOf(v.baseline, now);
    if (previousWindow.end > start) fail('BRAIN_METRIC_WINDOW_OVERLAP');
    prior = cohortConversion(v.baseline);
    if (prior.rate !== null && current.rate !== null && current.coverage === 1 && prior.coverage === 1) {
      descriptiveRateDelta = Math.round((current.rate - prior.rate) * 10000) / 10000;
      comparisonStatus = 'descriptive-only';
    } else comparisonStatus = 'incomplete-or-unmeasurable-cohorts';
  }
  const gaps = [];
  if (current.eligible === 0) gaps.push('NO_ELIGIBLE_INQUIRIES');
  if (current.pending > 0) gaps.push('PENDING_COHORT_MEMBERS');
  if (current.unknown > 0) gaps.push('UNKNOWN_COHORT_OUTCOMES');
  if (v.baseline === null) gaps.push('NO_COMPARABLE_BASELINE');
  else if (comparisonStatus !== 'descriptive-only') gaps.push('INCOMPLETE_BASELINE_OR_CURRENT_COHORT');
  return safeJson({
    kind: v.metricType === 'commerce-product-cohort-v1' ? 'commerce-cohort' : 'inquiry-funnel',
    evidenceId: source.evidenceId,
    sourceRef: source.reference,
    observedAt: source.observedAt,
    segment: v.segment,
    window: { start: v.windowStart, end: v.windowEnd },
    current,
    baseline: prior,
    comparisonStatus,
    descriptiveRateDelta,
    gaps,
    priority: current.unknown > 0 ? 95 : current.pending > 0 ? 91 : 70,
    conclusion: v.metricType === 'commerce-product-cohort-v1' ? 'commerce-cohort-measurement-not-causal-diagnosis' : 'measurement-not-causal-diagnosis',
    recommendationsAllowed: false,
    businessGoalVerified: false
  }, 20 * 1024);
}

export function analyzeInquiryPipeline(source, now = Date.now()) {
  if (source?.reference?.kind !== 'metric') fail('BRAIN_METRIC_INVALID');
  const v = safeJson(source.values, 16 * 1024);
  const required = ['metricType', 'windowStart', 'windowEnd', 'eligible', 'progressed', 'pending', 'unknown'];
  if (!required.every(k => Object.hasOwn(v, k)) || v.metricType !== 'inquiry-pipeline-v1' || !['eligible', 'progressed', 'pending', 'unknown'].every(k => int(v[k]))) fail('BRAIN_METRIC_INVALID');
  windowOf(v, now);
  if (v.progressed + v.pending + v.unknown > v.eligible) fail('BRAIN_METRIC_INVALID');
  const gaps = [];
  if (v.eligible === 0) gaps.push('NO_ELIGIBLE_INQUIRIES');
  if (v.pending > 0) gaps.push('PENDING_PIPELINE_ITEMS');
  if (v.unknown > 0) gaps.push('UNKNOWN_PIPELINE_ITEMS');
  return safeJson({
    kind: 'inquiry-pipeline',
    evidenceId: source.evidenceId,
    sourceRef: source.reference,
    observedAt: source.observedAt,
    window: { start: v.windowStart, end: v.windowEnd },
    current: { eligible: v.eligible, progressed: v.progressed, pending: v.pending, unknown: v.unknown },
    gaps,
    priority: v.unknown > 0 ? 95 : v.pending > 0 ? 91 : 70,
    conclusion: 'pipeline-observation-not-conversion-or-causal-diagnosis',
    recommendationsAllowed: false,
    businessGoalVerified: false
  }, 16 * 1024);
}

export function analyzeInquiryAging(source, now = Date.now()) {
  if (source?.reference?.kind !== 'metric') fail('BRAIN_METRIC_INVALID');
  const v = safeJson(source.values, 16 * 1024);
  const required = ['metricType', 'windowStart', 'windowEnd', 'eligible', 'progressed', 'pending', 'stale', 'staleThresholdDays'];
  if (!required.every(k => Object.hasOwn(v, k)) || v.metricType !== 'inquiry-aging-v1' || !['eligible', 'progressed', 'pending', 'stale', 'staleThresholdDays'].every(k => int(v[k])) || v.staleThresholdDays < 1 || v.staleThresholdDays > 90) fail('BRAIN_METRIC_INVALID');
  windowOf(v, now);
  if (v.progressed + v.pending > v.eligible || v.stale > v.pending) fail('BRAIN_METRIC_INVALID');
  const gaps = [];
  if (v.eligible === 0) gaps.push('NO_ELIGIBLE_INQUIRIES');
  if (v.pending > 0) gaps.push('PENDING_INQUIRIES');
  if (v.stale > 0) gaps.push('STALE_INQUIRIES');
  return safeJson({
    kind: 'inquiry-aging',
    evidenceId: source.evidenceId,
    sourceRef: source.reference,
    observedAt: source.observedAt,
    window: { start: v.windowStart, end: v.windowEnd },
    current: { eligible: v.eligible, progressed: v.progressed, pending: v.pending, stale: v.stale, staleThresholdDays: v.staleThresholdDays },
    gaps,
    priority: v.stale > 0 ? 96 : v.pending > 0 ? 84 : 70,
    conclusion: 'aging-observation-not-causal-diagnosis',
    recommendationsAllowed: false,
    businessGoalVerified: false
  }, 16 * 1024);
}

export function analyzeProductCompleteness(source, now = Date.now()) {
  if (source?.reference?.kind !== 'metric') fail('BRAIN_METRIC_INVALID');
  const v = safeJson(source.values, 16 * 1024);
  const required = ['metricType', 'asOf', 'total', 'active', 'complete', 'incomplete', 'archived', 'missingImages', 'missingSkus', 'missingDocuments', 'missingSupply'];
  if (!required.every(k => Object.hasOwn(v, k)) || v.metricType !== 'product-completeness-v1' || !required.slice(2).every(k => int(v[k]))) fail('BRAIN_METRIC_INVALID');
  const asOf = timestamp(v.asOf);
  if (asOf > now) fail('BRAIN_METRIC_WINDOW_INVALID');
  if (v.active + v.archived !== v.total || v.complete + v.incomplete !== v.active) fail('BRAIN_METRIC_INVALID');
  if ([v.missingImages, v.missingSkus, v.missingDocuments, v.missingSupply].some(value => value > v.incomplete)) fail('BRAIN_METRIC_INVALID');
  const gaps = [];
  if (v.total === 0) gaps.push('NO_PRODUCTS');
  if (v.incomplete > 0) gaps.push('PRODUCT_MATERIAL_GAPS');
  return safeJson({
    kind: 'product-completeness',
    evidenceId: source.evidenceId,
    sourceRef: source.reference,
    observedAt: source.observedAt,
    asOf: v.asOf,
    current: { total: v.total, active: v.active, complete: v.complete, incomplete: v.incomplete, archived: v.archived, missingImages: v.missingImages, missingSkus: v.missingSkus, missingDocuments: v.missingDocuments, missingSupply: v.missingSupply },
    gaps,
    priority: v.incomplete > 0 ? 88 : 65,
    conclusion: 'metadata-completeness-observation-not-sales-readiness-claim',
    recommendationsAllowed: false,
    businessGoalVerified: false
  }, 16 * 1024);
}

export const analyzeCohortMetric = analyzeInquiryFunnel;

export function analyzeBusinessSources(sources, now = Date.now()) {
  const signals = [];
  const gaps = [];
  for (const source of sources || []) {
    if (source.reference.kind !== 'metric') continue;
    const type = source.values?.metricType;
    if (type === 'inquiry-funnel-v1' || type === 'commerce-product-cohort-v1') signals.push(analyzeCohortMetric(source, now));
    else if (type === 'inquiry-pipeline-v1') signals.push(analyzeInquiryPipeline(source, now));
    else if (type === 'inquiry-aging-v1') signals.push(analyzeInquiryAging(source, now));
    else if (type === 'product-completeness-v1') signals.push(analyzeProductCompleteness(source, now));
    else gaps.push({ evidenceId: source.evidenceId, reason: 'UNSUPPORTED_METRIC_TYPE' });
  }
  const businessSignals = extractBusinessSignals(sources, { now });
  return safeJson({
    signals,
    businessSignals,
    gaps,
    status: signals.length ? 'measured' : 'no-supported-metrics',
    authority: 'source-observation-only',
    businessGoalVerified: false
  }, 64 * 1024);
}
