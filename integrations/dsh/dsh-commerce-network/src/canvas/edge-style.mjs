// Visual state of a relationship, derived from the record it came from.

export function edgeTone(edge) {
  if (edge.kind === 'sales_revoked' || edge.status === 'revoked') return 'revoked';
  if (['running', 'claimed', 'stop_requested'].includes(edge.status)) return 'active';
  if (['failed', 'rejected', 'cancelled'].includes(edge.status)) return 'failed';
  if (/proposed/.test(edge.kind) || ['proposed', 'pending'].includes(edge.status)) return 'pending';
  if (edge.kind === 'execution_dependency' && ['accepted', 'active'].includes(edge.status)) return 'done';
  return 'default';
}

export const EDGE_MARKER = Object.freeze({ default: 'cn-arrow', pending: 'cn-arrow', revoked: 'cn-arrow', done: 'cn-arrow-done', active: 'cn-arrow-active', failed: 'cn-arrow-failed' });
