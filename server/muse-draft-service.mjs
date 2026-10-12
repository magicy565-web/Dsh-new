import { capabilityPayloadHash as hash } from './capabilities.mjs';
import { assertInputContextSnapshot } from './task-context.mjs';
import { MuseDraftError, draftAdmission, findMuseDraft, draftDto, assertDraftProduct } from './muse-draft.mjs';

const fail = (status, code, message) => { throw new MuseDraftError(status, code, message); };
const exact = (body, fields) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => fields.includes(key));
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Inert drafts share the original Store/run; native order effects stay in the
 * existing binding. Preparation receipts are idempotency intents, not approvals. */
export function createMuseDraftService({ store, runtime, piMuse, artifacts, provider }) {
  const actor = piMuse.actor;
  const get = (conversationId, id) => draftDto(store.read(), findMuseDraft(store.read(), actor, conversationId, id));
  const original = () => piMuse.native.bindConversation(actor);
  function checkScope(draft, body) {
    const version = draft.versions.at(-1);
    if (draft.rejected || body.expectedRevision !== version.context.revision || body.expectedDraftHash !== version.scopeHash)
      fail(409, 'MUSE_DRAFT_STALE_SCOPE', 'Read and review the current draft revision/hash.');
    return version;
  }
  async function checkInputs(state, version) {
    assertDraftProduct(state, actor.nativeAgentId, version.context.productReference, version.context.productSnapshot);
    const snapshot = state.runs.find(run => run.id === version.runId)?.inputContextSnapshot;
    assertInputContextSnapshot(state, actor.nativeAgentId, snapshot);
    for (const item of snapshot?.artifacts || []) {
      const file = await artifacts.read(item.id, { version: item.version, encoding: 'utf8' });
      if (file.version.sha256 !== item.sha256 || file.content !== item.content) fail(409, 'MUSE_DRAFT_INPUT_CHANGED', 'The exact quoted input bytes changed. Review them again.');
    }
    assertInputContextSnapshot(store.read(), actor.nativeAgentId, snapshot);
  }
  return {
    get,
    list(conversationId) { const state = store.read(); return (state.workspaceMuseDrafts?.drafts || []).filter(item => item.subject === actor.subject && item.conversationId === conversationId).map(item => draftDto(state, item)); },
    async request(conversationId, body, draftId) {
      if (provider.kind !== 'pi-durable') fail(409, 'PI_DRAFT_REQUIRED', 'Draft reasoning requires the reviewed Pi runtime, never a substitute Muse model.');
      const services = await piMuse.native.bindDesk(actor).catalog();
      const context = draftAdmission(store.read(), actor, conversationId, body, services, draftId);
      const previous = store.read().workspaceMuseDrafts?.drafts.find(item => item.id === context.draftId)?.versions.find(version => version.context.requestId === context.requestId);
      if (previous) {
        const state = store.read(), run = state.runs.find(item => item.id === previous.runId), message = state.messages.find(item => item.conversationId === conversationId && item.role === 'user' && item.requestId === context.requestId);
        return { message, run: { id: run.id, status: run.status, requestId: context.requestId }, draftId: context.draftId, revision: context.revision, scopeVersion: context.revision, duplicate: true };
      }
      if (context.selection?.connectorActions?.length) fail(400, 'MUSE_DRAFT_INPUT', 'Drafting cannot select connector effects.');
      const result = await runtime.sendMessage(conversationId, { content: body.content, requestId: body.requestId, inputContext: context.selection, workspaceExecution: true }, { museDraftContext: context });
      // Concurrent identical creates may compile different provisional IDs before
      // the original admission transaction dedupes them. Return its saved ID.
      const admitted = store.read().runs.find(run => run.id === result.run.id)?.museDraftContext || context;
      return { ...result, draftId: admitted.draftId, revision: admitted.revision, scopeVersion: admitted.revision };
    },
    async prepare(conversationId, id, body) {
      if (!exact(body, ['requestId', 'expectedRevision', 'expectedDraftHash', 'confirmed', 'budgetConfirmed', 'deadlineConfirmed', 'publicDataConfirmed']) || !key(body.requestId) || body.confirmed !== true || body.budgetConfirmed !== true || body.deadlineConfirmed !== true || body.publicDataConfirmed !== true)
        fail(400, 'MUSE_DRAFT_CONFIRMATION', 'Explicitly confirm the exact scope, amount, deadline and this public text.');
      let state = store.read(), draft = findMuseDraft(state, actor, conversationId, id), version = checkScope(draft, body);
      const fingerprint = hash(body), orderRequestId = `muse-draft-${draft.id}`;
      if (draft.prepare && (draft.prepare.fingerprint !== fingerprint || draft.prepare.requestId !== body.requestId)) fail(409, 'MUSE_DRAFT_PREPARE_PENDING', 'Reconcile the original preparation requestId/body; do not create another order.');
      if (draft.prepare?.orderId) return { draft: get(conversationId, id), delegation: await original().get(draft.prepare.orderId), duplicate: true };
      const cachedOrder = state.workerOrders?.find(order => order.requestId === orderRequestId && order.createdBy === actor.subject);
      if (!cachedOrder) {
        if (version.phase !== 'ready_for_review' || version.missingFields.length) fail(409, 'MUSE_DRAFT_INCOMPLETE', 'Clarify all missing facts before preparing an original order.');
        if (Date.parse(version.scope.deadlineAt) <= Date.now() + 60000) fail(409, 'MUSE_DRAFT_STALE_SCOPE', 'The deadline needs a fresh explicit clarification.');
        await checkInputs(state, version);
      }
      await store.update(next => {
        const current = findMuseDraft(next, actor, conversationId, id), latest = checkScope(current, body);
        if (current.prepare && current.prepare.fingerprint !== fingerprint) fail(409, 'MUSE_DRAFT_PREPARE_PENDING', 'Use the original preparation request.');
        if (!cachedOrder) assertDraftProduct(next, conversationId, latest.context.productReference, latest.context.productSnapshot);
        current.prepare ||= { requestId: body.requestId, fingerprint, revision: latest.context.revision, scopeHash: latest.scopeHash,
          orderRequestId, orderId: null, reviewHash: null, confirmedBy: actor.subject, budgetConfirmed: true, deadlineConfirmed: true, publicDataConfirmed: true, error: null };
      });
      draft = findMuseDraft(store.read(), actor, conversationId, id); version = draft.versions.at(-1);
      try {
        const result = await original().prepare({ provider: 'muse', conversationId, requestId: orderRequestId,
          content: draftDto(store.read(), draft).publicText, order: { ...version.scope, publicDataConfirmed: true } });
        await store.update(next => {
          const current = findMuseDraft(next, actor, conversationId, id); checkScope(current, body);
          if (current.prepare.fingerprint !== fingerprint) fail(409, 'MUSE_DRAFT_PREPARE_PENDING', 'The original preparation changed.');
          current.prepare.orderId = result.delegation.orderId; current.prepare.reviewHash = result.delegation.reviewHash; current.prepare.error = null;
        });
        return { draft: get(conversationId, id), delegation: result.delegation, ...(result.duplicate ? { duplicate: true } : {}) };
      } catch (error) {
        await store.update(next => {
          const current = findMuseDraft(next, actor, conversationId, id);
          current.prepare.error = { code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'MUSE_DRAFT_PREPARE_UNCERTAIN', message: 'Preparation has not been acknowledged. Reconcile the original request; do not create another order.' };
        }).catch(() => {});
        throw error;
      }
    },
    async reject(conversationId, id, body) {
      if (!exact(body, ['requestId', 'expectedRevision', 'expectedDraftHash', 'confirmed']) || !key(body.requestId) || body.confirmed !== true) fail(400, 'MUSE_DRAFT_CONFIRMATION', 'Confirm rejection of this exact draft.');
      const state = store.read(), draft = findMuseDraft(state, actor, conversationId, id), fingerprint = hash(body);
      if (draft.rejected && draft.rejected.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Use the original draft rejection request.');
      if (draft.rejected?.status === 'done') return { draft: get(conversationId, id), duplicate: true };
      const version = draft.rejected ? draft.versions.at(-1) : checkScope(draft, body);
      await store.update(next => {
        const current = findMuseDraft(next, actor, conversationId, id);
        if (current.rejected) { if (current.rejected.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Use the original rejection request.'); }
        else checkScope(current, body);
        if (current.prepare && !current.prepare.orderId) fail(409, 'MUSE_DRAFT_PREPARE_PENDING', 'Reconcile the original preparation before rejecting it.');
        current.rejected ||= { requestId: body.requestId, fingerprint, status: 'pending' };
      });
      const current = findMuseDraft(store.read(), actor, conversationId, id);
      if (current.prepare?.orderId) await original().cancel(current.prepare.orderId, { confirmed: true, expectedReviewHash: current.prepare.reviewHash });
      const run = state.runs.find(item => item.id === version.runId);
      if (['running', 'queued', 'awaiting_approval'].includes(run?.status)) await runtime.cancelRun(run.id);
      await store.update(next => {
        const current = findMuseDraft(next, actor, conversationId, id);
        if (current.rejected?.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'The original rejection changed.');
        current.rejected.status = 'done';
      });
      return { draft: get(conversationId, id) };
    },
  };
}
