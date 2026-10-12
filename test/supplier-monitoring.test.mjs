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
  const config = { dataDirectory: directory, provider: { kind: 'fixture', configured: false, complete() { assert.fail('Monitoring cannot call a model'); } }, accessClock: () => time, capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'fixture-shop.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'synthetic-api-fixture-only', ...(options.environment || {}) }, shopifyFetch: fetchImpl, supplierTrafficAdapter: options.trafficAdapter || null, supplierTrafficOptions: options.ga4 || null, supplierNotificationOptions: options.notify || {}, dotWorkerConfig: options.dot || null, schedulerIntervalMs: 60000 };
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

function ga4Options() {
  const fixture = { count: '5', revoked: false, calls: 0 };
  fixture.options = {
    binding: { workspaceId: 'local', shopId, shopDomain: 'fixture-shop.myshopify.com', propertyId: '1234', hostNames: ['store.fixture.example'], mappingRevision: 'reviewed-local-product-mapping-1', authorizationReviewed: true,
      products: [{ productId: product, itemId: 'whole-product-fixture-123', collectionStartedAt: '2026-10-12T09:00:00.000Z', evidenceRef: 'explicit-local-mapping-fixture' }] },
    getAuthorization: async () => ({ authorized: !fixture.revoked, workspaceId: 'local', shopId, shopDomain: 'fixture-shop.myshopify.com', propertyId: '1234', scopes: ['https://www.googleapis.com/auth/analytics.readonly'], expiresAt: '2026-11-01T00:00:00.000Z', accessToken: 'SYNTHETIC-GA4-EXISTING-TOKEN' }),
    fetchImpl: async (url, init) => {
      assert.match(url, /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/1234:(checkCompatibility|runReport)$/); fixture.calls++;
      const compatibility = { dimensionCompatibilities: ['itemId', 'hostName', 'dateHourMinute'].map(name => ({ dimensionMetadata: { apiName: name }, compatibility: 'COMPATIBLE' })), metricCompatibilities: [{ metricMetadata: { apiName: 'itemViewEvents' }, compatibility: 'COMPATIBLE' }] };
      const value = url.endsWith(':checkCompatibility') ? compatibility : { kind: 'analyticsData#runReport', dimensionHeaders: ['itemId', 'hostName', 'dateHourMinute'].map(name => ({ name })), metricHeaders: [{ name: 'itemViewEvents', type: 'TYPE_INTEGER' }], rowCount: 1,
        rows: [{ dimensionValues: ['whole-product-fixture-123', 'store.fixture.example', '202610131000'].map(value => ({ value })), metricValues: [{ value: fixture.count }] }], metadata: { timeZone: 'Etc/UTC' } };
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    },
  };
  return fixture;
}

test('integrated GA4 v2 preserves exact-product view events, durable replay and semantic-only seven-day corrections', async t => {
  const ga4 = ga4Options(), f = await fixture(t, { ga4: ga4.options });
  const { monitor } = await configure(f); assert.equal(monitor.scope.trafficContractVersion, 2);
  const original = input(monitor, 'ga4-original-check'), first = await f.bound().checkMonitor(f.main.id, f.service.id, original);
  assert.equal(first.sample.trafficStatus, 'partial'); assert.equal(first.sample.traffic.metrics.productDetailViews.value, 5);
  assert.equal(first.sample.traffic.metrics.sessions.value, null); assert.equal(first.sample.traffic.dataLagSeconds, null);
  assert.equal(first.sample.traffic.complete, false); assert.equal(first.sample.traffic.workspaceId, 'local');
  assert.equal(first.summary.provisional, true); assert.equal(first.summary.revision, 1);
  const calls = ga4.calls; await f.restart();
  const duplicate = await f.bound().checkMonitor(f.main.id, f.service.id, original);
  assert.equal(duplicate.duplicate, true); assert.equal(ga4.calls, calls);
  f.setTime('2026-10-20T11:00:00Z');
  const refreshed = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'ga4-same-values-new-check'));
  assert.equal(refreshed.summary.revision, 1); assert.equal(refreshed.summary.contentHash, first.summary.contentHash);
  assert.equal(refreshed.summary.notificationCount, 1); assert.notEqual(refreshed.sample.traffic.sampledAt, first.sample.traffic.sampledAt);
  ga4.count = '7';
  const corrected = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'ga4-late-detail-events'));
  assert.equal(corrected.summary.revision, 2); assert.equal(corrected.summary.traffic.metrics.productDetailViews.value, 7);
  assert.equal(corrected.summary.messageId, first.summary.messageId); assert.equal(corrected.summary.notificationCount, 1);
  const text = f.app.store.read().messages.find(message => message.id === first.summary.messageId).content;
  assert.ok(text.includes('商品详情浏览事件 7')); assert.ok(text.includes('sessions 不可用'));
});

test('missing/revoked GA4 authorization is null and a changed reviewed mapping cannot silently rebind an original monitor', async t => {
  const ga4 = ga4Options(), f = await fixture(t, { ga4: ga4.options }), { monitor } = await configure(f);
  ga4.revoked = true;
  const denied = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'ga4-revoked-source'));
  assert.equal(denied.sample.trafficStatus, 'unconfigured'); assert.equal(denied.sample.traffic.metrics.productDetailViews.value, null);
  assert.equal(ga4.calls, 0); assert.equal(denied.sample.traffic.metrics.sessions.value, null);
  ga4.revoked = false; ga4.options.binding.mappingRevision = 'changed-local-mapping-2'; await f.restart();
  const changed = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'ga4-changed-binding'));
  assert.equal(changed.sample.traffic, null); assert.ok(changed.sample.errors.some(item => item.code === 'SUPPLIER_TRAFFIC_SCOPE_CHANGED'));
  assert.equal(ga4.calls, 0);
});

function notificationOptions() {
  const appId = 'wx0123456789abcdef', templateId = 'local-summary-template';
  const fixture = { posts: 0, revoked: false, uncertain: false };
  fixture.options = {
    wechat: { enabled: true, appId, templateId, mode: 'fixture', fields: { thing1: 'title', phrase2: 'status', date3: 'endDate' },
      getAccessToken: async () => ({ appId, accessToken: 'LOCAL_EXISTING_FIXTURE_TOKEN', expiresAt: Date.parse('2026-11-01T00:00:00Z') }),
      fetchImpl: async (url, input) => { fixture.posts++; assert.equal(url.origin + url.pathname, 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send'); const payload = JSON.parse(input.body); assert.equal(payload.touser, 'local_fixture_openid'); assert.deepEqual(Object.keys(payload.data).sort(), ['date3', 'phrase2', 'thing1']); assert.ok(!input.body.includes('retainedUnits')); if (fixture.uncertain) throw Error('Deliberate local response loss'); return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { headers: { 'Content-Type': 'application/json' } }); },
    },
    resolveRecipient: async ({ actor, recipientBindingId }) => ({ id: recipientBindingId, revision: 1, workspaceId: actor.workspaceId, ownerSubject: actor.subject, recipientSubject: actor.subject, verified: true, appId, openid: 'local_fixture_openid', revoked: fixture.revoked }),
    confirmSubscription: async ({ actor, challenge, decision }) => ({ verified: true, subject: actor.subject, workspaceId: actor.workspaceId, challengeId: challenge.id, decision, source: 'wx.requestSubscribeMessage', provenance: 'authenticated_wechat_client', evidenceKind: 'local_fixture', appId, templateId }),
  };
  return fixture;
}
async function notificationFlow(f, monitor, phase = 'summary') {
  const { port } = await f.listen(), base = `http://127.0.0.1:${port}`, route = `/api/conversations/${f.main.id}/supplier-services/${f.service.id}`;
  const post = async (suffix, body) => { const response = await fetch(base + route + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(phase === 'first_sample' ? { phase } : {}) }) }); return { status: response.status, body: await response.json() }; };
  const challenge = await post('/notification-subscription-challenge', { requestId: `native-subscribe-challenge-${phase}`, monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, recipientBindingId: 'reviewed-owner-fixture', expectedBindingRevision: 1, confirmed: true });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const recorded = await post('/notification-subscription-record', { requestId: `native-subscribe-record-${phase}`, monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, challengeId: challenge.body.challengeId, decision: 'accept', confirmed: true });
  assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  await f.app.supplierNotifications.ensureConnector();
  await f.app.capabilities.updateConnector(f.app.capabilities.listConnectors().find(item => item.adapter === 'workspace-seven-day-notification').id, { enabled: true });
  const final = phase === 'first_sample' ? f.bound().notifications.snapshot(f.main.id, f.service.id, monitor.id, phase).notification.source : f.bound().summary(f.main.id, f.service.id, monitor.id);
  const review = await post('/notification-review', { requestId: `notification-original-review-${phase}`, monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, recipientBindingId: recorded.body.recipientBindingId, expectedBindingRevision: 1, subscriptionId: recorded.body.subscriptionId, expectedSummaryRevision: final.revision, expectedSummaryHash: final.contentHash, confirmed: true });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const operation = review.body.notification.review; assert.equal(operation.status, 'pending_approval');
  const command = { ...(phase === 'first_sample' ? { phase } : {}), requestId: `notification-original-execute-${phase}`, monitorId: monitor.id, operationId: operation.id, expectedScopeHash: operation.scopeHash, confirmed: true };
  return { post, route, base, operation, command, subscriptionId: recorded.body.subscriptionId };
}

test('integrated actual HTTP notification requires original separate approval and preserves one fixture POST across corrections/reopen', async t => {
  const notification = notificationOptions(), f = await fixture(t, { notify: notification.options }), { monitor } = await configure(f);
  await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'notification-summary-original-check'));
  const flow = await notificationFlow(f, monitor);
  assert.equal(notification.posts, 0); assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
  const generic = await fetch(flow.base + `/api/approvals/${flow.operation.approvalId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approved', confirmed: true }) });
  assert.equal(generic.status, 409);
  const approved = await flow.post('/notification-decision', { ...flow.command, requestId: 'notification-original-decision', decision: 'approved' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const sent = await flow.post('/notification-execute', flow.command);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.notification.delivery.status, 'platform_accepted'); assert.equal(sent.body.notification.delivery.evidenceKind, 'local_fixture');
  assert.equal(sent.body.notification.delivery.userRead, 'unknown'); assert.equal(notification.posts, 1);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 1);
  f.rows([order(1, [line(1, 4, 3)], { refunds: [refund(1, 1, 1)] })]);
  const correction = await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'notification-summary-correction'));
  assert.equal(correction.summary.revision, 2);
  const duplicate = await flow.post('/notification-execute', flow.command); assert.equal(duplicate.body.duplicate, true); assert.equal(notification.posts, 1);
  assert.equal(duplicate.body.notification.delivery.summaryCorrectedAfterSubmission, true);
  const dto = f.bound().monitors(f.main.id, f.service.id)[0]; assert.equal(dto.notificationSubscriptions, undefined); assert.equal(dto.notificationChallenges, undefined);
  await f.restart();
  const restored = f.bound().notifications.snapshot(f.main.id, f.service.id, monitor.id);
  assert.equal(restored.notification.delivery.status, 'platform_accepted'); assert.equal(restored.notification.delivery.summaryCorrectedAfterSubmission, true); assert.equal(notification.posts, 1);
});

test('integrated unknown notification consumes original one-time reservation and cannot send on duplicate/reopen', async t => {
  const notification = notificationOptions(), f = await fixture(t, { notify: notification.options }), { monitor } = await configure(f);
  await f.bound().checkMonitor(f.main.id, f.service.id, input(monitor, 'unknown-summary-check'));
  const flow = await notificationFlow(f, monitor);
  await flow.post('/notification-decision', { ...flow.command, requestId: 'unknown-notification-decision', decision: 'approved' }); notification.uncertain = true;
  const result = await flow.post('/notification-execute', flow.command);
  assert.equal(result.body.notification.delivery.status, 'unknown'); assert.equal(result.body.notification.delivery.automaticRetry, false);
  assert.equal(notification.posts, 1); await f.restart();
  const restored = f.bound().notifications.snapshot(f.main.id, f.service.id, monitor.id);
  assert.equal(restored.notification.delivery.status, 'unknown');
  const duplicate = await f.bound().notifications.executeNotification(f.main.id, f.service.id, flow.command);
  assert.equal(duplicate.duplicate, true); assert.equal(notification.posts, 1);
  assert.equal(f.app.store.read().workspaceSupplierServices.monitors[0].notificationSubscriptions[0].state, 'consumed');
});

test('explicit first-sample notification precedes seven days, has its own once-only approval/grant and never creates summary delivery', async t => {
  const notification=notificationOptions(); notification.options.firstSampleWechat={...notification.options.wechat};
  const f=await fixture(t,{notify:notification.options}); f.setTime('2026-10-12T10:00:00Z');
  const {monitor}=await configure(f); const sampled=await f.bound().checkMonitor(f.main.id,f.service.id,input(monitor,'actual-first-sample-fixture'));
  assert.equal(sampled.summary,null);
  const flow=await notificationFlow(f,monitor,'first_sample');
  const decided=await flow.post('/notification-decision',{...flow.command,requestId:'first-only-decision',decision:'approved'}); assert.equal(decided.status,200,JSON.stringify(decided.body));
  const sent=await flow.post('/notification-execute',flow.command); assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.equal(sent.body.notification.phase,'first_sample'); assert.equal(sent.body.notification.delivery.status,'platform_accepted');
  assert.equal(notification.posts,1);
  const original=f.app.store.read().workspaceSupplierServices.monitors[0];
  assert.equal(original.summary,null); assert.equal(original.externalNotification,undefined);
  assert.equal(original.notificationSubscriptions[0].state,'consumed');
  assert.equal(original.notificationSubscriptions[0].summaryId,`supplier-first-sample-${monitor.id}`);
  const duplicate=await flow.post('/notification-execute',flow.command); assert.equal(duplicate.body.duplicate,true); assert.equal(notification.posts,1);
  await f.restart(); assert.equal(f.bound().notifications.snapshot(f.main.id,f.service.id,monitor.id,'first_sample').notification.delivery.status,'platform_accepted');
  assert.equal(notification.posts,1);
});

test('first-sample configuration is independently disabled and a summary opt-in cannot authorize it', async t => {
  const notification=notificationOptions(),f=await fixture(t,{notify:notification.options}),{monitor}=await configure(f);
  await f.bound().checkMonitor(f.main.id,f.service.id,input(monitor,'summary-source-for-independent-flags'));
  const first=f.bound().notifications.snapshot(f.main.id,f.service.id,monitor.id,'first_sample'); assert.equal(first.notification.status,'blocked');
  assert.equal(notification.posts,0);
  const response=await f.bound().notifications.challenge(f.main.id,f.service.id,{requestId:'disabled-first-popup',phase:'first_sample',monitorId:monitor.id,expectedMonitorHash:monitor.scopeHash,recipientBindingId:'reviewed-owner-fixture',expectedBindingRevision:1,confirmed:true});
  assert.equal(response.status,'blocked'); assert.equal(f.app.store.read().workspaceSupplierServices.monitors[0].notificationSubscriptions,undefined);
});
