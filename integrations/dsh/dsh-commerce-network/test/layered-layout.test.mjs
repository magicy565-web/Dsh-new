import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, layeredLayout, placeGenerated } from '../src/canvas/layered-layout.mjs';

const node = (id, kind, extra = {}) => ({ id, kind, position: { x: 0, y: 0 }, ...extra });
const edge = (source, target) => ({ id: `${source}__${target}`, source, target });
const sample = () => ({
  nodes: [
    node('product:a', 'product'), node('product:b', 'product'), node('market:DE', 'market'), node('route:r1', 'channel'), node('worker:r1', 'worker'),
    node('factory:f1', 'factory'), node('service_order:o1', 'service_order'), node('personal_agent:a1', 'personal_agent'), node('evidence:e1', 'evidence'),
  ],
  edges: [edge('product:a', 'route:r1'), edge('product:b', 'route:r1'), edge('market:DE', 'route:r1'), edge('route:r1', 'worker:r1'),
    edge('factory:f1', 'service_order:o1'), edge('service_order:o1', 'personal_agent:a1')],
});

const positions = (nodes) => new Map(nodes.map((n) => [n.id, n.position]));
const collide = (a, b) => Math.abs(a.x - b.x) < LAYOUT.nodeWidth && Math.abs(a.y - b.y) < LAYOUT.nodeHeight;

test('no two nodes overlap and every position sits on the snap grid', () => {
  const { nodes, edges } = sample();
  const placed = layeredLayout(nodes, edges);
  assert.equal(placed.length, nodes.length);
  for (let i = 0; i < placed.length; i += 1) {
    assert.equal(placed[i].position.x % LAYOUT.snap, 0);
    assert.equal(placed[i].position.y % LAYOUT.snap, 0);
    for (let j = i + 1; j < placed.length; j += 1) assert.equal(collide(placed[i].position, placed[j].position), false, `${placed[i].id} overlaps ${placed[j].id}`);
  }
});

test('relations flow left to right and sources sit beside their consumer', () => {
  const { nodes, edges } = sample();
  const at = positions(layeredLayout(nodes, edges));
  for (const { source, target } of edges) assert.ok(at.get(source).x < at.get(target).x, `${source} must be left of ${target}`);
  assert.equal(at.get('product:a').x, at.get('market:DE').x);
});

test('unrelated groups are stacked instead of interleaved', () => {
  const { nodes, edges } = sample();
  const at = positions(layeredLayout(nodes, edges));
  const sales = ['product:a', 'product:b', 'market:DE', 'route:r1', 'worker:r1'].map((id) => at.get(id).y);
  const network = ['factory:f1', 'service_order:o1', 'personal_agent:a1'].map((id) => at.get(id).y);
  assert.ok(Math.max(...sales) < Math.min(...network) || Math.max(...network) < Math.min(...sales));
});

test('layout is deterministic regardless of input order and never mutates its input', () => {
  const { nodes, edges } = sample();
  const before = structuredClone({ nodes, edges });
  assert.deepEqual(layeredLayout(nodes, edges), layeredLayout([...nodes].reverse(), [...edges].reverse()));
  assert.deepEqual({ nodes, edges }, before);
});

test('cycles terminate and unlinked nodes are gathered into a grid below the linked groups', () => {
  const nodes = [node('a', 'channel'), node('b', 'worker'), node('c', 'buyer'), ...['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => node(id, 'evidence'))];
  const placed = layeredLayout(nodes, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
  const at = positions(placed);
  const lowestLinked = Math.max(at.get('a').y, at.get('b').y, at.get('c').y);
  for (const id of ['x1', 'x2', 'x3', 'x4', 'x5']) assert.ok(at.get(id).y > lowestLinked);
  assert.equal(new Set(placed.map((n) => `${n.position.x},${n.position.y}`)).size, placed.length);
});

test('edges that reference unknown nodes or themselves are ignored', () => {
  const placed = layeredLayout([node('a', 'product'), node('b', 'channel')], [edge('a', 'ghost'), edge('b', 'b'), edge('a', 'b')]);
  assert.equal(placed.length, 2);
  assert.ok(placed[0].position.x < placed[1].position.x);
});

test('saved coordinates are kept exactly and generated nodes slide past them', () => {
  const { nodes, edges } = sample();
  const graph = { nodes: nodes.map((n) => ({ ...n, positionSource: 'generated' })), edges };
  const target = graph.nodes.find((n) => n.id === 'route:r1');
  const suggested = layeredLayout(nodes, edges).find((n) => n.id === 'product:a').position;
  graph.nodes.find((n) => n.id === 'worker:r1').positionSource = 'user';
  graph.nodes.find((n) => n.id === 'worker:r1').position = { ...suggested };
  placeGenerated(graph);
  assert.deepEqual(graph.nodes.find((n) => n.id === 'worker:r1').position, suggested);
  assert.notEqual(target.position, undefined);
  const all = graph.nodes.map((n) => n.position);
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) assert.equal(collide(all[i], all[j]), false);
});

test('an empty graph is a no-op', () => {
  assert.deepEqual(layeredLayout([], []), []);
  const graph = { nodes: [], edges: [] };
  assert.equal(placeGenerated(graph), graph);
});
