import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createApp } from '../../server/index.mjs';

export async function temporaryDirectory(t, prefix) {
  const root = resolve(tmpdir()), directory = await mkdtemp(join(root, prefix));
  return directory;
}
export async function removeTemporaryDirectory(directory, prefix) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith(prefix)); await rm(directory, { recursive: true, force: true });
}
export async function originalHttp(t, options = {}) {
  const directory = await temporaryDirectory(t, 'workspace-conversation-http-ui-');
  let app, address, modelCalls = 0;
  const config = { dataDirectory: directory, capabilityEnvironment: {}, provider: { configured: false, kind: 'fixture', complete() { modelCalls++; assert.fail('Reading/reviewing must not invoke a model'); } }, ...options };
  async function open() { app = await createApp(config); address = await app.listen(0); }
  await open(); t.after(async () => { await app.close(); await removeTemporaryDirectory(directory, 'workspace-conversation-http-ui-'); });
  async function transport(route, options = {}) { return fetch(new URL(route, `http://127.0.0.1:${address.port}/`), options); }
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await transport(path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  }
  return { transport, request, get app() { return app; }, get modelCalls() { return modelCalls; }, async restart() { await app.close(); await open(); } };
}
export async function bundleRenderer(t, transport) {
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/.test(name))), 'utf8');
  const windows = [], requests = [];
  t.after(() => windows.forEach(window => window.close()));
  async function render(route, { width = 390, storage = [] } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://fixture.test' + route, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom; windows.push(window);
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
    Object.defineProperty(window, 'crypto', { value: webcrypto });
    window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder; window.AbortController = AbortController; window.scrollTo = () => {}; window.confirm = () => true;
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    for (const [key, value] of storage) window.sessionStorage.setItem(key, value);
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.fetch = async (path, options = {}) => { requests.push({ path: String(path), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined }); return transport(String(path), options); };
    window.eval(script); await wait(() => window.document.querySelector('.composer-region'), 'original conversation mounted');
    return { window, document: window.document, errors, storage: () => Array.from({ length: window.sessionStorage.length }, (_, i) => { const key = window.sessionStorage.key(i); return [key, window.sessionStorage.getItem(key)]; }) };
  }
  return { render, requests };
}
export async function wait(check, message) { for (let i = 0; i < 280; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Timed out: ' + message); }
export const button = (ui, text, root = ui.document) => [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text);
export async function click(ui, element) { assert.ok(element, 'Expected UI control'); assert.notEqual(element.disabled, true); element.click(); await new Promise(resolve => ui.window.setTimeout(resolve, 0)); }
export async function input(ui, element, value) {
  assert.ok(element, 'Expected input'); const proto = element.tagName === 'TEXTAREA' ? ui.window.HTMLTextAreaElement.prototype : ui.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new ui.window.Event('input', { bubbles: true })); await new Promise(resolve => ui.window.setTimeout(resolve, 0));
}
export const field = (ui, label) => [...ui.document.querySelectorAll('label')].find(item => item.firstChild?.textContent === label)?.querySelector('input,textarea,select');
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
