import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { createSupplierOwnerMcpBinding } from '../server/supplier-mcp.mjs';
const DAY = 86400000;
const product = 'gid://shopify/Product/123', variant = 'gid://shopify/ProductVariant/1001';
const shopId = 'gid://shopify/Shop/1';
const line = (id, quantity, currentQuantity, productId = product, variantId = variant) => ({ id: `gid://shopify/LineItem/${id}`, quantity, currentQuantity, product: { id: productId }, variant: { id: variantId } });
const order = (id, lines, { cancelled = false, test = false, refunds = [] } = {}) => ({ id: `gid://shopify/Order/${id}`, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z', test, cancelledAt: cancelled ? '2026-10-14T10:00:00Z' : null, lineItems: { nodes: lines, pageInfo: { hasNextPage: false } }, refunds });
const refund = (id, lineId, quantity) => ({ id: `gid://shopify/Refund/${id}`, createdAt: '2026-10-20T10:00:00Z', refundLineItems: { nodes: [{ lineItem: { id: `gid://shopify/LineItem/${lineId}` }, quantity }], pageInfo: { hasNextPage: false } } });
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-supplier-orders-');
  let time = Date.parse('2026-10-20T10:00:00Z'), calls = [], rows = [], truncated = false, denied = false, deferred = false, requestStarted;
  const fetchImpl = async (url, input) => {
    assert.equal(url, 'https://fixture-shop.myshopify.com/admin/api/2026-10/graphql.json');
    const { query, variables } = JSON.parse(input.body); calls.push({ query, variables });
    if (denied) return new Response('Denied synthetic fixture', { status: 403 });
    let data;
    if (query.includes('WorkspaceShop')) data = { shop: { id: shopId, name: 'Actual local API fixture', myshopifyDomain: 'fixture-shop.myshopify.com', currencyCode: 'USD' }, currentAppInstallation: { accessScopes: (options.scopes || ['read_products', 'read_orders']).map(handle => ({ handle })) } };
    else if (query.includes('WorkspaceSupplierProduct')) data = { product: { id: product, title: 'Fixture', status: 'ACTIVE', publishedAt: '2026-10-12T09:00:00Z', onlineStoreUrl: 'https://fixture-shop.myshopify.com/products/fixture', variants: { nodes: [{ id: variant, sku: 'fixture' }, { id: 'gid://shopify/ProductVariant/1002', sku: 'other' }], pageInfo: { hasNextPage: false } } } };
    else if (query.includes('WorkspaceSupplierOrders')) {
      if (deferred) { deferred = false; requestStarted?.(); await new Promise((resolve, reject) => { if (input.signal.aborted) reject(Error('Synthetic request aborted')); else input.signal.addEventListener('abort', () => reject(Error('Synthetic request aborted')), { once: true }); }); }
      assert.ok(!query.includes('customer')); assert.ok(!query.includes('totalReceivedSet'));
      const dates = [...variables.query.matchAll(/'([^']+)'/g)].map(match => match[1]);
      const selected = rows.filter(row => Date.parse(row.createdAt) >= Date.parse(dates[0]) && Date.parse(row.createdAt) < Date.parse(dates[1]));
      const offset = variables.after ? Number(variables.after) : 0, nodes = structuredClone(selected.slice(offset, offset + 2));
      if (truncated && nodes[0]) nodes[0].lineItems.pageInfo.hasNextPage = true;
      data = { orders: { nodes, pageInfo: { hasNextPage: offset + 2 < selected.length, endCursor: String(offset + 2) } } };
    } else assert.fail('Unexpected Shopify operation; no write or ShopifyQL is permitted in this fixture');
    return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json', 'X-Shopify-API-Version': '2026-10' } });
  };
  const config = { dataDirectory: directory, provider: { kind: 'fixture', configured: false, complete() { assert.fail('Monitoring cannot call a model'); } }, accessClock: () => time, capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'fixture-shop.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'synthetic-api-fixture-only', ...(options.environment || {}) }, shopifyFetch: fetchImpl, supplierTrafficAdapter: options.trafficAdapter || null, dotWorkerConfig: options.dot || null, schedulerIntervalMs: 60000 };
  let app = await createApp(config);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
  const main = (await app.runtime.createConversation({ title: 'Seven-day API fixture', requestId: 'supplier-orders-main' }, actor)).conversation;
  const service = (await app.supplierService.forActor(actor).request(main.id, { requestId: 'supplier-orders-profile', facts: { name: 'API fixture retail product' } })).service;
  return { actor, main, service, get app() { return app; }, get calls() { return calls; }, bound() { return app.supplierService.forActor(actor); }, setTime(value) { time = Date.parse(value); }, rows(value) { rows = value; }, truncate() { truncated = true; }, deny() { denied = true; }, deferOrderRead() { deferred = true; return new Promise(resolve => { requestStarted = resolve; }); }, async restart() { await app.close(); app = await createApp(config); }, async listen() { return app.listen(0); } };
}
async function configure(f, overrides = {}) {
  return f.bound().createMonitor(f.main.id, f.service.id, { requestId: 'supplier-orders-monitor', expectedRevision: f.service.revision, shopifyProductId: product, variantIds: [variant], startAt: '2026-10-12T09:00:00Z', confirmed: true, ...overrides });
}
const input = (monitor, requestId) => ({ requestId, monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, confirmed: true });

test('actual bounded Shopify query pagination preserves exact variant quantities, cancellations/refund overlap and late corrections', async t => {
  const f = await fixture(t);
  f.rows([order(1, [line(1, 5, 3)], { refunds: [refund(1, 1, 2)] }), order(2, [line(2, 4, 0)], { cancelled: true, refunds: [refund(2, 2, 4)] }), order(3, [line(3, 999, 999, 'gid://shopify/Product/456')]), order(4, [line(4, 999, 999)], { test: true }), order(5, [line(5, 10, 9, product, 'gid://shopify/ProductVariant/1002')])]);
  const { monitor } = await configure(f);
  const first = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'product-sample-original'));
  assert.equal(first.sample.salesStatus, 'available'); assert.equal(first.sample.trafficStatus, 'unsupported'); assert.equal(first.sample.traffic, null);
  assert.deepEqual(first.sample.sales, { grossOrders: 2, grossUnits: 9, cancelledOrders: 1, cancelledUnits: 4, refundedUnits: 6, cancelledRefundedOverlapUnits: 4, removedOrAdjustedUnits: 0, retainedOrders: 1, retainedUnits: 3, revenue: null });
  assert.equal(first.summary.revision, 1); assert.equal(first.sample.dataLagSeconds, null); assert.equal(f.calls.filter(call => call.query.includes('WorkspaceSupplierOrders')).length, 3);
  const count = f.calls.length; await f.restart(); const duplicate = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'product-sample-original')); assert.equal(duplicate.duplicate, true); assert.equal(f.calls.length, count);
  f.rows([order(1, [line(1, 5, 1)], { refunds: [refund(1, 1, 4)] }), order(2, [line(2, 4, 0)], { cancelled: true, refunds: [refund(2, 2, 4)] })]);
  const corrected = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'product-sample-late'));
  assert.equal(corrected.sample.sales.retainedUnits, 1); assert.equal(corrected.summary.revision, 2); assert.equal(corrected.summary.corrected, true); assert.equal(corrected.summary.messageId, first.summary.messageId);
  assert.equal(f.app.store.read().messages.filter(message => message.id === first.summary.messageId).length, 1);
});
test('missing original order scope, denied authorization and truncated line data are unavailable, while complete empty cohorts are real zero', async t => {
  for (const mode of ['scope', 'denied', 'truncated', 'empty']) {
    const f = await fixture(t, mode === 'scope' ? { scopes: ['read_products'] } : {}); f.rows(mode === 'empty' ? [] : [order(1, [line(1, 2, 2)])]);
    const { monitor } = await configure(f);
    if (mode === 'denied') f.deny(); if (mode === 'truncated') f.truncate();
    const sample = (await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'sample-' + mode))).sample;
    assert.equal(sample.salesStatus, mode === 'empty' ? 'available' : 'unavailable');
    assert.equal(sample.sales?.retainedUnits ?? null, mode === 'empty' ? 0 : null); assert.equal(sample.traffic, null);
  }
});
test('reviewed product traffic retains its independent sampling, coverage and delay; partial is not zero or full-window attribution', async t => {
  const adapter = { id: 'existing-authorized-product-source', authorizationReviewed: true, productAttribution: 'exact_product_id', readProductTraffic: async scope => ({ shopId: scope.shopId, productId: scope.productId, attribution: 'exact_product_id', sampledAt: '2026-10-20T09:00:00Z', coverage: { from: scope.from, to: '2026-10-18T09:00:00Z' }, dataLagSeconds: 172800, complete: false, sessions: 17 }) };
  const f = await fixture(t, { trafficAdapter: adapter }), { monitor } = await configure(f);
  const sample = (await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'actual-authorized-traffic-fixture'))).sample;
  assert.equal(sample.sales.retainedUnits, 0); assert.equal(sample.trafficStatus, 'partial'); assert.equal(sample.traffic.sessions, 17); assert.equal(sample.traffic.dataLagSeconds, 172800); assert.equal(sample.traffic.sampledAt, '2026-10-20T09:00:00Z');
});
test('shutdown-interrupted read reconciles its original frozen interval; a partial replay after day seven cannot masquerade as a complete summary', async t => {
  const f = await fixture(t); f.setTime('2026-10-12T10:00:00Z'); const { monitor } = await configure(f);
  const started = f.deferOrderRead(); const original = f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'interrupted-product-source')).catch(error => error);
  await started; await f.app.close(); assert.equal((await original).code, 'SERVICE_CHECK_INTERRUPTED');
  f.setTime('2026-10-20T10:00:00Z'); await f.restart();
  const recovered = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'interrupted-product-source'));
  assert.equal(recovered.sample.coverage.to, '2026-10-12T10:00:00.000Z'); assert.equal(recovered.summary, null);
  const complete = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'complete-final-cohort')); assert.equal(complete.summary.coverage.to, monitor.scope.endAt); assert.equal(complete.summary.notificationCount, 1);
});
test('actual publication observation binds IDs and a real online-store timestamp; read receipts are never draft creation receipts', async t => {
  const f = await fixture(t);
  const body = { requestId: 'existing-product-observation', expectedRevision: 1, shopifyProductId: product, confirmed: true };
  const observed = await f.bound().observe(f.main.id, f.service.id, body); assert.equal(observed.observation.status, 'published'); assert.equal(observed.observation.relation, 'user_selected_existing_product'); assert.equal(observed.observation.writeReceipt, null);
  const count = f.calls.length; assert.equal((await f.bound().observe(f.main.id, f.service.id, body)).duplicate, true); assert.equal(f.calls.length, count);
  const creation = await f.bound().createMonitor(f.main.id, f.service.id, { requestId: 'verified-publication-monitor', expectedRevision: 2, startFromPublication: true, confirmed: true }); assert.equal(creation.monitor.scope.startSource, 'verified_online_store_publication'); assert.equal(creation.monitor.scope.startAt, '2026-10-12T09:00:00.000Z'); assert.equal(creation.monitor.scheduleEnabled, false);
});
test('original approved Schedule dispatches deterministic service checks with no model; restart retains one monitor/task and final message', async t => {
  const f = await fixture(t); f.setTime('2026-10-12T10:00:00Z');
  const creation = await configure(f), monitor = creation.monitor;
  assert.equal(monitor.scheduleEnabled, false); const scope = f.app.capabilities.scheduleApprovalRequest(monitor.scheduleId);
  assert.equal(scope.payload.goalDefinition.serviceTask.monitorId, monitor.id);
  const { approval } = await f.app.capabilities.requestApproval({ ...scope, expiresInSeconds: 300 }); await f.app.capabilities.decideApproval(approval.id, { decision: 'approved', confirmed: true });
  await f.app.capabilities.enableSchedule(monitor.scheduleId, { approvalId: approval.id });
  f.setTime('2026-10-12T10:00:02Z'); const tick = await f.app.capabilities.tick(); assert.equal(tick.runs[0].status, 'completed', JSON.stringify(tick));
  assert.equal(tick.runs[0].serviceReceipt.modelRequired, false); assert.equal(f.app.store.read().runs.length, 0);
  await assert.rejects(f.app.runtime.updateGoal(monitor.goalId, { action: 'start', requestId: 'forbidden-model' }), { code: 'SERVICE_TASK_MODEL_FORBIDDEN' });
  await f.restart(); f.setTime('2026-10-20T10:00:00Z'); await f.app.capabilities.tick();
  const restored = f.bound().monitors(f.main.id, f.service.id)[0]; assert.equal(restored.scheduleEnabled, false); assert.equal(restored.summary.notificationCount, 1);
  assert.equal(f.app.store.read().goals.length, 1); assert.equal(f.app.store.read().capabilities.schedules.length, 1);
});
test('original Dot MCP accepts only explicit task scope plus original active lease; owner Connector binding requires its original grant', async t => {
  const token = 'synthetic-supplier-dot-token-0123456789';
  const f = await fixture(t, { environment: { WORKSPACE_SUPPLIER_MCP_ENABLED: 'true' }, dot: { workerId: 'chatgpt-dot-xy', ownerId: 'xy', enabled: true, scopeReviewed: true, externalBudgetVerified: true, tokenDigest: createHash('sha256').update(token).digest('hex') } });
  const bound = f.bound(), preview = await bound.preview(f.main.id, f.service.id, { requestId: 'mcp-preview', expectedRevision: 1, publicFields: ['name'], confirmed: true });
  const scope = bound.taskScope(f.main.id, f.service.id, { requestId: 'mcp-public-scope', expectedRevision: 2, expectedPreviewHash: preview.preview.previewHash, confirmed: true });
  const order = (await f.app.workerDesk.create({ requestId: 'original-supplier-worker-order', serviceId: 'sales-assets', product: scope.publicProductText, market: 'US', objective: 'Read exactly the confirmed preview without publishing', budgetCredits: 30, deadlineAt: new Date(Date.now() + DAY).toISOString(), publicDataConfirmed: true, workerId: 'chatgpt-dot-xy' }, 'local-operator')).order;
  await f.app.workerDesk.approve(order.id, 'local-operator', { confirmed: true, workerId: 'chatgpt-dot-xy' }); await f.app.workerDesk.dispatch(order.id);
  const lease = await f.app.dotBridge.claimTask({ taskRef: order.id, requestId: 'original-supplier-claim' }), { port } = await f.listen();
  const mcp = async (name, args) => { const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); return (await response.json()).result; };
  const input = { taskRef: order.id, attemptId: lease.attemptId, fence: lease.fence };
  const read = await mcp('workspace_supplier_listing_preview', input); assert.equal(read.structuredContent.preview.product.title, 'API fixture retail product'); assert.equal(read.structuredContent.externalWriteAllowed, false);
  assert.equal((await mcp('workspace_supplier_monitor_status', input)).isError, true);
  await f.app.workerDesk.cancel(order.id); assert.equal((await mcp('workspace_supplier_listing_preview', input)).isError, true);
  const owner = createSupplierOwnerMcpBinding({ service: f.app.supplierService, actor: f.actor, conversationId: f.main.id, readReviewedScope: async () => null });
  await assert.rejects(owner.call('get', f.service.id), { code: 'SUPPLIER_MCP_SCOPE_REQUIRED' });
});
