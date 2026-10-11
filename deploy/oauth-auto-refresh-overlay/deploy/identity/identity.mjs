import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Provider, { errors } from 'oidc-provider';
import { loadIdentity, validateIdentity, persistentAdapter, checkPassword, csrfToken, safeEqual, boundary, readForm, page, escapeHTML } from './identity-lib.mjs';
import { dotRefreshPolicy } from './dot-refresh-policy.mjs';

const loginWindowSeconds = 30 * 60;
const chatGPTPluginPage = 'https://chatgpt.com/plugins/plugin_asdk_app_6ac76f30a1b8819186b972717cc5f1ee';
const reconnectLink = '<p><a href="/connect/chatgpt">重新连接 xy</a></p>';

export async function createIdentity(config) {
  validateIdentity(config);
  const dotRefresh = dotRefreshPolicy(config);
  const persistence = await persistentAdapter(config.databaseFile);
  let provider;
  try {
    provider = new Provider(config.issuer, {
      adapter: persistence.Adapter,
      jwks: { keys: [config.jwk] },
      clients: [
        { client_id: 'workspace-web', client_name: 'Workspace 平台', redirect_uris: [`${config.publicOrigin}/auth/callback`], response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'none' },
        { client_id: 'workspace-dot-chatgpt', client_name: 'xy 的 Workspace 插件', redirect_uris: config.dotRedirectURIs, response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' },
      ],
      cookies: { keys: config.cookieKeys, long: { secure: true, httpOnly: true, sameSite: 'lax' }, short: { secure: true, httpOnly: true, sameSite: 'lax' } },
      features: {
        devInteractions: { enabled: false }, registration: { enabled: false }, clientIdMetadataDocument: { enabled: false },
        resourceIndicators: { enabled: true, defaultResource: () => undefined,
          getResourceServerInfo(_ctx, resource, client) {
            if (resource !== config.resource || client.clientId !== 'workspace-dot-chatgpt') throw new errors.InvalidTarget();
            return { scope: 'workspace.dot', audience: config.resource, accessTokenFormat: 'jwt', accessTokenTTL: 3600, jwt: { sign: { alg: 'RS256', kid: config.jwk.kid } } };
          }, useGrantedResource: () => false },
      },
      pkce: { methods: ['S256'], required: () => true },
      responseTypes: ['code'], scopes: ['openid', 'offline_access', 'workspace.dot'],
      ttl: { AccessToken: 3600, IdToken: 3600, AuthorizationCode: 60, Interaction: loginWindowSeconds, Grant: dotRefresh?.grantTTL ?? 86400, RefreshToken: dotRefresh?.refreshTTL ?? 86400, Session: 8 * 3600 },
      ...(dotRefresh?.options ?? {}),
      renderError(ctx) { ctx.type = 'html'; ctx.body = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接未完成</title><p>授权请求未通过检查，请重新开始连接。</p>' + reconnectLink + '</html>'; ctx.set('Cache-Control', 'no-store'); ctx.set('Referrer-Policy', 'no-referrer'); ctx.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); },
      issueRefreshToken: (_ctx, client) => client.clientId === 'workspace-dot-chatgpt',
      extraTokenClaims: (_ctx, token) => token.resourceServer?.audience === config.resource ? { workspace_id: config.workspaceId } : {},
      findAccount: (_ctx, subject) => subject === config.account.subject ? { accountId: subject, claims: () => ({ sub: subject }) } : undefined,
      interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    });
  } catch (error) { persistence.close(); throw error; }
  provider.proxy = true;
  let loginWindow = { count: 0, until: 0 };
  // Public-client registration is fixed. No arbitrary clients, redirects or user enrollment.
  provider.use(async (ctx, next) => {
    if (ctx.path === '/auth' && ctx.query.client_id === 'workspace-dot-chatgpt' && ctx.query.resource !== config.resource) throw new errors.InvalidTarget('Use the exact Workspace dot resource.');
    await next();
  });
  async function interaction(req, res, uid) {
    const details = await provider.interactionDetails(req, res);
    if (details.uid !== uid || !['login', 'consent'].includes(details.prompt.name)) return page(res, '登录状态已失效', '<p>请重新连接，并在 30 分钟内完成登录及授权。</p>' + reconnectLink, 400);
    const name = details.prompt.name, token = csrfToken(config, uid, name), client = await provider.Client.find(details.params.client_id);
    const formRedirect = details.params.redirect_uri;
    if (!client?.redirectUris.includes(formRedirect)) throw Error('Unexpected interaction redirect.');
    if (req.method === 'GET') {
      const fields = `<input type="hidden" name="csrf" value="${token}">`;
      // no-referrer makes browser form POSTs send Origin: null (Fetch standard).
      // Keep exact Origin/CSRF checks and suppress referrers outside our origin.
      // Chromium checks redirects after form submission against form-action too.
      // Permit only this interaction's already registered OAuth callback.
      if (name === 'login') return page(res, '登录 Workspace', `<p>使用你为平台设置的账号。请在 30 分钟内完成登录及授权。</p><form method="post" action="/interaction/${escapeHTML(uid)}">${fields}<label>账号<input name="username" autocomplete="username" maxlength="64" required></label><label>密码<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label><button>登录</button></form>` + reconnectLink, 200, 'same-origin', formRedirect);
      return page(res, '确认授权', `<p>连接：${escapeHTML(client.clientName)}</p><p>${details.params.client_id === 'workspace-dot-chatgpt' ? (dotRefresh?.consent ?? '允许 xy 读取交办任务、执行任务并回传文件与结果。连接最多维持一天，到期需重新授权。平台不授权新增付费消费。') : '允许此账号登录 Workspace 平台。'}</p><form method="post" action="/interaction/${escapeHTML(uid)}">${fields}<button name="decision" value="allow">允许连接</button><button name="decision" value="deny">取消</button></form>`, 200, 'same-origin', formRedirect);
    }
    if (req.method !== 'POST' || req.headers.origin !== config.issuer) return page(res, '请求被拒绝', '<p>请从当前登录页操作。</p>', 403);
    const form = await readForm(req);
    if (!safeEqual(form.get('csrf'), token)) return page(res, '请求已过期', '<p>请重新打开登录页。</p>', 403);
    if (name === 'login') {
      if (Date.now() >= loginWindow.until) loginWindow = { count: 0, until: Date.now() + 60000 };
      if (++loginWindow.count > 10) return page(res, '请稍后重试', '<p>登录尝试过于频繁，请等待一分钟。</p>', 429);
      const validPassword = await checkPassword(form.get('password'), config.account.password);
      if (!validPassword || !safeEqual(form.get('username'), config.account.username)) return page(res, '登录未成功', '<p>账号或密码不正确。请返回登录页重试。</p>', 401);
      return provider.interactionFinished(req, res, { login: { accountId: config.account.subject } }, { mergeWithLastSubmission: false });
    }
    if (form.get('decision') !== 'allow') return provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'The user declined authorization.' }, { mergeWithLastSubmission: false });
    if (details.session?.accountId !== config.account.subject) throw Error('Unexpected account.');
    // A newly consented long connection uses a new bounded Grant. Leave all
    // old grants/tokens intact; do not silently expand previously granted time.
    const freshDotGrant = dotRefresh && details.params.client_id === 'workspace-dot-chatgpt';
    const grant = !freshDotGrant && details.grantId ? await provider.Grant.find(details.grantId) : new provider.Grant({ accountId: config.account.subject, clientId: details.params.client_id });
    if (!grant) throw Error('Expired grant.');
    if (freshDotGrant) {
      const requested = new Set(String(details.params.scope ?? '').split(' '));
      if (details.params.resource !== config.resource || !requested.has('workspace.dot')) throw Error('Unexpected persistent Dot permission.');
      grant.addResourceScope(config.resource, 'workspace.dot');
      for (const scope of ['openid', 'offline_access']) if (requested.has(scope)) grant.addOIDCScope(scope);
    }
    if (details.prompt.details.missingOIDCScope) grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '));
    if (details.prompt.details.missingOIDCClaims) grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
    for (const [resource, scopes] of Object.entries(details.prompt.details.missingResourceScopes || {})) {
      if (resource !== config.resource || scopes.some(scope => scope !== 'workspace.dot')) throw Error('Unexpected resource permission.');
      grant.addResourceScope(resource, scopes.join(' '));
    }
    return provider.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
  }
  const callback = provider.callback();
  const server = http.createServer({ maxHeaderSize: 16384 }, (req, res) => {
    if (!boundary(req, config.issuer)) { res.writeHead(403); res.end(); return; }
    const match = /^\/interaction\/([A-Za-z0-9_-]{1,128})$/.exec(req.url);
    if (match) { interaction(req, res, match[1]).catch(error => {
      const lostSession = error instanceof errors.SessionNotFound;
      // Only bounded categories; never log an interaction URL, credentials or tokens.
      console.warn(JSON.stringify({event:'workspace-identity-interaction-failed',category:lostSession?'session-unavailable':'form-processing-failed',method:req.method==='POST'?'POST':'GET'}));
      if (!res.headersSent) page(res, lostSession ? '登录状态已失效' : '连接未完成', '<p>请重新连接，并在 30 分钟内完成登录及授权。</p>' + reconnectLink, 400); else res.destroy();
    }); return; }
    if (req.method === 'GET' && req.url === '/connect/chatgpt') {
      // Fixed, previously observed existing plugin. No client-controlled redirects.
      res.writeHead(302, {location:chatGPTPluginPage,'cache-control':'no-store','referrer-policy':'no-referrer'}); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/') return page(res, 'Workspace 账号', `<p>此账号服务用于平台登录和 xy 的插件授权。</p>${reconnectLink}<a href="${escapeHTML(config.publicOrigin)}/auth/login">进入 Workspace</a>`);
    callback(req, res);
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  return { server, provider, async close() { await new Promise(resolve => server.listening ? server.close(resolve) : resolve()); server.closeAllConnections(); persistence.close(); } };
}
export async function startIdentity(environment = process.env) {
  const config = await loadIdentity(environment.WORKSPACE_IDENTITY_FILE), identity = await createIdentity(config);
  await new Promise((resolve, reject) => { identity.server.once('error', reject); identity.server.listen(config.identityPort, '127.0.0.1', resolve); });
  console.log('Workspace identity service started on its configured loopback port.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => identity.close().then(() => process.exit(0)));
  return identity;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startIdentity().catch(() => { console.error('Identity startup failed. Inspect the private configuration and service journal locally.'); process.exitCode = 1; });
