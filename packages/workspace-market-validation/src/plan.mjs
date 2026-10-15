// Inert JSON contract, not a planner, scheduler, approval or spend ledger.
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const choice = values => ({ type: 'string', enum: values });
const nullable = schema => ({ ...schema, type: [schema.type, 'null'], ...(schema.enum ? { enum: [...schema.enum, null] } : {}) });
const array = (items, maxItems = 20, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 1, maximum: 1000000000 };
const money = { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,2})?$' };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const name = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' };
export const B2B_METRICS = Object.freeze(['qualified_inquiries', 'quote_requests', 'sample_requests', 'b2b_orders']);
export const B2C_METRICS = Object.freeze(['visits', 'add_to_cart', 'checkouts', 'net_paid_orders', 'net_paid_units', 'refunds']);
export const PRODUCT_INPUT_SCHEMA = object({ productId: uuid, documents: array(object({ documentId: uuid, documentVersion: { ...integer, maximum: 100 } }), 3) });
const source = object({ kind: choice(['factory-product', 'factory-document']), recordId: uuid, revision: integer, workspaceId: text(1000),
  projectionSha256: hash, api: text(2000), documentVersion: { ...integer, maximum: 100 }, artifactId: uuid, version: integer, sha256: hash },
['kind', 'recordId', 'revision', 'workspaceId', 'projectionSha256', 'api']);
const supply = object({ status: choice(['unknown', 'proposed', 'reported_unverified']), detail: nullable(text()) });
const path = object({ mode: choice(['b2b', 'b2c']), buyer: text(), targetMarket: text(), offer: text(),
  salesRequirement: object({ metric: choice(['b2b_orders', 'net_paid_orders', 'net_paid_units']), target: nullable({ type: 'integer', minimum: 0, maximum: 1000000000 }), definition: text() }),
  metrics: array(object({ id: choice([...B2B_METRICS, ...B2C_METRICS]), definition: text(), dataSource: nullable(text()), availability: choice(['unverified', 'unavailable']) }), 10, 1),
  acquisition: array(object({ id: name, channel: text(200), kind: choice(['paid', 'organic', 'owned', 'partner', 'undecided']), approach: text() }), 10, 1),
  steps: array(text(), 20, 1), successCriteria: array(text(), 10, 1), stopCriteria: array(text(), 10, 1) });
export const PLAN_SCHEMA = object({ schemaVersion: { type: 'integer', enum: [1] }, title: text(200), goal: text(4000),
  mode: choice(['b2b', 'b2c', 'dual']), rationale: text(4000), productState: text(4000),
  supply: object({ dropshipping: supply, oem: supply, odm: supply }),
  paths: array(path, 2, 1), timeZone: text(100),
  budget: object({ status: choice(['undecided', 'proposed']), currency: nullable(currency), totalCap: nullable(money),
    lines: array(object({ id: name, category: choice(['acquisition', 'samples', 'logistics', 'platform', 'commission', 'other']),
      acquisitionId: nullable(name), cap: money, purpose: text() }), 30) }),
  commission: object({ status: choice(['undecided', 'none_proposed', 'proposed']), payer: nullable(text(300)), payee: nullable(text(300)),
    basis: nullable(text()), method: nullable(choice(['percentage', 'fixed'])), rateOrAmount: nullable(money), currency: nullable(currency),
    settlement: nullable(text()), refunds: nullable(text()), cap: nullable(money), budgetLineId: nullable(name) }),
  questions: array(object({ topic: text(100), question: text(), blocking: { type: 'boolean' } }), 20), assumptions: array(text(), 20) });
export const SAVE_INPUT_SCHEMA = object({ ...PRODUCT_INPUT_SCHEMA.properties, sources: array(source, 4, 1), plan: PLAN_SCHEMA,
  requestId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' } });

// A small validator for precisely the JSON Schema subset above. The service
// validates again: provider-side schema enforcement is not an authority gate.
function validate(value, schema, location = 'input') {
  const bad = () => { throw new TypeError('Invalid market validation ' + location + '.'); };
  if (value === null && Array.isArray(schema.type) && schema.type.includes('null')) return;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum && !schema.enum.includes(value)) bad();
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
    if (Object.keys(value).some(k => !Object.hasOwn(schema.properties, k)) || schema.required.some(k => !Object.hasOwn(value, k))) bad();
    for (const k of Object.keys(value)) validate(value[k], schema.properties[k], location + '.' + k);
  } else if (type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) bad();
    value.forEach((v, i) => validate(v, schema.items, location + '[' + i + ']'));
  } else if (type === 'string') {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
      || value.length < (schema.minLength || 0) || value.length > (schema.maxLength || 10000) || schema.pattern && !new RegExp(schema.pattern).test(value)) bad();
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) bad();
  } else if (type === 'boolean' && typeof value !== 'boolean') bad();
}
const units = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const unique = values => new Set(values).size === values.length;
const reject = message => { throw new TypeError(message); };
export function validateProductInput(input) {
  validate(input, PRODUCT_INPUT_SCHEMA);
  if (!unique(input.documents.map(d => d.documentId))) reject('Select each document only once.');
  return structuredClone(input);
}
export function validatePlanInput(input) {
  validate(input, SAVE_INPUT_SCHEMA);
  validateProductInput({ productId: input.productId, documents: input.documents });
  if (Buffer.byteLength(JSON.stringify(input)) > 60000) reject('Plan input exceeds 60 KB.');
  const p = input.plan, modes = p.paths.map(row => row.mode);
  if (!unique(modes) || (p.mode === 'dual' ? modes.length !== 2 : modes.length !== 1 || modes[0] !== p.mode)) reject('Keep B2B and B2C paths explicitly separate.');
  if (p.timeZone !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(p.timeZone)) reject('Specify an explicit IANA time zone, not a numeric offset.');
  try { new Intl.DateTimeFormat('en', { timeZone: p.timeZone }); } catch { reject('Specify a valid IANA time zone.'); }
  const acquisitionIds = p.paths.flatMap(row => row.acquisition.map(a => a.id));
  if (!unique(acquisitionIds) || !unique(p.budget.lines.map(row => row.id))) reject('Use unique acquisition and budget line IDs.');
  for (const row of p.paths) {
    const allowed = row.mode === 'b2b' ? B2B_METRICS : B2C_METRICS;
    if (!unique(row.metrics.map(m => m.id)) || row.metrics.some(m => !allowed.includes(m.id))
      || !allowed.includes(row.salesRequirement.metric) || !row.metrics.some(m => m.id === row.salesRequirement.metric)) reject('Inquiries are not sales. Keep each path and sales metric distinct.');
  }
  const b = p.budget, c = p.commission;
  if (b.status === 'undecided' ? b.lines.length || b.totalCap !== null : b.currency === null || b.totalCap === null) reject('Proposed budgets require currency and a total cap; undecided budgets cannot allocate spend.');
  if (b.lines.some(l => l.acquisitionId !== null && !acquisitionIds.includes(l.acquisitionId) || l.category === 'acquisition' && l.acquisitionId === null)) reject('Link acquisition spend to an exact proposed channel.');
  if (b.totalCap !== null && b.lines.reduce((sum, l) => sum + units(l.cap), 0n) > units(b.totalCap)) reject('Budget line caps exceed the total cap. No currency conversion or extra commission is implicit.');
  if (c.status === 'proposed') {
    if (Object.values(c).some(v => v === null) || c.currency !== b.currency || b.status !== 'proposed') reject('Commission requires payer, payee, basis, method, rate/amount, currency, settlement, refunds, cap and reserved budget line.');
    if (c.method === 'percentage' && units(c.rateOrAmount) > 10000n) reject('Commission percentage must be at most 100.');
    const line = b.lines.find(l => l.id === c.budgetLineId && l.category === 'commission');
    if (!line || units(line.cap) < units(c.cap) || c.method === 'fixed' && units(c.rateOrAmount) > units(c.cap)) reject('Reserve the commission cap within the same proposed total budget.');
  } else if (Object.entries(c).some(([k, v]) => k !== 'status' && v !== null)) reject('Undecided or no-commission proposals cannot carry payment terms.');
  return structuredClone(input);
}
