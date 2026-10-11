import { createHash } from 'node:crypto';
import { MuseWorkerError } from './muse-worker-api.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fail = (status, code, message) => { throw new MuseWorkerError(status, code, message); };
const finished = new Set(['accepted', 'cancelled', 'failed']);
const same = (a, b) => a?.subject === b.subject && a?.nativeAgentId === b.nativeAgentId;
const owned = (order, actor, workerId) => order.createdBy === actor.subject && order.workerId === workerId;
const messageId = (actor, workerId, requestId) => 'workspace-muse-request-' + digest([actor.subject, actor.nativeAgentId, workerId, requestId]);
const scope = order => ({ serviceId: order.serviceId, product: order.product, market: order.market,
  objective: order.objective, budgetCredits: order.budgetCredits, deadlineAt: order.deadlineAt,
  workerId: order.workerId, actor: order.createdBy });
const review = order => ({ schema: 'workspace.muse.conversation-review.v1', provider: 'muse',
  conversationId: order.museConversation.nativeAgentId, orderId: order.id,
  requestId: order.requestId, ...scope(order), contentHash: order.museConversation.contentHash });
const requestHash = (fingerprint, contentHash, conversationId) => digest({ provider: 'muse', conversationId, fingerprint, contentHash });
const text = (value, maximum) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
    fail(400, 'MW_CONVERSATION_INPUT', 'Use bounded plain text and an explicit reviewed public scope.');
  return value.trim();
};

/** An additive mapping on original orders, not a second queue or approval store. */
export function validateMuseConversationDelegations(state, { operators } = {}) {
  const seen = new Set();
  for (const order of state.workerOrders ?? []) {
    const mapping = order.museConversation;
    if (mapping === undefined) continue;
    if (!fields(mapping, ['version', 'subject', 'nativeAgentId', 'workerId', 'requestId', 'requestHash', 'contentHash', 'reviewHash', 'messageId'])
      || mapping.version !== 1 || !id(mapping.requestId) || mapping.requestId !== order.requestId
      || mapping.subject !== order.createdBy || mapping.workerId !== order.workerId
      || !same(mapping, order.museSession) || order.museSession.workerId !== mapping.workerId
      || operators && !operators.some(actor => same(mapping, actor))
      || ![mapping.contentHash, mapping.requestHash, mapping.reviewHash].every(value => /^[a-f0-9]{64}$/.test(value))
      || order.dataMode !== 'public' || order.requestFingerprint !== digest(scope(order))
      || mapping.reviewHash !== digest(review(order))
      || mapping.requestHash !== requestHash(order.requestFingerprint, mapping.contentHash, mapping.nativeAgentId)
      || mapping.messageId !== messageId(mapping, mapping.workerId, mapping.requestId))
      fail(409, 'MW_CONVERSATION_CHANGED', 'Preserve the original conversation, reviewed order and request identity.');
    const key = JSON.stringify([mapping.subject, mapping.requestId]);
    const conversation = (state.conversations ?? []).filter(item => item.id === mapping.nativeAgentId);
    const messages = (state.messages ?? []).filter(item => item.id === mapping.messageId);
    if (seen.has(key) || conversation.length !== 1 || !same(conversation[0], mapping)
      || messages.length !== 1 || messages[0].role !== 'user' || messages[0].conversationId !== mapping.nativeAgentId
      || digest(messages[0].content) !== mapping.contentHash
      || messages[0].museOrderId !== order.id || messages[0].museReviewHash !== mapping.reviewHash)
      fail(409, 'MW_CONVERSATION_CHANGED', 'Preserve the exact original conversation message; do not repair it by replaying work.');
    seen.add(key);
  }
}

/** Fixed Host-owned Muse actor. All execution and recovery stay in WorkerDesk. */
export function createMuseConversationDelegation({ store, desk, session, actor, workerId, operators }) {
  if (!store?.read || !desk?.create || !session?.view || !actor?.subject || !actor.nativeAgentId || !id(workerId))
    throw new TypeError('Use the existing original Muse binding and guarded writer.');
  actor = Object.freeze({ ...actor });
  const validate = state => validateMuseConversationDelegations(state, { operators });
  validate(store.read());
  function find(orderId, state = store.read()) {
    validate(state);
    const order = (state.workerOrders ?? []).find(item => item.id === orderId && owned(item, actor, workerId)
      && same(item.museConversation, actor));
    if (!order) fail(404, 'MW_CONVERSATION_NOT_FOUND', 'The original Muse delegation belongs to another conversation.');
    return order;
  }
  function projected(order) {
    const result = session.view().find(item => item.orderId === order.id);
    if (!result || result.nativeAgentId !== actor.nativeAgentId || result.workerId !== workerId)
      fail(409, 'MW_CONVERSATION_CHANGED', 'The original Muse Session mapping changed.');
    let phase = order.status;
    if (order.status === 'draft') phase = 'review_required';
    else if (order.status === 'dispatching') phase = 'dispatching';
    else if (order.status === 'cancel_requested') phase = 'cancel_requested';
    else if (order.status === 'dispatch_uncertain') phase = 'reconciliation_required';
    else if (order.status === 'accepted') phase = 'enterprise_accepted';
    else if (result.returnedHash) phase = 'result_returned';
    else if (result.receipt) phase = 'result_ready';
    else if (result.executionStatus === 'claimed') phase = Date.parse(result.leaseUntil) > Date.now() ? 'claimed' : 'lease_expired';
    else if (result.executionStatus === 'pending') phase = Date.parse(order.deadlineAt) > Date.now() ? 'queued' : 'deadline_expired';
    return { provider: 'muse', conversationId: actor.nativeAgentId, orderId: order.id, requestId: order.requestId,
      reviewHash: order.museConversation.reviewHash, review: review(order), phase,
      orderStatus: order.status, approvalRequired: order.status === 'draft',
      createdAt: order.createdAt, updatedAt: order.updatedAt, taskUpdatedAt: result.taskUpdatedAt,
      blockerCode: /^[A-Z0-9_]{1,100}$/.test(order.error?.code ?? '') ? order.error.code : null,
      taskRef: result.taskRef, executionStatus: result.executionStatus,
      attemptId: result.attemptId, fence: result.fence, leaseUntil: result.leaseUntil,
      deadlineAt: order.deadlineAt, receipt: result.receipt, receiptHash: result.receiptHash,
      returnedHash: result.returnedHash, acceptedAt: result.acceptedAt,
      wake: { supported: false, observed: false, reason: 'original_muse_wakeup_not_verified' },
      executionStartedAt: null, independentlyVerified: false };
  }
  function get(orderId) { return projected(find(orderId)); }
  function action(orderId, body, extra = []) {
    if (!fields(body, ['expectedReviewHash', 'confirmed', ...extra]) || body.confirmed !== true)
      fail(400, 'MW_CONVERSATION_CONFIRMATION', 'Confirm the exact reviewed public scope and budget.');
    const order = find(orderId);
    if (body.expectedReviewHash !== order.museConversation.reviewHash)
      fail(409, 'MW_CONVERSATION_STALE_REVIEW', 'Review the original order and current scope hash before authorizing it.');
    return order;
  }
  async function prepare(input) {
    if (!fields(input, ['provider', 'conversationId', 'requestId', 'content', 'order'])
      || input.provider !== 'muse' || input.conversationId !== actor.nativeAgentId || !id(input.requestId)
      || !fields(input.order, ['serviceId', 'product', 'market', 'objective', 'budgetCredits', 'deadlineAt', 'publicDataConfirmed']))
      fail(400, 'MW_CONVERSATION_INPUT', 'Select Muse explicitly on the original conversation and supply the exact public order.');
    const content = text(input.content, 4000), contentHash = digest(content);
    const deadline = Date.parse(input.order.deadlineAt);
    if (typeof input.order.deadlineAt !== 'string' || !Number.isFinite(deadline))
      fail(400, 'MW_CONVERSATION_INPUT', 'Use an explicit valid deadline.');
    const orderInput = { ...input.order, product: text(input.order.product, 240), market: text(input.order.market, 100),
      objective: text(input.order.objective, 2500), deadlineAt: new Date(deadline).toISOString(),
      requestId: input.requestId, workerId };
    // An exact retry may arrive after its original deadline. Do not revalidate
    // it as new work, and never create another order for the same requestId.
    const fingerprint = digest({ serviceId: orderInput.serviceId, product: orderInput.product, market: orderInput.market,
      objective: orderInput.objective, budgetCredits: orderInput.budgetCredits, deadlineAt: orderInput.deadlineAt, workerId, actor: actor.subject });
    const expectedHash = requestHash(fingerprint, contentHash, actor.nativeAgentId);
    const current = store.read(); validate(current);
    const previous = (current.workerOrders ?? []).find(item => item.requestId === input.requestId && item.createdBy === actor.subject);
    if (previous) {
      if (input.order.publicDataConfirmed !== true || !same(previous.museConversation, actor)
        || previous.museConversation.requestHash !== expectedHash)
        fail(409, 'MW_CONVERSATION_IDEMPOTENCY', 'This requestId already identifies another scope or original conversation.');
      return { delegation: get(previous.id), duplicate: true };
    }
    const result = await desk.create(orderInput, actor.subject, { attach(state, order, duplicate) {
      validate(state);
      if (duplicate) {
        if (!same(order.museConversation, actor) || order.museConversation.requestHash !== expectedHash)
          fail(409, 'MW_CONVERSATION_IDEMPOTENCY', 'Do not adopt an unrelated existing order.');
        return;
      }
      if ((state.workerOrders ?? []).some(item => item.id !== order.id && owned(item, actor, workerId) && !finished.has(item.status)))
        fail(409, 'MW_CONVERSATION_UNFINISHED', 'Finish or cancel the original delegation before preparing another.');
      state.conversations ??= []; state.messages ??= [];
      const conversation = state.conversations.find(item => item.id === actor.nativeAgentId);
      if (conversation && !same(conversation, actor)) fail(409, 'MW_CONVERSATION_CHANGED', 'The original conversation has another owner.');
      order.museSession = { ...actor, workerId };
      order.museConversation = { version: 1, ...actor, workerId, requestId: input.requestId,
        requestHash: expectedHash, contentHash, reviewHash: '', messageId: messageId(actor, workerId, input.requestId) };
      order.museConversation.reviewHash = digest(review(order));
      if (state.messages.some(item => item.id === order.museConversation.messageId))
        fail(409, 'MW_CONVERSATION_CHANGED', 'The original message ID already exists; preserve its contents.');
      const at = order.createdAt;
      if (!conversation) state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Workspace Muse', createdAt: at, updatedAt: at });
      state.messages.push({ id: order.museConversation.messageId, conversationId: actor.nativeAgentId, role: 'user',
        content, status: 'complete', createdAt: at, museOrderId: order.id, museReviewHash: order.museConversation.reviewHash });
      validate(state);
    } });
    return { delegation: get(result.order.id), duplicate: result.duplicate };
  }
  async function approve(orderId, body) {
    const order = action(orderId, body);
    if (order.approvedAt && order.approvedBy === actor.subject) return { delegation: get(orderId), duplicate: true };
    await desk.approve(orderId, actor.subject, { confirmed: true, workerId });
    return { delegation: get(orderId), duplicate: false };
  }
  async function dispatch(orderId, body) {
    const order = action(orderId, body);
    if (order.approvedBy !== actor.subject || !order.approvedAt) fail(409, 'MW_CONVERSATION_APPROVAL_REQUIRED', 'Approve the exact original order before dispatch.');
    if (order.status !== 'approved') return { delegation: get(orderId), duplicate: true };
    try { await desk.dispatch(orderId); }
    catch (error) {
      // A concurrent exact dispatch may have already reserved this original
      // order. Never conceal persistence, adapter or reconciliation failures.
      if (error.code !== 'INVALID_STATE' || find(orderId).status === 'approved') throw error;
    }
    return { delegation: get(orderId), duplicate: false };
  }
  async function refresh(orderId) {
    const order = find(orderId);
    if (['queued', 'running', 'cancel_requested', 'dispatch_uncertain', 'input_required'].includes(order.status))
      await desk.refresh(orderId);
    return { delegation: get(orderId) };
  }
  async function cancel(orderId, body) {
    const order = action(orderId, body);
    if (order.status !== 'cancelled') await desk.cancel(orderId);
    return { delegation: get(orderId) };
  }
  async function accept(orderId, body) {
    const order = action(orderId, body, ['receiptHash']);
    const result = get(orderId);
    if (!result.receipt || result.receiptHash !== body.receiptHash || result.returnedHash !== result.receiptHash)
      fail(409, 'MW_CONVERSATION_RESULT_REQUIRED', 'Review the exact result durably returned to the original Session.');
    if (order.status !== 'accepted') await desk.accept(orderId, actor.subject, { confirmed: true });
    return { delegation: get(orderId) };
  }
  async function download(orderId, reference) {
    const item = get(orderId);
    if (!item.receipt?.files.some(file => file.id === reference?.artifactId && file.version === reference?.version && file.sha256 === reference?.sha256))
      fail(404, 'MW_SESSION_FILE_NOT_FOUND', 'Use the exact file ID, version and SHA from this original delegation.');
    return session.download(reference);
  }
  return Object.freeze({ prepare, get, approve, dispatch, refresh, cancel, accept, download,
    list() { const state = store.read(); validate(state); return (state.workerOrders ?? [])
      .filter(order => owned(order, actor, workerId) && same(order.museConversation, actor)).map(projected); } });
}
