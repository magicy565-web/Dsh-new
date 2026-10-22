// Harness plugin: quotes (报价单) over the storage seam.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { QUOTE_PAGE } from './area.mjs';
import { QUOTE_LIMITS, QUOTE_STATUSES, QuoteError, createQuoteService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-quotes';
const BASE = '/api/quotes';

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['POST', BASE],
  ['GET', BASE],
  ['GET', `${BASE}/:id`],
  ['POST', `${BASE}/:id/status`],
  ['GET', '/quotes'],
]);
export const TOOLS = Object.freeze(['quote_create', 'quote_list']);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof QuoteError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

const lineSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', maxLength: QUOTE_LIMITS.description },
    quantity: { type: 'integer', minimum: 1, maximum: 1_000_000 },
    unitPriceMinor: { type: 'integer', minimum: 0, maximum: 100_000_000_000 },
  },
  required: ['description', 'quantity', 'unitPriceMinor'],
  additionalProperties: false,
};

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw missing('storage');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => key !== 'workspaceId'))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => {
      const resolved = ctx.workspace.resolve(actor);
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    : null;
  const service = createQuoteService({ storage: ctx.storage, workspaceId, resolveWorkspace, audit: ctx.audit ?? null });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'GET', path: '/quotes',
    handler: () => new Response(QUOTE_PAGE, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    }),
  });

  ctx.http.route({ method: 'GET', path: `${BASE}/status`, handler: call(context => ({ status: 200, body: service.status(context) })) });
  ctx.http.route({
    method: 'POST', path: BASE,
    handler: call(async context => ({ status: 201, body: await service.create(context, context.body ?? {}) })),
  });
  ctx.http.route({
    method: 'GET', path: BASE,
    handler: call(context => ({ status: 200, body: service.list(context, context.query ?? {}) })),
  });
  ctx.http.route({
    method: 'GET', path: `${BASE}/:id`,
    handler: call(context => ({ status: 200, body: service.read(context, context.params?.id) })),
  });
  ctx.http.route({
    method: 'POST', path: `${BASE}/:id/status`,
    handler: call(async context => ({ status: 200, body: await service.setStatus(context, context.params?.id, context.body ?? {}) })),
  });

  if (ctx.tools?.register) {
    ctx.tools.register({
      name: 'quote_create',
      description: 'Draft a customer quote (报价单) from explicit lines. Prices are integer minor units (fen). The server computes the total; the result is a draft that still needs a person to send it. Use only when the user supplied the customer, currency and line items.',
      parameters: {
        type: 'object',
        properties: {
          customer: { type: 'string', maxLength: QUOTE_LIMITS.customer },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          lines: { type: 'array', minItems: 1, maxItems: QUOTE_LIMITS.lines, items: lineSchema },
          note: { type: 'string', maxLength: QUOTE_LIMITS.note },
        },
        required: ['customer', 'currency', 'lines'],
        additionalProperties: false,
      },
      approval: 'always',
      readOnly: false,
      authority: 'workspace',
      handler: async (args, execution) => {
        const subject = typeof execution?.actor === 'string' ? execution.actor : execution?.actor?.subject;
        const body = { ...(args ?? {}), requestId: `tool:${subject ?? 'unknown'}:${crypto.randomUUID()}` };
        const created = await service.create({ actor: execution?.actor ?? { subject: subject ?? 'local-operator', role: 'operator', workspaceId } }, body);
        return { quote: created.quote, persisted: true };
      },
    });

    ctx.tools.register({
      name: 'quote_list',
      description: 'List existing quotes with their status and totals. Read-only.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['all', ...QUOTE_STATUSES] } },
        additionalProperties: false,
      },
      approval: 'never',
      readOnly: true,
      authority: 'workspace',
      handler: async (args, execution) => {
        const subject = typeof execution?.actor === 'string' ? execution.actor : execution?.actor?.subject;
        return service.list({ actor: execution?.actor ?? { subject: subject ?? 'local-operator', role: 'operator', workspaceId } }, args ?? {});
      },
    });
  }

  if (ctx.health?.register) {
    ctx.health.register('quotes', () => {
      const status = service.status({});
      return { status: 'ok', detail: { total: status.total, byStatus: status.byStatus } };
    });
  }
  // Published for trusted plugins only (purchases converts an accepted quote);
  // no HTTP route is added by this.
  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('quotes', service);
  return async () => { if (typeof disposeService === 'function') await disposeService(); };
}

export { QUOTE_STATUSES, QuoteError, createQuoteService };
export default { apply };
