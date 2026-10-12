import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';
import { retiredSupplyComponentScript } from './fixtures/retired-supply-component.mjs';

// Current Library routes use the production App bundle and original HTTP/Store.
// The seven retired Supply panel contracts use its real component in a separate
// write:false test bundle. This does not make the old /commerce page reachable.
// Library products are internal drafts, not published supplier/listing entities;
// persistent Supply retries and public consent are not claimed as Library features.
// jsdom is DOM acceptance, not visual/browser/PersonalAgent acceptance. Faults
// below alter only the test client's transport, including after real commits.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-supply-ui-'));
  const options = { dataDirectory: directory, capabilityEnvironment: {}, provider: { configured: false, complete: async () => { throw Error('Model must not run'); } } };
  let app = await createApp(options), address = await app.listen(0);
  let lostResponse, failedRead, viewerSession = false;
  const requests = [], windows = [];
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/.test(name))), 'utf8');
  const url = path => `http://127.0.0.1:${address.port}${path}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(url(path.startsWith('/api/') ? path : `/api/supply${path}`), { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  }
  async function render(storage = [], route) {
    const retiredComponent = route === undefined;
    const source = retiredComponent ? await retiredSupplyComponentScript() : script;
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: url(route || '/__test__/retired-supply-component'), runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom; windows.push(window);
    Object.defineProperty(window, 'crypto', { value: webcrypto });
    window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
    window.AbortController = AbortController; window.scrollTo = () => {}; window.confirm = () => true;
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    for (const [key, value] of storage) window.sessionStorage.setItem(key, value);
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.fetch = async (path, init = {}) => {
      const method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path: String(path), method, body });
      if (path === failedRead && method === 'GET') { failedRead = undefined; return new Response(JSON.stringify({ error: { code: 'TEST_READ_UNAVAILABLE', message: '读取暂不可用，请重试。' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
      const response = await fetch(new URL(path, url('/')), init);
      if (viewerSession && path === '/api/session') { const original = await response.json(); return new Response(JSON.stringify({ ...original, mode: 'enterprise', authenticated: true, user: { id: 'fixture-viewer', role: 'viewer' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
      if (method === 'POST' && path === lostResponse) { lostResponse = undefined; assert.equal(response.status, 201); await response.arrayBuffer(); throw Error('Test client lost committed response'); }
      return response;
    };
    window.eval(source);
    await wait(() => window.document.querySelector(retiredComponent ? '.supply-network' : '.business-library'), retiredComponent ? 'mounted retired Supply component contract' : 'mounted current original Library route');
    return { window, document: window.document, errors, storage: () => Array.from({ length: window.sessionStorage.length }, (_, i) => { const key = window.sessionStorage.key(i); return [key, window.sessionStorage.getItem(key)]; }) };
  }
  async function seed() {
    const supplier = (await request('/suppliers', 'POST', { requestId: randomUUID(), displayName: 'Fixture Supplier', country: 'China', website: 'https://supplier.example' })).supplier;
    const listing = (await request('/listings', 'POST', { requestId: randomUUID(), supplierId: supplier.id, title: 'Fixture Cotton', sku: 'TEST-1', unitPrice: '2.40', currency: 'USD', moq: 500, leadDays: 28, incoterm: 'FOB', details: 'Test-only cotton specification' })).listing;
    return { supplier, listing };
  }
  t.after(async () => { for (const window of windows) window.close(); await app.close(); assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'workspace-supply-ui-')))); await rm(directory, { recursive: true, force: true }); });
  return { render, renderLibrary: (route = '/library/products', storage = []) => render(storage, route), request, seed, requests, loseNextResponse(path = '/api/supply/suppliers') { lostResponse = path; }, failNextRead(path = '/api/supply/listings') { failedRead = path; }, useViewerSession() { viewerSession = true; }, async restart() { await app.close(); app = await createApp(options); address = await app.listen(0); } };
}
async function wait(check, message) { for (let i = 0; i < 240; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } throw Error(`Timed out: ${message}`); }
function button(ui, text, root = ui.document.querySelector('.supply-network')) { return [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text); }
async function click(ui, element) { assert.ok(element, 'Expected UI control'); assert.equal(element.disabled, false, 'Expected enabled UI control'); element.click(); await new Promise(r => ui.window.setTimeout(r, 0)); }
async function input(ui, form, labelText, value) {
  const label = [...form.querySelectorAll('label')].find(item => item.textContent.startsWith(labelText)); assert.ok(label, labelText);
  const element = label.querySelector('input,select,textarea'); assert.equal(element.disabled, false);
  const proto = element.tagName === 'SELECT' ? ui.window.HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? ui.window.HTMLTextAreaElement.prototype : ui.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new ui.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await new Promise(r => ui.window.setTimeout(r, 0));
}
async function submit(ui, form) { form.dispatchEvent(new ui.window.Event('submit', { bubbles: true, cancelable: true })); await new Promise(r => ui.window.setTimeout(r, 0)); }
const forms = ui => ui.document.querySelectorAll('.supply-form');

test('retired Supply component contract: saves supplier/product, edits, and recovers from original durable Store restart', async t => {
  const f = await fixture(t), ui = await f.render(); await wait(() => button(ui, '新建') && !button(ui, '新建').disabled, 'loaded catalog');
  await click(ui, button(ui, '新建')); let form = forms(ui)[0]; await input(ui, form, '企业名称', 'Fixture Factory'); await input(ui, form, '国家 / 地区', 'China'); await submit(ui, form);
  await wait(() => ui.document.querySelector('.supply-row strong')?.textContent === 'Fixture Factory', 'supplier saved');
  await click(ui, button(ui, '新增商品')); form = forms(ui)[0]; const supplier = (await f.request('/suppliers')).suppliers[0];
  for (const [label, value] of [['所属供应商', supplier.id], ['商品名称', 'Fixture Tee'], ['SKU', 'T-1'], ['参考单价', '2.40']]) await input(ui, form, label, value);
  await submit(ui, form); await wait(() => button(ui, '修改'), 'product saved');
  let listing = (await f.request('/listings')).listings[0]; assert.equal(listing.published, false); assert.equal(listing.unitPrice, '2.40');
  await click(ui, button(ui, '修改')); form = forms(ui)[0]; await input(ui, form, '参考单价', '2.60'); await submit(ui, form);
  await wait(async () => (await f.request('/listings')).listings[0].revision === 2, 'edit durable');
  await wait(() => !forms(ui).length, 'saved editor closes'); ui.window.close(); await f.restart(); const reopened = await f.render();
  await wait(() => reopened.document.body.textContent.includes('USD 2.60'), 'records restored after fresh UI and original Store reopen');
  assert.equal((await f.request('/listings')).listings.length, 1); assert.deepEqual(reopened.errors, []);
});

test('retired Supply component contract: pins edit revision, preserves conflicting input across reload, and requires explicit new revision', async t => {
  const f = await fixture(t), { listing } = await f.seed(), ui = await f.render(); await wait(() => button(ui, '修改') && !button(ui, '修改').disabled, 'loaded seeded listing');
  await click(ui, button(ui, '修改')); let form = forms(ui)[0]; await input(ui, form, '参考单价', '2.70');
  await f.request(`/listings/${listing.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, unitPrice: '3.10' });
  await submit(ui, form); await wait(() => ui.document.body.textContent.includes('资料已有新版本'), 'actual server revision conflict');
  assert.equal(form.querySelector('input').value, '2.70'); assert.equal(f.requests.find(item => item.method === 'PATCH').body.expectedRevision, 1);
  await click(ui, button(ui, '读取最新资料')); await wait(() => button(ui, '使用最新条件重新编辑'), 'latest server revision comparison');
  form = forms(ui)[0];
  assert.equal(form.querySelector('input').value, '2.70'); assert.ok(form.textContent.includes('编辑基于修订 1'));
  await submit(ui, form); await wait(() => f.requests.filter(item => item.method === 'PATCH').length === 2, 'second attempt');
  assert.equal(f.requests.filter(item => item.method === 'PATCH')[1].body.expectedRevision, 1, 'reading must not rebase stale edits');
  await wait(() => !button(ui, '使用最新条件重新编辑').disabled, 'definite second conflict preserves input');
  await click(ui, button(ui, '使用最新条件重新编辑')); form = forms(ui)[0]; assert.equal(form.querySelector('input').value, '3.10'); await input(ui, form, '参考单价', '3.20'); await submit(ui, form);
  await wait(async () => (await f.request('/listings')).listings[0].unitPrice === '3.20', 'explicit new edit saved');
  assert.equal(f.requests.filter(item => item.method === 'PATCH').at(-1).body.expectedRevision, 2); assert.deepEqual(ui.errors, []);
});

test('retired Supply component contract: restores unknown committed command after refresh and retries exact request without duplicates', async t => {
  const f = await fixture(t), ui = await f.render(); await wait(() => button(ui, '新建') && !button(ui, '新建').disabled, 'catalog ready');
  await click(ui, button(ui, '新建')); const form = forms(ui)[0]; await input(ui, form, '企业名称', 'Fixture Lost Response'); await input(ui, form, '国家 / 地区', 'China');
  f.loseNextResponse(); await submit(ui, form); await wait(() => button(ui, '核对原请求结果'), 'unknown commit');
  assert.ok([...form.querySelectorAll('input')].every(element => element.disabled)); assert.equal((await f.request('/suppliers')).suppliers.length, 1);
  const stored = ui.storage(), pending = stored.filter(([key]) => key.startsWith('workspace.supply.pending.v1:')); assert.equal(pending.length, 1); assert.doesNotMatch(JSON.stringify(pending), /csrfToken|Authorization|Bearer/);
  const first = f.requests.find(item => item.method === 'POST' && item.path === '/api/supply/suppliers'); ui.window.close(); const reopened = await f.render(stored);
  await wait(() => button(reopened, '核对原请求结果'), 'pending restore without automatic replay'); assert.equal(f.requests.filter(item => item.method === 'POST' && item.path === '/api/supply/suppliers').length, 1);
  await click(reopened, button(reopened, '核对原请求结果')); await wait(() => !reopened.document.body.textContent.includes('保存结果待确认'), 'original command confirmed');
  const attempts = f.requests.filter(item => item.method === 'POST' && item.path === '/api/supply/suppliers'); assert.equal(attempts.length, 2); assert.deepEqual(attempts[1].body, first.body);
  assert.equal((await f.request('/suppliers')).suppliers.length, 1); assert.equal(reopened.storage().filter(([key]) => key.startsWith('workspace.supply.pending.v1:')).length, 0); assert.deepEqual(reopened.errors, []);
});

test('retired Supply component contract: reports unsaved edits and clears its dirty callback when unmounted', async t => {
  const f = await fixture(t), ui = await f.render(); await wait(() => button(ui, '新建') && !button(ui, '新建').disabled, 'catalog ready');
  await click(ui, button(ui, '新建')); await input(ui, forms(ui)[0], '企业名称', 'Unsaved fixture');
  await wait(() => ui.window.__retiredSupplyDirty === true, 'original component reports unsaved input to its parent');
  assert.equal(forms(ui)[0].querySelector('input').value, 'Unsaved fixture'); assert.equal((await f.request('/suppliers')).suppliers.length, 0);
  ui.window.__unmountRetiredSupply();
  assert.equal(ui.window.__retiredSupplyDirty, false, 'component cleanup releases the original dirty source');
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.deepEqual(ui.errors, []);
});

test('retired Supply component contract: exposes read failures, disables invalid writes, and reloads real data', async t => {
  const f = await fixture(t); await f.seed(); f.failNextRead(); const ui = await f.render();
  await wait(() => ui.document.body.textContent.includes('读取暂不可用'), 'read failure shown'); assert.equal(button(ui, '新增商品').disabled, true);
  await click(ui, button(ui, '重试读取')); await wait(() => button(ui, '修改') && !button(ui, '修改').disabled, 'real API retry');
  assert.ok(ui.document.body.textContent.includes('Fixture Cotton')); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.deepEqual(ui.errors, []);
});

test('retired Supply component contract: never adopts another role scope pending command or mutates through viewer controls', async t => {
  const f = await fixture(t), ui = await f.render(); await wait(() => button(ui, '新建') && !button(ui, '新建').disabled, 'local admin catalog');
  await click(ui, button(ui, '新建')); await input(ui, forms(ui)[0], '企业名称', 'Scoped fixture'); await input(ui, forms(ui)[0], '国家 / 地区', 'China'); f.loseNextResponse(); await submit(ui, forms(ui)[0]); await wait(() => button(ui, '核对原请求结果'), 'scoped pending');
  const stored = ui.storage(), count = f.requests.filter(item => item.method === 'POST').length; ui.window.close(); f.useViewerSession(); const viewer = await f.render(stored);
  await wait(() => button(viewer, '新增商品'), 'viewer catalog'); assert.equal(button(viewer, '新增商品').disabled, true); assert.equal(button(viewer, '新建'), undefined); assert.equal(button(viewer, '核对原请求结果'), undefined);
  assert.equal(f.requests.filter(item => item.method === 'POST').length, count); assert.deepEqual(viewer.errors, []);
});

test('retired Supply component contract: publishes only after explicit confirmation of exact supplier and listing revision', async t => {
  const f = await fixture(t), { supplier, listing } = await f.seed(), ui = await f.render();
  const row = title => [...ui.document.querySelectorAll('.supply-row')].find(item => item.querySelector('strong')?.textContent === title);
  await wait(() => row(supplier.displayName) && !button(ui, '确认公开', row(supplier.displayName)).disabled, 'private records loaded');
  const confirmations = []; let consent = false;
  ui.window.confirm = message => { confirmations.push(message); return consent; };
  await click(ui, button(ui, '确认公开', row(supplier.displayName)));
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0);
  assert.equal((await f.request('/suppliers')).suppliers[0].published, false);
  consent = true; await click(ui, button(ui, '确认公开', row(supplier.displayName)));
  await wait(() => button(ui, '停止公开', row(supplier.displayName)), 'supplier publication refreshed');
  const supplierWrite = f.requests.find(item => item.path === `/api/supply/suppliers/${supplier.id}/publish`);
  assert.equal(supplierWrite.body.expectedRevision, supplier.revision); assert.equal(supplierWrite.body.confirmed, true);
  assert.ok(confirmations[1].includes('China')); assert.ok(confirmations[1].includes('https://supplier.example'));
  await wait(() => !button(ui, '确认公开', row(listing.title)).disabled, 'listing ready');
  consent = false; await click(ui, button(ui, '确认公开', row(listing.title)));
  assert.equal(f.requests.filter(item => item.path === `/api/supply/listings/${listing.id}/publish`).length, 0);
  consent = true; await click(ui, button(ui, '确认公开', row(listing.title)));
  await wait(() => button(ui, '停止公开', row(listing.title)), 'listing publication refreshed');
  const listingWrite = f.requests.find(item => item.path === `/api/supply/listings/${listing.id}/publish`);
  assert.equal(listingWrite.body.expectedRevision, listing.revision); assert.equal(listingWrite.body.confirmed, true);
  for (const value of ['Fixture Cotton', '修订 1', 'SKU TEST-1', 'USD 2.40', 'MOQ 500', 'FOB', '28 天', 'Test-only cotton specification']) assert.ok(confirmations.at(-1).includes(value), value);
  assert.equal((await f.request('/inquiries')).inquiries.length, 0);
  assert.ok(f.requests.every(item => !/muse-delegations|worker-a2a|dispatch/.test(item.path))); assert.deepEqual(ui.errors, []);
});

const libraryButton = (ui, label) => button(ui, label, ui.document);
const productInput = (ui, label) => ui.document.querySelector(`[aria-label="${label}"]`);
const libraryProduct = async (f, name = 'Current Library Fixture') => (await f.request('/api/library/products', 'POST', { requestId: randomUUID(), name })).product;
const currentProduct = async (f, id) => (await f.request(`/api/library/products/${id}`)).product;

test('current Library UI creates private product facts, edits an exact revision and restores durable internal data', async t => {
  const f = await fixture(t), ui = await f.renderLibrary();
  await click(ui, libraryButton(ui, '新建产品')); await wait(() => ui.document.querySelector('.bl-editor'), 'current product editor');
  let form = ui.document.querySelector('.bl-editor'); await input(ui, form, '产品名称', 'Private Library Fixture');
  await click(ui, libraryButton(ui, '添加 SKU'));
  for (const [label, value] of [['SKU 编码', 'LIB-1'], ['计量单位', 'piece'], ['最小起订量', '10'], ['报价方式', 'tiered']]) await input(ui, form, label, value);
  await click(ui, libraryButton(ui, '添加价格阶梯'));
  for (const [label, value] of [['单价', '2.40'], ['币种', 'USD'], ['付款条件', 'INTERNAL_PAYMENT_FIXTURE']]) await input(ui, form, label, value);
  await submit(ui, form); await wait(() => libraryButton(ui, '编辑产品'), 'private draft saved');
  let products = (await f.request('/api/library/products')).items; assert.equal(products.length, 1);
  const id = products[0].id;
  assert.equal(products[0].status, 'draft'); assert.equal(products[0].revision, 1); assert.equal(products[0].skus[0].priceTiers[0].unitPrice, '2.40');
  assert.equal(products[0].supply.paymentTerms, 'INTERNAL_PAYMENT_FIXTURE'); assert.equal(Object.hasOwn(products[0], 'published'), false);
  assert.equal(libraryButton(ui, '确认公开'), undefined); assert.deepEqual((await f.request('/public')).items, []);
  await click(ui, libraryButton(ui, '编辑产品')); await wait(() => ui.document.querySelector('.bl-editor'), 'edit saved original Library product');
  form = ui.document.querySelector('.bl-editor'); await input(ui, form, '单价', '2.60'); await submit(ui, form);
  await wait(() => libraryButton(ui, '编辑产品'), 'edited revision saved');
  assert.equal(f.requests.find(item => item.method === 'PATCH').body.expectedRevision, 1);
  ui.window.close(); await f.restart(); const reopened = await f.renderLibrary(`/library/products/${id}`);
  await wait(() => libraryButton(reopened, '编辑产品'), 'fresh UI reads reopened original Store');
  const product = await currentProduct(f, id); assert.equal(product.revision, 2); assert.equal(product.status, 'draft');
  assert.equal(product.skus[0].priceTiers[0].unitPrice, '2.60'); assert.equal(product.supply.paymentTerms, 'INTERNAL_PAYMENT_FIXTURE');
  assert.deepEqual((await f.request('/public')).items, []); assert.equal((await f.request('/suppliers')).suppliers.length, 0); assert.equal((await f.request('/listings')).listings.length, 0);
  assert.ok(f.requests.every(item => !/\/publish|muse-delegations|worker-a2a|dispatch/.test(item.path)));
  assert.deepEqual(ui.errors, []); assert.deepEqual(reopened.errors, []);
});

test('current Library UI keeps the edited revision and typed input through conflicts until explicit reload', async t => {
  const f = await fixture(t), product = await libraryProduct(f), ui = await f.renderLibrary(`/library/products/${product.id}/edit`);
  await wait(() => ui.document.querySelector('.bl-editor'), 'original product revision loaded');
  await input(ui, ui.document.querySelector('.bl-editor'), '产品简介', 'Unsaved exact revision fixture');
  await f.request(`/api/library/products/${product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, changes: { description: 'Concurrent fixture revision' } });
  await submit(ui, ui.document.querySelector('.bl-editor')); await wait(() => libraryButton(ui, '放弃本地输入并读取最新版本'), 'real revision conflict visible');
  assert.equal(productInput(ui, '产品简介').value, 'Unsaved exact revision fixture');
  await submit(ui, ui.document.querySelector('.bl-editor'));
  await wait(() => f.requests.filter(item => item.method === 'PATCH').length === 2 && libraryButton(ui, '保存产品')?.disabled === false, 'second definite conflict');
  assert.ok(f.requests.filter(item => item.method === 'PATCH').every(item => item.body.expectedRevision === 1));
  assert.equal(productInput(ui, '产品简介').value, 'Unsaved exact revision fixture');
  await click(ui, libraryButton(ui, '放弃本地输入并读取最新版本'));
  await wait(() => productInput(ui, '产品简介')?.value === 'Concurrent fixture revision', 'only explicit discard adopts current revision');
  await input(ui, ui.document.querySelector('.bl-editor'), '产品简介', 'Explicit new revision fixture'); await submit(ui, ui.document.querySelector('.bl-editor'));
  await wait(() => libraryButton(ui, '编辑产品'), 'explicit new edit committed');
  assert.equal(f.requests.filter(item => item.method === 'PATCH').at(-1).body.expectedRevision, 2);
  assert.equal((await currentProduct(f, product.id)).revision, 3); assert.deepEqual(ui.errors, []);
});

test('current Library UI retries an unknown commit in the same editor with its original request and no duplicate', async t => {
  const f = await fixture(t), ui = await f.renderLibrary('/library/products/new');
  await wait(() => ui.document.querySelector('.bl-editor'), 'current product creation form');
  await input(ui, ui.document.querySelector('.bl-editor'), '产品名称', 'Current Request Retry Fixture');
  f.loseNextResponse('/api/library/products'); await submit(ui, ui.document.querySelector('.bl-editor'));
  await wait(() => libraryButton(ui, '重试原保存请求'), 'committed response loss stays explicit');
  assert.equal(productInput(ui, '产品名称').matches(':disabled'), true);
  assert.equal((await f.request('/api/library/products')).items.length, 1);
  assert.equal(f.requests.filter(item => item.method === 'POST' && item.path === '/api/library/products').length, 1);
  await click(ui, libraryButton(ui, '重试原保存请求')); await wait(() => libraryButton(ui, '编辑产品'), 'same pending request reconciled');
  const attempts = f.requests.filter(item => item.method === 'POST' && item.path === '/api/library/products');
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[1].body, attempts[0].body);
  assert.equal((await f.request('/api/library/products')).items.length, 1); assert.deepEqual(ui.errors, []);
  // ProductEditor uses in-memory useWrite(); this test does not claim pending
  // recovery after reload, which remains specific to the retired Supply panel.
});

test('current Library UI uses the original App dirty navigation and beforeunload guard', async t => {
  const f = await fixture(t), ui = await f.renderLibrary('/library/products/new');
  await wait(() => ui.document.querySelector('.bl-editor'), 'current Library editor mounted');
  await input(ui, ui.document.querySelector('.bl-editor'), '产品名称', 'Unsaved Library Fixture');
  const event = new ui.window.Event('beforeunload', { cancelable: true }); ui.window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  await click(ui, ui.document.querySelector('button[aria-label="目标"]'));
  await wait(() => ui.document.querySelector('.muse-discard-modal'), 'original App asks before leaving dirty product');
  assert.equal(ui.window.location.pathname, '/library/products/new'); await click(ui, libraryButton(ui, '继续编辑'));
  await wait(() => !ui.document.querySelector('.muse-discard-modal'), 'continue editing preserves route');
  assert.equal(productInput(ui, '产品名称').value, 'Unsaved Library Fixture'); assert.equal((await f.request('/api/library/products')).items.length, 0);
  await click(ui, ui.document.querySelector('button[aria-label="目标"]')); await wait(() => ui.document.querySelector('.muse-discard-modal'), 'second explicit leave review');
  await click(ui, libraryButton(ui, '放弃并离开')); await wait(() => ui.window.location.pathname === '/goals' && !ui.document.querySelector('.bl-editor'), 'explicit discard reaches Goals');
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.deepEqual(ui.errors, []);
});

test('current Library UI refuses edits while the original product detail is unreadable and recovers from actual API retry', async t => {
  const f = await fixture(t), product = await libraryProduct(f);
  f.failNextRead(`/api/library/products/${product.id}`); const ui = await f.renderLibrary(`/library/products/${product.id}/edit`);
  await wait(() => ui.document.body.textContent.includes('读取暂不可用'), 'original detail read failure shown');
  assert.equal(ui.document.querySelector('.bl-editor'), null); assert.equal(libraryButton(ui, '保存产品'), undefined);
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0);
  await click(ui, libraryButton(ui, '重试读取'));
  await wait(() => productInput(ui, '产品名称')?.value === product.name, 'actual detail reread restores editor');
  assert.equal(productInput(ui, '产品名称').matches(':disabled'), false);
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.deepEqual(ui.errors, []);
});

test('current Library UI preserves viewer read-only controls and never adopts another role Supply pending command', async t => {
  const f = await fixture(t), product = await libraryProduct(f), owner = await f.render();
  await wait(() => button(owner, '新建') && !button(owner, '新建').disabled, 'original Supply component owner read');
  await click(owner, button(owner, '新建')); await input(owner, forms(owner)[0], '企业名称', 'Role Scoped Pending Fixture'); await input(owner, forms(owner)[0], '国家 / 地区', 'China');
  f.loseNextResponse(); await submit(owner, forms(owner)[0]); await wait(() => button(owner, '核对原请求结果'), 'original role scoped pending record');
  const stored = owner.storage(); assert.equal(stored.filter(([key]) => key.startsWith('workspace.supply.pending.v1:')).length, 1);
  const before = f.requests.filter(item => item.method !== 'GET').length; owner.window.close(); f.useViewerSession();
  const viewer = await f.renderLibrary(`/library/products/${product.id}/edit`, stored);
  await wait(() => libraryButton(viewer, '编辑产品'), 'viewer reads original detail without editor');
  assert.equal(libraryButton(viewer, '编辑产品').disabled, true); assert.equal(viewer.document.querySelector('.bl-editor'), null);
  assert.equal(libraryButton(viewer, '核对原请求结果'), undefined); assert.equal(libraryButton(viewer, '确认公开'), undefined);
  const newPage = await f.renderLibrary('/library/products/new', stored);
  await wait(() => newPage.document.querySelector('.bl-editor'), 'direct new route respects viewer too');
  assert.equal(productInput(newPage, '产品名称').matches(':disabled'), true); assert.equal(libraryButton(newPage, '保存产品').disabled, true);
  await submit(newPage, newPage.document.querySelector('.bl-editor'));
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, before); assert.equal((await f.request('/api/library/products')).items.length, 1);
  assert.deepEqual(viewer.errors, []); assert.deepEqual(newPage.errors, []);
});
