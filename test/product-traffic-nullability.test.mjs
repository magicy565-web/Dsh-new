import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const SHOP = 'gid://shopify/Shop/1', PRODUCT = 'gid://shopify/Product/123', VARIANT = 'gid://shopify/ProductVariant/456';
const DOMAIN = 'fixture-shop.myshopify.com', HOST = 'store.fixture.example', ITEM = 'whole-product-fixture-123';
const DIMENSIONS = ['itemId', 'hostName', 'dateHourMinute'];
const compatible = mode => ({ dimensionCompatibilities: DIMENSIONS.map(apiName => ({ dimensionMetadata: { apiName }, compatibility: 'COMPATIBLE' })),
  metricCompatibilities: [{ metricMetadata: { apiName: 'itemViewEvents' }, compatibility: mode === 'unsupported' ? 'INCOMPATIBLE' : 'COMPATIBLE' }] });
const row = value => ({ dimensionValues: [ITEM, HOST, '202610131000'].map(value => ({ value })), metricValues: [{ value }] });
const report = (rows, extra = {}) => ({ kind: 'analyticsData#runReport', dimensionHeaders: DIMENSIONS.map(name => ({ name })),
  metricHeaders: [{ name: 'itemViewEvents', type: 'TYPE_INTEGER' }], rowCount: rows.length, rows, metadata: { timeZone: 'UTC' }, ...extra });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-ga4-nullability-'));
  const state = { mode: 'zero', ga4Calls: 0, shopifyCalls: 0 }; let app;
  t.after(async () => { try { await app?.close(); } finally { await fs.rm(directory, { recursive: true, force: true }); } });
  const options = { dataDirectory: directory, accessClock: () => Date.parse('2026-10-20T12:00:00.000Z'), schedulerIntervalMs: 60000,
    provider: { kind: 'fixture', configured: false, complete() { assert.fail('A synthetic read check cannot invoke a model.'); } },
    capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: DOMAIN, WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'SYNTHETIC_READ_FIXTURE_ONLY' },
    shopifyFetch: async (url, init) => {
      assert.equal(url, `https://${DOMAIN}/admin/api/2026-10/graphql.json`); state.shopifyCalls++;
      const { query } = JSON.parse(init.body); let data;
      if (query.includes('WorkspaceShop')) data = { shop: { id: SHOP, name: 'Synthetic shop', myshopifyDomain: DOMAIN, currencyCode: 'USD' },
        currentAppInstallation: { accessScopes: ['read_products', 'read_orders'].map(handle => ({ handle })) } };
      else if (query.includes('WorkspaceSupplierProduct')) data = { product: { id: PRODUCT, title: 'Synthetic product', status: 'ACTIVE',
        publishedAt: '2026-10-12T09:00:00.000Z', onlineStoreUrl: `https://${DOMAIN}/products/fixture`,
        variants: { nodes: [{ id: VARIANT, sku: 'fixture' }], pageInfo: { hasNextPage: false } } } };
      else if (query.includes('WorkspaceSupplierOrders')) data = { orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      else assert.fail('Only original Shopify read operations are allowed in this in-process fixture.');
      return Response.json({ data }, { headers: { 'X-Shopify-API-Version': '2026-10' } });
    },
    supplierTrafficOptions: { pageSize: 1,
      binding: { workspaceId: 'local', shopId: SHOP, shopDomain: DOMAIN, propertyId: '1234', hostNames: [HOST],
        mappingRevision: 'synthetic-nullability-review-1', authorizationReviewed: true,
        products: [{ productId: PRODUCT, itemId: ITEM, collectionStartedAt: '2026-10-12T09:00:00.000Z', evidenceRef: 'synthetic-nullability-review' }] },
      getAuthorization: async () => ({ authorized: state.mode !== 'revoked', workspaceId: 'local', shopId: SHOP, shopDomain: DOMAIN, propertyId: '1234',
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'], expiresAt: '2026-11-01T00:00:00.000Z', accessToken: 'SYNTHETIC_GA4_FIXTURE_ONLY' }),
      fetchImpl: async (url, init) => {
        assert.match(url, /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/1234:(checkCompatibility|runReport)$/); state.ga4Calls++;
        if (url.endsWith(':checkCompatibility')) return Response.json(compatible(state.mode));
        const { offset } = JSON.parse(init.body);
        if (state.mode === 'failed-page' && offset !== '0') return Response.json({ error: { message: 'Synthetic second-page failure' } }, { status: 503 });
        if (state.mode === 'failed-page') return Response.json(report([row('0')], { rowCount: 2 }));
        if (state.mode === 'empty') return Response.json(report([]));
        if (state.mode === 'malformed') return Response.json(report([row(null)]));
        if (state.mode === 'restricted') return Response.json(report([row('0')], { metadata: { timeZone: 'UTC',
          schemaRestrictionResponse: { activeMetricRestrictions: [{ metricName: 'itemViewEvents' }] } } }));
        if (state.mode === 'positive') return Response.json(report([row('7')], { metadata: { timeZone: 'UTC', subjectToThresholding: true } }));
        return Response.json(report([row('0')]));
      },
    },
  };
  app = await createApp(options);
  const actor = { subject: 'local-operator', workspaceId: 'local', role: 'admin' };
  const conversation = (await app.runtime.createConversation({ title: 'Synthetic null versus zero', requestId: 'nullability-conversation' }, actor)).conversation;
  const service = (await app.supplierService.forActor(actor).request(conversation.id, { requestId: 'nullability-intake', facts: { name: 'Synthetic product' } })).service;
  const { monitor } = await app.supplierService.forActor(actor).createMonitor(conversation.id, service.id, { requestId: 'nullability-monitor',
    expectedRevision: service.revision, shopifyProductId: PRODUCT, startAt: '2026-10-12T09:00:00.000Z', confirmed: true });
  return { state, conversation, service, monitor, get app() { return app; }, bound: () => app.supplierService.forActor(actor),
    async restart() { await app.close(); app = await createApp(options); } };
}

test('GA4 null, partial, error and legal zero remain distinct in original checks, summaries and persisted reloads', async t => {
  const f = await fixture(t); const originalMessageId = `supplier-summary-${f.monitor.id}`;
  assert.equal(f.monitor.scheduleEnabled, false);
  const cases = [
    ['zero', 'partial', 0, null],
    ['revoked', 'unconfigured', null, 'GA4_AUTH_NOT_AUTHORIZED'],
    ['empty', 'no_data', null, 'GA4_NO_RECORDED_PRODUCT_VIEWS'],
    ['restricted', 'partial', null, 'GA4_METRIC_RESTRICTED'],
    ['unsupported', 'unsupported', null, 'GA4_QUERY_UNSUPPORTED'],
    ['failed-page', 'unavailable', null, 'GA4_REQUEST_FAILED'],
    ['malformed', 'unavailable', null, 'GA4_ROW_SCOPE_INVALID'],
    ['positive', 'partial', 7, null],
    ['zero-again', 'partial', 0, null],
  ];
  for (const [mode, status, value, errorCode] of cases) await t.test(mode, async () => {
    f.state.mode = mode;
    const input = { requestId: `nullability-${mode}`, monitorId: f.monitor.id, expectedMonitorHash: f.monitor.scopeHash, confirmed: true };
    const before = f.state.ga4Calls;
    const got = await f.bound().checkMonitor(f.conversation.id, f.service.id, input);
    assert.equal(got.sample.trafficStatus, status); assert.equal(got.sample.traffic.metrics.productDetailViews.value, value);
    assert.equal(got.sample.traffic.metrics.productDetailViews.status, status); assert.equal(got.sample.traffic.error?.code ?? null, errorCode);
    assert.equal(got.sample.traffic.metrics.sessions.value, null); assert.equal(got.sample.traffic.complete, false);
    assert.equal(got.summary.traffic.metrics.productDetailViews.value, value); assert.equal(got.summary.trafficStatus, status);
    assert.equal(got.summary.provisional, true); assert.equal(got.summary.messageId, originalMessageId);
    // A complete empty sales cohort can be zero while traffic is still missing.
    assert.equal(got.sample.sales.retainedUnits, 0); assert.equal(got.sample.salesStatus, 'available');
    if (mode === 'revoked') assert.equal(f.state.ga4Calls, before);
    if (mode === 'failed-page') { assert.equal(got.sample.traffic.diagnostics.rows, 1); assert.equal(got.sample.traffic.completePagination, false); }
    const message = f.app.store.read().messages.find(row => row.id === originalMessageId);
    assert.ok(message.content.includes(`商品详情浏览事件 ${value === null ? '不可用' : value}`));
    if (value === null) assert.equal(message.content.includes('商品详情浏览事件 0'), false);
    const projection = f.bound().monitors(f.conversation.id, f.service.id)[0];
    assert.equal(projection.productDetailViewEventsAvailable, value !== null); assert.equal(projection.productTrafficAvailable, false);
    assert.equal(projection.scheduleEnabled, false);
    const calls = [f.state.ga4Calls, f.state.shopifyCalls];
    await f.restart();
    const saved = f.app.store.read().workspaceSupplierServices.monitors.find(row => row.id === f.monitor.id);
    assert.equal(saved.latestSample.traffic.metrics.productDetailViews.value, value); assert.equal(saved.summary.traffic.metrics.productDetailViews.value, value);
    const duplicate = await f.bound().checkMonitor(f.conversation.id, f.service.id, input);
    assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.sample, got.sample);
    assert.deepEqual([f.state.ga4Calls, f.state.shopifyCalls], calls);
    assert.equal(f.app.store.read().messages.filter(row => row.id === originalMessageId).length, 1);
  });
  const checks = f.app.store.read().workspaceSupplierServices.monitors[0].checks;
  assert.deepEqual(checks.map(row => row.sample.traffic.metrics.productDetailViews.value), cases.map(row => row[2]));
  assert.equal(checks.length, cases.length);
});
