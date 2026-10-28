import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { LibraryStore, createLibraryService } from '../../dsh-workspace-library/index.js';
import { ErpStore } from '../store.js';
import { createErpService } from '../catalog.js';
import { createHttpHandler } from '../http.js';
import { blocksFromErp } from '../../dsh-sourcing-agent/skills/buyer-magazine/scripts/from-erp.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'erp-catalog-'));
  const source = new LibraryStore({ dir: join(dir, 'library') }), library = createLibraryService(source);
  const store = new ErpStore(join(dir, 'erp.sqlite'));
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const service = createErpService(store, { library: () => library, registry: { list: () => [{ id: 'a' }, { id: 'b' }] } });
  let product = await library.saveProduct({ changes: { name: 'Synthetic fixture', description: 'Test material', skus: [
    { id: '_sku', code: 'TEST-RED', unit: 'box', moq: 2, specs: [{ key: 'Color', value: 'Red' }], pricingMode: 'tiered', priceTiers: [
      { minQuantity: 2, unitPrice: '12.34', currency: 'USD' }, { minQuantity: 10, unitPrice: '10.00', currency: 'USD' } ] },
    { id: 'blue', code: 'TEST-BLUE', pricingMode: 'on_request' },
  ] } });
  const edit = async changes => product = await library.saveProduct({ productId: product.id, expectedRevision: product.revision, changes });
  const write = input => service.write('a', input, 'test-only');
  const link = (extra = {}) => ({ action: 'link_sku', requestId: 'link', id: 'ledger', catalogProductId: product.id, skuId: '_sku', catalogRevision: product.revision, stockTotal: 100, ...extra });
  const reserve = (extra = {}) => ({ action: 'reserve', requestId: 'reserve', productId: 'ledger', buyerId: 'buyer', expectedRevision: 1, expectedCatalogRevision: product.revision, quantity: 10, ...extra });
  await write({ action: 'add_buyer', requestId: 'buyer', id: 'buyer', name: 'Test buyer', contact: 'test@example.test' });
  return { dir, source, library, store, service, write, link, reserve, edit, product: () => product };
}

test('live SKU tiers, two independent revisions and immutable order quotes use one source catalogue', async t => {
  const f = await fixture(t), before = await readFile(f.source.file, 'utf8');
  const binding = f.link(); await f.write(binding);
  assert.equal(await readFile(f.source.file, 'utf8'), before, 'linking does not mutate source files');
  let p = await f.service.read('a', { entity: 'product', id: 'ledger' });
  assert.equal(p.unitPriceMinor, 1234); assert.equal(p.quoteQuantity, 2); assert.equal(p.skuCode, 'TEST-RED');
  const order = await f.write(f.reserve()); assert.equal(order.current.unitPriceMinor, 1000);
  await f.edit({ name: 'Changed in original library', skus: f.product().skus.map(s => s.id !== '_sku' ? s : { ...s, priceTiers: [{ minQuantity: 2, unitPrice: '9.50', currency: 'USD' }] }) });
  p = await f.service.read('a', { entity: 'product', id: 'ledger', quantity: 10 });
  assert.equal(p.name, 'Changed in original library'); assert.equal(p.unitPriceMinor, 950); assert.equal(p.revision, 1); assert.equal(p.catalogRevision, 2);
  assert.equal((await f.service.read('a', { entity: 'order', id: order.id })).unitPriceMinor, 1000);
  await assert.rejects(f.write(f.reserve({ requestId: 'stale', expectedCatalogRevision: 1 })), { code: 'CATALOG_CHANGED' });
  const updated = await f.write({ action: 'update_stock', requestId: 'stock', id: 'ledger', expectedRevision: 1, stockTotal: 120, source: 'Test recount' });
  assert.equal(updated.current.revision, 2); assert.equal(updated.current.catalogRevision, 2); assert.equal(updated.current.available, 110);
  assert.equal((await f.write(binding)).current.unitPriceMinor, 950);
  await assert.rejects(f.write({ action: 'update_product', requestId: 'duplicate-model' }), { code: 'CATALOG_AUTHORITY' });
  await assert.rejects(f.service.read('unknown', { entity: 'product' }), { code: 'WORKSPACE_REQUIRED' });
  assert.equal((await f.service.read('b', { entity: 'product' })).items.length, 0);
});

test('MOQ, on-request prices, missing/archived source, SKU identity and exclusive workspace allocation fail safely', async t => {
  const f = await fixture(t); await f.write(f.link());
  await assert.rejects(f.write(f.reserve({ quantity: 1 })), { code: 'QUOTE_REQUIRED' });
  const held = f.reserve(); const order = await f.write(held);
  await assert.rejects(f.service.write('b', f.link({ id: 'other' })), { code: 'ALREADY_LINKED' });
  assert.equal((await f.service.read('b', { entity: 'product' })).items.length, 0, 'failed link rolls back the new ledger');
  await f.write(f.link({ id: 'blue', skuId: 'blue', requestId: 'blue' }));
  const snap = await f.service.read('a', { entity: 'supply', id: 'blue' });
  assert.equal(snap.product.unitPriceMinor, null);
  const converted = blocksFromErp(snap, { modules: ['product', 'procurement'], language: 'en' });
  assert.match(JSON.stringify(converted.blocks), /Price available on request/); assert.doesNotMatch(JSON.stringify(converted.blocks), /USD 0\.00/);
  await assert.rejects(f.write(f.reserve({ productId: 'blue', requestId: 'unpriced' })), { code: 'QUOTE_REQUIRED' });
  await assert.rejects(f.edit({ skus: [f.product().skus[0], { ...f.product().skus[1], id: '_sku' }] }), /skus.id/);
  await f.edit({ status: 'archived' });
  assert.equal((await f.write(held)).id, order.id, 'a committed request remains replayable');
  await assert.rejects(f.write(f.reserve({ requestId: 'archived' })), { code: 'CATALOG_UNAVAILABLE' });
  const missing = await f.service.read('a', { entity: 'supply', id: 'ledger' });
  assert.equal(missing.product.unitPriceMinor, null); assert.equal(missing.product.catalogStatus, 'unavailable');
  assert.throws(() => blocksFromErp(missing, { modules: ['product'] }), /unavailable/);
  await f.edit({ status: 'draft', skus: [f.product().skus[1]] });
  await assert.rejects(f.write(f.reserve({ requestId: 'removed-sku' })), { code: 'CATALOG_UNAVAILABLE' });
  assert.equal((await f.service.read('a', { entity: 'order', id: order.id })).unitPriceMinor, 1000);
});

test('source edits and order pricing serialize; queued cancelled commands cannot commit', async t => {
  const f = await fixture(t); await f.write(f.link());
  const { promise, resolve } = Promise.withResolvers();
  const gate = f.library.withProducts(() => promise);
  const editing = f.edit({ skus: f.product().skus.map(s => s.id !== '_sku' ? s : { ...s, priceTiers: [{ minQuantity: 2, unitPrice: '8.00', currency: 'USD' }] }) });
  const pending = f.write(f.reserve()); const rejection = assert.rejects(pending, { code: 'CATALOG_CHANGED' });
  resolve(); await gate; await editing; await rejection;
  const a = new AbortController(), next = Promise.withResolvers();
  const lock = f.library.withProducts(() => next.promise);
  const cancelled = f.service.write('a', f.reserve(), 'test', () => a.signal.throwIfAborted());
  const rejected = assert.rejects(cancelled, { name: 'AbortError' }); a.abort(); next.resolve(); await lock; await rejected;
  assert.equal((await f.service.read('a', { entity: 'order' })).items.length, 0);
  const order = await f.write(f.reserve()); assert.equal(order.current.unitPriceMinor, 800);
});

test('explicitly linking a legacy record preserves orders, ledger id and original source file', async t => {
  const f = await fixture(t);
  f.store.write('a', { action: 'add_product', requestId: 'legacy', id: 'ledger', name: 'Historical SKU', currency: 'EUR', unitPriceMinor: 4321, stockTotal: 100, source: 'Legacy fixture' });
  const old = f.store.write('a', f.reserve());
  // Recreate the v1 boundary: identical legacy tables, no mapping table yet.
  f.store.db.exec('DROP TABLE catalog_links; PRAGMA user_version=1;');
  const migrated = new ErpStore(join(f.dir, 'erp.sqlite'));
  assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version, 4); migrated.close();
  const command = f.link({ expectedRevision: 1 }); await f.write(command);
  assert.equal((await f.service.read('a', { entity: 'order', id: old.id })).unitPriceMinor, 4321);
  assert.equal((await f.service.read('a', { entity: 'product', id: 'ledger' })).available, 90);
  const reopened = new ErpStore(join(f.dir, 'erp.sqlite'));
  try { assert.equal(reopened.link('a', 'ledger').sku_id, '_sku'); assert.equal(reopened.order('a', old.id, Date.now()).currency, 'EUR'); } finally { reopened.close(); }
});

test('native admin HTTP requires authentication, same-origin writes, known workspace and explicit valid inputs', async t => {
  const f = await fixture(t), server = createServer(createHttpHandler(f.service, { authorize: r => r.headers.cookie === 'test=1' ? 0 : 401 }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, headers = {}) => fetch(base + '/mini-erp-api' + path, { headers: { cookie: 'test=1', origin: base, 'content-type': 'application/json', ...headers }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  assert.equal((await call('/catalog', null, { cookie: '' })).status, 401);
  assert.equal((await call('/workspaces/a/overview', null, { cookie: '' })).status, 401);
  assert.equal((await call('/workspaces/unknown/overview')).status, 409);
  assert.equal((await (await call('/workspaces/a/overview')).json()).data.customers, 1);
  assert.equal((await call('/workspaces/a/command', f.link(), { origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await call('/workspaces/a/command', f.link())).status, 200);
  assert.equal((await (await call('/workspaces/a/read?entity=product&id=ledger&quantity=10')).json()).data.unitPriceMinor, 1000);
  assert.equal((await call('/workspaces/a/command', { action: 'update_stock' })).status, 409);
  assert.equal((await call('/workspaces/unknown/read?entity=product')).status, 409);
  assert.equal((await call('/workspaces/a/command', { action: 'add_product', requestId: 'x' })).status, 400);
});
