// Real library/SQLite/HTTP services; temporary synthetic records, DOM host slots.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { LibraryStore, createLibraryService, createHttpHandler as createLibraryHttp } from '../../dsh-workspace-library/index.js';
import { ErpStore } from '../store.js';
import { createErpService } from '../catalog.js';
import { createHttpHandler } from '../http.js';
const dir = await mkdtemp(join(tmpdir(), 'erp-client-'));
const library = createLibraryService(new LibraryStore({ dir: join(dir, 'library') }));
const p = await library.saveProduct({ changes: { name: 'Synthetic admin fixture', skus: [{ id: 'red', code: 'TEST-RED', unit: 'box', moq: 1, pricingMode: 'tiered', priceTiers: [{ minQuantity: 1, unitPrice: '12.34', currency: 'USD' }] }] } });
const store = new ErpStore(join(dir, 'erp.sqlite'));
const service = createErpService(store, { library: () => library, registry: { list: () => [{ id: 'a', title: 'Fixture A' }, { id: 'b', title: 'Fixture B' }] } });
const auth = { authorize: r => r.headers.cookie === 'fixture=1' ? 0 : 401 };
const erpHttp = createHttpHandler(service, auth), libraryHttp = createLibraryHttp(library, auth);
const server = createServer((req, res) => (req.url.startsWith('/workspace-library-api/') ? libraryHttp : erpHttp)(req, res));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const dom = new JSDOM('<div id="root"></div>', { url: base });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) => nativeFetch(new URL(url, base), { ...options, headers: { ...options.headers, cookie: 'fixture=1', origin: base } });
const modules = new Map([['react', React]]);
window.__ModuleLoader__ = { load: x => modules.set(x.id, x.factory(name => modules.get(name))) };
await import('../../dsh-workspace-library/client.js');
await import('../client.js');
const module = modules.get('dsh-mini-erp');
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
  await wait(() => text().includes('把你的商品带到这里'));
  await click('关联已有 SKU'); await wait(() => text().includes('关联产品库 SKU'));
  await change(document.querySelector('form select'), p.id);
  await change(document.querySelectorAll('form select')[1], 'red');
  await click('确认关联'); await wait(() => text().includes('TEST-RED') && !text().includes('确认关联'));
  const ledger = (await service.read('a', { entity: 'product' })).items[0];
  assert.equal(ledger.stockTotal, 0); assert.equal(ledger.unitPriceMinor, 1234);
  await click('Synthetic admin fixture'); await wait(() => text().includes('保存数量'));
  assert.ok(text().includes('适用数量 1 box'));
  await click('编辑商品、图片与资料'); await wait(() => document.querySelector('.wl-admin-editor'));
  assert.equal(document.querySelector('.wl-product-identity input').value, p.name);
  assert.equal(document.querySelectorAll('.wl-admin-grid>.wl-admin-primary').length, 1);
  await act(async () => Simulate.change(document.querySelector('.wl-product-identity input'), { target: { value: 'Updated original product' } }));
  assert.ok(text().includes('有未保存的更改'));
  window.confirm = () => false; await click('订单');
  assert.ok(document.querySelector('.wl-admin-editor'), 'declining discard keeps the original draft');
  window.confirm = () => true;
  await click('保存商品'); await wait(() => !document.querySelector('.wl-admin-editor'));
  assert.equal((await library.product(p.id)).product.name, 'Updated original product');
  assert.equal((await service.read('a', { entity: 'product', id: ledger.id })).name, 'Updated original product');
  await wait(() => document.querySelector('[data-record-id]')?.textContent === 'Updated original product');
  await click('可供货'); assert.ok(text().includes('本页没有匹配的记录'));
  await click('全部'); assert.ok(text().includes('Updated original product'));
  await act(async () => Simulate.change(document.querySelector('input[type=search]'), { target: { value: 'no-match' } }));
  assert.ok(text().includes('本页没有匹配的记录'));
  await click('清除筛选'); assert.ok(text().includes('Updated original product'));
  await service.write('a', { action: 'update_stock', requestId: 'stock', id: ledger.id, expectedRevision: 1, stockTotal: 5, source: 'Fixture only' });
  await service.write('a', { action: 'add_buyer', requestId: 'buyer', id: 'buyer', name: 'Test buyer', contact: 'test@example.test' });
  const order = await service.write('a', { action: 'reserve', requestId: 'reserve', productId: ledger.id, buyerId: 'buyer', expectedRevision: 2, expectedCatalogRevision: 2, quantity: 2 });
  await click('订单'); await wait(() => document.querySelector(`[data-record-id="${order.id}"]`)); await click(`#${order.id.slice(0, 8)}`); await wait(() => text().includes('确认订单'));
  await click('确认订单'); await wait(() => document.querySelector('tbody .me-badge-confirmed'));
  assert.equal((await service.read('a', { entity: 'order', id: order.id })).status, 'confirmed');
  await change(document.querySelector('header select'), 'b'); await wait(() => text().includes('订单会从这里开始'));
  await click('资料与媒体'); assert.deepEqual(navigations.at(-1), ['documents']);
  console.log('OK: ERP DOM + real HTTP/SQLite/library binding, live quote, embedded original product editor/save, filters/search, order confirmation and workspace isolation. Synthetic temporary data only.');
} finally {
  await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = nativeFetch;
  await new Promise(r => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true });
}
