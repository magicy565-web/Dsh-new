import { capabilityPayloadHash } from './capabilities.mjs';
import { ApiError } from './runtime.mjs';
import { libraryReadHash as hash } from './library-model-read-contract.mjs';
import { validate } from '../plugins/workspace-market-validation/src/plan.mjs';
import { MONITOR_REQUEST_SCHEMA, MONITOR_STATUS_SCHEMA, MONITOR_CONTROL_SCHEMA } from '../plugins/workspace-market-validation/src/monitor.js';

// Narrow per-Run binding. All durable task, permission and approval state stays
// in the original services. Cached context is refreshed, never trusted as state.
export function createMarketValidationMonitorClient({ monitor, capabilities, store, artifacts, planClient,
  identity, conversationId, authorize, canSave, clock = Date.now }) {
  const fail = (code, status = 409) => { throw new ApiError(status, code, 'Use current original owned monitoring records and human controls.'); };
  async function guard(signal, model, writing = false) {
    signal?.throwIfAborted(); await authorize(signal, model); signal?.throwIfAborted();
    if (writing && canSave(store.read()) !== true) fail('BUSINESS_EXECUTION_INTENT_REQUIRED', 403);
  }
  const scoped = () => monitor.forActor(identity);
  function owned(goalId) {
    const task = scoped().get(goalId);
    if (task.conversationId !== conversationId) fail('MONITOR_NOT_FOUND', 404);
    return task;
  }
  async function plan(task, signal, model) {
    const row = store.read().artifacts.find(a => a.id === task.planId), meta = row?.metadata?.marketValidationPlan;
    if (!row || row.sourceConversationId !== conversationId || row.currentVersion !== task.planRevision
      || meta?.ownerHash !== hash([identity.workspaceId, identity.subject, conversationId])) fail('MARKET_PLAN_RECEIPT_MISMATCH');
    const file = await artifacts.download(row.id, { version: task.planRevision });
    let saved; try { saved = JSON.parse(file.bytes.toString('utf8')); } catch { fail('MARKET_PLAN_RECEIPT_MISMATCH'); }
    if (file.version.sha256 !== row.sha256 || saved?.schema !== 'workspace.market-validation-plan.v1' || hash(saved.plan) !== meta.planHash || !Array.isArray(saved.sources)) fail('MARKET_PLAN_RECEIPT_MISMATCH');
    const product = saved.sources.find(s => s.kind === 'factory-product');
    const fresh = await planClient.read({ productId: product?.recordId, documents: saved.sources.filter(s => s.kind === 'factory-document').map(s => ({ documentId: s.recordId, documentVersion: s.documentVersion })) }, signal, model);
    if (hash(fresh.sources) !== hash(saved.sources) || hash({ authorization: fresh.authorization, sources: fresh.sources, extraction: fresh.extraction }) !== meta.sourceHash) fail('MARKET_PLAN_SOURCE_CHANGED');
    const current = store.read().artifacts.find(a => a.id === row.id);
    if (current?.revision !== row.revision || current?.sha256 !== row.sha256) fail('MARKET_PLAN_RECEIPT_MISMATCH');
    return fresh.authorization;
  }
  function approvalFor(task) {
    const scope = capabilities.scheduleApprovalRequest(task.scheduleId);
    const state = store.read(), schedule = state.capabilities.schedules.find(row => row.id === task.scheduleId);
    // A recurring tick advances scheduledAt. The original consumed approval
    // remains bound by the original Schedule consent, revision and hashes.
    const consent = schedule?.consent;
    const consumed = consent && state.capabilities.approvals.find(row => row.id === consent.approvalId);
    if (consumed?.status === 'consumed' && consumed.action === scope.action && consumed.resource === scope.resource
      && consumed.payloadHash === capabilityPayloadHash(consumed.payload) && consumed.payload.scheduleRevision === schedule.revision
      && capabilityPayloadHash(consumed.payload.goalDefinition) === consent.definitionHash
      && capabilityPayloadHash(consumed.payload.executionContext) === consent.executionContextHash) return consumed;
    return state.capabilities.approvals.findLast(a => a.action === scope.action && a.resource === scope.resource && a.payloadHash === capabilityPayloadHash(scope.payload)) || null;
  }
  async function status(input, signal, model, action = null) {
    validate(input, MONITOR_STATUS_SCHEMA); await guard(signal, model);
    let task = owned(input.goalId); const authorization = await plan(task, signal, model);
    await guard(signal, model); task = owned(input.goalId);
    const approval = approvalFor(task), last = task.observations.findLast(row => row.status === 'complete');
    const controlRecords = store.read().capabilities.approvals.filter(row => row.action === 'monitor.control' && row.resource === `goal:${task.goalId}`
      && row.payload?.goalId === task.goalId && row.payload.scopeHash === task.scopeHash).slice(-10);
    const controlRecord = action ? controlRecords.findLast(row => row.payload.action === action) : null;
    let controlScope = null;
    if (action) try { controlScope = scoped().controlApprovalScope({ goalId: task.goalId, action }); } catch { /* Historical proposal remains a receipt, not live authority. */ }
    const approvalStatus = row => Date.parse(row.expiresAt) <= clock() && ['pending', 'approved'].includes(row.status) ? 'expired' : row.status;
    const dispatch = store.read().capabilities.scheduleRuns.findLast(row => row.goalId === task.goalId && row.scheduleId === task.scheduleId);
    return { plugin: 'workspace-market-monitor', status: action && !(controlRecord?.status === 'consumed' && controlRecord.executionReceipt) ? 'human_action_required' : 'available',
      input: { goalId: task.goalId }, authorization, requestedAction: action,
      task: { goalId: task.goalId, scopeHash: task.scopeHash, planId: task.planId, planRevision: task.planRevision,
        scheduleId: task.scheduleId, status: task.status, scheduleEnabled: task.scheduleEnabled, scheduleStatus: task.scheduleStatus,
        startAt: task.startAt, endAt: task.endAt, windowDefinition: task.windowDefinition, modelRequired: false,
        observationCount: task.observations.filter(row => row.status === 'complete').length,
        latestDispatch: dispatch ? { id: dispatch.id, scheduleId: dispatch.scheduleId, scheduleRevision: dispatch.scheduleRevision,
          dueAt: dispatch.dueAt, status: dispatch.status, finishedAt: dispatch.finishedAt,
          receipt: dispatch.serviceReceipt ? { requestId: dispatch.serviceReceipt.requestId, sampledAt: dispatch.serviceReceipt.sampledAt,
            outcomeStatus: dispatch.serviceReceipt.outcomeStatus, modelRequired: dispatch.serviceReceipt.modelRequired, readOnly: dispatch.serviceReceipt.readOnly } : null } : null,
        latestMeasurement: last?.sample?.measurement ?? null, assessment: task.summary?.assessment ?? null,
        missedDays: task.missedDays, goalVerified: false },
      approval: approval ? { id: approval.id, status: Date.parse(approval.expiresAt) <= clock() && ['pending', 'approved'].includes(approval.status) ? 'expired' : approval.status, expiresAt: approval.expiresAt } : null,
      controlRequests: controlRecords.map(row => ({ id: row.id, action: row.payload.action, status: approvalStatus(row), expiresAt: row.expiresAt, receipt: row.executionReceipt ?? null })),
      ...(action ? { humanControl: { method: 'POST', path: `/api/goals/${task.goalId}/market-validation-monitor/control`,
        body: { action, expectedScopeHash: task.scopeHash, approvalId: controlRecord?.id ?? null },
        decisionPath: controlRecord ? `/api/approvals/${controlRecord.id}/decision` : null,
        requiresOriginalHumanSessionAndCsrf: true, confirmationRequired: true,
        applied: controlRecord?.status === 'consumed' && !!controlRecord.executionReceipt,
        available: !!controlRecord && ['pending', 'approved'].includes(approvalStatus(controlRecord)) && !!controlScope && controlRecord.payloadHash === capabilityPayloadHash(controlScope.payload),
        freshScheduleApprovalRequired: action === 'resume' } } : {}),
      ...(approval && !task.scheduleEnabled ? { humanScheduleReview: { decisionPath: `/api/approvals/${approval.id}/decision`,
        enablePath: `/api/schedules/${task.scheduleId}/enable`, requiresOriginalHumanSessionAndCsrf: true } } : {}) };
  }
  async function request(input, signal, model) {
    validate(input, MONITOR_REQUEST_SCHEMA); await guard(signal, model, true);
    await plan({ planId: input.planId, planRevision: input.planRevision }, signal, model);
    // Resolve and validate the source through the original service. Draft-only
    // creation has no approved/enabled state and cannot invoke collection.
    const task = await scoped().propose(input, { sourceConversationId: conversationId, signal });
    await plan(task, signal, model); await guard(signal, model, true); owned(task.goalId);
    if (['paused', 'cancelled', 'window_ended'].includes(task.status)) fail(task.status === 'cancelled' ? 'MONITOR_CANCELLED' : task.status === 'paused' ? 'MONITOR_STOPPED' : 'MONITOR_WINDOW_ENDED');
    const prior = approvalFor(task);
    if (!task.scheduleEnabled && !(prior && ['pending', 'approved'].includes(prior.status) && Date.parse(prior.expiresAt) > clock())) {
      const scope = capabilities.scheduleApprovalRequest(task.scheduleId);
      try { await capabilities.requestApproval(scope, { onCreated(state, created) {
        signal?.throwIfAborted(); if (canSave(state) !== true) fail('BUSINESS_EXECUTION_INTENT_REQUIRED', 403); owned(task.goalId);
        const current = state.goals.find(g => g.id === task.goalId)?.marketValidationMonitor;
        if (!current || ['paused', 'cancelled', 'window_ended'].includes(current.status)) fail('MONITOR_STOPPED');
        if (state.capabilities.schedules.find(s => s.id === task.scheduleId)?.revision !== scope.payload.scheduleRevision) fail('LAUNCH_SCOPE_CHANGED');
        if (state.capabilities.approvals.some(a => a.id !== created.id && a.resource === created.resource && a.payloadHash === created.payloadHash && ['pending', 'approved'].includes(a.status) && Date.parse(a.expiresAt) > clock())) fail('MONITOR_APPROVAL_PENDING');
      } }); } catch (e) { if (e.code !== 'MONITOR_APPROVAL_PENDING') throw e; }
    }
    return status({ goalId: task.goalId }, signal, model);
  }
  async function control(input, signal, model) {
    validate(input, MONITOR_CONTROL_SCHEMA); await guard(signal, model, true);
    const task = owned(input.goalId);
    if (input.action === 'resume' && task.status === 'cancelled') fail('MONITOR_CANCELLED');
    if (input.action === 'resume' && clock() >= Date.parse(task.endAt)) fail('MONITOR_WINDOW_ENDED');
    await plan(task, signal, model); await guard(signal, model, true);
    await scoped().requestControl(input, { signal, check(state) { signal?.throwIfAborted(); if (canSave(state) !== true) fail('BUSINESS_EXECUTION_INTENT_REQUIRED', 403); } });
    await guard(signal, model, true);
    return status({ goalId: input.goalId }, signal, model, input.action);
  }
  async function refresh(receipt, model, signal) {
    // Rebuild the entire model-visible receipt from live original records. A
    // cached metric/status/approval or humanControl body is never an authority.
    if (receipt?.plugin !== 'workspace-market-monitor' || ![null, 'pause', 'cancel', 'resume'].includes(receipt.requestedAction)) fail('MONITOR_CACHE_REFUSED', 403);
    return status(receipt.input, signal, model, receipt.requestedAction);
  }
  return Object.freeze({ request, status, control, refresh });
}
