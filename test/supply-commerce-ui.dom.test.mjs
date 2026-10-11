import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';

// Built React + original PR28 HTTP/NTFS Store, with no memory preload. jsdom
// exercises DOM behavior, not visual/browser/PersonalAgent acceptance. Faults
// below alter only the test client's transport, after real server commits.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-supply-ui-'));
  const options = { dataDirectory: directory, provider: { configured: false, complete: async () => { throw Error('Model must not run'); } } };
  let app = await createApp(options), address = await app.listen(0);
  let lostResponse = false, failedRead = false, viewerSession = false;
  const requests = [], windows = [];
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/.test(name))), 'utf8');
  const url = path => `http://127.0.0.1:${address.port}${path}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(url(`/api/supply${path}`), { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  }
  async function render(storage = []) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: url('/commerce'), runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom; windows.push(window);
    window.AbortController = AbortController; window.scrollTo = () => {}; window.confirm = () => true;
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    for (const [key, value] of storage) window.sessionStorage.setItem(key, value);
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.fetch = async (path, init = {}) => {
      const method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path: String(path), method, body });
      if (failedRead && path === '/api/supply/listings' && method === 'GET') { failedRead = false; return new Response(JSON.stringify({ error: { code: 'TEST_READ_UNAVAILABLE', message: '读取暂不可用，请重试。' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
      const response = await fetch(new URL(path, url('/')), init);
      if (viewerSession && path === '/api/session') { const original = await response.json(); return new Response(JSON.stringify({ ...original, mode: 'enterprise', authenticated: true, user: { id: 'fixture-viewer', role: 'viewer' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
      if (lostResponse && method === 'POST' && path === '/api/supply/suppliers') { lostResponse = false; assert.equal(response.status, 201); await response.arrayBuffer(); throw Error('Test client lost committed response'); }
      return response;
    };
    window.eval(script);
    await wait(() => window.document.querySelector('.supply-network'), 'mounted original Commerce supply resource');
    return { window, document: window.document, errors, storage: () => Array.from({ length: window.sessionStorage.length }, (_, i) => { const key = window.sessionStorage.key(i); return [key, window.sessionStorage.getItem(key)]; }) };
  }
  async function seed() {
    const supplier = (await request('/suppliers', 'POST', { requestId: randomUUID(), displayName: 'Fixture Supplier', country: 'China', website: 'https://supplier.example' })).supplier;
    const listing = (await request('/listings', 'POST', { requestId: randomUUID(), supplierId: supplier.id, title: 'Fixture Cotton', sku: 'TEST-1', unitPrice: '2.40', currency: 'USD', moq: 500, leadDays: 28, incoterm: 'FOB', details: 'Test-only cotton specification' })).listing;
    return { supplier, listing };
  }
  t.after(async () => { for (const window of windows) window.close(); await app.close(); assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'workspace-supply-ui-')))); await rm(directory, { recursive: true, force: true }); });
  return { render, request, seed, requests, loseNextResponse() { lostResponse = true; }, failNextRead() { failedRead = true; }, useViewerSession() { viewerSession = true; }, async restart() { await app.close(); app = await createApp(options); address = await app.listen(0); } };
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

test('Supply Commerce UI saves supplier/product, edits, and recovers from original durable Store restart', async t => {
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

test('Supply Commerce UI pins edit revision, preserves conflicting input across reload, and requires explicit new revision', async t => {
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

test('Supply Commerce UI restores unknown committed command after refresh and retries exact request without duplicates', async t => {
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

test('Supply Commerce UI uses original V22 dirty navigation and refresh protection', async t => {
  const f = await fixture(t), ui = await f.render(); await wait(() => button(ui, '新建') && !button(ui, '新建').disabled, 'catalog ready');
  await click(ui, button(ui, '新建')); await input(ui, forms(ui)[0], '企业名称', 'Unsaved fixture');
  const event = new ui.window.Event('beforeunload', { cancelable: true }); ui.window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  await click(ui, ui.document.querySelector('button[aria-label="目标"]')); await wait(() => ui.document.querySelector('.muse-discard-modal'), 'existing leave modal');
  assert.equal(ui.window.location.pathname, '/commerce'); await click(ui, button(ui, '继续编辑', ui.document)); await wait(() => !ui.document.querySelector('.muse-discard-modal'), 'keep editing');
  assert.equal(forms(ui)[0].querySelector('input').value, 'Unsaved fixture'); assert.equal((await f.request('/suppliers')).suppliers.length, 0);
});

test('Supply Commerce UI exposes read failures, disables invalid writes, and reloads real data', async t => {
  const f = await fixture(t); await f.seed(); f.failNextRead(); const ui = await f.render();
  await wait(() => ui.document.body.textContent.includes('读取暂不可用'), 'read failure shown'); assert.equal(button(ui, '新增商品').disabled, true);
  await click(ui, button(ui, '重试读取')); await wait(() => button(ui, '修改') && !button(ui, '修改').disabled, 'real API retry');
  assert.ok(ui.document.body.textContent.includes('Fixture Cotton')); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.deepEqual(ui.errors, []);
});

test('Supply Commerce UI never adopts another role scope pending command or mutates through viewer controls', async t => {
  const f = await fixture(t), ui = await f.render(); await wait(() => button(ui, '新建') && !button(ui, '新建').disabled, 'local admin catalog');
  await click(ui, button(ui, '新建')); await input(ui, forms(ui)[0], '企业名称', 'Scoped fixture'); await input(ui, forms(ui)[0], '国家 / 地区', 'China'); f.loseNextResponse(); await submit(ui, forms(ui)[0]); await wait(() => button(ui, '核对原请求结果'), 'scoped pending');
  const stored = ui.storage(), count = f.requests.filter(item => item.method === 'POST').length; ui.window.close(); f.useViewerSession(); const viewer = await f.render(stored);
  await wait(() => button(viewer, '新增商品'), 'viewer catalog'); assert.equal(button(viewer, '新增商品').disabled, true); assert.equal(button(viewer, '新建'), undefined); assert.equal(button(viewer, '核对原请求结果'), undefined);
  assert.equal(f.requests.filter(item => item.method === 'POST').length, count); assert.deepEqual(viewer.errors, []);
});

test('Supply Commerce UI publishes only after explicit confirmation of exact supplier and listing revision', async t => {
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
