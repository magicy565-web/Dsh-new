// Deterministic left-to-right layered layout. Pure: it reads node ids, kinds and edges and returns positions.
// Source records never carry coordinates, so this only decides where a node *starts*; a saved position always wins.

export const LAYOUT = Object.freeze({ column: 400, row: 215, componentGap: 120, nodeWidth: 264, nodeHeight: 190, snap: 8, looseColumns: 4 });

const KIND_ORDER = ['factory', 'product', 'market', 'business_mandate', 'distributor', 'channel', 'service_order', 'personal_agent', 'worker',
  'approval', 'evidence', 'rfq', 'buyer', 'quote', 'sample', 'order', 'erp_order'];
const kindRank = (kind) => { const index = KIND_ORDER.indexOf(kind); return index < 0 ? KIND_ORDER.length : index; };
const snap = (value) => Math.round(value / LAYOUT.snap) * LAYOUT.snap;
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function adjacency(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const out = new Map(nodes.map((node) => [node.id, []]));
  const inn = new Map(nodes.map((node) => [node.id, []]));
  const seen = new Set();
  for (const edge of [...edges].sort((a, b) => byId(a.id ?? '', b.id ?? ''))) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    const key = `${edge.source}\u0000${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(edge.source).push(edge.target);
    inn.get(edge.target).push(edge.source);
  }
  return { out, inn };
}

function components(nodes, out, inn) {
  const owner = new Map();
  const groups = [];
  for (const node of nodes) {
    if (owner.has(node.id)) continue;
    const members = [];
    const stack = [node.id];
    owner.set(node.id, groups.length);
    while (stack.length) {
      const id = stack.pop();
      members.push(id);
      for (const next of [...out.get(id), ...inn.get(id)]) if (!owner.has(next)) { owner.set(next, groups.length); stack.push(next); }
    }
    groups.push(members.sort(byId));
  }
  return groups;
}

// Drop back edges so ranks always terminate, whatever cycles the records contain.
function acyclic(members, out, inn) {
  const forward = new Map(members.map((id) => [id, []]));
  const state = new Map();
  const visit = (id) => {
    state.set(id, 1);
    for (const next of out.get(id)) {
      if (state.get(next) === 1) continue;
      forward.get(id).push(next);
      if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
  };
  const roots = members.filter((id) => !inn.get(id).length);
  for (const id of [...roots, ...members]) if (!state.has(id)) visit(id);
  return forward;
}

function rankMembers(members, forward) {
  const incoming = new Map(members.map((id) => [id, 0]));
  for (const id of members) for (const next of forward.get(id)) incoming.set(next, incoming.get(next) + 1);
  const rank = new Map(members.map((id) => [id, 0]));
  const queue = members.filter((id) => incoming.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    for (const next of forward.get(id)) {
      rank.set(next, Math.max(rank.get(next), rank.get(id) + 1));
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  // A node with no upstream sits next to its nearest consumer instead of stretching an edge across the canvas.
  const sources = members.filter((id) => !members.some((other) => forward.get(other).includes(id)) && forward.get(id).length);
  for (const id of sources) rank.set(id, Math.min(...forward.get(id).map((next) => rank.get(next))) - 1);
  return rank;
}

function layoutComponent(members, kinds, forward, inn, top) {
  const rank = rankMembers(members, forward);
  const columns = [];
  for (const id of members) (columns[rank.get(id)] ||= []).push(id);
  const placed = new Map();
  columns.forEach((column, index) => {
    if (!column) return;
    const rows = column.map((id) => {
      const above = inn.get(id).filter((parent) => placed.has(parent));
      return { id, bary: above.length ? above.reduce((sum, parent) => sum + placed.get(parent).y, 0) / above.length : null };
    });
    rows.sort((a, b) => (a.bary === null) - (b.bary === null) || (a.bary ?? 0) - (b.bary ?? 0) || kindRank(kinds.get(a.id)) - kindRank(kinds.get(b.id)) || byId(a.id, b.id));
    let next = null;
    for (const row of rows) {
      const wanted = row.bary ?? (next ?? top);
      const y = next === null ? Math.max(wanted, top) : Math.max(wanted, next);
      placed.set(row.id, { x: index * LAYOUT.column, y });
      next = y + LAYOUT.row;
    }
  });
  const bottom = Math.max(...[...placed.values()].map((point) => point.y)) + LAYOUT.row;
  return { placed, bottom };
}

export function layeredLayout(nodes, edges = []) {
  const ordered = [...nodes].sort((a, b) => byId(a.id, b.id));
  if (!ordered.length) return [];
  const kinds = new Map(ordered.map((node) => [node.id, node.kind]));
  const { out, inn } = adjacency(ordered, edges);
  const groups = components(ordered, out, inn);
  const linked = groups.filter((group) => group.length > 1).sort((a, b) => b.length - a.length || byId(a[0], b[0]));
  const loose = groups.filter((group) => group.length === 1).map((group) => group[0])
    .sort((a, b) => kindRank(kinds.get(a)) - kindRank(kinds.get(b)) || byId(a, b));
  const positions = new Map();
  let top = 0;
  for (const members of linked) {
    const forward = acyclic(members, out, inn);
    const { placed, bottom } = layoutComponent(members, kinds, forward, inn, top);
    for (const [id, point] of placed) positions.set(id, point);
    top = bottom + LAYOUT.componentGap;
  }
  loose.forEach((id, index) => positions.set(id, { x: (index % LAYOUT.looseColumns) * LAYOUT.column, y: top + Math.floor(index / LAYOUT.looseColumns) * LAYOUT.row }));
  return ordered.map((node) => ({ ...node, position: { x: snap(positions.get(node.id).x), y: snap(positions.get(node.id).y) } }));
}

const overlaps = (a, b) => Math.abs(a.x - b.x) < LAYOUT.nodeWidth + 24 && Math.abs(a.y - b.y) < LAYOUT.nodeHeight;

/** Positions every node the user has not placed. Saved coordinates are kept exactly; new nodes slide down past them. */
export function placeGenerated(graph) {
  const free = graph.nodes.filter((node) => node.positionSource !== 'user');
  if (!free.length) return graph;
  const suggested = new Map(layeredLayout(graph.nodes, graph.edges).map((node) => [node.id, node.position]));
  const taken = graph.nodes.filter((node) => node.positionSource === 'user').map((node) => node.position);
  for (const node of free) {
    let point = { ...suggested.get(node.id) };
    while (taken.some((other) => overlaps(point, other))) point = { x: point.x, y: point.y + LAYOUT.row };
    taken.push(point);
    node.position = point;
  }
  return graph;
}
