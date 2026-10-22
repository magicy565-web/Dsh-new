// Production React bundle against the original local HTTP server and Store.
// JSDOM has no layout: width values only choose responsive branches, not geometry.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';
import { localHttpTransport } from './fixtures/local-http.mjs';
import { installBrowserPlatform } from './fixtures/browser-platform.mjs';

const CSV_COLUMNS = ['leadId', 'sourceId', 'revision', 'companyName', 'companyUrl', 'contactEmail', 'customerName', 'productId',
  'product', 'quantity', 'unit', 'destination', 'lastContactAt', 'status', 'history', 'facts'];

const inquiry = (overrides = {}) => ({
  leadId: 'lead-alpha', sourceId: 'canton-fair-2024', revision: 1,
  companyName: 'Alpha Trading LLC', companyUrl: 'https://alpha.example.com', contactEmail: 'buyer@alpha.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  destination: 'US', lastContactAt: '2026-09-10', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-01', body: 'Please quote 500 pcs hydraulic cylinder.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'Please quote 500 pcs hydraulic cylinder', occurredAt: '2026-09-01' }],
  ...overrides,
});

function csv(records) {
  const cell = value => {
    const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return [CSV_COLUMNS.join(','), ...records.map(record => CSV_COLUMNS.map(column => cell(record[column])).join(','))].join('\n');
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-inquiry-ui-dom-'));
  let app = await createApp({ dataDirectory: directory, provider: { kind: 'fixture', configured: false, complete: async () => { throw Error('Model must not be called'); } }, capabilityEnvironment: {} });
  let address = await app.listen(0);
  let transport = localHttpTransport(`http://127.0.0.1:${address.port}`);
  const base = () => `http://127.0.0.1:${address.port}`;
  const requests = [], windows = [];
  const fetch = async (path, options = {}) => {
    requests.push({ path: String(path), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    return transport.fetch(String(path), options);
  };
  t.after(async () => {
    for (const window of windows) window.close();
    await transport.close();
    await app.close();
    assert.equal(resolve(directory, '..'), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'workspace-inquiry-ui-dom-')));
    await rm(directory, { recursive: true, force: true });
  });
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/u.test(name))), 'utf8');
  function render(path = '/recovery', { width = 390, fetch: customFetch } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${base()}${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom; windows.push(window); installBrowserPlatform(window);
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
    window.fetch = customFetch || fetch; window.scrollTo = () => {};
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.eval(script);
    return { window, document: window.document, errors };
  }
  async function request(path, method = 'GET', body) {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  async function restart() {
    await transport.close(); await app.close();
    app = await createApp({ dataDirectory: directory, provider: { kind: 'fixture', configured: false, complete: async () => { throw Error('Model must not be called'); } }, capabilityEnvironment: {} });
    address = await app.listen(0); transport = localHttpTransport(`http://127.0.0.1:${address.port}`);
  }
  return { base, fetch, request, render, restart, requests, get app() { return app; } };
}

async function wait(check, message) { for (let index = 0; index < 320; index++) { if (await check()) return; await new Promise(done => setTimeout(done, 25)); } throw Error(`Timed out: ${message}`); }
const button = (ui, text, root = ui.document) => [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text);
async function click(ui, element) { assert.ok(element, 'Expected UI control'); assert.notEqual(element.disabled, true); element.click(); await new Promise(done => setTimeout(done, 0)); }
async function input(ui, element, value) { assert.ok(element, 'Expected editable element'); const prototype = element.tagName === 'TEXTAREA' ? ui.window.HTMLTextAreaElement.prototype : ui.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new ui.window.Event('input', { bubbles: true })); await new Promise(done => setTimeout(done, 0)); }
const field = (ui, label) => ui.document.querySelector(`[aria-label="${label}"]`);

async function importThroughHttp(f, records, sourceName = 'authorized-history.csv', expectedStatus = 201) {
  const imported = await f.request('/api/inquiry-recovery/import', 'POST', { format: 'csv', requestId: randomUUID(), sourceName, content: csv(records) });
  assert.equal(imported.status, expectedStatus, JSON.stringify(imported.body));
  return imported.body;
}

test('production DOM 390: empty entry, real CSV import, identity review, 409 reload and unsent draft result', async t => {
  const f = await fixture(t), ui = f.render('/home', { width: 390 });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await wait(() => button(ui, '询盘捞回'), 'home exposes the recovery entry');
  await click(ui, button(ui, '询盘捞回'));
  await wait(() => ui.window.location.pathname === '/recovery' && ui.document.querySelector('.inquiry-recovery'), 'recovery page route');
  await wait(() => ui.document.querySelector('.ir-empty'), 'empty state after first load');
  assert.ok(ui.document.body.textContent.includes('还没有导入任何历史询盘'));
  assert.ok(ui.document.body.textContent.includes('不会生成示例数据'));
  assert.equal(ui.document.querySelectorAll('.ir-card').length, 0, 'no fabricated cards');
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 0, 'page load performs no mutation');

  // Import sheet: column help, 64 KiB client-side guard, then one real row.
  await click(ui, button(ui, '导入历史询盘'));
  await wait(() => ui.document.querySelector('.ir-sheet'), 'import sheet opens');
  const help = ui.document.querySelector('.ir-columns').textContent;
  for (const column of ['leadId', 'sourceId', 'revision', 'history', 'facts']) assert.ok(help.includes(column), `column help mentions ${column}`);
  const tooLarge = 'leadId,sourceId,revision\n' + 'x'.repeat(64 * 1024);
  await input(ui, field(ui, '粘贴 CSV 内容'), tooLarge);
  await wait(() => ui.document.querySelector('.ir-size.over'), '64 KiB guard shown');
  assert.equal(button(ui, '导入 CSV').disabled, true, 'oversized CSV cannot be submitted');
  await input(ui, field(ui, '粘贴 CSV 内容'), csv([inquiry()]));
  await wait(() => ui.document.querySelector('.ir-size') && !ui.document.querySelector('.ir-size.over'), 'size guard clears');
  await click(ui, button(ui, '导入 CSV'));
  await wait(() => ui.document.querySelector('.ir-import-result'), 'success summary rendered');
  const summary = ui.document.querySelector('.ir-import-result').textContent;
  assert.ok(summary.includes('插入 1'), summary);
  assert.ok(summary.includes('更新 0') && summary.includes('重复 0') && summary.includes('冲突 0'), summary);
  await click(ui, button(ui, '完成'));
  await wait(() => !ui.document.querySelector('.ir-sheet'), 'import sheet closes after summary');

  await wait(() => ui.document.querySelectorAll('.ir-card').length === 1, 'imported lead becomes a real card');
  const card = ui.document.querySelector('.ir-card');
  assert.ok(card.textContent.includes('Alpha Trading LLC'));
  assert.ok(card.textContent.includes('Hydraulic cylinder'));
  assert.ok(/已 \d+ 天/u.test(card.textContent), 'days stale from the server decision');
  assert.equal(card.getAttribute('data-decision'), 'need_evidence');
  assert.ok(card.textContent.includes('待补证'));
  assert.ok(card.textContent.includes('公司身份未确认'));
  assert.ok(card.textContent.includes('独立核实：否'));
  assert.ok(card.textContent.includes('Please quote 500 pcs hydraulic cylinder'));
  assert.ok(card.textContent.includes('来源消息 m1'));
  const chips = ui.document.querySelector('.ir-chips').textContent;
  for (const label of ['待跟进', '待补证', '培育中', '暂停']) assert.ok(chips.includes(label), `summary chip ${label}`);
  assert.equal(button(ui, '导入历史询盘').disabled, false, 'operator can import');

  // Identity review binds one card evidence quote.
  const listed = await f.request('/api/inquiry-recovery/opportunities');
  const serverCard = listed.body.cards.find(item => item.leadId === 'lead-alpha');
  assert.equal(serverCard.decision, 'need_evidence');
  await click(ui, button(ui, '核对公司身份'));
  await wait(() => ui.document.querySelector('.ir-basis'), 'identity dialog with card evidence');
  await click(ui, ui.document.querySelector('input[type="radio"][name="identity-basis"]'));
  await input(ui, field(ui, '公司官网'), 'https://alpha.example.com');
  await click(ui, button(ui, '确认身份'));
  await wait(() => !ui.document.querySelector('.ir-sheet'), 'identity dialog closes after commit');
  await wait(() => ui.document.querySelector('.ir-badge-follow_up'), 'card becomes 待跟进 after human identity review');
  const identityWrite = f.requests.find(row => row.method === 'POST' && row.path.endsWith('/identity'));
  assert.deepEqual(Object.keys(identityWrite.body).sort(), ['basis', 'requestId', 'sourceHash', 'status']);
  assert.equal(identityWrite.body.sourceHash, serverCard.sourceHash);
  assert.equal(identityWrite.body.status, 'confirmed');
  assert.deepEqual(identityWrite.body.basis, [{ sourceId: 'canton-fair-2024', quote: 'Please quote 500 pcs hydraulic cylinder', officialUrl: 'https://alpha.example.com' }]);

  // A newer revision arrives elsewhere after the list was rendered: the stale select must reload.
  const updated = await importThroughHttp(f, [inquiry({ revision: 2, lastContactAt: '2026-09-12' })]);
  assert.equal(updated.updated, 1, JSON.stringify(updated));
  await click(ui, button(ui, '生成复联草稿'));
  await wait(() => ui.document.querySelector('.ir-live[role="alert"]')?.textContent.includes('该询盘已在别处更新'), '409 conflict is explained');
  assert.deepEqual(f.requests.filter(row => row.path.endsWith('/select')).map(row => row.body.expectedRevision), [1]);
  await wait(() => ui.document.querySelector('.ir-badge-need_evidence'), 'conflict forced a card reload with the new revision');

  // Identity is re-reviewed on the current revision, then the honest unsent draft is shown.
  await click(ui, button(ui, '核对公司身份'));
  await wait(() => ui.document.querySelector('.ir-basis'), 'identity dialog reopened on current source hash');
  await click(ui, ui.document.querySelector('input[type="radio"][name="identity-basis"]'));
  await click(ui, button(ui, '确认身份'));
  await wait(() => ui.document.querySelector('.ir-badge-follow_up'), 'current revision becomes 待跟进');
  await click(ui, button(ui, '生成复联草稿'));
  await wait(() => ui.document.querySelector('.ir-unsent'), 'unsent draft bottom sheet');
  const sheet = ui.document.querySelector('.ir-sheet');
  assert.ok(sheet.textContent.includes('未发送 · 需人工审核'));
  assert.ok(sheet.textContent.includes('未启用') && sheet.textContent.includes('未写入'));
  assert.ok(sheet.textContent.includes('Goal 草稿'));
  const sha = ui.document.querySelector('.ir-draft-meta code').textContent;
  assert.match(sha, /^[0-9a-f]{64}$/u);
  const draftBody = ui.document.querySelector('.ir-draft-content').textContent;
  assert.ok(draftBody.includes('复联草稿') && draftBody.includes('未发送：人审必需'));
  assert.ok(draftBody.includes('价格、MOQ、交期、认证与库存均未在此草稿中承诺。'));
  assert.equal(/已发送/u.test(ui.document.body.textContent), false, 'no sent state is ever rendered');
  const selections = f.requests.filter(row => row.method === 'POST' && row.path.endsWith('/select'));
  assert.equal(selections.length, 2);
  for (const write of selections) assert.deepEqual(Object.keys(write.body).sort(), ['asOf', 'expectedRevision', 'requestId', 'sourceHash']);
  assert.deepEqual(selections.map(row => row.body.expectedRevision), [1, 2]);
  assert.match(selections[1].body.asOf, /^\d{4}-\d{2}-\d{2}$/u);
  assert.notEqual(selections[0].body.requestId, selections[1].body.requestId);
  await click(ui, button(ui, '关闭', sheet));
  await wait(() => !ui.document.querySelector('.ir-sheet'), 'draft sheet closes');

  // Restart persistence: a fresh page load re-reads the same cards and selections from the store.
  const status = await f.request('/api/inquiry-recovery/status');
  assert.equal(status.body.counts.leads, 1);
  assert.equal(status.body.counts.selections, 1);
  ui.window.close();
  const reloaded = f.render('/recovery', { width: 390 });
  await wait(() => reloaded.document.querySelector('.ir-card'), 'reloaded page restores the persisted card');
  assert.ok(reloaded.document.querySelector('.ir-card').textContent.includes('Alpha Trading LLC'));
  assert.ok(reloaded.document.querySelector('.ir-badge-follow_up'));
  assert.deepEqual(reloaded.errors, []);
  reloaded.window.close();
  await f.restart();
  const reopened = f.render('/recovery', { width: 390 });
  await wait(() => reopened.document.querySelector('.ir-card'), 'server restart keeps the imported card');
  assert.ok(reopened.document.body.textContent.includes('Alpha Trading LLC'));
  assert.deepEqual(ui.errors, []); assert.deepEqual(reopened.errors, []);
});

test('production DOM 390: skeleton then network error with an explicit retry', async t => {
  const f = await fixture(t);
  let failOpportunities = true;
  const flaky = async (path, options = {}) => {
    if (failOpportunities && String(path) === '/api/inquiry-recovery/opportunities') {
      await new Promise(done => setTimeout(done, 90));
      throw new Error('Synthetic loopback loss');
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/recovery', { width: 390, fetch: flaky });
  await wait(() => ui.document.querySelector('.ir-skeleton'), 'first-load skeleton');
  await wait(() => ui.document.querySelector('.ir-error[role="alert"]'), 'network error state');
  assert.ok(ui.document.querySelector('.ir-error').textContent.includes('历史询盘暂时无法读取'));
  assert.ok(ui.document.body.textContent.includes('暂时无法连接服务'));
  failOpportunities = false;
  await click(ui, button(ui, '重试'));
  await wait(() => ui.document.querySelector('.ir-empty'), 'retry recovers the real empty list');
  assert.equal(ui.document.querySelector('.ir-error'), null);
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: a fully rejected CSV 400 renders the per-row rejection table', async t => {
  const f = await fixture(t), ui = f.render('/recovery', { width: 390 });
  await wait(() => ui.document.querySelector('.ir-empty'), 'empty list');
  await click(ui, button(ui, '导入历史询盘'));
  await wait(() => ui.document.querySelector('.ir-sheet'), 'import sheet');
  await input(ui, field(ui, '粘贴 CSV 内容'), csv([
    inquiry({ leadId: 'lead-bad-1', status: 'bogus' }),
    inquiry({ leadId: 'lead-bad-2', facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'not quoted in history', occurredAt: null }] }),
  ]));
  await click(ui, button(ui, '导入 CSV'));
  await wait(() => ui.document.querySelector('.ir-rejections'), 'rejection table shown on 400');
  const rows = [...ui.document.querySelectorAll('.ir-rejections tbody tr')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('td').textContent, '1');
  assert.equal(rows[1].querySelector('td').textContent, '2');
  assert.ok(rows[0].textContent.includes('INQUIRY_ROW_INVALID'));
  assert.ok(rows[1].textContent.includes('INQUIRY_FACT_UNSUPPORTED'));
  assert.ok(ui.document.querySelector('.ir-error-inline').textContent.includes('未导入任何数据'));
  const status = await f.request('/api/inquiry-recovery/status');
  assert.equal(status.body.counts.leads, 0, 'rejected rows never touch stored data');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: INQUIRY_ROLE_REQUIRED switches the page to a read-only notice and blocks import', async t => {
  const f = await fixture(t);
  const forbidden = (path, options = {}) => {
    if ((options.method || 'GET') === 'POST' && String(path).startsWith('/api/inquiry-recovery/')) {
      return new Response(JSON.stringify({ error: { code: 'INQUIRY_ROLE_REQUIRED', message: 'Only an administrator or operator may change inquiry recovery data.' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/recovery', { width: 390, fetch: forbidden });
  await wait(() => ui.document.querySelector('.ir-empty'), 'empty list');
  assert.equal(ui.document.querySelector('.ir-readonly'), null);
  await click(ui, button(ui, '导入历史询盘'));
  await wait(() => ui.document.querySelector('.ir-sheet'), 'import sheet');
  await input(ui, field(ui, '粘贴 CSV 内容'), csv([inquiry()]));
  await click(ui, button(ui, '导入 CSV'));
  await wait(() => ui.document.querySelector('.ir-readonly'), '403 becomes an explicit read-only notice');
  assert.ok(ui.document.querySelector('.ir-readonly').textContent.includes('只读权限'));
  assert.ok(ui.document.querySelector('.ir-error-inline').textContent.includes('没有导入权限'));
  assert.equal(button(ui, '导入 CSV').disabled, true, 'no further import attempts are offered');
  await click(ui, button(ui, '取消'));
  await wait(() => !ui.document.querySelector('.ir-sheet'), 'sheet closes');
  assert.equal(button(ui, '导入历史询盘').disabled, true, 'read-only page disables import entry');
  assert.deepEqual(ui.errors, []);
});
