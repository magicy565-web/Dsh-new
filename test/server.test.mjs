import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createApp } from '../server/index.mjs';
import { createDeepSeekProvider, ProviderError } from '../server/provider.mjs';
import { openStore } from '../server/store.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check, message = 'condition') { for (let i = 0; i < 400; i += 1) { const result = await check(); if (result) return result; await sleep(5); } throw new Error(`Timed out waiting for ${message}`); }
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture(t, provider = createDeepSeekProvider(), options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-server-test-'));
  const app = await createApp({ dataDirectory: directory, provider, ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, method = 'GET', body, headers = {}) {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...(await response.json()) };
  }
  return { app, api, directory, base };
}

test('missing key saves chat and goal honestly without calling a provider', async t => {
  let calls = 0;
  const { api } = await fixture(t, { configured: false, complete: async () => { calls += 1; throw new Error('Must not be called'); } });
  const { conversation } = await api('/api/conversations', 'POST', {});
  const sent = await api(`/api/conversations/${conversation.id}/messages`, 'POST', { content: '你好', requestId: 'request-one' });
  assert.equal(sent.status, 202);
  assert.equal(sent.run.status, 'blocked');
  const { goal } = await api('/api/goals', 'POST', { title: 'Write a brief', description: '' });
  const started = await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' });
  assert.equal(started.goal.status, 'blocked');
  const bootstrap = await api('/api/bootstrap');
  assert.equal(bootstrap.runtime.configured, false);
  assert.equal(bootstrap.runtime.kind, 'deepseek-api');
  assert.equal(bootstrap.messages[0].content, '你好');
  assert.equal(bootstrap.messages[1].error.code, 'SETUP_REQUIRED');
  assert.equal(calls, 0);
});

test('chat repeated clicks are idempotent, conflicting reuse rejected, active chat fenced', async t => {
  const pending = deferred(); let calls = 0;
  const { api } = await fixture(t, { configured: true, complete: () => { calls += 1; return pending.promise; } });
  const { conversation } = await api('/api/conversations', 'POST', {});
  const route = `/api/conversations/${conversation.id}/messages`;
  const [first, second] = await Promise.all([api(route, 'POST', { content: 'Hello', requestId: 'same-key' }), api(route, 'POST', { content: 'Hello', requestId: 'same-key' })]);
  assert.equal(first.message.id, second.message.id);
  assert.equal(calls, 1);
  assert.equal((await api(route, 'POST', { content: 'Different', requestId: 'same-key' })).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await api(route, 'POST', { content: 'Another', requestId: 'another-key' })).error.code, 'CONVERSATION_BUSY');
  pending.resolve({ content: 'Actual injected-provider reply' });
  await until(async () => (await api('/api/bootstrap')).conversations[0].status === 'idle');
  const state = await api('/api/bootstrap');
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1].content, 'Actual injected-provider reply');
  assert.equal(state.messages[1].status, 'complete');
});

test('cancelled chat cannot be overwritten by late provider success', async t => {
  const pending = deferred();
  const { api } = await fixture(t, { configured: true, complete: () => pending.promise });
  const { conversation } = await api('/api/conversations', 'POST', {});
  await api(`/api/conversations/${conversation.id}/messages`, 'POST', { content: 'Wait' });
  await api(`/api/conversations/${conversation.id}/cancel`, 'POST', {});
  pending.resolve({ content: 'STALE OUTPUT' });
  await sleep(30);
  const state = await api('/api/bootstrap');
  assert.equal(state.conversations[0].status, 'idle');
  assert.equal(state.messages[1].status, 'cancelled');
  assert.equal(state.messages[1].content, '');
});

test('goal loops are bounded, pause at step limit and only mark text ready for review', async t => {
  let calls = 0;
  const { api } = await fixture(t, { configured: true, complete: async input => { calls += 1; assert.equal(input.json, true); return { content: JSON.stringify({ done: calls === 3, content: `Draft part ${calls}`, nextStep: 'Review the draft' }) }; } });
  const { goal } = await api('/api/goals', 'POST', { title: 'Write a memo', maxSteps: 2, requestId: 'goal-create' });
  const duplicate = await api('/api/goals', 'POST', { title: 'Write a memo', maxSteps: 2, requestId: 'goal-create' });
  assert.equal(duplicate.goal.id, goal.id);
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start', requestId: 'start-goal' });
  await until(async () => (await api('/api/bootstrap')).goals[0].status === 'paused');
  let state = await api('/api/bootstrap');
  assert.equal(calls, 2);
  assert.equal(state.goals[0].stepCount, 2);
  assert.equal(state.goals[0].lastError.code, 'STEP_LIMIT');
  const replay = await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start', requestId: 'start-goal' });
  assert.equal(replay.duplicate, true);
  assert.equal(calls, 2);
  assert.equal((await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'resume' })).error.code, 'STEP_LIMIT');
  await api(`/api/goals/${goal.id}`, 'PATCH', { maxSteps: 3, action: 'resume' });
  await until(async () => (await api('/api/bootstrap')).goals[0].status === 'review_required');
  state = await api('/api/bootstrap');
  assert.equal(state.goals[0].output, 'Draft part 3');
  assert.equal(state.goals[0].stepCount, 3);
  assert.equal((await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' })).error.code, 'GOAL_TERMINAL');
});

test('pause and resume fences earlier goal revision even when provider ignores abort', async t => {
  const first = deferred(); let calls = 0;
  const { api } = await fixture(t, { configured: true, complete: () => { calls += 1; return calls === 1 ? first.promise : Promise.resolve({ content: JSON.stringify({ done: true, content: 'NEW REVISION' }) }); } });
  const { goal } = await api('/api/goals', 'POST', { title: 'Plan', maxSteps: 3 });
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' });
  await until(() => calls === 1);
  const paused = await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'pause' });
  assert.equal(paused.goal.status, 'paused');
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'resume' });
  await until(async () => (await api('/api/bootstrap')).goals[0].status === 'review_required');
  first.resolve({ content: JSON.stringify({ done: true, content: 'OLD REVISION' }) });
  await sleep(30);
  const state = await api('/api/bootstrap');
  assert.equal(state.goals[0].output, 'NEW REVISION');
  assert.equal(state.goals[0].stepCount, 1);
  assert.equal(state.messages.some(message => message.content === 'OLD REVISION'), false);
  assert.equal(state.messages.filter(message => message.status === 'cancelled').length, 1);
});

test('cancel goal and delete conversation prevent all late result resurrection', async t => {
  const pending = deferred(); let called = false;
  const { api } = await fixture(t, { configured: true, complete: () => { called = true; return pending.promise; } });
  const { goal } = await api('/api/goals', 'POST', { title: 'A plan' });
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' });
  await until(() => called);
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'cancel' });
  await api(`/api/conversations/${goal.conversationId}`, 'DELETE');
  pending.resolve({ content: JSON.stringify({ done: true, content: 'Never stored' }) });
  await sleep(30);
  const state = await api('/api/bootstrap');
  assert.equal(state.conversations.length, 0);
  assert.equal(state.messages.length, 0);
  assert.equal(state.goals.length, 0);
});

test('invalid goal output and safe provider errors become persisted failed states', async t => {
  let calls = 0;
  const { api } = await fixture(t, { configured: true, complete: async () => { if (++calls === 1) return { content: 'Not JSON' }; throw new ProviderError('PROVIDER_RATE_LIMIT', 'Please retry later.'); } });
  const { goal } = await api('/api/goals', 'POST', { title: 'Draft' });
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' });
  await until(async () => (await api('/api/bootstrap')).goals[0].status === 'failed');
  assert.equal((await api('/api/bootstrap')).goals[0].lastError.code, 'INVALID_GOAL_RESPONSE');
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'resume' });
  await until(async () => (await api('/api/bootstrap')).goals[0].lastError?.code === 'PROVIDER_RATE_LIMIT');
});

test('goal time budget fails safely and rejects late provider success', async t => {
  const { api } = await fixture(t, { configured: true, complete: async () => { await sleep(40); return { content: JSON.stringify({ done: true, content: 'Too late' }) }; } }, { goalTimeoutMs: 15 });
  const { goal } = await api('/api/goals', 'POST', { title: 'Draft' });
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' });
  await until(async () => (await api('/api/bootstrap')).goals[0].status === 'failed');
  const state = await api('/api/bootstrap');
  assert.equal(state.goals[0].lastError.code, 'GOAL_TIMEOUT');
  assert.equal(state.goals[0].output, '');
});

test('settings, memories, library outputs and conversations persist across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-persist-test-'));
  const first = await createApp({ dataDirectory: directory });
  const { conversation } = await first.runtime.createConversation({ title: 'Persisted title' });
  await first.runtime.updateSettings({ name: '我的助手', model: 'gpt-6-sol', maxGoalSteps: 4 });
  const { memory } = await first.runtime.createMemory({ content: 'Reply in short paragraphs', category: 'preference' });
  await first.runtime.updateMemory(memory.id, { content: 'Prefer concise paragraphs' });
  await first.runtime.createMemory({ content: 'Saved draft', category: 'saved' });
  await first.close();
  const second = await createApp({ dataDirectory: directory });
  t.after(async () => { await second.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const state = second.runtime.bootstrap();
  assert.equal(state.conversations[0].id, conversation.id);
  assert.equal(state.settings.name, '我的助手');
  assert.equal(state.settings.model, 'gpt-6-sol');
  assert.equal(state.memories[0].content, 'Prefer concise paragraphs');
  assert.equal(state.memories[1].category, 'saved');
  await second.runtime.deleteMemory(memory.id);
  assert.equal(second.runtime.bootstrap().memories.length, 1);
});

test('restart recovers interrupted state without making provider requests', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-restart-test-'));
  const first = await createApp({ dataDirectory: directory });
  const { goal } = await first.runtime.createGoal({ title: 'Interrupted goal' });
  await first.close();
  const filename = path.join(directory, 'workspace.json');
  const seed = JSON.parse(await fs.readFile(filename, 'utf8'));
  seed.goals[0].status = 'running'; seed.goals[0].runId = 'lost-run';
  seed.conversations[0].status = 'running'; seed.conversations[0].activeRunId = 'lost-run';
  seed.messages.push({ id: 'pending-message', conversationId: goal.conversationId, role: 'assistant', status: 'pending', content: '', runId: 'lost-run' });
  await fs.writeFile(filename, JSON.stringify(seed));
  let calls = 0;
  const second = await createApp({ dataDirectory: directory, provider: { configured: true, complete: async () => { calls += 1; } } });
  t.after(async () => { await second.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const state = second.runtime.bootstrap();
  assert.equal(state.goals[0].status, 'paused');
  assert.equal(state.goals[0].lastError.code, 'INTERRUPTED');
  assert.equal(state.conversations[0].status, 'failed');
  assert.equal(state.messages[1].status, 'failed');
  assert.equal(calls, 0);
});

test('writer lock refuses a second server; malformed store is never overwritten', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-store-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await openStore(directory);
  await assert.rejects(openStore(directory), /already open/);
  await store.close();
  await fs.writeFile(path.join(directory, 'workspace.json'), 'broken-json');
  await assert.rejects(openStore(directory), /no data has been overwritten/);
  assert.equal(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8'), 'broken-json');
});

test('localhost-only, hostile origins, malformed payloads and secret settings are rejected', async t => {
  const { api, app, base } = await fixture(t);
  const badHostStatus = await new Promise((resolve, reject) => { const req = http.get(`${base}/api/bootstrap`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); });
  assert.equal(badHostStatus, 403);
  assert.equal((await api('/api/conversations', 'POST', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await api('/api/settings', 'PATCH', { apiKey: 'do-not-store' })).error.code, 'INVALID_SETTING');
  assert.equal((await api('/api/goals', 'POST', { title: 'Test', maxSteps: 999 })).status, 400);
  assert.equal((await api('/api/conversations', 'POST', [])).status, 400);
  await assert.rejects(app.listen(0, '0.0.0.0'), /loopback/);
});

test('provider adapter sends only to official endpoint and safely redacts HTTP errors', async () => {
  let observed;
  const provider = createDeepSeekProvider({ apiKey: 'fixture-only-key', fetchImpl: async (url, init) => { observed = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { content: 'Fixture result' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }), { status: 200 }); } });
  const result = await provider.complete({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Test' }], json: true });
  assert.equal(observed.url, 'https://api.deepseek.com/chat/completions');
  const body = JSON.parse(observed.init.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(result.content, 'Fixture result');
  const rejected = createDeepSeekProvider({ apiKey: 'fixture-only-key', fetchImpl: async () => new Response('SECRET PROVIDER RAW BODY', { status: 401 }) });
  await assert.rejects(rejected.complete({ model: 'deepseek-flash', messages: [] }), error => error.code === 'PROVIDER_AUTH' && !error.message.includes('SECRET'));
});

test('provider aborts and timeouts surface distinct safe errors', async () => {
  const waitingFetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private transport details')), { once: true }));
  const provider = createDeepSeekProvider({ apiKey: 'fixture-only-key', fetchImpl: waitingFetch, timeoutMs: 15 });
  // Keep a short timer alive: AbortSignal.timeout deliberately does not keep Node alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(provider.complete({ model: 'deepseek-flash', messages: [] }), error => error.code === 'PROVIDER_TIMEOUT'); } finally { clearTimeout(keepAlive); }
  const controller = new AbortController();
  const request = provider.complete({ model: 'deepseek-flash', messages: [], signal: controller.signal });
  controller.abort();
  await assert.rejects(request, error => error.code === 'CANCELLED');
});

test('saved library items are not sent to model, explicit memories are', async t => {
  let sent;
  const { app } = await fixture(t, { configured: true, complete: async request => { sent = request; return { content: 'Reply' }; } });
  const { memory } = await app.runtime.createMemory({ content: 'PREFERENCE_SENT', category: 'general' });
  await app.runtime.createMemory({ content: 'LIBRARY_NOT_SENT', category: 'saved' });
  const { conversation } = await app.runtime.createConversation({});
  await app.runtime.sendMessage(conversation.id, { content: 'Hi', inputContext: { memoryIds: [memory.id] } });
  await until(() => sent);
  assert.equal(JSON.stringify(sent.messages).includes('PREFERENCE_SENT'), true);
  assert.equal(JSON.stringify(sent.messages).includes('LIBRARY_NOT_SENT'), false);
});

test('explicit review completion is guarded and idempotent', async t => {
  const { api } = await fixture(t, { configured: true, complete: async () => ({ content: JSON.stringify({ done: true, content: 'Review this draft' }) }) });
  const { goal } = await api('/api/goals', 'POST', { title: 'Draft' });
  assert.equal((await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'complete' })).error.code, 'REVIEW_NOT_READY');
  await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'start' });
  await until(async () => (await api('/api/bootstrap')).goals[0].status === 'review_required');
  const reviewed = await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'complete', requestId: 'review' });
  assert.equal(reviewed.goal.status, 'completed');
  const duplicate = await api(`/api/goals/${goal.id}`, 'PATCH', { action: 'complete', requestId: 'review' });
  assert.equal(duplicate.duplicate, true);
});

test('native provider seam reports its real mode and preserves event/session provenance', async t => {
  let input;
  const provider = { configured: true, kind: 'deepseek-harness', model: 'fixture-native-model', capabilities: ['fixture-native'], limitations: ['Fixture only'], complete: async request => { input = request; return { content: 'Native fixture result', nativeSessionId: 'fixture-session', nativeEvents: [{ type: 'session.created' }], runtime: 'deepseek-harness' }; } };
  const { app } = await fixture(t, provider);
  const { conversation } = await app.runtime.createConversation({});
  await app.runtime.sendMessage(conversation.id, { content: 'Native request' });
  await until(() => app.runtime.bootstrap().messages.some(message => message.role === 'assistant' && message.status === 'complete'));
  const state = app.runtime.bootstrap();
  assert.equal(state.runtime.kind, 'deepseek-harness');
  assert.equal(state.runtime.model, 'fixture-native-model');
  assert.equal(state.runtime.limits.maxConcurrentRuns, 1);
  assert.equal(state.messages[1].nativeSessionId, 'fixture-session');
  assert.deepEqual(state.messages[1].nativeEvents, [{ type: 'session.created' }]);
  assert.equal(state.activity.at(-1).nativeSessionId, 'fixture-session');
  assert.equal(input.messages[0].content.includes('user-reviewed native Harness profile'), true);
  assert.equal(input.messages[0].content.includes('You have NO'), false);
});

test('native setup remains blocked until explicit runtime requirements are met', async t => {
  const { app } = await fixture(t, { configured: false, kind: 'deepseek-harness' });
  const { conversation } = await app.runtime.createConversation({});
  await app.runtime.sendMessage(conversation.id, { content: 'Saved but not run' });
  const state = app.runtime.bootstrap();
  assert.equal(state.messages[1].status, 'blocked');
  assert.match(state.messages[1].error.message, /DSH_BIN/);
});

test('runtime concurrency cap refuses a fourth request without dropping saved work', async t => {
  const pending = deferred();
  const { app } = await fixture(t, { configured: true, complete: () => pending.promise });
  for (let i = 0; i < 3; i += 1) { const { conversation } = await app.runtime.createConversation({}); await app.runtime.sendMessage(conversation.id, { content: `Message ${i}` }); }
  const { conversation } = await app.runtime.createConversation({});
  await assert.rejects(app.runtime.sendMessage(conversation.id, { content: 'Too many' }), error => error.code === 'BUSY');
  assert.equal(app.runtime.bootstrap().messages.length, 6);
  pending.resolve({ content: 'Finished' });
});

test('native shutdown awaits owned provider teardown before releasing its store', async t => {
  let stopped = false;
  const { app } = await fixture(t, { configured: true, kind: 'deepseek-harness', complete: ({ signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { setTimeout(() => { stopped = true; reject(new ProviderError('CANCELLED', 'Stopped')); }, 35); }, { once: true }); }) });
  const { conversation } = await app.runtime.createConversation({});
  await app.runtime.sendMessage(conversation.id, { content: 'Run' });
  await app.close();
  assert.equal(stopped, true);
});

test('official adapter treats absent usage counters as unknown, never fabricated zero', async () => {
  const provider = createDeepSeekProvider({ apiKey: 'fixture-only-key', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Fixture' } }], usage: { total_tokens: 4 } })) });
  const result = await provider.complete({ model: 'deepseek-flash', messages: [] });
  assert.equal(result.usage.completionTokens, null); assert.equal(result.usage.promptTokens, null); assert.equal(result.usage.totalTokens, 4);
});
