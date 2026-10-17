import { createHash } from 'node:crypto';

export class MarketplaceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new MarketplaceError(status, code, message); };
export const requireThat = (yes, code, message, status = 409) => { if (!yes) fail(status, code, message); };
export const clone = value => structuredClone(value);
export const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@|/-]{0,127}$/.test(value);
export function json(value, depth = 0) {
  requireThat(depth < 30, 'INVALID_INPUT', 'Object nesting limit exceeded.', 400);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'INVALID_INPUT', 'Finite numbers required.', 400); return; }
  requireThat(value && typeof value === 'object' && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value))), 'INVALID_INPUT', 'JSON data required.', 400);
  requireThat(!Object.getOwnPropertySymbols(value).length, 'INVALID_INPUT', 'JSON keys required.', 400);
  for (const key of Object.keys(value)) {
    requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_INPUT', 'Unsafe object key.', 400);
    json(value[key], depth + 1);
  }
}
export function object(value, keys) {
  json(value);
  requireThat(value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).every(key => keys.includes(key)), 'INVALID_INPUT', 'Unexpected input fields.', 400);
  return value;
}
export function text(value, max = 500) {
  requireThat(typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'INVALID_INPUT', 'A bounded nonempty text value is required.', 400);
  return value.trim();
}
export function integer(value, max = 100_000_000, min = 0) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', 'Integer outside permitted range.', 400);
  return value;
}
export function list(value, max = 12) {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= max, 'INVALID_INPUT', 'A bounded nonempty list is required.', 400);
  return value.map(item => text(item, 500));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function digest(value) { json(value); return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function pricePlan(input) {
  object(input, ['id', 'mode', 'currency', 'amountMinor', 'minorPerHour', 'inputMinorPerMillion', 'outputMinorPerMillion', 'cachedInputMinorPerMillion']);
  requireThat(id(input.id) && ['fixed', 'time', 'token'].includes(input.mode), 'INVALID_PRICE', 'Choose a named fixed, time or token price.', 400);
  requireThat(typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency), 'INVALID_PRICE', 'Use an uppercase ISO currency code.', 400);
  const fields = input.mode === 'fixed' ? ['amountMinor'] : input.mode === 'time' ? ['minorPerHour'] : ['inputMinorPerMillion', 'outputMinorPerMillion', 'cachedInputMinorPerMillion'];
  requireThat(Object.keys(input).every(key => ['id', 'mode', 'currency', ...fields].includes(key)), 'INVALID_PRICE', 'Do not mix pricing modes.', 400);
  const result = { id: input.id, mode: input.mode, currency: input.currency };
  for (const field of fields) result[field] = integer(input[field]);
  requireThat(fields.some(key => result[key] > 0), 'INVALID_PRICE', 'At least one positive rate is required.', 400);
  return result;
}
// Sum integer usage first and round once, never round each event. Units are
// currency MINOR units (not a hard-coded 100 cents); no floating-point money.
export function chargeMinor(plan, usage = {}) {
  pricePlan(plan);
  if (plan.mode === 'fixed') return plan.amountMinor;
  object(usage, ['activeMs', 'inputTokens', 'outputTokens', 'cachedInputTokens']);
  const n = field => BigInt(integer(usage[field] ?? 0, Number.MAX_SAFE_INTEGER));
  let numerator, denominator;
  if (plan.mode === 'time') {
    numerator = n('activeMs') * BigInt(plan.minorPerHour); denominator = 3_600_000n;
  } else {
    // inputTokens excludes cachedInputTokens in this contract. Adapters must
    // normalize providers that include cached input in their input total.
    numerator = n('inputTokens') * BigInt(plan.inputMinorPerMillion) + n('outputTokens') * BigInt(plan.outputMinorPerMillion) + n('cachedInputTokens') * BigInt(plan.cachedInputMinorPerMillion);
    denominator = 1_000_000n;
  }
  const result = (numerator + denominator - 1n) / denominator;
  requireThat(result <= BigInt(Number.MAX_SAFE_INTEGER), 'AMOUNT_OVERFLOW', 'Usage exceeds representable charge.');
  return Number(result);
}
export function splitMinor(gross, feeBps) {
  integer(gross); integer(feeBps, 10_000);
  const feeMinor = Number(BigInt(gross) * BigInt(feeBps) / 10_000n);
  return { grossMinor: gross, feeMinor, providerMinor: gross - feeMinor };
}
export function authorize(actor, workspaceId, kinds, write = false) {
  requireThat(actor && id(actor.subject) && actor.workspaceId === workspaceId && kinds.includes(actor.kind), 'FORBIDDEN', 'This identity cannot access this Marketplace.', 403);
  requireThat(!write || actor.role === 'admin' || actor.kind === 'provider' && actor.role === 'owner', 'ROLE_REQUIRED', 'A current human owner or administrator is required.', 403);
  requireThat(!write || actor.human === true, 'HUMAN_REQUIRED', 'Agent proposals cannot approve a purchase or delivery.', 403);
  return actor;
}
export function audit(state, action, subject, resourceId, at) {
  state.marketplace.events.push({ action, subject, resourceId, at });
  requireThat(state.marketplace.events.length <= 100_000, 'AUDIT_CAPACITY', 'Archive the audit before accepting more writes.');
}
