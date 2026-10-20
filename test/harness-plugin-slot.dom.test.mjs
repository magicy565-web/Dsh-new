// Production React bundle against the real local HTTP server and Store.
// Requires `vite build` first: these tests eval dist/assets/index-*.js like the
// existing DOM suite so the plugin discovery, slot rendering and error boundary are
// exercised exactly as shipped. JSDOM has no layout; width only selects responsive
// branches, not geometry.
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
import { createSlotRegistry } from '../packages/harness-client/src/index.mjs';

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

function silentRegistry() {
  return createSlotRegistry({ logger: { error() {} } });
}

test('slot registry: frozen slots, duplicate ids, deterministic order and (d) no registration -> no occupant', () => {
  const registry = silentRegistry();
  const card = () => null;

  // (d) A slot with no registered plugin has no occupants: nothing renders.
  assert.deepEqual(registry.slots('home.cards'), []);
  assert.deepEqual(registry.list(), []);

  // Multiple occupants of one slot are allowed; order is plugin id, not registration order.
  registry.register({ id: 'plugin-zeta', slots: { 'home.cards': card } });
  registry.register({ id: 'plugin-alpha', slots: { 'home.cards': card, 'page.body': card } });
  assert.deepEqual(registry.slots('home.cards').map(item => item.pluginId), ['plugin-alpha', 'plugin-zeta']);
  assert.deepEqual(registry.list().map(item => item.id), ['plugin-alpha', 'plugin-zeta']);

  // The same plugin id is refused, unknown slots and non-renderable values are refused.
  assert.throws(() => registry.register({ id: 'plugin-alpha', slots: {} }), error => error.code === 'HARNESS_PLUGIN_DUPLICATE');
  assert.throws(() => registry.register({ id: 'plugin-beta', slots: { 'home.sidebar': card } }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  assert.throws(() => registry.register({ id: 'plugin-gamma', slots: { 'home.cards': 'not-a-render-function' } }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  assert.throws(() => registry.slots('home.sidebar'), error => error.code === 'HARNESS_MANIFEST_INVALID');

  // Removing one plugin removes only its occupant and disposes it once.
  let disposed = 0;
  registry.register({ id: 'plugin-delta', slots: { 'home.cards': card }, dispose() { disposed++; } });
  assert.equal(registry.unregister('plugin-delta'), true);
  assert.equal(registry.unregister('plugin-delta'), false);
  assert.equal(disposed, 1);
  assert.deepEqual(registry.slots('home.cards').map(item => item.pluginId), ['plugin-alpha', 'plugin-zeta']);

  // activate() failures are fail-closed: that plugin's occupants never render.
  registry.register({ id: 'plugin-broken', slots: { 'home.cards': card }, activate() { throw Error('activation failed'); } });
  assert.deepEqual(registry.activate({}), { activated: 2, failed: ['plugin-broken'] });
  assert.deepEqual(registry.slots('home.cards').map(item => item.pluginId), ['plugin-alpha', 'plugin-zeta']);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-plugin-slot-dom-'));
  const app = await createApp({ dataDirectory: directory, provider: { kind: 'fixture', configured: false, complete: async () => { throw Error('Model must not be called'); } }, capabilityEnvironment: {} });
  const address = await app.listen(0);
  const transport = localHttpTransport(`http://127.0.0.1:${address.port}`);
  const requests = [], windows = [];
  const fetch = async (path, options = {}) => {
    requests.push({ path: String(path), method: options.method || 'GET' });
    return transport.fetch(String(path), options);
  };
  t.after(async () => {
    for (const window of windows) window.close();
    await transport.close();
    await app.close();
    assert.ok(directory.startsWith(join(tmpdir(), 'harness-plugin-slot-dom-')));
    await rm(directory, { recursive: true, force: true });
  });
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/u.test(name))), 'utf8');
  function render(path = '/home', { width = 390, fetch: customFetch } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://127.0.0.1:${address.port}${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
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
  return { fetch, render, request, requests, base: () => `http://127.0.0.1:${address.port}` };
}

async function wait(check, message) { for (let index = 0; index < 320; index++) { if (await check()) return; await new Promise(done => setTimeout(done, 25)); } throw Error(`Timed out: ${message}`); }
const button = (ui, text, root = ui.document) => [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text);
async function click(ui, element) { assert.ok(element, 'Expected UI control'); assert.notEqual(element.disabled, true); element.click(); await new Promise(done => setTimeout(done, 0)); }

test('production DOM 390: the home.cards slot renders the plugin card with real status counts and reaches /recovery', async t => {
  const f = await fixture(t);
  const imported = await f.request('/api/inquiry-recovery/import', 'POST', { format: 'csv', requestId: randomUUID(), sourceName: 'authorized-history.csv', content: csv([inquiry()]) });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.accepted, 1, JSON.stringify(imported.body));

  // Delay only the status read so the loading state is observable before the real counts.
  const slowStatus = async (path, options = {}) => {
    if (String(path) === '/api/inquiry-recovery/status') await new Promise(done => setTimeout(done, 120));
    return f.fetch(path, options);
  };
  const ui = f.render('/home', { width: 390, fetch: slowStatus });
  await wait(() => ui.document.querySelector('.slot-recovery-card[data-state="loading"]'), 'loading state while status is read');
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');

  // (a) the occupant comes from the plugin host, not from a hardcoded home card.
  const slot = ui.document.querySelector('.plugin-slot[data-slot="home.cards"]');
  assert.ok(slot, 'home.cards slot is mounted on the home page');
  assert.ok(ui.document.querySelector('.plugin-slot-item[data-plugin="workspace-inquiry-recovery"]'), 'occupant wrapper names the plugin id');
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 1, 'only the test fixture import mutates; the card only reads status');
  await wait(() => ui.document.querySelector('.slot-recovery-card[data-state="ready"]'), 'ready state with the real status payload');

  const card = ui.document.querySelector('.slot-recovery-card');
  assert.ok(card.textContent.includes('询盘捞回'));
  assert.ok(card.textContent.includes('用已导入的历史询盘和逐字证据'));
  assert.equal(card.querySelectorAll('.slot-recovery-chip').length, 4, 'four decision-count chips');
  assert.equal(card.querySelector('[data-decision="need_evidence"] strong').textContent, '1', 'real count from GET /api/inquiry-recovery/status');
  assert.equal(card.querySelector('[data-decision="follow_up"] strong').textContent, '0');
  assert.ok(card.textContent.includes('共 1 条线索'), card.textContent);
  assert.equal(button(ui, '询盘捞回').disabled, false, 'the entry is actionable');
  assert.deepEqual(ui.errors, []);

  await click(ui, button(ui, '询盘捞回'));
  await wait(() => ui.window.location.pathname === '/recovery' && ui.document.querySelector('.inquiry-recovery'), 'plugin card navigates to the existing /recovery page');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: (b) a throwing plugin renders nothing while the rest of the home page survives', async t => {
  const f = await fixture(t);
  const ui = f.render('/home', { width: 390 });
  await wait(() => ui.document.querySelector('.slot-recovery-card[data-state="empty"]'), 'real plugin card loaded with the honest empty state');
  assert.ok(ui.document.querySelector('.plugin-slot-item[data-plugin="workspace-inquiry-recovery"] .slot-recovery-card'));
  assert.ok(ui.document.querySelector('.brain-home h1').textContent.includes('现在最值得做什么'));

  const logged = [];
  ui.window.console.error = (...args) => { logged.push(args.map(value => String(value)).join(' ')); };
  const registry = ui.window.__DSH_SLOT_REGISTRY__;
  assert.ok(registry, 'booted registry is exposed for tests');
  assert.ok(registry.list().some(item => item.id === 'workspace-inquiry-recovery'), 'the real plugin is registered');

  registry.register({
    id: 'test-throwing-plugin',
    slots: {
      'home.cards': () => { throw new Error('synthetic plugin failure'); },
    },
  });

  await wait(() => logged.some(message => message.includes('test-throwing-plugin')), 'broken plugin error is logged');
  const hostLogs = logged.filter(message => message.includes('[harness-client]') && message.includes('test-throwing-plugin'));
  assert.equal(hostLogs.length, 1, 'a broken plugin is logged exactly once');
  assert.ok(hostLogs[0].includes('渲染失败'));

  // The failure is isolated: no uncaught window error, the healthy plugin card is still
  // rendered, and the only new slot item is the empty boundary wrapper of the broken plugin.
  assert.deepEqual(ui.errors, []);
  assert.equal(ui.document.querySelectorAll('.slot-recovery-card').length, 1, 'healthy occupant still rendered');
  assert.equal([...ui.document.querySelectorAll('.plugin-slot-item')].filter(item => item.textContent.trim() === '').length, 1, 'broken occupant rendered nothing');
  assert.ok(ui.document.querySelector('.brain-home h1'), 'the rest of the home page survived');
  assert.ok(ui.document.querySelector('.brain-composer'), 'home composer still rendered');

  await click(ui, button(ui, '询盘捞回'));
  await wait(() => ui.window.location.pathname === '/recovery', 'healthy plugin keeps working after a sibling failed');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: (c) a 404 status shows the unavailable notice instead of fake zeros', async t => {
  const f = await fixture(t);
  const notMounted = async (path, options = {}) => {
    if (String(path) === '/api/inquiry-recovery/status') {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'route not mounted' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/home', { width: 390, fetch: notMounted });
  await wait(() => ui.document.querySelector('.slot-recovery-card[data-state="unavailable"]'), 'unavailable notice when the harness is not mounted');
  const card = ui.document.querySelector('.slot-recovery-card');
  assert.ok(card.textContent.includes('尚未挂载'), card.textContent);
  assert.ok(card.textContent.includes('不展示任何推测数字'), card.textContent);
  assert.equal(card.querySelectorAll('.slot-recovery-chip').length, 0, 'no fabricated decision-count chips');
  const statusText = card.querySelector('.slot-recovery-status').textContent;
  assert.equal(/\d/u.test(statusText), false, 'no numbers are rendered in the unavailable state');
  assert.ok(button(ui, '询盘捞回'), 'the entry remains available');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: (d) the card is absent when the plugin is not registered', async t => {
  const f = await fixture(t);
  const ui = f.render('/home', { width: 390 });
  await wait(() => ui.document.querySelector('.slot-recovery-card'), 'card present while the plugin is registered');
  const registry = ui.window.__DSH_SLOT_REGISTRY__;
  assert.ok(registry);
  assert.equal(registry.unregister('workspace-inquiry-recovery'), true);
  await wait(() => !ui.document.querySelector('.slot-recovery-card'), 'card disappears once the plugin is unregistered');
  assert.ok(ui.document.querySelector('.plugin-slot[data-slot="home.cards"]'), 'the slot host itself stays mounted');
  assert.equal(ui.document.querySelectorAll('.plugin-slot-item').length, 0);
  assert.ok(ui.document.querySelector('.brain-home h1').textContent.includes('现在最值得做什么'), 'rest of the home page survives');
  assert.deepEqual(ui.errors, []);
});
