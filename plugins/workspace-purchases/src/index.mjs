// Harness plugin: purchase orders (采购单).
//
// The model may draft an order behind a tool approval; approving it is an
// administrator-only HTTP action and has no tool at all, so a model can never
// commit spending on its own.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { PURCHASES_PAGE } from './area.mjs';
import { PO_LIMITS, PO_STATUSES, PurchaseError, createPurchaseService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-purchases';
const BASE = '/api/purchases';

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['POST', BASE],
  ['GET', BASE],
  ['GET', `${BASE}/:id`],
  ['POST', `${BASE}/:id/status`],
  ['GET', '/purchases'],
]);
export const TOOLS = Object.freeze(['purchase_order_create', 'purchase_order_list']);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof PurchaseError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

const lineSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', maxLength: PO_LIMITS.description },
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
  const service = createPurchaseService({ storage: ctx.storage, workspaceId, resolveWorkspace, audit: ctx.audit ?? null });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'GET', path: '/purchases',
    handler: () => new Response(PURCHASES_PAGE, {
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
      name: 'purchase_order_create',
      description: 'Draft a purchase order from explicit supplier, currency and line items (prices in integer minor units). The result is a draft: a person must approve it before anything is ordered. Use it only when the user supplied the supplier and lines.',
      parameters: {
        type: 'object',
        properties: {
          supplier: { type: 'string', maxLength: PO_LIMITS.supplier },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          lines: { type: 'array', minItems: 1, maxItems: PO_LIMITS.lines, items: lineSchema },
          note: { type: 'string', maxLength: PO_LIMITS.note },
        },
        required: ['supplier', 'currency', 'lines'],
        additionalProperties: false,
      },
      approval: 'always',
      readOnly: false,
      authority: 'workspace',
      handler: async (args, execution) => {
        const subject = typeof execution?.actor === 'string' ? execution.actor : execution?.actor?.subject;
        const actor = execution?.actor ?? { subject: subject ?? 'local-operator', role: 'operator', workspaceId };
        const created = await service.create({ actor }, { ...(args ?? {}), requestId: `tool:${subject ?? 'unknown'}:${crypto.randomUUID()}` });
        return { order: created.order, persisted: true };
      },
    });

    ctx.tools.register({
      name: 'purchase_order_list',
      description: 'List purchase orders with their status and totals. Read-only.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['all', ...PO_STATUSES] } },
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
    ctx.health.register('purchases', () => {
      const status = service.status({});
      return { status: 'ok', detail: { total: status.total, byStatus: status.byStatus } };
    });
  }
  return async () => {};
}

export { PO_STATUSES, PurchaseError, createPurchaseService };
export default { apply };
