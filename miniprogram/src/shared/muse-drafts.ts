import { draftPresentation } from './muse-draft-view';
import type { DraftPresentation } from './muse-draft-view';
/** Implemented backend DTO from docs/MUSE-DRAFT-CONTRACT.md at 5eceddc.
 * revision/draftHash are canonical; DTO aliases are deliberately not consumed. */
export type MuseDraft = {
  id: string; conversationId: string; requestId: string; revision: number; draftHash: string | null; runId: string;
  phase: 'pending' | 'needs_information' | 'ready_for_review' | 'preparing' | 'prepared' | 'rejecting' | 'rejected' | 'failed' | 'blocked';
  scope: { serviceId: string | null; product: string | null; market: string | null; objective: string | null; budgetCredits: number | null; deadlineAt: string | null; publicDataConfirmed: false };
  productReference: { productId: string; productRevision: number } | null;
  missingFields: string[]; questions: { field: string; question: string }[]; error: { code: string; message: string } | null;
  prepareRequestId: string | null; orderId: string | null; reviewHash: string | null; executionStarted: false; wakeVerified: false;
  publicText: string; suggestions: { field: string; value: unknown; label: string }[];
};
const phases = ['pending', 'needs_information', 'ready_for_review', 'preparing', 'prepared', 'rejecting', 'rejected', 'failed', 'blocked'];
export function validMuseDraft(value: MuseDraft, conversationId: string) {
  return value && typeof value.id === 'string' && value.conversationId === conversationId && Number.isInteger(value.revision) && value.revision > 0 && phases.includes(value.phase) &&
    (value.draftHash === null || /^[a-f0-9]{64}$/.test(value.draftHash)) && value.scope && value.scope.publicDataConfirmed === false && Array.isArray(value.questions) &&
    value.questions.every(item => typeof item.field === 'string' && typeof item.question === 'string') && Array.isArray(value.missingFields) && typeof value.publicText === 'string' && Array.isArray(value.suggestions) && value.executionStarted === false && value.wakeVerified === false;
}
export function presentMuseDraft(value: MuseDraft) {
  const phase: DraftPresentation['phase'] = value.phase;
  const view = draftPresentation({ id: value.id, conversationId: value.conversationId, revision: value.revision, draftHash: value.draftHash, phase,
    scope: { ...(value.scope.serviceId !== null ? { serviceId: value.scope.serviceId } : {}), ...(value.scope.product !== null ? { product: value.scope.product } : {}), ...(value.scope.market !== null ? { market: value.scope.market } : {}), ...(value.scope.objective !== null ? { objective: value.scope.objective } : {}), ...(value.scope.budgetCredits !== null ? { budgetCredits: value.scope.budgetCredits } : {}), ...(value.scope.deadlineAt !== null ? { deadlineAt: value.scope.deadlineAt } : {}) },
    questions: value.questions.map(item => item.question), publicText: value.publicText, suggestions: value.suggestions.map(item => `${item.label} · ${String(item.value)}`), ...(value.orderId ? { orderId: value.orderId } : {}) });
  const title = ({ pending: '正在整理委托草案', preparing: '正在核对原订单准备结果', rejecting: '正在核对原停止回执', rejected: '草案已拒绝', failed: '草案整理失败', blocked: '草案需要处理' } as Record<string, string>)[value.phase];
  return { ...view, ...(title ? { title } : {}), phase: value.phase, detail: value.error?.message || '', editable: ['needs_information', 'ready_for_review', 'failed', 'blocked'].includes(value.phase), rejectable: ['pending', 'needs_information', 'ready_for_review', 'prepared', 'failed', 'blocked'].includes(value.phase) };
}
