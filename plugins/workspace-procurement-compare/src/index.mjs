// Harness plugin: align supplied supplier quotes (read-only, no store).
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { MAX_QUOTES, ProcurementError, QUOTE_FIELDS, compareQuotes } from './domain.mjs';

export const PLUGIN_ID = 'workspace-procurement-compare';
const BASE = '/api/procurement';

export const ROUTES = Object.freeze([['GET', `${BASE}/capabilities`]]);
export const TOOLS = Object.freeze(['procurement_compare']);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof ProcurementError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

const CAPABILITIES = Object.freeze({
  plugin: PLUGIN_ID,
  supported: ['supplied-quote-alignment'],
  ranked: false,
  priceConversion: false,
  independentVerification: false,
  storesAnything: false,
  tools: TOOLS,
  fields: QUOTE_FIELDS,
});

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).length > 0)
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);

  ctx.http.route({ method: 'GET', path: `${BASE}/capabilities`, handler: () => ({ status: 200, body: CAPABILITIES }) });

  if (ctx.tools?.register) {
    ctx.tools.register({
      name: 'procurement_compare',
      description: 'Align supplier quotes that the user supplied explicitly: canonical fields, a per-cell status, and whether spec/currency/trade terms share one basis. Never ranks, converts currency, invents a supplier or verifies comparability; pending cells stay pending.',
      parameters: {
        type: 'object',
        properties: {
          quotes: {
            type: 'array',
            maxItems: MAX_QUOTES,
            items: {
              type: 'object',
              properties: Object.fromEntries(QUOTE_FIELDS.map(name => [name, { type: ['string', 'number', 'null'], description: name }])),
              additionalProperties: false,
            },
          },
        },
        required: ['quotes'],
        additionalProperties: false,
      },
      approval: 'never',
      readOnly: true,
      authority: 'workspace',
      handler: async args => compareQuotes(args ?? {}),
    });
  }

  if (ctx.health?.register) ctx.health.register('procurement-compare', () => ({ status: 'ok', detail: { tools: TOOLS.length } }));
  return async () => {};
}

export { ProcurementError, compareQuotes, QUOTE_FIELDS };
export default { apply };
