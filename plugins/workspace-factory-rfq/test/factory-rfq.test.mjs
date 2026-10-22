import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, TOOLS } from '../src/index.mjs';
import { captureRfq, prepareMatch } from '../src/domain.mjs';

test('an RFQ draft lists what is present and what is still pending', () => {
  const draft = captureRfq({ product: '不锈钢法兰', quantity: 500, target_market: '德国' });
  assert.equal(draft.kind, 'customer-rfq-draft');
  assert.equal(draft.status, 'draft');
  assert.deepEqual(draft.fields, { product: '不锈钢法兰', quantity: 500, target_market: '德国' });
  assert.deepEqual(draft.pending, ['spec', 'requested_delivery', 'requirements']);
  assert.equal(draft.complete, false);
  assert.match(draft.notice, /not a quote/u);
  assert.equal(draft.evidence.length, 3);
});

test('an RFQ draft refuses unknown fields and bad types', () => {
  assert.throws(() => captureRfq({ price: 9 }), error => error.code === 'FACTORY_INPUT');
  assert.throws(() => captureRfq({ product: { nested: true } }), error => error.code === 'FACTORY_INPUT');
  assert.throws(() => captureRfq('nope'), error => error.code === 'FACTORY_INPUT');
});

test('match preparation separates matched, differing and unverifiable facts', () => {
  const result = prepareMatch({
    rfq: { product: '法兰', spec: 'DN50', quantity: 500, requested_delivery: '2026-12-01' },
    offer: { product: '法兰', spec: 'DN80', available_quantity: 300, lead_time: '30 天' },
  });
  assert.equal(result.kind, 'factory-match-preparation');
  assert.equal(result.status, 'preparation');
  assert.ok(result.matched.some(item => item.field === 'product'));
  assert.ok(result.differs.some(item => item.field === 'spec'));
  assert.ok(result.differs.some(item => item.field === 'available_quantity'));
  assert.ok(result.unverifiable.some(item => item.field === 'lead_time'));
  assert.match(result.notice, /not a verified match/u);
});

test('match preparation treats non-numeric quantities as unverifiable instead of guessing', () => {
  const result = prepareMatch({
    rfq: { product: '法兰', quantity: '五百件' },
    offer: { product: '法兰', available_quantity: '300' },
  });
  assert.ok(result.unverifiable.some(item => item.field === 'quantity' && item.reason === 'NON_NUMERIC'));
});

test('the plugin registers both read-only tools and the capabilities route', async () => {
  const routes = new Map();
  const tools = new Map();
  const health = new Map();
  const ctx = {
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    health: { register: (name, fn) => health.set(name, fn) },
  };
  await apply(ctx, {});

  assert.deepEqual([...tools.keys()].sort(), [...TOOLS].sort());
  for (const definition of tools.values()) {
    assert.equal(definition.readOnly, true);
    assert.equal(definition.approval, 'never');
  }

  const capabilities = await routes.get('GET /api/factory/capabilities').handler({}, {}, {});
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.storesAnything, false);

  const draft = await tools.get('factory_rfq_capture').handler({ product: '法兰' }, {});
  assert.equal(draft.status, 'draft');
  assert.ok(draft.pending.includes('quantity'));

  const match = await tools.get('factory_match_prepare').handler({
    rfq: { product: '法兰' }, offer: { product: '法兰' },
  }, {});
  assert.equal(match.status, 'preparation');
  assert.equal(health.get('factory-rfq')().status, 'ok');
});
