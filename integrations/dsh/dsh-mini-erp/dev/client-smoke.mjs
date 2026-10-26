// Real library/SQLite/HTTP services; temporary synthetic records, DOM host slots.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { LibraryStore, createLibraryService } from '../../dsh-workspace-library/index.js';
import { ErpStore } from '../store.js';
import { createErpService } from '../catalog.js';
import { createHttpHandler } from '../http.js';
const dir = await mkdtemp(join(tmpdir(), 'erp-client-'));
const library = createLibraryService(new LibraryStore({ dir: join(dir, 'library') }));
const p = await library.saveProduct({ changes: { name: 'Synthetic admin fixture', skus: [{ id: 'red', code: 'TEST-RED', unit: 'box', moq: 1, pricingMode: 'tiered', priceTiers: [{ minQuantity: 1, unitPrice: '12.34', currency: 'USD' }] }] } });
const store = new ErpStore(join(dir, 'erp.sqlite'));
const service = createErpService(store, { library: () => library, registry: { list: () => [{ id: 'a', title: 'Fixture A' }, { id: 'b', title: 'Fixture B' }] } });
const server = createServer(createHttpHandler(service, { authorize: r => r.headers.cookie === 'fixture=1' ? 0 : 401 }));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const dom = new JSDOM('<div id="root"></div>', { url: base });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) => nativeFetch(new URL(url, base), { ...options, headers: { ...options.headers, cookie: 'fixture=1', origin: base } });
let module;
window.__ModuleLoader__ = { load: x => { module = x.factory(() => React); } };
await import('../client.js');
const root = createRoot(document.getElementById('root')), navigations = [];
const text = () => document.body.textContent;
const wait = async condition => {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    if (condition()) return;
  }
  throw new Error('DOM timeout: ' + text().slice(-1000));
};
const click = async label => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === label);
  assert.ok(button, label); await act(async () => button.click());
};
const change = async (element, value) => {
  await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value); element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
};
try {
  await act(async () => root.render(React.createElement(module.Panel, { openLibrary: (...args) => navigations.push(args) })));
  await wait(() => text().includes('当前没有记录'));
  await click('关联已有 SKU'); await wait(() => text().includes('关联产品库 SKU'));
  await change(document.querySelector('form select'), p.id);
  await change(document.querySelectorAll('form select')[1], 'red');
  await click('确认关联'); await wait(() => text().includes('TEST-RED') && !text().includes('确认关联'));
  const ledger = (await service.read('a', { entity: 'product' })).items[0];
  assert.equal(ledger.stockTotal, 0); assert.equal(ledger.unitPriceMinor, 1234);
  await click('Synthetic admin fixture'); await wait(() => text().includes('保存数量'));
  assert.ok(text().includes('适用数量 1 box'));
  await click('编辑商品、图片与资料'); assert.deepEqual(navigations.at(-1), ['product', p.id]);
  await service.write('a', { action: 'update_stock', requestId: 'stock', id: ledger.id, expectedRevision: 1, stockTotal: 5, source: 'Fixture only' });
  await service.write('a', { action: 'add_buyer', requestId: 'buyer', id: 'buyer', name: 'Test buyer', contact: 'test@example.test' });
  const order = await service.write('a', { action: 'reserve', requestId: 'reserve', productId: ledger.id, buyerId: 'buyer', expectedRevision: 2, expectedCatalogRevision: 1, quantity: 2 });
  await click('订单'); await wait(() => text().includes(order.id)); await click(order.id); await wait(() => text().includes('确认订单'));
  await click('确认订单'); await wait(() => text().includes('已确认'));
  assert.equal((await service.read('a', { entity: 'order', id: order.id })).status, 'confirmed');
  await change(document.querySelector('header select'), 'b'); await wait(() => text().includes('当前没有记录'));
  await click('资料与媒体'); assert.deepEqual(navigations.at(-1), ['documents']);
  console.log('OK: ERP DOM + real HTTP/SQLite/library binding, live quote, existing editor navigation, order confirmation and workspace isolation. Synthetic temporary data only.');
} finally {
  await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = nativeFetch;
  await new Promise(r => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true });
}
