import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadPiProviderConfig, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL_IDS } from '../server/pi-provider-config.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createApp } from '../server/index.mjs';
import { request } from './agent-service.helpers.mjs';

const syntheticKey = 'synthetic-test-only-deepseek-key-never-valid';
const token = 'synthetic-test-only-agent-principal-never-valid';
const sha = value => createHash('sha256').update(value).digest('hex');
const deepseek = extra => loadPiProviderConfig({ PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: syntheticKey, ...extra });

test('pure config preserves original defaults and FastAIToken precedence, never infers DeepSeek from a key', () => {
  assert.deepEqual(loadPiProviderConfig(), { apiKey: '', model: 'gpt-6-sol', baseUrl: 'https://www.fastaitoken.com/v1', providerId: 'workspace-fastaitoken' });
  assert.deepEqual(loadPiProviderConfig({ DEEPSEEK_API_KEY: syntheticKey }), loadPiProviderConfig());
  const original = loadPiProviderConfig({ FASTAITOKEN_API_KEY: 'synthetic-fastaitoken-key', FASTAITOKEN_MODEL: 'synthetic-existing-model', PI_BASE_URL: 'https://existing-gateway.example/v1' });
  assert.equal(original.apiKey, 'synthetic-fastaitoken-key'); assert.equal(original.model, 'synthetic-existing-model'); assert.equal(original.baseUrl, 'https://existing-gateway.example/v1');
  assert.equal(loadPiProviderConfig({ PI_MODEL: 'explicit-existing-model', FASTAITOKEN_MODEL: 'secondary-existing-model' }).model, 'explicit-existing-model');
  const provider = createPiProvider(loadPiProviderConfig()); assert.equal(provider.configured, false); assert.equal(provider.legacyPolicyCompatible, true);
});

test('explicit DeepSeek pins official destination and current explicit models with separate credentials', () => {
  for (const model of DEEPSEEK_MODEL_IDS) {
    const config = deepseek({ PI_MODEL: model, FASTAITOKEN_API_KEY: 'synthetic-other-provider-key' });
    assert.equal(config.apiKey, syntheticKey); assert.equal(config.baseUrl, DEEPSEEK_BASE_URL); assert.equal(config.providerId, 'workspace-deepseek');
    assert.equal(config.model, model);
    const provider = createPiProvider(config); assert.equal(provider.configured, true); assert.equal(provider.legacyPolicyCompatible, false);
    assert.deepEqual(provider.agentUiRecipient, { kind: 'pi-durable', provider: 'workspace-deepseek', model, destination: DEEPSEEK_BASE_URL });
    assert.equal(provider.containsCredential(syntheticKey), true); assert.equal(provider.containsCredential('synthetic-other-provider-key'), false);
    assert.doesNotMatch(JSON.stringify(provider.agentUiRecipient), /key/);
  }
  const missing = createPiProvider(deepseek({ DEEPSEEK_API_KEY: undefined, FASTAITOKEN_API_KEY: 'synthetic-key-must-never-fallback' }));
  assert.equal(missing.configured, false); assert.match(missing.setupMessage, /DEEPSEEK_API_KEY/);
  assert.deepEqual(deepseek({ PI_BASE_URL: DEEPSEEK_BASE_URL + '/' }), deepseek());
});

test('unknown providers, model guessing, credential-bearing URLs and cross-provider key destinations fail before dispatch', () => {
  assert.throws(() => loadPiProviderConfig({ PI_PROVIDER: 'unknown' }), /PI_PROVIDER/);
  assert.throws(() => deepseek({ PI_MODEL: undefined, FASTAITOKEN_MODEL: 'must-not-fallback' }), /explicit PI_MODEL/);
  assert.throws(() => deepseek({ PI_MODEL: 'deepseek-chat' }), /currently supported/);
  assert.throws(() => deepseek({ PI_MODEL: 'deepseek-v4-flash' }), /currently supported/);
  assert.throws(() => deepseek({ PI_MODEL: 'deepseek-flash\n' }), /currently supported/);
  for (const base of ['https://api.deepseek.com/v1', 'http://api.deepseek.com', 'https://api.deepseek.com/anthropic', 'https://api.deepseek.com?key=synthetic', 'https://synthetic-user:synthetic-password@api.deepseek.com', 'https://api.deepseek.com.evil.example', 'https://other-gateway.example/v1']) {
    assert.throws(() => deepseek({ PI_BASE_URL: base }), error => /pinned official/.test(error.message) && !error.message.includes('synthetic-password'));
  }
  assert.throws(() => loadPiProviderConfig({ FASTAITOKEN_API_KEY: 'synthetic-other-key', PI_BASE_URL: DEEPSEEK_BASE_URL }), /requires explicit PI_PROVIDER/);
  assert.throws(() => createPiProvider({ ...deepseek(), baseUrl: 'https://other-destination.example' }), /pinned official/);
  assert.throws(() => deepseek({ DEEPSEEK_API_KEY: 123 }), /settings must be strings/);
});

// Fetch is replaced entirely: no request can escape to a provider or another
// network destination. The original Pi SDK serializes and decodes this wire;
// synthetic SSE counters are explicit test data, never live usage evidence.
async function wireFixture(t, responder) {
  const originalFetch = globalThis.fetch, directory = await fs.mkdtemp('/tmp/workspace-deepseek-wire-test-');
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const outgoing = new Request(input, init);
    assert.equal(outgoing.url, DEEPSEEK_BASE_URL + '/chat/completions', 'only the pinned mocked URL is allowed');
    assert.equal(outgoing.method, 'POST'); assert.equal(outgoing.headers.get('authorization'), 'Bearer ' + syntheticKey);
    const body = await outgoing.json(); calls.push(body);
    return responder(body, outgoing);
  };
  const provider = createPiProvider(deepseek()), app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider,
    agentConfig: { env: {}, principals: [{ subject: 'local-operator', workspaceId: 'local', tokenSha256: sha(token), scopes: ['agent:read', 'agent:submit'] }] } });
  const address = await app.listen(0), base = 'http://127.0.0.1:' + address.port;
  t.after(async () => { await app.close(); globalThis.fetch = originalFetch; await fs.rm(directory, { recursive: true, force: true }); });
  return { app, provider, calls, base };
}

function sse(model, delta, finish = 'stop', usage = true) {
  const frame = { id: 'synthetic-deepseek-response', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  const final = { ...frame, choices: [{ index: 0, delta: {}, finish_reason: finish }],
    ...(usage ? { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 90 } } : {}) };
  return new Response('data: ' + JSON.stringify(frame) + '\n\ndata: ' + JSON.stringify(final) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
async function settled(f, id) {
  for (let i = 0; i < 600; i++) { const run = f.app.runtime.getRun(id).run; if (!['running', 'queued'].includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Synthetic DeepSeek wire run did not settle.');
}
function verifyBody(body) {
  assert.equal(body.model, 'deepseek-flash'); assert.equal(body.stream, true);
  assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.max_tokens, 400);
  assert.equal(body.max_completion_tokens, undefined); assert.equal(body.store, undefined);
  assert.equal(body.reasoning_effort, undefined); assert.equal(body.prompt_cache_retention, undefined);
  assert.equal(body.messages[0].role, 'system'); assert.ok(body.messages.some(message => message.role === 'user'));
  assert.ok(body.messages.every(message => message.role !== 'developer'));
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.ok(body.tools?.every(tool => tool.function.strict === undefined));
}

test('original Pi SDK uses mocked DeepSeek OpenAI wire with explicit non-thinking, bounded tokens and measured synthetic usage', async t => {
  const f = await wireFixture(t, body => { verifyBody(body); return sse(body.model, { content: 'Synthetic DeepSeek wire response only.' }); });
  assert.equal(f.calls.length, 0, 'configuration performs no connectivity probe');
  const conversation = (await f.app.runtime.createConversation({ title: 'Synthetic wire contract' })).conversation;
  const submitted = await f.app.runtime.sendMessage(conversation.id, { content: 'Synthetic public request.', requestId: 'synthetic-deepseek-text' });
  const run = await settled(f, submitted.run.id); assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(f.calls.length, 1); assert.equal(run.usage.completionTokens, 20); assert.equal(run.usage.promptTokens, 100); assert.equal(run.usage.totalTokens, 120);
  assert.equal(f.app.runtime.bootstrap().messages.at(-1).content, 'Synthetic DeepSeek wire response only.');
  assert.ok(run.piNativeTaskId); assert.equal(run.execution.endpointFingerprint, f.provider.endpointFingerprint);
});

test('mocked DeepSeek tool SSE completes original procurement stages and exact-request dedupe without another engine', async t => {
  const f = await wireFixture(t, body => {
    verifyBody(body); assert.ok(body.tools.some(tool => tool.function.name === 'workspace_complete_preset_stage'));
    return sse(body.model, { tool_calls: [{ index: 0, id: 'synthetic-stage-' + Math.random().toString(36).slice(2), type: 'function',
      function: { name: 'workspace_complete_preset_stage', arguments: JSON.stringify({ analysis: [{ text: '合成接口测试：公开规格仍需核对，报价待回收。', sources: ['input.product'] }], recommendations: [{ text: '请核对原文书。', sources: [] }], questions: [{ text: '实际币种是什么？', sources: [] }] }) } }] }, 'tool_calls');
  });
  const options = { method: 'POST', token, headers: { 'Idempotency-Key': 'synthetic-deepseek-original-task' },
    body: { type: 'procurement', title: '合成 DeepSeek wire 文书测试', input: { product: 'Public synthetic bottle', spec: '500 ml stainless steel', quantity: 100 } } };
  const accepted = await request(f.base, '/api/agent/v1/tasks', options); assert.equal(accepted.status, 201, accepted.text);
  let task;
  for (let i = 0; i < 1000; i++) { task = f.app.store.read().workspaceAgentTasks.tasks.find(item => item.id === accepted.json.taskId); if (['done', 'failed', 'interrupted'].includes(task?.status)) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(task.status, 'done', JSON.stringify(task.result)); assert.equal(task.result.completion, 'documents_ready'); assert.equal(task.result.businessGoalAchieved, false);
  assert.equal(f.calls.length, 4); assert.equal(task.deliverables.length, 3);
  const repeated = await request(f.base, '/api/agent/v1/tasks', options); assert.equal(repeated.json.taskId, task.id); assert.equal(f.calls.length, 4);
  for (const file of task.deliverables) assert.equal(sha(file.content), file.sha256);
  assert.ok(f.app.store.read().runs.every(run => run.piNativeTaskId && run.usage.completionTokens === 20));
});

test('mocked provider authentication rejection remains a real failed original run with no fallback or automatic retry', async t => {
  const f = await wireFixture(t, body => { verifyBody(body); return new Response(JSON.stringify({ error: { message: 'Synthetic mocked authentication rejection.', type: 'authentication_error' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }); });
  const conversation = (await f.app.runtime.createConversation({})).conversation;
  const submitted = await f.app.runtime.sendMessage(conversation.id, { content: 'Synthetic rejected request.', requestId: 'synthetic-deepseek-rejection' });
  const run = await settled(f, submitted.run.id); assert.equal(run.status, 'failed'); assert.equal(f.calls.length, 1);
  assert.equal(run.usage.completionTokens, null, 'failure never invents measured usage');
});
