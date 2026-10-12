import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createApp } from '../server/index.mjs';
import { createSevenDayNotifications } from '../server/notification-adapters/seven-day-notifications.mjs';
import { createWechatSubscriptionAdapter, classifyWechatSubscriptionResponse } from '../server/notification-adapters/wechat-subscription.mjs';
import { supplierHash } from '../server/supplier-profile.mjs';
import { notificationFixture, FIXTURE_APP_ID, FIXTURE_TEMPLATE, FIXTURE_OPENID, FIXTURE_TOKEN } from './fixtures/seven-day-notification-fixture.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('default blocked adapter and original real supplier monitor create no extra tasks, messages or network calls', async t => {
  const directory = await fs.mkdtemp('/tmp/notification-original-monitor-');
  const app = await createApp({ dataDirectory: directory, provider: { kind: 'fixture', configured: false }, capabilityEnvironment: {} });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const actor = { subject: 'local-operator', workspaceId: 'local', role: 'admin' };
  const main = (await app.runtime.createConversation({ requestId: 'notification-real-conversation', title: 'Local fixture integration' }, actor)).conversation;
  const bound = app.supplierService.forActor(actor);
  const service = (await bound.request(main.id, { requestId: 'notification-real-service', facts: { name: 'Local integration fixture' } })).service;
  const { monitor } = await bound.createMonitor(main.id, service.id, { requestId: 'notification-real-monitor', expectedRevision: service.revision,
    shopifyProductId: 'gid://shopify/Product/123', startAt: '2026-10-01T09:00:00Z', confirmed: true });
  await bound.checkMonitor(main.id, service.id, { requestId: 'notification-real-summary', monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, confirmed: true });
  const notifications = createSevenDayNotifications({ store: app.store });
  assert.equal(notifications.status().code, 'NOTIFICATION_UNCONFIGURED');
  const original = app.store.read(), result = notifications.forActor(actor).get(main.id, service.id, monitor.id);
  assert.equal(result.status, 'blocked'); assert.equal(result.submittedSummary, null); assert.equal(result.latestSummary.revision, 1);
  assert.equal(original.goals.length, 1); assert.equal(original.capabilities.schedules.length, 1);
  assert.equal(original.messages.filter(message => message.id === result.latestSummary.messageId).length, 1);
  const transport = createWechatSubscriptionAdapter({ fetchImpl() { assert.fail('Disabled adapter attempted network'); } });
  assert.equal((await transport.send()).status, 'blocked');
});

test('local fixture accepted result has minimized wire payload, durable grant/key, one POST across replay and restart', async t => {
  const f = await notificationFixture(t); assert.equal((await f.configure()).status, 'ready'); assert.equal(f.calls.length, 0);
  const result = await f.send(); assert.equal(result.status, 'platform_accepted'); assert.equal(result.evidenceKind, 'local_fixture');
  assert.equal(result.userRead, 'unknown'); assert.equal(result.businessAcceptance, 'not_recorded');
  assert.equal(result.automaticRetry, false); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body, { touser: FIXTURE_OPENID, template_id: FIXTURE_TEMPLATE, miniprogram_state: 'formal',
    lang: 'zh_CN', data: { thing1: { value: '七天经营总结' }, phrase2: { value: '待核实' }, date3: { value: '2026-10-19' } } });
  for (const secret of [FIXTURE_OPENID, FIXTURE_TOKEN, 'PRIVATE NEVER SEND', 'retainedUnits', 'local-fixture-proof']) assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(f.store.read().workspaceSupplierServices.monitors[0].fixtureSubscription.state, 'consumed');
  const state = f.store.read(), count = state.workspaceSupplierServices.commands.length;
  assert.equal(count, 2); assert.equal(state.workspaceSupplierServices.monitors.length, 1);
  await f.restart(); assert.equal((await f.send()).deliveryKey, result.deliveryKey);
  assert.equal((await f.send({ requestId: 'fixture-other-request' })).status, 'platform_accepted'); assert.equal(f.calls.length, 1);
});

test('same summary corrections retain submitted version/key and do not make another POST or allow reconfiguration', async t => {
  const f = await notificationFixture(t); await f.configure(); const original = await f.send();
  await f.change(row => { row.summary.revision = 2; row.summary.contentHash = 'b'.repeat(64); row.summary.provisional = false; });
  const corrected = await f.send({ requestId: 'fixture-correction', expectedSummaryRevision: 2, expectedSummaryHash: 'b'.repeat(64) });
  assert.equal(corrected.summaryCorrectedAfterSubmission, true); assert.equal(corrected.submittedSummary.revision, 1);
  assert.equal(corrected.latestSummary.revision, 2); assert.equal(corrected.deliveryKey, original.deliveryKey); assert.equal(f.calls.length, 1);
  await assert.rejects(f.bound().configure(f.cid, f.sid, { ...f.configureBody, requestId: 'rebind-after-submission' }), { code: 'NOTIFICATION_ALREADY_ATTEMPTED' });
});

test('two concurrent original task calls claim one receipt/grant and perform one POST', async t => {
  const entered = deferred(), finish = deferred();
  const f = await notificationFixture(t, { fetchImpl: async () => { entered.resolve(); await finish.promise; return new Response('{"errcode":0,"errmsg":"ok"}'); } });
  await f.configure(); const first = f.send(); await entered.promise;
  const second = await f.send({ requestId: 'concurrent-second' }); assert.equal(second.status, 'dispatching'); assert.equal(f.calls.length, 1);
  finish.resolve(); assert.equal((await first).status, 'platform_accepted');
});

test('rejected/filtered/missing/stale/wrong-scope/non-real subscription never sends or reserves a grant', async t => {
  for (const [label, change] of Object.entries({ reject: { decision: 'reject' }, ban: { decision: 'ban' }, filter: { decision: 'filter' },
    preference: { source: 'wx.getSetting' }, missingProof: { proofId: null }, anotherApp: { appId: 'wxaaaaaaaaaaaaaaaa' },
    anotherOwner: { subject: 'someone-else' }, anotherMonitor: { monitorId: 'wrong-monitor' }, staleBinding: { bindingRevision: 2 },
    expired: { expiresAt: '2026-10-10T00:00:00Z' }, future: { acceptedAt: '2026-11-01T00:00:00Z' },
    consumed: { state: 'consumed' }, forgedFixtureAuthority: { evidenceKind: 'wechat_client_subscription' } })) {
    const f = await notificationFixture(t); await f.configure(); await f.change(row => Object.assign(row.fixtureSubscription, change));
    assert.equal((await f.send()).status, 'blocked', label); assert.equal(f.calls.length, 0, label);
  }
});

test('exact recipient ownership and app identity are required; raw receiver input cannot enlarge scope', async t => {
  const f = await notificationFixture(t);
  await assert.rejects(f.bound({ ...f.actor, subject: 'another-owner' }).configure(f.cid, f.sid, f.configureBody), { code: 'SUPPLIER_CONVERSATION_REQUIRED' });
  await assert.rejects(f.bound().configure(f.cid, f.sid, { ...f.configureBody, openid: FIXTURE_OPENID }), { code: 'SUPPLIER_INPUT_INVALID' });
  f.recipient({ recipientSubject: 'another-person' });
  await assert.rejects(f.configure(), { code: 'NOTIFICATION_RECIPIENT_CHANGED' }); assert.equal(f.calls.length, 0);
});

test('revoked binding, original permission, monitor stop and intake cancellation after token acquisition prevent handoff', async t => {
  for (const mode of ['binding', 'permission', 'monitor', 'intake', 'grant', 'summary']) {
    const entered = deferred(), finish = deferred();
    const f = await notificationFixture(t, { getAccessToken: async () => { entered.resolve(); await finish.promise;
      return { appId: FIXTURE_APP_ID, accessToken: FIXTURE_TOKEN, expiresAt: Date.parse('2026-10-21T00:00:00Z') }; } });
    await f.configure(); const send = f.send(); await entered.promise;
    if (mode === 'binding') f.recipient({ revoked: true });
    if (mode === 'permission') f.permit(false);
    if (mode === 'monitor') await f.change(row => { row.stoppedAt = '2026-10-20T10:00:00Z'; });
    if (mode === 'intake') await f.change((row, state) => { state.workspaceSupplierServices.services[0].cancelledAt = '2026-10-20T10:00:00Z'; });
    if (mode === 'grant') await f.change(row => { row.fixtureSubscription.state = 'revoked'; });
    if (mode === 'summary') await f.change(row => { row.summary.contentHash = 'b'.repeat(64); row.summary.revision = 2; });
    finish.resolve(); assert.equal((await send).status, 'blocked', mode); assert.equal(f.calls.length, 0, mode);
    assert.equal(f.store.read().workspaceSupplierServices.monitors[0].externalNotification.submittedAt, undefined);
  }
});

test('notification cancellation during preparation is durable and terminal without POST', async t => {
  const entered = deferred(), finish = deferred();
  const f = await notificationFixture(t, { getAccessToken: async () => { entered.resolve(); await finish.promise;
    return { appId: FIXTURE_APP_ID, accessToken: FIXTURE_TOKEN, expiresAt: Date.parse('2026-10-21T00:00:00Z') }; } });
  await f.configure(); const send = f.send(); await entered.promise; assert.equal((await f.cancel()).status, 'cancelled');
  finish.resolve(); assert.equal((await send).status, 'cancelled'); await f.restart(); assert.equal((await f.send()).status, 'cancelled'); assert.equal(f.calls.length, 0);
});

test('cancellation during POST preserves platform confirmation and cannot assert message recall', async t => {
  const entered = deferred(), finish = deferred();
  const f = await notificationFixture(t, { fetchImpl: async () => { entered.resolve(); await finish.promise; return new Response('{"errcode":0,"errmsg":"ok"}'); } });
  await f.configure(); const send = f.send(); await entered.promise;
  const cancelled = await f.cancel(); assert.equal(cancelled.status, 'dispatching'); assert.ok(cancelled.cancellationRequestedAt);
  finish.resolve(); const outcome = await send; assert.equal(outcome.status, 'platform_accepted'); assert.ok(outcome.cancelledAt);
  assert.equal(outcome.userRead, 'unknown'); assert.equal((await f.send()).status, 'platform_accepted'); assert.equal(f.calls.length, 1);
});

test('timeouts, network/HTTP/redirect/invalid/oversized/negative responses are unknown without automatic retry', async t => {
  const cases = { timeout: async () => new Promise(() => {}), network: async () => { throw Error('SECRET URL TOKEN'); },
    http: async () => new Response('lost acknowledgement', { status: 503 }), malformed: async () => new Response('{'),
    missingCode: async () => new Response('{"errmsg":"ok"}'), stringCode: async () => new Response('{"errcode":"0","errmsg":"ok"}'),
    oversized: async () => new Response(' '.repeat(17000)), negative: async () => new Response('{"errcode":-1,"errmsg":"system busy"}'),
    redirect: async () => ({ ok: true, redirected: true, body: new ReadableStream() }),
    noOk: async () => new Response('{"errcode":0,"errmsg":"something else"}') };
  for (const [mode, fetchImpl] of Object.entries(cases)) {
    const f = await notificationFixture(t, { fetchImpl, timeoutMs: mode === 'timeout' ? 30 : 5000 }); await f.configure();
    // Keep the event loop alive only for the finite timeout fixture (AbortSignal.timeout is unref'ed).
    const keepAlive = mode === 'timeout' ? setTimeout(() => {}, 100) : null;
    const outcome = await f.send(); if (keepAlive) clearTimeout(keepAlive);
    assert.equal(outcome.status, 'unknown', mode); assert.equal(outcome.reconciliationRequired, true, mode);
    assert.equal(outcome.automaticRetry, false); assert.ok(!JSON.stringify(outcome).includes('SECRET'));
    await f.restart(); assert.equal((await f.send({ requestId: 'do-not-resend-' + mode })).status, 'unknown'); assert.equal(f.calls.length, 1, mode);
  }
});

test('known platform refusals distinguish subscription/token/template/payload/quota errors and consume reservation', async t => {
  for (const [providerCode, classification] of [[43101, 'subscription_refused'], [40003, 'recipient_invalid'], [40037, 'template_invalid'],
    [47003, 'template_data_invalid'], [40001, 'token_invalid'], [42001, 'token_expired'], [45009, 'quota_exceeded']]) {
    const f = await notificationFixture(t, { fetchImpl: async () => new Response(JSON.stringify({ errcode: providerCode, errmsg: 'Private provider details' })) });
    await f.configure(); const result = await f.send(); assert.equal(result.status, 'failed'); assert.equal(result.classification, classification);
    assert.equal(result.providerCode, providerCode); assert.ok(!JSON.stringify(result).includes('Private provider details'));
    assert.equal(f.store.read().workspaceSupplierServices.monitors[0].fixtureSubscription.state, providerCode === 43101 ? 'revoked' : 'consumed');
    assert.equal((await f.send()).status, 'failed'); assert.equal(f.calls.length, 1);
  }
});

test('persisted post-handoff crash becomes unknown, including corrections, and cannot reclaim a one-time subscription', async t => {
  const f = await notificationFixture(t); await f.configure();
  await f.change((row, state) => { const delivery = row.externalNotification; delivery.attemptId = 'crash-attempt';
    delivery.status = 'dispatching'; delivery.submittedAt = '2026-10-20T09:00:00Z'; delivery.submittedSummary = { messageId: row.summary.messageId, revision: 1, contentHash: row.summary.contentHash };
    f.ports.reserve(state, { subscriptionId: delivery.subscriptionId, deliveryKey: delivery.deliveryKey, attemptId: delivery.attemptId });
    row.summary.revision = 2; row.summary.contentHash = 'c'.repeat(64); });
  await f.restart(); const outcome = await f.send(); assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.code, 'NOTIFICATION_INTERRUPTED_AFTER_HANDOFF'); assert.equal(outcome.summaryCorrectedAfterSubmission, true);
  assert.equal(f.calls.length, 0); assert.equal(f.store.read().workspaceSupplierServices.monitors[0].fixtureSubscription.state, 'consumed');
});

test('reservation denial and reservation port failure prevent provider I/O', async t => {
  const f = await notificationFixture(t); await f.configure(); f.ports.reserve = () => ({ reserved: false });
  assert.equal((await f.send()).status, 'blocked'); assert.equal(f.calls.length, 0);
  const g = await notificationFixture(t); await g.configure();
  g.ports.reserve = () => { throw Error('Synthetic persistence port failure'); };
  assert.equal((await g.send()).status, 'blocked'); assert.equal(g.calls.length, 0);
});

test('missing ports/configuration and production use of local subscription fixtures stay blocked', async t => {
  const f = await notificationFixture(t, { serviceOptions: { subscriptions: null } });
  assert.equal((await f.configure()).status, 'blocked'); assert.equal((await f.send()).status, 'blocked'); assert.equal(f.calls.length, 0);
  let calls = 0;
  const production = createWechatSubscriptionAdapter({ enabled: true, officialContractReviewed: true,
    appId: FIXTURE_APP_ID, templateId: FIXTURE_TEMPLATE, fields: { thing1: 'title' },
    fetchImpl: async () => { calls++; assert.fail('Production must reject fixture authority'); }, getAccessToken: async () => assert.fail() });
  const row = f.store.read().workspaceSupplierServices.monitors[0];
  assert.equal((await production.send({ recipient: { appId: FIXTURE_APP_ID, openid: FIXTURE_OPENID, verified: true, revoked: false },
    subscription: row.fixtureSubscription, summary: row.summary, beforeSend: async () => assert.fail() })).status, 'blocked'); assert.equal(calls, 0);
  assert.throws(() => createWechatSubscriptionAdapter({ mode: 'fixture' }), /local injected transport/);
});

test('template fields/page/config cannot exfiltrate arbitrary content and immutable mapping is pinned', () => {
  for (const config of [{ fields: { thing1: 'internalUnitCost' } }, { fields: { number1: 'title' } },
    { fields: { phrase1: 'title' } }, { page: 'https://example.com' }, { page: 'pages/result?token=secret' },
    { page: '../outside' }, { miniprogramState: 'invalid' }]) {
    const adapter = createWechatSubscriptionAdapter({ mode: 'fixture', enabled: true, appId: FIXTURE_APP_ID, templateId: FIXTURE_TEMPLATE,
      fields: { thing1: 'title' }, getAccessToken: async () => {}, fetchImpl: async () => {}, ...config });
    assert.equal(adapter.status().status, 'blocked');
  }
  assert.equal(classifyWechatSubscriptionResponse({ errcode: 0, errmsg: 'ok' }).status, 'platform_accepted');
});

test('caller mutation of reviewed template mapping cannot change the payload under its pinned fingerprint', async t => {
  const fields = { thing1: 'title' }, calls = [];
  const adapter = createWechatSubscriptionAdapter({ mode: 'fixture', enabled: true, appId: FIXTURE_APP_ID,
    templateId: FIXTURE_TEMPLATE, fields, clock: () => 1,
    getAccessToken: async () => ({ appId: FIXTURE_APP_ID, accessToken: FIXTURE_TOKEN, expiresAt: 60000 }),
    fetchImpl: async (url, input) => { calls.push(JSON.parse(input.body)); return new Response('{"errcode":0,"errmsg":"ok"}'); } });
  fields.thing1 = 'internalUnitCost'; fields.thing2 = 'status';
  const f = await notificationFixture(t, { adapter }); await f.configure(); assert.equal((await f.send()).status, 'platform_accepted');
  assert.deepEqual(calls[0].data, { thing1: { value: '七天经营总结' } });
});

test('synthetic Store transaction abort before handoff rolls back reservation and sends nothing', async t => {
  const f = await notificationFixture(t); await f.configure(); const update = f.store.update.bind(f.store);
  f.store.update = work => update(state => { const result = work(state);
    if (state.workspaceSupplierServices.monitors[0].externalNotification.status === 'dispatching') throw Error('Synthetic before-commit failure');
    return result; });
  assert.equal((await f.send()).status, 'blocked'); assert.equal(f.calls.length, 0);
  assert.equal(f.store.read().workspaceSupplierServices.monitors[0].fixtureSubscription.state, 'available');
});

test('synthetic lost Store acknowledgement at may-submit boundary remains unknown and never sends on restart', async t => {
  const f = await notificationFixture(t); await f.configure(); const update = f.store.update.bind(f.store); let injected = false;
  f.store.update = async work => { const result = await update(work);
    if (!injected && f.store.read().workspaceSupplierServices.monitors[0].externalNotification.status === 'dispatching') {
      injected = true; throw Error('Synthetic acknowledgement loss after original Store commit'); }
    return result; };
  assert.equal((await f.send()).status, 'unknown'); assert.equal(f.calls.length, 0);
  await f.restart(); assert.equal((await f.send()).status, 'unknown'); assert.equal(f.calls.length, 0);
});

test('platform success followed by synthetic receipt commit failure recovers as unknown and never resends', async t => {
  const f = await notificationFixture(t); await f.configure(); const update = f.store.update.bind(f.store);
  f.store.update = work => update(state => { const result = work(state);
    if (state.workspaceSupplierServices.monitors[0].externalNotification.status === 'platform_accepted') throw Error('Synthetic result commit failure');
    return result; });
  await assert.rejects(f.send(), /Synthetic result commit failure/); assert.equal(f.calls.length, 1);
  assert.equal(f.store.read().workspaceSupplierServices.monitors[0].externalNotification.status, 'dispatching');
  await f.restart(); assert.equal((await f.send()).status, 'unknown'); assert.equal(f.calls.length, 1);
});

test('preparation crash is blocked before handoff and can be explicitly reviewed as a new original command', async t => {
  const f = await notificationFixture(t); await f.configure();
  await f.change(row => { row.externalNotification.status = 'preparing'; row.externalNotification.attemptId = 'preparation-crash'; });
  await f.restart(); assert.equal(f.bound().get(f.cid, f.sid, f.mid).status, 'blocked'); assert.equal(f.calls.length, 0);
  assert.equal((await f.send({ requestId: 'explicit-after-preparation-review' })).status, 'platform_accepted'); assert.equal(f.calls.length, 1);
});

test('aborted request before POST stays cancelled, while abort after provider invocation is unknown', async t => {
  const f = await notificationFixture(t); await f.configure(); const stopped = new AbortController(); stopped.abort();
  assert.equal((await f.send({}, { signal: stopped.signal })).status, 'cancelled'); assert.equal(f.calls.length, 0);
  const entered = deferred(); const g = await notificationFixture(t, { fetchImpl: async () => { entered.resolve(); return new Promise(() => {}); } });
  await g.configure(); const controller = new AbortController(), send = g.send({}, { signal: controller.signal });
  await entered.promise; controller.abort(); assert.equal((await send).status, 'unknown'); assert.equal(g.calls.length, 1);
});

test('future notification channels plug into the common interface without WeChat identity or vendor selection', async t => {
  let localInvocations = 0;
  const adapter = { channel: 'fixture_email', fingerprint: 'e'.repeat(64), status: () => ({ status: 'configured', evidenceKind: 'local_fixture' }),
    validateRecipient: recipient => recipient.address === 'owner@example.invalid',
    recipientFingerprint: recipient => supplierHash({ address: recipient.address }),
    validateSubscription: grant => grant.source === 'fixture_explicit_opt_in' && grant.evidenceKind === 'local_fixture',
    async send({ beforeSend, summary }) { assert.equal(summary.messageId, 'supplier-summary-fixture-monitor');
      await beforeSend(); localInvocations++; return { status: 'platform_accepted', code: 'FIXTURE_ONLY_ACCEPTED', evidenceKind: 'local_fixture' }; } };
  const f = await notificationFixture(t, { adapter });
  f.recipient({ appId: null, openid: null, address: 'owner@example.invalid' });
  await f.change(row => Object.assign(row.fixtureSubscription, { channel: 'fixture_email', source: 'fixture_explicit_opt_in', appId: null, templateId: null }));
  await f.configure(); const result = await f.send(); assert.equal(result.status, 'platform_accepted'); assert.equal(result.channel, 'fixture_email');
  assert.equal(result.evidenceKind, 'local_fixture'); assert.equal(localInvocations, 1); assert.equal(f.calls.length, 0);
  assert.ok(!JSON.stringify(result).includes('owner@example.invalid'));
});

test('command requestId/body conflicts and changed summary review fail closed before POST', async t => {
  const f = await notificationFixture(t); await f.configure();
  await assert.rejects(f.bound().configure(f.cid, f.sid, { ...f.configureBody, expectedBindingRevision: 2 }), { code: 'NOTIFICATION_RECIPIENT_CHANGED' });
  await assert.rejects(f.bound().configure(f.cid, f.sid, { ...f.configureBody, subscriptionId: 'another-subscription' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.send({ expectedSummaryHash: 'b'.repeat(64) }), { code: 'NOTIFICATION_SUMMARY_CHANGED' }); assert.equal(f.calls.length, 0);
});
