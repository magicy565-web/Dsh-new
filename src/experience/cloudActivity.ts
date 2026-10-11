import { cloudId, museState } from './museControl.ts';
import type { CloudFile, MuseTask } from './museControl';

export type CloudJob = {
  muse?: MuseTask; id: string; prompt: string; state: string; conversationId?: string; transport?: string;
  claimedAt?: number; createdAt?: string | number; updatedAt?: string | number; completedAt?: number;
  attemptId?: string | null; fence?: number; leaseUntil?: string | number | null; leaseExpiresAt?: number | null; deadlineAt?: string | number | null;
  resultSummary?: string; files?: CloudFile[]; completionHash?: string; businessAcceptance?: string;
  reconciliationRequired?: boolean; blocker?: { message?: string }; toolEvidence?: unknown;
  nativeRequestId?: string; receiptHash?: string | null; returnedHash?: string | null; closedHash?: string; dispatched?: boolean;
};
export const jobKey = (job: CloudJob) => (job.muse ? 'muse:' : 'dot:') + job.id;
export const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
export const stateLabels: Record<string, string> = { preparing: '准备中', queued: '等待领取', leased: '已领取', running: '执行中', return_pending: '回传中', succeeded: '成果已回传', blocked: '执行受阻', uncertain: '等待核实', cancel_requested: '等待停止确认', cancelled: '已停止', failed: '执行失败', expired: '已过期' };
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' ? Date.parse(value) : NaN;
export function cloudJobState(job: CloudJob, now: number) {
  if (job.muse) return museState(job.muse, now);
  const claimed = cloudId(job.id) && cloudId(job.attemptId) && Number.isSafeInteger(job.fence) && job.fence! > 0;
  const executing = ['leased', 'running'].includes(job.state);
  const lease = time(job.leaseUntil ?? job.leaseExpiresAt);
  const consistentLease = job.leaseUntil == null || job.leaseExpiresAt == null || lease === time(job.leaseExpiresAt);
  const active = executing && claimed && consistentLease && !job.reconciliationRequired && lease > now && time(job.deadlineAt) > now;
  const uncertain = executing && !active;
  const state = uncertain ? 'uncertain' : job.state;
  return { state, label: job.businessAcceptance === 'accepted' ? '已验收' : uncertain ? '执行凭据待核对' : stateLabels[state] || '任务状态待核对',
    active, stage: job.state === 'succeeded' ? 3 : job.state === 'return_pending' ? 2 : claimed ? 1 : 0 };
}
export function jobNeedsAttention(job: CloudJob, now: number) {
  return ['blocked', 'uncertain', 'failed', 'cancel_requested'].includes(cloudJobState(job, now).state)
    || job.state === 'succeeded' && job.businessAcceptance === 'not_reviewed'
    || !!job.nativeRequestId && ['cancelled', 'expired'].includes(job.state) && !!job.returnedHash && !job.closedHash;
}
/** Selection is independent of agent/list order. Live fenced work comes first;
 * other blocking/cancellation/receipt states remain visible through the attention count. */
export function selectCurrentJob(jobs: CloudJob[], now: number) {
  const rank = (job: CloudJob) => cloudJobState(job, now).active ? 0 : jobNeedsAttention(job, now) ? 1
    : job.state === 'return_pending' ? 2 : !terminal.has(job.state) ? 3 : 4;
  const recent = (job: CloudJob) => time(job.updatedAt) || time(job.claimedAt) || time(job.createdAt) || 0;
  return [...jobs].sort((a, b) => rank(a) - rank(b) || recent(b) - recent(a) || jobKey(a).localeCompare(jobKey(b)))[0];
}
