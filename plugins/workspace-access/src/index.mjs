// Harness plugin: local sign-in sessions.
//
// It installs the kernel's actor resolver, so after this plugin mounts the
// x-harness-* headers stop being authority: every non-public route needs a
// valid session cookie. Sign-in is loopback-only and only for workspace
// members; the role always comes from the workspace seam.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { AccessError, SESSION_COOKIE, SESSION_TTL_MS, createAccessService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-access';
const BASE = '/api/access';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const ROUTES = Object.freeze([
  ['POST', `${BASE}/login`],
  ['POST', `${BASE}/logout`],
  ['GET', `${BASE}/session`],
  ['GET', `${BASE}/sessions`],
]);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof AccessError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

function cookieValue(request, name) {
  const header = request?.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function isLoopback(request) {
  const address = request?.socket?.remoteAddress ?? '';
  return LOOPBACK.has(address);
}

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read) throw missing('storage');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !['workspaceId'].includes(key)))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => ctx.workspace.resolve(actor)
    : null;
  const service = createAccessService({ storage: ctx.storage, workspaceId, resolveWorkspace });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'POST', path: `${BASE}/login`, public: true,
    handler: async (request, _response, context) => {
      try {
        if (!isLoopback(request))
          throw Object.assign(new HarnessError('ACCESS_LOCAL_ONLY', 'Sign-in is only allowed from loopback.'), { status: 403 });
        const result = await service.login(context?.body ?? {});
        return new Response(JSON.stringify({ actor: { subject: result.session.subject, role: result.session.role } }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'set-cookie': `${SESSION_COOKIE}=${result.session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${result.ttlSeconds}`,
          },
        });
      } catch (error) { throw asHarnessError(error); }
    },
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/logout`,
    handler: async (request, _response, __context) => {
      try {
        const sessionId = cookieValue(request, SESSION_COOKIE);
        const result = await service.logout(sessionId);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
          },
        });
      } catch (error) { throw asHarnessError(error); }
    },
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/session`,
    handler: call(async context => ({ status: 200, body: { actor: { subject: context.actor?.subject, role: context.actor?.role } } })),
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/sessions`,
    handler: call(context => ({ status: 200, body: service.listSessions(context) })),
  });

  // From here on, the kernel asks this resolver instead of trusting headers.
  const disposeResolver = typeof ctx.http.setActorResolver === 'function'
    ? ctx.http.setActorResolver(request => service.resolveSession(cookieValue(request, SESSION_COOKIE)))
    : null;

  if (ctx.health?.register) ctx.health.register('access', () => ({ status: 'ok', detail: { sessions: service.listSessions({ actor: { role: 'admin' } }).total } }));

  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    if (typeof disposeResolver === 'function') await disposeResolver();
  };
}

export { SESSION_COOKIE, SESSION_TTL_MS, AccessError };
export default { apply };
