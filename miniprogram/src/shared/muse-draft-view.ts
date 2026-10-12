/** A presentation boundary only. The backend owns extraction, missing fields,
 * versioning, approval and original order creation. No client-side inference. */
export type DraftPresentation = {
  id: string;
  conversationId: string;
  revision: number;
  hash: string;
  state: 'needs_input' | 'review' | 'prepared' | 'rejected';
  scope: { product?: string; market?: string; objective?: string; budgetCredits?: number; deadlineAt?: string };
  questions: string[];
  suggestions: string[];
  orderId?: string;
};
export function draftPresentation(value: DraftPresentation) {
  const summary = [value.scope.product, value.scope.market, value.scope.objective].filter(Boolean).join(' · ');
  return {
    ...value,
    title: value.state === 'needs_input' ? '只需补充这些信息' : value.state === 'prepared' ? '已关联原 Muse 订单' : value.state === 'rejected' ? '此草案已拒绝' : '审阅委托草案',
    summary,
    budget: value.scope.budgetCredits === undefined ? '预算待明确' : `上限 ${value.scope.budgetCredits} credits`,
    deadline: value.scope.deadlineAt || '期限待明确',
    ready: value.state === 'review' && value.questions.length === 0 && typeof value.scope.budgetCredits === 'number' && Number.isFinite(value.scope.budgetCredits) && value.scope.budgetCredits > 0 && Boolean(value.scope.deadlineAt),
  };
}
