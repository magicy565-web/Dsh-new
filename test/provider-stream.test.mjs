import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider } from '../server/provider.mjs';

const encoder = new TextEncoder();

function sseResponse(events, { chunkSize = 7, signal = null } = {}) {
  const text = events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize));
      controller.close();
    },
  }), { status: 200 });
}

function adapter(fetchImpl) {
  return createDeepSeekProvider({ apiKey: 'test-key', fetchImpl, timeoutMs: 5_000 });
}

async function collect(iterator) {
  const chunks = [];
  for await (const chunk of iterator) chunks.push(chunk);
  return chunks;
}

test('SSE chunks are decoded across byte boundaries and yield deltas plus usage', async () => {
  const provider = adapter(async () => sseResponse([
    { choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { content: '海祺' } }] },
    { choices: [{ delta: { content: '在 3 月补货。' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } },
    '[DONE]',
  ]));
  const chunks = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash' }));
  const text = chunks.filter(chunk => chunk.delta).map(chunk => chunk.delta).join('');
  assert.equal(text, '海祺在 3 月补货。');
  assert.deepEqual(chunks.at(-1), { usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 } });
});

test('the stream request asks for usage and streaming', async () => {
  let body = null;
  const provider = adapter(async (url, init) => {
    body = JSON.parse(init.body);
    return sseResponse([{ choices: [{ delta: { content: 'x' } }] }, '[DONE]']);
  });
  await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-v4-pro', maxTokens: 64 }));
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(body.max_tokens, 64);
});

test('an HTTP error is mapped without leaking provider text', async () => {
  const provider = adapter(async () => new Response('{"error":"secret detail"}', { status: 429 }));
  await assert.rejects(collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash' })), error => {
    assert.equal(error.code, 'PROVIDER_RATE_LIMIT');
    assert.doesNotMatch(error.message, /secret/u);
    return true;
  });
});

test('a length finish reason stops with OUTPUT_LIMIT', async () => {
  const provider = adapter(async () => sseResponse([
    { choices: [{ delta: { content: 'partial' } }] },
    { choices: [{ delta: {}, finish_reason: 'length' }] },
  ]));
  await assert.rejects(collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash' })), error => error.code === 'OUTPUT_LIMIT');
});

test('aborting the request surfaces as CANCELLED', async () => {
  const controller = new AbortController();
  const provider = adapter(async (url, init) => new Response(new ReadableStream({
    start(streamController) {
      streamController.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
      init.signal.addEventListener('abort', () => streamController.error(new Error('aborted')), { once: true });
    },
  }), { status: 200 }));
  const iterator = provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash', signal: controller.signal });
  const first = await iterator.next();
  assert.equal(first.value.delta, 'a');
  controller.abort();
  await assert.rejects(iterator.next(), error => error.code === 'CANCELLED');
});

test('unconfigured and unsupported-model calls fail before any request', async () => {
  const unconfigured = createDeepSeekProvider({ apiKey: '' });
  await assert.rejects(collect(unconfigured.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash' })), error => error.code === 'SETUP_REQUIRED');
  const provider = adapter(async () => { throw new Error('must not be called'); });
  await assert.rejects(collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4' })), error => error.code === 'INVALID_MODEL');
});
