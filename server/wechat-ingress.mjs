import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { openPrivateFile } from './store.mjs';
import { validateAccessConfig } from './access.mjs';
import { signWorkspaceRequest } from './auth-ingress.mjs';
import { createWechatCodeExchange, validateWechatBindingProfile, validateWechatLoginCode, wechatIdentityDigest, wechatCodeDigest, WechatLoginError } from './wechat-code-exchange.mjs';

const fail = (status, code, message) => { throw new WechatLoginError(status, code, message); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const response = (status, body) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, bytes: Buffer.from(JSON.stringify(body)) });
const safeHeaders = ['content-type', 'content-disposition', 'content-length', 'x-content-sha256', 'x-request-id'];

// Native ingress authenticates wx codes only against a reviewed existing member
// map, then forwards exact requests through ORIGINAL signed ingress + Session.
// It has no session store, role grants, execution engine, timers or model client.
export function createWechatIngress({ app, access, privateKey, appId, appSecret, profile, fetchImpl, now = Date.now } = {}) {
  const config = validateAccessConfig(access);
  if (config.mode !== 'enterprise') fail(503, 'WECHAT_ENTERPRISE_REQUIRED', 'Native login requires the existing enterprise access configuration.');
  let key;
  try {
    key = typeof privateKey === 'object' && privateKey?.type === 'private' ? privateKey : createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519' || createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== config.publicKey.export({ type: 'spki', format: 'pem' })) throw Error('Mismatch');
  } catch { fail(503, 'WECHAT_INGRESS_KEY_MISMATCH', 'Use the existing reviewed ingress signing key matching this enterprise configuration.'); }
  const exchange = createWechatCodeExchange({ appId, appSecret, fetchImpl });
  if (!exchange.configured) fail(503, 'WECHAT_SETUP_REQUIRED', 'Native login credentials and member mapping are not configured.');
  const reviewed = () => validateWechatBindingProfile(profile, { appId, workspaceId: config.workspaceId, members: config.members, now: now() });
  reviewed();
  const expectedHost = new URL(config.publicOrigin).host, rate = new Map();
  let closing = false;
  function throttle(address) {
    const at = now();
    for (const [id, bucket] of rate) if (bucket.until <= at) rate.delete(id);
    if (rate.size >= 2000 && !rate.has(address)) fail(429, 'RATE_LIMITED', 'Native login capacity is temporarily unavailable.');
    const bucket = rate.get(address) || { until: at + 60_000, count: 0 };
    bucket.count++; rate.set(address, bucket);
    if (bucket.count > 10) fail(429, 'RATE_LIMITED', 'Obtain a fresh login code after the login rate limit resets.');
  }
  async function forward(method, target, bytes, subject, headers = {}, login = false) {
    const address = app.server.address();
    if (!address || typeof address === 'string' || !['127.0.0.1', '::1'].includes(address.address)) fail(503, 'WECHAT_UPSTREAM_REQUIRED', 'The original Workspace must listen on its reviewed loopback boundary.');
    const assertion = signWorkspaceRequest({ privateKey: key, ...config, subject, method, target, body: bytes, now: now() });
    return new Promise((resolve, reject) => {
      const req = http.request({ host: address.address, port: address.port, method, path: target, headers: {
        Host: expectedHost, Origin: config.publicOrigin, 'X-Workspace-Assertion': assertion, 'X-Workspace-Client': 'wechat',
        ...(login ? { 'X-Workspace-Login': '1' } : {}),
        ...(headers['x-workspace-session'] ? { 'X-Workspace-Session': headers['x-workspace-session'] } : {}),
        ...(headers['x-csrf-token'] ? { 'X-CSRF-Token': headers['x-csrf-token'] } : {}),
        ...(bytes.length ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
      }, timeout: 10_000 }, res => {
        const chunks = []; let length = 0;
        res.on('data', chunk => { length += chunk.length; if (length > 16_777_216) { req.destroy(); reject(new WechatLoginError(502, 'WECHAT_UPSTREAM_UNCERTAIN', 'The original response exceeded the native ingress limit.')); } else chunks.push(chunk); });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
        res.on('error', () => reject(new WechatLoginError(502, 'WECHAT_UPSTREAM_UNCERTAIN', 'The original response could not be confirmed.')));
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => reject(new WechatLoginError(502, 'WECHAT_UPSTREAM_UNCERTAIN', 'The original request result could not be confirmed.')));
      req.end(bytes);
    });
  }
  async function handle({ method, target, headers = {}, bytes = Buffer.alloc(0), remoteAddress = 'unknown' }) {
    try {
      if (closing) fail(503, 'WECHAT_INGRESS_CLOSED', 'Native ingress is closing.');
      if (headers.host !== expectedHost || headers.origin && headers.origin !== config.publicOrigin) fail(403, 'ORIGIN_REJECTED', 'Use the reviewed enterprise HTTPS origin.');
      if (!['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'].includes(method) || typeof target !== 'string' || !target.startsWith('/api/') || /[\u0000-\u0020\u007f\\#]/.test(target) || target.startsWith('//')) fail(400, 'INVALID_NATIVE_REQUEST', 'Use an exact original Workspace API request.');
      if (!Buffer.isBuffer(bytes) || bytes.length > 7_100_000 || ['GET', 'HEAD', 'DELETE'].includes(method) && bytes.length) fail(400, 'INVALID_NATIVE_REQUEST', 'The native request body is invalid.');
      if (target === '/api/session/wechat' && method === 'POST') {
        throttle(remoteAddress); const mapping = reviewed();
        if (bytes.length > 2048 || !headers['content-type']?.startsWith('application/json')) fail(400, 'WECHAT_CODE_INVALID', 'Provide only the bounded JSON login code.');
        let body; try { body = JSON.parse(bytes.toString('utf8')); } catch { fail(400, 'WECHAT_CODE_INVALID', 'Provide a valid login code object.'); }
        if (!record(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'code')) fail(400, 'WECHAT_CODE_INVALID', 'Client identity, role, owner and token fields are not accepted.');
        validateWechatLoginCode(body.code);
        const digest = wechatCodeDigest({ appId, appSecret, code: body.code });
        await app.store.update(state => {
          const attempts = state.workspaceWechatLoginAttempts ||= { version: 1, codes: [] };
          if (attempts.version !== 1 || !Array.isArray(attempts.codes)) fail(503, 'WECHAT_LOGIN_RECORD_INVALID', 'Native login records need operator review.');
          // Only HMAC digests survive. Consume before network; uncertain codes
          // are never automatically exchanged again, including after reopen.
          attempts.codes = attempts.codes.filter(row => row.expiresAt > now());
          if (attempts.codes.some(row => row.digest === digest)) fail(409, 'WECHAT_CODE_USED', 'This code already has an exchange attempt. Obtain a fresh code.');
          if (attempts.codes.length >= 1000) fail(429, 'RATE_LIMITED', 'Native login attempt capacity is temporarily unavailable.');
          attempts.codes.push({ digest, expiresAt: now() + 600_000 });
        });
        const identity = await exchange.exchange(body.code);
        const subject = mapping.bindings.get(wechatIdentityDigest({ appId, appSecret, openid: identity.openid }));
        if (!subject || !config.members.has(subject)) fail(403, 'WECHAT_MEMBER_UNMAPPED', 'This WeChat identity has no reviewed existing enterprise membership.');
        reviewed(); // Review must still be valid after the network exchange.
        const result = await forward('POST', '/api/session/login', Buffer.from('{}'), subject, {}, true);
        if (result.status !== 200) return response(result.status, JSON.parse(result.bytes.toString('utf8')));
        const session = JSON.parse(result.bytes.toString('utf8')), token = result.headers['x-workspace-session'];
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || session?.authenticated !== true || session.user?.id !== subject || session.mode !== 'enterprise') fail(502, 'WECHAT_SESSION_UNCERTAIN', 'The original enterprise session could not be confirmed. Obtain a fresh code.');
        const verified = app.access.nativeSessionIdentity(token, { includeSessionId: true });
        if (verified?.id) app.supplierNotifications?.registerVerifiedLogin?.({ sessionId: verified.id, subject, workspaceId: config.workspaceId, appId, openid: identity.openid, reviewId: mapping.reviewId, expiresAt: Math.min(mapping.expiresAt, Date.parse(session.expiresAt)) });
        return response(200, { token, session });
      }
      const identity = app.access.nativeSessionIdentity(headers['x-workspace-session']);
      if (!identity) fail(401, 'SESSION_REQUIRED', 'Sign in with a fresh WeChat code.');
      // Untrusted assertions/cookies/identity headers are discarded. The same
      // opaque original Session determines the signed subject for every call.
      const result = await forward(method, target, bytes, identity.subject, headers);
      return { status: result.status, headers: { ...Object.fromEntries(safeHeaders.filter(name => result.headers[name] !== undefined).map(name => [name, result.headers[name]])), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, bytes: result.bytes };
    } catch (error) {
      return response(error instanceof WechatLoginError ? error.status : 503, { error: { code: error instanceof WechatLoginError ? error.code : 'WECHAT_LOGIN_UNAVAILABLE', message: error instanceof WechatLoginError ? error.message : 'Native login or forwarding could not be completed.' } });
    }
  }
  // Host-internal terminal action only. It is deliberately not an HTTP route
  // and is never called automatically during login. Resolve the original live
  // Session and exact Muse owner here; callers cannot supply another identity.
  async function launchOwnerTui({ token, mode = 'diagnose', stdio = 'inherit', environment = process.env } = {}) {
    if (closing) fail(503, 'WECHAT_INGRESS_CLOSED', 'Native ingress is closing.');
    const identity = app.access.nativeSessionIdentity(token);
    if (!identity) fail(401, 'OWNER_SESSION_EXPIRED', 'Return to the original safe login before opening the terminal.');
    if (!app.piMuse) fail(409, 'MW_ORIGINAL_BINDING_REQUIRED', 'Restore the existing original Muse binding.');
    app.piMuse.forActor({ ...identity, workspaceId: config.workspaceId });
    const sessionResult = await handle({ method: 'GET', target: '/api/session', headers: { host: expectedHost, 'x-workspace-session': token } });
    if (sessionResult.status !== 200) fail(401, 'OWNER_SESSION_EXPIRED', 'The original Session is unavailable.');
    // Lazy optional client import: normal server/login startup does not load Pi
    // TUI dependencies, start a child, or create any additional listener.
    let launchWithExistingOwnerSession;
    try { ({ launchWithExistingOwnerSession } = await import('../tui/owner-host-launch.mjs')); }
    catch { fail(503, 'OWNER_TUI_CLIENT_UNAVAILABLE', 'Install the reviewed optional tui source package before opening its terminal.'); }
    return launchWithExistingOwnerSession({ origin: config.publicOrigin, token,
      session: JSON.parse(sessionResult.bytes.toString('utf8')), conversationId: app.piMuse.actor.nativeAgentId,
      mode, stdio, environment,
      fetchImpl: async (url, options) => {
        options.signal?.throwIfAborted();
        const target = new URL(url);
        if (target.origin !== config.publicOrigin || target.search || target.hash) fail(403, 'OWNER_ROUTE_FORBIDDEN', 'Use the original native ingress only.');
        const result = await handle({ method: options.method, target: target.pathname,
          headers: { host: expectedHost, ...Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])) },
          bytes: options.body === undefined ? Buffer.alloc(0) : Buffer.from(options.body), remoteAddress: 'original-owner-terminal-host' });
        options.signal?.throwIfAborted(); // An aborted write remains uncertain; never replay it here.
        return new Response(result.bytes, { status: result.status, headers: result.headers });
      },
    });
  }
  return { handle, launchOwnerTui, close() { closing = true; rate.clear(); } };
}

async function privateText(filename, max = 100_000) {
  let file;
  try { file = await openPrivateFile(filename, 'r'); if ((await file.stat()).size > max) fail(503, 'WECHAT_SETUP_REQUIRED', 'Native ingress configuration exceeds its size limit.'); return await file.readFile('utf8'); }
  catch { fail(503, 'WECHAT_SETUP_REQUIRED', 'Native ingress requires bounded private regular configuration files.'); }
  finally { await file?.close(); }
}

export async function openWechatIngress({ app, access, configFile }) {
  if (!configFile) return null; // Disabled startup has no exchange or key read.
  let input;
  try { input = JSON.parse(await privateText(configFile)); } catch { fail(503, 'WECHAT_SETUP_REQUIRED', 'Use a reviewed private native ingress configuration file.'); }
  if (!record(input) || input.version !== 1 || Object.keys(input).some(key => !['version', 'host', 'port', 'tlsCertFile', 'tlsKeyFile', 'ingressKeyFile', 'appId', 'appSecretFile', 'bindingProfileFile'].includes(key)) || input.host !== '127.0.0.1' || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || !['tlsCertFile', 'tlsKeyFile', 'ingressKeyFile', 'appSecretFile', 'bindingProfileFile'].every(name => typeof input[name] === 'string' && path.isAbsolute(input[name]))) fail(503, 'WECHAT_SETUP_REQUIRED', 'Native HTTPS ingress requires an explicit reviewed loopback listener and existing absolute private file paths.');
  const [cert, tlsKey, privateKey, appSecret, profileBytes] = await Promise.all([privateText(input.tlsCertFile), privateText(input.tlsKeyFile), privateText(input.ingressKeyFile), privateText(input.appSecretFile, 256), privateText(input.bindingProfileFile)]);
  const gateway = createWechatIngress({ app, access, privateKey, appId: input.appId, appSecret: appSecret.trim(), profile: JSON.parse(profileBytes) });
  const server = https.createServer({ cert, key: tlsKey, minVersion: 'TLSv1.2' }, async (req, res) => {
    const chunks = []; let length = 0;
    try {
      const names = req.rawHeaders.filter((_, index) => index % 2 === 0).map(name => name.toLowerCase());
      if (['host', 'origin', 'content-type', 'content-length', 'x-workspace-session', 'x-csrf-token'].some(name => names.filter(value => value === name).length > 1)) fail(400, 'AMBIGUOUS_HEADER', 'Duplicate native security headers are not accepted.');
      for await (const chunk of req) { length += chunk.length; if (length > 7_100_000) fail(413, 'BODY_TOO_LARGE', 'The native request is too large.'); chunks.push(chunk); }
      const result = await gateway.handle({ method: req.method, target: req.url, headers: req.headers, bytes: Buffer.concat(chunks), remoteAddress: req.socket.remoteAddress });
      res.writeHead(result.status, result.headers); res.end(result.bytes);
    } catch (error) { const result = response(error instanceof WechatLoginError ? error.status : 503, { error: { code: error instanceof WechatLoginError ? error.code : 'WECHAT_INGRESS_UNAVAILABLE', message: error instanceof WechatLoginError ? error.message : 'Native ingress is unavailable.' } }); res.writeHead(result.status, result.headers); res.end(result.bytes); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxHeadersCount = 64;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(input.port, input.host, resolve); });
  return { launchOwnerTui: gateway.launchOwnerTui,
    async close() { gateway.close(); const stopped = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await stopped; } };
}
