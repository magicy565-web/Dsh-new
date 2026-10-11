import { createHash } from 'node:crypto';
import { MuseWorkerError } from './muse-worker-api.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const common = ['version', 'action', 'requestId', 'expectedEpoch', 'configurationHash', 'callbackCandidateIds', 'workerId', 'confirmed'];
const fail = message => { throw new MuseWorkerError(409, 'MW_PRIVATE_REVIEW', message); };
export const museReportHash = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');

/** Operator-selected private file only. This is not an HTTP or model interface. */
export async function applyPrivateMuseReview({ review, configuration, service, refreshTools }) {
  const extras = {
    'muse-activate': [],
    'muse-order-start': ['order', 'extraCostLimitUsd'],
    'muse-order-refresh': ['orderId'],
    'muse-order-accept': ['orderId', 'reportSha256'],
    'muse-order-cancel': ['orderId'],
  }[review?.action];
  const current = service.status();
  if (!extras || !fields(review, [...common, ...extras]) || review.version !== 1 || review.confirmed !== true ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(review.requestId ?? '') || !Number.isSafeInteger(review.expectedEpoch) ||
      !/^[a-f0-9]{64}$/.test(review.configurationHash ?? '') || !Array.isArray(review.callbackCandidateIds) ||
      review.callbackCandidateIds.length || review.workerId !== configuration?.worker?.workerId ||
      review.configurationHash !== current.configurationHash)
    fail('Review the exact private Muse binding, original native scope and empty Dot callback changes.');
  const gate = () => {
    if (!['enabled', 'scopeReviewed', 'externalBudgetVerified'].every(key => configuration.worker[key] === true))
      fail('Muse execution needs all three explicitly reviewed gates.');
  };
  if (review.action === 'muse-activate') {
    gate();
    const controlId = review.requestId + '-scope';
    const retry = current.phase === 'active' && current.epoch === review.expectedEpoch + 1 &&
      current.controls.some(item => item.requestId === controlId && item.action === 'resume');
    if (!(current.phase === 'paused' && current.epoch === review.expectedEpoch) && !retry)
      fail('Resume only the exact paused scope or the same durably recorded resume request.');
    if (typeof refreshTools !== 'function') fail('The original native tool owner must rebind its revoked handles.');
    // The existing service validates unresolved work and durable idempotency.
    // No connection resume, Dot grant, Goal edit, new Agent or state-file write.
    const result = await service.resume({ expectedEpoch: review.expectedEpoch,
      configurationHash: review.configurationHash, requestId: controlId });
    const exact = { expectedEpoch: result.epoch, configurationHash: result.configurationHash };
    await refreshTools(exact);
    await service.refreshMuseRest(exact);
    return { action: review.action, epoch: result.epoch, configurationHash: result.configurationHash,
      executionResumed: true, dotConnectionResumed: false, nativeExecutionVerified: false };
  }
  if (review.expectedEpoch !== current.epoch || !['active', 'paused'].includes(current.phase))
    fail('The private order review belongs to a different native scope.');
  const desk = service.muse.bindDesk(configuration.actor);
  if (review.action === 'muse-order-start') {
    gate();
    if (current.phase !== 'active' || review.extraCostLimitUsd !== 0 ||
        review.order?.serviceId !== 'channel-validation' || review.order?.requestId !== review.requestId ||
        review.order?.publicDataConfirmed !== true || review.order?.workerId !== review.workerId)
      fail('This reviewed first order permits only public channel/product research with zero extra spending.');
    let { order } = await desk.create(review.order);
    if (order.status === 'draft') ({ order } = await desk.approve(order.id, { confirmed: true, workerId: review.workerId }));
    if (order.status === 'approved') ({ order } = await desk.dispatch(order.id));
    // An uncertain submission must be reconciled; never submit it again.
    if (order.status === 'dispatching' || order.status === 'dispatch_uncertain')
      fail('Preserve the original order and reconcile its uncertain submission.');
    return { action: review.action, orderId: order.id, remoteJobId: order.remoteJobId,
      status: order.status, extraCostLimitUsd: 0, approval: { actor: configuration.actor.subject,
        serviceId: order.serviceId, product: order.product, market: order.market,
        objective: order.objective, budgetCredits: order.budgetCredits, deadlineAt: order.deadlineAt } };
  }
  if (typeof review.orderId !== 'string') fail('Select the original owned order.');
  let order = await desk.get(review.orderId);
  if (review.action === 'muse-order-refresh') {
    if (['queued', 'running', 'cancel_requested', 'dispatch_uncertain', 'input_required'].includes(order.status))
      ({ order } = await desk.refresh(order.id));
    return { action: review.action, order, reportSha256: order.workerReport ? museReportHash(order.workerReport) : null };
  }
  if (review.action === 'muse-order-accept') {
    if (!order.workerReport || review.reportSha256 !== museReportHash(order.workerReport))
      fail('Human acceptance must identify the exact delivered report hash.');
    if (order.status !== 'accepted') ({ order } = await desk.accept(order.id, { confirmed: true }));
    return { action: review.action, orderId: order.id, status: order.status,
      reportSha256: review.reportSha256, deliveryArtifactId: order.deliveryArtifactId };
  }
  ({ order } = await desk.cancel(order.id));
  return { action: review.action, orderId: order.id, status: order.status };
}
