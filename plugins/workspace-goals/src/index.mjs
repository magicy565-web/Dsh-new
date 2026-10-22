// Harness plugin: durable goals over the chat substrate.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { GOAL_STATUSES, GoalError, createGoalService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-goals';
const BASE = '/api/goals';

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['POST', BASE],
  ['GET', BASE],
  ['GET', `${BASE}/:id`],
  ['POST', `${BASE}/:id/status`],
]);

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);
const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof GoalError) {
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
  const service = createGoalService({
    storage: ctx.storage,
    workspaceId,
    resolveWorkspace,
    chat: ctx.chat ?? null,
    audit: ctx.audit ?? null,
  });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

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

  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('goals', service);
  if (ctx.health?.register) {
    ctx.health.register('goals', () => {
      const value = service.status({});
      return { status: 'ok', detail: { workspaceId: value.workspaceId, total: value.total } };
    });
  }
  return async () => { if (typeof disposeService === 'function') await disposeService(); };
}

export { GOAL_STATUSES, GoalError };
export default { apply };
