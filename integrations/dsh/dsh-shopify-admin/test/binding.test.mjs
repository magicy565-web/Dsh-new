import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ShopifyBindingStore } from '../store.js';
import { createShopifyBindingService } from '../service.js';
import { createShopifyBindingHandler } from '../http.js';
import { normalizeShop, verifyUninstall } from '../core.js';

const NOW = Date.parse('2026-10-29T00:00:00Z');
const SHOP = 'fixture-factory.myshopify.com';
const SECRET = 'synthetic-shopify-client-secret';
const KEY = randomBytes(32).toString('hex');
const registry = { list: () => [{ id: 'enterprise-a', sessionIds: ['session-a'] }, { id: 'enterprise-b', sessionIds: ['session-b'] }],
  get: id => ['enterprise-a', 'enterprise-b'].includes(id) ? { id } : null };
const shop = { id: 'gid://shopify/Shop/12345', name: 'Synthetic Factory', myshopifyDomain: SHOP };
const success = (data, gql = false) => ({ ok: true, status: 200, text: async () => JSON.stringify(data),
  headers: { get: key => gql && key === 'x-shopify-api-version' ? '2026-10' : null } });
function fixture() {
  let now = NOW;
  const calls = [];
  const store = new ShopifyBindingStore({ filename: ':memory:', encryptionKey: KEY });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.ok(url.startsWith('https://' + SHOP + '/admin/'), 'never send credentials to unexpected domain');
    assert.equal(init.redirect, 'error');
    if (url.endsWith('/oauth/access_token')) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('client_secret'), SECRET);
      const refreshing = form.get('grant_type') === 'refresh_token';
      assert.ok(refreshing || (form.get('code') === 'synthetic-merchant-code' && form.get('expiring') === '1'));
      return success({ access_token: refreshing ? 'access-rotated-secret' : 'access-original-secret',
        refresh_token: refreshing ? 'refresh-rotated-secret' : 'refresh-original-secret',
        expires_in: 3600, refresh_token_expires_in: 7776000, scope: 'read_products' });
    }
    assert.ok(url.endsWith('/admin/api/2026-10/graphql.json'));
    if (JSON.parse(init.body).query.includes('shop {')) return success({ data: { shop } }, true);
    return success({ data: { products: { nodes: [{ id: 'gid://shopify/Product/123', title: 'Synthetic Item', handle: 'synthetic', status: 'ACTIVE' }] } } }, true);
  };
  const service = createShopifyBindingService({ registry, store, clientId: 'synthetic-client-id', clientSecret: SECRET,
    redirectUri: 'https://dsh.example.test/shopify-admin-binding/oauth/callback',
    enterpriseWorkspaceId: 'enterprise-a', fetchImpl, clock: () => now });
  return { store, service, calls, now: () => now, advance: ms => { now += ms; } };
}
function callback(begun, now, fields = {}) {
  const state = new URL(begun.authorizeUrl).searchParams.get('state');
  const params = new URLSearchParams({ code: 'synthetic-merchant-code', shop: SHOP, state,
    timestamp: String(Math.floor(now / 1000)), ...fields });
  const bytes = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('&');
  params.set('hmac', createHmac('sha256', SECRET).update(bytes).digest('hex'));
  return params;
}
async function connect(f) {
  const start = f.service.begin('session-a', SHOP);
  return { start, signed: callback(start, f.now()), result: await f.service.finish(callback(start, f.now())) };
}

test('Shopify-only domain allowlist rejects URL, SSRF, port and attacker suffix', () => {
  assert.equal(normalizeShop(SHOP), SHOP);
  for (const s of ['http://'+SHOP, SHOP+'.attacker.test', SHOP+':8080', SHOP+'/x', '127.0.0.1', ' myshop.myshopify.com']) {
    assert.throws(() => normalizeShop(s), { code: 'SHOP_INVALID' });
  }
});

test('one native enterprise workspace only, without Mini ERP fallback', () => {
  const f = fixture();
  assert.equal(f.service.status('session-a').commerceAuthority, 'Shopify');
  assert.equal(f.service.status('session-a').status, 'unbound');
  assert.throws(() => f.service.status('session-b'), { code: 'SESSION_REQUIRED' });
  assert.throws(() => f.service.begin('session-b', SHOP), { code: 'SESSION_REQUIRED' });
  f.store.close();
});

test('a real workspace session can see setup required without enabling an unconfigured binding', async () => {
  const service = createShopifyBindingService({ registry, store: null });
  const status = service.status('session-a');
  assert.equal(status.status, 'setup_required');
  assert.equal(status.commerceAuthority, 'Shopify');
  assert.equal(status.readOnly, true);
  assert.throws(() => service.status('unknown-session'), { code: 'SESSION_REQUIRED' });
  assert.throws(() => service.begin('session-a', SHOP), { code: 'SETUP_REQUIRED' });
  await assert.rejects(service.read('session-a'), { code: 'SETUP_REQUIRED' });
});

test('a configured workspace ID remains an isolation boundary even before setup is complete', () => {
  const service = createShopifyBindingService({ registry, store: null, enterpriseWorkspaceId: 'enterprise-a' });
  assert.equal(service.status('session-a').status, 'setup_required');
  assert.throws(() => service.status('session-b'), { code: 'SESSION_REQUIRED' });
});

test('a suggested shop only provides an allowed Admin destination and never counts as a binding', () => {
  const service = createShopifyBindingService({ registry, store: null, suggestedShopDomain: 'fixture-shop.myshopify.com' });
  const status = service.status('session-a');
  assert.equal(status.suggestedShop, 'fixture-shop.myshopify.com');
  assert.equal(status.status, 'setup_required');
  assert.equal(status.shop, null);
  assert.throws(() => createShopifyBindingService({ registry, suggestedShopDomain: 'fixture-shop.myshopify.com.evil.test' }), { code: 'SHOP_INVALID' });
});

test('OAuth verifies signed merchant callback, shop GID and encrypted credential storage', async () => {
  const f = fixture(); const { signed, result } = await connect(f);
  assert.equal(result.status, 'connected'); assert.equal(result.shop, SHOP);
  assert.equal(f.calls.length, 2);
  assert.ok(!JSON.stringify(f.store.get('enterprise-a')).includes('access-original-secret'));
  assert.ok(!JSON.stringify(f.store.get('enterprise-a')).includes('refresh-original-secret'));
  assert.ok(!JSON.stringify(f.service.status('session-a')).includes('access-original-secret'));
  await assert.rejects(f.service.finish(signed), { code: 'STATE_INVALID' });
  f.store.close();
});

test('rejects altered signature, wrong shop and expired timestamp; consumes state exactly once', async () => {
  const f = fixture(); const a = f.service.begin('session-a', SHOP);
  const tamper = callback(a, f.now()); tamper.set('shop', 'evil.myshopify.com');
  await assert.rejects(f.service.finish(tamper), { code: 'CALLBACK_SIGNATURE' });
  const wrong = callback(a, f.now(), { shop: 'other.myshopify.com' });
  await assert.rejects(f.service.finish(wrong), { code: 'STATE_INVALID' });
  const b = f.service.begin('session-a', SHOP);
  const expired = callback(b, f.now(), { timestamp: String(Math.floor(f.now()/1000) - 800) });
  await assert.rejects(f.service.finish(expired), { code: 'CALLBACK_EXPIRED' });
  f.store.close();
});

test('rejects cross-workspace store and a second store, even after uninstall', async () => {
  const f = fixture(); await connect(f);
  assert.throws(() => f.service.begin('session-a', 'second.myshopify.com'), { code: 'WORKSPACE_ALREADY_BOUND' });
  assert.throws(() => f.store.start('enterprise-b', 'session-b', SHOP, 'a'.repeat(64), f.now()), { code: 'SHOP_ALREADY_BOUND' });
  f.store.uninstall(SHOP, 'event-0001', f.now());
  assert.throws(() => f.store.start('enterprise-b', 'session-b', SHOP, 'b'.repeat(64), f.now()), { code: 'SHOP_ALREADY_BOUND' });
  f.store.close();
});

test('live read contract is allowlisted and refreshes expiring offline token without inventing orders', async () => {
  const f = fixture(); await connect(f);
  const identity = await f.service.read('session-a');
  assert.equal(identity.shopGid, shop.id);
  const products = await f.service.read('session-a', 'products');
  assert.equal(products.products[0].title, 'Synthetic Item');
  await assert.rejects(f.service.read('session-a', 'orders'), { code: 'RESOURCE_DENIED' });
  f.advance(3_600_000);
  assert.equal((await f.service.read('session-a')).shop, SHOP);
  assert.equal(f.store.tokens('enterprise-a').refreshToken, 'refresh-rotated-secret');
  assert.equal(f.calls.filter(x => x.url.endsWith('/oauth/access_token')).length, 2);
  f.store.close();
});

test('uninstall webhook signature and actual signed shop must match; revokes credentials', async () => {
  const f = fixture(); await connect(f);
  const raw = Buffer.from(JSON.stringify({ myshopify_domain: SHOP }));
  const signature = createHmac('sha256', SECRET).update(raw).digest('base64');
  assert.equal(verifyUninstall(raw, signature, SECRET), SHOP);
  assert.throws(() => verifyUninstall(Buffer.from('{}'), signature, SECRET), { code: 'WEBHOOK_SIGNATURE' });
  const app = createServer(createShopifyBindingHandler(f.service, { clientSecret: SECRET, authorize: async () => 0 }));
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  const headers = { 'x-shopify-hmac-sha256': signature, 'x-shopify-shop-domain': SHOP,
    'x-shopify-topic': 'app/uninstalled', 'x-shopify-webhook-id': 'event-0002' };
  try {
    assert.equal((await fetch(base + '/shopify-admin-binding/webhooks/app-uninstalled', {
      method: 'POST', headers: { ...headers, 'x-shopify-shop-domain': 'different.myshopify.com' }, body: raw })).status, 403);
    assert.equal((await fetch(base + '/shopify-admin-binding/webhooks/app-uninstalled', { method: 'POST', headers, body: raw })).status, 200);
    assert.equal((await fetch(base + '/shopify-admin-binding/webhooks/app-uninstalled', { method: 'POST', headers, body: raw })).status, 200);
    assert.equal(f.store.status('enterprise-a').status, 'uninstalled');
    await assert.rejects(f.service.read('session-a'), { code: 'SHOP_NOT_CONNECTED' });
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); f.store.close(); }
});

test('owner HTTP refuses anonymous, cross-origin and foreign enterprise session', async () => {
  const f = fixture();
  const app = createServer(createShopifyBindingHandler(f.service, { clientSecret: SECRET,
    authorize: async request => request.headers.authorization === 'Bearer test-owner' ? 0 : 401 }));
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  const endpoint = base + '/shopify-admin-binding/authorize';
  const body = JSON.stringify({ sessionId: 'session-a', shop: SHOP });
  const headers = { origin: base, 'content-type': 'application/json', authorization: 'Bearer test-owner' };
  try {
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, body })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, authorization: '' }, body })).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(base + '/shopify-admin-binding/status?sessionId=session-b', { headers })).status, 403);
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); f.store.close(); }
});
