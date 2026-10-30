// Pure view-model for AI Work. Every figure comes from DSH workspace records; nothing here invents
// availability, ratings or prices.

export const RUNTIMES = Object.freeze([
  { id: 'grokbot', name: 'Grok Bot' },
  { id: 'muse', name: 'Muse Agent' },
]);
export const OTHER_RUNTIME = Object.freeze({ id: 'other', name: '其他 Worker' });

export const runtimeOf = (providerType) => RUNTIMES.find((r) => r.id === providerType) || OTHER_RUNTIME;

export const SKILL_LABELS = Object.freeze({
  public_web_research: '公开网页调研',
  read_granted_product_context: '读取已授权的产品资料',
  draft_outreach: '起草外联文案',
  classify_opted_in_replies: '分类已同意联系的回复',
  summarize_rfq: '汇总询盘',
});
export const skillLabel = (skill) => SKILL_LABELS[skill] || skill;

// Fixed by the DSH Worker protocol; not configurable per Worker.
export const NEVER_DOES = Object.freeze(['委托给其他 Worker', '对外发送消息', '付款或转账', '共享凭证']);

export const STATUS = Object.freeze({
  proposed: '待你审批', authorized: '已授权', queued: '等待领取', claimed: '已领取', running: '执行中',
  delivered: '等待验收', accepted: '已完成', rejected: '已退回', cancelled: '已取消', stop_requested: '停止待确认', failed: '需要处理',
});
export const ACTIVE = new Set(['proposed', 'claimed', 'running', 'delivered', 'stop_requested']);
export const QUEUED = new Set(['authorized', 'queued']);
const TERMINAL = new Set(['accepted', 'rejected', 'cancelled', 'failed']);

export function taskStatus(order) {
  const handoff = order.grokHandoff?.state;
  if (handoff === 'unknown') return '派送结果待核对';
  if (handoff === 'preparing') return '准备派送';
  if (handoff === 'not_claimed') return '未领取，待核对';
  if (handoff === 'not_sent_stop_requested') return '停止待确认';
  return STATUS[order.status] || order.status;
}

/** True when the owner must act: approve, accept, confirm a stop, or reconcile an unknown hand-off. */
export function needsYou(order) {
  if (['proposed', 'delivered', 'stop_requested'].includes(order.status)) return true;
  const handoff = order.grokHandoff?.state;
  return !TERMINAL.has(order.status) && (handoff === 'unknown' || handoff === 'not_claimed');
}

/** Dot tones are limited to the three the design system allows: lanyard, ink and muted. */
export function dotFor(order) {
  if (needsYou(order) || order.status === 'failed') return 'attention';
  if (order.status === 'running' || order.status === 'claimed') return 'live';
  if (QUEUED.has(order.status)) return 'queued';
  if (order.status === 'accepted') return 'done';
  return 'idle';
}

export function groupTasks(orders) {
  return [
    ['当前任务', orders.filter((o) => ACTIVE.has(o.status))],
    ['排队中', orders.filter((o) => QUEUED.has(o.status))],
    ['最近', orders.filter((o) => !ACTIVE.has(o.status) && !QUEUED.has(o.status)).slice(0, 12)],
  ].filter(([, rows]) => rows.length > 0);
}

export function sortByRecent(orders) {
  return [...orders].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export function lastActivity(agents) {
  let latest = '';
  for (const agent of agents) if (agent.lastSeenAt && String(agent.lastSeenAt) > latest) latest = String(agent.lastSeenAt);
  return latest;
}

/** A verified gateway only proves that the Worker credential reached DSH; it is never shown as "online". */
export function presence(agents, orders) {
  const current = orders.find((o) => ['delivered', 'proposed', 'stop_requested'].includes(o.status))
    || orders.find((o) => o.status === 'running')
    || orders.find((o) => o.status === 'claimed')
    || orders.find((o) => QUEUED.has(o.status));
  if (current) return { dot: dotFor(current), label: taskStatus(current) };
  if (agents.some((a) => a.status === 'connected')) return { dot: 'idle', label: '网关已认证' };
  if (agents.some((a) => a.status === 'revoked')) return { dot: 'attention', label: '已撤销' };
  if (agents.length) return { dot: 'unset', label: '记录待确认' };
  return { dot: 'unset', label: '状态待同步' };
}

export const SAMPLE_FLOOR = 5;

/** Counts and acceptance rate for one Worker, derived from its work orders only. */
export function workerStats(worker, orders) {
  const mine = orders.filter((o) => o.agentServiceId === worker.id);
  const accepted = mine.filter((o) => o.status === 'accepted').length;
  const rejected = mine.filter((o) => o.status === 'rejected').length;
  const active = mine.filter((o) => ACTIVE.has(o.status) || QUEUED.has(o.status)).length;
  const sample = accepted + rejected;
  return { accepted, rejected, active, sample, rate: sample >= SAMPLE_FLOOR ? Math.round((accepted / sample) * 100) : null };
}

/** Badge number: the tail of the Worker record id, so it is stable and traceable. */
export function workerNo(id) {
  return String(id ?? '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0');
}

export const partyOf = (parties, id) => (parties || []).find((p) => p.id === id);
export const verificationLabel = (party) => (party?.verification === 'verified' ? '已核验' : '未核验');
export const initialOf = (name) => String(name || '?').trim().slice(0, 1).toUpperCase();

/** Numeric `MM/DD HH:mm` in local time, so it reads correctly in a monospaced face. */
export function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getMonth() + 1)}/${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
