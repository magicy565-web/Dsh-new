// LOCAL FIXTURE ONLY. No real WeChat authorization, credentials, calls or delivery evidence.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { openStore } from '../../server/store.mjs';
import { supplierRegistry } from '../../server/supplier-draft.mjs';
import { supplierHash, supplierFail } from '../../server/supplier-profile.mjs';
import { createSevenDayNotifications } from '../../server/notification-adapters/seven-day-notifications.mjs';
import { createWechatSubscriptionAdapter, WECHAT_SUBSCRIBE_SEND_URL } from '../../server/notification-adapters/wechat-subscription.mjs';

export const FIXTURE_APP_ID = 'wx0123456789abcdef';
export const FIXTURE_TEMPLATE = 'local-template-not-real';
export const FIXTURE_OPENID = 'local-openid-not-a-person';
export const FIXTURE_TOKEN = 'local-fixture-token-not-valid';
export async function notificationFixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-seven-day-notification-');
  let store = await openStore(directory), service;
  const actor = { subject: 'fixture-owner', workspaceId: 'local', role: 'admin' };
  const cid = 'fixture-conversation', sid = 'fixture-service', mid = 'fixture-monitor';
  const time = Date.parse('2026-10-20T10:00:00Z'), calls = [];
  let recipient = { id: 'fixture-binding', revision: 1, appId: FIXTURE_APP_ID, openid: FIXTURE_OPENID,
    workspaceId: 'local', ownerSubject: actor.subject, recipientSubject: actor.subject, verified: true, revoked: false };
  const scope = { startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-19T09:00:00.000Z' }, scopeHash = supplierHash(scope);
  await store.update(state => {
    state.conversations.push({ id: cid, workspaceId: 'local', createdBy: actor.subject });
    const registry = supplierRegistry(state);
    registry.services.push({ id: sid, subject: actor.subject, workspaceId: 'local', conversationId: cid });
    registry.monitors.push({ id: mid, serviceId: sid, subject: actor.subject, workspaceId: 'local', conversationId: cid,
      scope, scopeHash, stoppedAt: null, summary: { monitorId: mid, ...scope, messageId: `supplier-summary-${mid}`,
        contentHash: 'a'.repeat(64), revision: 1, notificationCount: 1, provisional: true,
        internalUnitCost: 'PRIVATE NEVER SEND', sales: { retainedUnits: 30 }, traffic: null },
      fixtureSubscription: { id: 'fixture-subscription', kind: 'one_time', state: 'available', decision: 'accept',
        channel: 'wechat_subscription',
        source: 'wx.requestSubscribeMessage', provenance: 'authenticated_wechat_client', proofId: 'local-fixture-proof',
        recipientBindingId: recipient.id, bindingRevision: 1, workspaceId: 'local', subject: actor.subject,
        appId: FIXTURE_APP_ID, templateId: FIXTURE_TEMPLATE, monitorId: mid, scopeHash,
        summaryId: `supplier-summary-${mid}`, acceptedAt: '2026-10-12T10:00:00Z', evidenceKind: 'local_fixture' } });
  });
  const ports = {
    read(state, { subscriptionId, monitor }) { return monitor.fixtureSubscription?.id === subscriptionId ? monitor.fixtureSubscription : null; },
    reserve(state, { subscriptionId, deliveryKey, attemptId }) {
      const grant = state.workspaceSupplierServices.monitors.find(row => row.fixtureSubscription?.id === subscriptionId)?.fixtureSubscription;
      if (grant?.state !== 'available') return { reserved: false };
      Object.assign(grant, { state: 'reserved', deliveryKey, attemptId }); return { reserved: true };
    },
    settle(state, { subscriptionId, deliveryKey, attemptId, outcome }) {
      const grant = state.workspaceSupplierServices.monitors.find(row => row.fixtureSubscription?.id === subscriptionId)?.fixtureSubscription;
      assert.equal(grant.deliveryKey, deliveryKey); assert.equal(grant.attemptId, attemptId);
      // Never release a one-time grant after the may-submit boundary, including explicit failure/unknown.
      grant.state = outcome.subscriptionRevoked ? 'revoked' : 'consumed'; grant.outcome = outcome.status;
    },
  };
  let permitted = true;
  const fetchImpl = async (url, input) => {
    assert.equal(url.origin + url.pathname, WECHAT_SUBSCRIBE_SEND_URL);
    assert.equal(url.searchParams.get('access_token'), FIXTURE_TOKEN);
    assert.equal(input.method, 'POST'); assert.equal(input.redirect, 'error');
    const row = store.read().workspaceSupplierServices.monitors[0];
    assert.equal(row.externalNotification.status, 'dispatching'); assert.equal(row.fixtureSubscription.state, 'reserved');
    calls.push({ body: JSON.parse(input.body), input });
    return options.fetchImpl ? options.fetchImpl(url, input) : new Response('{"errcode":0,"errmsg":"ok"}');
  };
  const adapter = options.adapter || createWechatSubscriptionAdapter({ mode: 'fixture', enabled: true,
    appId: FIXTURE_APP_ID, templateId: FIXTURE_TEMPLATE, fields: { thing1: 'title', phrase2: 'status', date3: 'endDate' },
    fetchImpl, clock: () => time, timeoutMs: options.timeoutMs || 5000,
    getAccessToken: options.getAccessToken || (async () => ({ appId: FIXTURE_APP_ID, accessToken: FIXTURE_TOKEN, expiresAt: time + 60000 })) });
  const open = () => { service = createSevenDayNotifications({ store, adapter, clock: () => time,
    resolveRecipient: async input => { assert.equal(input.recipientBindingId, 'fixture-binding'); return structuredClone(recipient); },
    authorize: () => permitted, subscriptions: ports, ...options.serviceOptions }); };
  open();
  // Local fixture implementing the existing supplier command callback signature and original command collection.
  const command = (state, owner, serviceId, action, body, work) => {
    const registry = supplierRegistry(state), fingerprint = supplierHash({ id: serviceId, action, body });
    const previous = registry.commands.find(row => row.subject === owner.subject && row.workspaceId === owner.workspaceId && row.requestId === body.requestId);
    if (previous) { if (previous.fingerprint !== fingerprint) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'Fixture exact-command conflict'); return { ...previous.result, duplicate: true }; }
    const result = work(); registry.commands.push({ subject: owner.subject, workspaceId: owner.workspaceId,
      requestId: body.requestId, fingerprint, result, committedAt: new Date(time).toISOString() }); return result;
  };
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { actor, cid, sid, mid, calls, adapter, directory, get store() { return store; }, get service() { return service; },
    ports, command, bound: (owner = actor) => service.forActor(owner, { command }),
    configureBody: { requestId: 'fixture-configure', monitorId: mid, expectedMonitorHash: scopeHash,
      recipientBindingId: recipient.id, expectedBindingRevision: 1, subscriptionId: 'fixture-subscription', confirmed: true },
    sendBody: { requestId: 'fixture-dispatch', monitorId: mid, expectedMonitorHash: scopeHash,
      expectedSummaryRevision: 1, expectedSummaryHash: 'a'.repeat(64), confirmed: true },
    stopBody: { requestId: 'fixture-cancel', monitorId: mid, expectedMonitorHash: scopeHash, confirmed: true },
    recipient(change) { Object.assign(recipient, change); }, permit(value) { permitted = value; },
    async change(work) { await store.update(state => work(state.workspaceSupplierServices.monitors[0], state)); },
    async restart() { await store.close(); store = await openStore(directory); open(); await service.recover(); },
    async configure() { return service.forActor(actor, { command }).configure(cid, sid, this.configureBody); },
    async send(overrides = {}, control = {}) { return service.forActor(actor, { command }).dispatch(cid, sid, { ...this.sendBody, ...overrides }, control); },
    async cancel() { return service.forActor(actor, { command }).cancel(cid, sid, this.stopBody); },
  };
}
