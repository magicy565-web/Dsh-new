import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { openStore } from '../server/store.mjs';
import { createRuntime } from '../server/runtime.mjs';
import { createCapabilityService, capabilityPayloadHash, goalDefinition } from '../server/capabilities.mjs';
import { createShopifyClient } from '../server/shopify.mjs';
import { createGa4ProductTrafficAdapter } from '../server/product-traffic-ga4.mjs';
import { createMarketValidationMonitor } from '../server/market-validation-monitor.mjs';

// Real repository Store/Runtime/CapabilityService/Shopify client; inert HTTP and
// launch/outcome substitutes, a virtual clock, no real shop/model/acquisition.
const DAY = 86400000, productId = 'gid://shopify/Product/123', shopId = 'gid://shopify/Shop/1', variant = 'gid://shopify/ProductVariant/9';
const actor = { subject: 'local-operator', workspaceId: 'local' };
const order = (key, quantity, currentQuantity = quantity, cancelledAt = null) => ({ id: `gid://shopify/Order/${key}`,
  createdAt: '2026-10-12T09:01:00.000Z', updatedAt: '2026-10-12T09:01:00.000Z', test: false, cancelledAt,
  lineItems: { nodes: [{ id: `gid://shopify/LineItem/${key}`, quantity, currentQuantity, product: { id: productId }, variant: { id: variant } }], pageInfo: { hasNextPage: false } }, refunds: [] });
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/market-monitor-');
  let time = Date.parse('2026-10-12T10:00:00Z'), store, runtime, capabilities, monitor, receipt;
  let authorized = true, calls = 0, rows = [], failRead = false, defer = null, release = null, outcome = null, outcomesRead = 0, ga4Calls = 0;
  const fetchImpl = async (url, input) => {
    calls++; assert.equal(url, 'https://fixture-shop.myshopify.com/admin/api/2026-10/graphql.json');
    const { query, variables } = JSON.parse(input.body); let data;
    if (failRead) return new Response('fixture failure', { status: 503 });
    if (query.includes('WorkspaceShop')) data = { shop: { id: shopId, name: 'Fixture only', myshopifyDomain: 'fixture-shop.myshopify.com', currencyCode: 'USD' }, currentAppInstallation: { accessScopes: [{ handle: 'read_products' }, { handle: 'read_orders' }] } };
    else if (query.includes('WorkspaceSupplierProduct')) data = { product: { id: productId, title: 'Fixture only', status: 'ACTIVE', publishedAt: '2026-10-12T09:00:00Z', onlineStoreUrl: 'https://fixture-shop.myshopify.com/products/fixture', variants: { nodes: [{ id: variant }], pageInfo: { hasNextPage: false } } } };
    else if (query.includes('WorkspaceSupplierOrders')) {
      if (defer) { defer(); defer = null; await new Promise((resolve, reject) => { release = resolve; if (input.signal.aborted) reject(Error('fixture abort')); else input.signal.addEventListener('abort', () => reject(Error('fixture abort')), { once: true }); }); }
      const offset = Number(variables.after || 0), page = rows.slice(offset, offset + 1);
      data = { orders: { nodes: structuredClone(page), pageInfo: { hasNextPage: offset + 1 < rows.length, endCursor: String(offset + 1) } } };
    } else assert.fail('Unexpected Shopify operation: only existing read queries are allowed');
    return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json', 'X-Shopify-API-Version': '2026-10' } });
  };
  const start = async () => {
    store = await openStore(directory);
    capabilities = await createCapabilityService({ store, clock: () => time, environment: {}, dispatchGoal: args => monitor.dispatch(args) });
    runtime = await createRuntime({ store, capabilities, autoStart: false, provider: { kind: 'fixture', complete() { assert.fail('No model turn is permitted'); } } });
    if (!receipt) {
      const { conversation } = await runtime.createConversation({ title: 'Synthetic seven-day observation', requestId: 'market-fixture-conversation' }, actor);
      receipt = { id: 'launch-original', planId: 'plan-original', planRevision: 1, approved: true, status: 'launched', evidenceKind: 'real', launchKind: 'acquisition',
        startedAt: '2026-10-12T09:00:00.000Z', timezone: 'Asia/Shanghai', productId, variantIds: [variant], shopId, channelId: 'approved-source', businessMode: options.mode || 'b2c', conversationId: conversation.id };
    }
    const shopify = createShopifyClient({ clock: () => time, environment: options.noShop ? {} : { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'fixture-shop.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'synthetic-fixture-only' }, fetchImpl });
    const outcomeAdapter = options.outcomes ? { id: 'reviewed-outcomes', authorizationReviewed: true, async readOutcomes(scope) { outcomesRead++; return typeof outcome === 'function' ? outcome(scope) : { ...scope, sourceId: 'reviewed-outcomes', status: 'available', sampledAt: new Date(time).toISOString(), dataLagSeconds: 0, definition: scope.businessMode === 'b2b' ? 'Qualified means human-reviewed fit; requests and orders are separate source records, not summed.' : 'Exact-product/channel non-test fully paid order cohort; net counts exclude refunded/cancelled quantities.',
      metrics: scope.businessMode === 'b2b' ? { qualifiedInquiries: 3, quoteRequests: 2, sampleRequests: 1, orders: 0 } : { paidOrders: 0, paidUnits: 0, netPaidOrders: 0, netPaidUnits: 0, refundedUnits: 0 } }; } } : null;
    const trafficAdapter = options.ga4 ? createGa4ProductTrafficAdapter({ clock: () => time,
      binding: { workspaceId: actor.workspaceId, shopId, shopDomain: 'fixture-shop.myshopify.com', propertyId: '1234', mappingRevision: 'reviewed-fixture-mapping', authorizationReviewed: true,
        hostNames: ['fixture-store.example'], products: [{ productId, itemId: 'exact-product-item', collectionStartedAt: '2026-10-12T09:00:00.000Z', evidenceRef: 'fixture-only-reviewed-mapping' }] },
      getAuthorization: async () => ({ authorized: true, workspaceId: actor.workspaceId, shopId, shopDomain: 'fixture-shop.myshopify.com', propertyId: '1234', scopes: ['https://www.googleapis.com/auth/analytics.readonly'], expiresAt: new Date(time + DAY).toISOString(), accessToken: 'synthetic-ga4-fixture-only' }),
      fetchImpl: async (url, init) => {
        ga4Calls++; assert.match(url, /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/1234:(checkCompatibility|runReport)$/);
        assert.equal(init.method, 'POST');
        const data = url.endsWith(':checkCompatibility') ? { dimensionCompatibilities: ['itemId', 'hostName', 'dateHourMinute'].map(apiName => ({ dimensionMetadata: { apiName }, compatibility: 'COMPATIBLE' })), metricCompatibilities: [{ metricMetadata: { apiName: 'itemViewEvents' }, compatibility: 'COMPATIBLE' }] }
          : { kind: 'analyticsData#runReport', dimensionHeaders: ['itemId', 'hostName', 'dateHourMinute'].map(name => ({ name })), metricHeaders: [{ name: 'itemViewEvents', type: 'TYPE_INTEGER' }], rowCount: 1,
            rows: [{ dimensionValues: [{ value: 'exact-product-item' }, { value: 'fixture-store.example' }, { value: '202610120901' }], metricValues: [{ value: '3' }] }], metadata: { timeZone: 'Etc/UTC' } };
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      } }) : null;
    monitor = await createMarketValidationMonitor({ store, runtime, capabilities, shopify, clock: () => time, trafficAdapter,
      authorizeOwner: options.noOwner ? null : (_state, value) => authorized && value.subject === actor.subject && value.workspaceId === actor.workspaceId,
      resolveLaunchReceipt: options.noResolver ? null : async () => structuredClone(receipt), outcomeAdapter, ...options.monitorOptions });
  };
  const close = async () => { await monitor.close(); await capabilities.close(); await runtime.close(); await store.close(); };
  await start();
  t.after(async () => { await close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, get runtime() { return runtime; }, get capabilities() { return capabilities; }, get monitor() { return monitor; },
    get receipt() { return receipt; }, get calls() { return calls; }, get outcomesRead() { return outcomesRead; }, get ga4Calls() { return ga4Calls; },
    bound: () => monitor.forActor(actor), request: () => ({ requestId: 'create-original', planId: 'plan-original', planRevision: 1, launchReceiptId: 'launch-original' }),
    setTime: value => { time = typeof value === 'number' ? value : Date.parse(value); }, advance: value => { time += value; },
    rows: value => { rows = value; }, failReads: value => { failRead = value; }, outcome: value => { outcome = value; }, revoke: () => { authorized = false; },
    defer: () => new Promise(resolve => { defer = resolve; }), release: () => release?.(),
    restart: async () => { await close(); await start(); },
  };
}
const input = (task, requestId = 'observation-original') => ({ goalId: task.goalId, expectedScopeHash: task.scopeHash, requestId, confirmed: true });
const control = (task, action) => ({ goalId: task.goalId, expectedScopeHash: task.scopeHash, action, confirmed: true });
async function approve(f, task) {
  const scope = f.capabilities.scheduleApprovalRequest(task.scheduleId);
  const { approval } = await f.capabilities.requestApproval({ ...scope, expiresInSeconds: 300 });
  await f.capabilities.decideApproval(approval.id, { decision: 'approved', confirmed: true });
  await f.capabilities.enableSchedule(task.scheduleId, { approvalId: approval.id });
}

test('unconfigured, unapproved, fixture, publication-only, future and malformed receipt cannot create or start observations', async t => {
  for (const mode of ['noResolver', 'noOwner', 'unapproved', 'fixture', 'publication', 'future', 'timezone', 'invalidDate', 'missingVariants']) {
    const f = await fixture(t, { [mode]: true });
    if (mode === 'unapproved') f.receipt.approved = false;
    if (mode === 'fixture') f.receipt.evidenceKind = 'fixture';
    if (mode === 'publication') f.receipt.launchKind = 'publication';
    if (mode === 'future') f.receipt.startedAt = '2027-10-12T09:00:00Z';
    if (mode === 'timezone') f.receipt.timezone = 'Mars/Factory';
    if (mode === 'invalidDate') f.receipt.startedAt = '2026-02-30T09:00:00Z';
    if (mode === 'missingVariants') delete f.receipt.variantIds;
    await assert.rejects(f.bound().create(f.request()));
    assert.equal(f.store.read().goals.length, 0); assert.equal(f.store.read().capabilities.schedules.length, 0); assert.equal(f.calls, 0);
  }
});
test('create accepts only references; one receipt maps to one durable Goal/Schedule under concurrency and restart', async t => {
  const f = await fixture(t);
  await assert.rejects(f.bound().create({ ...f.request(), startedAt: '2026-10-12T09:00:00Z' }), { code: 'INVALID_INPUT' });
  const tasks = await Promise.all([f.bound().create(f.request()), f.bound().create({ ...f.request(), requestId: 'other-transport-request' })]);
  assert.equal(tasks[0].goalId, tasks[1].goalId); assert.equal(tasks[0].scheduleEnabled, false);
  assert.equal(tasks[0].baseline.status, 'unavailable'); assert.equal(tasks[0].startAt, f.receipt.startedAt);
  assert.equal(f.store.read().capabilities.scheduleRuns.length, 0); assert.equal(f.calls, 0);
  await f.restart(); const restored = await f.bound().create(f.request());
  assert.equal(restored.goalId, tasks[0].goalId); assert.equal(f.store.read().goals.length, 1); assert.equal(f.store.read().capabilities.schedules.length, 1);
  await assert.rejects(f.runtime.updateGoal(restored.goalId, { action: 'start', requestId: 'forbidden-model' }), { code: 'SERVICE_TASK_MODEL_FORBIDDEN' });
});
test('missing baseline permits authorized observation, but measured zero and window completion never verify the goal', async t => {
  const f = await fixture(t, { outcomes: true });
  f.receipt.salesRequirement = { metric: 'net_paid_units', target: 0, definition: 'Synthetic target only; an observation is not goal adjudication.' };
  const task = await f.bound().create(f.request());
  assert.equal(task.baseline.status, 'unavailable'); assert.equal(task.baseline.value, null); assert.equal(task.scheduleEnabled, false);
  f.advance(8 * DAY);
  const result = await f.bound().observe(input(task));
  assert.equal(result.summary.baseline.status, 'unavailable'); assert.equal(result.summary.baseline.value, null);
  assert.equal(result.observation.sample.outcomes.status, 'available'); assert.equal(result.observation.sample.outcomes.metrics.netPaidUnits, 0);
  assert.equal(result.summary.measurement.status, 'observed_not_adjudicated'); assert.equal(result.summary.provisional, false);
  assert.equal(result.summary.goalVerified, false); assert.equal(f.bound().get(task.goalId).status, 'window_ended');
  assert.equal(f.store.read().runs.length, 0);
});
test('original schedule approval and dispatch run seven daily observations with unchanged goal hash and no model', async t => {
  const f = await fixture(t, { outcomes: true }), task = await f.bound().create(f.request());
  await assert.rejects(f.capabilities.enableSchedule(task.scheduleId, {}), { code: 'APPROVAL_REQUIRED' });
  await f.monitor.dispatch({ goalId: task.goalId, requestId: 'forged' }).then(() => assert.fail('forged dispatch accepted'), error => assert.equal(error.code, 'SCHEDULE_CLAIM_RETIRED'));
  f.advance(DAY); assert.deepEqual((await f.capabilities.tick()).runs, []);
  await approve(f, task);
  const before = capabilityPayloadHash(goalDefinition(f.store.read().goals[0], f.store.read()));
  for (let day = 1; day <= 7; day++) {
    f.setTime(Date.parse(task.startAt) + day * DAY + 1000);
    const tick = await f.capabilities.tick(); assert.equal(tick.runs.length, 1); assert.equal(tick.runs[0].status, 'completed', JSON.stringify(tick));
    assert.equal(tick.runs[0].serviceReceipt.modelRequired, false);
    assert.deepEqual((await f.capabilities.tick()).runs, []);
    assert.equal(capabilityPayloadHash(goalDefinition(f.store.read().goals[0], f.store.read())), before);
    if (day === 3) await f.restart();
  }
  const result = f.bound().get(task.goalId);
  assert.equal(result.observations.length, 7); assert.equal(result.summary.provisional, false); assert.equal(result.status, 'window_ended');
  assert.equal(result.scheduleEnabled, false); assert.equal(f.store.read().runs.length, 0);
  f.advance(DAY); assert.deepEqual((await f.capabilities.tick()).runs, []);
});
test('downtime catch-up preserves missed days, one final summary, and never fabricates seven daily samples', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request()); await approve(f, task);
  f.advance(8 * DAY); await f.restart();
  const tick = await f.capabilities.tick(); assert.equal(tick.runs[0].status, 'completed');
  const result = f.bound().get(task.goalId);
  assert.equal(result.observations.length, 1); assert.deepEqual(result.missedDays, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.summary.provisional, true); assert.equal(result.summary.recommendation, 'adjust_measurement');
  assert.equal(result.summary.sample.outcomes.value, null);
  assert.equal(f.store.read().messages.filter(row => row.id === result.summary.messageId).length, 1);
  assert.equal(result.summary.endAt, task.endAt);
});
test('concurrent duplicate reads and restart replay neither query sources twice nor revise the original frozen result', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request());
  const results = await Promise.all([f.bound().observe(input(task)), f.bound().observe(input(task))]);
  assert.equal(results[0].observation.to, results[1].observation.to);
  const calls = f.calls; await f.restart(); f.advance(8 * DAY);
  const duplicate = await f.bound().observe(input(task)); assert.equal(duplicate.duplicate, true); assert.equal(f.calls, calls); assert.equal(duplicate.summary, null);
  const final = await f.bound().observe(input(task, 'final-real-window-fixture')); assert.equal(final.observation.to, task.endAt); assert.ok(final.summary);
});
test('pause persists, resume requires fresh original schedule approval, and cancel is terminal', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request()); await approve(f, task);
  await f.bound().control(control(task, 'pause')); await f.restart(); f.advance(DAY);
  assert.deepEqual((await f.capabilities.tick()).runs, []);
  await assert.rejects(f.bound().observe(input(task)), { code: 'MONITOR_STOPPED' });
  const resumed = await f.bound().control(control(task, 'resume')); assert.equal(resumed.scheduleEnabled, false);
  await approve(f, task); assert.equal((await f.capabilities.tick()).runs[0].status, 'completed');
  await f.bound().control(control(task, 'cancel')); await f.restart();
  await assert.rejects(f.bound().control(control(task, 'resume')), { code: 'MONITOR_CANCELLED' });
  await assert.rejects(f.bound().observe(input(task)), { code: 'MONITOR_STOPPED' });
  f.advance(10 * DAY); assert.deepEqual((await f.capabilities.tick()).runs, []);
});
test('cancel during an in-flight source read aborts and fences completion', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request()), entered = f.defer();
  const reading = f.bound().observe(input(task)).catch(error => error); await entered;
  await f.bound().control(control(task, 'cancel'));
  assert.equal((await reading).code, 'OBSERVATION_INTERRUPTED');
  assert.equal(f.bound().get(task.goalId).observations[0].status, 'interrupted'); assert.equal(f.bound().get(task.goalId).summary, null);
});
test('shutdown and restart reconcile the frozen interval without claiming the later final window', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request()), entered = f.defer();
  const reading = f.bound().observe(input(task)).catch(error => error); await entered;
  await f.monitor.close(); assert.equal((await reading).code, 'OBSERVATION_INTERRUPTED');
  f.advance(8 * DAY); await f.restart();
  const result = await f.bound().observe(input(task)); assert.equal(result.observation.to, '2026-10-12T10:00:00.000Z'); assert.equal(result.summary, null);
  assert.equal(f.bound().get(task.goalId).observations.length, 1);
});
test('real Shopify client paginates quantities but never relabels retained units as paid or channel-attributed sales', async t => {
  const f = await fixture(t); f.rows([order(1, 4, 2), order(2, 3, 0, '2026-10-12T09:30:00Z')]);
  const task = await f.bound().create(f.request()), { observation } = await f.bound().observe(input(task));
  assert.equal(observation.sample.cohort.status, 'available'); assert.equal(observation.sample.cohort.quantities.retainedUnits, 2);
  assert.equal(observation.sample.cohort.quantities.cancelledUnits, 3); assert.equal(observation.sample.cohort.paidStatus, 'unsupported');
  assert.equal(observation.sample.cohort.attribution, 'exact_product_all_channels'); assert.equal(observation.sample.outcomes.value, null);
  assert.equal(observation.sample.traffic.status, 'unconfigured'); assert.ok(f.calls >= 4);
});
test('unconfigured data, failed reads, partial/delayed observations and measured zero stay distinct', async t => {
  const missing = await fixture(t, { noShop: true }), missingTask = await missing.bound().create(missing.request());
  const unavailable = (await missing.bound().observe(input(missingTask))).observation.sample;
  assert.equal(unavailable.cohort.status, 'unconfigured'); assert.equal(unavailable.cohort.value, null); assert.equal(missing.calls, 0);
  const f = await fixture(t, { outcomes: true }), task = await f.bound().create(f.request());
  const zero = (await f.bound().observe(input(task))).observation.sample;
  assert.equal(zero.cohort.quantities.grossUnits, 0); assert.equal(zero.outcomes.status, 'available'); assert.equal(zero.outcomes.metrics.paidUnits, 0);
  f.failReads(true); const failure = (await f.bound().observe(input(task, 'failed-sources'))).observation.sample;
  assert.equal(failure.cohort.status, 'unavailable'); assert.equal(failure.cohort.value, null); assert.equal(failure.errors[0].source, 'shopify');
  f.outcome(scope => ({ ...scope, sourceId: 'reviewed-outcomes', status: 'delayed', sampledAt: '2026-10-12T10:00:00.000Z', dataLagSeconds: 3600, definition: 'Exact paid source, one hour delayed', metrics: { paidOrders: 2, paidUnits: 3, netPaidOrders: 1, netPaidUnits: 1, refundedUnits: 2 } }));
  const delayed = (await f.bound().observe(input(task, 'delayed-sources'))).observation.sample;
  assert.equal(delayed.outcomes.status, 'delayed'); assert.equal(delayed.outcomes.dataLagSeconds, 3600); assert.equal(delayed.outcomes.metrics.paidUnits, 3);
});
test('B2B qualification, quote/sample requests and orders remain independent; cross-product/channel observations fail closed', async t => {
  const f = await fixture(t, { mode: 'b2b', outcomes: true }), task = await f.bound().create(f.request());
  const result = (await f.bound().observe(input(task))).observation.sample.outcomes;
  assert.deepEqual(result.metrics, { qualifiedInquiries: 3, quoteRequests: 2, sampleRequests: 1, orders: 0 }); assert.equal(result.metrics.paidUnits, undefined);
  f.outcome(scope => ({ ...scope, productId: 'gid://shopify/Product/999', sourceId: 'reviewed-outcomes', status: 'available', sampledAt: '2026-10-12T10:00:00Z', dataLagSeconds: null, definition: 'wrong product', metrics: { qualifiedInquiries: 100, quoteRequests: 0, sampleRequests: 0, orders: 0 } }));
  const invalid = (await f.bound().observe(input(task, 'wrong-product'))).observation.sample;
  assert.equal(invalid.outcomes.value, null); assert.ok(invalid.errors.some(row => row.code === 'OUTCOME_OBSERVATION_INVALID'));
});
test('late corrections update one summary, identical values after restart preserve its revision', async t => {
  const f = await fixture(t, { outcomes: true }), task = await f.bound().create(f.request()); f.advance(8 * DAY);
  const first = await f.bound().observe(input(task)); assert.equal(first.summary.revision, 1);
  await f.restart(); f.advance(DAY);
  const same = await f.bound().observe(input(task, 'same-evidence')); assert.equal(same.summary.revision, 1);
  f.rows([order(1, 2)]);
  const changed = await f.bound().observe(input(task, 'late-correction')); assert.equal(changed.summary.revision, 2); assert.equal(changed.summary.corrected, true);
  assert.equal(changed.summary.messageId, first.summary.messageId); assert.equal(f.store.read().messages.filter(row => row.id === first.summary.messageId).length, 1);
  await assert.rejects(f.bound().control(control(task, 'resume')), { code: 'MONITOR_WINDOW_ENDED' });
});
test('owner revocation, stale scope hashes and changed original launch receipts cannot start a read', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request());
  await assert.rejects(f.bound().observe({ ...input(task), expectedScopeHash: 'wrong' }), { code: 'MONITOR_SCOPE_CHANGED' });
  f.receipt.startedAt = '2026-10-12T08:00:00Z'; await assert.rejects(f.bound().observe(input(task)), { code: 'LAUNCH_SCOPE_CHANGED' });
  f.revoke(); await assert.rejects(f.bound().observe(input(task)), { code: 'MONITOR_AUTHORIZATION_REQUIRED' }); assert.equal(f.calls, 0);
});
test('launch revocation during read prevents committing evidence, and generic original Goal cancellation is honored', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request()), entered = f.defer();
  const reading = f.bound().observe(input(task)).catch(error => error); await entered; f.receipt.approved = false; f.release();
  assert.equal((await reading).code, 'REAL_LAUNCH_RECEIPT_REQUIRED'); assert.equal(f.bound().get(task.goalId).observations[0].status, 'interrupted');
  f.receipt.approved = true; await f.runtime.updateGoal(task.goalId, { action: 'cancel', requestId: 'cancel-original' });
  await assert.rejects(f.bound().observe(input(task)), { code: 'MONITOR_STOPPED' });
});
test('real start and IANA timezone survive a DST boundary without extending elapsed seven-day duration', async t => {
  const f = await fixture(t); f.setTime('2026-11-01T06:00:00Z'); f.receipt.startedAt = '2026-11-01T05:00:00Z'; f.receipt.timezone = 'America/New_York';
  const task = await f.bound().create(f.request()); assert.equal(Date.parse(task.endAt) - Date.parse(task.startAt), 7 * DAY);
  assert.equal(task.endAt, '2026-11-08T05:00:00.000Z'); assert.equal(task.timezone, 'America/New_York');
});
test('existing GA4 adapter runs unchanged: detail view events stay partial, sessions unavailable, stable summary across restart', async t => {
  const f = await fixture(t, { ga4: true }), task = await f.bound().create(f.request()); f.advance(8 * DAY);
  const first = await f.bound().observe(input(task));
  assert.equal(first.observation.sample.traffic.metrics.productDetailViews.value, 3);
  assert.equal(first.observation.sample.traffic.metrics.sessions.value, null); assert.equal(first.observation.sample.traffic.status, 'partial');
  assert.equal(first.observation.sample.traffic.freshness, 'unknown'); assert.equal(first.observation.sample.funnel.addToCarts.value, null);
  assert.equal(first.summary.provisional, true); assert.equal(f.ga4Calls, 2);
  await f.restart(); f.advance(DAY);
  const repeated = await f.bound().observe(input(task, 'ga4-repeat'));
  assert.equal(repeated.summary.revision, 1); assert.equal(repeated.summary.messageId, first.summary.messageId);
});
test('failed source recovery uses a new observation; delayed or inconsistent paid data cannot become complete zero', async t => {
  const f = await fixture(t, { outcomes: true }), task = await f.bound().create(f.request());
  f.failReads(true); const first = await f.bound().observe(input(task)); assert.equal(first.observation.sample.cohort.value, null);
  f.failReads(false); const retry = await f.bound().observe(input(task, 'source-retry'));
  assert.equal(retry.observation.sample.cohort.quantities.grossOrders, 0); assert.equal((await f.bound().observe(input(task))).duplicate, true);
  for (const invalid of [{ dataLagSeconds: 300 }, { metrics: { paidOrders: 0, paidUnits: 0, netPaidOrders: 1, netPaidUnits: 0, refundedUnits: 0 } }, { sampledAt: '2026-10-12T09:30:00.000Z' }]) {
    f.outcome(scope => ({ ...scope, sourceId: 'reviewed-outcomes', status: 'available', sampledAt: '2026-10-12T10:00:00.000Z', dataLagSeconds: 0, definition: 'Fixture complete paid cohort', metrics: { paidOrders: 0, paidUnits: 0, netPaidOrders: 0, netPaidUnits: 0, refundedUnits: 0 }, ...invalid }));
    const result = await f.bound().observe(input(task, 'invalid-' + f.outcomesRead));
    assert.equal(result.observation.sample.outcomes.status, 'unavailable'); assert.equal(result.observation.sample.outcomes.metrics.paidUnits, null);
  }
});
test('original scheduler fences a mutated goal definition and the monitor rejects retired forged claims', async t => {
  const f = await fixture(t), task = await f.bound().create(f.request()); await approve(f, task);
  const schedule = f.store.read().capabilities.schedules[0];
  await assert.rejects(f.monitor.dispatch({ goalId: task.goalId, requestId: 'forged-approved-schedule', expectedGoalDefinitionHash: schedule.consent.definitionHash,
    scheduleClaim: { id: 'nonexistent-run', scheduleId: schedule.id, scheduleRevision: schedule.revision, goalId: task.goalId, requestId: 'forged-approved-schedule' } }), { code: 'SCHEDULE_CLAIM_RETIRED' });
  await f.runtime.updateGoal(task.goalId, { description: 'Changed original task definition' }); f.advance(DAY);
  assert.deepEqual((await f.capabilities.tick()).runs, []); assert.equal(f.capabilities.getSchedule(task.scheduleId).status, 'blocked'); assert.equal(f.calls, 0);
});
test('business-Agent-owned conversations retain the original Runtime fence instead of opening a second loop', async t => {
  const f = await fixture(t);
  await f.store.update(state => { state.conversations[0].businessAgentOwner = { subject: actor.subject, workspaceId: actor.workspaceId }; });
  await assert.rejects(f.runtime.createGoal({ title: 'Forbidden generic loop', conversationId: f.receipt.conversationId }), { code: 'BUSINESS_AGENT_CONVERSATION_ONLY' });
  await assert.rejects(f.bound().create(f.request()), { code: 'MONITOR_CONFIRMATION_REQUIRED' });
  assert.equal(f.store.read().goals.length, 0); assert.equal(f.calls, 0);
});
test('verified baseline retains exact prelaunch source and window; late or cross-channel baselines cannot start the task', async t => {
  const baseline = { status: 'available', sourceId: 'original-measurement-service', evidenceRef: 'baseline-original', productId, variantIds: [variant], shopId,
    channelId: 'approved-source', businessMode: 'b2c', observedAt: '2026-10-12T09:00:00.000Z', coverage: { from: '2026-10-11T09:00:00.000Z', to: '2026-10-12T09:00:00.000Z' },
    metrics: { net_paid_units: { value: 0, definition: 'Original verified prelaunch paid units for this product and channel.' } } };
  const f = await fixture(t); f.receipt.baseline = baseline;
  const task = await f.bound().create(f.request()); assert.equal(task.baseline.status, 'available'); assert.equal(task.baseline.metrics.net_paid_units.value, 0); assert.equal(task.baseline.evidenceRef, 'baseline-original');
  for (const change of [{ channelId: 'different-channel' }, { coverage: { from: baseline.coverage.from, to: '2026-10-12T10:00:00.000Z' } }]) {
    const invalid = await fixture(t); invalid.receipt.baseline = { ...baseline, ...change };
    await assert.rejects(invalid.bound().create(invalid.request()), { code: 'BASELINE_EVIDENCE_INVALID' }); assert.equal(invalid.store.read().goals.length, 0);
  }
});
test('selected plan visits/cart/checkout/refunds expose gaps rather than substituting view events or refunded units', async t => {
  const f = await fixture(t, { outcomes: true, ga4: true });
  f.receipt.requiredMetrics = ['visits', 'add_to_cart', 'checkouts', 'refunds', 'net_paid_units'].map(id => ({ id, definition: `Original selected ${id} definition` }));
  const task = await f.bound().create(f.request()); f.advance(8 * DAY);
  const first = await f.bound().observe(input(task)), measured = first.summary.measurement;
  assert.equal(first.observation.sample.traffic.metrics.productDetailViews.value, 3);
  assert.equal(measured.metrics.net_paid_units.value, 0); assert.equal(measured.metrics.visits.value, null); assert.equal(measured.metrics.refunds.value, null);
  assert.deepEqual(measured.gaps.map(item => item.metric), ['visits', 'add_to_cart', 'checkouts', 'refunds']);
  assert.equal(measured.status, 'insufficient_evidence'); assert.equal(first.summary.goalVerified, false); assert.equal(first.summary.provisional, true);
  f.outcome(scope => ({ ...scope, sourceId: 'reviewed-outcomes', status: 'available', sampledAt: new Date(Date.parse(task.endAt) + DAY).toISOString(), dataLagSeconds: 0,
    definition: 'Already authorized exact-channel visits, cart/checkout events, actual refund count and net paid units; counts are distinct.',
    metrics: { visits: 2, add_to_cart: 0, checkouts: 0, refunds: 0, netPaidUnits: 0 } }));
  const second = await f.bound().observe(input(task, 'selected-funnel-source'));
  assert.equal(second.summary.measurement.status, 'observed_not_adjudicated'); assert.equal(second.summary.measurement.metrics.visits.value, 2);
  assert.equal(second.summary.goalVerified, false); assert.equal(second.summary.messageId, first.summary.messageId); assert.equal(f.store.read().goals.length, 1);
});

test('original final summary includes evidence assessment; contract fixture can pass 70% but never verifies Goal or proves real payment', async t => {
  for (const missingRequired of [false, true]) {
  const f = await fixture(t, { outcomes: true });
  if (missingRequired) f.receipt.requiredMetrics = [{ id: 'net_paid_units', definition: 'Required net paid units' }, { id: 'checkouts', definition: 'Required exact checkouts, not connected' }];
  const selection = { metric: 'sales_units', category: 'synthetic cups', region: 'synthetic', channelId: f.receipt.channelId,
    unit: 'net_paid_units_per_168h', benchmarkWindow: { from: '2026-10-04T09:00:00.000Z', to: '2026-10-11T09:00:00.000Z' }, benchmarkSourceId: 'fixture-benchmark', validVisitDefinition: 'synthetic exact-channel valid visits', minimumValidVisits: 100 };
  f.receipt.resultAssessment = selection;
  f.receipt.marketBenchmark = { ...selection, coverage: { ...selection.benchmarkWindow }, sourceId: selection.benchmarkSourceId, evidenceRef: 'synthetic-benchmark-not-live', windowHours: 168, value: 100,
    observedAt: '2026-10-11T09:00:00.000Z', evidenceKind: 'real', reviewed: true };
  delete f.receipt.marketBenchmark.benchmarkWindow; delete f.receipt.marketBenchmark.minimumValidVisits; delete f.receipt.marketBenchmark.benchmarkSourceId;
  const task = await f.bound().create(f.request());
  f.outcome(scope => ({ ...scope, sourceId: 'reviewed-outcomes', status: 'available', sampledAt: new Date(Date.parse(scope.to) + 1000).toISOString(), dataLagSeconds: 0,
    definition: 'Synthetic contract: exact channel/product net paid counts; no real payments connected.', metrics: { netPaidUnits: 70, netPaidOrders: 7 },
    resultEvidence: { evidenceKind: 'real', evidenceRef: 'synthetic-payment-not-live', paymentStatus: 'net_paid_verified', coverageRatio: 1,
      validVisitDefinition: selection.validVisitDefinition, validVisits: 100, qualifiedInquiries: 0 } }));
  f.advance(8 * DAY); const result = await f.bound().observe(input(task));
  if (missingRequired) {
    assert.equal(result.summary.assessment.status, 'insufficient_evidence'); assert.equal(result.summary.assessment.provisional, true);
    assert.equal(result.observation.sample.outcomes.metrics.netPaidUnits, 70);
    assert.deepEqual(result.summary.assessment.requiredMetricGaps.map(row => row.metric), ['checkouts']);
  } else { assert.equal(result.summary.assessment.status, 'passed'); assert.equal(result.summary.assessment.ratio, .7); }
  assert.equal(result.summary.assessment.benchmark.sourceId, 'fixture-benchmark'); assert.equal(result.summary.goalVerified, false);
  assert.equal(f.bound().get(task.goalId).goalStatus, 'review_required');
  assert.equal(f.store.read().runs.length, 0);
  }
});

test('reviewed outcome adapter rejects contradictory net payment and over-one conversion proportions without recording a measured zero', async t => {
  for (const conversion of [false, true]) {
    const f = await fixture(t, { outcomes: true, noShop: true });
    if (conversion) f.receipt.resultAssessment = { metric: 'conversion_rate', category: 'fixture', region: 'fixture', channelId: f.receipt.channelId,
      unit: 'net_paid_orders_per_valid_visit', benchmarkSourceId: 'unconnected', benchmarkWindow: { from: '2026-10-04T09:00:00.000Z', to: '2026-10-11T09:00:00.000Z' }, validVisitDefinition: 'One attributed conversion at most per valid visit', minimumValidVisits: 100 };
    const task = await f.bound().create(f.request());
    f.outcome(scope => ({ ...scope, sourceId: 'reviewed-outcomes', status: 'available', sampledAt: new Date(Date.parse(scope.to) + 1000).toISOString(), dataLagSeconds: 0,
      definition: 'Synthetic adversarial payment contract', metrics: conversion ? { netPaidUnits: 101, netPaidOrders: 101 } : { netPaidUnits: 70, netPaidOrders: 0 },
      resultEvidence: { evidenceKind: 'real', evidenceRef: 'synthetic-invalid-payment', paymentStatus: 'net_paid_verified', coverageRatio: 1,
        validVisitDefinition: 'One attributed conversion at most per valid visit', validVisits: 100, qualifiedInquiries: 0 } }));
    f.advance(8 * DAY); const result = await f.bound().observe(input(task));
    assert.equal(result.observation.sample.outcomes.status, 'unavailable'); assert.equal(result.observation.sample.outcomes.metrics.netPaidUnits, null);
    assert.ok(result.observation.sample.errors.some(error => error.code === 'OUTCOME_OBSERVATION_INVALID'));
    assert.equal(result.summary.assessment.status, 'insufficient_evidence'); assert.equal(result.summary.assessment.provisional, true);
    assert.equal(result.summary.goalVerified, false);
  }
});
