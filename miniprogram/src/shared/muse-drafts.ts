import { draftPresentation } from './muse-draft-view';
import type { DraftPresentation } from './muse-draft-view';
/** Frozen backend DTO from docs/MUSE-DRAFT-CONTRACT.md at 6deb158. */
export type MuseDraft = {
  id: string; conversationId: string; requestId: string; scopeVersion: number; scopeHash: string | null; runId: string;
  phase: 'pending' | 'needs_information' | 'ready_for_review' | 'preparing' | 'prepared' | 'failed' | 'blocked';
  scope: { serviceId: string | null; product: string | null; market: string | null; objective: string | null; budgetCredits: number | null; deadlineAt: string | null; publicDataConfirmed: false };
  productReference: { productId: string; productRevision: number } | null;
  missingFields: string[]; questions: { field: string; question: string }[]; error: { code: string; message: string } | null;
  prepareRequestId: string | null; orderId: string | null; reviewHash: string | null; executionStarted: false; wakeVerified: false;
};
const phases = ['pending', 'needs_information', 'ready_for_review', 'preparing', 'prepared', 'failed', 'blocked'];
export function validMuseDraft(value: MuseDraft, conversationId: string) {
  return value && typeof value.id === 'string' && value.conversationId === conversationId && Number.isInteger(value.scopeVersion) && value.scopeVersion > 0 && phases.includes(value.phase) &&
    (value.scopeHash === null || /^[a-f0-9]{64}$/.test(value.scopeHash)) && value.scope && value.scope.publicDataConfirmed === false && Array.isArray(value.questions) &&
    value.questions.every(item => typeof item.field === 'string' && typeof item.question === 'string') && Array.isArray(value.missingFields) && value.executionStarted === false && value.wakeVerified === false;
}
export function presentMuseDraft(value: MuseDraft) {
  const phase: DraftPresentation['phase'] = value.phase;
  const view = draftPresentation({ id: value.id, conversationId: value.conversationId, scopeVersion: value.scopeVersion, scopeHash: value.scopeHash, phase,
    scope: { ...(value.scope.serviceId !== null ? { serviceId: value.scope.serviceId } : {}), ...(value.scope.product !== null ? { product: value.scope.product } : {}), ...(value.scope.market !== null ? { market: value.scope.market } : {}), ...(value.scope.objective !== null ? { objective: value.scope.objective } : {}), ...(value.scope.budgetCredits !== null ? { budgetCredits: value.scope.budgetCredits } : {}), ...(value.scope.deadlineAt !== null ? { deadlineAt: value.scope.deadlineAt } : {}) },
    questions: value.questions.map(item => item.question), suggestions: [], ...(value.orderId ? { orderId: value.orderId } : {}) });
  const title = ({ pending: '正在整理委托草案', preparing: '正在核对原订单准备结果', failed: '草案整理失败', blocked: '草案需要处理' } as Record<string, string>)[value.phase];
  return { ...view, ...(title ? { title } : {}), phase: value.phase, detail: value.error?.message || '', editable: ['needs_information', 'ready_for_review', 'failed', 'blocked'].includes(value.phase) };
}
