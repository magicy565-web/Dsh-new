// Harness plugin: the workspace inbox.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { INBOX_PAGE } from './area.mjs';
import { INBOX_STATUSES, InboxError, createInboxService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-inbox';
const BASE = '/api/inbox';

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['GET', BASE],
  ['POST', `${BASE}/read-all`],
  ['POST', `${BASE}/:id/read`],
  ['GET', '/inbox'],
]);

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);
const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof InboxError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw missing('storage');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw manifestError(`${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !['workspaceId'].includes(key)))
    throw manifestError(`${PLUGIN_ID} config has an unsupported field.`);
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('config.workspaceId must be a non-empty string.');
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => {
      const resolved = ctx.workspace.resolve(actor);
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    : null;
  const service = createInboxService({ storage: ctx.storage, workspaceId, resolveWorkspace });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'GET', path: '/inbox',
    handler: () => new Response(INBOX_PAGE, {
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
    method: 'GET', path: BASE,
    handler: call(context => ({ status: 200, body: service.list(context, context.query ?? {}) })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/read-all`,
    handler: call(async context => ({ status: 200, body: await service.markAllRead(context) })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/:id/read`,
    handler: call(async context => ({ status: 200, body: await service.markRead(context, context.params?.id) })),
  });

  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('inbox', service);
  if (ctx.health?.register) {
    ctx.health.register('inbox', () => {
      const value = service.status({});
      return { status: 'ok', detail: { workspaceId: value.workspaceId, unread: value.unread } };
    });
  }
  return async () => { if (typeof disposeService === 'function') await disposeService(); };
}

export { INBOX_STATUSES, InboxError };
export default { apply };
