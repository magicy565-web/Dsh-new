/** A presentation boundary only. The backend owns extraction, missing fields,
 * versioning, approval and original order creation. No client-side inference. */
export type DraftPresentation = {
  id: string;
  conversationId: string;
  scopeVersion: number;
  scopeHash: string | null;
  phase: 'pending' | 'needs_information' | 'ready_for_review' | 'preparing' | 'prepared' | 'failed' | 'blocked' | 'rejected';
  scope: { serviceId?: string; product?: string; market?: string; objective?: string; budgetCredits?: number; deadlineAt?: string };
  questions: string[];
  suggestions: string[];
  orderId?: string;
};
export function draftPresentation(value: DraftPresentation) {
  const summary = [value.scope.product, value.scope.market, value.scope.objective, value.scope.serviceId ? `服务 ${({ 'channel-validation': '渠道验证', 'buyer-discovery': '买家研究' } as Record<string, string>)[value.scope.serviceId] || value.scope.serviceId}` : ''].filter(Boolean).join(' · ');
  return {
    ...value,
    title: value.phase === 'needs_information' ? '只需补充这些信息' : value.phase === 'prepared' ? '已关联原 Muse 订单' : value.phase === 'rejected' ? '此草案已拒绝' : '审阅委托草案',
    summary,
    budget: value.scope.budgetCredits === undefined ? '预算待明确' : `上限 ${value.scope.budgetCredits} credits`,
    deadline: value.scope.deadlineAt || '期限待明确',
    ready: typeof value.scopeHash === 'string' && /^[a-f0-9]{64}$/.test(value.scopeHash) && value.phase === 'ready_for_review' && value.questions.length === 0 && typeof value.scope.budgetCredits === 'number' && Number.isFinite(value.scope.budgetCredits) && value.scope.budgetCredits > 0 && Boolean(value.scope.deadlineAt),
  };
}

export class DraftReview {
  private selected: DraftPresentation | null = null;
  termsConfirmed = false;
  publicDataConfirmed = false;
  open(value: DraftPresentation) { this.selected = JSON.parse(JSON.stringify(value)); this.termsConfirmed = false; this.publicDataConfirmed = false; }
  close() { this.selected = null; this.termsConfirmed = false; this.publicDataConfirmed = false; }
  confirm(values: string[]) { this.termsConfirmed = values.includes('terms'); this.publicDataConfirmed = values.includes('public'); }
  get value() { return this.selected; }
  validate(current: DraftPresentation) {
    if (!this.selected || current.id !== this.selected.id || current.conversationId !== this.selected.conversationId || current.scopeVersion !== this.selected.scopeVersion || current.scopeHash !== this.selected.scopeHash || current.phase !== this.selected.phase) {
      this.close(); throw new Error('草案范围已变更，请重新审阅当前版本。');
    }
    if (!draftPresentation(current).ready || !this.termsConfirmed || !this.publicDataConfirmed) throw new Error('请明确确认本次预算、期限与公开文字范围。');
    return { id: current.id, conversationId: current.conversationId, scopeVersion: current.scopeVersion, scopeHash: current.scopeHash };
  }
}
