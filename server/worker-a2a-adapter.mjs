/**
 * Adapter for A2A v1 Task-oriented agents. The host provides an authenticated
 * client from the OFFICIAL @a2a-js/sdk/client; we do not recreate its transports,
 * OAuth, Agent Card discovery or remote state machine.
 *
 * A host must verify the partner's identity and enforceable credit ceiling
 * before setting either reviewed flag. This factory never reads tokens and
 * never requests raw enterprise files. Stateless A2A replies are not sufficient
 * to create a durable paid order.
 */
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x);
const stateMap = Object.freeze({
  TASK_STATE_SUBMITTED: 'working',
  TASK_STATE_WORKING: 'working',
  TASK_STATE_INPUT_REQUIRED: 'input_required',
  TASK_STATE_AUTH_REQUIRED: 'input_required',
  TASK_STATE_COMPLETED: 'completed',
  TASK_STATE_FAILED: 'failed',
  TASK_STATE_CANCELED: 'cancelled',
  TASK_STATE_CANCELLED: 'cancelled',
  TASK_STATE_REJECTED: 'failed',
});
const bad = message => Object.assign(new Error(message), { code: 'A2A_INVALID_PEER_RESPONSE' });

function taskFrom(response) {
  // Official SDK v1 may return a Task directly. Some client wrappers retain
  // the protobuf SendMessageResponse oneof {"task": ...}.
  const value = response?.task ?? response;
  if (!value || !validId(value.id) || !value.status || typeof value.status !== 'object') throw bad('A2A peer did not return a durable task identity and status.');
  return value;
}
function mappedStatus(task) {
  const state = stateMap[task.status?.state];
  if (!state) throw bad('A2A peer returned an unsupported task state.');
  return state;
}
function jsonReceipt(task, orderId) {
  const candidates = (Array.isArray(task.artifacts) ? task.artifacts : []).flatMap(a =>
    Array.isArray(a.parts) ? a.parts.map(part => part?.data) : []);
  // Only a structured reviewed schema counts as a delivery. Plain text
  // summaries remain untrusted and cannot accidentally be auto-accepted.
  const receipt = candidates.find(x => x && typeof x === 'object' && !Array.isArray(x) &&
    x.schema === 'workspace.worker.delivery.v1' && x.orderId === orderId);
  if (!receipt) return { deliverables: [], evidence: [], costCredits: undefined };
  return {
    deliverables: Array.isArray(receipt.deliverables) ? receipt.deliverables : [],
    evidence: Array.isArray(receipt.evidence) ? receipt.evidence : [],
    costCredits: receipt.costCredits,
  };
}

export function createA2AWorkerAdapter({
  client,
  displayName,
  services,
  verifiedPartner = false,
  verifiedHardBudget = false,
} = {}) {
  if (typeof client?.sendMessage !== 'function' || typeof client?.getTask !== 'function' ||
      typeof client?.cancelTask !== 'function' ||
      typeof displayName !== 'string' || !displayName.trim() ||
      !Array.isArray(services) || !services.length || !services.every(validId)) {
    throw new TypeError('A2A Worker requires a reviewed official SDK client and a fixed service allowlist.');
  }
  // Never allow a staging/unknown partner to be selectable just because a
  // JavaScript SDK can connect. Hard-cap verification is a deployment duty.
  const enabled = verifiedPartner === true && verifiedHardBudget === true;
  return {
    displayName: displayName.trim(),
    services: [...new Set(services)],
    ready: enabled,
    budgetEnforced: enabled,
    async submit(task) {
      if (!enabled) throw new Error('A2A partner and budget verification are required.');
      if (!validId(task?.orderId) || !validId(task?.idempotencyKey) || task.orderId !== task.idempotencyKey ||
          task.dataScope !== 'public' || !services.includes(task.serviceId) ||
          !Number.isSafeInteger(task.maxCredits) || task.maxCredits < 1)
        throw new TypeError('The task must be the exact authorized public service and budget.');
      // A2A is a communication protocol, NOT the billable business contract.
      // Ask the partner to return a durable Task and a structured delivery Part.
      const message = {
        role: 'ROLE_USER', messageId: task.orderId,
        parts: [{ text: JSON.stringify({
          contract: 'workspace.worker.order.v1',
          orderId: task.orderId, serviceId: task.serviceId, dataScope: 'public',
          inputs: task.inputs, acceptance: task.acceptance,
          deadlineAt: task.deadlineAt, maxCredits: task.maxCredits,
          requiredResultSchema: 'workspace.worker.delivery.v1',
          externalActions: 'no external messages, account writes or payments unless separately authorized',
        }) }],
      };
      const response = await client.sendMessage({ message });
      const returned = taskFrom(response);
      mappedStatus(returned);
      return { jobId: returned.id };
    },
    async get(jobId, orderId) {
      if (!enabled || !validId(jobId) || !validId(orderId)) throw new TypeError('Only verified assigned A2A tasks may be queried.');
      const task = taskFrom(await client.getTask({ id: jobId }));
      if (task.id !== jobId) throw bad('A2A getTask returned a different task identity.');
      const status = mappedStatus(task);
      const result = status === 'completed' ? jsonReceipt(task, orderId) : null;
      return {
        jobId, orderId, status,
        ...(result ? { deliverables: result.deliverables, evidence: result.evidence,
          ...(result.costCredits === undefined ? {} : { costCredits: result.costCredits }) } : {}),
      };
    },
    async cancel(jobId) {
      if (!enabled || !validId(jobId)) throw new TypeError('Only verified assigned A2A tasks may be cancelled.');
      const task = taskFrom(await client.cancelTask({ id: jobId }));
      if (task.id !== jobId) throw bad('A2A cancellation returned a different task identity.');
      return { status: mappedStatus(task) === 'cancelled' ? 'cancelled' : 'cancel_requested' };
    },
  };
}
