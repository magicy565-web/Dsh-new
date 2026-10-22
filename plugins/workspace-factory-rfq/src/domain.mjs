// Factory RFQ preparation: pure, honest draft helpers.
//
// These functions never verify a match, never promise capacity and never touch
// a store. They take explicitly supplied fields and report what is present,
// what is missing, and what cannot be checked from the inputs alone.
export const RFQ_FIELDS = Object.freeze(['product', 'spec', 'quantity', 'target_market', 'requested_delivery', 'requirements']);
export const OFFER_FIELDS = Object.freeze(['product', 'spec', 'available_quantity', 'production_capacity', 'lead_time', 'supply_conditions', 'source']);

export class FactoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'FactoryError';
    this.status = status;
    this.code = code;
  }
}

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const fail = (message, code = 'FACTORY_INPUT') => { throw new FactoryError(400, code, message); };
const supplied = value => value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');

function fieldsOf(value, allowed, name) {
  if (value === undefined) return {};
  if (!isPlain(value)) fail(`${name} must be an object.`);
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.includes(key)) fail(`${name} has an unsupported field: ${key}.`);
    if (entry !== null && entry !== undefined && !['string', 'number'].includes(typeof entry))
      fail(`${name}.${key} must be text, a number or null.`);
  }
  const normalized = {};
  for (const key of allowed) if (supplied(value[key])) normalized[key] = typeof value[key] === 'string' ? value[key].trim() : value[key];
  return normalized;
}

const evidence = (fields, prefix) => Object.keys(fields).map(key => ({ kind: 'user-provided', recordId: `${prefix}.${key}` }));

/** Turn supplied RFQ fields into a draft that says exactly what is still pending. */
export function captureRfq(input = {}) {
  if (!isPlain(input)) fail('An RFQ draft needs an object.');
  const fields = fieldsOf(input, RFQ_FIELDS, 'rfq');
  const pending = RFQ_FIELDS.filter(key => fields[key] === undefined);
  return {
    kind: 'customer-rfq-draft',
    status: 'draft',
    fields,
    pending,
    complete: pending.length === 0,
    evidence: evidence(fields, 'rfq'),
    notice: 'This is an unsaved preparation draft. It is not a quote, a commitment, or a verified requirement.',
  };
}

/** Compare a supplied RFQ draft with supplied factory offer fields. */
export function prepareMatch(input = {}) {
  if (!isPlain(input)) fail('A match preparation needs an object.');
  const rfq = fieldsOf(input.rfq, RFQ_FIELDS, 'rfq');
  const offer = fieldsOf(input.offer, OFFER_FIELDS, 'offer');
  if (Object.keys(rfq).length === 0) fail('rfq must contain at least one supplied field.');
  if (Object.keys(offer).length === 0) fail('offer must contain at least one supplied field.');

  const matched = [];
  const differs = [];
  const unverifiable = [];
  const pending = [];

  const compareText = (field, label) => {
    if (rfq[field] === undefined || offer[field] === undefined) { pending.push(field); return; }
    const same = String(rfq[field]).toLowerCase() === String(offer[field]).toLowerCase();
    (same ? matched : differs).push({ field, label, rfq: rfq[field], offer: offer[field] });
  };
  compareText('product', '产品');
  compareText('spec', '规格');

  if (rfq.quantity === undefined || offer.available_quantity === undefined) {
    pending.push('quantity', 'available_quantity');
  } else {
    const need = Number(rfq.quantity);
    const have = Number(offer.available_quantity);
    if (!Number.isFinite(need) || !Number.isFinite(have)) {
      unverifiable.push({ field: 'quantity', reason: 'NON_NUMERIC' });
    } else if (have >= need) {
      matched.push({ field: 'available_quantity', label: '可供数量', rfq: need, offer: have });
    } else {
      differs.push({ field: 'available_quantity', label: '可供数量', rfq: need, offer: have });
    }
  }

  if (rfq.requested_delivery !== undefined && offer.lead_time !== undefined) {
    unverifiable.push({ field: 'lead_time', reason: 'NEEDS_CALENDAR', detail: { requested_delivery: rfq.requested_delivery, lead_time: offer.lead_time } });
  } else {
    pending.push('requested_delivery', 'lead_time');
  }

  const offerPending = OFFER_FIELDS.filter(key => offer[key] === undefined);
  return {
    kind: 'factory-match-preparation',
    status: 'preparation',
    matched,
    differs,
    unverifiable,
    pending: [...new Set([...pending, ...offerPending])],
    evidence: [...evidence(rfq, 'rfq'), ...evidence(offer, 'offer')],
    notice: 'This is an unsaved preparation. It is not a verified match, a capacity promise, a quote or a transaction.',
  };
}
