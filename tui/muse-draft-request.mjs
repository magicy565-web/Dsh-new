import { randomUUID } from 'node:crypto';

// One original HTTP draft shape shared by slash-command and native model tool.
// Public sharing is confirmed by the caller's real UI before prepare() is sent.
export function museDraftRequest(scope, supplied, requestId = randomUUID()) {
  const fields = ['serviceId', 'product', 'market', 'objective', 'budgetCredits', 'deadlineAt'];
  if (!supplied || Object.keys(supplied).some(key => !fields.includes(key))) throw new Error('MUSE_DRAFT_FIELDS_INVALID');
  const order = Object.fromEntries(fields.map(key => [key, supplied[key]]));
  if (!Number.isFinite(order.budgetCredits) || order.budgetCredits <= 0 || !Number.isFinite(Date.parse(order.deadlineAt)) || !/(Z|[+-]\d\d:\d\d)$/.test(order.deadlineAt)) throw new Error('EXPLICIT_BUDGET_AND_DEADLINE_REQUIRED');
  return { scope, input: { provider: 'muse', conversationId: scope.conversationId, requestId, content: order.objective,
    order: { ...order, publicDataConfirmed: true } } };
}
