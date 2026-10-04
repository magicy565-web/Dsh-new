import test from 'node:test';
import assert from 'node:assert/strict';
import { createFastAITokenProvider, FASTAITOKEN_ENDPOINT } from '../server/relay-provider.mjs';
import { createApp } from '../server/index.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const fixtureKey = 'fixture-relay-key-not-live';
const response = content => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }), { status: 200 });
test('relay fails closed without an explicit approved model/key, never chooses or falls back', async () => {
  let calls = 0;
  for (const options of [{}, { apiKey: fixtureKey }, { model: 'approved-model' }]) {
    const provider = createFastAITokenProvider({ ...options, fetchImpl: () => { calls++; } }); assert.equal(provider.configured, false);
    await assert.rejects(provider.complete({ messages: [], model: 'approved-model' }), { code: 'SETUP_REQUIRED' });
  }
  assert.equal(calls, 0); assert.throws(() => createFastAITokenProvider({ model: 'invalid model' }));
});
test('relay uses only verified endpoint/non-streaming Chat Completions and refuses redirects', async () => {
  const provider = createFastAITokenProvider({ apiKey: fixtureKey, model: 'approved-model', fetchImpl: async (url, options) => {
    assert.equal(url, FASTAITOKEN_ENDPOINT); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, `Bearer ${fixtureKey}`);
    const body = JSON.parse(options.body); assert.deepEqual(body, { model: 'approved-model', messages: [{ role: 'user', content: 'Fixture' }], stream: false, max_tokens: 80, response_format: { type: 'json_object' } }); return response('{"done":true,"content":"Fixture"}');
  } });
  assert.equal(provider.kind, 'fastaitoken-api'); assert.equal(provider.containsCredential(fixtureKey), true);
  const result = await provider.complete({ messages: [{ role: 'user', content: 'Fixture' }], model: 'approved-model', maxTokens: 80, json: true }); assert.equal(result.usage.totalTokens, 6);
  await assert.rejects(provider.complete({ messages: [], model: 'other-model' }), { code: 'INVALID_MODEL' });
});
test('relay reports safe errors, bounded body, no tools and missing usage without false success', async () => {
  for (const [raw, expected] of [
    [new Response(`private provider diagnostic ${fixtureKey}`, { status: 401 }), 'PROVIDER_AUTH'],
    [new Response('not json', { status: 200 }), 'INVALID_RESPONSE'],
    [new Response('x'.repeat(1_000_001), { status: 200 }), 'INVALID_RESPONSE'],
    [new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })), 'OUTPUT_LIMIT'],
    [new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ function: { name: 'shell' } }] } }] })), 'UNSUPPORTED_TOOL_CALL'],
  ]) {
    const provider = createFastAITokenProvider({ apiKey: fixtureKey, model: 'approved-model', fetchImpl: async () => raw });
    await assert.rejects(provider.complete({ messages: [], model: 'approved-model' }), error => { assert.equal(error.code, expected); assert.ok(!error.message.includes(fixtureKey)); return true; });
  }
  const provider = createFastAITokenProvider({ apiKey: fixtureKey, model: 'approved-model', fetchImpl: async () => new Response('{"choices":[{"message":{"content":"Fixture"}}]}') });
  assert.equal((await provider.complete({ messages: [], model: 'approved-model' })).usage, null);
});
test('relay cancellation does not transmit a pre-aborted request', async () => {
  let called = false; const provider = createFastAITokenProvider({ apiKey: fixtureKey, model: 'approved-model', fetchImpl: async () => { called = true; return response('Fixture'); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.complete({ messages: [], model: 'approved-model', signal: controller.signal }), { code: 'CANCELLED' }); assert.equal(called, false);
});
test('relay model/runtime identity flows through real server API and exact admission scope', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-relay-')); let call;
  const provider = createFastAITokenProvider({ apiKey: fixtureKey, model: 'approved-model', fetchImpl: async (url, options) => { call = JSON.parse(options.body); return response('Relay fixture result'); } });
  const app = await createApp({ dataDirectory: directory, provider }); const address = await app.listen(0); const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const api = async (route, method = 'GET', body) => { const response = await fetch(`${base}/api${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; };
  const state = (await api('/bootstrap')).data; assert.equal(state.runtime.provider, 'fastaitoken'); assert.deepEqual(state.runtime.models, ['approved-model']);
  assert.equal((await api('/settings', 'PATCH', { model: 'deepseek-flash' })).status, 400);
  const { data: { conversation } } = await api('/conversations', 'POST', { title: 'Relay fixture' }); const { data: sent } = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Fixture request', requestId: 'relay-check' });
  let run; for (let i = 0; i < 100; i++) { run = (await api(`/runs/${sent.run.id}`)).data.run; if (run.status === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(run.status, 'succeeded'); assert.equal(run.execution.kind, 'fastaitoken-api'); assert.equal(call.model, 'approved-model');
});
