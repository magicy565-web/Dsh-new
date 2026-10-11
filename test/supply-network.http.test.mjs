import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';

const TOKEN = 'sourcing-private-pilot-connector-credential-0001';
const digest = createHash('sha256').update(TOKEN).digest('hex');
const SHOP = 'fixture-supplier.myshopify.com';
const info = { shop: { id: 'gid://shopify/Shop/1', name: 'Fixture authorized store', myshopifyDomain: SHOP, currencyCode: 'USD' }, currentAppInstallation: { accessScopes: [{ handle: 'read_products' }] } };
const product = { id: 'gid://shopify/Product/11', title: 'Fixture wholesale pillow', handle: 'wholesale-pillow', vendor: 'Vendor display, not identity', status: 'ACTIVE', updatedAt: '2026-10-11T10:10:10Z', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/111', sku: 'PX-01', price: '12.50', inventoryQuantity: 0 }] } };
const response = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json', 'x-shopify-api-version': '2026-10' } });
async function fixture(t, { enabled = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-supply-'));
  const calls = [];
  let fake = (_url, input) => {
    const args = JSON.parse(input.body);
    if (args.query.includes('WorkspaceShop')) return response(info);
    if (args.query.includes('WorkspaceCatalog')) return response({ products: { nodes: [product], pageInfo: { hasNextPage: false, endCursor: null } } });
    throw Error('Unexpected external request');
  };
  const options = { dataDirectory: directory, provider: { kind: 'test-provider', configured: false, complete: async () => { throw Error('Model must not be called'); } },
    capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: SHOP, WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'fixture-private-admin-token' },
    shopifyFetch: async (...args) => { calls.push(args); return fake(...args); }, sourcingMcpConfig: { enabled, tokenDigest: digest } };
  let app = await createApp(options), address = await app.listen(0);
  const request = async (route, method = 'GET', body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const api = (route, method = 'GET', body, headers) => request(`/api/supply${route}`, method, body, headers);
  const command = () => ({ requestId: randomUUID() });
  const supplier = async () => { const result = await api('/suppliers', 'POST', { ...command(), displayName: 'Genuine Test Factory', country: 'China', website: 'https://factory.example' }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.supplier; };
  const listing = async supplierId => { const result = await api('/listings', 'POST', { ...command(), supplierId, title: 'Natural textile product', sku: 'T-100', unitPrice: '2.40', currency: 'USD', moq: 500, leadDays: 28, incoterm: 'FOB', details: '100% cotton fabric' }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.listing; };
  const mcp = (method, params, opts = {}) => request('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }, { Authorization: `Bearer ${opts.token ?? TOKEN}`, ...(opts.headers || {}) });
  const restart = async () => { await app.close(); app = await createApp(options); address = await app.listen(0); };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { api, request, command, supplier, listing, mcp, restart, calls, directory, handler: fn => { fake = fn; }, get app() { return app; } };
}

test('private supplier and listing cannot leak into read-only MCP until distinct explicit approvals', async t => {
  const f = await fixture(t), s = await f.supplier(), l = await f.listing(s.id);
  assert.deepEqual((await f.api('/public')).body.items, []);
  let seen = await f.mcp('tools/call', { name: 'workspace_supply_search', arguments: { query: 'cotton' } });
  assert.deepEqual(seen.body.result.structuredContent.items, []);
  assert.equal((await f.api(`/listings/${l.id}/publish`, 'POST', { ...f.command(), expectedRevision: l.revision, confirmed: true })).status, 409);
  const pubSupplier = await f.api(`/suppliers/${s.id}/publish`, 'POST', { ...f.command(), expectedRevision: s.revision, confirmed: true });
  assert.equal(pubSupplier.status, 200);
  assert.deepEqual((await f.api('/public')).body.items, []);
  const pubListing = await f.api(`/listings/${l.id}/publish`, 'POST', { ...f.command(), expectedRevision: l.revision, confirmed: true });
  assert.equal(pubListing.status, 200);
  seen = await f.mcp('tools/call', { name: 'workspace_supply_search', arguments: { query: 'cotton', limit: 10 } });
  assert.equal(seen.body.result.structuredContent.items.length, 1);
  const out = JSON.stringify(seen.body);
  assert.match(out, /merchant_declaration/);
  assert.match(out, /indicativeOnly/);
  assert.doesNotMatch(out, /fixture-private-admin-token|createdBy|requestId|Genuine-secret/);
  assert.equal(f.calls.length, 0, 'Published reads must not call Shopify or a model');
  const one = await f.mcp('tools/call', { name: 'workspace_supplier_profile', arguments: { supplierId: s.id } });
  assert.equal(one.body.result.structuredContent.listings.length, 1);
  const changes = await f.mcp('tools/call', { name: 'workspace_supply_changes' });
  assert.equal(changes.body.result.structuredContent.events.length, 2);
  assert.equal(changes.body.result.structuredContent.events[0].kind, 'listing.published');
  const inquiry = await f.api('/inquiries', 'POST', { ...f.command(), listingId: l.id, quantity: 700, destination: 'Seattle', notes: 'PRIVATE buyer intent 123' });
  assert.equal(inquiry.body.inquiry.status, 'draft');
  assert.equal(inquiry.body.inquiry.sentAt, null);
  assert.doesNotMatch(JSON.stringify((await f.mcp('tools/call', { name: 'workspace_supply_search' })).body), /PRIVATE buyer intent/);
  await f.restart();
  assert.equal((await f.api('/status')).body.supplierCount, 1);
  assert.equal((await f.mcp('tools/call', { name: 'workspace_supply_search' })).body.result.structuredContent.returned, 1);
});

test('all supply writes enforce revision, request-id idempotency, schema and exact publication consent', async t => {
  const f = await fixture(t), input = { ...f.command(), displayName: 'Factory Alpha', country: 'China' };
  const a = await f.api('/suppliers', 'POST', input);
  assert.equal(a.status, 201);
  const duplicate = await f.api('/suppliers', 'POST', input);
  assert.equal(duplicate.body.supplier.id, a.body.supplier.id);
  assert.equal((await f.api('/suppliers', 'POST', { ...input, displayName: 'A different name' })).body.error.code, 'SUPPLY_IDEMPOTENCY_CONFLICT');
  assert.equal((await f.api(`/suppliers/${a.body.supplier.id}/publish`, 'POST', { ...f.command(), expectedRevision: 1, confirmed: false })).status, 400);
  assert.equal((await f.api(`/suppliers/${a.body.supplier.id}/publish`, 'POST', { ...f.command(), expectedRevision: 2, confirmed: true })).body.error.code, 'SUPPLY_REVISION_CONFLICT');
  assert.equal((await f.api('/suppliers', 'POST', { ...f.command(), displayName: 'Bad', country: 'US', extra: { authToken: 'hidden' } })).status, 400);
  const l = await f.listing(a.body.supplier.id), change = { ...f.command(), expectedRevision: 1, unitPrice: '2.15' };
  assert.equal((await f.api(`/listings/${l.id}`, 'PATCH', change)).body.listing.revision, 2);
  assert.equal((await f.api(`/listings/${l.id}`, 'PATCH', change)).body.listing.revision, 2);
  assert.equal((await f.api(`/listings/${l.id}`, 'PATCH', { ...f.command(), expectedRevision: 1, unitPrice: '2.10' })).body.error.code, 'SUPPLY_REVISION_CONFLICT');
  assert.equal((await f.api(`/listings/${l.id}`, 'PATCH', { ...f.command(), expectedRevision: 2, unitPrice: '9e99' })).status, 400);
  assert.equal((await f.api('/suppliers', 'POST', { ...f.command(), displayName: 'X', country: 'US', website: 'http://insecure.example' })).status, 400);
  assert.equal((await f.api('/status', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
});

test('private MCP bearer is separate, disabled by default and has closed tool surfaces', async t => {
  const f = await fixture(t);
  const unauthorized = await f.request('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(unauthorized.status, 401);
  assert.equal((await f.mcp('tools/list', undefined, { token: 'wrong-token-with-enough-length-12345' })).status, 401);
  assert.equal((await f.mcp('tools/list', undefined, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const init = await f.mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-11-25');
  const list = await f.mcp('tools/list');
  assert.equal(list.body.result.tools.length, 3);
  assert.equal(list.body.result.tools.some(x => /upload|claim|write|publish|submit/.test(x.name)), false);
  assert.equal((await f.mcp('tools/call', { name: 'workspace_supply_search', arguments: { privateRecord: true } })).body.error.code, -32602);
  assert.equal((await f.mcp('tools/call', { name: 'workspace_supply_search', arguments: { query: 'a'.repeat(130) } })).body.result.isError, true);
  assert.equal((await f.mcp('something/destructive')).body.error.code, -32601);
  const privateOff = await fixture(t, { enabled: false });
  assert.equal((await privateOff.mcp('tools/list')).status, 404);
});

test('Shopify observed products are private store facts, not supplier IDs or export RFQs; duplicate request does not reread store', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/shopify/observe', 'POST', { ...f.command() })).body.error.code, 'SHOPIFY_PRODUCT_SCOPE_REQUIRED');
  const verified = await f.request('/api/commerce-shopify/verify', 'POST', {});
  assert.equal(verified.status, 200);
  const requestId = randomUUID(), observed = await f.api('/shopify/observe', 'POST', { requestId });
  assert.equal(observed.status, 200, JSON.stringify(observed.body));
  assert.equal(observed.body.observation.products[0].vendorLabel, product.vendor);
  assert.equal(observed.body.observation.products[0].variants[0].inventoryQuantity, 0);
  assert.equal((await f.api('/status')).body.shopifyObservation.count, 1);
  assert.deepEqual((await f.api('/public')).body.items, [], 'Shopify retail products must not become published supplier offers');
  assert.equal(f.calls.length, 2);
  const duplicate = await f.api('/shopify/observe', 'POST', { requestId });
  assert.equal(duplicate.status, 200);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.api('/shopify/observe', 'POST', { requestId, after: 'other-cursor' })).body.error.code, 'SUPPLY_IDEMPOTENCY_CONFLICT');
  assert.equal(f.calls.length, 2);
  assert.doesNotMatch(await readFile(path.join(f.directory, 'workspace.json'), 'utf8'), /fixture-private-admin-token/);
  await f.restart();
  const saved = await f.api('/shopify/observation');
  assert.equal(saved.body.observation.shopId, info.shop.id);
  assert.equal(saved.body.observation.publication, 'private');
  assert.equal((await f.api('/public')).body.items.length, 0);
});

test('malformed Shopify product response cannot persist partial observations', async t => {
  const f = await fixture(t);
  await f.request('/api/commerce-shopify/verify', 'POST', {});
  f.handler(() => response({ products: { nodes: [{ ...product, id: 'bad-product' }], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const bad = await f.api('/shopify/observe', 'POST', { ...f.command() });
  assert.equal(bad.status, 502);
  assert.equal(bad.body.error.code, 'SHOPIFY_CATALOG_INVALID');
  assert.equal((await f.api('/shopify/observation')).body.observation, null);
});

test('unpublishing a supplier cascades to offers and re-publishing does not accidentally resurrect them', async t => {
  const f = await fixture(t), s = await f.supplier(), l = await f.listing(s.id);
  const ps = (await f.api(`/suppliers/${s.id}/publish`, 'POST', { ...f.command(), expectedRevision: 1, confirmed: true })).body.supplier;
  await f.api(`/listings/${l.id}/publish`, 'POST', { ...f.command(), expectedRevision: 1, confirmed: true });
  assert.equal((await f.api('/public')).body.returned, 1);
  const stopped = await f.api(`/suppliers/${s.id}/unpublish`, 'POST', { ...f.command(), expectedRevision: ps.revision, confirmed: true });
  assert.equal(stopped.status, 200);
  assert.equal((await f.api('/public')).body.returned, 0);
  const revived = await f.api(`/suppliers/${s.id}/publish`, 'POST', { ...f.command(), expectedRevision: stopped.body.supplier.revision, confirmed: true });
  assert.equal(revived.status, 200);
  assert.equal((await f.api('/public')).body.returned, 0);
  const listing = (await f.api('/listings')).body.listings[0];
  assert.equal(listing.published, false);
  assert.equal(listing.revision, 3);
  assert.equal((await f.api(`/listings/${listing.id}/publish`, 'POST', { ...f.command(), expectedRevision: 3, confirmed: true })).status, 200);
  assert.equal((await f.api('/public')).body.returned, 1);
  const no = await f.api(`/listings/${listing.id}/unpublish`, 'POST', { ...f.command(), expectedRevision: 4, confirmed: true });
  assert.equal(no.status, 200);
  assert.equal((await f.api('/public')).body.returned, 0);
});

test('merchant featured offer and live price changes remain versioned declarations, not verified transactions', async t => {
  const f = await fixture(t), supplier = await f.supplier(), listing = await f.listing(supplier.id);
  await f.api(`/suppliers/${supplier.id}/publish`, 'POST', { ...f.command(), expectedRevision: 1, confirmed: true });
  await f.api(`/listings/${listing.id}/publish`, 'POST', { ...f.command(), expectedRevision: 1, confirmed: true });
  const update = await f.api(`/listings/${listing.id}`, 'PATCH', { ...f.command(), expectedRevision: 2, unitPrice: '2.20', featured: true });
  assert.equal(update.status, 200);
  assert.equal(update.body.listing.featured, true);
  assert.equal(update.body.listing.revision, 3);
  const published = (await f.api('/public')).body.items[0];
  assert.equal(published.unitPrice, '2.20');
  assert.equal(published.featured, true);
  assert.equal(published.indicativeOnly, true);
  assert.equal(published.verifiedTransaction, false);
  const changes = (await f.mcp('tools/call', { name: 'workspace_supply_changes' })).body.result.structuredContent.events;
  assert.equal(changes[0].kind, 'listing.updated');
  assert.equal(changes[0].unitPrice, undefined, 'Change feed metadata never exposes private price details');
  assert.equal((await f.api(`/listings/${listing.id}`, 'PATCH', { ...f.command(), expectedRevision: 3, featured: 'true' })).status, 400);
});
