import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommerceGraph } from '../src/projection/network.mjs';
import { projectGraph } from '../src/model.mjs';
import { CommerceStore } from '../store.js';
import { createCommerceService } from '../service.js';

function fixture(ids = {}) {
  const { factory = 'factory_fixture', distributor = 'distributor_fixture', agent = 'agent_fixture', order = 'order_fixture' } = ids;
  return {
    projectId: 'project_fixture', projects: [{ id: 'project_fixture', name: 'Projection fixture' }],
    products: [], routes: [], canvasLayouts: [],
    commerceNetwork: {
      projectId: 'project_fixture',
      parties: [
        { id: factory, projectId: 'project_fixture', type: 'factory', displayName: 'Fixture factory' },
        { id: distributor, projectId: 'project_fixture', type: 'distributor', displayName: 'Fixture distributor' },
        { id: 'provider_fixture', projectId: 'project_fixture', type: 'provider', displayName: 'Fixture provider' },
      ],
      agentServices: [{ id: agent, projectId: 'project_fixture', providerPartyId: 'provider_fixture', displayName: 'Fixture worker' }],
      workOrders: [{ id: order, projectId: 'project_fixture', requesterPartyId: factory, agentServiceId: agent, title: 'Fixture task', status: 'proposed' }],
      salesAuthorizations: [],
    },
  };
}

function savePositions(state, positions) {
  state.canvasLayouts = [{ projectId: state.projectId, revision: 1, nodes: positions }];
}

test('all commerce kinds restore coordinates for maximum-length record IDs', () => {
  const ids = { factory: 'f'.repeat(128), distributor: 'd'.repeat(128), agent: 'a'.repeat(128), order: 'o'.repeat(128) };
  const state = fixture(ids);
  const saved = [
    { id: `factory:${ids.factory}`, position: { x: 1234, y: 5678 } },
    { id: `distributor:${ids.distributor}`, position: { x: -1234, y: 5678 } },
    { id: `personal_agent:${ids.agent}`, position: { x: 1234, y: -5678 } },
    { id: `service_order:${ids.order}`, position: { x: -1234, y: -5678 } },
  ];
  savePositions(state, saved);
  const before = structuredClone(state);
  // CommerceApp's business and execution views filter this shared projection;
  // model enrichment must not replace the persisted positions from the graph.
  for (const graph of [buildCommerceGraph(state, state.projectId), projectGraph(state)]) {
    assert.equal(graph.nodes.length, 4);
    for (const entry of saved) {
      const node = graph.nodes.find(n => n.id === entry.id);
      assert.deepEqual(node.position, entry.position, entry.id);
      assert.equal(node.positionSource, 'user', entry.id);
    }
  }
  assert.deepEqual(state, before);
});

test('colon-containing record IDs and existing sales/market layouts keep their exact identity', () => {
  const state = fixture({ factory: `factory:${'x'.repeat(120)}`, agent: 'provider:agent:one', order: 'request:order:one' });
  state.products = [{ id: 'p'.repeat(128), projectId: state.projectId, name: 'Fixture product' }];
  state.routes = [{ id: 'r'.repeat(128), projectId: state.projectId, market: 'US retail', channel: 'wholesale', productIds: [state.products[0].id], workerRole: 'Research' }];
  const ids = [
    `factory:${state.commerceNetwork.parties[0].id}`, 'personal_agent:provider:agent:one', 'service_order:request:order:one',
    `product:${state.products[0].id}`, `route:${state.routes[0].id}`, `worker:${state.routes[0].id}`, 'market:US retail',
  ];
  const saved = ids.map((id, i) => ({ id, position: { x: i * 123, y: -i * 57 } }));
  savePositions(state, saved);
  const graph = projectGraph(state);
  for (const entry of saved) {
    const node = graph.nodes.find(n => n.id === entry.id);
    assert.deepEqual(node.position, entry.position, entry.id);
    assert.equal(node.positionSource, 'user', entry.id);
  }
});

test('invalid and unrelated layout IDs cannot create or reposition commerce nodes', () => {
  const state = fixture();
  const baseline = projectGraph(state);
  const invalidIds = [
    'factory_fixture', 'factory:', 'factory::factory_fixture', 'unknown:factory_fixture',
    'Factory:factory_fixture', '__proto__:factory_fixture', 'factory:__proto__',
    'constructor:factory_fixture', `factory:${'f'.repeat(129)}`, null, 123,
  ];
  savePositions(state, [
    ...invalidIds.map(id => ({ id, position: { x: 999, y: 999 } })),
    { id: 'factory:factory_fixture', position: { x: Infinity, y: 10 } },
    { id: 'personal_agent:agent_fixture', position: { x: 10, y: NaN } },
    { id: 'distributor:distributor_fixture', position: { x: '10', y: 10 } },
    { id: 'service_order:order_fixture', position: null },
  ]);
  const graph = projectGraph(state);
  assert.deepEqual(graph.nodes, baseline.nodes);
  assert.deepEqual(graph.edges, baseline.edges);
});

test('maximum-length commerce layout IDs survive service save and SQLite restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'commerce-layout-'));
  const filename = join(directory, 'commerce.sqlite');
  const workspaceId = randomUUID(), sessionId = `session-${randomUUID()}`;
  const rows = [{ id: workspaceId, sessionIds: [sessionId] }];
  const registry = { list: () => rows, get: id => rows.find(row => row.id === id) };
  let service = createCommerceService({ store: new CommerceStore(filename), registry });
  const ids = { factory: 'f'.repeat(128), distributor: 'd'.repeat(128), agent: 'a'.repeat(128), order: 'o'.repeat(128) };
  try {
    const plan = await service.toolCommand({
      requestId: randomUUID(), expectedRevision: 0, command: 'apply_plan',
      payload: {
        title: 'Layout persistence fixture',
        parties: [
          { id: ids.factory, type: 'factory', displayName: 'Fixture factory' },
          { id: ids.distributor, type: 'distributor', displayName: 'Fixture distributor' },
          { id: 'provider_fixture', type: 'provider', displayName: 'Fixture provider' },
        ],
        agents: [{ id: ids.agent, providerPartyId: 'provider_fixture', displayName: 'Fixture worker', skills: ['public_web_research'] }],
        workOrders: [{ id: ids.order, requesterPartyId: ids.factory, agentServiceId: ids.agent, title: 'Fixture research', brief: 'Synthetic layout verification only.', allowedActions: ['public_web_research'] }],
      },
    }, { agent: { session: { id: sessionId } }, callId: `call_${randomUUID()}` });
    const nodes = [
      { id: `factory:${ids.factory}`, position: { x: 1234, y: 5678 } },
      { id: `distributor:${ids.distributor}`, position: { x: -1234, y: 5678 } },
      { id: `personal_agent:${ids.agent}`, position: { x: 1234, y: -5678 } },
      { id: `service_order:${ids.order}`, position: { x: -1234, y: -5678 } },
    ];
    const viewport = { x: 92, y: -51, zoom: 0.8 };
    service.layout(sessionId, { projectId: plan.projectId, requestId: randomUUID(), expectedLayoutRevision: 0, nodes, viewport });
    for (const id of [`unknown:${ids.factory}`, `factory:${ids.factory}x`, 'factory:__proto__']) {
      assert.throws(() => service.layout(sessionId, {
        projectId: plan.projectId, requestId: randomUUID(), expectedLayoutRevision: 1,
        nodes: [{ id, position: { x: 1, y: 2 } }],
      }), error => error.code === 'LAYOUT_INPUT');
    }
    service.close();
    service = createCommerceService({ store: new CommerceStore(filename), registry });
    const restored = service.state(sessionId, plan.projectId);
    assert.equal(restored.canvasLayouts[0].revision, 1);
    assert.deepEqual(restored.canvasLayouts[0].nodes, nodes);
    const graph = projectGraph(restored);
    assert.deepEqual(graph.viewport, viewport);
    for (const entry of nodes) {
      const node = graph.nodes.find(n => n.id === entry.id);
      assert.deepEqual(node.position, entry.position, entry.id);
      assert.equal(node.positionSource, 'user', entry.id);
    }
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
