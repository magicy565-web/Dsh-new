export type CloudFile = { id: string; version: number; sha256: string; filename?: string };
export const cloudId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(value);
export const cloudSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isMuseFile(value: unknown): value is CloudFile {
  return record(value) && cloudId(value.id) && value.version === 1 && cloudSha(value.sha256)
    && (value.filename === undefined || typeof value.filename === 'string' && value.filename.length > 0 && value.filename.length <= 255 && !/[\u0000-\u001f\u007f/\\]/.test(value.filename));
}
/** Historical text-only messages remain readable. Receipt metadata is untrusted. */
export function museMessageFiles(message: { conversationId: string; museOrderId?: unknown; museReceiptHash?: unknown; museReceipt?: unknown }) {
  if (message.museReceipt === undefined) return undefined;
  const receipt = message.museReceipt;
  if (!record(receipt) || receipt.schema !== 'workspace.muse.session-receipt.v1'
    || receipt.nativeAgentId !== message.conversationId || receipt.orderId !== message.museOrderId
    || ![receipt.orderId, receipt.workerId, receipt.taskRef, receipt.attemptId, receipt.requestId, receipt.submitRequestId].every(cloudId)
    || !Number.isSafeInteger(receipt.fence) || Number(receipt.fence) < 1
    || ![message.museReceiptHash, receipt.submitHash, receipt.reportSha256].every(cloudSha)
    || receipt.independentlyVerified !== false || !Array.isArray(receipt.files) || !receipt.files.length || receipt.files.length > 20) return null;
  return receipt.files as unknown[];
}
export type MuseTask = {
  agentKind: 'muse'; orderId: string; requestId: string; nativeAgentId: string; workerId: string;
  taskRef: string | null; status: string; executionStatus: string | null; attemptId: string | null;
  fence: number; leaseUntil: string | null; createdAt: string; updatedAt: string; deadlineAt: string;
  serviceId: string; product: string; market: string; objective: string; budgetCredits: number;
  summary: string; receipt: { summary?: string; files: CloudFile[]; report?: unknown; reportSha256?: string; submitHash?: string } | null;
  receiptHash: string | null; returnedHash: string | null; acceptedAt: string | null; independentlyVerified: false;
};
const orderLabels: Record<string, string> = {
  draft: '等待订单审核', approved: '已授权 · 待派发', dispatching: '正在派发', queued: '等待领取',
  running: '订单执行中', input_required: '等待补充信息', dispatch_uncertain: '派发结果待核对',
  cancel_requested: '等待停止确认', cancelled: '已取消', review_required: '原订单待验收',
  accepted: '原订单已验收', failed: '执行失败', result_incomplete: '交付不完整', budget_dispute: '额度待核对', expired: '已过期',
};
const bridgeLabels: Record<string, string> = { pending: '等待领取', claimed: '已领取', submitted: '成果已提交', stopped: '执行端已停止', cancel_requested: '等待停止确认', blocked: '执行受阻' };
const validAcceptance = (task: MuseTask, now: number) => task.status === 'accepted' && typeof task.acceptedAt === 'string' && Number.isFinite(Date.parse(task.acceptedAt)) && Date.parse(task.acceptedAt) <= now;
export const museOrderLabel = (task: MuseTask) => task.status === 'accepted' && !validAcceptance(task, Date.now()) ? '验收记录待核对' : orderLabels[task.status] || '订单状态待核对';
export const museExecutionLabel = (task: MuseTask) => task.executionStatus ? bridgeLabels[task.executionStatus] || '执行状态待核对' : '尚无执行记录';
export function museState(task: MuseTask, now: number) {
  const delivered = record(task.receipt) && Array.isArray(task.receipt.files) && task.receipt.files.length > 0 && cloudSha(task.receiptHash) && task.returnedHash === task.receiptHash;
  const accepted = validAcceptance(task, now);
  const submitted = task.executionStatus === 'submitted' || !!task.receipt;
  const claimed = cloudId(task.taskRef) && cloudId(task.attemptId) && Number.isSafeInteger(task.fence) && task.fence > 0;
  const leaseValid = claimed && typeof task.leaseUntil === 'string' && typeof task.deadlineAt === 'string' && Date.parse(task.leaseUntil) > now && Date.parse(task.deadlineAt) > now;
  const stage = delivered ? 3 : submitted ? 2 : claimed ? 1 : task.taskRef ? 0 : -1;
  const result = (state: string, label: string, active = false) => ({ state, label, active, stage, delivered, accepted });
  // Order acceptance and delivery to the original session are separate facts.
  if (accepted) return result('succeeded', '原订单已验收');
  if (['failed', 'cancelled', 'expired'].includes(task.status)) return result(task.status, museOrderLabel(task));
  if (task.status === 'cancel_requested' || task.executionStatus === 'cancel_requested') return result('cancel_requested', '等待停止确认');
  if (['input_required', 'result_incomplete', 'budget_dispute'].includes(task.status)) return result('blocked', museOrderLabel(task));
  if (task.executionStatus === 'blocked') return result('blocked', '执行受阻');
  if (task.status === 'dispatch_uncertain') return result('uncertain', '派发结果待核对');
  if (delivered) return result('succeeded', task.status === 'review_required' ? '已送达 · 待验收' : '已送达 · 订单待核对');
  if (submitted || task.status === 'review_required') return result('return_pending', '成果待回传');
  if (task.executionStatus === 'claimed') return leaseValid && ['queued', 'running'].includes(task.status) ? result('leased', '已领取 · 租约有效', true) : result('uncertain', '执行租约待核对');
  if (task.executionStatus === 'stopped') return result('uncertain', '执行端已停止 · 等待订单确认');
  if (task.status === 'running') return result('uncertain', '等待执行凭据');
  if (['draft', 'approved', 'dispatching'].includes(task.status)) return result('preparing', museOrderLabel(task));
  if (task.status === 'queued' || task.executionStatus === 'pending') return result('queued', '等待领取');
  return result('uncertain', '任务状态待核对');
}
export function museFileUrl(file: unknown) {
  return isMuseFile(file)
    ? '/api/muse-worker-files/' + encodeURIComponent(file.id) + '?version=1&sha256=' + encodeURIComponent(file.sha256) : null;
}
