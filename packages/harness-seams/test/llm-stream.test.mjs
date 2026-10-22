// ctx.llm.stream: deltas, provider adaptation, cancellation and error mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/llm.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';

const request = { messages: [{ role: 'user', content: '你好' }] };

async function collect(iterator) {
  const chunks = [];
  for await (const chunk of iterator) chunks.push(chunk);
  return chunks;
}

test('a streaming provider yields deltas and one done', async () => {
  const llm = createLlm({
    providers: [{
      id: 'streamer',
      model: 'stream-1',
      async *stream() {
        yield { delta: '你' };
        yield { delta: '好' };
        yield { usage: { outputTokens: 2 } };
      },
    }],
  });
  const chunks = await collect(llm.stream(request, { actor: 'test' }));
  assert.deepEqual(chunks.map(chunk => chunk.type), ['delta', 'delta', 'done']);
  assert.equal(chunks[0].text, '你');
  assert.equal(chunks.at(-1).text, '你好');
  assert.deepEqual(chunks.at(-1).usage, { outputTokens: 2 });
  assert.equal(chunks.at(-1).model, 'stream-1');
  assert.equal(llm.lastRequest().provider, 'streamer');
});

test('a complete-only provider is adapted into a single delta', async () => {
  const llm = createLlm({
    providers: [{ id: 'oneshot', async complete() { return { text: '一次性回答', usage: { inputTokens: 3 } }; } }],
  });
  const chunks = await collect(llm.stream(request));
  assert.deepEqual(chunks.map(chunk => chunk.type), ['delta', 'done']);
  assert.equal(chunks[0].text, '一次性回答');
  assert.equal(chunks.at(-1).text, '一次性回答');
  assert.deepEqual(chunks.at(-1).usage, { inputTokens: 3 });
});

test('a streamed answer is bounded', async () => {
  const llm = createLlm({
    providers: [{
      id: 'huge',
      async *stream() {
        for (let index = 0; index < 40; index += 1) yield { delta: 'x'.repeat(10_000) };
      },
    }],
  });
  await assert.rejects(collect(llm.stream(request)), error => error.code === ERROR.llmInvalid);
});

test('provider errors are mapped and never echoed', async () => {
  const llm = createLlm({
    providers: [{
      id: 'broken',
      async *stream() {
        yield { delta: 'a' };
        throw new Error('secret prompt text');
      },
    }],
  });
  await assert.rejects(collect(llm.stream(request)), error => {
    assert.equal(error.code, ERROR.llmFailed);
    assert.doesNotMatch(error.message, /secret/u);
    return true;
  });
});

test('aborting the signal stops the stream', async () => {
  const controller = new AbortController();
  const llm = createLlm({
    providers: [{
      id: 'slow',
      async *stream() {
        yield { delta: 'a' };
        controller.abort();
        yield { delta: 'b' };
      },
    }],
  });
  await assert.rejects(collect(llm.stream({ ...request, signal: controller.signal })), error => error.code === ERROR.llmAborted);
});

test('a provider that only streams cannot be called through complete', async () => {
  const llm = createLlm({
    providers: [{ id: 'stream-only', async *stream() { yield { delta: 'x' }; } }],
  });
  await assert.rejects(llm.complete(request), error => error.code === ERROR.llmInvalid);
});

test('no provider fails closed', async () => {
  const llm = createLlm({});
  await assert.rejects(collect(llm.stream(request)), error => error.code === ERROR.llmNotConfigured);
});
