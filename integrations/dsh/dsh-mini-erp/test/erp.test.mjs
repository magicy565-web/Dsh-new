import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ErpStore } from '../store.js';
import { registerTools } from '../index.js';

const initial = Date.parse('2026-10-26T12:00:00Z');
async function fixture(t, stock = 10, capacity = 1) {
  const dir = await mkdtemp(join(tmpdir(), 'mini-erp-test-')), file = join(dir, 'erp.sqlite');
  let now = initial; const store = new ErpStore(file, { clock: () => now });
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const write = command => store.write('workspace-a', command, 'test-operator');
  write({ action: 'add_product', requestId: 'p', id: 'sku', name: 'Synthetic product', currency: 'USD', unitPriceMinor: 1234, stockTotal: stock, source: 'Synthetic specification for testing only' });
  for (const id of ['buyer-a', 'buyer-b']) write({ action: 'add_buyer', requestId: id, id, name: id, contact: `${id}@example.test` });
  write({ action: 'add_offer', requestId: 'offer', id: 'exclusive', productId: 'sku', territory: 'US', channel: 'gift-retail', term: 'Test-only supply allocation', conditions: 'Synthetic supplier terms', capacity, validUntil: '2026-11-26T00:00:00Z', source: 'Synthetic agreement, not real rights' });
  const reserve = (extra = {}) => ({ action: 'reserve', requestId: 'reserve', buyerId: 'buyer-a', productId: 'sku', expectedRevision: 1, quantity: 2, offerId: 'exclusive', holdMinutes: 60, ...extra });
  return { store, file, write, reserve, advance: ms => { now += ms; } };
}

test('order reservation and confirmation bind price, stock and supply slot; restart retains the committed ledger', async t => {
  const f = await fixture(t); const order = f.write(f.reserve());
  assert.equal(order.current.totalMinor, 2468); assert.equal(order.current.status, 'reserved');
  assert.equal(f.store.read('workspace-a', { entity: 'product', id: 'sku' }).available, 8);
  assert.equal(f.store.read('workspace-a', { entity: 'offer', id: 'exclusive' }).availableSlots, 0);
  const confirmed = f.write({ action: 'confirm', requestId: 'confirm', orderId: order.id });
  assert.equal(confirmed.current.status, 'confirmed'); assert.equal(confirmed.current.paymentStatus, 'not_tracked');
  assert.throws(() => f.write({ action: 'cancel', requestId: 'cancel', orderId: order.id }), { code: 'ORDER_STATE' });
  const reopened = new ErpStore(f.file, { clock: () => initial });
  try { assert.equal(reopened.read('workspace-a', { entity: 'order', id: order.id }).status, 'confirmed'); } finally { reopened.close(); }
});

test('cancel and expiry release both allocations; old idempotency keys return current state without resurrecting a hold', async t => {
  const f = await fixture(t); const command = f.reserve(), first = f.write(command);
  assert.equal(f.write({ ...command }).id, first.id);
  assert.throws(() => f.write({ ...command, quantity: 3 }), { code: 'IDEMPOTENCY_CONFLICT' });
  f.write({ action: 'cancel', requestId: 'cancel', orderId: first.id });
  assert.equal(f.write(command).current.status, 'cancelled');
  assert.equal(f.store.read('workspace-a', { entity: 'product', id: 'sku' }).available, 10);
  const second = f.write(f.reserve({ requestId: 'second', holdMinutes: 1 }));
  f.advance(60000);
  assert.equal(f.store.read('workspace-a', { entity: 'order', id: second.id }).status, 'expired');
  assert.equal(f.store.read('workspace-a', { entity: 'offer', id: 'exclusive' }).availableSlots, 1);
  assert.throws(() => f.write({ action: 'confirm', requestId: 'late-confirm', orderId: second.id }), { code: 'ORDER_STATE' });
  assert.equal(f.write(f.reserve({ requestId: 'second', holdMinutes: 1 })).current.status, 'expired');
  assert.equal(f.write(f.reserve({ requestId: 'third' })).current.status, 'reserved');
});

test('failed writes roll back; stale revisions, invalid stock reductions and foreign-workspace records are rejected', async t => {
  const f = await fixture(t); const order = f.write(f.reserve());
  assert.throws(() => f.write({ action: 'update_product', requestId: 'update', id: 'sku', expectedRevision: 1, unitPriceMinor: 1500, stockTotal: 1, source: 'Test recount' }), { code: 'STOCK_CONFLICT' });
  assert.equal(f.store.read('workspace-a', { entity: 'product', id: 'sku' }).revision, 1);
  f.write({ action: 'update_product', requestId: 'update', id: 'sku', expectedRevision: 1, unitPriceMinor: 1500, stockTotal: 10, source: 'Test price revision' });
  assert.throws(() => f.write(f.reserve({ requestId: 'stale' })), { code: 'REVISION_CONFLICT' });
  assert.equal(f.store.read('workspace-a', { entity: 'order', id: order.id }).unitPriceMinor, 1234);
  assert.deepEqual(f.store.read('workspace-b', { entity: 'order' }).items, []);
  assert.throws(() => f.store.read('workspace-b', { entity: 'order', id: order.id }), { code: 'NOT_FOUND' });
  assert.throws(() => f.store.write('workspace-b', f.reserve()), { code: 'NOT_FOUND' });
  assert.throws(() => f.write(f.reserve({ requestId: 'bad', quantity: 1.5 })), { code: 'REVISION_CONFLICT' });
});

test('an offer must match the product, scope is unique, and buyer cannot occupy the same offer twice', async t => {
  const f = await fixture(t, 10, 2); f.write(f.reserve());
  assert.throws(() => f.write(f.reserve({ requestId: 'duplicate-buyer' })), { code: 'ALREADY_HELD' });
  f.write({ action: 'add_product', requestId: 'other-product', id: 'other', name: 'Other test product', currency: 'USD', unitPriceMinor: 1, stockTotal: 10, source: 'Test' });
  assert.throws(() => f.write(f.reserve({ requestId: 'wrong-product', productId: 'other' })), { code: 'OFFER_PRODUCT_MISMATCH' });
  assert.throws(() => f.write({ action: 'add_offer', requestId: 'duplicate-offer', id: 'different-id', productId: 'sku', territory: 'us', channel: 'GIFT-RETAIL', term: 'Test', conditions: 'Test', capacity: 1, validUntil: '2026-11-26T00:00:00Z', source: 'Test' }), /UNIQUE/);
});

test('stock-only orders, input bounds, order totals and atomic rollback', async t => {
  const f = await fixture(t, 1);
  const command = f.reserve({ quantity: 1 }); delete command.offerId;
  for (const quantity of [0, -1, 1.5, 1e20]) assert.throws(() => f.write({ ...command, quantity }), { code: 'INPUT' });
  assert.throws(() => f.write({ ...command, quantity: 2 }), { code: 'OUT_OF_STOCK' });
  const r = f.write(command); assert.equal(r.current.offerId, null);
  assert.equal(f.store.read('workspace-a', { entity: 'offer', id: 'exclusive' }).availableSlots, 1);
  assert.throws(() => f.store.read('workspace-a', { entity: '__proto__' }), { code: 'INPUT' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'product', limit: 101 }), { code: 'INPUT' });
  const first = f.store.read('workspace-a', { entity: 'buyer', limit: 1 });
  assert.equal(first.hasMore, true); assert.equal(first.items[0].id, 'buyer-a');
  const next = f.store.read('workspace-a', { entity: 'buyer', limit: 1, afterId: first.nextCursor });
  assert.equal(next.hasMore, false); assert.equal(next.items[0].id, 'buyer-b');
  f.write({ action: 'add_product', requestId: 'large', id: 'large', name: 'Large calculation test', currency: 'USD', unitPriceMinor: 1000000000, stockTotal: 1000000000, source: 'Test only' });
  assert.throws(() => f.write({ ...command, requestId: 'overflow', productId: 'large', quantity: 1000000000 }), /safe integer/);
  assert.equal(f.store.read('workspace-a', { entity: 'product', id: 'large' }).available, 1000000000);
  assert.throws(() => f.write({ ...command, requestId: 'injected', workspace: 'workspace-b' }), { code: 'INPUT' });
});

test('independent SQLite connections racing for the last stock or slot allow exactly one successful reservation', async t => {
  for (const [stock, capacity] of [[1, 2], [10, 1]]) {
    const f = await fixture(t, stock, capacity);
    const gate = new SharedArrayBuffer(4);
    const jobs = ['buyer-a', 'buyer-b'].map((buyerId, i) => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../dev/race-worker.mjs', import.meta.url), { workerData: { file: f.file, now: initial, gate, command: f.reserve({ buyerId, requestId: `race-${i}`, quantity: 1 }) } });
      worker.on('message', m => { if (m.ready) { if (Atomics.add(new Int32Array(gate), 0, 1) === 1) Atomics.notify(new Int32Array(gate), 0); } else resolve(m); });
      worker.on('error', reject); worker.on('exit', code => { if (code) reject(new Error(`Worker exit ${code}`)); });
    }));
    const results = await Promise.all(jobs); assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
    assert.ok(['OUT_OF_STOCK', 'NO_SLOTS'].includes(results.find(r => !r.ok).code));
    assert.equal(f.store.read('workspace-a', { entity: 'order' }).items.length, 1);
  }
});

test('native tool adapter derives workspace and audit identity from host, honours cancellation and removes tools on disposal', async t => {
  const f = await fixture(t), tools = new Map(), dispose = [], workspace = { id: 'workspace-a', sessionIds: ['session-a'] };
  registerTools({ workspaceRegistry: { list: () => [workspace] }, effect(fn) { dispose.push(fn()); }, tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } } }, f.store);
  const execution = { agent: { session: { id: 'session-a' } }, callId: 'call-a', signal: new AbortController().signal };
  const read = tools.get('mini_erp_read').execute;
  assert.equal(read({ entity: 'product', id: 'sku' }, execution).available, 10);
  assert.throws(() => read({ entity: 'product' }, { agent: { session: { id: 'outside' } } }), { code: 'WORKSPACE_REQUIRED' });
  const abort = new AbortController(); abort.abort(); assert.throws(() => read({ entity: 'product' }, { ...execution, signal: abort.signal }), { name: 'AbortError' });
  tools.get('mini_erp_order').execute(f.reserve(), execution);
  assert.equal(f.store.db.prepare("SELECT actor FROM events WHERE request_id='reserve'").get().actor, 'agent:session-a/call-a');
  workspace.id = 'workspace-b'; assert.deepEqual(read({ entity: 'order' }, execution).items, []);
  dispose.reverse().forEach(fn => fn()); assert.equal(tools.size, 0);
});
