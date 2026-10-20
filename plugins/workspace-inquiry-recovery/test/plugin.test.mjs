import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apply } from '../src/index.mjs';

const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };

function fakeContext() {
  const state = { version: 3, meta: { sequence: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, conversations: [], runs: [], artifacts: [] };
  const routes = new Map(), tools = new Map(), health = new Map();
  const storage = {
    directory: 'fake',
    read: () => state,
    update: async callback => {
      const clone = structuredClone(state);
      const result = callback(clone);
      for (const key of Object.keys(clone)) state[key] = clone[key];
      return structuredClone(result);
    },
    close: async () => {},
  };
  const ctx = {
    storage,
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: tool => { tools.set(tool.name, tool); } },
    health: { register: (name, fn) => { health.set(name, fn); } },
  };
  return { ctx, routes, tools, health, state };
}

const envelope = inquiries => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries });

const row = (overrides = {}) => ({
  leadId: 'lead-alpha', sourceId: 'canton-2024', revision: 1,
  companyName: 'Alpha Trading LLC', companyUrl: 'https://alpha.example.com', contactEmail: 'buyer@alpha.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  lastContactAt: '2026-09-10', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-01', body: 'Please quote 500 pcs hydraulic cylinder.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'Please quote 500 pcs hydraulic cylinder', occurredAt: '2026-09-01' }],
  ...overrides,
});

test('the plugin registers its routes, read-only tools and health probe', async t => {
  const { ctx, routes, tools, health } = fakeContext();
  const dispose = await apply(ctx, { workspaceId: 'local' });
  assert.equal(routes.size, 8);
  assert.deepEqual([...routes.keys()], [
    'GET /api/inquiry-recovery/status', 'GET /api/inquiry-recovery/opportunities',
    'GET /api/inquiry-recovery/selections', 'GET /api/inquiry-recovery/conflicts',
    'GET /api/inquiry-recovery/leads/:leadId', 'POST /api/inquiry-recovery/import',
    'POST /api/inquiry-recovery/leads/:leadId/identity', 'POST /api/inquiry-recovery/leads/:leadId/select',
  ]);
  assert.deepEqual([...tools.keys()], ['inquiry_recovery_status', 'inquiry_recovery_opportunities']);
  for (const tool of tools.values()) assert.equal(tool.readOnly, true);
  assert.ok(health.has('inquiries'));
  assert.equal(typeof dispose, 'function');
});

test('routes and tools operate on the same domain service', async t => {
  const { ctx, routes, tools, state } = fakeContext();
  await apply(ctx, { workspaceId: 'local' });
  const call = async (key, body) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, ...segments] = key.split(' ');
    const pathname = segments.join(' ');
    return await definition.handler({}, {}, { method, pathname, body, query: {}, actor });
  };

  const status = await call('GET /api/inquiry-recovery/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.counts.leads, 0);

  const imported = await call('POST /api/inquiry-recovery/import', {
    format: 'json', requestId: randomUUID(), content: envelope([row()]),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);

  const listed = tools.get('inquiry_recovery_opportunities');
  const cards = await listed.handler({ asOf: '2026-10-21', limit: 5 }, { actor });
  assert.equal(cards.cards.length, 1);
  assert.equal(cards.cards[0].decision, 'need_evidence');
  assert.equal(cards.cards[0].draftReady, false);
  assert.equal(cards.omitted, 0);

  const summary = tools.get('inquiry_recovery_status');
  const counts = await summary.handler({}, { actor });
  assert.equal(counts.counts.leads, 1);
  assert.equal(counts.counts.need_evidence, 1);
  assert.ok(state.inquiryRecovery, 'state must persist through the storage seam');
});

test('the plugin refuses a context without the required seams and an invalid config', async t => {
  await assert.rejects(apply({ storage: { read() {} }, tools: { register() {} } }, {}), error => error.code === 'HARNESS_PLUGIN_FAILED');
  const { ctx } = fakeContext();
  const withoutTools = { ...ctx, tools: undefined };
  await assert.rejects(apply(withoutTools, {}), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(apply(ctx, { staleDays: 0 }), error => error.code === 'HARNESS_MANIFEST_INVALID');
});
