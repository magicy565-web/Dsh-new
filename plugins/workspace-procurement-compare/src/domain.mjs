// Supplier quote alignment: compare only what a person explicitly supplied.
//
// Migrated from the legacy `workspace_procurement_compare` contract: every cell
// keeps a status, alignment is about the supplied basis (never a market claim),
// and nothing is ranked, converted or verified.
import { createHash } from 'node:crypto';

export const QUOTE_FIELDS = Object.freeze([
  'supplier', 'spec', 'unit_price', 'currency', 'trade_term', 'moq', 'sample_cost',
  'sample_lead_time', 'lead_time', 'payment', 'certification', 'validity', 'source',
]);
export const ALIGNMENT_KEYS = Object.freeze(['spec', 'currency', 'trade_term']);
export const MAX_QUOTES = 20;

export class ProcurementError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ProcurementError';
    this.status = status;
    this.code = code;
  }
}

const fail = message => { throw new ProcurementError(400, 'PROCUREMENT_INPUT', message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const present = value => value !== undefined && value !== null && value !== '';

/** Align supplied quotes; never ranks, converts currencies or verifies. */
export function compareQuotes(input = {}) {
  if (!isPlain(input)) fail('A comparison needs an object.');
  if (Object.keys(input).some(key => key !== 'quotes')) fail('A comparison has an unsupported field.');
  const quotes = input.quotes;
  if (!Array.isArray(quotes)) fail('quotes must be an array.');
  if (quotes.length > MAX_QUOTES) fail(`quotes must contain at most ${MAX_QUOTES} entries.`);

  const rows = quotes.map((quote, index) => {
    if (!isPlain(quote)) fail(`quotes.${index} must be an object.`);
    for (const [key, value] of Object.entries(quote)) {
      if (!QUOTE_FIELDS.includes(key)) fail(`quotes.${index} has an unsupported field: ${key}.`);
      if (value !== null && value !== undefined && !['string', 'number'].includes(typeof value))
        fail(`quotes.${index}.${key} must be text, a number or null.`);
    }
    return {
      index,
      provenance: 'user_provided_unverified',
      cells: Object.fromEntries(QUOTE_FIELDS.map(key => [key, present(quote[key])
        ? { status: 'provided-unverified', value: typeof quote[key] === 'string' ? quote[key].trim() : quote[key], source: `input.quotes.${index}.${key}` }
        : { status: 'pending' }])),
    };
  });

  const hasPendingKey = quotes.some(quote => ALIGNMENT_KEYS.some(key => !present(quote[key])));
  let alignment;
  if (rows.length === 0) alignment = 'no-supplied-quotes';
  else if (hasPendingKey) alignment = 'pending';
  else if (ALIGNMENT_KEYS.every(key => quotes.every(quote => quote[key] === quotes[0][key]))) alignment = 'same-supplied-basis-unverified';
  else alignment = 'different-supplied-basis';

  return {
    status: rows.length ? 'draft' : 'empty',
    alignment,
    ranked: false,
    priceConversion: false,
    independentVerification: false,
    persisted: false,
    submitted: false,
    suppliedSha256: createHash('sha256').update(JSON.stringify(quotes)).digest('hex'),
    rows,
    sources: quotes.map((_quote, index) => ({ kind: 'user-provided', recordId: `input.quotes.${index}` })),
    notice: 'Field alignment is not verified comparability or market research. A target price is not a supplier quote. Pending cells need original supporting materials.',
  };
}
