// Harness plugin: honest factory RFQ preparation tools (read-only, no store).
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { FactoryError, OFFER_FIELDS, RFQ_FIELDS, captureRfq, prepareMatch } from './domain.mjs';

export const PLUGIN_ID = 'workspace-factory-rfq';
const BASE = '/api/factory';

export const ROUTES = Object.freeze([['GET', `${BASE}/capabilities`]]);
export const TOOLS = Object.freeze(['factory_rfq_capture', 'factory_match_prepare']);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof FactoryError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

const scalar = { type: ['string', 'number', 'null'] };
const schemaFor = fields => ({
  type: 'object',
  properties: Object.fromEntries(fields.map(name => [name, { ...scalar, description: name }])),
  additionalProperties: false,
});

const CAPABILITIES = Object.freeze({
  plugin: PLUGIN_ID,
  audience: 'chinese-factory',
  supported: ['customer-rfq-draft', 'supplied-offer-match-preparation'],
  verification: 'none: drafts only, no verified match, no capacity promise, no quote',
  storesAnything: false,
  tools: TOOLS,
});

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).length > 0)
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);

  ctx.http.route({
    method: 'GET', path: `${BASE}/capabilities`,
    handler: () => ({ status: 200, body: CAPABILITIES }),
  });

  if (ctx.tools?.register) {
    ctx.tools.register({
      name: 'factory_rfq_capture',
      description: 'Organize a Chinese factory customer RFQ into a draft: product, spec, quantity, target market, requested delivery and requirements. Missing fields stay pending. This is an unsaved preparation draft, never a quote or a commitment.',
      parameters: schemaFor(RFQ_FIELDS),
      approval: 'never',
      readOnly: true,
      authority: 'workspace',
      handler: async args => captureRfq(args ?? {}),
    });

    ctx.tools.register({
      name: 'factory_match_prepare',
      description: 'Prepare a match between an explicitly supplied RFQ draft (rfq) and explicitly supplied factory offer fields (offer). Reports matched, differing, unverifiable and pending fields. Never a verified match, capacity promise or transaction; never invents factory data.',
      parameters: {
        type: 'object',
        properties: {
          rfq: schemaFor(RFQ_FIELDS),
          offer: schemaFor(OFFER_FIELDS),
        },
        required: ['rfq', 'offer'],
        additionalProperties: false,
      },
      approval: 'never',
      readOnly: true,
      authority: 'workspace',
      handler: async args => prepareMatch(args ?? {}),
    });
  }

  if (ctx.health?.register) ctx.health.register('factory-rfq', () => ({ status: 'ok', detail: { tools: TOOLS.length } }));
  return async () => {};
}

export { FactoryError, captureRfq, prepareMatch, RFQ_FIELDS, OFFER_FIELDS };
export default { apply };
