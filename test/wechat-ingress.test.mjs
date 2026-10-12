import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { createWechatIngress, openWechatIngress } from '../server/wechat-ingress.mjs';
import { wechatIdentityDigest } from '../server/wechat-code-exchange.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/workspace-wechat-ingress-');
  const pair = generateKeyPairSync('ed25519'); // In-memory offline fixture only.
  let clock = Date.now(), calls = 0, openid = 'fixture_original_openid', uncertain = false;
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'fixture-workspace', issuer: 'fixture-ingress', keyId: 'fixture-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    idleTimeoutMs: 1000, absoluteTimeoutMs: 2000, members: [{ subject: 'fixture-owner', role: 'admin' }, { subject: 'fixture-viewer', role: 'viewer' }] };
  const appId = 'wx0123456789abcdef', appSecret = 'fixture_app_secret_not_a_real_secret';
  const profile = { version: 1, appId, workspaceId: access.workspaceId, review: { id: 'fixture-review', reviewedBy: 'fixture-owner', reviewedAt: new Date(clock - 1000).toISOString(), expiresAt: new Date(clock + 3600000).toISOString() }, bindings: [
    { openidDigest: wechatIdentityDigest({ appId, appSecret, openid }), subject: 'fixture-owner' },
    { openidDigest: wechatIdentityDigest({ appId, appSecret, openid: 'fixture_viewer_openid' }), subject: 'fixture-viewer' },
  ] };
  const fetchImpl = async url => { calls++; assert.equal(url.origin, 'https://api.weixin.qq.com'); assert.equal(url.pathname, '/sns/jscode2session');
    if (uncertain) throw Error('Sensitive fixture transport detail ' + appSecret);
    return new Response(JSON.stringify({ openid, session_key: Buffer.alloc(16, 9).toString('base64') })); };
  let app = await createApp({ dataDirectory: directory, access, accessClock: () => clock }); await app.listen(0);
  const gateway = () => createWechatIngress({ app, access, privateKey: pair.privateKey, appId, appSecret, profile, fetchImpl, now: () => clock });
  let ingress = gateway();
  t.after(async () => { ingress.close(); await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const call = async (method, target, body, headers = {}) => {
    const result = await ingress.handle({ method, target, headers: { host: 'workspace.example', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, bytes: body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0), remoteAddress: 'fixture-loopback' });
    return { ...result, body: JSON.parse(result.bytes.toString('utf8')) };
  };
  return { directory, access, appSecret, profile, gateway, call, get app() { return app; }, get calls() { return calls; }, setIdentity: value => { openid = value; }, expire: () => { clock += 1100; }, uncertain: () => { uncertain = true; },
    async reopen() { ingress.close(); await app.close(); app = await createApp({ dataDirectory: directory, access, accessClock: () => clock }); await app.listen(0); ingress = gateway(); } };
}

test('native broker issues the original enterprise Session and preserves signing, roles, CSRF and expiry', async t => {
  const f = await fixture(t);
  const invalid = await f.call('POST', '/api/session/wechat', { code: 'fixture-code-first', subject: 'invented-admin' }); assert.equal(invalid.status, 400); assert.equal(f.calls, 0);
  const login = await f.call('POST', '/api/session/wechat', { code: 'fixture-code-first' });
  assert.equal(login.status, 200, JSON.stringify(login.body)); assert.match(login.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(login.body.session.user.id, 'fixture-owner'); assert.equal(login.body.session.mode, 'enterprise');
  const headers = { 'x-workspace-session': login.body.token, 'x-workspace-assertion': 'untrusted-client-identity' };
  const actual = await f.call('GET', '/api/session', undefined, headers); assert.equal(actual.status, 200); assert.equal(actual.body.user.id, 'fixture-owner');
  const rejected = await f.call('POST', '/api/conversations', { title: 'Fixture main' }, headers); assert.equal(rejected.status, 403); assert.equal(rejected.body.error.code, 'CSRF_REJECTED');
  const made = await f.call('POST', '/api/conversations', { title: 'Fixture main', requestId: 'native-create-fixture' }, { ...headers, 'x-csrf-token': actual.body.csrfToken }); assert.equal(made.status, 201);
  assert.equal(f.app.runtime.listRuns().runs.length, 0);
  const disk = JSON.stringify(f.app.store.read()) + await fs.readFile(f.directory + '/security/audit.jsonl', 'utf8');
  for (const secret of [f.appSecret, 'fixture_original_openid', 'fixture-code-first', login.body.token, actual.body.csrfToken]) assert.equal(disk.includes(secret), false);
  f.expire(); const expired = await f.call('GET', '/api/bootstrap', undefined, headers); assert.equal(expired.status, 401);
});

test('unmapped identity, viewer role and uncertain code replay fail closed across reopen', async t => {
  const f = await fixture(t);
  f.setIdentity('fixture_unmapped_openid'); const unmapped = await f.call('POST', '/api/session/wechat', { code: 'fixture-code-unmapped' }); assert.equal(unmapped.status, 403);
  f.setIdentity('fixture_viewer_openid'); const viewer = await f.call('POST', '/api/session/wechat', { code: 'fixture-code-viewer' }); assert.equal(viewer.status, 200);
  const blocked = await f.call('POST', '/api/conversations', { title: 'No permission expansion' }, { 'x-workspace-session': viewer.body.token, 'x-csrf-token': viewer.body.session.csrfToken, 'x-workspace-role': 'admin' }); assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'ROLE_REQUIRED');
  f.uncertain(); const failed = await f.call('POST', '/api/session/wechat', { code: 'fixture-code-uncertain' }); assert.equal(failed.status, 502); assert.equal(failed.bytes.includes(Buffer.from(f.appSecret)), false);
  const calls = f.calls; await f.reopen();
  const replay = await f.call('POST', '/api/session/wechat', { code: 'fixture-code-uncertain' }); assert.equal(replay.status, 409); assert.equal(f.calls, calls);
  assert.equal((await f.call('GET', '/api/session', undefined, { 'x-workspace-session': viewer.body.token })).status, 401);
  assert.equal(f.app.runtime.bootstrap().workspaceWechatLoginAttempts, undefined);
});

test('disabled ingress has no key, account or network startup; review cannot add roles', async t => {
  assert.equal(await openWechatIngress({ configFile: undefined }), null);
  const f = await fixture(t); f.profile.bindings[0].role = 'admin';
  assert.throws(f.gateway, { code: 'WECHAT_BINDING_REVIEW_REQUIRED' });
  assert.equal(f.calls, 0);
});
