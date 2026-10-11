import { createMuseWorkerHost } from './muse-worker-host.mjs';
import { createWorkerServiceDesk, WorkerDeskError } from './worker-desk.mjs';
import { createWorkerOpportunityService, WorkerOpportunityError } from './worker-opportunities.mjs';
import { MuseWorkerError } from './muse-worker-api.mjs';
import { createMuseSessionProjection } from './muse-worker-session.mjs';
import { createMuseConversationDelegation, validateMuseConversationDelegations } from './muse-conversation-delegation.mjs';
import { createWorkspaceControlReader } from './dot-control-plane-host.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
// Original native owner/session identifiers allow @ and /; Worker API IDs keep
// their independently specified, narrower contract above.
const nativeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
// Preserve the original durable artifact owner schema: Worker IDs are UUIDs.
const nativeWorkerId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const publicConfigurationFields = ['workerId', 'ownerId', 'tokenDigest', 'enabled', 'scopeReviewed', 'externalBudgetVerified'];

export function validateNativeMuseConfiguration(config, actor, operators) {
  if (!object(config) || Object.keys(config).some(key => !publicConfigurationFields.includes(key)) ||
      !nativeWorkerId(config.workerId) || !id(config.ownerId) || !/^[a-f0-9]{64}$/.test(config.tokenDigest ?? '') ||
      !['enabled', 'scopeReviewed', 'externalBudgetVerified'].every(key => typeof config[key] === 'boolean') ||
      !object(actor) || Object.keys(actor).some(key => !['subject', 'nativeAgentId'].includes(key)) ||
      !nativeId(actor.subject) || !nativeId(actor.nativeAgentId) || !Array.isArray(operators) ||
      operators.filter(item => item.subject === actor.subject && item.nativeAgentId === actor.nativeAgentId).length !== 1)
    throw new TypeError('Muse needs one explicit reviewed native owner, a separate token digest and boolean gates.');
  return Object.freeze({ ...config });
}

export function validateNativeMuseReconciliationReview(review, status) {
  const fields = ['version', 'action', 'requestId', 'expectedEpoch', 'configurationHash', 'callbackCandidateIds'];
  if (!object(review) || Object.keys(review).some(key => !fields.includes(key)) ||
      review.version !== 1 || review.action !== 'muse-reconcile' ||
      typeof review.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(review.requestId) ||
      !Array.isArray(review.callbackCandidateIds) || review.callbackCandidateIds.length !== 0 ||
      !Number.isSafeInteger(review.expectedEpoch) || review.expectedEpoch < 0 ||
      !/^[a-f0-9]{64}$/.test(review.configurationHash ?? '') || status?.phase !== 'paused' ||
      review.expectedEpoch !== status.epoch || review.configurationHash !== status.configurationHash)
    throw new MuseWorkerError(409, 'MW_RECONCILIATION_REVIEW', 'Review only the exact paused native mount; do not resume or change Dot authorization.');
  return Object.freeze({ expectedEpoch: review.expectedEpoch, configurationHash: review.configurationHash });
}

/** A transport and business binding to the parent's guarded writer and actor.
 * The existing WorkerDesk implementation is reused once. This binding opens no
 * store, artifact service, listener, model client, scheduler or native Agent.
 * run must retain the parent's captured lifecycle epoch and AsyncLocalStorage.
 */
export function createNativeMuseBinding({ store, artifacts, config, actor, operators,
  run, expectedHost, dotWorkerConfig, readBody, respond } = {}) {
  config = validateNativeMuseConfiguration(config, actor, operators);
  if (typeof run !== 'function' || typeof expectedHost !== 'string' || !expectedHost ||
      /[\s/]/.test(expectedHost) || typeof store?.read !== 'function' || typeof store?.update !== 'function' ||
      typeof artifacts?.create !== 'function' || typeof artifacts?.download !== 'function')
    throw new TypeError('Muse requires the parent lifecycle, guarded writer and exact trusted ingress Host.');
  actor = Object.freeze({ ...actor });
  let closing;
  let stopped = false;
  const parentStore = store;
  store = { read: () => parentStore.read(),
    update(callback) {
      return parentStore.update(state => {
        validateMuseConversationDelegations(state);
        const originalEvents = new Set((state.activity ?? []).map(item => item.id));
        const originalOrders = new Set((state.workerOrders ?? []).map(item => item.id));
        const result = callback(state);
        if (result?.then) throw new TypeError('Muse bridge transactions must remain synchronous.');
        for (const event of state.activity ?? []) if (!originalEvents.has(event.id) && event.type?.startsWith('muse_worker_'))
          event.workerOwner = { subject: actor.subject, nativeAgentId: actor.nativeAgentId };
        for (const order of state.workerOrders ?? []) if (!originalOrders.has(order.id) &&
          order.createdBy === actor.subject && order.workerId === config.workerId)
          order.museSession = { ...actor, workerId: config.workerId };
        validateMuseConversationDelegations(state);
        return result;
      });
    },
  };
  const owned = artifact => artifact?.workerOwner?.subject === actor.subject &&
    artifact.workerOwner.workerId === config.workerId &&
    artifact.metadata?.museOwnerSubject === actor.subject &&
    artifact.metadata.museNativeAgentId === actor.nativeAgentId;
  const boundArtifacts = {
    async create(input, options = {}) {
      return artifacts.create({ ...input, metadata: { ...input.metadata,
        museOwnerSubject: actor.subject, museNativeAgentId: actor.nativeAgentId } }, {
        ...options,
        workerOwner: { subject: actor.subject, workerId: config.workerId },
        check(state) {
          const previous = state.artifacts?.find(item => item.requestId === input.requestId);
          if (previous && !owned(previous)) throw new MuseWorkerError(409, 'MW_ARTIFACT_OWNER_CONFLICT', 'The file request belongs to another owner.');
          options.check?.(state);
        },
      });
    },
    download(artifactId, options = {}) {
      if (!owned(store.read().artifacts?.find(item => item.id === artifactId)))
        throw new MuseWorkerError(404, 'MW_FILE_NOT_FOUND', 'This file is not owned by this Muse binding.');
      // Worker uploads and accepted receipts are immutable first versions.
      // The existing bridge also parses structured reports through this path.
      return artifacts.download(artifactId, { version: 1, ...options });
    },
  };
  const host = createMuseWorkerHost({ store, artifacts: boundArtifacts, config,
    dotWorkerConfig, readBody, respond });
  const desk = createWorkerServiceDesk({ store, artifacts: boundArtifacts,
    adapters: { [host.workerId]: host.adapter }, validateActor: nativeId });
  const session = createMuseSessionProjection({ store, artifacts: boundArtifacts, actor,
    workerId: host.workerId, ownedArtifact: owned });
  const conversation = createMuseConversationDelegation({ store, desk, session, actor, workerId: host.workerId, operators });
  function scoped(callback, active = false) {
    if (stopped) throw new MuseWorkerError(503, 'MW_GATEWAY_CLOSED', 'The Muse binding is unloading.');
    return run(callback, { active });
  }
  const belongs = order => order?.createdBy === actor.subject && order.workerId === host.workerId;
  const ownedOpportunity = (state, item) => belongs(state.workerOrders?.find(order => order.id === item.sourceOrderId));
  const opportunityStore = {
    read() {
      const state = store.read();
      return { ...state, workerOrders: (state.workerOrders ?? []).filter(belongs),
        workerOpportunities: (state.workerOpportunities ?? []).filter(item => ownedOpportunity(state, item)) };
    },
    update(callback) {
      return store.update(state => {
        const foreign = (state.workerOpportunities ?? []).filter(item => !ownedOpportunity(state, item));
        const scopedState = { ...state, workerOrders: (state.workerOrders ?? []).filter(belongs),
          workerOpportunities: (state.workerOpportunities ?? []).filter(item => ownedOpportunity(state, item)) };
        const result = callback(scopedState);
        if (result?.then) throw new TypeError('Opportunity transactions must remain synchronous.');
        state.workerOpportunities = [...foreign, ...scopedState.workerOpportunities];
        return result;
      });
    },
  };
  const opportunities = createWorkerOpportunityService({ store: opportunityStore, validateActor: nativeId });
  function order(id) {
    const result = desk.get(id);
    if (!belongs(result)) throw new WorkerDeskError(404, 'ORDER_NOT_FOUND', 'The Muse order is not owned by this operator.');
    return result;
  }
  function bindDesk(requestActor) {
    if (requestActor?.subject !== actor.subject || requestActor.nativeAgentId !== actor.nativeAgentId)
      throw new WorkerDeskError(403, 'MUSE_OWNER_REQUIRED', 'This operator has no reviewed Muse binding.');
    // Even reads must execute within the same pinned native lifecycle.
    return Object.freeze({
      catalog: () => scoped(() => desk.catalog()),
      list: () => scoped(() => desk.list().filter(belongs).map(item => item.museConversation ?
        { ...item, conversationDelegation: conversation.get(item.id) } : item)),
      get: id => scoped(() => { const item = order(id); return item.museConversation ?
        { ...item, conversationDelegation: conversation.get(id) } : item; }),
      tasks: () => scoped(() => host.bridge.adminTasks()),
      info: () => scoped(() => host.bridge.info()),
      create: input => scoped(() => {
        if (input?.workerId !== undefined && input.workerId !== host.workerId)
          throw new WorkerDeskError(409, 'WORKER_UNAVAILABLE', 'Use the reviewed Muse Worker.');
        return desk.create({ ...input, workerId: host.workerId }, actor.subject);
      }, true),
      approve: (id, input) => scoped(() => {
        order(id);
        if (input?.workerId !== undefined && input.workerId !== host.workerId)
          throw new WorkerDeskError(409, 'WORKER_UNAVAILABLE', 'Use the reviewed Muse Worker.');
        if (order(id).museConversation) return conversation.approve(id, input).then(result => ({ ...result, order: order(id) }));
        return desk.approve(id, actor.subject, { ...input, workerId: host.workerId });
      }, true),
      dispatch: id => scoped(() => { const current = order(id);
        return current.museConversation ? conversation.dispatch(id, { confirmed: true, expectedReviewHash: current.museConversation.reviewHash })
          .then(result => ({ ...result, order: order(id) })) : desk.dispatch(id); }, true),
      refresh: id => scoped(() => { order(id); return desk.refresh(id); }),
      accept: (id, input) => scoped(() => { const current = order(id);
        return current.museConversation ? conversation.accept(id, input).then(result => ({ ...result, order: order(id) })) : desk.accept(id, actor.subject, input); }),
      cancel: id => scoped(() => { order(id); return desk.cancel(id); }),
      opportunities: () => scoped(() => opportunities.list().filter(item => {
        try { return belongs(desk.get(item.sourceOrderId)); } catch { return false; }
      })),
      promote: (id, input) => scoped(() => { order(id); return opportunities.importFromOrder(id, input, actor.subject); }),
      review: (id, input) => scoped(() => {
        const item = opportunities.get(id); order(item.sourceOrderId);
        return opportunities.review(id, input, actor.subject);
      }),
      download: id => scoped(() => boundArtifacts.download(id)),
    });
  }
  function boundary(req) {
    if (!loopback.has(req.socket?.remoteAddress) || req.headers.host !== expectedHost)
      throw new MuseWorkerError(403, 'MW_INGRESS_REQUIRED', 'Use the exact trusted HTTPS ingress.');
    for (const name of ['host', 'authorization', 'content-length', 'content-type', 'origin', 'cookie']) {
      let count = 0;
      for (let i = 0; i < (req.rawHeaders?.length ?? 0); i += 2)
        if (req.rawHeaders[i].toLowerCase() === name) count++;
      if (count > 1) throw new MuseWorkerError(400, 'MW_AMBIGUOUS_HEADER', 'Duplicate security headers are not allowed.');
    }
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || /[\\\u0000-\u001f]/.test(req.url))
      throw new MuseWorkerError(400, 'MW_INVALID_TARGET', 'Use a relative Worker API path.');
    if (['GET', 'HEAD', 'DELETE'].includes(req.method) && (Number(req.headers['content-length'] ?? 0) !== 0 || req.headers['transfer-encoding']))
      throw new MuseWorkerError(400, 'MW_BODY_NOT_ALLOWED', 'This method does not accept a body.');
  }
  // Trusted original Host read binding; no transport, reconciliation or new authority.
  function bindControl(requestActor, scope) {
    if (requestActor?.subject !== actor.subject || requestActor.nativeAgentId !== actor.nativeAgentId)
      throw new WorkerDeskError(403, 'MUSE_OWNER_REQUIRED', 'Use the original reviewed Muse Session owner.');
    if (!object(scope) || Object.keys(scope).some(key => !['workspaceId', 'policyVersion'].includes(key))
      || !id(scope.workspaceId) || !id(scope.policyVersion))
      throw new TypeError('Control scope must come from the original Host configuration.');
    const principal = { workspaceId: scope.workspaceId, userId: actor.subject, policyVersion: scope.policyVersion,
      grants: [{ sourceId: 'muse-host', scope: 'self', kinds: ['goal', 'order', 'task', 'attempt'] }] };
    return createWorkspaceControlReader({ sourceId: 'muse-host',
      readContext: () => scoped(() => ({ principal, binding: { actor, workerId: host.workerId } })),
      readState: () => scoped(() => store.read()),
      readMuseSession: () => scoped(() => session.view()),
    });
  }
  function bindSession(requestActor) {
    if (requestActor?.subject !== actor.subject || requestActor.nativeAgentId !== actor.nativeAgentId)
      throw new WorkerDeskError(403, 'MUSE_OWNER_REQUIRED', 'This operator has no reviewed Muse Session binding.');
    return Object.freeze({
      view: () => scoped(() => session.view()),
      download: reference => scoped(() => session.download(reference)),
      acknowledge: (orderId, receiptHash) => scoped(() => session.acknowledge(orderId, receiptHash)),
      messageId: orderId => session.messageId(orderId),
      refreshSubmitted: () => scoped(async () => {
        for (const item of session.view()) if (item.executionStatus === 'submitted' && !item.receipt &&
          ['queued', 'running', 'dispatch_uncertain', 'input_required'].includes(item.status)) {
          await desk.refresh(item.orderId);
        }
      }),
    });
  }
  function bindConversation(requestActor) {
    if (requestActor?.subject !== actor.subject || requestActor.nativeAgentId !== actor.nativeAgentId)
      throw new WorkerDeskError(403, 'MUSE_OWNER_REQUIRED', 'Use the original reviewed Muse conversation.');
    return Object.freeze(Object.fromEntries(Object.entries(conversation).map(([name, method]) =>
      [name, (...args) => scoped(() => method(...args), ['prepare', 'approve', 'dispatch'].includes(name))])));
  }
  return Object.freeze({ workerId: host.workerId, bindDesk, bindSession, bindConversation, bindControl,
    initialize: () => scoped(() => {
      if (desk.list().some(item => item.status === 'dispatching' && !belongs(item)))
        throw new WorkerDeskError(409, 'MUSE_RECOVERY_OWNER_REQUIRED', 'Review the original WorkerDesk owner before recovering unrelated orders.');
      return desk.recoverInterrupted();
    }),
    async handle(req, res, pathname) {
      if (pathname !== '/api/muse-worker' && !pathname?.startsWith('/api/muse-worker/')) return false;
      boundary(req);
      // Identity/inbox/status and stop acknowledgments remain read/admission
      // operations; execution mutations additionally require an active scope.
      const active = req.method === 'POST' && /\/(claim|heartbeat|upload-file|submit-result|report-blocked)$/.test(pathname);
      return scoped(() => host.handle(req, res, pathname), active);
    },
    close() {
      if (closing) return closing;
      stopped = true;
      closing = host.close();
      return closing;
    },
  });
}

export function isNativeMusePublicError(error) {
  return error instanceof MuseWorkerError || error instanceof WorkerDeskError || error instanceof WorkerOpportunityError;
}

/** Lifecycle changes revoke leases without replacing attempts or replaying work.
 * Caller executes this only inside the existing parent's atomic transaction.
 */
export function quarantineNativeMuse(state, reason) {
  for (const task of state.museTasks ?? []) {
    if (!['claimed', 'blocked', 'cancel_requested'].includes(task.status) || !task.attemptId) continue;
    task.leaseUntil = null;
    if (task.status === 'claimed') task.status = 'blocked';
    task.blockedReason = 'Original native Host authority changed; review the same task before any further execution.';
    task.nativePauseReason = reason;
  }
  for (const order of state.workerOrders ?? []) {
    if (!(state.museTasks ?? []).some(task => task.orderId === order.id && task.workerId === order.workerId)) continue;
    if (['queued', 'running', 'input_required'].includes(order.status)) {
      order.status = 'input_required';
      order.error = { code: 'MUSE_SCOPE_CHANGED', message: 'The original native scope changed; reconcile or cancel this same order without replay.' };
    }
  }
}
