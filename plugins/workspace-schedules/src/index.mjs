// Harness plugin: schedules that dispatch goals through the chat pipeline.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { SCHEDULES_PAGE } from './area.mjs';
import { SCHEDULE_STATUSES, ScheduleError, createScheduleService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-schedules';
const BASE = '/api/schedules';
const DEFAULT_TICK_MS = 15_000;

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['POST', BASE],
  ['GET', BASE],
  ['GET', `${BASE}/:id`],
  ['POST', `${BASE}/:id/status`],
  ['GET', '/schedules'],
]);

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);
const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof ScheduleError) {
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
  if (Object.keys(config).some(key => !['workspaceId', 'tickMs'].includes(key)))
    throw manifestError(`${PLUGIN_ID} config has an unsupported field.`);
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('config.workspaceId must be a non-empty string.');
  if (config.tickMs !== undefined && (!Number.isInteger(config.tickMs) || config.tickMs < 1_000 || config.tickMs > 3_600_000))
    throw manifestError('config.tickMs must be an integer between 1000 and 3600000.');
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => {
      const resolved = ctx.workspace.resolve(actor);
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    : null;
  const notify = typeof ctx.get === 'function'
    ? item => {
      const inbox = ctx.get('inbox', false);
      if (!inbox || typeof inbox.push !== 'function') return Promise.resolve();
      return inbox.push({ actor: { subject: 'service:scheduler', role: 'operator', workspaceId }, trustedService: true }, item);
    }
    : null;
  const service = createScheduleService({
    storage: ctx.storage,
    chat: ctx.chat,
    workspaceId,
    resolveWorkspace,
    audit: ctx.audit ?? null,
    notify,
  });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'GET', path: '/schedules',
    handler: () => new Response(SCHEDULES_PAGE, {
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
    handler: call(context => ({ status: 200, body: service.get(context, context.params?.id) })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/:id/status`,
    handler: call(async context => ({ status: 200, body: await service.setStatus(context, context.params?.id, context.body ?? {}) })),
  });

  const tickMs = config.tickMs ?? DEFAULT_TICK_MS;
  const timer = setInterval(() => { service.tick().catch(() => {}); }, tickMs);
  timer.unref?.();

  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('schedules', service);
  if (ctx.health?.register) {
    ctx.health.register('schedules', () => {
      const value = service.status({});
      return { status: 'ok', detail: { workspaceId: value.workspaceId, total: value.total, byStatus: value.byStatus } };
    });
  }
  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    if (typeof disposeService === 'function') await disposeService();
  };
}

export { SCHEDULE_STATUSES, ScheduleError };
export default { apply };
