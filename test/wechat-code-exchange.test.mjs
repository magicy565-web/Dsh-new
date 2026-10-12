import test from 'node:test';
import assert from 'node:assert/strict';
import { createWechatCodeExchange, validateWechatBindingProfile, wechatIdentityDigest, wechatCodeDigest, WECHAT_CODE2SESSION_URL } from '../server/wechat-code-exchange.mjs';
const appId = 'wx0000000000000001', appSecret = 'fixture-server-secret-not-real-012345';
const code = 'fixture-login-code-not-real-0001', openid = 'fixture-openid-not-a-real-account';
const session_key = Buffer.alloc(16, 1).toString('base64');
const reply = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('WeChat official API shape fixture: server-only fixed HTTPS GET with exact code2Session fields and no redirect/retry', async () => {
  let calls = 0;
  const adapter = createWechatCodeExchange({ appId, appSecret, fetchImpl: async (url, options) => {
    calls++; assert.equal(url.origin + url.pathname, WECHAT_CODE2SESSION_URL);
    assert.deepEqual(Object.fromEntries(url.searchParams), { appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return reply({ openid, session_key, unionid: 'fixture-union-id' });
  } });
  const result = await adapter.exchange(code);
  assert.equal(result.openid, openid); assert.equal(result.sessionKey, session_key); assert.equal(calls, 1);
});

test('WeChat setup/error fixtures fail closed and never include raw code, secret, OpenID or response errors', async () => {
  let calls = 0;
  const unconfigured = createWechatCodeExchange({ fetchImpl: () => { calls++; assert.fail('No exchange without credentials'); } });
  await assert.rejects(unconfigured.exchange(code), { code: 'WECHAT_SETUP_REQUIRED' }); assert.equal(calls, 0);
  for (const response of [{ errcode: 40029, errmsg: `${code} ${appSecret}` }, { errcode: 40163 }, { errcode: 45011, errmsg: appSecret }, { openid, session_key: 'invalid' }, { openid: '../other-account', session_key }, { session_key }]) {
    const adapter = createWechatCodeExchange({ appId, appSecret, fetchImpl: async () => reply(response) });
    await assert.rejects(adapter.exchange(code), error => { assert.equal(error.message.includes(code), false); assert.equal(error.message.includes(appSecret), false); assert.equal(error.message.includes(openid), false); return true; });
  }
});

test('WeChat network timeout/invalid and oversized responses are bounded without retry or credential-bearing causes', async () => {
  for (const fetchImpl of [async () => { throw Error(`${WECHAT_CODE2SESSION_URL}?secret=${appSecret}&js_code=${code}`); }, async () => new Response('bad-json'), async () => new Response('x'.repeat(16385)), async (_url, options) => {
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); throw Error('timeout');
  }]) {
    let calls = 0;
    const adapter = createWechatCodeExchange({ appId, appSecret, timeoutMs: 20, fetchImpl: (...args) => { calls++; return fetchImpl(...args); } });
    const keepAlive = setTimeout(() => {}, 40);
    try { await assert.rejects(adapter.exchange(code), error => { assert.equal(error.message.includes(appSecret), false); assert.equal(error.cause, undefined); return true; }); assert.equal(calls, 1); }
    finally { clearTimeout(keepAlive); }
  }
});

test('WeChat reviewed mapping fixture: app/workspace isolation and only existing enterprise members; client roles are rejected', () => {
  const now = Date.now(), members = new Map([['existing-admin', 'admin'], ['existing-operator', 'operator']]);
  const openidDigest = wechatIdentityDigest({ appId, appSecret, openid });
  const profile = { version: 1, appId, workspaceId: 'existing-workspace', review: { id: 'fixture-reviewed-binding', reviewedBy: 'existing-admin', reviewedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString() }, bindings: [{ openidDigest, subject: 'existing-operator' }] };
  const options = { appId, workspaceId: 'existing-workspace', members, now };
  assert.equal(validateWechatBindingProfile(profile, options).bindings.get(openidDigest), 'existing-operator');
  assert.notEqual(wechatIdentityDigest({ appId: 'wx0000000000000002', appSecret, openid }), openidDigest);
  assert.notEqual(wechatIdentityDigest({ appId, appSecret: 'other-fixture-secret', openid }), openidDigest);
  assert.notEqual(wechatCodeDigest({ appId, appSecret, code }), openidDigest);
  for (const input of [{ ...profile, workspaceId: 'other-workspace' }, { ...profile, appId: 'wx0000000000000002' }, { ...profile, role: 'admin' }, { ...profile, bindings: [{ openidDigest, subject: 'unknown-member' }] }, { ...profile, bindings: [{ openidDigest, subject: 'existing-operator', role: 'admin' }] }, { ...profile, bindings: [profile.bindings[0], profile.bindings[0]] }, { ...profile, review: { ...profile.review, reviewedBy: 'existing-operator' } }, { ...profile, review: { ...profile.review, expiresAt: new Date(now - 1).toISOString() } }])
    assert.throws(() => validateWechatBindingProfile(input, options), { code: 'WECHAT_BINDING_REVIEW_REQUIRED' });
});
