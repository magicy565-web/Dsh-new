import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeProvider } from '../src/adapter.mjs';
import { ERROR } from '../../../packages/harness-contracts/src/index.mjs';

const request = { messages: [{ role: 'user', content: 'hi' }] };

async function collect(iterator) {
  const chunks = [];
  for await (const chunk of iterator) chunks.push(chunk);
  return chunks;
}

test('a runtime stream is mapped to deltas and seam usage fields', async () => {
  const provider = createRuntimeProvider({
    model: 'deepseek-flash',
    async *stream() {
      yield { delta: '你' };
      yield { delta: '好' };
      yield { usage: { promptTokens: 5, completionTokens: 2 } };
    },
  });
  const chunks = await collect(provider.stream(request));
  assert.equal(chunks.filter(chunk => chunk.delta).map(chunk => chunk.delta).join(''), '你好');
  assert.deepEqual(chunks.at(-1).usage, { inputTokens: 5, outputTokens: 2 });
  assert.equal(provider.model, 'deepseek-flash');
});

test('a runtime stream that only accumulates usage still completes', async () => {
  const provider = createRuntimeProvider({ stream: async function* () { yield { usage: {} }; } });
  const chunks = await collect(provider.stream(request));
  assert.deepEqual(chunks, [{ usage: {} }]);
});

test('provider errors are mapped to seam codes without leaking text', async () => {
  const cancelled = Object.assign(new Error('cancelled by user'), { code: 'CANCELLED' });
  const provider = createRuntimeProvider({ stream: async function* () { throw cancelled; } });
  await assert.rejects(collect(provider.stream(request)), error => {
    assert.equal(error.code, ERROR.llmAborted);
    assert.doesNotMatch(error.message, /user/u);
    return true;
  });

  const broken = createRuntimeProvider({ stream: async function* () { throw new Error('secret upstream text'); } });
  await assert.rejects(collect(broken.stream(request)), error => {
    assert.equal(error.code, ERROR.llmFailed);
    assert.doesNotMatch(error.message, /secret/u);
    return true;
  });
});

test('an abort between chunks stops the stream', async () => {
  const controller = new AbortController();
  const provider = createRuntimeProvider({
    async *stream() {
      yield { delta: 'a' };
      controller.abort();
      yield { delta: 'b' };
    },
  });
  const iterator = provider.stream({ ...request, signal: controller.signal });
  const first = await iterator.next();
  assert.equal(first.value.delta, 'a');
  await assert.rejects(iterator.next(), error => error.code === ERROR.llmAborted);
});

test('a provider needs at least one of complete or stream', () => {
  assert.throws(() => createRuntimeProvider({}), /complete or stream/u);
});
