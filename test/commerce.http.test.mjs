import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { createShopifyClient } from '../server/shopify.mjs';
import { normalizeShopifyOrder } from '../server/commerce.mjs';

// Shopify and model returns below are synthetic protocol fixtures. The app,
// HTTP boundary, durable transactions and restart are real; no live store is called.
const SHOP = 'fixture-store.myshopify.com', TOKEN = 'synthetic-server-only-admin-token';
const info = { shop: { id: 'gid://shopify/Shop/1', name: 'Fixture shop', myshopifyDomain: SHOP, currencyCode: 'USD' }, currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }, { handle: 'read_products' }] } };
const response = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json', 'x-shopify-api-version': '2026-10' } });
const order = (id, overrides = {}) => ({ id: `gid://shopify/Order/${id}`, name: `#${id}`, createdAt: '2026-10-10T12:00:01Z', updatedAt: '2026-10-10T12:01:00Z', test: false, cancelledAt: null, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', totalReceivedSet: { shopMoney: { amount: '10.10', currencyCode: 'USD' } }, totalRefundedSet: { shopMoney: { amount: '0.10', currencyCode: 'USD' } }, ...overrides });
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'commerce-http-')), calls = [];
  let handler = options.handler || (() => response(info));
  const opts = { dataDirectory: dir, accessClock: () => Date.parse('2026-10-10T12:00:00Z'), provider: { kind: 'synthetic-model-fixture', configured: false },
    capabilityEnvironment: options.configured === false ? {} : { WORKSPACE_SHOPIFY_SHOP_DOMAIN: SHOP, WORKSPACE_SHOPIFY_ADMIN_TOKEN: TOKEN },
    shopifyFetch: async (url, input) => { calls.push({ url, headers: input.headers, redirect: input.redirect, body: JSON.parse(input.body) }); return handler(url, input); } };
  let app = await createApp(opts), address = await app.listen(0);
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (route, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${address.port}/api${route}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const product = async (extra = {}) => { const saved = await api('/library/products', 'POST', { requestId: randomUUID(), name: 'Enterprise textile', description: 'PRIVATE original description', ...extra }); assert.equal(saved.status, 201, JSON.stringify(saved.body)); return saved.body.product; };
  const project = async (p, extra = {}) => {
    const body = { requestId: randomUUID(), confirmed: true, productId: p.id, productRevision: p.revision, publicDescription: 'Approved public textile facts', market: 'USA', objective: 'Find sourced distributors and validate real orders', budget: { amount: '100.00', currency: 'USD' }, durationDays: 30, validationOrderTarget: 3, ...extra };
    return { result: await api('/commerce-projects', 'POST', body), body };
  };
  return { api, product, project, calls, dir, get app() { return app; }, handler(fn) { handler = fn; }, async restart() { await app.close(); app = await createApp(opts); address = await app.listen(0); } };
}

test('hosting binds the exact enterprise product revision, saves atomically and never invokes a model or Shopify', async t => {
  const f = await fixture(t), p = await f.product(), { result, body } = await f.project(p);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.project.productRevision, p.revision);
  assert.equal(result.body.project.status, 'draft');
  assert.equal(result.body.project.results.billableAmount, null);
  assert.equal(f.calls.length, 0);
  assert.equal(f.app.store.read().goals.length, 0);
  const duplicate = await f.api('/commerce-projects', 'POST', body);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.project.id, result.body.project.id);
  assert.equal((await f.api('/commerce-projects', 'POST', { ...body, market: 'UK' })).status, 409);
  assert.equal((await f.api('/commerce-projects', 'POST', { ...body, requestId: randomUUID(), productRevision: 99 })).body.error.code, 'REVISION_CONFLICT');
  assert.equal((await f.api('/commerce-projects', 'POST', { ...body, requestId: randomUUID(), credentials: 'client-secret' })).status, 400);
  assert.equal((await f.api('/commerce-projects', 'POST', { ...body, requestId: randomUUID(), confirmed: false })).status, 400);
  const archived = await f.product({ name: 'Archived product', status: 'archived' });
  assert.equal((await f.project(archived)).result.body.error.code, 'PRODUCT_NOT_AVAILABLE');
  await f.restart();
  assert.equal((await f.api('/commerce-projects')).body.projects.length, 1);
  assert.equal((await f.api('/commerce-projects')).body.projects[0].id, result.body.project.id);
});

test('research staging reuses one real draft goal and exports only the specifically approved product facts', async t => {
  const f = await fixture(t), p = await f.product(), { result } = await f.project(p), id = result.body.project.id;
  const body = { requestId: randomUUID(), confirmed: true };
  const first = await f.api(`/commerce-projects/${id}/stage-research`, 'POST', body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const goalId = first.body.project.researchGoalId;
  assert.equal(f.app.store.read().goals.length, 1);
  assert.equal(f.app.store.read().goals[0].status, 'draft');
  assert.match(f.app.store.read().goals[0].description, /Approved public textile facts/);
  assert.doesNotMatch(f.app.store.read().goals[0].description, /PRIVATE|synthetic-server-only|priceTiers/);
  await f.restart();
  const replay = await f.api(`/commerce-projects/${id}/stage-research`, 'POST', body);
  assert.equal(replay.body.project.researchGoalId, goalId);
  assert.equal(replay.body.duplicate, true);
  assert.equal(f.app.store.read().goals.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.app.store.read().runs.length, 0);
});

test('an interrupted research link is repaired using the same runtime goal request instead of creating a second goal', async t => {
  const f = await fixture(t), { result } = await f.project(await f.product()), id = result.body.project.id;
  await f.api(`/commerce-projects/${id}/stage-research`, 'POST', { requestId: randomUUID(), confirmed: true });
  const goalId = f.app.store.read().goals[0].id;
  await f.app.store.update(state => { state.commerceProjects[0].researchGoalId = null; state.commerceProjects[0].status = 'research_preparing'; });
  await f.restart();
  const repaired = await f.api(`/commerce-projects/${id}/stage-research`, 'POST', { requestId: randomUUID(), confirmed: true });
  assert.equal(repaired.status, 200, JSON.stringify(repaired.body));
  assert.equal(repaired.body.project.researchGoalId, goalId);
  assert.equal(f.app.store.read().goals.length, 1);
});

test('Shopify status distinguishes configuration and a real identity response; tokens and arbitrary endpoints stay server-side', async t => {
  const f = await fixture(t);
  const status = await f.api('/commerce-status');
  assert.equal(status.body.shopify.status, 'configured_unverified');
  assert.equal(status.body.cloudComputer.executionAvailable, false);
  assert.equal(status.body.settlement.automaticCharge, false);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.api('/commerce-shopify/verify', 'POST', {})).body.shopify.status, 'verified');
  assert.equal(f.calls[0].url, `https://${SHOP}/admin/api/2026-10/graphql.json`);
  assert.equal(f.calls[0].headers['X-Shopify-Access-Token'], TOKEN);
  assert.equal(f.calls[0].redirect, 'error');
  assert.equal(JSON.stringify((await f.api('/bootstrap')).body).includes(TOKEN), false);
  assert.equal((await readFile(path.join(f.dir, 'workspace.json'), 'utf8')).includes(TOKEN), false);
  assert.equal((await f.api('/commerce-shopify/verify', 'POST', { endpoint: 'https://other.example' })).status, 400);
  f.handler(() => response({ ...info, shop: { ...info.shop, myshopifyDomain: 'other.myshopify.com' } }));
  assert.equal((await f.api('/commerce-shopify/verify', 'POST', {})).body.error.code, 'SHOPIFY_IDENTITY_MISMATCH');
  assert.equal((await f.api('/commerce-status')).body.shopify.status, 'configured_unverified');
  await f.restart();
  assert.equal((await f.api('/commerce-status')).body.shopify.verifiedAt, null);
});

test('order evidence pages are durable and retry-safe; tests, cancellations, partial payment and refunds cannot inflate sales', async t => {
  const f = await fixture(t), { result } = await f.project(await f.product()), id = result.body.project.id, tag = `workspace-project-${id}`;
  await f.api('/commerce-shopify/verify', 'POST', {});
  f.handler((_url, input) => {
    const query = JSON.parse(input.body);
    if (query.query.includes('WorkspaceShop')) return response(info);
    const second = !!query.variables.after;
    assert.match(query.variables.query, new RegExp(`tag:${tag}`));
    assert.equal(/email|shippingAddress|customer|mutation/iu.test(query.query), false);
    return response({ orders: { nodes: (second ? [order(5, { displayFinancialStatus: 'REFUNDED', totalRefundedSet: { shopMoney: { amount: '10.10', currencyCode: 'USD' } } })] : [order(1), order(2, { test: true }), order(3, { cancelledAt: '2026-10-10T12:00:02Z' }), order(4, { displayFinancialStatus: 'PARTIALLY_PAID' })]).map(row => ({ ...row, tags: [tag] })), pageInfo: { hasNextPage: !second, endCursor: second ? 'last-page' : 'page-two' } } });
  });
  const key = randomUUID(), first = await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: key, confirmed: true });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.project.results.complete, false);
  assert.equal(first.body.project.results.observedOrders, 4);
  assert.equal(first.body.project.results.paidFulfilledOrders, 1);
  assert.deepEqual(first.body.project.results.netReceipts, [{ currency: 'USD', amount: '10' }]);
  assert.equal(first.body.project.results.billableAmount, null);
  const count = f.calls.length;
  const replay = await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: key, confirmed: true });
  assert.equal(replay.body.duplicate, true);
  assert.equal(f.calls.length, count, 'unknown-response retry does not advance the cursor');
  await f.restart(); await f.api('/commerce-shopify/verify', 'POST', {});
  const next = await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true });
  assert.equal(next.body.project.results.complete, true);
  assert.equal(next.body.project.results.observedOrders, 5);
  assert.equal(next.body.project.results.paidFulfilledOrders, 1);
  assert.equal(f.calls.at(-1).body.variables.after, 'page-two');
  assert.equal(JSON.stringify(next.body).includes('tags'), false, 'unrelated store tags never enter the evidence record');
  f.handler(() => response({ orders: { nodes: [{ ...order(1, { displayFinancialStatus: 'REFUNDED', totalRefundedSet: { shopMoney: { amount: '10.10', currencyCode: 'USD' } } }), tags: [tag] }], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const refreshed = await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true });
  assert.equal(f.calls.at(-1).body.variables.after, null, 'a completed refresh rebuilds the evidence from the first page');
  assert.equal(refreshed.body.project.results.observedOrders, 1);
  assert.equal(refreshed.body.project.results.paidFulfilledOrders, 0);
  assert.deepEqual(refreshed.body.project.results.netReceipts, [], 'a later refund cannot keep old receipts in the current result');
});

test('malformed, out-of-scope, unauthenticated, or unavailable store reads preserve previous evidence and never produce fake zero-sales results', async t => {
  const f = await fixture(t), { result } = await f.project(await f.product()), id = result.body.project.id;
  assert.equal((await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true })).body.error.code, 'SHOPIFY_ORDER_SCOPE_REQUIRED');
  await f.api('/commerce-shopify/verify', 'POST', {});
  f.handler(() => response({ orders: { nodes: [{ ...order(1), tags: [`workspace-project-${id}`] }], pageInfo: { hasNextPage: false, endCursor: null } } }));
  assert.equal((await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true })).status, 200);
  const before = f.app.store.read().commerceProjects[0].orderEvidence;
  f.handler(() => response({ orders: { nodes: [{ ...order(1), tags: ['another-project'] }], pageInfo: { hasNextPage: false, endCursor: null } } }));
  assert.equal((await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true })).body.error.code, 'SHOPIFY_ORDER_SCOPE_MISMATCH');
  assert.deepEqual(f.app.store.read().commerceProjects[0].orderEvidence, before, 'failed reads preserve actual prior receipts');
  f.handler(() => new Response('secret error payload', { status: 401 }));
  const rejected = await f.api('/commerce-shopify/verify', 'POST', {});
  assert.equal(rejected.body.error.code, 'SHOPIFY_AUTH_REJECTED');
  assert.doesNotMatch(JSON.stringify(rejected.body), /secret error payload/);
  assert.equal((await f.api('/commerce-status')).body.shopify.status, 'configured_unverified');
  const absent = await fixture(t, { configured: false });
  assert.equal((await absent.api('/commerce-shopify/verify', 'POST', {})).body.error.code, 'SHOPIFY_SETUP_REQUIRED');
  assert.equal(absent.calls.length, 0);
});

test('history windows, pagination loops, arbitrary hosts and currency mismatches fail closed', async () => {
  let calls = 0;
  const bad = createShopifyClient({ environment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'http://127.0.0.1', WORKSPACE_SHOPIFY_ADMIN_TOKEN: TOKEN }, fetchImpl: () => { calls++; } });
  await assert.rejects(bad.verify(), { code: 'SHOPIFY_SETUP_REQUIRED' });
  assert.equal(calls, 0);
  const old = createShopifyClient({ environment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: SHOP, WORKSPACE_SHOPIFY_ADMIN_TOKEN: TOKEN }, clock: () => Date.parse('2026-10-10'), fetchImpl: async () => response(info) });
  await old.verify();
  await assert.rejects(old.readProjectOrders({ projectId: randomUUID(), createdAt: '2026-01-01' }), { code: 'SHOPIFY_ORDER_HISTORY_SCOPE_REQUIRED' });
  const loop = createShopifyClient({ environment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: SHOP, WORKSPACE_SHOPIFY_ADMIN_TOKEN: TOKEN }, clock: () => Date.parse('2026-10-10'), fetchImpl: async (_url, input) => response(JSON.parse(input.body).query.includes('WorkspaceShop') ? info : { orders: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same-cursor' } } }) });
  await loop.verify();
  await assert.rejects(loop.readProjectOrders({ projectId: randomUUID(), after: 'same-cursor', createdAt: '2026-10-09' }), { code: 'SHOPIFY_RESPONSE_INVALID' });
  assert.throws(() => normalizeShopifyOrder(order(1, { totalRefundedSet: { shopMoney: { amount: '0', currencyCode: 'EUR' } } }), '2026-10-10'), { code: 'SHOPIFY_ORDER_INVALID' });
  assert.throws(() => normalizeShopifyOrder(order(1, { totalReceivedSet: { shopMoney: { amount: 'NaN', currencyCode: 'USD' } } }), '2026-10-10'), { code: 'SHOPIFY_MONEY_INVALID' });
});

test('a changed verified shop identity cannot merge into earlier order evidence even on the same configured domain', async t => {
  const f = await fixture(t), { result } = await f.project(await f.product()), id = result.body.project.id;
  await f.api('/commerce-shopify/verify', 'POST', {});
  f.handler(() => response({ orders: { nodes: [{ ...order(1), tags: [`workspace-project-${id}`] }], pageInfo: { hasNextPage: false, endCursor: null } } }));
  assert.equal((await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true })).status, 200);
  const before = f.app.store.read().commerceProjects[0].orderEvidence;
  f.handler((_url, input) => response(JSON.parse(input.body).query.includes('WorkspaceShop') ? { ...info, shop: { ...info.shop, id: 'gid://shopify/Shop/2' } } : { orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }));
  await f.api('/commerce-shopify/verify', 'POST', {});
  assert.equal((await f.api(`/commerce-projects/${id}/sync-orders`, 'POST', { requestId: randomUUID(), confirmed: true })).body.error.code, 'SHOPIFY_STORE_CHANGED');
  assert.deepEqual(f.app.store.read().commerceProjects[0].orderEvidence, before);
});

test('v2 upgrade preserves mainline Worker, expert, Dot and custom records while adding real libraries', async t => {
  const f = await fixture(t), saved = f.app.store.read();
  await f.app.close();
  saved.version = 2; delete saved.businessLibrary;
  for (const key of ['workerOrders', 'workerOpportunities', 'cloudExperts', 'cloudTeams', 'dotTasks']) saved[key] = [{ id: `${key}-fixture`, preserved: true }];
  saved.dotLastSeenAt = '2026-10-10T12:00:00Z'; saved.customExtension = { preserved: true };
  const original = JSON.stringify(saved, null, 2);
  await writeFile(path.join(f.dir, 'workspace.json'), original);
  await f.restart();
  assert.equal(f.app.store.read().version, 3);
  assert.equal((await f.api('/library/products')).body.items.length, 0);
  assert.equal(await readFile(path.join(f.dir, 'workspace.v2.backup.json'), 'utf8'), original);
  for (const key of ['workerOrders', 'workerOpportunities', 'cloudExperts', 'cloudTeams', 'dotTasks']) assert.equal(f.app.store.read()[key][0].preserved, true);
  assert.equal(f.app.store.read().dotLastSeenAt, saved.dotLastSeenAt);
  assert.equal(f.app.store.read().customExtension.preserved, true);
});
