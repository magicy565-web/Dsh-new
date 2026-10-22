// Harness plugin: local sign-in sessions.
//
// It installs the kernel's actor resolver, so after this plugin mounts the
// x-harness-* headers stop being authority: every non-public route needs a
// valid session cookie. Sign-in is loopback-only and only for workspace
// members; the role always comes from the workspace seam.
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { INGRESS_HEADERS, createIngressVerifier } from './ingress.mjs';
import { SESSIONS_PAGE } from './area.mjs';
import { AccessError, SESSION_COOKIE, SESSION_TTL_MS, createAccessService } from './domain.mjs';

export const PLUGIN_ID = 'workspace-access';
const BASE = '/api/access';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const LOGIN_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · 工作台</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  form { width: min(360px, 90vw); display: flex; flex-direction: column; gap: 10px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0; opacity: .7; font-size: 13px; }
  input { padding: 10px 12px; border: 1px solid GrayText; border-radius: 8px; background: Field; color: FieldText; font: inherit; }
  button { padding: 10px 12px; border: 1px solid transparent; border-radius: 8px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
  #msg { min-height: 20px; font-size: 13px; color: #b91c1c; }
</style></head>
<body>
<form id="f">
  <h1>登录工作台</h1>
  <p>本机单操作员模式：输入成员标识即可进入（仅限 loopback）。</p>
  <input id="subject" name="subject" autocomplete="username" placeholder="成员标识，例如 local-operator" required>
  <button type="submit">进入</button>
  <div id="msg"></div>
</form>
<script>
(function () {
  var form = document.getElementById('f');
  var input = document.getElementById('subject');
  var msg = document.getElementById('msg');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    msg.textContent = '';
    fetch('/api/access/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: input.value.trim() }),
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      if (!result.ok) throw new Error(result.body && result.body.error ? result.body.error.code : 'LOGIN_FAILED');
      location.assign('/chat');
    }).catch(function (error) { msg.textContent = '登录失败：' + error.message; });
  });
}());
</script>
</body></html>`;

export const ROUTES = Object.freeze([
  ['POST', `${BASE}/login`],
  ['POST', `${BASE}/logout`],
  ['GET', `${BASE}/session`],
  ['GET', `${BASE}/sessions`],
  ['POST', `${BASE}/sessions/:handle/revoke`],
  ['GET', '/login'],
  ['GET', '/sessions'],
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
  if (Object.keys(config).some(key => !['workspaceId', 'ingressPublicKeyFile'].includes(key)))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => ctx.workspace.resolve(actor)
    : null;
  const service = createAccessService({ storage: ctx.storage, workspaceId, resolveWorkspace });

  let ingress = null;
  if (config.ingressPublicKeyFile !== undefined) {
    if (typeof config.ingressPublicKeyFile !== 'string' || !isAbsolute(config.ingressPublicKeyFile))
      throw new HarnessError(ERROR.manifestInvalid, 'config.ingressPublicKeyFile must be an absolute path to a public key PEM.');
    let pem;
    try { pem = await readFile(config.ingressPublicKeyFile, 'utf8'); }
    catch { throw new HarnessError(ERROR.manifestInvalid, 'config.ingressPublicKeyFile could not be read.'); }
    if (pem.length > 8_192) throw new HarnessError(ERROR.manifestInvalid, 'config.ingressPublicKeyFile is too large.');
    ingress = createIngressVerifier({ publicKeyPem: pem });
    if (!ingress.enabled) throw new HarnessError(ERROR.manifestInvalid, 'config.ingressPublicKeyFile is not a valid Ed25519 public key.');
  }

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'GET', path: '/login', public: true,
    handler: () => new Response(LOGIN_PAGE, {
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

  ctx.http.route({
    method: 'POST', path: `${BASE}/login`, public: true,
    handler: async (request, _response, context) => {
      try {
        if (!isLoopback(request))
          throw Object.assign(new HarnessError('ACCESS_LOCAL_ONLY', 'Sign-in is only allowed from loopback.'), { status: 403 });
        const result = await service.login(context?.body ?? {});
        return new Response(JSON.stringify({ actor: { subject: result.session.subject, role: result.session.role }, csrfToken: result.session.csrfToken }), {
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
    handler: async (request, _response, context) => {
      const info = service.sessionInfo(cookieValue(request, SESSION_COOKIE));
      if (!info) throw Object.assign(new HarnessError('HARNESS_UNAUTHENTICATED', 'Sign in to use this workspace.'), { status: 401 });
      return { status: 200, body: { actor: { subject: info.actor.subject, role: info.actor.role }, csrfToken: info.csrfToken } };
    },
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/sessions`,
    handler: call(context => ({ status: 200, body: service.listSessions(context) })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/sessions/:handle/revoke`,
    handler: call(async context => ({ status: 200, body: await service.revokeSession(context, context.params?.handle) })),
  });

  ctx.http.route({
    method: 'GET', path: '/sessions',
    handler: () => new Response(SESSIONS_PAGE, {
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

  // From here on, the kernel asks this resolver instead of trusting headers.
  const resolveActor = request => {
    const headers = request?.headers ?? {};
    if (ingress !== null && ingress.enabled && headers[INGRESS_HEADERS.subject] !== undefined) {
      let pathname = '/';
      try { pathname = new URL(request.url ?? '/', 'http://ingress.local').pathname; } catch { pathname = '/'; }
      const verified = ingress.verify({
        subject: headers[INGRESS_HEADERS.subject],
        timestamp: headers[INGRESS_HEADERS.timestamp],
        nonce: headers[INGRESS_HEADERS.nonce],
        signature: headers[INGRESS_HEADERS.signature],
        method: String(request?.method ?? 'GET').toUpperCase(),
        path: pathname,
      });
      // A present but invalid signature never falls back to a cookie.
      return verified ? service.actorFor(verified.subject) : null;
    }
    const method = String(request?.method ?? 'GET').toUpperCase();
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const token = headers['x-csrf-token'];
    return service.resolveSession(cookieValue(request, SESSION_COOKIE), {
      mutating,
      csrfToken: typeof token === 'string' ? token : null,
    });
  };
  const disposeResolver = typeof ctx.http.setActorResolver === 'function'
    ? ctx.http.setActorResolver(resolveActor)
    : null;
  const disposeLoginPath = typeof ctx.http.setLoginPath === 'function' ? ctx.http.setLoginPath('/login') : null;

  if (ctx.health?.register) ctx.health.register('access', () => ({ status: 'ok', detail: { sessions: service.listSessions({ actor: { role: 'admin' } }).total } }));

  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    if (typeof disposeResolver === 'function') await disposeResolver();
    if (typeof disposeLoginPath === 'function') await disposeLoginPath();
  };
}

export { SESSION_COOKIE, SESSION_TTL_MS, AccessError };
export default { apply };
