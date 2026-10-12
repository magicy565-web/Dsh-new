import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existingGa4AuthorizationProvider, loadSupplierTrafficOptions } from '../server/product-traffic-config.mjs';
import { createGa4ProductTrafficAdapter } from '../server/product-traffic-ga4.mjs';

const clock = () => Date.parse('2026-10-20T12:00:00.000Z');
const binding = () => ({ workspaceId: 'workspace-fixture', shopId: 'gid://shopify/Shop/1', shopDomain: 'fixture-shop.myshopify.com',
  propertyId: '1234', mappingRevision: 'synthetic-review-1', authorizationReviewed: true, hostNames: ['fixture-store.example'],
  products: [{ productId: 'gid://shopify/Product/123', itemId: 'reviewed-item-123', collectionStartedAt: '2026-10-12T00:00:00.000Z', evidenceRef: 'synthetic-local-review' }] });
const identity = () => Object.fromEntries(['workspaceId', 'shopId', 'shopDomain', 'propertyId'].map(key => [key, binding()[key]]));
const auth = () => ({ version: 1, ...identity(), authorized: true, scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  expiresAt: '2026-10-21T00:00:00.000Z', accessToken: 'SYNTHETIC_LOCAL_AUTHORIZATION_SNAPSHOT' });
const scope = sampleKey => ({ ...identity(), productId: binding().products[0].productId, sampleKey,
  from: '2026-10-12T09:00:00.000Z', to: '2026-10-19T09:00:00.000Z' });
const noFetch = () => assert.fail('Configuration and missing authorization must not call a source.');

async function fixture(t, beforeCleanup = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ga4-config-fixture-'));
  t.after(async () => { await beforeCleanup(); await fs.rm(directory, { recursive: true, force: true }); });
  const filename = path.join(directory, 'config.json'), authorizationFile = path.join(directory, 'existing-authorization.json');
  const write = (file, value) => fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return { directory, filename, authorizationFile, write,
    config: changes => write(filename, { version: 1, binding: binding(), authorizationFile, ...changes }),
    authorization: changes => write(authorizationFile, { ...auth(), ...changes }) };
}

test('absent startup config stays absent; metadata without an existing provider is unconfigured', async t => {
  for (const value of [undefined, null, '']) assert.equal(await loadSupplierTrafficOptions(value), null);
  const f = await fixture(t);
  await f.config({ authorizationFile: undefined });
  const loaded = await loadSupplierTrafficOptions(f.filename, { clock });
  const adapter = createGa4ProductTrafficAdapter({ ...loaded, clock, fetchImpl: noFetch });
  assert.equal(loaded.getAuthorization, null);
  assert.equal(adapter.status().configured, false);
  assert.equal(adapter.status().status, 'unconfigured');
  const result = await adapter.readProductTraffic(scope('missing-provider'));
  assert.equal(result.status, 'unconfigured');
  assert.equal(result.metrics.productDetailViews.value, null);
});

test('startup reads only metadata; a referenced missing snapshot is never evidence of a connection', async t => {
  const f = await fixture(t); await f.config();
  const loaded = await loadSupplierTrafficOptions(f.filename, { clock });
  assert.deepEqual(loaded.binding, binding());
  assert.equal(typeof loaded.getAuthorization, 'function');
  const adapter = createGa4ProductTrafficAdapter({ ...loaded, clock, fetchImpl: noFetch });
  assert.equal(adapter.status().status, 'configured_unverified');
  const result = await adapter.readProductTraffic(scope('missing-file'));
  assert.equal(result.status, 'unconfigured'); assert.equal(result.error.code, 'GA4_AUTH_NOT_AUTHORIZED');
  assert.equal(result.metrics.productDetailViews.value, null); assert.equal(result.metrics.sessions.value, null);
  assert.equal((await fs.readdir(f.directory)).length, 1);
});

test('startup metadata can only bind the original host workspace and the loaded adapter rejects another caller before source reads', async t => {
  const f = await fixture(t); await f.config();
  await assert.rejects(loadSupplierTrafficOptions(f.filename, { clock, workspaceId: 'another-workspace' }), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
  const loaded = await loadSupplierTrafficOptions(f.filename, { clock, workspaceId: binding().workspaceId });
  const adapter = createGa4ProductTrafficAdapter({ ...loaded, clock, fetchImpl: noFetch });
  for (const changed of [{ workspaceId: 'another-workspace' }, { shopId: 'gid://shopify/Shop/2' }, { shopDomain: 'other.myshopify.com' }]) {
    const result = await adapter.readProductTraffic({ ...scope('different-fixed-scope'), ...changed });
    assert.equal(result.status, 'unsupported'); assert.equal(result.error.code, 'PRODUCT_TRAFFIC_STORE_MISMATCH');
    assert.equal(result.metrics.productDetailViews.value, null);
  }
});

test('existing authorization is pinned to exact workspace, shop, domain and property; unreviewed/aborted callers cannot read', async t => {
  const f = await fixture(t); await f.authorization();
  const provider = existingGa4AuthorizationProvider(f.authorizationFile, binding(), { clock });
  for (const change of [{ workspaceId: 'another-workspace' }, { shopId: 'gid://shopify/Shop/2' },
    { shopDomain: 'another.myshopify.com' }, { propertyId: '9999' }]) {
    assert.equal(await provider({ ...identity(), ...change }), null);
    await f.authorization(change); assert.equal(await provider(identity()), null);
  }
  await f.authorization();
  const unreviewed = existingGa4AuthorizationProvider(f.authorizationFile, { ...binding(), authorizationReviewed: false }, { clock });
  assert.equal(await unreviewed(identity()), null);
  assert.equal(await provider({ ...identity(), signal: AbortSignal.abort() }), null);
  assert.equal(await provider(null), null);
  const got = await provider(identity());
  assert.equal(got.accessToken, auth().accessToken); assert.equal(got.version, undefined);
});

test('existing producer rotation/revocation is observed on every invocation; reload never persists or restores credentials', async t => {
  const f = await fixture(t); await f.config(); await f.authorization();
  const first = await loadSupplierTrafficOptions(f.filename, { clock });
  assert.equal((await first.getAuthorization(identity())).accessToken, auth().accessToken);
  const rotated = { ...auth(), accessToken: 'SYNTHETIC_ROTATED_EXISTING_SNAPSHOT' };
  const nextFile = path.join(f.directory, 'producer-next.json');
  await f.write(nextFile, rotated); await fs.rename(nextFile, f.authorizationFile);
  assert.equal((await first.getAuthorization(identity())).accessToken, rotated.accessToken);
  const reloaded = await loadSupplierTrafficOptions(f.filename, { clock });
  assert.equal((await reloaded.getAuthorization(identity())).accessToken, rotated.accessToken);
  await f.authorization({ authorized: false });
  assert.equal(await first.getAuthorization(identity()), null); assert.equal(await reloaded.getAuthorization(identity()), null);
  await fs.unlink(f.authorizationFile); assert.equal(await first.getAuthorization(identity()), null);
  assert.deepEqual(await fs.readdir(f.directory), ['config.json']);
});

test('expired, malformed, ungranted, overbroad snapshots and inline credential/config extensions fail closed', async t => {
  const f = await fixture(t); const provider = existingGa4AuthorizationProvider(f.authorizationFile, binding(), { clock });
  for (const changes of [{ version: 2 }, { authorized: false }, { expiresAt: '2026-10-20T12:00:00.000Z' }, { expiresAt: '2026-02-30T12:00:00.000Z' },
    { scopes: [] }, { scopes: ['https://www.googleapis.com/auth/drive.readonly'] }, { accessToken: '' }, { accessToken: 'contains whitespace' },
    { refreshToken: 'SYNTHETIC_FORBIDDEN_REFRESH_TOKEN' }, { tokenUrl: 'https://untrusted.example' }]) {
    await f.authorization(changes); assert.equal(await provider(identity()), null);
  }
  for (const changes of [{ version: 2 }, { accessToken: 'SYNTHETIC_FORBIDDEN_INLINE_TOKEN' }, { authorizationFile: './relative.json' }, { authorizationFile: '' },
    { binding: { ...binding(), accessToken: 'SYNTHETIC_FORBIDDEN_NESTED_TOKEN' } }, { binding: { ...binding(), authorizationReviewed: undefined } },
    { binding: { ...binding(), products: [{ ...binding().products[0], refreshToken: 'SYNTHETIC_FORBIDDEN_NESTED_TOKEN' }] } },
    { binding: { ...binding(), products: [{ ...binding().products[0], itemId: '' }] } }]) {
    await f.config(changes); await assert.rejects(loadSupplierTrafficOptions(f.filename), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
  }
  await assert.rejects(loadSupplierTrafficOptions('relative.json'), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
});

test('private regular bounded files are required; unsafe file errors never expose contents or paths', async t => {
  const f = await fixture(t); await f.config(); await f.authorization();
  const provider = existingGa4AuthorizationProvider(f.authorizationFile, binding(), { clock });
  await fs.writeFile(f.authorizationFile, '{SYNTHETIC_SECRET_MALFORMED'); assert.equal(await provider(identity()), null);
  await fs.writeFile(f.authorizationFile, ' '.repeat(16_385)); assert.equal(await provider(identity()), null);
  await fs.writeFile(f.filename, '{SYNTHETIC_SECRET_MALFORMED');
  await assert.rejects(loadSupplierTrafficOptions(f.filename), error => error.code === 'PRODUCT_TRAFFIC_CONFIG_INVALID' && !error.message.includes('SYNTHETIC') && !error.message.includes(f.directory));
  await fs.writeFile(f.filename, ' '.repeat(1_000_001)); await assert.rejects(loadSupplierTrafficOptions(f.filename), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
  await f.config(); await f.authorization();
  if (process.platform !== 'win32') {
    await fs.chmod(f.authorizationFile, 0o644); assert.equal(await provider(identity()), null);
    await fs.chmod(f.filename, 0o644); await assert.rejects(loadSupplierTrafficOptions(f.filename), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
    await fs.chmod(f.filename, 0o600); await fs.chmod(f.authorizationFile, 0o600);
    const link = path.join(f.directory, 'linked.json'); await fs.symlink(f.authorizationFile, link);
    assert.equal(await existingGa4AuthorizationProvider(link, binding(), { clock })(identity()), null);
    await assert.rejects(loadSupplierTrafficOptions(link), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
    const hard = path.join(f.directory, 'hard.json'); await fs.link(f.authorizationFile, hard);
    assert.equal(await provider(identity()), null);
  }
});

test('loaded options reuse exact GA4 read adapter; source partial failure retains null then recovers from the same original sample', async t => {
  const f = await fixture(t); await f.config(); await f.authorization();
  const loaded = await loadSupplierTrafficOptions(f.filename, { clock });
  const calls = []; let failed = true;
  const adapter = createGa4ProductTrafficAdapter({ ...loaded, clock, fetchImpl: async (url, init) => {
    calls.push({ url, request: JSON.parse(init.body) });
    assert.equal(init.headers.Authorization, `Bearer ${auth().accessToken}`);
    assert.match(url, /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/1234:/);
    if (url.endsWith(':checkCompatibility')) return Response.json({
      dimensionCompatibilities: ['itemId', 'hostName', 'dateHourMinute'].map(apiName => ({ dimensionMetadata: { apiName }, compatibility: 'COMPATIBLE' })),
      metricCompatibilities: [{ metricMetadata: { apiName: 'itemViewEvents' }, compatibility: 'COMPATIBLE' }] });
    if (failed) return Response.json({ error: { message: 'SYNTHETIC_PRIVATE_SOURCE_ERROR' } }, { status: 503 });
    return Response.json({ kind: 'analyticsData#runReport', dimensionHeaders: ['itemId', 'hostName', 'dateHourMinute'].map(name => ({ name })),
      metricHeaders: [{ name: 'itemViewEvents', type: 'TYPE_INTEGER' }], rowCount: 1,
      rows: [{ dimensionValues: ['reviewed-item-123', 'fixture-store.example', '202610120901'].map(value => ({ value })), metricValues: [{ value: '4' }] }],
      metadata: { timeZone: 'UTC' } });
  } });
  const missing = await adapter.readProductTraffic(scope('original-sample'));
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.metrics.productDetailViews.value, null);
  assert.equal(JSON.stringify(missing).includes('SYNTHETIC_PRIVATE'), false);
  failed = false;
  const recovered = await adapter.readProductTraffic(scope('original-sample'));
  assert.equal(recovered.status, 'partial'); assert.equal(recovered.metrics.productDetailViews.value, 4);
  assert.equal(recovered.metrics.sessions.value, null); assert.equal(recovered.complete, false);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].request.dimensionFilter.andGroup.expressions[0].filter.stringFilter.value, 'reviewed-item-123');
  assert.deepEqual(calls[0].request.dimensionFilter.andGroup.expressions[1].filter.inListFilter.values, ['fixture-store.example']);
  assert.equal(JSON.stringify(recovered).includes(auth().accessToken), false);
  await f.authorization({ authorized: false });
  assert.equal((await adapter.readProductTraffic(scope('original-sample'))).status, 'unconfigured');
  assert.equal(calls.length, 4);
});

test('ordinary createApp environment loads reviewed GA4 metadata, keeps schedules disabled and reloads original monitor scope', async t => {
  const { createApp } = await import('../server/index.mjs');
  let app;
  const f = await fixture(t, async () => { await app?.close(); }), localBinding = { ...binding(), workspaceId: 'local' };
  await f.config({ binding: localBinding }); // Deliberately no authorization snapshot.
  const config = { dataDirectory: path.join(f.directory, 'store'),
    provider: { kind: 'fixture', configured: false, complete: noFetch }, accessClock: clock,
    capabilityEnvironment: { WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE: f.filename }, shopifyFetch: noFetch, schedulerIntervalMs: 60000 };
  app = await createApp(config);
  const capability = app.supplierService.catalog().services.find(row => row.id === 'supplier-listing-monitor');
  assert.equal(capability.trafficStatus, 'configured_unverified'); assert.equal(capability.traffic.supported, true);
  assert.equal(capability.traffic.configured, true); assert.equal(capability.traffic.metric, 'productDetailViews');
  assert.equal(capability.traffic.observationRequired, true); assert.equal(capability.traffic.sessionsAvailable, false);
  const actor = { subject: 'local-operator', workspaceId: 'local', role: 'admin' };
  const conversation = (await app.runtime.createConversation({ requestId: 'ga4-config-main', title: 'Synthetic configuration only' }, actor)).conversation;
  const service = (await app.supplierService.forActor(actor).request(conversation.id, { requestId: 'ga4-config-intake', facts: { name: 'Synthetic product' } })).service;
  const input = { requestId: 'ga4-config-original-monitor', expectedRevision: service.revision, shopifyProductId: binding().products[0].productId,
    startAt: '2026-10-12T09:00:00.000Z', confirmed: true };
  const first = await app.supplierService.forActor(actor).createMonitor(conversation.id, service.id, input);
  const expectedAdapterId = createGa4ProductTrafficAdapter({ binding: localBinding }).id;
  assert.equal(first.monitor.scope.trafficAdapterId, expectedAdapterId);
  assert.equal(first.monitor.scope.trafficContractVersion, 2);
  assert.equal(first.monitor.scope.trafficMetric, 'productDetailViewEvents');
  assert.equal(first.monitor.scheduleEnabled, false); assert.equal(first.monitor.productTrafficAvailable, false);
  await app.close(); app = await createApp(config);
  const replay = await app.supplierService.forActor(actor).createMonitor(conversation.id, service.id, input);
  assert.equal(replay.monitor.id, first.monitor.id); assert.equal(replay.monitor.scopeHash, first.monitor.scopeHash);
  assert.equal(replay.monitor.scope.trafficAdapterId, expectedAdapterId); assert.equal(replay.monitor.scheduleEnabled, false);
  assert.equal(app.store.read().workspaceSupplierServices.monitors.length, 1);
  assert.equal(JSON.stringify(app.store.read()).includes('authorizationFile'), false);
  assert.equal(JSON.stringify(app.store.read()).includes(f.filename), false);
});

test('explicit trusted GA4 options or adapter take precedence over environment loader without opening its path', async t => {
  const { createApp } = await import('../server/index.mjs');
  const f = await fixture(t);
  for (const [index, override] of [
    { supplierTrafficOptions: { binding: binding(), getAuthorization: null } },
    { supplierTrafficAdapter: createGa4ProductTrafficAdapter({ binding: binding(), fetchImpl: noFetch, clock }) },
  ].entries()) {
    const app = await createApp({ dataDirectory: path.join(f.directory, `store-${index}`), provider: { kind: 'fixture', configured: false, complete: noFetch },
      accessClock: clock, capabilityEnvironment: { WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE: path.join(f.directory, 'must-not-open-missing-config.json') },
      shopifyFetch: noFetch, ...override });
    const capability = app.supplierService.catalog().services[0];
    assert.equal(capability.trafficStatus, 'unconfigured'); assert.equal(capability.traffic.configured, false);
    await app.close();
  }
});

test('configured but invalid CLI metadata fails startup safely rather than silently claiming unsupported traffic', async t => {
  const { createApp } = await import('../server/index.mjs');
  const f = await fixture(t); await f.config({ accessToken: 'SYNTHETIC_FORBIDDEN_INLINE_TOKEN' });
  await assert.rejects(async () => { const app = await createApp({ dataDirectory: path.join(f.directory, 'store'), provider: { kind: 'fixture', configured: false, complete: noFetch },
    accessClock: clock, capabilityEnvironment: { WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE: f.filename }, shopifyFetch: noFetch }); await app.close(); },
  { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
});

test('ordinary createApp rejects environment metadata belonging to another workspace before any source access', async t => {
  const { createApp } = await import('../server/index.mjs');
  const f = await fixture(t); await f.config();
  await assert.rejects(async () => { const app = await createApp({ dataDirectory: path.join(f.directory, 'store'), provider: { kind: 'fixture', configured: false, complete: noFetch },
    accessClock: clock, capabilityEnvironment: { WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE: f.filename }, shopifyFetch: noFetch }); await app.close(); },
  { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
});

test('catalog distinguishes supported GA4 from missing configuration or an unreviewed authorization', async t => {
  const { createApp } = await import('../server/index.mjs');
  const f = await fixture(t);
  await f.config({ binding: { ...binding(), workspaceId: 'local', authorizationReviewed: false } });
  for (const [index, environment] of [{}, { WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE: f.filename }].entries()) {
    const app = await createApp({ dataDirectory: path.join(f.directory, `store-${index}`), provider: { kind: 'fixture', configured: false, complete: noFetch },
      accessClock: clock, capabilityEnvironment: environment, shopifyFetch: noFetch });
    try {
      const capability = app.supplierService.catalog().services[0];
      assert.equal(capability.traffic.supported, true); assert.equal(capability.trafficStatus, 'unconfigured');
      assert.equal(capability.traffic.observationRequired, true); assert.equal(capability.traffic.sessionsAvailable, false);
    } finally { await app.close(); }
  }
});
