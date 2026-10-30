// Search, filtering and neighbourhood helpers. Labels are injected so the module has no dependency on the model.

const lower = (value) => String(value ?? '').toLowerCase();

export function nodeMatches(node, labels, { query = '', kinds = null, statuses = null } = {}) {
  if (kinds?.size && !kinds.has(node.kind)) return null;
  if (statuses?.size && !statuses.has(node.status)) return null;
  const tokens = lower(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const title = lower(node.title);
  const kind = lower(labels.kinds?.[node.kind]);
  const status = lower(labels.statuses?.[node.status]);
  const rest = `${lower(node.subtitle)} ${lower(node.refId)} ${lower(node.id)}`;
  let score = 0;
  for (const token of tokens) {
    if (title.startsWith(token)) score += 100;
    else if (title.includes(token)) score += 60;
    else if (kind.includes(token) || status.includes(token)) score += 30;
    else if (rest.includes(token)) score += 10;
    else return null;
  }
  return score;
}

/** Ranked results; ties keep a stable alphabetical order. */
export function searchNodes(nodes, labels, filters = {}, limit = 50) {
  const results = [];
  for (const node of nodes) {
    const score = nodeMatches(node, labels, filters);
    if (score !== null) results.push({ node, score });
  }
  results.sort((a, b) => b.score - a.score || String(a.node.title).localeCompare(String(b.node.title), 'zh-CN'));
  return results.slice(0, limit);
}

export const hasActiveFilter = ({ query = '', kinds = null, statuses = null } = {}) => Boolean(query.trim() || kinds?.size || statuses?.size);

/** IDs that satisfy the filters, or null when no filter is active (nothing to dim). */
export function matchingIds(nodes, labels, filters = {}) {
  if (!hasActiveFilter(filters)) return null;
  return new Set(nodes.filter((node) => nodeMatches(node, labels, filters) !== null).map((node) => node.id));
}

/** The node plus everything connected within `hops` edges. */
export function relatedIds(edges, ids, hops = 1) {
  const seen = new Set(ids);
  let frontier = new Set(ids);
  for (let step = 0; step < hops; step += 1) {
    const next = new Set();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !seen.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !seen.has(edge.source)) next.add(edge.source);
    }
    for (const id of next) seen.add(id);
    frontier = next;
    if (!frontier.size) break;
  }
  return seen;
}
