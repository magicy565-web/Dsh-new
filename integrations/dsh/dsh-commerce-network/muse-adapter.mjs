import { createWorkerClient } from './worker-client.mjs';

/**
 * Thin Muse-side mapping to the native DSH Worker gateway. The Muse host owns
 * polling, execution and secure credential storage; this module starts none of
 * those processes. The legacy /api/muse-worker/v1 REST contract is different.
 */
export function createMuseAdapter(options) {
  const worker = createWorkerClient(options);
  const lease = task => {
    if (!task || typeof task.orderId !== 'string' || typeof task.leaseId !== 'string') throw new TypeError('The original orderId and leaseId are required.');
    return { orderId:task.orderId, leaseId:task.leaseId };
  };
  return Object.freeze({
    origin:worker.origin,
    connect: options => worker.connect({},options),
    claim: (orderId, options) => worker.claim(orderId ? {orderId} : {}, options),
    heartbeat: (task, summary, options) => worker.heartbeat({...lease(task),...(summary != null?{summary}:{})},options),
    status: (task, options) => worker.status(lease(task),options),
    resources: (task, options) => worker.resources(lease(task),options),
    submitResult: (task, result, options) => worker.deliver({...lease(task),title:result.title,content:result.content,sourceUrls:result.sourceUrls ?? [],actualMinor:result.actualMinor ?? 0},options),
    reportFailed: (task, summary, options) => worker.fail({...lease(task),...(summary != null?{summary}:{})},options),
    confirmStopped: (task, options) => worker.stopped(lease(task),options),
  });
}
