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

test('supply snapshots are read-only, workspace-bound and never mix product/offer states across concurrent writes', async t => {
  const f = await fixture(t);
  const audit = () => f.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const before = audit();
  const first = f.store.read('workspace-a', { entity: 'supply', id: 'sku', offerId: 'exclusive' });
  assert.equal(first.product.asOf, first.offer.asOf); assert.equal(first.offer.asOf, first.asOf);
  assert.equal(first.product.available, 10); assert.equal(first.offer.availableSlots, 1); assert.equal(audit(), before);
  assert.equal(f.store.read('workspace-a', { entity: 'supply', id: 'sku' }).offer, null);
  assert.throws(() => f.store.read('workspace-b', { entity: 'supply', id: 'sku', offerId: 'exclusive' }), { code: 'NOT_FOUND' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'supply' }), { code: 'INPUT' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'product', id: 'sku', offerId: 'exclusive' }), { code: 'INPUT' });
  f.write({ action: 'add_product', requestId: 'other', id: 'other', name: 'Other', currency: 'USD', unitPriceMinor: 100, stockTotal: 1, source: 'Test' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'supply', id: 'other', offerId: 'exclusive' }), { code: 'OFFER_PRODUCT_MISMATCH' });
  const writer = new ErpStore(f.file, { clock: () => initial }), original = f.store.product.bind(f.store);
  f.store.product = (...args) => {
    const product = original(...args);
    writer.write('workspace-a', f.reserve({ requestId: 'concurrent-supply-write' }));
    return product;
  };
  try {
    const consistent = f.store.read('workspace-a', { entity: 'supply', id: 'sku', offerId: 'exclusive' });
    assert.equal(consistent.product.available, 10); assert.equal(consistent.offer.availableSlots, 1);
  } finally { f.store.product = original; writer.close(); }
  const after = f.store.read('workspace-a', { entity: 'supply', id: 'sku', offerId: 'exclusive' });
  assert.equal(after.product.available, 8); assert.equal(after.offer.availableSlots, 0);
});

test('offer pickers filter by workspace product before cursor pagination', async t => {
  const f = await fixture(t);
  f.write({ action: 'add_product', requestId: 'other', id: 'other', name: 'Other fixture', currency: 'USD', unitPriceMinor: 1, stockTotal: 1, source: 'Test only' });
  const offer = (id, productId) => ({ action: 'add_offer', requestId: id, id, productId, territory: id, channel: 'test', term: 'Test', conditions: 'Test', capacity: 1, validUntil: '2026-11-26T00:00:00Z', source: 'Test only' });
  f.write(offer('aaa-other', 'other')); f.write(offer('zzz-match', 'sku'));
  const page = f.store.read('workspace-a', { entity: 'offer', productId: 'sku', limit: 1 });
  assert.equal(page.items[0].id, 'exclusive'); assert.equal(page.hasMore, true);
  const next = f.store.read('workspace-a', { entity: 'offer', productId: 'sku', limit: 1, afterId: page.nextCursor });
  assert.equal(next.items[0].id, 'zzz-match'); assert.equal(next.hasMore, false);
  assert.throws(() => f.store.read('workspace-b', { entity: 'offer', productId: 'sku' }), { code: 'NOT_FOUND' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'buyer', productId: 'sku' }), { code: 'INPUT' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'offer', id: 'exclusive', productId: 'sku' }), { code: 'INPUT' });
});

test('customer edits preserve legacy contacts/order links, validate input and reject stale/foreign writes', async t => {
  const f = await fixture(t); const order = f.write(f.reserve());
  const c = f.store.read('workspace-a', { entity: 'buyer', id: 'buyer-a' });
  assert.equal(c.email, ''); assert.equal(c.legacyContact, 'buyer-a@example.test');
  const update = { action: 'update_buyer', requestId: 'customer-edit', id: c.id, expectedRevision: c.revision,
    name: 'Updated customer', email: 'customer@example.test', phone: '+1 202 555 0100', note: 'Internal note' };
  const saved = f.write(update); assert.equal(saved.current.revision, 2);
  assert.equal(saved.current.legacyContact, c.legacyContact);
  assert.equal(f.write(update).current.revision, 2, 'replay does not write twice');
  assert.throws(() => f.write({ ...update, requestId: 'stale-edit' }), { code: 'CUSTOMER_CHANGED' });
  assert.throws(() => f.store.write('workspace-b', { ...update, requestId: 'foreign-edit' }), { code: 'NOT_FOUND' });
  for (const invalid of [{ email: 'not-an-email' }, { phone: 'not-a-phone' }, { note: 'x'.repeat(2001) }]) {
    assert.throws(() => f.write({ ...update, expectedRevision: 2, requestId: 'invalid', ...invalid }), { code: 'INPUT' });
    assert.equal(f.store.buyer('workspace-a', c.id).revision, 2);
  }
  const cleared = f.write({ action: 'update_buyer', requestId: 'clear', id: c.id, expectedRevision: 2, email: '', note: '' }).current;
  assert.equal(cleared.email, ''); assert.equal(cleared.note, ''); assert.equal(cleared.phone, update.phone);
  assert.equal(cleared.name, update.name); assert.equal(cleared.legacyContact, c.legacyContact);
  assert.equal(f.store.order('workspace-a', order.id, initial).buyerId, c.id);
  assert.equal(f.store.order('workspace-a', order.id, initial).totalMinor, order.current.totalMinor);
});

test('customer order history filters before pagination and enforces workspace boundaries', async t => {
  const f = await fixture(t);
  const reserve = extra => { const body = f.reserve(extra); delete body.offerId; return f.write(body); };
  const wanted = [reserve({ requestId: 'first' }), reserve({ requestId: 'second' })].map(r => r.id).sort();
  reserve({ requestId: 'other', buyerId: 'buyer-b' });
  const page = f.store.read('workspace-a', { entity: 'order', buyerId: 'buyer-a', limit: 1 });
  assert.deepEqual(page.items.map(r => r.id), wanted.slice(0, 1)); assert.equal(page.hasMore, true);
  const next = f.store.read('workspace-a', { entity: 'order', buyerId: 'buyer-a', limit: 1, afterId: page.nextCursor });
  assert.deepEqual(next.items.map(r => r.id), wanted.slice(1)); assert.equal(next.hasMore, false);
  assert.throws(() => f.store.read('workspace-b', { entity: 'order', buyerId: 'buyer-a' }), { code: 'NOT_FOUND' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'buyer', buyerId: 'buyer-a' }), { code: 'INPUT' });
  assert.throws(() => f.store.read('workspace-a', { entity: 'order', id: wanted[0], buyerId: 'buyer-b' }), { code: 'INPUT' });
});

test('v2 customer schema upgrade preserves old contacts, receipts, orders and survives reopening', async t => {
  const f = await fixture(t); const command = f.reserve(), receipt = f.write(command);
  // Reproduce the exact pre-customer buyers table without replacing any business rows.
  f.store.db.exec("ALTER TABLE buyers DROP COLUMN email; ALTER TABLE buyers DROP COLUMN phone; ALTER TABLE buyers DROP COLUMN note; ALTER TABLE buyers DROP COLUMN revision; PRAGMA user_version=2;");
  for (let pass = 0; pass < 2; pass++) {
    const upgraded = new ErpStore(f.file, { clock: () => initial });
    try {
      assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 4);
      const customer = upgraded.read('workspace-a', { entity: 'buyer', id: 'buyer-a' });
      assert.equal(customer.legacyContact, 'buyer-a@example.test'); assert.equal(customer.email, ''); assert.equal(customer.revision, 1);
      const replay = upgraded.write('workspace-a', command);
      assert.equal(replay.id, receipt.id); assert.equal(replay.replayed, true); assert.equal(replay.current.totalMinor, receipt.current.totalMinor);
      assert.equal(upgraded.db.prepare("SELECT COUNT(*) AS n FROM events WHERE request_id='reserve'").get().n, 1);
    } finally { upgraded.close(); }
  }
});

test('admin overview counts real workspace records and expired holds without fabricating payments', async t => {
  const f = await fixture(t, 10, 2);
  const first = f.write(f.reserve({ quantity: 1 }));
  f.write({ action: 'confirm', requestId: 'confirm', orderId: first.id });
  const second = f.reserve({ requestId: 'short', buyerId: 'buyer-b', holdMinutes: 1 }); delete second.offerId; f.write(second);
  const beforeEvents = f.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  f.advance(60000);
  const counts = f.store.overview('workspace-a');
  assert.deepEqual({ ...counts.orders }, { total: 2, confirmed: 1, reserved: 0, cancelled: 0, expired: 1 });
  assert.equal(counts.customers, 2); assert.equal(counts.allocations, 1); assert.equal(counts.payments, 'not_connected');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, beforeEvents);
  assert.equal(f.store.overview('workspace-b').orders.total, 0);
});

test('admin search uses literal terms, filters before pagination and stays within the workspace', async t => {
  const f = await fixture(t);
  for (const key of ['one', 'two']) f.write({ action: 'add_buyer', requestId: key, id: key, name: `Match % ${key}`, email: `${key}@example.test` });
  const first = f.store.read('workspace-a', { entity: 'buyer', q: '%', limit: 1 });
  assert.equal(first.items[0].id, 'one'); assert.equal(first.hasMore, true);
  assert.equal(f.store.read('workspace-a', { entity: 'buyer', q: '%', limit: 1, afterId: first.nextCursor }).items[0].id, 'two');
  assert.equal(f.store.read('workspace-b', { entity: 'buyer', q: 'Match' }).items.length, 0);
  assert.equal(f.store.read('workspace-a', { entity: 'buyer', q: "' OR 1=1 --" }).items.length, 0);
  const order = f.write(f.reserve());
  assert.equal(f.store.read('workspace-a', { entity: 'order', q: order.id.slice(0, 8) }).items[0].id, order.id);
  assert.throws(() => f.store.read('workspace-a', { entity: 'buyer', id: 'one', q: 'Match' }), { code: 'INPUT' });
});
