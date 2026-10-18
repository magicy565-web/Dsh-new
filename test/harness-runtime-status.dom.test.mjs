import assert from 'node:assert/strict';
import test from 'node:test';
import { originalHttp, bundleRenderer, wait, input } from './fixtures/conversation-ui.mjs';

// Production React/JSDOM and original loopback HTTP/Store, with explicit faults
// only on the runtime status response. No Chromium, model or real account.
test('the original absent runtime API returns JSON NOT_FOUND and retains legacy UI', async t => {
  const http = await originalHttp(t);
  const response = await http.transport('/api/conversations/runtime');
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  // The legacy router treats "runtime" as a missing conversation identifier.
  assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
  const missing = await http.transport('/api/synthetic-missing-runtime-route');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  const renderer = await bundleRenderer(t, http.transport);
  const ui = await renderer.render('/chat');
  await wait(() => ui.document.querySelector('h1')?.textContent === '把业务目标推进为成果', 'original legacy runtime state');
  await wait(() => ui.document.querySelector('textarea[aria-label="输入目标任务"]')?.disabled === false, 'recognized 404 finishes runtime loading');
  assert.equal(ui.document.querySelector('.harness-runtime-error'), null);
  assert.equal(renderer.requests.filter(value => value.method !== 'GET').length, 0);
  assert.equal(http.modelCalls, 0);
  assert.deepEqual(ui.errors, []);
});

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const faults = [
  ['HTML 404', () => new Response('<!doctype html><title>Proxy 404</title>', { status: 404, headers: { 'Content-Type': 'text/html' } })],
  ['malformed JSON 404', () => new Response('{"error":', { status: 404, headers: { 'Content-Type': 'application/json' } })],
  ['unrecognized JSON 404', () => json({ message: 'A proxy did not find this route.' }, 404)],
  ['different API error 404', () => json({ error: { code: 'FRONTEND_NOT_BUILT', message: 'Not the absent runtime API.' } }, 404)],
  ['503 even with NOT_FOUND', () => json({ error: { code: 'NOT_FOUND', message: 'Unavailable upstream.' } }, 503)],
  ['invalid success DTO', () => json({ engine: 'omp', frontend: 'original-workspace-conversation-run' }, 200)],
];

for (const [name, fault] of faults) test(`${name} keeps runtime unavailable and sending blocked`, async t => {
  const http = await originalHttp(t);
  const renderer = await bundleRenderer(t, (path, options) => path === '/api/conversations/runtime' ? fault() : http.transport(path, options));
  const ui = await renderer.render('/chat');
  await wait(() => ui.document.querySelector('.harness-runtime-error')?.textContent.includes('聊天运行时状态不可用'), 'runtime failure remains visible');
  const textbox = ui.document.querySelector('textarea[aria-label="输入目标任务"]');
  await input(ui, textbox, 'SYNTHETIC_DO_NOT_SEND');
  const send = ui.document.querySelector('button[aria-label="提交目标任务"]');
  assert.ok(send);
  assert.equal(send.disabled, true);
  send.click();
  assert.equal(renderer.requests.filter(value => value.method !== 'GET').length, 0);
  assert.equal(http.app.store.read().conversations.length, 0);
  assert.equal(http.modelCalls, 0);
  assert.deepEqual(ui.errors, []);
});
