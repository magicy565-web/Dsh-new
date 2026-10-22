// The whole model path in one test: DeepSeek SSE -> runtime provider ->
// bridge adapter -> ctx.llm stream. Uses a fake fetch, so no network or key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider } from '../../../server/provider.mjs';
import { createRuntimeProvider } from '../src/adapter.mjs';
import { createLlm } from '../../../packages/harness-seams/src/llm.mjs';

const encoder = new TextEncoder();

function sseResponse(events) {
  const bytes = encoder.encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''));
  return new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 5) controller.enqueue(bytes.slice(index, index + 5));
      controller.close();
    },
  }), { status: 200 });
}

test('DeepSeek SSE reaches ctx.llm.stream as deltas and usage', async () => {
  const runtime = createDeepSeekProvider({
    apiKey: 'test-key',
    fetchImpl: async () => sseResponse([
      { choices: [{ delta: { content: '海祺' } }] },
      { choices: [{ delta: { content: '在 3 月补货。' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } },
      '[DONE]',
    ]),
  });
  const provider = createRuntimeProvider({
    model: 'deepseek-flash',
    complete: request => runtime.complete(request),
    stream: request => runtime.stream(request),
  });
  const llm = createLlm({ providers: [provider] });

  const chunks = [];
  for await (const chunk of llm.stream({ messages: [{ role: 'user', content: '海祺什么时候补货？' }] }, { actor: 'test' })) chunks.push(chunk);

  const text = chunks.filter(chunk => chunk.type === 'delta').map(chunk => chunk.text).join('');
  assert.equal(text, '海祺在 3 月补货。');
  assert.deepEqual(chunks.at(-1).usage, { inputTokens: 9, outputTokens: 4 });
  assert.equal(chunks.at(-1).model, 'deepseek-flash');
  assert.equal(llm.lastRequest().provider, 'workspace-runtime');
});
