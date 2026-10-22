import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, ROUTES, TOOLS } from '../src/index.mjs';
import { createPurchaseService } from '../src/domain.mjs';

function fakeStorage() {
  let state = {};
  return {
    read: () => structuredClone(state),
    update: async mutator => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    },
  };
}

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const OPERATOR = { subject: 'service:runner', role: 'operator', workspaceId: 'local' };
const VIEWER = { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' };
const body = () => ({
  requestId: crypto.randomUUID(),
  supplier: '无锡法兰厂',
  currency: 'CNY',
  lines: [{ description: '不锈钢法兰 DN50', quantity: 500, unitPriceMinor: 1250 }],
});

function service() { return createPurchaseService({ storage: fakeStorage() }); }

test('totals are computed by the server in minor units', async () => {
  const purchases = service();
  const { order } = await purchases.create({ actor: ADMIN }, body());
  assert.equal(order.totalMinor, 625000);
  assert.equal(order.total, '6250.00');
  assert.equal(order.status, 'draft');
  assert.match(order.number, /^PO-\d{8}-\d{3}$/u);
});

test('only an administrator can approve an order', async () => {
  const purchases = service();
  const { order } = await purchases.create({ actor: OPERATOR }, body());
  await assert.rejects(
    purchases.setStatus({ actor: OPERATOR }, order.id, { status: 'approved' }),
    error => error.code === 'PURCHASE_APPROVAL_REQUIRED' && error.status === 403,
  );
  const approved = await purchases.setStatus({ actor: ADMIN }, order.id, { status: 'approved' });
  assert.equal(approved.order.status, 'approved');
  assert.equal(approved.order.approvedBy, 'local-operator');
  assert.ok(approved.order.approvedAt);
});

test('the lifecycle is draft -> approved -> ordered -> received', async () => {
  const purchases = service();
  const { order } = await purchases.create({ actor: ADMIN }, body());
  await purchases.setStatus({ actor: ADMIN }, order.id, { status: 'approved' });
  await purchases.setStatus({ actor: ADMIN }, order.id, { status: 'ordered' });
  const received = await purchases.setStatus({ actor: ADMIN }, order.id, { status: 'received' });
  assert.equal(received.order.status, 'received');
  assert.equal(received.order.terminal, true);
  await assert.rejects(purchases.setStatus({ actor: ADMIN }, order.id, { status: 'cancelled' }), error => error.code === 'PURCHASE_TRANSITION');
});

test('skipping approval is refused and viewers cannot write', async () => {
  const purchases = service();
  const { order } = await purchases.create({ actor: ADMIN }, body());
  await assert.rejects(purchases.setStatus({ actor: ADMIN }, order.id, { status: 'ordered' }), error => error.code === 'PURCHASE_TRANSITION');
  await assert.rejects(purchases.create({ actor: VIEWER }, body()), error => error.code === 'PURCHASE_FORBIDDEN');
  await assert.rejects(purchases.setStatus({ actor: VIEWER }, order.id, { status: 'cancelled' }), error => error.code === 'PURCHASE_FORBIDDEN');
  assert.equal(purchases.read({ actor: VIEWER }, order.id).order.id, order.id);
});

test('creation is idempotent by requestId', async () => {
  const purchases = service();
  const payload = body();
  const first = await purchases.create({ actor: ADMIN }, payload);
  const again = await purchases.create({ actor: ADMIN }, payload);
  assert.equal(again.replayed, true);
  assert.equal(again.order.id, first.order.id);
});

test('the plugin registers tools, routes and the page; no approve tool exists', async () => {
  const routes = new Map();
  const tools = new Map();
  await apply({
    storage: fakeStorage(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: definition => { tools.set(definition.name, definition); return () => {}; } },
    health: { register: () => {} },
  }, {});
  assert.equal(routes.size, ROUTES.length);
  assert.deepEqual([...tools.keys()].sort(), [...TOOLS].sort());
  assert.equal(tools.has('purchase_order_approve'), false, 'the model must have no approval tool');
  assert.equal(tools.get('purchase_order_create').approval, 'always');
  assert.equal(tools.get('purchase_order_list').readOnly, true);

  const page = await routes.get('GET /purchases').handler({}, {}, {});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /新建采购单/u);
  assert.doesNotThrow(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/u)[1]), 'the inline page script parses');
});
