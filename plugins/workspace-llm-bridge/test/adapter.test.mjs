import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../../../packages/harness-seams/src/llm.mjs';
import { createRuntimeProvider, mapProviderError } from '../src/adapter.mjs';

const harnessError = code => error => error?.code === code;

function fixture(complete, options = {}) {
  const provider = createRuntimeProvider({ complete, ...options });
  return { provider, llm: createLlm({ providers: [provider] }) };
}

test('the adapter maps the runtime result onto the ctx.llm result contract', async t => {
  const calls = [];
  const { llm } = fixture(async request => {
    calls.push(request);
    return { content: '  hello from the runtime  ', usage: { promptTokens: 12, completionTokens: 5 } };
  });
  const result = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.text, '  hello from the runtime  ');
  assert.equal(result.provider, 'workspace-runtime');
  assert.equal(result.model, 'deepseek-flash');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 5 });
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(calls[0].model, 'deepseek-flash');
  assert.equal(calls[0].maxTokens, 1600);
});

test('the adapter forwards the requested model, json mode and abort signal', async t => {
  const calls = [];
  const controller = new AbortController();
  const { llm } = fixture(async request => {
    calls.push(request);
    return { content: 'ok' };
  }, { model: 'deepseek-flash', maxTokens: 321 });
  await llm.complete({
    messages: [{ role: 'system', content: 's', name: 'ignored' }, { role: 'user', content: 'u' }],
    model: 'deepseek-v4-pro', json: true, signal: controller.signal,
  });
  assert.equal(calls[0].model, 'deepseek-v4-pro');
  assert.equal(calls[0].json, true);
  assert.equal(calls[0].maxTokens, 321);
  assert.equal(calls[0].signal, controller.signal);
  assert.deepEqual(calls[0].messages, [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], 'only role/content cross the bridge');
});

test('provider error codes map to seam codes without leaking provider text', async t => {
  const cases = [
    ['CANCELLED', 'HARNESS_LLM_ABORTED'],
    ['SETUP_REQUIRED', 'HARNESS_LLM_NOT_CONFIGURED'],
    ['INVALID_MODEL', 'HARNESS_LLM_INVALID'],
    ['PROVIDER_AUTH', 'HARNESS_LLM_FAILED'],
  ];
  for (const [runtimeCode, expected] of cases) {
    const { llm } = fixture(async () => {
      const error = new Error(`secret sk-123 ${runtimeCode}`);
      error.code = runtimeCode;
      throw error;
    });
    await assert.rejects(llm.complete({ messages: [{ role: 'user', content: 'hi' }] }), error => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /secret|sk-123/u, 'provider text must not leak');
      return true;
    });
  }
  const mapped = mapProviderError(Object.assign(new Error('leaky'), { code: 'PROVIDER_BALANCE' }), 'p');
  assert.equal(mapped.code, 'HARNESS_LLM_FAILED');
  assert.doesNotMatch(mapped.message, /leaky/u);
});

test('the adapter refuses an aborted call, empty text and invalid messages', async t => {
  const aborted = createRuntimeProvider({ complete: async () => { throw Object.assign(new Error('stop'), { code: 'CANCELLED' }); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(aborted.complete({ messages: [{ role: 'user', content: 'x' }], signal: controller.signal }), harnessError('HARNESS_LLM_ABORTED'));

  const empty = createRuntimeProvider({ complete: async () => ({ content: '   ' }) });
  await assert.rejects(empty.complete({ messages: [{ role: 'user', content: 'x' }] }), harnessError('HARNESS_LLM_FAILED'));

  const invalid = createRuntimeProvider({ complete: async () => ({ content: 'x' }) });
  await assert.rejects(invalid.complete({ messages: [] }), harnessError('HARNESS_LLM_INVALID'));
  await assert.rejects(invalid.complete({}), harnessError('HARNESS_LLM_INVALID'));
  assert.throws(() => createRuntimeProvider({}), TypeError);
});
