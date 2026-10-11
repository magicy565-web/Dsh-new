import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

// Original Store, access audit, signed ingress, sessions and real loopback HTTP.
// Disposable synthetic identities/bearer only; no real buyer, merchant or model.
const publicOrigin = 'https://tt041-acceptance.example';
const bearer = 'tt041-synthetic-private-buyer-read-0123456789';
const digest = text => createHash('sha256').update(text).digest('hex');
const command = () => ({ requestId: randomUUID() });
async function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'tt041-pr28-http-'));
  const pair = generateKeyPairSync('ed25519');
  const access = { mode: 'enterprise', publicOrigin, workspaceId: 'tt041-single-enterprise',
    issuer: 'synthetic-ingress', keyId: 'synthetic-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    members: [{ subject: 'merchant-admin', role: 'admin' }, { subject: 'business-operator', role: 'operator' },
      { subject: 'reader', role: 'viewer' }] };
  let modelCalls = 0, app, address;
  const options = { dataDirectory: directory, access, capabilityEnvironment: {},
    sourcingMcpConfig: { enabled: true, tokenDigest: digest(bearer) },
    provider: { kind: 'synthetic-unavailable', configured: false, complete() { modelCalls++; throw Error('No real model authorized'); } },
    shopifyFetch() { throw Error('No Shopify request authorized'); } };
  async function open() { app = await createApp(options); address = await app.listen(0); }
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith('tt041-pr28-http-'));
    await rm(directory, { recursive: true, force: true });
  });
  await open();
  async function raw(route, method = 'GET', body, headers = {}) {
    const bytes = body === undefined ? '' : JSON.stringify(body);
    const response = await new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${address.port}${route}`, { method,
        headers: { Host: 'tt041-acceptance.example', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } },
      response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
      request.on('error', reject); request.end(bytes);
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function api(route, { method = 'GET', body, subject = 'merchant-admin', session, headers = {} } = {}) {
    const bytes = body === undefined ? '' : JSON.stringify(body);
    return raw(route, method, body, { ...(['GET', 'HEAD'].includes(method) ? {} : { Origin: publicOrigin }),
      'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, subject, method, target: route, body: bytes }),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...headers });
  }
  async function login(subject = 'merchant-admin') {
    const result = await api('/api/session/login', { method: 'POST', body: {}, subject, headers: { 'X-Workspace-Login': '1' } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return { cookie: result.cookie, csrfToken: result.body.csrfToken };
  }
  let admin = await login();
  const supply = (route, method = 'GET', body) => api('/api/supply' + route, { method, body, session: admin });
  const supplier = async name => {
    const result = await supply('/suppliers', 'POST', { ...command(), displayName: name || 'Synthetic merchant', country: 'China' });
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.supplier;
  };
  const listingInput = supplierId => ({ ...command(), supplierId, title: 'Approved declaration', sku: 'DECLARED-SKU',
    unitPrice: '2.40', currency: 'USD', moq: 100, leadDays: 10, incoterm: 'FOB', details: 'Explicit public synthetic material' });
  const listing = async supplierId => {
    const result = await supply('/listings', 'POST', listingInput(supplierId));
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.listing;
  };
  const mcp = (name, args) => raw('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name, arguments: args || {} } }, { Authorization: 'Bearer ' + bearer });
  return { api, raw, supply, supplier, listing, listingInput, login, mcp, directory,
    get app() { return app; }, modelCalls: () => modelCalls,
    async restart() { await app.close(); await open(); admin = await login(); } };
}

test('buyer MCP credential cannot read private demand/product data or become a merchant browser session', async t => {
  const f = await fixture(t), supplier = await f.supplier(), listing = await f.listing(supplier.id);
  await f.app.businessLibrary.createProduct({ ...command(), name: 'PRIVATE_ENTERPRISE_PRODUCT', description: 'PRIVATE_SUPPLY_FLOOR' },
    { subject: 'merchant-admin', role: 'admin' });
  const inquiry = await f.supply('/inquiries', 'POST', { ...command(), listingId: listing.id, quantity: 200,
    destination: 'Synthetic destination', notes: 'PRIVATE_BUYER_INTENT' });
  assert.equal(inquiry.status, 201);
  for (const route of ['/api/supply/inquiries', '/api/library/products', '/api/worker-orders']) {
    const denied = await f.raw(route, 'GET', undefined, { Authorization: 'Bearer ' + bearer });
    assert.equal(denied.status, 401); assert.equal(denied.body.error.code, 'AUTH_REQUIRED');
  }
  assert.equal((await f.mcp('workspace_supply_search')).body.result.structuredContent.returned, 0);
  await f.supply(`/suppliers/${supplier.id}/publish`, 'POST', { ...command(), expectedRevision: 1, confirmed: true });
  await f.supply(`/listings/${listing.id}/publish`, 'POST', { ...command(), expectedRevision: 1, confirmed: true });
  for (const [name, args] of [['workspace_supply_search', {}], ['workspace_supplier_profile', { supplierId: supplier.id }],
    ['workspace_supply_changes', {}]]) {
    const result = await f.mcp(name, args);
    assert.equal(result.status, 200);
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|createdBy|requestId|commands|inquiries/);
  }
  assert.equal(f.modelCalls(), 0);
});

test('publication requires explicit current revisions and duplicate historic consent cannot undo revocation after restart', async t => {
  const f = await fixture(t), supplier = await f.supplier(), listing = await f.listing(supplier.id);
  assert.equal((await f.supply(`/suppliers/${supplier.id}/publish`, 'POST', { ...command(), expectedRevision: 1, confirmed: false })).status, 400);
  assert.equal((await f.supply(`/listings/${listing.id}/publish`, 'POST', { ...command(), expectedRevision: 1, confirmed: true })).status, 409);
  const approval = { ...command(), expectedRevision: 1, confirmed: true };
  await f.supply(`/suppliers/${supplier.id}/publish`, 'POST', approval);
  await f.supply(`/listings/${listing.id}/publish`, 'POST', { ...command(), expectedRevision: 1, confirmed: true });
  await f.supply(`/suppliers/${supplier.id}/unpublish`, 'POST', { ...command(), expectedRevision: 2, confirmed: true });
  await f.restart();
  assert.equal((await f.supply(`/suppliers/${supplier.id}/publish`, 'POST', approval)).status, 200, 'Exact historic receipt can replay');
  assert.equal((await f.mcp('workspace_supply_search')).body.result.structuredContent.returned, 0, 'Receipt replay cannot republish revoked records');
  assert.equal((await f.supply(`/suppliers/${supplier.id}/publish`, 'POST', { ...command(), expectedRevision: 2, confirmed: true })).status, 409);
  assert.equal(f.app.store.read().supplyNetwork.listings[0].published, false);
});

test('supplier-local SKU uniqueness cannot silently become ownership of another supplier or enterprise product', async t => {
  const f = await fixture(t), a = await f.supplier('Synthetic A'), b = await f.supplier('Synthetic B');
  const first = await f.listing(a.id), second = await f.listing(b.id);
  assert.notEqual(first.id, second.id); assert.equal(first.sku, second.sku);
  assert.equal((await f.supply('/listings', 'POST', f.listingInput(a.id))).body.error.code, 'SUPPLY_SKU_EXISTS');
  for (const fields of [{ supplierId: b.id }, { productId: randomUUID() }, { merchantId: 'another-enterprise' }])
    assert.equal((await f.supply(`/listings/${first.id}`, 'PATCH', { ...command(), expectedRevision: 1, ...fields })).status, 400);
  await f.restart(); assert.equal(f.app.store.read().supplyNetwork.listings.find(x => x.id === first.id).supplierId, a.id);
  assert.equal(f.app.supply.status().multiTenant, false, 'This is explicitly a shared-enterprise pilot, not merchant isolation');
});

test('current buyer transport is read-only and internal inquiry draft is not a named-merchant delivery or reply', async t => {
  const f = await fixture(t), supplier = await f.supplier(), listing = await f.listing(supplier.id);
  const list = await f.raw('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { Authorization: 'Bearer ' + bearer });
  assert.deepEqual(list.body.result.tools.map(x => x.name), ['workspace_supply_search', 'workspace_supplier_profile', 'workspace_supply_changes']);
  const input = { ...command(), listingId: listing.id, quantity: 200, destination: 'Synthetic destination', notes: 'Private intent' };
  const first = await f.supply('/inquiries', 'POST', input); await f.restart();
  const again = await f.supply('/inquiries', 'POST', input);
  assert.equal(first.body.inquiry.id, again.body.inquiry.id); assert.equal(f.app.store.read().supplyNetwork.inquiries.length, 1);
  assert.equal(again.body.inquiry.listingRevision, 1); assert.equal(again.body.inquiry.status, 'draft');
  assert.equal(again.body.inquiry.sentAt, null); assert.equal(again.body.inquiry.publishedAt, null);
  assert.equal(Object.hasOwn(again.body.inquiry, 'recipientId'), false);
  const injected = await f.mcp('workspace_supply_search', { recipientId: supplier.id, notes: 'Private intent' });
  assert.equal(injected.body.error.code, -32602);
  assert.equal(f.app.store.read().workerOrders?.length || 0, 0);
  // Passing this containment test does not establish buyer submission/share/reply.
});

test('viewer and unlisted subject cannot authorize publication or read through another subject session', async t => {
  const f = await fixture(t), supplier = await f.supplier(), viewer = await f.login('reader');
  assert.equal((await f.api(`/api/supply/suppliers/${supplier.id}/publish`, { subject: 'reader', session: viewer,
    method: 'POST', body: { ...command(), expectedRevision: 1, confirmed: true } })).status, 403);
  assert.equal((await f.api('/api/supply/inquiries', { subject: 'outside-buyer', session: viewer })).status, 403);
  assert.equal((await f.api('/api/supply/inquiries', { subject: 'business-operator', session: viewer })).body.error.code, 'SESSION_REQUIRED');
  const health = await f.api('/api/health', { subject: 'reader', session: viewer });
  assert.equal(health.status, 200); assert.equal(health.body.provider.onlineVerified, false); assert.equal(health.body.storage.liveWriteProbe, false);
  assert.equal((await f.raw('/api/health')).status, 401);
});

test('original conversation product references persist exact revisions across restart and never silently adopt changed private data', async t => {
  const f = await fixture(t); let session = await f.login();
  const product = await f.api('/api/library/products', { session, method: 'POST',
    body: { ...command(), name: 'Private original product', description: 'PRIVATE_REFERENCE_VERSION_ONE' } });
  assert.equal(product.status, 201); const productId = product.body.product.id;
  const conversation = await f.api('/api/conversations', { session, method: 'POST', body: { title: 'Original resource context' } });
  assert.equal(conversation.status, 201); const conversationId = conversation.body.conversation.id;
  const selected = { ...command(), expectedRevision: 0, references: { products: [{ productId, productRevision: 1 }], documents: [] } };
  const saved = await f.api(`/api/conversations/${conversationId}/library-references`, { session, method: 'PATCH', body: selected });
  assert.equal(saved.status, 200); assert.equal(saved.body.libraryReferences.revision, 1);
  await f.restart(); session = await f.login();
  const read = await f.api(`/api/conversations/${conversationId}/library-references`, { session });
  assert.deepEqual(read.body.libraryReferences.products, [{ productId, productRevision: 1 }]);
  await f.api(`/api/library/products/${productId}`, { session, method: 'PATCH',
    body: { ...command(), expectedRevision: 1, changes: { description: 'PRIVATE_REFERENCE_VERSION_TWO' } } });
  const retry = await f.api(`/api/conversations/${conversationId}/library-references`, { session, method: 'PATCH', body: selected });
  assert.equal(retry.status, 200); assert.equal(retry.body.libraryReferences.products[0].productRevision, 1);
  assert.equal(retry.body.resolution.products[0].status, 'updated'); assert.equal(retry.body.resolution.products[0].currentRevision, 2);
  assert.equal((await f.mcp('workspace_supply_search')).body.result.structuredContent.returned, 0);
  assert.equal(f.modelCalls(), 0);
});

test('REGRESSION: authenticated business operator can create a listing allowed by the original Supply service', async t => {
  const f = await fixture(t), supplier = await f.supplier(), session = await f.login('business-operator');
  const result = await f.api('/api/supply/listings', { subject: 'business-operator', session, method: 'POST', body: f.listingInput(supplier.id) });
  assert.equal(result.status, 201, JSON.stringify(result.body));
});

test('REGRESSION: an unavailable explicit Muse selection cannot silently become a normal text Runtime run', async t => {
  const f = await fixture(t), session = await f.login();
  const created = await f.api('/api/conversations', { session, method: 'POST', body: { title: 'Synthetic original business request' } });
  assert.equal(created.status, 201); const conversationId = created.body.conversation.id;
  const result = await f.api(`/api/conversations/${conversationId}/messages`, { session, method: 'POST', body: {
    provider: 'muse', conversationId, requestId: 'tt041-explicit-muse-no-fallback', content: 'Explicit synthetic Muse request',
    order: { serviceId: 'channel-validation', product: 'Explicit public synthetic product', market: 'US',
      objective: 'Offline routing acceptance only', budgetCredits: 5,
      deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true } } });
  assert.ok(result.status >= 400, 'Unavailable Muse must be rejected explicitly; observed ' + JSON.stringify(result));
  assert.equal(f.app.store.read().runs.length, 0, 'Muse selection must not admit a replacement text run');
  assert.equal(f.modelCalls(), 0);
});

test('REGRESSION: authenticated business operator can create an internal inquiry allowed by the original Supply service', async t => {
  const f = await fixture(t), supplier = await f.supplier(), listing = await f.listing(supplier.id), session = await f.login('business-operator');
  const result = await f.api('/api/supply/inquiries', { subject: 'business-operator', session, method: 'POST',
    body: { ...command(), listingId: listing.id, quantity: 200, destination: 'Synthetic destination', notes: 'Private intent' } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
});
