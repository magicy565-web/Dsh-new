// Both transports use the existing durable Store transaction and records.
// REST files are never projected as original registry/native settlement receipts.
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const finishedOrders = new Set(['accepted', 'failed', 'cancelled']);
const unfinishedRest = (state, task) => task.status !== 'stopped' && !finishedOrders.has((state.workerOrders ?? []).find(order => order.id === task.orderId && order.workerId === task.workerId)?.status);
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 409 }); };

export function assertMuseRestSlot(state, workerId, originalTaskId) {
  const registry = state.personalWorkers;
  if (!registry) return;
  const worker = registry.workers?.find(row => row.id === workerId);
  const nativeWorkers = (registry.workers ?? []).filter(row => (row.connections ?? []).some(connection => connection.provider === 'muse' || connection.transport === 'muse-native'));
  if (!worker && nativeWorkers.length) fail('MW_REGISTRY_BINDING_REQUIRED', 'REST has no verified original logical Worker binding; preserve the native registry and review the transport contract.');
  if ((registry.delegations ?? []).some(row => row.workerId === workerId && !terminal.has(row.state))) fail('MW_NATIVE_SLOT_BUSY', 'The original native delegation occupies this logical Worker, including uncertain or overdue work.');
  if ((state.workspacePlugin?.nativeSubmissions ?? []).some(row => !row.jobId && worker?.subject === row.subject)) fail('MW_NATIVE_SLOT_BUSY', 'An original uncertain native submission still occupies this Worker.');
  if ((state.museTasks ?? []).some(task => task.workerId === workerId && task.id !== originalTaskId && unfinishedRest(state, task))) fail('MW_REST_SLOT_BUSY', 'Finish or cancel the original REST delegation before reserving another.');
}

export function assertMuseNativeSlot(state, logicalWorkerId) {
  if ((state.museTasks ?? []).some(task => task.workerId === logicalWorkerId && unfinishedRest(state, task))) fail('MW_REST_SLOT_BUSY', 'The original REST delegation still occupies this logical Worker.');
}

export function validateMuseJointSlots(state) {
  for (const delegation of state.personalWorkers?.delegations ?? []) {
    if (!terminal.has(delegation.state) && (state.museTasks ?? []).some(task => task.workerId === delegation.workerId && unfinishedRest(state, task))) fail('MW_JOINT_SLOT_CONFLICT', 'Native and REST records conflict on one logical Worker; preserve the original data for reconciliation.');
  }
}
