import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLlm, createLlmProvider, createEchoProvider, createReplayProvider, createUnavailableProvider } from '../src/llm.mjs';
import { createHarness } from '../../harness-kernel/src/app.mjs';

const code = expected => error => error?.code === expected;
const messages = text => [{ role: 'user', content: text }];

test('an unconfigured harness fails closed instead of inventing a reply', async t => {
  const llm = createLlm();
  await assert.rejects(llm.complete({ messages: messages('hi') }), code('HARNESS_LLM_NOT_CONFIGURED'));
  assert.deepEqual(llm.providers(), []);
  const unavailable = createUnavailableProvider();
  const withProvider = createLlm({ providers: [unavailable] });
  await assert.rejects(withProvider.complete({ messages: messages('hi') }), code('HARNESS_LLM_NOT_CONFIGURED'));
  // audit records the failed attempt without leaking message bodies
  assert.equal(withProvider.audit().at(-1).ok, false);
  assert.equal(withProvider.audit().at(-1).errorCode, 'HARNESS_LLM_NOT_CONFIGURED');
  assert.doesNotMatch(JSON.stringify(withProvider.audit()), /hi/u);
});

test('echo and replay providers return bounded, validated results', async t => {
  const echo = createEchoProvider();
  const llm = createLlm({ providers: [echo] });
  const echoed = await llm.complete({ messages: [{ role: 'system', content: 'be brief' }, ...messages('hello harness')] });
  assert.equal(echoed.text, 'hello harness');
  assert.equal(echoed.provider, 'echo');

  const replay = createReplayProvider({ responses: [
    { text: 'checking', toolCalls: [{ name: 'inquiry_recovery_status', arguments: {} }], usage: { inputTokens: 12, outputTokens: 3 } },
    { text: 'done', toolCalls: [] },
  ] });
  const scripted = createLlm({ providers: [replay] });
  const first = await scripted.complete({ messages: messages('go'), tools: [{ name: 'inquiry_recovery_status' }] });
  assert.equal(first.text, 'checking');
  assert.deepEqual(first.toolCalls, [{ name: 'inquiry_recovery_status', arguments: {} }]);
  assert.deepEqual(first.usage, { inputTokens: 12, outputTokens: 3 });
  const second = await scripted.complete({ messages: messages('again') });
  assert.equal(second.text, 'done');
  await assert.rejects(scripted.complete({ messages: messages('third') }), code('HARNESS_LLM_EXHAUSTED'));
  assert.equal(replay.requests.length, 3);
  assert.deepEqual(replay.requests[0], { messageCount: 1, toolCount: 1, roles: ['user'] });
});

test('provider registration is validated and explicit selection is required when ambiguous', async t => {
  const llm = createLlm();
  assert.throws(() => llm.register({ id: 'Bad Id', complete: async () => ({}) }), code('HARNESS_LLM_INVALID'));
  assert.throws(() => llm.register({ id: 'x' }), code('HARNESS_LLM_INVALID'));
  llm.register(createEchoProvider({ id: 'a' }));
  assert.throws(() => llm.register(createEchoProvider({ id: 'a' })), code('HARNESS_LLM_DUPLICATE'));
  llm.register(createEchoProvider({ id: 'b' }));
  await assert.rejects(llm.complete({ messages: messages('x') }), code('HARNESS_LLM_PROVIDER_REQUIRED'));
  const picked = await llm.complete({ provider: 'b', messages: messages('x') });
  assert.equal(picked.provider, 'b');
  await assert.rejects(llm.complete({ provider: 'missing', messages: messages('x') }), code('HARNESS_LLM_PROVIDER_REQUIRED'));
  assert.deepEqual(llm.providers().map(provider => provider.id), ['a', 'b']);
});

test('a throwing provider becomes HARNESS_LLM_FAILED without leaking its message; abort is explicit', async t => {
  const secret = 'sk-live-should-not-leak';
  const broken = { id: 'broken', complete: async () => { throw new Error(`boom ${secret}`); } };
  const llm = createLlm({ providers: [broken] });
  await assert.rejects(llm.complete({ messages: messages('x') }), error => {
    assert.equal(error.code, 'HARNESS_LLM_FAILED');
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secret, 'u'));
    return true;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(llm.complete({ messages: messages('x'), signal: controller.signal }), code('HARNESS_LLM_ABORTED'));
});

test('request and result shapes are bounded', async t => {
  const llm = createLlm({ providers: [createEchoProvider()] });
  await assert.rejects(llm.complete({ messages: [] }), code('HARNESS_LLM_INVALID'));
  await assert.rejects(llm.complete({ messages: [{ role: 'wizard', content: 'x' }] }), code('HARNESS_LLM_INVALID'));
  await assert.rejects(llm.complete({ messages: [{ role: 'user', content: 'x'.repeat(200_001) }] }), code('HARNESS_LLM_INVALID'));
  const bad = createLlm({ providers: [{ id: 'bad', complete: async () => ({ text: 42 }) }] });
  await assert.rejects(bad.complete({ messages: messages('x') }), code('HARNESS_LLM_INVALID'));
});

test('audit is capped, metadata-only, and lastRequest carries no bodies', async t => {
  const llm = createLlm({ providers: [createEchoProvider()] });
  for (let index = 0; index < 105; index += 1) await llm.complete({ messages: messages(`secret-${index}`) });
  assert.equal(llm.audit().length, 100);
  assert.doesNotMatch(JSON.stringify(llm.audit()), /secret-/u);
  assert.deepEqual(Object.keys(llm.lastRequest()).sort(), ['at', 'messageCount', 'model', 'provider']);
});

test('the provider mounts on the real kernel and is visible as ctx.llm', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-llm-'));
  const file = path.join(directory, 'llm.yml');
  await fs.writeFile(file, 'version: 1\nname: llm\nserver: { host: 127.0.0.1, port: 0 }\nplugins:\n  - id: llm\n    name: \'@workspace-harness/seams/llm\'\n', 'utf8');
  const harness = await createHarness({ compositionPath: file, root: path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')) });
  t.after(async () => { await harness.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id), ['llm']);
  const llm = harness.ctx.reflect.get('llm', false);
  assert.deepEqual(llm.providers(), []);
  llm.register(createEchoProvider());
  const result = await llm.complete({ messages: messages('via kernel') });
  assert.equal(result.text, 'via kernel');
  assert.equal(typeof createLlmProvider, 'function');
});
