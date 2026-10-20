// Production React bundle against the real local HTTP server and Store.
// Requires `vite build` first. Exercises the second client slot (settings.section):
// the console occupant renders real registry facts and real endpoint probes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';
import { localHttpTransport } from './fixtures/local-http.mjs';
import { installBrowserPlatform } from './fixtures/browser-platform.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-console-slot-dom-'));
  const app = await createApp({
    dataDirectory: directory,
    provider: { kind: 'fixture', configured: false, complete: async () => { throw Error('Model must not be called'); } },
    capabilityEnvironment: {},
  });
  const address = await app.listen(0);
  const transport = localHttpTransport(`http://127.0.0.1:${address.port}`);
  const windows = [];
  const requests = [];
  const fetch = async (path, options = {}) => {
    requests.push({ path: String(path), method: options.method || 'GET' });
    return transport.fetch(String(path), options);
  };
  t.after(async () => {
    for (const window of windows) window.close();
    await transport.close();
    await app.close();
    assert.ok(directory.startsWith(join(tmpdir(), 'harness-console-slot-dom-')));
    await rm(directory, { recursive: true, force: true });
  });
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/u.test(name))), 'utf8');
  function render(path = '/home', { width = 390, fetch: customFetch } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: `http://127.0.0.1:${address.port}${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const { window } = dom; windows.push(window); installBrowserPlatform(window);
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
    window.fetch = customFetch || fetch; window.scrollTo = () => {};
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.eval(script);
    return { window, document: window.document, errors };
  }
  return { fetch, render, requests };
}

async function wait(check, message) {
  for (let index = 0; index < 320; index++) {
    if (await check()) return;
    await new Promise(done => setTimeout(done, 25));
  }
  throw Error(`Timed out: ${message}`);
}

async function openSettings(ui) {
  const trigger = ui.document.querySelector('button[aria-label="设置"]');
  assert.ok(trigger, 'settings trigger exists');
  trigger.click();
  await wait(() => ui.document.querySelector('.settings-modal'), 'settings modal opens');
}

test('production DOM 390: settings.section renders the console with real registry and probe facts', async t => {
  const f = await fixture(t);
  const ui = f.render('/home', { width: 390 });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await openSettings(ui);

  const slot = ui.document.querySelector('.plugin-slot[data-slot="settings.section"]');
  assert.ok(slot, 'settings.section slot is mounted in the settings dialog');
  await wait(() => slot.querySelector('.harness-console'), 'console occupant rendered from the plugin host');
  const occupant = slot.querySelector('.plugin-slot-item[data-plugin="workspace-harness-console"]');
  assert.ok(occupant, 'occupant wrapper names the client plugin id');

  const consoleSection = slot.querySelector('.harness-console');
  const listed = [...consoleSection.querySelectorAll('[data-client-plugin]')].map(item => item.getAttribute('data-client-plugin')).sort();
  assert.deepEqual(listed, ['workspace-harness-console', 'workspace-inquiry-recovery']);
  assert.ok(consoleSection.textContent.includes('settings.section'), 'the console reports slot occupancy');

  const health = consoleSection.querySelector('[data-probe="healthz"]');
  const recovery = consoleSection.querySelector('[data-probe="recovery"]');
  const audit = consoleSection.querySelector('[data-probe="audit"]');
  await wait(() => health.getAttribute('data-state') !== 'loading', 'healthz probe settled');
  await wait(() => recovery.getAttribute('data-state') !== 'loading', 'recovery probe settled');
  await wait(() => audit.getAttribute('data-state') !== 'loading', 'audit probe settled');
  assert.equal(health.getAttribute('data-state'), 'missing', 'the enterprise app does not mount /healthz');
  assert.ok(health.textContent.includes('未挂载'), health.textContent);
  assert.equal(recovery.getAttribute('data-state'), 'ok', 'the real inquiry recovery route is available');
  assert.ok(recovery.textContent.includes('可用'), recovery.textContent);
  assert.equal(audit.getAttribute('data-state'), 'missing', 'the enterprise app has no audit endpoint; the SPA fallback is not availability');
  assert.ok(audit.textContent.includes('未提供审计接口'), audit.textContent);
  const review = consoleSection.querySelector('[data-probe="review"]');
  await wait(() => review.getAttribute('data-state') !== 'loading', 'review probe settled');
  assert.equal(review.getAttribute('data-state'), 'missing', 'the enterprise app has no review endpoint');
  assert.ok(review.textContent.includes('未提供评审接口'), review.textContent);
  assert.equal(ui.document.querySelector('.harness-console-review'), null, 'no verdict block without a readable review');
  assert.equal(consoleSection.querySelectorAll('[data-audit-index]').length, 0, 'no fabricated audit events');

  const before = f.requests.filter(row => row.path.startsWith('/api/inquiry-recovery/audit')).length;
  consoleSection.querySelector('.harness-console-refresh').click();
  await wait(() => f.requests.filter(row => row.path.startsWith('/api/inquiry-recovery/audit')).length > before, 'refresh re-reads the audit trail');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: the console renders real audit events when the endpoint answers', async t => {
  const f = await fixture(t);
  const auditEvents = [
    { at: '2026-10-21T02:00:00.000Z', kind: 'inquiry', action: 'select', actor: { subject: 'local-operator' }, ok: true },
    { at: '2026-10-21T01:00:00.000Z', kind: 'tool', action: 'inquiry_recovery_status', actor: { subject: 'auditor' }, ok: false, code: 'HARNESS_TOOL_REFUSED' },
  ];
  const withAudit = async (path, options = {}) => {
    if (String(path).startsWith('/api/inquiry-recovery/audit')) {
      return new Response(JSON.stringify({ events: auditEvents, total: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/home', { width: 390, fetch: withAudit });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await openSettings(ui);
  await wait(() => ui.document.querySelector('.harness-console'), 'console rendered');
  const audit = ui.document.querySelector('[data-probe="audit"]');
  await wait(() => audit.getAttribute('data-state') === 'ok', 'audit state becomes readable');
  assert.ok(audit.textContent.includes('可读'), audit.textContent);
  const items = [...ui.document.querySelectorAll('[data-audit-index]')];
  assert.equal(items.length, 2);
  assert.ok(items[0].textContent.includes('inquiry/select'));
  assert.ok(items[0].textContent.includes('local-operator'));
  assert.ok(items[0].textContent.includes('成功'));
  assert.equal(items[1].getAttribute('data-ok'), 'false');
  assert.ok(items[1].textContent.includes('HARNESS_TOOL_REFUSED'));
  assert.ok(items[1].querySelector('.harness-console-event-state').textContent.includes('失败'));
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: a 403 audit response is shown as insufficient permission, not as empty', async t => {
  const f = await fixture(t);
  const forbidden = async (path, options = {}) => {
    if (String(path).startsWith('/api/inquiry-recovery/audit')) {
      return new Response(JSON.stringify({ error: { code: 'HARNESS_TOOL_REFUSED', message: 'admin role is required' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/home', { width: 390, fetch: forbidden });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await openSettings(ui);
  await wait(() => ui.document.querySelector('.harness-console'), 'console rendered');
  const audit = ui.document.querySelector('[data-probe="audit"]');
  await wait(() => audit.getAttribute('data-state') === 'error', 'audit state becomes an error');
  assert.ok(audit.textContent.includes('需要 admin 权限'), audit.textContent);
  assert.equal(ui.document.querySelectorAll('[data-audit-index]').length, 0, 'a 403 never renders as an empty-but-healthy trail');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: unregistering the console plugin removes it while the slot host survives', async t => {
  const f = await fixture(t);
  const ui = f.render('/home', { width: 390 });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await openSettings(ui);
  await wait(() => ui.document.querySelector('.harness-console'), 'console rendered');
  const registry = ui.window.__DSH_SLOT_REGISTRY__;
  assert.ok(registry, 'booted registry is exposed');
  assert.equal(registry.unregister('workspace-harness-console'), true);
  await wait(() => !ui.document.querySelector('.harness-console'), 'console disappears once unregistered');
  assert.ok(ui.document.querySelector('.plugin-slot[data-slot="settings.section"]'), 'slot host stays mounted');
  assert.ok(ui.document.querySelector('.settings-modal'), 'settings dialog survives');
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: the console shows a real review verdict when the route answers', async t => {
  const f = await fixture(t);
  const digest = 'b'.repeat(64);
  const withReview = async (path, options = {}) => {
    if (String(path) === '/api/harness/review') {
      return new Response(JSON.stringify({
        review: { generatedAt: '2026-10-21T02:00:00.000Z', composition: { name: 'dev', digest }, verdict: 'blocked', blockers: [{ kind: 'unmet-requires' }, { kind: 'install-drift' }] },
        file: '.harness-review.json', generatedAt: '2026-10-21T02:00:00.000Z', state: 'ok',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/home', { width: 390, fetch: withReview });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await openSettings(ui);
  await wait(() => ui.document.querySelector('.harness-console'), 'console rendered');
  const review = ui.document.querySelector('[data-probe="review"]');
  await wait(() => review.getAttribute('data-state') === 'ok', 'review probe becomes readable');
  assert.equal(review.getAttribute('data-verdict'), 'blocked');
  assert.ok(review.textContent.includes('判定：blocked'), review.textContent);
  const section = ui.document.querySelector('.harness-console-review');
  assert.ok(section, 'the review block is rendered');
  assert.equal(section.getAttribute('data-verdict'), 'blocked');
  assert.ok(section.textContent.includes('blocked'));
  assert.ok(section.textContent.includes(digest.slice(0, 12)), 'the composition digest is shown');
  assert.ok(section.textContent.includes('2 个阻断项'));
  assert.ok(section.textContent.includes('unmet-requires'));
  assert.deepEqual(ui.errors, []);
});

test('production DOM 390: a stale review is shown as unreadable, never as ready', async t => {
  const f = await fixture(t);
  const stale = async (path, options = {}) => {
    if (String(path) === '/api/harness/review') {
      return new Response(JSON.stringify({ error: { code: 'HARNESS_REVIEW_UNAVAILABLE', message: 'review is older than 24h' }, state: 'stale' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return f.fetch(path, options);
  };
  const ui = f.render('/home', { width: 390, fetch: stale });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await openSettings(ui);
  await wait(() => ui.document.querySelector('.harness-console'), 'console rendered');
  const review = ui.document.querySelector('[data-probe="review"]');
  await wait(() => review.getAttribute('data-state') === 'error', 'stale review becomes an error state');
  assert.ok(review.textContent.includes('stale'), review.textContent);
  assert.equal(ui.document.querySelector('.harness-console-review'), null, 'a stale review never renders a verdict block');
  assert.deepEqual(ui.errors, []);
});