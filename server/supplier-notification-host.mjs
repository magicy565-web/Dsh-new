import { randomUUID } from 'node:crypto';
import { createSevenDayNotifications } from './notification-adapters/seven-day-notifications.mjs';
import { createWechatSubscriptionAdapter } from './notification-adapters/wechat-subscription.mjs';
import { supplierFind, supplierRegistry, supplierRequest } from './supplier-draft.mjs';
import { supplierFail, supplierHash } from './supplier-profile.mjs';

export const SUPPLIER_MONITOR_NOTIFICATION_ADAPTER = 'workspace-seven-day-notification';
const ACTION = 'supplier.monitor.notification';
const clone = value => structuredClone(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const TERMINAL = ['platform_accepted', 'failed', 'unknown', 'cancelled'];

/** Original Store/command/approval/connectorRun host wiring for PR50. Trusted
 * callbacks read existing identity, token and native subscription evidence.
 * No scheduler, credential/grant acquisition, or independent grant DB. */
export function createSupplierNotificationHost({ store, getCapabilities, getSupplier, currentRole, options = {}, clock = Date.now } = {}) {
  const at = () => new Date(clock()).toISOString();
  const transport = options.adapter || createWechatSubscriptionAdapter({ ...(options.wechat || {}), clock });
  const resolveRecipient = options.resolveRecipient || (async () => null);
  const configured = () => transport.status().status === 'configured' && typeof options.resolveRecipient === 'function';
  const actorFor = context => ({ subject: context.subject, role: context.role, workspaceId: context.workspaceId || 'local' });
  const monitors = state => state.workspaceSupplierServices?.monitors || [];
  const grantById = (state, id) => monitors(state).flatMap(row => row.notificationSubscriptions || []).find(grant => grant.id === id);
  const status = () => ({ ...transport.status(), status: configured() ? 'configured' : 'blocked', code: configured() ? null : 'NOTIFICATION_UNCONFIGURED', confirmedSubscriptionProvider: typeof options.confirmSubscription === 'function', automaticRetry: false });
  function find(state, actor, cid, sid, mid) {
    supplierFind(state, actor, cid, sid);
    const monitor = monitors(state).find(item => item.id === mid && item.serviceId === sid && item.conversationId === cid && item.subject === actor.subject && item.workspaceId === actor.workspaceId);
    if (!monitor) supplierFail(404, 'SUPPLIER_MONITOR_NOT_FOUND', 'Use this original owned product monitor.');
    return monitor;
  }
  function owner(actor, monitor) { return ['admin', 'operator'].includes(actor.role) && (!currentRole || currentRole(actor.subject) === actor.role) && monitor.subject === actor.subject && monitor.workspaceId === actor.workspaceId; }
  const subscriptions = {
    read(state, { recipient, subscriptionId, monitor }) {
      const grant = grantById(state, subscriptionId);
      if (!grant || grant.monitorId !== monitor.id || grant.recipientBindingId !== recipient.id) return null;
      return grant;
    },
    reserve(state, { subscriptionId, deliveryKey, attemptId }) {
      const grant = grantById(state, subscriptionId);
      if (!grant || grant.state !== 'available') return { reserved: false };
      Object.assign(grant, { state: 'reserved', deliveryKey, attemptId, reservedAt: at() }); return { reserved: true };
    },
    settle(state, { subscriptionId, deliveryKey, attemptId, outcome }) {
      const grant = grantById(state, subscriptionId);
      if (!grant || grant.deliveryKey !== deliveryKey || grant.attemptId !== attemptId) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_CHANGED', 'Preserve the original one-time reservation.');
      Object.assign(grant, { state: outcome.subscriptionRevoked ? 'revoked' : 'consumed', outcome: outcome.status, settledAt: at() });
      if (outcome.subscriptionRevoked) for (const other of monitors(state).flatMap(row => row.notificationSubscriptions || [])) if (other.subject === grant.subject && other.workspaceId === grant.workspaceId && other.recipientBindingId === grant.recipientBindingId && other.appId === grant.appId && other.templateId === grant.templateId) { other.state = 'revoked'; other.revokedAt = at(); }
    },
  };
  const core = createSevenDayNotifications({ store, adapter: transport, resolveRecipient, subscriptions, clock,
    authorize(state, { actor, monitor }) {
      const authority = monitor.notificationExecution;
      const run = state.capabilities.connectorRuns.find(item => item.id === authority?.runId), approval = state.capabilities.approvals.find(item => item.id === authority?.approvalId);
      const scope = authority?.scope, connector = state.capabilities.connectors.find(item => item.id === run?.connectorId);
      return !!scope && owner(actor, monitor) && connector?.enabled === true && connector.adapter === SUPPLIER_MONITOR_NOTIFICATION_ADAPTER && connector.revision === run?.connectorRevision && run?.status === 'running' && run.action === ACTION && run.connectorId === authority.connectorId && run.approvalId === authority.approvalId && approval?.status === 'consumed' && approval.payload.binding?.type === 'supplier-monitor-notification' && approval.payload.binding.scopeHash === supplierHash(scope) && scope.monitorHash === monitor.scopeHash && scope.expectedSummaryHash === monitor.summary?.contentHash && scope.expectedSummaryRevision === monitor.summary?.revision;
    },
  });
  let connectorId = store.read().capabilities.connectors.find(item => item.adapter === SUPPLIER_MONITOR_NOTIFICATION_ADAPTER)?.id || null;
  async function ensureConnector() {
    connectorId ||= store.read().capabilities.connectors.find(item => item.adapter === SUPPLIER_MONITOR_NOTIFICATION_ADAPTER)?.id || null;
    if (!connectorId) connectorId = (await getCapabilities().createConnector({ requestId: 'original-seven-day-notification-connector-v1', name: '七天经营通知', description: 'One explicitly approved summary to the existing exact recipient using the existing token facility and original single-use subscription receipt.', adapter: SUPPLIER_MONITOR_NOTIFICATION_ADAPTER, capabilities: [ACTION], credentialRefs: {}, enabled: false })).connector.id;
    return getCapabilities().getConnector(connectorId);
  }
  const request = review => ({ action: ACTION, resource: `supplier-monitor:${review.scope.monitorId}`, payload: clone(review.scope) });
  const binding = review => ({ type: 'supplier-monitor-notification', operationId: review.id, scopeHash: review.scopeHash, subject: review.scope.subject, workspaceId: review.scope.workspaceId, conversationId: review.scope.conversationId });
  function summary(monitor, body) {
    if (!monitor.summary || monitor.summary.messageId !== `supplier-summary-${monitor.id}` || monitor.summary.notificationCount !== 1 || Date.parse(monitor.scope.endAt) > clock() || body.expectedSummaryRevision !== monitor.summary.revision || body.expectedSummaryHash !== monitor.summary.contentHash) supplierFail(409, 'NOTIFICATION_SUMMARY_CHANGED', 'Review the actual original completed-window summary first.');
  }
  function current(state, actor, monitor, review) {
    if (!owner(actor, monitor) || monitor.stoppedAt || monitor.scopeHash !== review.scope.monitorHash || review.scope.actorRole !== actor.role || review.scope.adapterFingerprint !== transport.fingerprint || monitor.notificationReviewId !== review.id) supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'The original owner, monitor or notification review changed.');
    summary(monitor, review.scope);
    const service = supplierFind(state, actor, review.scope.conversationId, review.scope.serviceId);
    if (service.cancelledAt || service.rejectedAt) supplierFail(409, 'NOTIFICATION_CANCELLED', 'The original intake was cancelled.');
  }
  function checked(state, actor, cid, sid, body) {
    const monitor = find(state, actor, cid, sid, body.monitorId), review = monitor.notificationReviews?.find(item => item.id === body.operationId);
    if (!review || review.scopeHash !== body.expectedScopeHash || body.confirmed !== true) supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Confirm the exact original notification operation and scope.');
    return { monitor, review };
  }
  function view(monitor, actor) {
    const bound = core.forActor(actor), review = monitor.notificationReviews?.find(item => item.id === monitor.notificationReviewId);
    const approval = review && getCapabilities().listApprovals().find(item => item.id === review.approvalId);
    return { ...core.status(), ...status(), delivery: bound.get(monitor.conversationId, monitor.serviceId, monitor.id), review: review ? { ...clone(review), approval, approvalStatus: approval?.status || null, canExecute: approval?.status === 'approved' && review.status === 'approved' && Date.parse(approval.expiresAt) > clock() } : null };
  }
  const adapter = {
    capabilities: [ACTION], credentialEnvNames: [], actionDescriptions: { [ACTION]: 'Send one separately approved original seven-day summary; source grant/recipient/token come only from existing reviewed host facilities.' },
    async execute({ action, payload: scope, binding: bound, connectorId: cid, idempotencyKey: runId, signal }) {
      if (action !== ACTION || bound?.type !== 'supplier-monitor-notification' || bound.scopeHash !== supplierHash(scope)) supplierFail(403, 'NOTIFICATION_AUTHORIZATION_REQUIRED', 'Only the original exact domain-bound notification approval can send.');
      const actor = { subject: scope.subject, role: scope.actorRole, workspaceId: scope.workspaceId }, monitor = find(store.read(), actor, scope.conversationId, scope.serviceId, scope.monitorId);
      if (monitor.notificationExecution?.runId !== runId || monitor.notificationExecution.connectorId !== cid || monitor.notificationExecution.scope.operationId !== scope.operationId) supplierFail(403, 'NOTIFICATION_AUTHORIZATION_REQUIRED', 'Use the original admitted connectorRun.');
      const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const stopIfRevoked = () => {
        const state = store.read(), connector = state.capabilities.connectors.find(item => item.id === cid), run = state.capabilities.connectorRuns.find(item => item.id === runId);
        const live = find(state, actor, scope.conversationId, scope.serviceId, scope.monitorId), service = supplierFind(store.read(), actor, scope.conversationId, scope.serviceId), grant = grantById(store.read(), scope.subscriptionId);
        if (!live.externalNotification?.finishedAt && (!connector?.enabled || connector.revision !== run?.connectorRevision || !owner(actor, live) || live.stoppedAt || service.cancelledAt || service.rejectedAt || live.externalNotification?.cancelledAt || grant?.state === 'revoked')) controller.abort('ORIGINAL_NOTIFICATION_REVOKED');
      };
      const unsubscribe = store.subscribe(() => { try { stopIfRevoked(); } catch { controller.abort('ORIGINAL_OWNER_REVOKED'); } });
      try {
        stopIfRevoked();
        const facade = getSupplier().forActor(actor).notifications;
        await facade.configure(scope.conversationId, scope.serviceId, { requestId: `notify-config-${scope.operationId}`, monitorId: scope.monitorId, expectedMonitorHash: scope.monitorHash, recipientBindingId: scope.recipientBindingId, expectedBindingRevision: scope.bindingRevision, subscriptionId: scope.subscriptionId, confirmed: true });
        const delivery = await facade.dispatch(scope.conversationId, scope.serviceId, { requestId: `notify-dispatch-${scope.operationId}`, monitorId: scope.monitorId, expectedMonitorHash: scope.monitorHash, expectedSummaryRevision: scope.expectedSummaryRevision, expectedSummaryHash: scope.expectedSummaryHash, confirmed: true }, { signal: combined });
        return { delivery };
      } finally { unsubscribe(); }
    },
  };
  return {
    adapter, ensureConnector, status, async initialize() { return core.recover(); },
    projection(monitor) { return view(monitor, { subject: monitor.subject, workspaceId: monitor.workspaceId, role: currentRole?.(monitor.subject) || 'operator' }); },
    forActor(context, { command, get } = {}) {
      const actor = actorFor(context), original = core.forActor(actor, { command });
      const reply = (cid, sid, mid, extras = {}) => ({ service: get?.(cid, sid), monitorId: mid, notification: view(find(store.read(), actor, cid, sid, mid), actor), ...extras });
      return {
        ...original,
        snapshot(cid, sid, mid) { return reply(cid, sid, mid); },
        async challenge(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'recipientBindingId', 'expectedBindingRevision', 'confirmed']);
          const monitor = find(store.read(), actor, cid, sid, body.monitorId);
          if (!configured() || typeof options.confirmSubscription !== 'function') return { status: 'blocked', code: 'NOTIFICATION_SUBSCRIPTION_PROVIDER_REQUIRED' };
          if (!owner(actor, monitor) || body.confirmed !== true || body.expectedMonitorHash !== monitor.scopeHash) supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Confirm the original monitor before a native client subscription.');
          const recipient = await resolveRecipient({ actor, recipientBindingId: body.recipientBindingId });
          if (!transport.validateRecipient(recipient) || recipient.ownerSubject !== actor.subject || recipient.recipientSubject !== actor.subject || recipient.workspaceId !== actor.workspaceId || recipient.id !== body.recipientBindingId || recipient.revision !== body.expectedBindingRevision) supplierFail(409, 'NOTIFICATION_RECIPIENT_CHANGED', 'Use the existing exact reviewed owner binding.');
          const receipt = await store.update(state => command(state, actor, sid, 'notification_subscription_challenge', body, () => {
            const current = find(state, actor, cid, sid, monitor.id); const challenges = current.notificationChallenges ||= [];
            if (challenges.length >= 100) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Preserve original native subscription challenges.');
            const challenge = { id: randomUUID(), recipientBindingId: recipient.id, bindingRevision: recipient.revision, monitorHash: current.scopeHash, sessionId: context.session?.id || null, issuedAt: at(), expiresAt: new Date(clock() + 300000).toISOString(), adapterFingerprint: transport.fingerprint, usedAt: null };
            challenges.push(challenge); return { challengeId: challenge.id, expiresAt: challenge.expiresAt, appId: options.wechat?.appId || recipient.appId, templateId: options.wechat?.templateId || options.templateId || null };
          }));
          return { ...receipt, evidenceKind: transport.status().evidenceKind, userGestureRequired: true };
        },
        async recordSubscription(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'challengeId', 'decision', 'confirmed']);
          const monitor = find(store.read(), actor, cid, sid, body.monitorId), challenge = monitor.notificationChallenges?.find(item => item.id === body.challengeId);
          if (!configured() || typeof options.confirmSubscription !== 'function') return { status: 'blocked', code: 'NOTIFICATION_SUBSCRIPTION_PROVIDER_REQUIRED' };
          if (!challenge || challenge.monitorHash !== body.expectedMonitorHash || body.confirmed !== true || !['accept', 'reject', 'ban', 'filter'].includes(body.decision)) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'Use the original one-use server/native-client challenge.');
          const prior = supplierRegistry(store.read()).commands.find(item => item.subject === actor.subject && item.workspaceId === actor.workspaceId && item.requestId === body.requestId);
          if (prior) { const replay = await store.update(state => command(state, actor, sid, 'notification_subscription_record', body, () => supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'Original command receipt missing.'))); return replay; }
          const recipient = await resolveRecipient({ actor, recipientBindingId: challenge.recipientBindingId });
          const proof = await options.confirmSubscription({ context, actor, recipient, challenge: clone(challenge), decision: body.decision });
          const fixture = transport.status().evidenceKind === 'local_fixture';
          if (!proof || proof.verified !== true || proof.subject !== actor.subject || proof.workspaceId !== actor.workspaceId || proof.challengeId !== challenge.id || proof.decision !== body.decision || proof.source !== 'wx.requestSubscribeMessage' || proof.provenance !== 'authenticated_wechat_client' || proof.evidenceKind !== (fixture ? 'local_fixture' : 'wechat_client_subscription') || !fixture && (context.client !== 'wechat' || !context.session?.id)) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'A client claim alone is insufficient; use the existing authenticated native proof facility.');
          return store.update(state => command(state, actor, sid, 'notification_subscription_record', body, () => {
            const live = find(state, actor, cid, sid, monitor.id), current = live.notificationChallenges.find(item => item.id === challenge.id);
            if (!owner(actor, live) || live.stoppedAt || current.usedAt || Date.parse(current.expiresAt) <= clock() || current.sessionId !== (context.session?.id || null) || current.adapterFingerprint !== transport.fingerprint) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'The original native challenge expired, was used or changed.');
            current.usedAt = at(); const grants = live.notificationSubscriptions ||= [], id = randomUUID();
            const grant = { id, kind: 'one_time', state: body.decision === 'accept' ? 'available' : 'revoked', decision: body.decision, proofId: current.id, channel: transport.channel, workspaceId: actor.workspaceId, subject: actor.subject, recipientBindingId: recipient.id, bindingRevision: recipient.revision, monitorId: live.id, scopeHash: live.scopeHash, summaryId: `supplier-summary-${live.id}`, acceptedAt: at(), appId: proof.appId, templateId: proof.templateId, source: proof.source, provenance: proof.provenance, evidenceKind: proof.evidenceKind };
            if (body.decision === 'accept' && !transport.validateSubscription(grant, { recipient, monitor: live, now: clock() })) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'The native proof AppID/template does not match this existing channel.');
            grants.push(grant); return { subscriptionId: id, state: grant.state, recipientBindingId: recipient.id, bindingRevision: recipient.revision, evidenceKind: grant.evidenceKind };
          }));
        },
        async revokeSubscription(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'subscriptionId', 'confirmed']);
          await store.update(state => command(state, actor, sid, 'notification_subscription_revoke', body, () => {
            const monitor = find(state, actor, cid, sid, body.monitorId), grant = grantById(state, body.subscriptionId);
            if (body.confirmed !== true || monitor.scopeHash !== body.expectedMonitorHash || !grant || grant.monitorId !== monitor.id || grant.subject !== actor.subject) supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Revoke this exact original owned subscription.');
            grant.state = 'revoked'; grant.revokedAt = at(); return { subscriptionId: grant.id };
          }));
          return reply(cid, sid, body.monitorId);
        },
        async reviewNotification(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'recipientBindingId', 'expectedBindingRevision', 'subscriptionId', 'expectedSummaryRevision', 'expectedSummaryHash', 'confirmed']);
          const monitor = find(store.read(), actor, cid, sid, body.monitorId);
          if (!configured()) return reply(cid, sid, body.monitorId, { status: 'blocked', code: 'NOTIFICATION_UNCONFIGURED' });
          if (!owner(actor, monitor) || body.confirmed !== true || body.expectedMonitorHash !== monitor.scopeHash) supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Explicitly review this original completed-window notification.');
          summary(monitor, body);
          if (monitor.externalNotification?.submittedAt || monitor.externalNotification?.cancelledAt) return reply(cid, sid, body.monitorId, { duplicate: true });
          const recipient = await resolveRecipient({ actor, recipientBindingId: body.recipientBindingId }), grant = grantById(store.read(), body.subscriptionId);
          if (!transport.validateRecipient(recipient) || recipient.id !== body.recipientBindingId || recipient.revision !== body.expectedBindingRevision || recipient.workspaceId !== actor.workspaceId || recipient.ownerSubject !== actor.subject || recipient.recipientSubject !== actor.subject || !grant || grant.monitorId !== monitor.id || grant.scopeHash !== monitor.scopeHash || grant.state !== 'available' || !transport.validateSubscription(grant, { recipient, monitor, now: clock() })) supplierFail(409, 'NOTIFICATION_SUBSCRIPTION_REQUIRED', 'Use the exact existing owner binding and authenticated one-time subscription receipt.');
          const connector = await ensureConnector(); if (connector.status !== 'ready') return reply(cid, sid, body.monitorId, { status: 'blocked', code: 'NOTIFICATION_CONNECTOR_REQUIRED' });
          const saved = await store.update(state => command(state, actor, sid, 'notification_review', body, () => {
            const live = find(state, actor, cid, sid, monitor.id); summary(live, body);
            if (live.externalNotification?.submittedAt || live.externalNotification?.cancelledAt) supplierFail(409, 'NOTIFICATION_ALREADY_ATTEMPTED', 'Keep the original delivery; corrections do not push again.');
            const reviews = live.notificationReviews ||= []; if (reviews.length >= 100) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Preserve notification approval history.');
            const id = randomUUID(), scope = { schema: 'workspace.original-monitor-notification.v1', operationId: id, subject: actor.subject, actorRole: actor.role, workspaceId: actor.workspaceId, conversationId: cid, serviceId: sid, monitorId: monitor.id, monitorHash: monitor.scopeHash, recipientBindingId: recipient.id, bindingRevision: recipient.revision, subscriptionId: grant.id, expectedSummaryRevision: body.expectedSummaryRevision, expectedSummaryHash: body.expectedSummaryHash, adapterFingerprint: transport.fingerprint, channel: transport.channel, template: { appId: options.wechat?.appId || recipient.appId, templateId: options.wechat?.templateId || options.templateId || grant.templateId, fields: clone(options.wechat?.fields || null), title: '七天经营总结', status: live.summary.provisional ? '待核实' : '已完成', endDate: live.scope.endAt.slice(0, 10) }, evidenceKind: transport.status().evidenceKind };
            const review = { id, scope, scopeHash: supplierHash(scope), status: 'preparing', connectorId, approvalId: null, connectorRunId: null, createdAt: at() }; reviews.push(review); live.notificationReviewId = id; return { operationId: id };
          }));
          const live = find(store.read(), actor, cid, sid, monitor.id), review = live.notificationReviews.find(item => item.id === saved.operationId);
          if (!review.approvalId) await getCapabilities().requestApproval({ ...getCapabilities().connectorApprovalRequest(connectorId, request(review), { binding: binding(review) }), expiresInSeconds: 1800 }, { onCreated(state, approval) { const actual = find(state, actor, cid, sid, monitor.id), record = actual.notificationReviews.find(item => item.id === review.id); current(state, actor, actual, record); if (record.approvalId) supplierFail(409, 'NOTIFICATION_ALREADY_REVIEWED', 'This review already has an original approval.'); record.approvalId = approval.id; record.status = 'pending_approval'; } });
          return reply(cid, sid, monitor.id, { duplicate: saved.duplicate === true });
        },
        async decideNotification(cid, sid, body) {
          supplierRequest(body, ['monitorId', 'operationId', 'expectedScopeHash', 'decision', 'confirmed']);
          const { monitor, review } = checked(store.read(), actor, cid, sid, body);
          const prior = supplierRegistry(store.read()).commands.find(item => item.subject === actor.subject && item.workspaceId === actor.workspaceId && item.requestId === body.requestId);
          if (prior) { await store.update(state => command(state, actor, sid, 'notification_decision', body, () => supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Keep the original decision receipt.'))); return reply(cid, sid, monitor.id, { duplicate: true }); }
          await getCapabilities().decideApproval(review.approvalId, { decision: body.decision, confirmed: true }, { onDecision(state) { const live = find(state, actor, cid, sid, monitor.id), record = live.notificationReviews.find(item => item.id === review.id); if (body.decision === 'approved') current(state, actor, live, record); command(state, actor, sid, 'notification_decision', body, () => { record.status = body.decision; return { operationId: record.id }; }); } });
          return reply(cid, sid, monitor.id);
        },
        async executeNotification(cid, sid, body, { signal } = {}) {
          supplierRequest(body, ['monitorId', 'operationId', 'expectedScopeHash', 'confirmed']);
          const { monitor, review } = checked(store.read(), actor, cid, sid, body);
          const prior = supplierRegistry(store.read()).commands.find(item => item.subject === actor.subject && item.workspaceId === actor.workspaceId && item.requestId === body.requestId);
          if (prior) await store.update(state => command(state, actor, sid, 'notification_execute', body, () => supplierFail(409, 'NOTIFICATION_SCOPE_CHANGED', 'Keep the original send command receipt.')));
          if (review.connectorRunId || monitor.externalNotification?.submittedAt || monitor.externalNotification?.cancelledAt) return reply(cid, sid, monitor.id, { duplicate: true });
          current(store.read(), actor, monitor, review);
          const result = await getCapabilities().executeConnector(connectorId, { ...request(review), approvalId: review.approvalId }, { signal, binding: binding(review),
            assertAllowed(state) { const live = find(state, actor, cid, sid, monitor.id), record = live.notificationReviews.find(item => item.id === review.id); current(state, actor, live, record); if (record.status !== 'approved' || record.connectorRunId || live.externalNotification?.submittedAt || live.externalNotification?.cancelledAt) supplierFail(409, 'NOTIFICATION_ALREADY_ATTEMPTED', 'The original notification was already used or changed.'); },
            onAdmitted(state, run) { const live = find(state, actor, cid, sid, monitor.id), record = live.notificationReviews.find(item => item.id === review.id); command(state, actor, sid, 'notification_execute', body, () => { record.status = 'running'; record.connectorRunId = run.id; live.notificationExecution = { runId: run.id, connectorId, approvalId: review.approvalId, scope: clone(review.scope) }; return { operationId: review.id }; }); } });
          await store.update(state => { const live = find(state, actor, cid, sid, monitor.id), record = live.notificationReviews.find(item => item.id === review.id); if (result.execution.status === 'blocked') record.status = 'approved'; else record.status = live.externalNotification?.status || (result.execution.status === 'succeeded' ? 'blocked' : 'unknown'); record.finishedAt = at(); });
          return reply(cid, sid, monitor.id);
        },
      };
    },
    async dispatchApproved(monitor) {
      const review = monitor.notificationReviews?.find(item => item.id === monitor.notificationReviewId), approval = review && getCapabilities().listApprovals().find(item => item.id === review.approvalId);
      if (!review || review.status !== 'approved' || approval?.status !== 'approved') return { status: 'blocked', code: 'NOTIFICATION_SEPARATE_APPROVAL_REQUIRED' };
      const actor = { subject: monitor.subject, workspaceId: monitor.workspaceId, role: currentRole?.(monitor.subject) || review.scope.actorRole }, facade = getSupplier().forActor(actor).notifications;
      return facade.executeNotification(monitor.conversationId, monitor.serviceId, { requestId: `notification-scheduled-${review.id}`, monitorId: monitor.id, operationId: review.id, expectedScopeHash: review.scopeHash, confirmed: true });
    },
  };
}
