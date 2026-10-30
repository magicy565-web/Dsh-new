// Pending placeholders. A draft lives only in the browser: it marks a request that was handed
// to the Assistant and disappears when the real node arrives, fails, or is dismissed. It is never saved.

export const DRAFT_TTL_MS = 180_000;
const MAX_DRAFTS = 8;

export const draftNodeId = (id) => `draft:${id}`;

export function createDraft({ id, kind, title, position, anchorId = null, nodes, now }) {
  return {
    id, kind, title, position, anchorId, status: 'submitting', reason: null, createdAt: now,
    baselineIds: nodes.filter((node) => node.kind === kind).map((node) => node.id),
  };
}

export const addDraft = (drafts, draft) => [...drafts, draft].slice(-MAX_DRAFTS);
export const dismissDraft = (drafts, id) => drafts.filter((draft) => draft.id !== id);

/** Record the outcome of the hand-off; a refusal keeps the draft visible with its reason. */
export function settleDraft(drafts, id, outcome) {
  return drafts.map((draft) => (draft.id !== id ? draft : outcome.ok
    ? { ...draft, status: 'waiting' }
    : { ...draft, status: 'failed', reason: outcome.reason || '请求没有被接收。' }));
}

/**
 * Match waiting drafts with nodes that appeared after the request.
 * Returns the remaining drafts and, for each match, the real node that replaced it.
 */
export function reconcileDrafts(drafts, nodes, now, ttl = DRAFT_TTL_MS) {
  const claimed = new Set();
  const resolved = [];
  const remaining = [];
  for (const draft of drafts) {
    if (draft.status !== 'waiting' || !draft.kind) { remaining.push(draft); continue; }
    const arrival = nodes.find((node) => node.kind === draft.kind && !draft.baselineIds.includes(node.id) && !claimed.has(node.id));
    if (arrival) { claimed.add(arrival.id); resolved.push({ draft, nodeId: arrival.id }); continue; }
    remaining.push(now - draft.createdAt > ttl ? { ...draft, status: 'expired', reason: 'Assistant 暂未保存新的业务记录。请到左侧会话核对。' } : draft);
  }
  return { drafts: remaining, resolved };
}

export const draftStatusLabel = (status) => ({ submitting: '正在提交', waiting: '等待 Assistant 保存', failed: '未提交', expired: '未收到记录' })[status] || '待确认';
