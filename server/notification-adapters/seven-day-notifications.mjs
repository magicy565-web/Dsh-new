import { notificationSource } from './notification-source.mjs';
import { randomUUID } from 'node:crypto';
import { supplierFind, supplierRequest } from '../supplier-draft.mjs';
import { supplierFail, supplierHash } from '../supplier-profile.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._:@/-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const terminal = row => !!row?.submittedAt || !!row?.cancelledAt;
const pointer = summary => summary ? { messageId: summary.messageId, revision: summary.revision, contentHash: summary.contentHash } : null;
const knownStatuses = new Set(['blocked', 'cancelled', 'platform_accepted', 'failed', 'unknown']);
const safeOutcome = value => {
  if (!object(value) || !knownStatuses.has(value.status) || typeof value.code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(value.code))
    return { status: 'unknown', code: 'NOTIFICATION_ADAPTER_UNCERTAIN' };
  return { status: value.status, code: value.code,
    ...(Number.isSafeInteger(value.providerCode) ? { providerCode: value.providerCode } : {}),
    ...(typeof value.classification === 'string' && /^[a-z_]{1,80}$/.test(value.classification) ? { classification: value.classification } : {}),
    subscriptionRevoked: value.subscriptionRevoked === true,
    evidenceKind: ['local_fixture', 'wechat_api_response'].includes(value.evidenceKind) ? value.evidenceKind : 'adapter_report' };
};
function synchronous(value) { if (value?.then) throw new TypeError('Notification authorization ports must use the original synchronous Store transaction.'); return value; }

/** Additive original-monitor delivery receipts. Host owns authentication, command receipts and scheduling. */
export function createSevenDayNotifications({ store, adapter = null, resolveRecipient = null,
  subscriptions = null, authorize = null, clock = Date.now, phase = 'summary' } = {}) {
  if (!['summary', 'first_sample'].includes(phase)) throw new TypeError('Choose an explicit supported notification phase.');
  const recordKey = phase === 'summary' ? 'externalNotification' : 'firstSampleNotification';
  const messagePrefix = phase === 'summary' ? 'supplier-summary' : 'supplier-first-sample';
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') throw new TypeError('Use the original Workspace Store.');
  if (adapter && (!identifier(adapter.channel) || !hash(adapter.fingerprint)
    || !['send', 'status', 'validateRecipient', 'validateSubscription', 'recipientFingerprint'].every(key => typeof adapter[key] === 'function')))
    throw new TypeError('Use a trusted notification adapter with a stable configuration fingerprint.');
  const portsConfigured = typeof resolveRecipient === 'function' && typeof authorize === 'function'
    && ['read', 'reserve', 'settle'].every(key => typeof subscriptions?.[key] === 'function');
  const now = () => new Date(clock()).toISOString();
  function lookup(state, actor, cid, sid, id) {
    const service = supplierFind(state, actor, cid, sid);
    const monitor = state.workspaceSupplierServices?.monitors.find(row => row.id === id && row.serviceId === sid
      && row.conversationId === cid && row.subject === actor.subject && row.workspaceId === actor.workspaceId);
    if (!monitor) supplierFail(404, 'SUPPLIER_MONITOR_NOT_FOUND', 'Use the original owned supplier monitor.');
    return { monitor, service };
  }
  function projection(monitor) {
    const row = monitor[recordKey];
    return { phase, status: row?.status || 'blocked', code: row?.code || 'NOTIFICATION_UNCONFIGURED',
      channel: row?.channel || adapter?.channel || null, recipientBindingId: row?.recipientBindingId || null,
      bindingRevision: row?.bindingRevision || null, deliveryKey: row?.deliveryKey || null,
      latestSummary: pointer(notificationSource(monitor, phase)), submittedSummary: row?.submittedSummary || null,
      summaryCorrectedAfterSubmission: !!row?.submittedSummary && notificationSource(monitor, phase)?.contentHash !== row.submittedSummary.contentHash,
      attemptId: row?.attemptId || null, submittedAt: row?.submittedAt || null, finishedAt: row?.finishedAt || null,
      cancelledAt: row?.cancelledAt || null, cancellationRequestedAt: row?.cancellationRequestedAt || null,
      providerCode: row?.providerCode ?? null, classification: row?.classification || null,
      evidenceKind: row?.evidenceKind || null, automaticRetry: false,
      reconciliationRequired: row?.status === 'unknown', userRead: 'unknown', businessAcceptance: 'not_recorded' };
  }
  function operational() { return !!adapter && adapter.status().status === 'configured' && portsConfigured; }
  function requireRunning(state, actor, cid, sid, id) {
    const found = lookup(state, actor, cid, sid, id);
    if (found.monitor.stoppedAt || found.service.cancelledAt || found.service.rejectedAt)
      supplierFail(409, 'NOTIFICATION_CANCELLED', 'The original monitor or supplier intake was stopped.');
    if (portsConfigured && synchronous(authorize(state, { actor, monitor: found.monitor, operation: 'external_notification' })) !== true)
      supplierFail(403, 'NOTIFICATION_AUTHORIZATION_REQUIRED', 'The original current permission and external-notification approval are required.');
    return found.monitor;
  }
  function requireSummary(monitor, body) {
    const summary = notificationSource(monitor, phase);
    if (!summary || summary.messageId !== `${messagePrefix}-${monitor.id}` || summary.notificationCount !== 1
      || summary.monitorId !== monitor.id || summary.startAt !== monitor.scope.startAt || phase === 'summary' && summary.endAt !== monitor.scope.endAt
      || Date.parse(summary.endAt) > clock() || !hash(summary.contentHash) || !Number.isSafeInteger(summary.revision)
      || summary.revision < 1 || summary.revision !== body.expectedSummaryRevision || summary.contentHash !== body.expectedSummaryHash)
      supplierFail(409, 'NOTIFICATION_SUMMARY_CHANGED', 'Review the current original seven-day summary hash and revision.');
    return summary;
  }
  function recipientValid(recipient, actor, row) {
    return object(recipient) && recipient.verified === true && recipient.revoked === false
      && recipient.id === row.recipientBindingId && recipient.revision === row.bindingRevision
      && recipient.workspaceId === actor.workspaceId && recipient.ownerSubject === actor.subject
      && recipient.recipientSubject === actor.subject && synchronous(adapter.validateRecipient(recipient)) === true;
  }
  function subscriptionFor(state, recipient, monitor, row) {
    const grant = synchronous(subscriptions.read(state, { recipient, subscriptionId: row.subscriptionId, monitor }));
    const valid = object(grant) && grant.id === row.subscriptionId && grant.kind === 'one_time'
      && grant.state === 'available' && grant.decision === 'accept' && identifier(grant.proofId)
      && grant.channel === adapter.channel
      && grant.workspaceId === monitor.workspaceId && grant.subject === monitor.subject
      && grant.recipientBindingId === recipient.id && grant.bindingRevision === recipient.revision
      && grant.monitorId === monitor.id && grant.scopeHash === monitor.scopeHash
      && grant.summaryId === `${messagePrefix}-${monitor.id}` && Number.isFinite(Date.parse(grant.acceptedAt))
      && Date.parse(grant.acceptedAt) <= clock() && (!grant.expiresAt || Date.parse(grant.expiresAt) > clock())
      && synchronous(adapter.validateSubscription(grant, { recipient, monitor, now: clock() })) === true;
    if (!valid) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'A current bound one-time client subscription is required.');
    return structuredClone(grant);
  }
  async function freshRecipient(actor, row) {
    let recipient;
    try { recipient = await resolveRecipient({ actor, recipientBindingId: row.recipientBindingId }); } catch {}
    if (!recipientValid(recipient, actor, row)) supplierFail(409, 'NOTIFICATION_RECIPIENT_CHANGED', 'Refresh the exact reviewed recipient binding.');
    return structuredClone(recipient);
  }
  const recipientFingerprint = recipient => {
    const privateIdentity = synchronous(adapter.recipientFingerprint(recipient));
    if (!hash(privateIdentity)) supplierFail(409, 'NOTIFICATION_RECIPIENT_CHANGED', 'A stable adapter identity digest is required.');
    return supplierHash({ id: recipient.id, revision: recipient.revision, privateIdentity,
      workspaceId: recipient.workspaceId, subject: recipient.recipientSubject });
  };
  const service = {
    status() { return { status: operational() ? 'configured' : 'blocked', code: operational() ? null : 'NOTIFICATION_UNCONFIGURED', automaticRetry: false }; },
    async recover() {
      // Startup with a single original host writer only. Never replay a provider request from persisted state.
      return store.update(state => {
        let interrupted = 0;
        for (const monitor of state.workspaceSupplierServices?.monitors || []) {
          const row = monitor[recordKey];
          if (!row || !['preparing', 'dispatching'].includes(row.status)) continue;
          row.status = row.submittedAt ? 'unknown' : row.cancelledAt ? 'cancelled' : 'blocked';
          row.code = row.submittedAt ? 'NOTIFICATION_INTERRUPTED_AFTER_HANDOFF' : 'NOTIFICATION_PREPARATION_INTERRUPTED';
          row.finishedAt = now(); interrupted++;
          if (row.submittedAt && portsConfigured) synchronous(subscriptions.settle(state, {
            subscriptionId: row.subscriptionId, deliveryKey: row.deliveryKey, attemptId: row.attemptId,
            outcome: { status: 'unknown', code: row.code } }));
        }
        return { interrupted, automaticRetry: false };
      });
    },
    forActor(context, { command } = {}) {
      const actor = { subject: context.subject, workspaceId: context.workspaceId || 'local', role: context.role };
      const transaction = (state, sid, action, body, work) => {
        if (typeof command !== 'function') supplierFail(503, 'NOTIFICATION_COMMAND_PORT_REQUIRED', 'Use the existing supplier command receipt facility.');
        return synchronous(command(state, actor, sid, phase === 'summary' ? action : `first_sample_${action}`, body, work));
      };
      const validate = (state, cid, sid, body) => {
        const { monitor } = lookup(state, actor, cid, sid, body.monitorId);
        if (body.confirmed !== true || body.expectedMonitorHash !== monitor.scopeHash)
          supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Confirm the exact original monitor scope.');
        return monitor;
      };
      return {
        get(cid, sid, id) { return projection(lookup(store.read(), actor, cid, sid, id).monitor); },
        async configure(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'recipientBindingId', 'expectedBindingRevision', 'subscriptionId', 'confirmed']);
          if (!identifier(body.recipientBindingId) || !identifier(body.subscriptionId) || !Number.isSafeInteger(body.expectedBindingRevision) || body.expectedBindingRevision < 1)
            supplierFail(400, 'NOTIFICATION_BINDING_REQUIRED', 'Use exact original recipient and subscription references.');
          validate(store.read(), cid, sid, body);
          const candidate = { recipientBindingId: body.recipientBindingId, bindingRevision: body.expectedBindingRevision, subscriptionId: body.subscriptionId };
          const recipient = operational() ? await freshRecipient(actor, candidate) : null;
          await store.update(state => transaction(state, sid, 'notification_configure', body, () => {
            const monitor = validate(state, cid, sid, body); requireRunning(state, actor, cid, sid, monitor.id);
            if (terminal(monitor[recordKey]) || monitor[recordKey]?.status === 'preparing')
              supplierFail(409, 'NOTIFICATION_ALREADY_ATTEMPTED', 'Retain this original delivery receipt; corrections do not send another notification.');
            const grant = operational() ? subscriptionFor(state, recipient, monitor, candidate) : null;
            monitor[recordKey] = { schema: 'workspace.seven-day.delivery.v1', ...candidate,
              channel: adapter?.channel || 'wechat_subscription', adapterFingerprint: adapter?.fingerprint || null,
              deliveryKey: supplierHash([actor.workspaceId, actor.subject, monitor.id, monitor.scopeHash,
                `${messagePrefix}-${monitor.id}`, adapter?.channel || 'wechat_subscription', candidate.recipientBindingId]),
              recipientFingerprint: recipient ? recipientFingerprint(recipient) : null,
              subscriptionFingerprint: grant ? supplierHash(grant) : null,
              status: operational() ? 'ready' : 'blocked', code: operational() ? null : 'NOTIFICATION_UNCONFIGURED', configuredAt: now() };
            return { monitorId: monitor.id };
          }));
          return projection(lookup(store.read(), actor, cid, sid, body.monitorId).monitor);
        },
        async cancel(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'confirmed']); validate(store.read(), cid, sid, body);
          await store.update(state => transaction(state, sid, 'notification_cancel', body, () => {
            const monitor = validate(state, cid, sid, body);
            const row = monitor[recordKey] ||= { schema: 'workspace.seven-day.delivery.v1', channel: adapter?.channel || 'wechat_subscription' };
            row.cancellationRequestedAt ||= now(); row.cancelledAt ||= now();
            if (!row.submittedAt) { row.status = 'cancelled'; row.code = 'NOTIFICATION_CANCELLED'; }
            return { monitorId: monitor.id };
          }));
          return projection(lookup(store.read(), actor, cid, sid, body.monitorId).monitor);
        },
        async dispatch(cid, sid, body, { signal } = {}) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'expectedSummaryRevision', 'expectedSummaryHash', 'confirmed']);
          const initial = validate(store.read(), cid, sid, body);
          // Return an existing irreversible outcome even if its summary has since been corrected.
          if (terminal(initial[recordKey]) || initial[recordKey]?.status === 'preparing') return projection(initial);
          requireSummary(initial, body); requireRunning(store.read(), actor, cid, sid, initial.id);
          if (!operational() || !initial[recordKey]) return { ...projection(initial), status: 'blocked', code: 'NOTIFICATION_UNCONFIGURED' };
          const attemptId = randomUUID();
          const admitted = await store.update(state => transaction(state, sid, 'notification_dispatch', body, () => {
            const monitor = validate(state, cid, sid, body), row = monitor[recordKey];
            requireRunning(state, actor, cid, sid, monitor.id); requireSummary(monitor, body);
            if (terminal(row) || row.status === 'preparing') return { attemptId: row.attemptId || null, claimed: false };
            if (row.adapterFingerprint !== adapter.fingerprint) supplierFail(409, 'NOTIFICATION_CONFIGURATION_CHANGED', 'Review the current adapter configuration.');
            row.status = 'preparing'; row.code = null; row.attemptId = attemptId; row.preparingAt = now();
            return { attemptId, claimed: true };
          }));
          if (!admitted.claimed || admitted.duplicate) return projection(lookup(store.read(), actor, cid, sid, body.monitorId).monitor);
          let outcome;
          try {
            const monitor = lookup(store.read(), actor, cid, sid, body.monitorId).monitor, row = monitor[recordKey];
            const recipient = await freshRecipient(actor, row);
            if (recipientFingerprint(recipient) !== row.recipientFingerprint) supplierFail(409, 'NOTIFICATION_RECIPIENT_CHANGED', 'The original recipient identity changed.');
            const subscription = subscriptionFor(store.read(), recipient, monitor, row);
            if (supplierHash(subscription) !== row.subscriptionFingerprint) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_CHANGED', 'Review the current original subscription receipt.');
            const summary = requireSummary(monitor, body);
            outcome = await adapter.send({ recipient, subscription,
              summary: { ...pointer(summary), phase, endAt: summary.endAt, provisional: summary.provisional === true }, signal,
              async beforeSend() {
                // Fresh binding after token acquisition; original permissions/grant/cancellation checked atomically.
                const fresh = await freshRecipient(actor, row);
                await store.update(state => {
                  const current = validate(state, cid, sid, body), delivery = current[recordKey];
                  requireRunning(state, actor, cid, sid, current.id); requireSummary(current, body);
                  if (signal?.aborted || delivery.cancelledAt) supplierFail(409, 'NOTIFICATION_CANCELLED', 'The original notification was stopped before handoff.');
                  if (delivery.attemptId !== attemptId || delivery.status !== 'preparing' || delivery.submittedAt)
                    supplierFail(409, 'NOTIFICATION_ATTEMPT_CHANGED', 'The original notification attempt changed.');
                  if (!operational() || delivery.adapterFingerprint !== adapter.fingerprint
                    || recipientFingerprint(fresh) !== delivery.recipientFingerprint)
                    supplierFail(409, 'NOTIFICATION_CONFIGURATION_CHANGED', 'The reviewed notification scope changed before handoff.');
                  const live = subscriptionFor(state, fresh, current, delivery);
                  if (supplierHash(live) !== delivery.subscriptionFingerprint)
                    supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_CHANGED', 'The original subscription changed before handoff.');
                  const reserved = synchronous(subscriptions.reserve(state, { subscriptionId: delivery.subscriptionId, deliveryKey: delivery.deliveryKey, attemptId }));
                  if (reserved?.reserved !== true) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'The original one-time subscription is no longer available.');
                  delivery.status = 'dispatching'; delivery.submittedAt = now(); delivery.submittedSummary = pointer(notificationSource(current, phase));
                });
              },
            });
          } catch (error) {
            const row = lookup(store.read(), actor, cid, sid, body.monitorId).monitor[recordKey];
            outcome = row.submittedAt ? { status: 'unknown', code: 'NOTIFICATION_ADAPTER_UNCERTAIN' }
              : { status: row.cancelledAt || signal?.aborted ? 'cancelled' : 'blocked',
                code: /^NOTIFICATION_[A-Z_]{1,60}$/.test(error.code || '') ? error.code : 'NOTIFICATION_PREPARATION_FAILED' };
          }
          const safe = safeOutcome(outcome);
          if (adapter.status().evidenceKind === 'local_fixture') safe.evidenceKind = 'local_fixture';
          await store.update(state => {
            const current = lookup(state, actor, cid, sid, body.monitorId).monitor, row = current[recordKey];
            if (row.attemptId !== attemptId) supplierFail(409, 'NOTIFICATION_ATTEMPT_CHANGED', 'Preserve the original notification receipt.');
            // A trusted plugin cannot assert success/failure without recording the required handoff.
            if (!row.submittedAt && ['platform_accepted', 'failed', 'unknown'].includes(safe.status))
              Object.assign(safe, { status: 'blocked', code: 'NOTIFICATION_HANDOFF_REQUIRED' });
            Object.assign(row, safe, { finishedAt: now() });
            if (safe.status === 'cancelled' && !row.submittedAt) row.cancelledAt ||= now();
            if (row.cancelledAt && !row.submittedAt) { row.status = 'cancelled'; row.code = 'NOTIFICATION_CANCELLED'; }
            if (row.submittedAt) synchronous(subscriptions.settle(state, { subscriptionId: row.subscriptionId, deliveryKey: row.deliveryKey, attemptId, outcome: safe }));
          });
          return projection(lookup(store.read(), actor, cid, sid, body.monitorId).monitor);
        },
      };
    },
  };
  return Object.freeze(service);
}
