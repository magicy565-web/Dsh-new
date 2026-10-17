import { createHash } from 'node:crypto';

export const PLUGIN = 'workspace-goal-intelligence';
export class BrainError extends Error {
  constructor(code) { super(code); this.name = 'BrainError'; this.code = code; }
}
export const fail = code => { throw new BrainError(code); };
export const clone = value => structuredClone(value);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const same = (a, b) => canonical(a) === canonical(b);
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = (maxLength = 1200) => ({ type: 'string', minLength: 1, maxLength });
const enumeration = values => ({ type: 'string', enum: values });
const list = (items, maxItems = 24, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const int = (minimum = 0) => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const id = { ...text(128), pattern: '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$' };
const sha = { ...text(64), pattern: '^[a-f0-9]{64}$' };
export const SOURCE_SCHEMA = object({
  kind: enumeration(['company', 'product', 'inquiry', 'metric', 'policy', 'artifact', 'market-observation']),
  id, revision: text(128), sha256: sha, fields: list(text(128), 24, 1),
});
export const SOURCE_LIST_SCHEMA = list(SOURCE_SCHEMA, 24);
const strings = () => list(text());
const evidenceIds = () => list(id);
const mutation = { requestId: id, expectedRevision: int() };
export const CONTEXT_SCHEMA = object({
  ...mutation,
  goalIds: list(id, 6), sourceRefs: SOURCE_LIST_SCHEMA,
  businessModel: object({ valueProposition: text(), customerSegments: strings(), revenueModel: text() }),
  operatingFocus: strings(), unknowns: strings(),
  notes: list(object({ kind: enumeration(['hypothesis', 'preference-claim']), text: text(), evidenceIds: evidenceIds() })),
});
const range = object({ min: int(), max: int() });
const estimate = object({
  currency: { ...text(3), pattern: '^[A-Z]{3}$' },
  costMinor: nullable(range), incrementalContributionMinor: nullable(range),
  assumptions: list(text(), 12, 1),
});
const option = object({
  id, title: text(160), kind: enumeration(['act', 'investigate', 'wait']),
  capability: enumeration(['analysis', 'draft', 'worker-order', 'external-contact', 'price-change', 'none']),
  description: text(3000), evidenceIds: evidenceIds(), risk: enumeration(['low', 'medium', 'high']),
  estimate: nullable(estimate), requirements: strings(),
});
export const DECISION_SCHEMA = object({
  ...mutation, id, contextRevision: int(1), goalId: id, sourceRefs: SOURCE_LIST_SCHEMA,
  problem: text(3000),
  hypotheses: list(object({ id, explanation: text(3000), supportingEvidence: evidenceIds(), contradictingEvidence: evidenceIds(), missingEvidence: strings() }), 6, 1),
  options: list(option, 6, 2),
  recommendation: object({
    optionId: id, rationale: text(3000),
    verification: object({ metricId: id, observationDays: { type: 'integer', minimum: 1, maximum: 365 }, stopConditions: list(text(), 12, 1) }),
  }),
});
export const REVIEW_SCHEMA = object({
  ...mutation, decisionId: id, decisionRevision: int(1), sourceRefs: SOURCE_LIST_SCHEMA,
  metricEvidenceId: id, interpretation: enumeration(['supported', 'contradicted', 'inconclusive']),
  rationale: text(3000), alternativeExplanations: list(text(), 12, 1),
});
export const FEEDBACK_SCHEMA = object({
  ...mutation, decisionId: id, decisionRevision: int(1),
  disposition: enumeration(['dismissed', 'snoozed', 'reopen']),
  until: nullable(text(40)), reason: text(),
});
export const INPUTS = Object.freeze({
  sourceCatalog: object({}), contextRead: object({}), contextSave: CONTEXT_SCHEMA, diagnose: object({}),
  decisionRead: object({ id }), decisionSave: DECISION_SCHEMA,
  reviewSave: REVIEW_SCHEMA, brief: object({}),
});
// Closed DTO guard for this package's schemas; the native SDK also validates
// its tool inputs. This is not exposed as a generic user-defined rule engine.
function check(value, schema, depth = 0) {
  if (depth > 14) fail('BRAIN_INPUT_INVALID');
  if (schema.anyOf) {
    if (value === null && schema.anyOf.some(s => s.type === 'null')) return;
    return check(value, schema.anyOf.find(s => s.type !== 'null'), depth + 1);
  }
  if (schema.enum && !schema.enum.includes(value)) fail('BRAIN_INPUT_INVALID');
  if (schema.type === 'null') { if (value !== null) fail('BRAIN_INPUT_INVALID'); }
  else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < schema.minLength || value.length > schema.maxLength || !value.trim()
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
      || Buffer.from(value).toString('utf8') !== value
      || schema.pattern && (/[\r\n]/u.test(value) || !(new RegExp(schema.pattern, 'u')).test(value))) fail('BRAIN_INPUT_INVALID');
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) fail('BRAIN_INPUT_INVALID');
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || Object.keys(value).length !== value.length || value.length < schema.minItems || value.length > schema.maxItems) fail('BRAIN_INPUT_INVALID');
    value.forEach(v => check(v, schema.items, depth + 1));
  } else if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Object.keys(value).some(k => !Object.hasOwn(schema.properties, k))
      || schema.required.some(k => !Object.hasOwn(value, k))) fail('BRAIN_INPUT_INVALID');
    for (const k of Object.keys(schema.properties)) check(value[k], schema.properties[k], depth + 1);
  } else fail('BRAIN_INPUT_INVALID');
}
export function validate(schema, value) {
  check(value, schema);
  if (Buffer.byteLength(JSON.stringify(value)) > 48 * 1024) fail('BRAIN_INPUT_TOO_LARGE');
  return clone(value);
}
export const sourceId = ref => `${ref.kind}:${ref.id}`;
export function unique(values) { if (new Set(values).size !== values.length) fail('BRAIN_DUPLICATE_REFERENCE'); }
export function validateSources(refs) {
  validate(SOURCE_LIST_SCHEMA, refs); unique(refs.map(sourceId));
  refs.forEach(ref => unique(ref.fields)); return refs;
}
export function validateEvidence(ids, sources) {
  unique(ids); const available = new Set(sources.map(sourceId));
  if (ids.some(v => !available.has(v))) fail('BRAIN_EVIDENCE_NOT_SELECTED');
}
export function safeJson(value, maxBytes = 48 * 1024) {
  const seen = new Set();
  function walk(v, depth) {
    if (depth > 14) fail('BRAIN_SOURCE_INVALID');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object' || seen.has(v)) fail('BRAIN_SOURCE_INVALID');
    seen.add(v);
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('BRAIN_SOURCE_INVALID');
    for (const [k, child] of Object.entries(v)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) fail('BRAIN_SOURCE_INVALID');
      walk(child, depth + 1);
    }
    seen.delete(v);
  }
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) fail('BRAIN_SOURCE_TOO_LARGE');
  return clone(value);
}
export function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) fail('BRAIN_TIME_INVALID');
  return Date.parse(value);
}
