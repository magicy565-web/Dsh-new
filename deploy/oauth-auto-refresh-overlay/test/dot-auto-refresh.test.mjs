import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, generateKeyPairSync, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { jwtVerify, importJWK } from 'jose';
import { createIdentity } from '../deploy/identity/identity.mjs';
import { passwordRecord } from '../deploy/identity/identity-lib.mjs';
import { dotRefreshPolicy } from '../deploy/identity/dot-refresh-policy.mjs';

const DAY = 86400;
const issuer = 'https://auth.example.test';
const resource = 'https://dot.example.test/mcp/dot';
const clientId = 'workspace-dot-chatgpt';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const policy = { version: 1, refreshIdleSeconds: 30 * DAY, grantSeconds: 90 * DAY };
const fixtureRoot = path.resolve('test-fixtures');

async function fixture(long = true, persistentPolicy = policy) {
  const directory = await fs.mkdtemp(path.join(await fs.mkdir(fixtureRoot, { recursive: true }).then(() => fixtureRoot), 'synthetic-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'synthetic-test-key', alg: 'RS256' };
  const ingress = generateKeyPairSync('ed25519');
  const password = randomBytes(24).toString('base64url');
  const config = { issuer, publicOrigin: 'https://workspace.example.test', resource,
    workspaceId: 'synthetic-test-workspace', account: { subject: 'synthetic-test-owner', username: 'fixture', password: await passwordRecord(password) },
    cookieKeys: [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')], jwk,
    identityPort: 19801, gatewayPort: 19802, backendPort: 19803,
    databaseFile: path.join(directory, 'synthetic-oidc.sqlite'), ingressPrivateKey: ingress.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    dotRedirectURIs: [callback], ...(long ? { dotPersistentAuthorization: persistentPolicy } : {}) };
  let identity;
  let base;
  const cookies = new Map();
  async function start() {
    identity = await createIdentity(config);
    await new Promise((resolve, reject) => { identity.server.once('error', reject); identity.server.listen(0, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + identity.server.address().port;
  }
  await start();
  async function request(target, form) {
    const url = new URL(target, issuer);
    assert.equal(url.origin, issuer, 'Fixture must never send to external OAuth callbacks.');
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const output = await new Promise((resolve, reject) => {
      const req = http.request(base + url.pathname + url.search, { method: form ? 'POST' : 'GET',
        headers: { Host: new URL(issuer).host, 'X-Forwarded-Proto': 'https', ...(cookies.size ? { Cookie: [...cookies].map(([k,v]) => k + '=' + v).join('; ') } : {}),
          ...(form ? { ...(url.pathname.startsWith('/interaction/') ? { Origin: issuer } : {}), 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ text: Buffer.concat(chunks).toString(), response: { status: res.statusCode, headers: {
          get: name => res.headers[name.toLowerCase()] ?? null, getSetCookie: () => res.headers['set-cookie'] ?? [] } } }));
        res.on('error', reject);
      }); req.on('error', reject); req.end(body);
    });
    const response = output.response;
    for (const raw of response.headers.getSetCookie()) { const pair = raw.split(';')[0]; const split = pair.indexOf('='); cookies.set(pair.slice(0,split), pair.slice(split+1)); }
    return { response, text: output.text };
  }
  async function authorize() {
    const verifier = randomBytes(32).toString('base64url');
    const args = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'workspace.dot', resource,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    let target = '/auth?' + args;
    let callbackUrl;
    let consentSeen = false;
    for (let i = 0; i < 12; i++) {
      const { response, text } = await request(target);
      const location = response.headers.get('location');
      if (location) {
        const destination = new URL(location, issuer);
        if (destination.origin !== issuer) { callbackUrl = destination; break; }
        target = destination.href; continue;
      }
      assert.equal(response.status, 200, 'Fixture authorization page must load.');
      const csrf = text.match(/name="csrf" value="([^"]+)"/)?.[1];
      assert.ok(csrf, 'Actual interaction must issue its CSRF token.');
      const login = text.includes('name="password"');
      if (!login) consentSeen = true;
      if (!login && config.dotPersistentAuthorization) assert.ok(text.includes(`连续 ${config.dotPersistentAuthorization.refreshIdleSeconds / DAY} 天未刷新`) && text.includes(`授权满 ${config.dotPersistentAuthorization.grantSeconds / DAY} 天`), 'Consent must describe approved bounds.');
      const posted = await request(target, login ? { csrf, username: 'fixture', password } : { csrf, decision: 'allow' });
      assert.equal(posted.response.status, 303, 'The reviewed interaction must finish with redirect.');
      target = posted.response.headers.get('location');
    }
    assert.equal(callbackUrl?.origin, 'https://chatgpt.com', 'Use only registered synthetic callback.');
    if (config.dotPersistentAuthorization) assert.equal(consentSeen, true, 'Long consent must not be silently derived from a previous shorter authorization.');
    assert.ok(callbackUrl.searchParams.has('code'), 'PKCE code flow must finish.');
    const { response, text } = await request('/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback,
      code: callbackUrl.searchParams.get('code'), code_verifier: verifier, resource });
    const failure = response.status === 200 ? '' : JSON.parse(text);
    assert.equal(response.status, 200, 'Actual token endpoint code exchange must succeed: ' + (failure.error ?? '') + ' ' + String(failure.error_description ?? '').replace(/[A-Za-z0-9_-]{30,}/g, '[redacted]'));
    const result = JSON.parse(text);
    assert.ok(typeof result.refresh_token === 'string', 'Issuer must return a refresh token.');
    return result;
  }
  async function refresh(token, extra = {}) {
    const { response, text } = await request('/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: token, resource, ...extra });
    return { status: response.status, body: JSON.parse(text) };
  }
  return { authorize, refresh, config, publicJwk: publicKey.export({ format: 'jwk' }), get provider() { return identity.provider; },
    async restart() { await identity.close(); await start(); },
    async close() { await identity.close(); const resolved = path.resolve(directory); assert.ok(resolved.startsWith(fixtureRoot + path.sep)); await fs.rm(resolved, { recursive: true, force: true }); } };
}

test('baseline reproduces invalid_grant after the 8-hour browser Session expires', async () => {
  const f = await fixture(false); const realNow = Date.now;
  try {
    const tokens = await f.authorize();
    const record = await f.provider.RefreshToken.find(tokens.refresh_token);
    assert.equal(record.expiresWithSession, true);
    const issued = realNow(); Date.now = () => issued + 9 * 3600_000;
    const expired = await f.refresh(tokens.refresh_token);
    assert.equal(expired.status, 400); assert.equal(expired.body.error, 'invalid_grant');
  } finally { Date.now = realNow; await f.close(); }
});

test('new consent refreshes across Session expiry and IdP restart; rotates tokens and preserves scope/audience', async () => {
  const f = await fixture(); const realNow = Date.now;
  try {
    const original = await f.authorize();
    const originalRecord = await f.provider.RefreshToken.find(original.refresh_token);
    assert.equal(Boolean(originalRecord.expiresWithSession), false);
    assert.equal(originalRecord.scope, 'workspace.dot');
    const grant = await f.provider.Grant.find(originalRecord.grantId);
    assert.ok(grant.remainingTTL > 89 * DAY && grant.remainingTTL <= 90 * DAY);
    assert.ok(originalRecord.remainingTTL > 29 * DAY && originalRecord.remainingTTL <= 30 * DAY);
    const issued = realNow(); Date.now = () => issued + 9 * 3600_000;
    await f.restart();
    assert.equal(await f.provider.Session.findByUid(originalRecord.sessionUid), undefined);
    const renewed = await f.refresh(original.refresh_token);
    assert.equal(renewed.status, 200);
    assert.ok(renewed.body.refresh_token !== original.refresh_token);
    const verified = await jwtVerify(renewed.body.access_token, await importJWK(f.publicJwk, 'RS256'), { issuer, audience: resource });
    assert.equal(verified.payload.scope, 'workspace.dot');
    assert.ok(renewed.body.expires_in <= 3600);
    const freshRecord = await f.provider.RefreshToken.find(renewed.body.refresh_token);
    assert.equal(Boolean(freshRecord.expiresWithSession), false);
    assert.equal(freshRecord.grantId, originalRecord.grantId);
    assert.equal((await f.provider.RefreshToken.find(original.refresh_token)).consumed > 0, true);
    const replay = await f.refresh(original.refresh_token);
    assert.equal(replay.status, 400); assert.equal(replay.body.error, 'invalid_grant');
    const revokedChain = await f.refresh(renewed.body.refresh_token);
    assert.equal(revokedChain.status, 400); assert.equal(revokedChain.body.error, 'invalid_grant');
  } finally { Date.now = realNow; await f.close(); }
});

test('idle expiration still rejects an unused persistent token after 30 days', async () => {
  const f = await fixture(); const realNow = Date.now;
  try { const tokens = await f.authorize(); const issued = realNow(); Date.now = () => issued + 31 * DAY * 1000;
    const expired = await f.refresh(tokens.refresh_token); assert.equal(expired.status, 400); assert.equal(expired.body.error, 'invalid_grant');
  } finally { Date.now = realNow; await f.close(); }
});

test('explicit grant revocation rejects further refresh without restoring Session or records', async () => {
  const f = await fixture();
  try { const tokens = await f.authorize(); const rt = await f.provider.RefreshToken.find(tokens.refresh_token);
    const grant = await f.provider.Grant.find(rt.grantId); await grant.destroy();
    const revoked = await f.refresh(tokens.refresh_token); assert.equal(revoked.status, 400); assert.equal(revoked.body.error, 'invalid_grant');
  } finally { await f.close(); }
});

test('rotation stays bounded by original consent even when used regularly', async () => {
  const f = await fixture(); const realNow = Date.now;
  try {
    let tokens = await f.authorize(); const issued = realNow();
    for (const day of [20, 40, 60, 80, 89]) {
      Date.now = () => issued + day * DAY * 1000;
      const next = await f.refresh(tokens.refresh_token); assert.equal(next.status, 200);
      tokens = next.body;
    }
    const last = await f.provider.RefreshToken.find(tokens.refresh_token);
    assert.ok(last.remainingTTL <= DAY && last.remainingTTL > 0, 'Last rotation must not grant an extra 30 days past consent.');
    Date.now = () => issued + 91 * DAY * 1000;
    const expired = await f.refresh(tokens.refresh_token); assert.equal(expired.status, 400); assert.equal(expired.body.error, 'invalid_grant');
  } finally { Date.now = realNow; await f.close(); }
});

test('policy deployment preserves old tokens and does not resurrect a missing old Session', async () => {
  const f = await fixture(false); const realNow = Date.now;
  try {
    const tokens = await f.authorize(); const original = await f.provider.RefreshToken.find(tokens.refresh_token);
    const originalGrant = await f.provider.Grant.find(original.grantId);
    const originalExpiry = originalGrant.exp;
    const issued = realNow(); Date.now = () => issued + 9 * 3600_000;
    f.config.dotPersistentAuthorization = policy; await f.restart();
    const raw = await f.provider.RefreshToken.adapter.find(original.jti);
    assert.equal(raw.expiresWithSession, true, 'Old persistent payload must not be rewritten.');
    assert.equal((await f.provider.Grant.find(original.grantId)).exp, originalExpiry, 'Prior consent lifetime must not be expanded.');
    const previous = await f.refresh(tokens.refresh_token); assert.equal(previous.status, 400); assert.equal(previous.body.error, 'invalid_grant');
    const fresh = await f.authorize(); const renewed = await f.provider.RefreshToken.find(fresh.refresh_token);
    assert.equal(Boolean(renewed.expiresWithSession), false);
    assert.ok(renewed.grantId !== original.grantId, 'Newly reviewed consent must get a new Grant without replacing the old one.');
    assert.ok(await f.provider.Grant.find(original.grantId), 'Existing valid historical Grant must remain present.');
  } finally { Date.now = realNow; await f.close(); }
});

test('client and scope binding remain enforced on persistent refresh', async () => {
  const f = await fixture();
  try {
    const tokens = await f.authorize();
    const wrongClient = await f.refresh(tokens.refresh_token, { client_id: 'workspace-web' });
    assert.equal(wrongClient.status, 400); assert.equal(wrongClient.body.error, 'invalid_request');
    const expanded = await f.refresh(tokens.refresh_token, { scope: 'openid workspace.dot' });
    assert.equal(expanded.status, 400); assert.equal(expanded.body.error, 'invalid_scope');
    const allowed = await f.refresh(tokens.refresh_token); assert.equal(allowed.status, 200);
  } finally { await f.close(); }
});

test('new long consent is shown even when the original browser Session is still valid', async () => {
  const f = await fixture(false);
  try {
    const original = await f.authorize(); const old = await f.provider.RefreshToken.find(original.refresh_token);
    f.config.dotPersistentAuthorization = policy; await f.restart();
    const next = await f.authorize(); const fresh = await f.provider.RefreshToken.find(next.refresh_token);
    assert.ok(fresh.grantId !== old.grantId);
    assert.ok(await f.provider.Grant.find(old.grantId));
    assert.equal(Boolean(fresh.expiresWithSession), false);
  } finally { await f.close(); }
});

test('selected 30-day idle/180-day absolute proposal remains finite under regular rotation', async () => {
  const f = await fixture(true, { ...policy, grantSeconds: 180 * DAY }); const realNow = Date.now;
  try {
    let tokens = await f.authorize(); const issued = realNow();
    const first = await f.provider.RefreshToken.find(tokens.refresh_token);
    const grant = await f.provider.Grant.find(first.grantId);
    assert.ok(grant.remainingTTL > 179 * DAY && grant.remainingTTL <= 180 * DAY);
    for (const day of [20, 40, 60, 80, 100, 120, 140, 160, 178]) {
      Date.now = () => issued + day * DAY * 1000;
      const renewed = await f.refresh(tokens.refresh_token); assert.equal(renewed.status, 200); tokens = renewed.body;
    }
    assert.ok((await f.provider.RefreshToken.find(tokens.refresh_token)).remainingTTL <= 2 * DAY);
    Date.now = () => issued + 181 * DAY * 1000;
    const expired = await f.refresh(tokens.refresh_token); assert.equal(expired.status, 400); assert.equal(expired.body.error, 'invalid_grant');
  } finally { Date.now = realNow; await f.close(); }
});

test('bounded opt-in validation preserves legacy default and rejects malformed/unlimited policies', () => {
  assert.equal(dotRefreshPolicy({ resource }), null);
  for (const value of [{}, { ...policy, grantSeconds: Infinity }, { ...policy, refreshIdleSeconds: 31 * DAY }, { ...policy, grantSeconds: 181 * DAY }, { ...policy, grantSeconds: 20 * DAY }, { ...policy, unknown: true }])
    assert.throws(() => dotRefreshPolicy({ resource, dotPersistentAuthorization: value }));
  const p = dotRefreshPolicy({ resource, dotPersistentAuthorization: policy });
  const other = { clientId: 'workspace-web', scopes: new Set(['workspace.dot']), resourceIndicators: new Set([resource]) };
  assert.equal(p.options.expiresWithSession({}, other), true);
  assert.equal(p.options.expiresWithSession({}, { ...other, clientId, resourceIndicators: new Set(['https://other.example.test/mcp/dot']) }), true);
});
