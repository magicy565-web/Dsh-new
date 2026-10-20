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
  function render(path = '/home', { width = 390 } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: `http://127.0.0.1:${address.port}${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const { window } = dom; windows.push(window); installBrowserPlatform(window);
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
    window.fetch = fetch; window.scrollTo = () => {};
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
  await wait(() => health.getAttribute('data-state') !== 'loading', 'healthz probe settled');
  await wait(() => recovery.getAttribute('data-state') !== 'loading', 'recovery probe settled');
  assert.equal(health.getAttribute('data-state'), 'missing', 'the enterprise app does not mount /healthz');
  assert.ok(health.textContent.includes('未挂载'), health.textContent);
  assert.equal(recovery.getAttribute('data-state'), 'ok', 'the real inquiry recovery route is available');
  assert.ok(recovery.textContent.includes('可用'), recovery.textContent);

  const before = f.requests.filter(row => row.path === '/healthz').length;
  consoleSection.querySelector('.harness-console-refresh').click();
  await wait(() => f.requests.filter(row => row.path === '/healthz').length > before, 'refresh re-probes the endpoints');
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
