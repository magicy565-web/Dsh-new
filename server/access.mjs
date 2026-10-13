import { createPublicKey, verify, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { openPrivateFile } from './store.mjs';
import { openAccessAudit } from './access-audit.mjs';

export class AccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const denied = (code = 'AUTH_REQUIRED', message = 'Sign in through the configured workspace ingress.') => new AccessError(401, code, message);
const badConfig = message => { throw new Error(`Invalid access configuration: ${message}`); };
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const roles = new Set(['admin', 'operator', 'viewer']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._@:+|/-]{1,128}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const emptyHash = hash('');
const cookieName = '__Host-workspace_session';
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const administrative = /^(?:\/api\/(settings|skills|connectors|approvals|schedules|access|commerce-shopify|worker-opportunities|cloud-experts|cloud-teams)(?:\/|$)|\/api\/runs\/[^/]+\/action-decision$|\/api\/worker-orders\/[^/]+\/promote$|\/api\/library\/documents\/[^/]+\/versions\/[^/]+\/reviews$)/;
const writable = /^\/api\/(conversations|goals|runs|memories|artifacts|library|commerce-projects|worker-orders|supply|agent-ui)(?:\/|$)/;
const iso = value => new Date(value).toISOString();
function routeLabel(pathname) {
  const parts = pathname.split('/');
  if (parts[1] !== 'api') return 'static';
  const roots = new Set(['session', 'access', 'health', 'diagnostics', 'bootstrap', 'status', 'events', 'conversations', 'goals', 'runs', 'memories', 'artifacts', 'library', 'commerce-projects', 'commerce-status', 'commerce-shopify', 'settings', 'skills', 'connectors', 'approvals', 'schedules', 'activity', 'search', 'capabilities', 'schedule-runs', 'connector-runs', 'worker-services', 'worker-orders', 'worker-opportunities', 'cloud-expert-catalog', 'cloud-experts', 'cloud-teams']);
  if (!roots.has(parts[2]) && parts[2] !== 'agent-ui') return '/api/unknown';
  return `/api/${parts[2]}${parts.length > 3 ? '/:resource' : ''}`;
}
function canonicalOrigin(value, enterprise = false) {
  let parsed;
  try { parsed = new URL(value); } catch { badConfig('an exact public origin is required.'); }
  if (parsed.origin !== value || parsed.username || parsed.password || (enterprise ? parsed.protocol !== 'https:' || localHosts.has(parsed.hostname) : !['https:', 'http:'].includes(parsed.protocol) || !localHosts.has(parsed.hostname))) badConfig(enterprise ? 'publicOrigin must be an exact HTTPS non-loopback origin.' : 'allowedOrigins must be exact loopback origins.');
  return parsed;
}
export function validateAccessConfig(input = {}, allowedOrigins = []) {
  const mode = input.mode || 'local';
  if (!['local', 'enterprise'].includes(mode)) badConfig('mode must be local or enterprise.');
  const origins = new Set(allowedOrigins);
  for (const origin of origins) canonicalOrigin(origin);
  if (mode === 'local') {
    if (Object.keys(input).some(key => key !== 'mode')) badConfig('enterprise settings require explicit enterprise mode.');
    return { mode, origins };
  }
  if (origins.size) badConfig('development origins are prohibited in enterprise mode.');
  if (Object.keys(input).some(key => !['mode', 'publicOrigin', 'workspaceId', 'issuer', 'keyId', 'publicKey', 'members', 'idleTimeoutMs', 'absoluteTimeoutMs'].includes(key))) badConfig('unknown enterprise access option.');
  const origin = canonicalOrigin(input.publicOrigin, true);
  if (!identifier(input.workspaceId) || !identifier(input.issuer) || !identifier(input.keyId)) badConfig('workspaceId, issuer and keyId are required identifiers.');
  let publicKey;
  try { publicKey = createPublicKey(input.publicKey); } catch { badConfig('a valid Ed25519 public key is required.'); }
  if (publicKey.asymmetricKeyType !== 'ed25519' || typeof input.publicKey !== 'string' || !input.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')) badConfig('only an Ed25519 PUBLIC KEY PEM is accepted.');
  if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > 500) badConfig('members must contain 1–500 explicitly authorized subjects.');
  const members = new Map();
  for (const member of input.members) {
    if (!member || !identifier(member.subject) || !roles.has(member.role) || members.has(member.subject) || Object.keys(member).some(key => !['subject', 'role'].includes(key))) badConfig('members require unique subject and valid role only.');
    members.set(member.subject, member.role);
  }
  if (![...members.values()].includes('admin')) badConfig('at least one admin must be configured.');
  const idleTimeoutMs = input.idleTimeoutMs ?? 15 * 60_000;
  const absoluteTimeoutMs = input.absoluteTimeoutMs ?? 8 * 60 * 60_000;
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 30 * 60_000 || !Number.isInteger(absoluteTimeoutMs) || absoluteTimeoutMs < idleTimeoutMs || absoluteTimeoutMs > 12 * 60 * 60_000) badConfig('session expiry bounds are invalid.');
  return { mode, origins, origin, publicOrigin: origin.origin, workspaceId: input.workspaceId, issuer: input.issuer, keyId: input.keyId, publicKey, members, idleTimeoutMs, absoluteTimeoutMs };
}
async function readConfigFile(filename) {
  if (!filename || !path.isAbsolute(filename)) badConfig('configuration file paths must be absolute.');
  const handle = await openPrivateFile(filename);
  try {
    const stat = await handle.stat();
    if (stat.size > 100_000 || process.platform !== 'win32' && (stat.mode & 0o022)) badConfig('configuration files must be bounded and not group/world writable.');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}
export async function accessConfigFromEnvironment(environment = process.env) {
  const mode = environment.WORKSPACE_ACCESS_MODE || 'local';
  if (environment.NODE_ENV === 'production' && mode !== 'enterprise') badConfig('NODE_ENV=production requires explicit WORKSPACE_ACCESS_MODE=enterprise.');
  if (mode === 'local') return { mode };
  if (mode !== 'enterprise') badConfig('WORKSPACE_ACCESS_MODE must be local or enterprise.');
  let members;
  try { members = JSON.parse(await readConfigFile(environment.WORKSPACE_MEMBERS_FILE)); } catch { badConfig('the members file must be readable, safe JSON.'); }
  const config = { mode, publicOrigin: environment.WORKSPACE_PUBLIC_ORIGIN, workspaceId: environment.WORKSPACE_ID, issuer: environment.WORKSPACE_INGRESS_ISSUER, keyId: environment.WORKSPACE_INGRESS_KEY_ID, publicKey: await readConfigFile(environment.WORKSPACE_INGRESS_PUBLIC_KEY_FILE), members };
  validateAccessConfig(config);
  return config;
}

/** A single shared enterprise workspace, not tenant isolation or an identity provider. */
export async function createAccessControl({ config, dataDirectory, now = Date.now } = {}) {
  const enterprise = config.mode === 'enterprise';
  const sessions = new Map(), sessionObservers = new Map(), rate = new Map();
  const audit = enterprise ? await openAccessAudit(path.join(dataDirectory, 'security'), { now }) : null;
  const replay = audit?.replay || new Map();
  let closing = false, lastDeniedAudit = -Infinity, loginQueue = Promise.resolve();
  function serializeLogin(task) { const operation = loginQueue.then(task); loginQueue = operation.catch(() => {}); return operation; }
  if (audit) { try { await audit.append({ type: 'server.started', workspaceId: config.workspaceId, sessionsRestored: false }); } catch (error) { await audit.close(); throw error; } }
  function revoke(session) {
    if (!session) return;
    sessions.delete(session.tokenHash);
    for (const callback of sessionObservers.get(session.id) || []) callback();
    sessionObservers.delete(session.id);
  }
  function live(session) {
    if (!session || !sessions.has(session.tokenHash)) return false;
    if (now() >= session.expiresAt || now() >= session.lastSeenAt + config.idleTimeoutMs || config.members.get(session.subject) !== session.role) { revoke(session); return false; }
    return true;
  }
  function readSession(req) {
    const values = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    const transport = req.headers['x-workspace-session'];
    if (transport !== undefined && (typeof transport !== 'string' || values.length)) throw new AccessError(400, 'AMBIGUOUS_SESSION', 'Use one session transport.');
    if (transport === undefined && values.length !== 1) return null;
    const token = transport ?? values[0].slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = sessions.get(hash(token));
    return live(session) ? session : null;
  }
  function checkBoundary(req, pathname, { serviceCredential = false } = {}) {
    // Duplicate security-relevant fields can be interpreted differently by proxies.
    for (const name of ['host', 'origin', 'authorization', 'idempotency-key', 'cookie', 'x-workspace-assertion', 'x-csrf-token', 'x-workspace-login', 'x-workspace-session', 'x-workspace-client']) {
      let count = 0;
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
      if (count > 1) throw new AccessError(400, 'AMBIGUOUS_HEADER', 'Duplicate security headers are not allowed.');
    }
    const rawHost = req.headers.host;
    let host;
    try { const parsed = new URL(`http://${rawHost || ''}`); if (parsed.host !== rawHost || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error(); host = parsed.hostname; } catch { throw new AccessError(403, 'HOST_REJECTED', 'Invalid request host.'); }
    if (enterprise) {
      if (rawHost !== config.origin.host) throw new AccessError(403, 'HOST_REJECTED', 'The request host does not match this deployment.');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new AccessError(403, 'INGRESS_REQUIRED', 'Only the local trusted ingress may connect.');
      if (req.headers.origin && req.headers.origin !== config.publicOrigin) throw new AccessError(403, 'ORIGIN_REJECTED', 'The request origin does not match this deployment.');
      if (!serviceCredential && !['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.publicOrigin) throw new AccessError(403, 'ORIGIN_REQUIRED', 'Mutating requests require the exact public origin.');
    } else {
      if (!localHosts.has(host)) throw new AccessError(403, 'LOCAL_ONLY', 'This server only accepts localhost requests.');
      if (req.headers.origin && req.headers.origin !== `http://${rawHost}` && !config.origins.has(req.headers.origin)) throw new AccessError(403, 'ORIGIN_REJECTED', 'Requests from external origins are not allowed.');
    }
    // A signed, authenticated top-level document navigation may return from an
    // external IdP. Only the static shell is eligible; API reads/writes are not.
    const idpReturnNavigation = enterprise && req.method === 'GET' && !pathname.startsWith('/api/') && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (!idpReturnNavigation && ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && (enterprise || req.headers['sec-fetch-site'] === 'cross-site')) throw new AccessError(403, 'ORIGIN_REJECTED', 'Cross-site requests are not allowed.');
    if (!req.url.startsWith('/') || req.url.startsWith('//') || /[\\\u0000-\u001f]/.test(req.url)) throw new AccessError(400, 'INVALID_TARGET', 'Invalid request target.');
    if (['GET', 'HEAD', 'DELETE'].includes(req.method) && (Number(req.headers['content-length'] || 0) !== 0 || req.headers['transfer-encoding'])) throw new AccessError(400, 'BODY_NOT_ALLOWED', 'This method does not accept a request body.');
  }
  function assertion(req) {
    const token = req.headers['x-workspace-assertion'];
    if (typeof token !== 'string' || token.length > 4096) throw denied();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, 'base64url').toString('base64url') !== part)) throw denied('ASSERTION_INVALID');
    let header, claims;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw denied('ASSERTION_INVALID'); }
    if (!header || header.alg !== 'EdDSA' || header.typ !== 'workspace-ingress+jwt' || header.kid !== config.keyId || Object.keys(header).some(key => !['alg', 'typ', 'kid'].includes(key))) throw denied('ASSERTION_INVALID');
    const signature = Buffer.from(parts[2], 'base64url');
    if (signature.length !== 64 || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), config.publicKey, signature)) throw denied('ASSERTION_INVALID');
    const seconds = Math.floor(now() / 1000);
    if (!claims || claims.iss !== config.issuer || claims.aud !== config.publicOrigin || claims.workspace !== config.workspaceId || !identifier(claims.sub) || claims.method !== req.method || claims.target !== req.url || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > seconds + 2 || claims.exp <= seconds || claims.exp <= claims.iat || claims.exp - claims.iat > 30 || claims.iat < seconds - 30 || typeof claims.jti !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(claims.jti) || typeof claims.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(claims.bodySha256)) throw denied('ASSERTION_INVALID');
    if (['GET', 'HEAD', 'DELETE'].includes(req.method) && claims.bodySha256 !== emptyHash) throw denied('ASSERTION_INVALID');
    if (!config.members.has(claims.sub)) throw new AccessError(403, 'MEMBERSHIP_REQUIRED', 'This identity is not a member of this workspace.');
    for (const [key, expires] of replay) if (expires <= now()) replay.delete(key);
    if (replay.has(claims.jti)) throw denied('ASSERTION_REPLAYED', 'The ingress assertion has already been used.');
    // Reserve synchronously before awaiting disk, so concurrent duplicates fail.
    replay.set(claims.jti, claims.exp * 1000);
    return claims;
  }
  function serviceIdentity(binding, { write = false } = {}) {
    if (closing || audit && !audit.healthy) throw new AccessError(503, 'ACCESS_UNAVAILABLE', 'Access control is unavailable.');
    const workspaceId = enterprise ? config.workspaceId : 'local';
    const role = enterprise ? config.members.get(binding.subject) : binding.subject === 'local-operator' ? 'admin' : null;
    if (!role || binding.workspaceId !== workspaceId || binding.expiresAt && now() >= Date.parse(binding.expiresAt)) throw denied('SERVICE_CREDENTIAL_REVOKED', 'The credential no longer belongs to an active workspace member.');
    if (!binding.scopes?.includes('agent:read') || write && (!binding.scopes.includes('agent:submit') || !['admin', 'operator'].includes(role))) throw new AccessError(403, 'ROLE_REQUIRED', 'Your workspace role or Agent scope cannot perform this operation.');
    return { subject: binding.subject, workspaceId, role, scopes: [...binding.scopes] };
  }
  async function beginServiceCredential(req, res, pathname, binding) {
    if (!pathname.startsWith('/api/agent/v1/')) throw denied('SERVICE_SCOPE_REJECTED');
    checkBoundary(req, pathname, { serviceCredential: true });
    // Bearer is an explicit service credential, never an ambient browser session.
    if (req.headers.cookie || req.headers['x-workspace-session'] || req.headers['x-workspace-assertion']) throw new AccessError(400, 'AMBIGUOUS_CREDENTIAL', 'Use one credential transport.');
    const identity = serviceIdentity(binding, { write: !['GET', 'HEAD'].includes(req.method) });
    const context = { ...identity, requestId: randomUUID(), method: req.method, route: '/api/agent/v1/:resource', client: 'agent', finished: false, credentialBinding: binding };
    const key = `agent:${identity.subject}`, bucket = rate.get(key);
    const current = bucket && now() < bucket.until ? bucket : { until: now() + 60_000, count: 0 };
    current.count++; rate.set(key, current);
    if (current.count > 240) throw new AccessError(429, 'RATE_LIMITED', 'Request rate exceeded. Try again shortly.');
    if (audit) {
      await audit.append({ type: 'request.admitted', requestId: context.requestId, workspaceId: identity.workspaceId, actor: identity.subject, role: identity.role, method: req.method, route: context.route, targetHash: hash(req.url), credentialType: 'workspace-agent', scopes: identity.scopes });
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    res.setHeader('X-Request-Id', context.requestId);
    res.accessFinish = async status => {
      if (context.finished) return; context.finished = true;
      await audit?.append({ type: 'request.finished', requestId: context.requestId, actor: context.subject, status });
    };
    return context;
  }
  function sessionView(context) {
    if (!enterprise) return { mode: 'local', authenticated: true, workspaceId: 'local', user: { id: 'local-operator', role: 'admin' }, csrfToken: null, expiresAt: null, idleExpiresAt: null };
    const session = context.session;
    return { mode: 'enterprise', authenticated: live(session), workspaceId: config.workspaceId, user: live(session) ? { id: session.subject, role: session.role } : null, csrfToken: live(session) ? session.csrf : null, expiresAt: live(session) ? iso(session.expiresAt) : null, idleExpiresAt: live(session) ? iso(session.lastSeenAt + config.idleTimeoutMs) : null };
  }
  async function begin(req, res, pathname) {
    if (closing || (audit && !audit.healthy)) throw new AccessError(503, 'ACCESS_UNAVAILABLE', 'Access control is unavailable.');
    checkBoundary(req, pathname);
    const context = { requestId: randomUUID(), method: req.method, route: routeLabel(pathname), client: req.headers['x-workspace-client'] === 'wechat' ? 'wechat' : 'browser', workspaceId: enterprise ? config.workspaceId : 'local', subject: 'local-operator', role: 'admin', session: null, finished: false };
    if (!enterprise) return context;
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Cache-Control', 'no-store');
    const claims = assertion(req);
    context.subject = claims.sub; context.role = config.members.get(claims.sub); context.claims = claims;
    context.session = readSession(req);
    if (context.session?.subject !== claims.sub) context.session = null;
    const bucket = rate.get(claims.sub);
    const current = bucket && now() < bucket.until ? bucket : { until: now() + 60_000, count: 0, logins: 0 };
    current.count++; rate.set(claims.sub, current);
    if (current.count > 240) throw new AccessError(429, 'RATE_LIMITED', 'Request rate exceeded. Try again shortly.');
    await audit.append({ type: 'request.admitted', requestId: context.requestId, workspaceId: config.workspaceId, actor: context.subject, role: context.role, method: req.method, route: context.route, targetHash: hash(req.url), bodyHash: claims.bodySha256, assertionId: claims.jti, assertionExpiresAt: claims.exp * 1000, sessionId: context.session?.id || null });
    res.setHeader('X-Request-Id', context.requestId);
    res.accessFinish = async status => {
      if (context.finished) return;
      context.finished = true;
      await audit.append({ type: 'request.finished', requestId: context.requestId, actor: context.subject, status });
    };
    if (!pathname.startsWith('/api/')) return context;
    if (pathname === '/api/session' && req.method === 'GET') return context;
    if (pathname === '/api/session/login' && req.method === 'POST') {
      current.logins++;
      if (current.logins > 10) throw new AccessError(429, 'RATE_LIMITED', 'Login rate exceeded. Try again shortly.');
      context.login = true;
      if (req.headers['x-workspace-login'] !== '1') throw new AccessError(403, 'LOGIN_INTENT_REQUIRED', 'Send the same-origin login intent header.');
      return context;
    }
    if (!live(context.session)) throw denied('SESSION_REQUIRED', 'Your session has expired or was revoked. Sign in again.');
    context.session.lastSeenAt = now();
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!equal(req.headers['x-csrf-token'], context.session.csrf)) throw new AccessError(403, 'CSRF_REJECTED', 'A valid session CSRF token is required.');
      if (pathname !== '/api/session/logout' && context.role !== 'admin' && (context.role !== 'operator' || administrative.test(pathname) || !writable.test(pathname))) throw new AccessError(403, 'ROLE_REQUIRED', 'Your workspace role cannot perform this operation.');
    }
    if (pathname.startsWith('/api/access/') && context.role !== 'admin') throw new AccessError(403, 'ROLE_REQUIRED', 'An administrator role is required.');
    return context;
  }
  return {
    mode: config.mode, begin, sessionView,
    // Host-internal trusted ingress adapter only; no public identity endpoint.
    // Resolves the existing bearer, with original revocation/expiry/membership.
    nativeSessionIdentity(token, { includeSessionId = false } = {}) {
      if (!enterprise || closing || !audit?.healthy || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const session = sessions.get(hash(token));
      return live(session) ? { subject: session.subject, role: session.role, ...(includeSessionId ? { id: session.id } : {}) } : null;
    },
    nativeSessionById(id) {
      if (!enterprise || closing || !audit?.healthy) return null;
      const session = [...sessions.values()].find(row => row.id === id);
      return live(session) ? { id: session.id, subject: session.subject, role: session.role, workspaceId: config.workspaceId, expiresAt: session.expiresAt } : null;
    },
    health() { return { mode: config.mode, audit: audit ? (audit.healthy ? 'healthy' : 'unavailable') : 'disabled-local-mode', sessions: enterprise ? 'ephemeral-revoked-on-restart' : 'local-operator', boundary: enterprise ? 'loopback-signed-ingress' : 'loopback-local' }; },
    verifyBody(context, bytes) {
      if (!enterprise) return;
      if (closing || !audit.healthy) throw new AccessError(503, 'ACCESS_UNAVAILABLE', 'Access control is unavailable.');
      if (now() >= context.claims.exp * 1000) throw denied('ASSERTION_EXPIRED', 'The ingress assertion expired before request execution.');
      if (!context.login && !live(context.session)) throw denied('SESSION_REQUIRED', 'Your session has expired or was revoked. Sign in again.');
      if (hash(bytes) !== context.claims.bodySha256) throw denied('ASSERTION_BODY_MISMATCH', 'The request body does not match its ingress assertion.');
    },
    async login(context, res) {
      if (!enterprise) return sessionView(context);
      return serializeLogin(async () => {
      if (closing || !audit.healthy) throw new AccessError(503, 'ACCESS_UNAVAILABLE', 'Access control is unavailable.');
      if (now() >= context.claims.exp * 1000) throw denied('ASSERTION_EXPIRED', 'The ingress assertion expired before login.');
      for (const session of sessions.values()) if (!live(session)) revoke(session);
      if (sessions.size >= 2000) throw new AccessError(429, 'SESSION_LIMIT', 'The deployment session limit has been reached.');
      const owned = [...sessions.values()].filter(session => session.subject === context.subject && session.id !== context.session?.id);
      if (owned.length >= 5) throw new AccessError(429, 'SESSION_LIMIT', 'Revoke an existing session before opening another.');
      // Session rotation always generates a new opaque bearer; caller-supplied IDs are never adopted.
      const token = randomBytes(32).toString('base64url');
      const session = { id: randomUUID(), tokenHash: hash(token), subject: context.subject, role: context.role, csrf: randomBytes(32).toString('base64url'), createdAt: now(), lastSeenAt: now(), expiresAt: now() + config.absoluteTimeoutMs };
      await audit.append({ type: 'session.created', requestId: context.requestId, actor: context.subject, role: context.role, sessionId: session.id, expiresAt: iso(session.expiresAt) });
      revoke(context.session); sessions.set(session.tokenHash, session); context.session = session;
      res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(config.absoluteTimeoutMs / 1000)}`);
      // Native clients explicitly receive the same short-lived session. Signed
      // ingress identity, membership, CSRF, expiry and revocation stay required.
      if (context.client === 'wechat') res.setHeader('X-Workspace-Session', token);
      return sessionView(context);
      });
    },
    async logout(context, res) {
      if (enterprise) { await audit.append({ type: 'session.revoked', requestId: context.requestId, actor: context.subject, sessionId: context.session.id }); revoke(context.session); }
      res.setHeader('Set-Cookie', `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      context.session = null;
      return { ok: true };
    },
    listSessions() { return { sessions: [...sessions.values()].filter(live).map(session => ({ id: session.id, subject: session.subject, role: session.role, createdAt: iso(session.createdAt), lastSeenAt: iso(session.lastSeenAt), expiresAt: iso(session.expiresAt), idleExpiresAt: iso(session.lastSeenAt + config.idleTimeoutMs) })) }; },
    async revokeSession(context, id) {
      if (!enterprise) throw new AccessError(400, 'ENTERPRISE_REQUIRED', 'Managed sessions require enterprise mode.');
      const session = [...sessions.values()].find(item => item.id === id);
      if (!session) throw new AccessError(404, 'NOT_FOUND', 'Session not found.');
      await audit.append({ type: 'session.revoked', requestId: context.requestId, actor: context.subject, targetActor: session.subject, sessionId: session.id });
      revoke(session); return { ok: true };
    },
    listAudit(options) {
      if (!audit) return { records: [], nextCursor: 0, latestSequence: 0, integrity: 'disabled-local-mode', externallyAnchored: false };
      try { return audit.list(options); } catch { throw new AccessError(400, 'INVALID_CURSOR', 'Audit cursor and limit must be bounded positive integers.'); }
    },
    serviceIdentity, beginServiceCredential,
    watchServiceStream(context, close) {
      const valid = () => { try { serviceIdentity(context.credentialBinding); return true; } catch { return false; } };
      const timer = setInterval(() => { if (!valid()) close(); }, 250); timer.unref();
      return { valid, stop: () => clearInterval(timer) };
    },
    watchStream(context, close) {
      if (!enterprise) return { valid: () => true, stop: () => {} };
      const valid = () => live(context.session) && now() < context.claims.exp * 1000;
      const observers = sessionObservers.get(context.session.id) || new Set(); observers.add(close); sessionObservers.set(context.session.id, observers);
      const timer = setInterval(() => { if (!valid()) close(); }, 250); timer.unref();
      return { valid, stop: () => { clearInterval(timer); observers.delete(close); if (!observers.size) sessionObservers.delete(context.session.id); } };
    },
    async recordDenial(error) {
      if (audit?.healthy && now() - lastDeniedAudit >= 10_000) { lastDeniedAudit = now(); await audit.append({ type: 'request.denied', code: error instanceof AccessError ? error.code : 'INTERNAL_ERROR', detail: 'Pre-admission denials are sampled at most once per 10 seconds.' }); }
    },
    async close() { closing = true; await loginQueue; for (const session of sessions.values()) revoke(session); await audit?.close(); },
  };
}
