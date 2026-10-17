import { fail } from './contracts.mjs';

function money(n) { if (!Number.isSafeInteger(n) || n < 0) fail('BRAIN_MONEY_INVALID'); return n; }
function range(v) { if (v !== null) { money(v.min); money(v.max); if (v.min > v.max) fail('BRAIN_MONEY_INVALID'); } return v; }
function subtract(a, b) { const n = a - b; if (!Number.isSafeInteger(n)) fail('BRAIN_MONEY_INVALID'); return n; }
/** Scenario arithmetic only. Never a forecast, probability, or budget reservation. */
export function evaluateOption(option, goal) {
  const blockers = [], gaps = [];
  if (goal.status !== 'active') blockers.push('GOAL_NOT_ACTIVE');
  if (option.kind !== 'wait' && !goal.capabilities.includes(option.capability)) blockers.push('CAPABILITY_NOT_AVAILABLE');
  const e = option.estimate;
  let netContributionMinor = null;
  if (e === null) gaps.push('COST_AND_CONTRIBUTION_UNKNOWN');
  else {
    range(e.costMinor); range(e.incrementalContributionMinor);
    if (e.currency !== goal.currency) blockers.push('CURRENCY_MISMATCH');
    if (e.costMinor === null) gaps.push('COST_UNKNOWN');
    else {
      if (goal.budgetRemainingMinor === null || goal.perTaskCapMinor === null) gaps.push('BUDGET_UNKNOWN');
      else {
        money(goal.budgetRemainingMinor); money(goal.perTaskCapMinor);
        if (e.costMinor.max > Math.min(goal.budgetRemainingMinor, goal.perTaskCapMinor)) blockers.push('BUDGET_CAP_EXCEEDED');
      }
    }
    if (e.incrementalContributionMinor === null) gaps.push('INCREMENTAL_CONTRIBUTION_UNKNOWN');
    else if (e.costMinor !== null) netContributionMinor = {
      min: subtract(e.incrementalContributionMinor.min, e.costMinor.max),
      max: subtract(e.incrementalContributionMinor.max, e.costMinor.min),
    };
  }
  return {
    optionId: option.id, status: blockers.length ? 'blocked' : gaps.length ? 'needs-evidence' : 'scenario-only',
    blockers, gaps, netContributionMinor, basis: 'unverified-assumptions',
    probability: null, approvalRequired: option.kind !== 'wait', executable: false, spentMinor: 0,
  };
}
/** A mature cohort only; pending/unknown records never become lost sales. */
export function cohortConversion({ eligible, converted, pending, unknown }) {
  for (const n of [eligible, converted, pending, unknown]) money(n);
  if (!Number.isSafeInteger(converted + pending + unknown) || converted + pending + unknown > eligible) fail('BRAIN_COHORT_INVALID');
  const observed = eligible - pending - unknown;
  if (converted > observed) fail('BRAIN_COHORT_INVALID');
  return { eligible, observed, converted, pending, unknown, rate: observed ? converted / observed : null, coverage: eligible ? observed / eligible : null };
}
/** Comparing observed outcome with a declared target is not causal attribution. */
export function assessOutcome(metric, verification, decisionAt, now) {
  const required = ['id', 'value', 'unit', 'windowStart', 'windowEnd', 'coverageComplete'];
  if (!metric || required.some(k => !Object.hasOwn(metric, k)) || metric.id !== verification.metricId
    || !['string'].includes(typeof metric.unit) || !metric.unit.trim()
    || metric.value !== null && (typeof metric.value !== 'number' || !Number.isFinite(metric.value))
    || typeof metric.coverageComplete !== 'boolean') fail('BRAIN_METRIC_INVALID');
  const start = Date.parse(metric.windowStart), end = Date.parse(metric.windowEnd);
  if (![start, end].every(Number.isFinite) || start > end || end > now || start < Date.parse(decisionAt)) fail('BRAIN_METRIC_WINDOW_INVALID');
  const complete = metric.coverageComplete && end - start >= verification.observationDays * 86400000 && metric.value !== null;
  return { metricId: metric.id, value: metric.value, unit: metric.unit, sufficientEvidence: complete,
    status: complete ? 'observed-not-adjudicated' : 'insufficient-evidence', causalEffect: null, businessGoalVerified: false };
}
