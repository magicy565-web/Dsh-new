// Real library/SQLite/HTTP services; temporary synthetic records, DOM host slots.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { LibraryStore, createLibraryService, createHttpHandler as createLibraryHttp } from '../../dsh-workspace-library/index.js';
import { ErpStore } from '../store.js';
import { createErpService } from '../catalog.js';
import { createHttpHandler } from '../http.js';
const dir = await mkdtemp(join(tmpdir(), 'erp-client-'));
const objects = new Map();
const library = createLibraryService(new LibraryStore({ dir: join(dir, 'library') }), { attachments: {
  async saveFile({data, name}) { const attachmentId = 'sha256:' + createHash('sha256').update(data).digest('hex'); objects.set(attachmentId, Buffer.from(data)); return {attachmentId, name, bytes:data.byteLength}; },
  async *readFileStream(ref) { yield objects.get(ref.attachmentId); }
} });
for (let i = 0; i < 52; i++) await library.saveProduct({changes:{name:`Index fixture ${String(i).padStart(2, '0')}`}});
const p = await library.saveProduct({ changes: { name: 'Synthetic admin fixture', skus: [{ id: 'red', code: 'TEST-RED', unit: 'box', moq: 2, pricingMode: 'tiered', priceTiers: [{ minQuantity: 1, unitPrice: '12.34', currency: 'USD' }, { minQuantity: 3, unitPrice: '10.00', currency: 'USD' }] }] } });
const store = new ErpStore(join(dir, 'erp.sqlite'));
const service = createErpService(store, { library: () => library, registry: { list: () => [{ id: 'a', title: 'Fixture A' }, { id: 'b', title: 'Fixture B' }] } });
const auth = { authorize: r => r.headers.cookie === 'fixture=1' ? 0 : 401 };
const erpHttp = createHttpHandler(service, auth), libraryHttp = createLibraryHttp(library, auth);
const server = createServer((req, res) => (req.url.startsWith('/workspace-library-api/') ? libraryHttp : erpHttp)(req, res));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const dom = new JSDOM('<div id="root"></div>', { url: base });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, FileReader: dom.window.FileReader });
const {createRoot} = await import('react-dom/client');
const {Simulate} = await import('react-dom/test-utils');
const nativeFetch = globalThis.fetch;
let failSearch = false;
globalThis.fetch = (url, options = {}) => {
  if (failSearch && String(url).includes('/search?')) return Promise.resolve(new Response(JSON.stringify({error:'Fixture search failure'}), {status:503}));
  return nativeFetch(new URL(url, base), {...options, headers:{...options.headers, cookie:'fixture=1', origin:base}});
};
Object.assign(globalThis, { getComputedStyle: dom.window.getComputedStyle, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, HTMLInputElement: dom.window.HTMLInputElement, CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
const modules = new Map([['react', React], ['react-dom', await import('react-dom')], ['react/jsx-runtime', await import('react/jsx-runtime')]]);
window.__ModuleLoader__ = { load: x => modules.set(x.id, x.factory(name => modules.get(name))) };
await import('../../dsh-workspace-library/client.js');
await import('../client.js');
const module = modules.get('dsh-mini-erp');
const root = createRoot(document.getElementById('root')), navigations = [];
const text = () => document.body.textContent;
window.confirm = () => { throw new Error('ERP must use its themed discard dialog'); };
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
const input = async (name, value) => act(async () => Simulate.change(document.querySelector(`[name="${name}"]`), { target: { value } }));
const change = async (element, value) => {
  await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value); element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
};

const route = async page => {
  await act(async () => { const url = new URL(window.location.href); url.searchParams.set('erp_page', page); window.history.pushState({}, '', url); window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
  await wait(() => document.querySelector('.me h1') && !document.querySelector('.me-loading'));
};
const edit = async (element, value) => { assert.ok(element); await act(async () => Simulate.change(element, {target:{value}})); };
const labeled = label => [...document.querySelectorAll('.wl-field')].find(e => e.querySelector('label')?.textContent === label)?.querySelector('input,textarea');
const key = async value => act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:value,bubbles:true})));
try {
  await service.write('a', {action:'add_buyer',requestId:'customer-a',id:'customer-a',name:'Search customer A',contact:'Legacy contact text',email:'a@example.test'});
  await service.write('b', {action:'add_buyer',requestId:'customer-b',id:'customer-b',name:'Search customer B',email:'b@example.test'});
  await act(async () => root.render(React.createElement(module.Panel)));
  await wait(() => text().includes('准备好开展业务'));
  await click('商品'); await wait(() => document.querySelectorAll('[data-catalog-record]').length === 50);
  await act(async () => document.querySelector('tbody input[type=checkbox]').click());
  assert.equal(document.querySelector('[aria-label="选择本页全部"]').indeterminate,true);
  await click('取消选择'); assert.equal(document.querySelector('[aria-label="选择本页全部"]').indeterminate,false);
  await act(async () => document.querySelector('[aria-label=下一页]').click());
  await wait(() => document.querySelectorAll('[data-catalog-record]').length === 3);
  await edit(document.querySelector('[aria-label=搜索所有商品]'), p.name);
  await wait(() => document.querySelectorAll('[data-catalog-record]').length === 1);
  assert.ok(text().includes('第 1 页'));
  let exported; const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL, anchorClick = dom.window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => {exported=blob; return 'blob:fixture';}; URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  try {
    await act(async () => document.querySelector('[aria-label="选择本页全部"]').click());
    await click('导出所选'); assert.match(await exported.text(), /Synthetic admin fixture/);
    module.csvFile('fixture.csv', ['value'], [[' =2+3'],['a,"b\nc']]);
    assert.match(await exported.text(), /"' =2\+3"/); assert.match(await exported.text(), /a,""b/);
  } finally { URL.createObjectURL=createUrl; URL.revokeObjectURL=revokeUrl; dom.window.HTMLAnchorElement.prototype.click=anchorClick; }
  await act(async () => document.querySelector('[aria-label="清除列表搜索"]').click());
  assert.equal(document.activeElement.getAttribute('aria-label'),'搜索所有商品');
  await wait(() => document.querySelectorAll('[data-catalog-record]').length === 50);
  // Dirty forms are preserved on cancel/Escape and never written by discard.
  await click('添加商品'); await wait(() => document.querySelector('.wl-product-identity input'));
  const draftName = document.querySelector('.wl-product-identity input');
  await edit(draftName, 'Unsaved product');
  const targetNav = document.querySelector('[data-admin-page=orders]'); targetNav.focus();
  await click('订单'); await wait(() => document.querySelector('[role=alertdialog]'));
  assert.equal(document.querySelector('[role=alertdialog]').closest('.me'), document.querySelector('.me'));
  assert.equal(document.activeElement.textContent, '继续编辑', 'cancel receives initial focus');
  assert.equal(document.querySelector('[role=alertdialog]').getAttribute('aria-modal'), 'true');
  await key('Escape'); await wait(() => !document.querySelector('[role=alertdialog]'));
  assert.equal(draftName.value, 'Unsaved product');
  await wait(() => document.activeElement === targetNav);
  assert.equal(document.body.style.pointerEvents, '', 'modal restores host interactions');
  // A workspace change waits for the answer, and cancellation retains the current scope.
  await edit(document.querySelector('[aria-label="经营工作区"]'), 'b');
  await wait(() => document.querySelector('[role=alertdialog]'));
  assert.equal(document.querySelector('[aria-label="经营工作区"]').value, 'a');
  await click('继续编辑'); assert.equal(document.querySelector('[aria-label="经营工作区"]').value, 'a');
  // While waiting, a second navigation cannot inherit approval for the first.
  await click('订单'); await wait(() => document.querySelector('[role=alertdialog]'));
  await click('客户'); await click('放弃更改');
  await wait(() => document.querySelector('.me h1')?.textContent === '订单');
  assert.equal((await library.products({q:'Unsaved product'})).items.length, 0);
  await route('products'); await click('添加商品'); await wait(() => document.querySelector('.wl-product-identity input'));
  await edit(document.querySelector('.wl-product-identity input'), 'Back navigation draft');
  // Browser history and the displayed form stay aligned while the prompt is open.
  const url = new URL(window.location.href); url.searchParams.set('erp_page', 'customers');
  await act(async () => { window.history.pushState({}, '', url); window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
  await wait(() => document.querySelector('[role=alertdialog]'));
  assert.equal(new URL(window.location.href).searchParams.get('erp_page'), 'products');
  await click('继续编辑'); assert.equal(document.querySelector('.wl-product-identity input').value, 'Back navigation draft');
  await act(async () => { window.history.replaceState({}, '', url); window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
  await wait(() => document.querySelector('[role=alertdialog]')); await click('放弃更改');
  await wait(() => document.querySelector('.me h1')?.textContent === '客户');
  assert.equal(new URL(window.location.href).searchParams.get('erp_page'), 'customers');
  await route('files'); await click('上传文件'); await wait(() => document.querySelector('input[type=file]'));
  await edit(labeled('文档标题'), 'Uploaded fixture');
  const bytes = 'Real bytes in temporary test storage';
  const file = new dom.window.File([bytes], 'fixture.txt', {type:'text/plain'});
  await act(async () => Simulate.change(document.querySelector('input[type=file]'), {target:{files:[file]}}));
  await click('订单'); await wait(() => document.querySelector('[role=alertdialog]')); await click('继续编辑'); assert.ok(document.querySelector('input[type=file]'), 'dirty file protects navigation');
  await act(async () => Simulate.submit(document.querySelector('.wl-editor')));
  await wait(() => text().includes('版本历史'));
  const doc = (await library.documents({})).items[0];
  assert.equal(doc.title, 'Uploaded fixture'); assert.equal(objects.size, 1);
  assert.equal([...objects.values()][0].toString(),bytes);
  assert.equal(text().includes('本版本审核'),false);
  await click('编辑资料信息'); await wait(() => labeled('文档标题'));
  await click('取消'); await wait(() => text().includes('版本历史')); assert.equal(document.querySelector('[role=alertdialog]'), null);
  await click('编辑资料信息'); await edit(labeled('文档标题'),'Unsaved change');
  await click('取消'); await wait(() => document.querySelector('[role=alertdialog]')); await click('继续编辑'); assert.ok(labeled('文档标题'));
  await edit(labeled('文档标题'), 'Renamed fixture');
  await act(async () => Simulate.submit(document.querySelector('.wl-editor')));
  await wait(() => text().includes('Renamed fixture') && text().includes('版本历史'));
  assert.equal((await library.document(doc.id)).document.title,'Renamed fixture');
  await click('编辑资料信息'); await edit(labeled('文档标题'), 'Discarded metadata');
  await click('取消'); await wait(() => document.querySelector('[role=alertdialog]')); await click('放弃更改');
  await wait(() => text().includes('版本历史') && !labeled('文档标题'));
  assert.equal((await library.document(doc.id)).document.title, 'Renamed fixture');
  await click('添加新版本'); await wait(() => document.querySelector('input[type=file]'));
  await act(async () => Simulate.change(document.querySelector('input[type=file]'), {target:{files:[new dom.window.File(['discarded'], 'discard.txt', {type:'text/plain'})]}}));
  await click('取消'); await wait(() => document.querySelector('[role=alertdialog]')); await click('继续编辑');
  assert.ok(document.querySelector('input[type=file]'));
  await click('取消'); await wait(() => document.querySelector('[role=alertdialog]')); await click('放弃更改');
  await wait(() => text().includes('版本历史'));
  assert.equal((await library.document(doc.id)).document.versions.length, 1);
  await click('添加新版本'); await wait(() => document.querySelector('input[type=file]'));
  await act(async () => Simulate.change(document.querySelector('input[type=file]'), {target:{files:[new dom.window.File(['Version two'], 'second.txt', {type:'text/plain'})]}}));
  await act(async () => Simulate.submit(document.querySelector('.wl-editor')));
  await wait(() => text().includes('当前 v2'));
  const current = (await library.document(doc.id)).document;
  assert.equal(current.versions.length,2); assert.equal(objects.size,2);
  exported=null; URL.createObjectURL=blob=>{exported=blob;return 'blob:fixture';}; URL.revokeObjectURL=()=>{}; dom.window.HTMLAnchorElement.prototype.click=()=>{};
  try { await click('下载'); await wait(()=>exported); assert.ok(['Version two',bytes].includes(await exported.text())); }
  finally {URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;dom.window.HTMLAnchorElement.prototype.click=anchorClick;}
  await route('store_details'); await wait(() => labeled('展示名称'));
  await edit(labeled('展示名称'),'Test store');
  await click('商品'); await wait(() => document.querySelector('[role=alertdialog]')); await click('继续编辑'); assert.ok(labeled('展示名称'));
  await act(async () => Simulate.submit(document.querySelector('.wl-form')));
  await wait(() => text().includes('店铺资料已保存'));
  assert.equal((await library.company()).displayName,'Test store');
  await route('customers'); await wait(() => document.querySelector('[data-record-id]'));
  await edit(document.querySelector('input[type=search]'), 'Legacy contact');
  await wait(() => document.querySelector('[data-record-id]')?.textContent === 'Search customer A');
  await route('home'); await act(async () => document.querySelector('.me-global-search').click());
  const searchInput=document.querySelector('[role=combobox]');
  await key('ArrowDown'); assert.equal(document.activeElement,searchInput);
  assert.equal(searchInput.getAttribute('aria-activedescendant'),'me-search-option-1');
  await edit(searchInput, 'Search customer');
  assert.equal(document.querySelector('[role=option]'),null,'stale choices cannot be selected while query settles');
  await wait(() => text().includes('Search customer A')); assert.equal(text().includes('Search customer B'), false);
  await act(async () => searchInput.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true})));
  assert.ok(document.querySelector('.me-command-dialog'),'IME Enter must not navigate');
  await key('ArrowDown'); assert.equal(document.activeElement,searchInput);
  await key('Enter'); await wait(() => text().includes('编辑客户'));
  assert.ok(text().includes('a@example.test'));
  await act(async () => document.querySelector('.me-global-search').click());
  failSearch=true; await edit(document.querySelector('[aria-label=搜索后台] input'),'Renamed');
  await wait(() => text().includes('部分来源读取失败')); failSearch=false;
  await click('重新搜索');
  await wait(() => text().includes('Renamed fixture文件'));
  await click('Renamed fixture文件'); await wait(() => text().includes('当前 v2'));
  await act(async () => {document.querySelector('.me-global-search').focus(); document.querySelector('.me-global-search').click();});
  await edit(document.querySelector('[role=combobox]'),'xxxxxxxx');
  await wait(() => text().includes('没有找到匹配结果'));
  await act(async () => document.querySelector('[aria-label=清除搜索]').click());
  assert.equal(document.activeElement.getAttribute('role'),'combobox');assert.equal(document.activeElement.value,'');
  await key('Escape'); await wait(() => document.activeElement.classList.contains('me-global-search'));
  await route('appearance'); await edit(document.querySelector('[name=appearance]'),'dark');
  await edit(document.querySelector('[name=density]'),'compact');
  await act(async () => root.render(null)); await act(async () => root.render(React.createElement(module.Panel)));
  await wait(() => document.querySelector('[name=appearance]'));
  assert.equal(document.querySelector('[name=appearance]').value,'dark'); assert.equal(document.querySelector('[name=density]').value,'compact');
  await route('marketing'); await route('payments');
  await act(async () => window.history.back()); await wait(() => document.querySelector('.me h1')?.textContent === '营销');
  console.log('OK: full admin catalog paging/search/export, formula-safe CSV, file bytes/upload/metadata/version/download, original company save, dirty guards, global search workspace isolation and partial failure, navigation history and persisted appearance. Temporary fixtures only.');
} finally {
  await act(async () => root.unmount()); dom.window.close(); globalThis.fetch=nativeFetch;
  await new Promise(r=>server.close(r)); store.close(); await rm(dir,{recursive:true,force:true});
}
