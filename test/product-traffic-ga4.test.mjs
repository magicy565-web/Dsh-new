import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createGa4ProductTrafficAdapter } from '../server/product-traffic-ga4.mjs';
import { productTrafficInstant, shopifyProductTrafficCapability, validateProductTrafficObservation } from '../server/product-traffic-contract.mjs';

const WORKSPACE = 'workspace-fixture', SHOP = 'gid://shopify/Shop/1', PRODUCT = 'gid://shopify/Product/123';
const DOMAIN = 'fixture-shop.myshopify.com', ITEM = 'reviewed-product-123', HOST = 'fixture-store.example';
const clock = () => Date.parse('2026-10-20T12:00:00.000Z');
const binding = () => ({ workspaceId: WORKSPACE, shopId: SHOP, shopDomain: DOMAIN, propertyId: '1234',
  mappingRevision: 'fixture-mapping-1', authorizationReviewed: true, hostNames: [HOST],
  products: [{ productId: PRODUCT, itemId: ITEM, collectionStartedAt: '2026-10-12T00:00:00.000Z', evidenceRef: 'local-fixture-mapping-review' }] });
const auth = () => ({ authorized: true, workspaceId: WORKSPACE, shopId: SHOP, shopDomain: DOMAIN, propertyId: '1234',
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'], expiresAt: '2026-10-21T00:00:00.000Z', accessToken: 'synthetic-local-fixture-token' });
const scope = (sampleKey = 'original-check-1', extra = {}) => ({ workspaceId: WORKSPACE, shopId: SHOP, shopDomain: DOMAIN, productId: PRODUCT,
  from: '2026-10-12T09:00:00.000Z', to: '2026-10-19T09:00:00.000Z', sampleKey, ...extra });
const compatible = () => ({ dimensionCompatibilities: ['itemId', 'hostName', 'dateHourMinute'].map(apiName => ({ dimensionMetadata: { apiName }, compatibility: 'COMPATIBLE' })),
  metricCompatibilities: [{ metricMetadata: { apiName: 'itemViewEvents' }, compatibility: 'COMPATIBLE' }] });
const row = (minute = '202610120901', value = '3', item = ITEM, host = HOST) => ({ dimensionValues: [item, host, minute].map(value => ({ value })), metricValues: [{ value }] });
const report = (rows = [row()], extra = {}) => ({ kind: 'analyticsData#runReport', dimensionHeaders: ['itemId', 'hostName', 'dateHourMinute'].map(name => ({ name })),
  metricHeaders: [{ name: 'itemViewEvents', type: 'TYPE_INTEGER' }], rowCount: rows.length, rows, metadata: { timeZone: 'Etc/UTC' }, ...extra });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function fixture(options = {}) {
  const calls = [], b = options.binding || binding(); let authorized = auth(), reports = options.report || report(), authCalls = 0;
  const adapter = createGa4ProductTrafficAdapter({ binding: b, clock, pageSize: options.pageSize || 1000, maxPages: options.maxPages || 12,
    getAuthorization: async () => { authCalls++; return authorized; },
    fetchImpl: async (url, init) => {
      assert.match(url, /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/1234:(checkCompatibility|runReport)$/);
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Bearer ${authorized.accessToken}`);
      const body = JSON.parse(init.body); calls.push({ url, body });
      if (options.fetch) return options.fetch(url, init, body);
      return response(url.endsWith(':checkCompatibility') ? options.compatibility || compatible() : typeof reports === 'function' ? reports(body) : reports);
    } });
  return { adapter, calls, binding: b, setAuth: value => { authorized = value; }, setReport: value => { reports = value; }, authCalls: () => authCalls };
}

test('Shopify capability checks do not invent a product sessions field even with read_reports and Level 2', () => {
  assert.equal(shopifyProductTrafficCapability().status, 'unconfigured');
  const state = shopifyProductTrafficCapability({ shopifyStatus: { configured: true, status: 'verified', shop: { id: SHOP }, scopes: ['read_reports', 'read_products'] }, protectedCustomerDataLevel2: true });
  assert.equal(state.status, 'unsupported'); assert.equal(state.value, null);
  assert.equal(state.capabilities.readReportsGranted, true); assert.equal(state.capabilities.shopifyqlProductIdDimension, false);
  assert.equal(state.capabilities.authorizedProductEventSource, false);
  assert.equal(shopifyProductTrafficCapability({ shopifyStatus: { configured: true, status: 'configured_unverified', scopes: ['read_reports'] } }).capabilities.readReportsGranted, false);
});

test('without configuration, original auth review, or matching authorization, no network read and no zero', async () => {
  const noFetch = () => assert.fail('A missing grant cannot initiate API reads');
  const empty = createGa4ProductTrafficAdapter({ clock, fetchImpl: noFetch });
  assert.equal(empty.status().configured, false);
  assert.equal((await empty.readProductTraffic(scope())).status, 'unconfigured');
  const unreviewed = createGa4ProductTrafficAdapter({ binding: { ...binding(), authorizationReviewed: false }, getAuthorization: () => assert.fail('Unreviewed auth'), clock, fetchImpl: noFetch });
  assert.equal((await unreviewed.readProductTraffic(scope())).metrics.productDetailViews.value, null);
  for (const change of [{ authorized: false }, { workspaceId: 'different' }, { shopId: 'gid://shopify/Shop/2' }, { shopDomain: 'different.myshopify.com' },
    { propertyId: '456' }, { scopes: [] }, { expiresAt: '2026-10-20T00:00:00.000Z' }, { accessToken: '' }]) {
    const adapter = createGa4ProductTrafficAdapter({ binding: binding(), getAuthorization: async () => ({ ...auth(), ...change }), clock, fetchImpl: noFetch });
    const result = await adapter.readProductTraffic(scope());
    assert.equal(result.status, 'unconfigured'); assert.equal(result.error.code, 'GA4_AUTH_NOT_AUTHORIZED');
    assert.equal(result.metrics.productDetailViews.value, null); assert.equal(result.metrics.sessions.value, null);
  }
});

test('one fixed store and a unique reviewed mapping cannot be inferred from SKU or mutated after construction', async () => {
  const f = fixture(); f.binding.products[0].itemId = 'mutated'; f.binding.hostNames.push('another.example');
  const got = await f.adapter.readProductTraffic(scope()); assert.equal(got.metrics.productDetailViews.value, 3);
  assert.equal(f.calls[0].body.dimensionFilter.andGroup.expressions[0].filter.stringFilter.value, ITEM);
  for (const extra of [{ workspaceId: 'another' }, { shopDomain: 'another.myshopify.com' }, { shopId: 'gid://shopify/Shop/2' }, { productId: 'gid://shopify/Product/456' }]) {
    assert.equal((await f.adapter.readProductTraffic(scope('another-scope', extra))).status, 'unsupported');
  }
  assert.equal(f.calls.length, 2);
  for (const changes of [{ propertyId: '../other' }, { hostNames: [] }, { products: [{ ...binding().products[0], evidenceRef: '' }] },
    { products: [...binding().products, { ...binding().products[0], productId: 'gid://shopify/Product/456' }] }]) {
    assert.throws(() => createGa4ProductTrafficAdapter({ binding: { ...binding(), ...changes } }), { code: 'PRODUCT_TRAFFIC_BINDING_INVALID' });
  }
});

test('reads official itemViewEvents with exact product/store/minute filters; preserves source, definition and unknown freshness', async () => {
  const f = fixture({ report: report([row(), row('202610130901', '4')]) });
  const got = await f.adapter.readProductTraffic(scope());
  assert.equal(got.metrics.productDetailViews.value, 7); assert.equal(got.metrics.sessions.value, null);
  assert.equal(got.metricDefinitions.productDetailViews.sourceMetric, 'itemViewEvents');
  assert.equal(got.status, 'partial'); assert.equal(got.completePagination, true); assert.equal(got.complete, false);
  assert.equal(got.freshness, 'unknown'); assert.equal(got.dataLagSeconds, null); assert.deepEqual(got.coverage, { from: scope().from, to: scope().to });
  const request = f.calls[1].body;
  assert.deepEqual(request.metrics, [{ name: 'itemViewEvents' }]);
  assert.deepEqual(request.dateRanges, [{ startDate: '2026-10-12', endDate: '2026-10-19' }]);
  const filters = request.dimensionFilter.andGroup.expressions.map(value => value.filter);
  assert.deepEqual(filters[0], { fieldName: 'itemId', stringFilter: { matchType: 'EXACT', value: ITEM, caseSensitive: true } });
  assert.deepEqual(filters[1].inListFilter.values, [HOST]);
  assert.equal(filters[2].numericFilter.value.int64Value, '202610120900');
  assert.equal(filters[3].numericFilter.operation, 'LESS_THAN'); assert.equal(filters[3].numericFilter.value.int64Value, '202610190900');
  assert.equal(JSON.stringify(got).includes(auth().accessToken), false);
  assert.equal(validateProductTrafficObservation(got, scope()).metrics.productDetailViews.value, 7);
});

test('subminute bounds and collection beginning late restrict coverage without asserting seven complete days', async () => {
  const b = binding(); b.products[0].collectionStartedAt = '2026-10-13T09:00:45.000Z';
  const f = fixture({ binding: b, report: report([row('202610130901', '2')]) });
  const got = await f.adapter.readProductTraffic(scope('late-collection', { from: '2026-10-12T09:00:43.000Z', to: '2026-10-19T09:00:42.000Z' }));
  assert.deepEqual(got.coverage, { from: '2026-10-13T09:01:00.000Z', to: '2026-10-19T09:00:00.000Z' });
  assert.equal(got.metrics.productDetailViews.value, 2); assert.ok(got.quality.limitationCodes.includes('PARTIAL_TIME_COVERAGE'));
  const noMinutes = await f.adapter.readProductTraffic(scope('before-collection', { to: '2026-10-13T09:00:00.000Z' }));
  assert.equal(noMinutes.status, 'no_data'); assert.equal(noMinutes.metrics.productDetailViews.value, null); assert.equal(noMinutes.coverage, null);
  assert.equal(f.calls.length, 2);
});

test('empty report is missing instrumentation/data, while an explicit source zero stays a provisional observation', async () => {
  const f = fixture({ report: report([]) });
  const absent = await f.adapter.readProductTraffic(scope());
  assert.equal(absent.status, 'no_data'); assert.equal(absent.metrics.productDetailViews.value, null); assert.equal(absent.completePagination, true);
  f.setReport(report([row('202610120901', '0')]));
  const zero = await f.adapter.readProductTraffic(scope('next-check'));
  assert.equal(zero.status, 'partial'); assert.equal(zero.metrics.productDetailViews.value, 0); assert.equal(zero.complete, false);
});

test('request replay and concurrent reads coalesce; new original sample permits late corrections without adding totals', async () => {
  const f = fixture();
  const [one, two] = await Promise.all([f.adapter.readProductTraffic(scope()), f.adapter.readProductTraffic(scope())]);
  assert.deepEqual(one, two); assert.equal(f.calls.length, 2);
  one.metrics.productDetailViews.value = 999;
  assert.equal((await f.adapter.readProductTraffic(scope())).metrics.productDetailViews.value, 3);
  assert.equal(f.calls.length, 2);
  f.setReport(report([row('202610120901', '5')]));
  assert.equal((await f.adapter.readProductTraffic(scope('correction-original-check-2'))).metrics.productDetailViews.value, 5);
  assert.equal(f.calls.length, 4);
  await assert.rejects(f.adapter.readProductTraffic(scope('original-check-1', { to: '2026-10-18T09:00:00.000Z' })), { code: 'PRODUCT_TRAFFIC_IDEMPOTENCY_CONFLICT' });
  f.setAuth({ ...auth(), authorized: false });
  const revoked = await f.adapter.readProductTraffic(scope());
  assert.equal(revoked.status, 'unconfigured'); assert.equal(revoked.metrics.productDetailViews.value, null); assert.equal(f.calls.length, 4);
});

test('full bounded pagination counts each distinct minute once; duplicate or changed buckets produce null', async () => {
  const rows = [row(), row('202610120902', '4'), row('202610120903', '2')];
  const f = fixture({ pageSize: 2, report: body => report(rows.slice(Number(body.offset), Number(body.offset) + 2), { rowCount: 3 }) });
  const got = await f.adapter.readProductTraffic(scope()); assert.equal(got.metrics.productDetailViews.value, 9); assert.equal(got.diagnostics.pages, 2);
  assert.deepEqual(f.calls.slice(1).map(call => call.body.offset), ['0', '2']);
  for (const duplicate of [row(), row('202610120901', '7')]) {
    const d = fixture({ pageSize: 1, report: body => report([Number(body.offset) ? duplicate : row()], { rowCount: 2 }) });
    const value = await d.adapter.readProductTraffic(scope());
    assert.equal(value.metrics.productDetailViews.value, null); assert.equal(value.status, 'unavailable');
    assert.equal(value.error.code, duplicate.metricValues[0].value === '3' ? 'GA4_DUPLICATE_BUCKET' : 'GA4_REPORT_CHANGED');
  }
  const limited = fixture({ pageSize: 1, maxPages: 1, report: report([row()], { rowCount: 2 }) });
  assert.equal((await limited.adapter.readProductTraffic(scope())).error.code, 'GA4_PAGINATION_LIMIT');
});

test('sampling rate and source estimates remain explicit; thresholding and truncation stay partial', async () => {
  const f = fixture({ report: report([row('202610120901', '100')], { metadata: { timeZone: 'UTC', samplingMetadatas: [{ samplesReadCount: '20', samplingSpaceSize: '100' }],
    subjectToThresholding: true, dataLossFromOtherRow: true, dataTruncationReasons: [{ dataTruncationType: 'DATA_TRUNCATION_TYPE_PROPERTY' }] } }) });
  const got = await f.adapter.readProductTraffic(scope());
  assert.equal(got.metrics.productDetailViews.value, 100); assert.equal(got.sampling.rate, 0.2); assert.equal(got.sampling.sampled, true);
  assert.ok(got.quality.limitationCodes.includes('GA4_SAMPLED_REPORT')); assert.ok(got.quality.limitationCodes.includes('GA4_THRESHOLDING'));
  assert.ok(got.quality.limitationCodes.includes('GA4_DATA_TRUNCATED')); assert.equal(got.complete, false);
  const invalid = fixture({ report: report([row()], { metadata: { timeZone: 'UTC', samplingMetadatas: [{ samplesReadCount: '101', samplingSpaceSize: '100' }] } }) });
  assert.equal((await invalid.adapter.readProductTraffic(scope())).error.code, 'GA4_SAMPLING_INVALID');
  const restricted = fixture({ report: report([row()], { metadata: { timeZone: 'UTC', schemaRestrictionResponse: { activeMetricRestrictions: [{ metricName: 'itemViewEvents' }] } } }) });
  assert.equal((await restricted.adapter.readProductTraffic(scope())).metrics.productDetailViews.value, null);
});

test('unsupported metric combinations and non-UTC properties do not widen the query or fabricate sessions', async () => {
  const compatibility = compatible(); compatibility.metricCompatibilities[0].compatibility = 'INCOMPATIBLE';
  const f = fixture({ compatibility });
  const got = await f.adapter.readProductTraffic(scope()); assert.equal(got.status, 'unsupported'); assert.equal(f.calls.length, 1);
  const timezone = fixture({ report: report([row()], { metadata: { timeZone: 'America/New_York' } }) });
  const t = await timezone.adapter.readProductTraffic(scope()); assert.equal(t.error.code, 'GA4_TIMEZONE_UNSUPPORTED'); assert.equal(t.metrics.productDetailViews.value, null);
});

test('wrong product, hostname, time, malformed counts and report headers fail closed', async () => {
  for (const r of [row('202610120901', '3', 'other'), row('202610120901', '3', ITEM, 'other.example'), row('202610190900'),
    row('202610120899'), row('202610120901', '-1'), row('202610120901', '9007199254740992'), row('202610120901', '1.5')]) {
    const f = fixture({ report: report([r]) }), result = await f.adapter.readProductTraffic(scope());
    assert.equal(result.metrics.productDetailViews.value, null); assert.equal(result.error.code, 'GA4_ROW_SCOPE_INVALID');
  }
  const schema = fixture({ report: report([row()], { metricHeaders: [{ name: 'sessions', type: 'TYPE_INTEGER' }] }) });
  assert.equal((await schema.adapter.readProductTraffic(scope())).error.code, 'GA4_REPORT_SCHEMA_INVALID');
});

test('rate limits, rejected auth, network errors and aborted checks retain null and permit ordinary recovery', async () => {
  for (const [status, code, state] of [[401, 'GA4_AUTH_REJECTED', 'unconfigured'], [403, 'GA4_AUTH_REJECTED', 'unconfigured'], [400, 'GA4_QUERY_UNSUPPORTED', 'unsupported'],
    [404, 'GA4_PROPERTY_UNAVAILABLE', 'unconfigured'], [429, 'GA4_RATE_LIMITED', 'unavailable'], [500, 'GA4_REQUEST_FAILED', 'unavailable']]) {
    let failing = true;
    const f = fixture({ fetch: url => failing ? response({ error: { message: 'Do not leak this remote message' } }, status) : response(url.endsWith(':checkCompatibility') ? compatible() : report()) });
    const got = await f.adapter.readProductTraffic(scope()); assert.equal(got.error.code, code); assert.equal(got.status, state); assert.equal(got.metrics.productDetailViews.value, null);
    assert.equal(JSON.stringify(got).includes('Do not leak'), false);
    failing = false; assert.equal((await f.adapter.readProductTraffic(scope())).metrics.productDetailViews.value, 3);
  }
  const unreachable = fixture({ fetch: () => { throw new Error('synthetic-local-fixture-token'); } });
  const result = await unreachable.adapter.readProductTraffic(scope()); assert.equal(result.error.code, 'GA4_UNREACHABLE'); assert.equal(JSON.stringify(result).includes(auth().accessToken), false);
  const controller = new AbortController(); controller.abort();
  const f = fixture(); assert.equal((await f.adapter.readProductTraffic(scope('abort-check', { signal: controller.signal }))).error.code, 'PRODUCT_TRAFFIC_ABORTED'); assert.equal(f.calls.length, 0);
});

test('scope and v2 integration validation reject invalid ranges or sessions substitution', async () => {
  const f = fixture();
  for (const extra of [{ from: '2026-10-12' }, { from: '2026-02-30T09:00:00.000Z' }, { to: '2026-10-21T00:00:00.000Z' }, { from: '2026-10-01T00:00:00.000Z' },
    { to: scope().from }, { sampleKey: '' }]) await assert.rejects(f.adapter.readProductTraffic(scope('bad-window', extra)), { code: 'PRODUCT_TRAFFIC_SCOPE_INVALID' });
  assert.equal(productTrafficInstant('2026-10-12T09:00:00Z'), Date.parse(scope().from));
  const result = await f.adapter.readProductTraffic(scope());
  for (const changed of [{ ...result, metrics: { ...result.metrics, sessions: { value: 3, status: 'partial' } } },
    { ...result, complete: true }, { ...result, coverage: { from: '2026-10-01T00:00:00.000Z', to: scope().to } }]) {
    assert.throws(() => validateProductTrafficObservation(changed, scope()), { code: 'PRODUCT_TRAFFIC_OBSERVATION_INVALID' });
  }
});

test('expired authorization between pages and cancellation during a read cannot produce or cache a final count', async () => {
  let time = clock(), count = 0;
  const adapter = createGa4ProductTrafficAdapter({ binding: binding(), clock: () => time, getAuthorization: async () => ({ ...auth(), expiresAt: '2026-10-20T12:00:01.000Z' }), pageSize: 1,
    fetchImpl: async url => {
      count++;
      if (url.endsWith(':checkCompatibility')) return response(compatible());
      time += 2000;
      return response(report([row()], { rowCount: 2 }));
    } });
  const got = await adapter.readProductTraffic(scope());
  assert.equal(got.status, 'unconfigured'); assert.equal(got.error.code, 'GA4_AUTH_NOT_AUTHORIZED'); assert.equal(got.metrics.productDetailViews.value, null); assert.equal(count, 2);
  const controller = new AbortController();
  const cancelled = fixture({ fetch: url => {
    if (url.endsWith(':checkCompatibility')) return response(compatible());
    controller.abort(); return response(report());
  } });
  const aborted = await cancelled.adapter.readProductTraffic(scope('cancel-in-flight', { signal: controller.signal }));
  assert.equal(aborted.error.code, 'PRODUCT_TRAFFIC_ABORTED'); assert.equal(aborted.metrics.productDetailViews.value, null);
  const calls = cancelled.calls.length;
  await cancelled.adapter.readProductTraffic(scope('cancel-in-flight'));
  assert.equal(cancelled.calls.length, calls + 2);
});

test('oversized or malformed source JSON remains unavailable rather than zero', async () => {
  for (const source of [() => new Response('{broken'), () => new Response('{}', { headers: { 'content-length': '2000001' } })]) {
    const f = fixture({ fetch: source });
    const got = await f.adapter.readProductTraffic(scope());
    assert.equal(got.error.code, 'GA4_RESPONSE_INVALID'); assert.equal(got.metrics.productDetailViews.value, null);
  }
});

test('real local HTTP transport serializes official read requests and never calls a customer store', async t => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ method: req.method, path: req.url, body: JSON.parse(body), auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith(':checkCompatibility') ? compatible() : report([row('202610120901', '8')])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const adapter = createGa4ProductTrafficAdapter({ binding: binding(), getAuthorization: async () => auth(), clock,
    fetchImpl: (url, options) => { const target = new URL(url); assert.equal(target.hostname, 'analyticsdata.googleapis.com'); return fetch(`http://127.0.0.1:${port}${target.pathname}`, options); } });
  const got = await adapter.readProductTraffic(scope());
  assert.equal(got.metrics.productDetailViews.value, 8); assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(req => req.path), ['/v1beta/properties/1234:checkCompatibility', '/v1beta/properties/1234:runReport']);
  assert.equal(requests[1].method, 'POST'); assert.equal(requests[1].auth, `Bearer ${auth().accessToken}`);
});
