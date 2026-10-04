import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../server/store.mjs';
import { createRuntime } from '../server/runtime.mjs';
import { ProviderError } from '../server/provider.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check) { for (let count = 0; count < 500; count++) { if (await check()) return; await sleep(5); } throw new Error('Fixture condition timed out'); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
async function fixture(t, provider, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-runtime-v2-'));
  const store = await openStore(directory);
  const runtime = await createRuntime({ store, provider, ...options });
  t.after(async () => { await runtime.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { runtime, store, directory };
}

test('fixture: durable run records preserve completion, usage, request identity and bounded event metadata', async t => {
  const { runtime } = await fixture(t, { configured: true, complete: async request => { await request.onEvent({ type: 'tool/result', privateReasoning: 'DO_NOT_STORE', arguments: { secret: 'DO_NOT_STORE' } }); return { content: 'Fixture output', usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 } }; } });
  const { conversation } = await runtime.createConversation({});
  const sent = await runtime.sendMessage(conversation.id, { content: 'Test', requestId: 'run-one' });
  await until(() => runtime.getRun(sent.run.id).run.status === 'succeeded');
  const run = runtime.getRun(sent.run.id).run;
  assert.deepEqual(run.usage, { promptTokens: 5, completionTokens: 4, totalTokens: 9 });
  assert.equal(run.events[0].type, 'tool/result');
  assert.ok(run.startedAt && run.finishedAt);
  assert.equal(JSON.stringify(runtime.bootstrap()).includes('DO_NOT_STORE'), false);
  assert.equal((await runtime.sendMessage(conversation.id, { content: 'Test', requestId: 'run-one' })).run.id, run.id);
});

test('fixture: explicit queue waits for capacity, stays FIFO and runs without another client request', async t => {
  const first = deferred(); const inputs = [];
  const { runtime } = await fixture(t, { configured: true, complete: async ({ messages }) => { inputs.push(messages.at(-1).content); return inputs.length === 1 ? first.promise : { content: 'Queued fixture result' }; } }, { maxConcurrentRuns: 1 });
  const a = (await runtime.createConversation({})).conversation;
  const b = (await runtime.createConversation({})).conversation;
  const c = (await runtime.createConversation({})).conversation;
  await runtime.sendMessage(a.id, { content: 'one' });
  const second = await runtime.sendMessage(b.id, { content: 'two', queued: true });
  const third = await runtime.sendMessage(c.id, { content: 'three', queued: true });
  assert.equal(runtime.getRun(second.run.id).run.status, 'queued');
  assert.equal(runtime.getRun(third.run.id).run.status, 'queued');
  assert.deepEqual(inputs, ['one']);
  first.resolve({ content: 'First fixture result' });
  await until(() => runtime.getRun(third.run.id).run.status === 'succeeded');
  assert.deepEqual(inputs, ['one', 'two', 'three']);
});

test('fixture: simultaneous queue admissions do not exceed process concurrency', async t => {
  const releases = []; let active = 0; let peak = 0;
  const { runtime } = await fixture(t, { configured: true, complete: async () => { active++; peak = Math.max(active, peak); const wait = deferred(); releases.push(wait); await wait.promise; active--; return { content: 'fixture' }; } }, { maxConcurrentRuns: 1 });
  const conversations = await Promise.all(Array.from({ length: 5 }, () => runtime.createConversation({})));
  const submitted = await Promise.all(conversations.map(({ conversation }, index) => runtime.sendMessage(conversation.id, { content: `${index}`, queued: true })));
  for (let index = 0; index < 5; index++) { await until(() => releases.length > index); releases[index].resolve(); }
  await until(() => runtime.getRun(submitted[4].run.id).run.status === 'succeeded');
  assert.equal(peak, 1);
});

test('fixture: queue exhaustion rejects atomically and queued cancellation never calls provider', async t => {
  const pending = deferred(); let calls = 0;
  const { runtime } = await fixture(t, { configured: true, complete: () => { calls++; return pending.promise; } }, { maxConcurrentRuns: 1, maxQueuedRuns: 1 });
  const a = (await runtime.createConversation({})).conversation;
  const b = (await runtime.createConversation({})).conversation;
  const c = (await runtime.createConversation({})).conversation;
  await runtime.sendMessage(a.id, { content: 'one' });
  const queued = await runtime.sendMessage(b.id, { content: 'two', queued: true });
  await assert.rejects(runtime.sendMessage(c.id, { content: 'three', queued: true }), { code: 'QUEUE_FULL' });
  assert.equal(runtime.bootstrap().messages.length, 4);
  await runtime.cancelRun(queued.run.id);
  pending.resolve({ content: 'first' });
  await sleep(25);
  assert.equal(runtime.getRun(queued.run.id).run.status, 'cancelled');
  assert.equal(calls, 1);
});

test('fixture: restart dispatches never-started queue but does not replay an interrupted paid attempt', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-queue-restart-'));
  let oldCalls = 0;
  const firstStore = await openStore(directory);
  const first = await createRuntime({ store: firstStore, maxConcurrentRuns: 1, provider: { configured: true, complete: ({ signal }) => { oldCalls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new ProviderError('CANCELLED', 'Fixture stopped')), { once: true })); } } });
  const a = (await first.createConversation({})).conversation;
  const b = (await first.createConversation({})).conversation;
  const active = await first.sendMessage(a.id, { content: 'Must not retry' });
  const queued = await first.sendMessage(b.id, { content: 'Only safe queue', queued: true });
  await first.close(); await firstStore.close();
  const newCalls = [];
  const secondStore = await openStore(directory);
  const second = await createRuntime({ store: secondStore, provider: { configured: true, complete: async ({ messages }) => { newCalls.push(messages.at(-1).content); return { content: 'recovered fixture' }; } } });
  t.after(async () => { await second.close(); await secondStore.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await until(() => second.getRun(queued.run.id).run.status === 'succeeded');
  assert.equal(second.getRun(active.run.id).run.status, 'interrupted');
  assert.equal(oldCalls, 1); assert.deepEqual(newCalls, ['Only safe queue']);
});

test('fixture: queued goals retain revision and checkpoint through restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-goal-restart-'));
  const firstStore = await openStore(directory);
  const first = await createRuntime({ store: firstStore, maxConcurrentRuns: 1, provider: { configured: true, complete: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new ProviderError('CANCELLED', 'stopped')), { once: true })) } });
  const chat = (await first.createConversation({})).conversation;
  await first.sendMessage(chat.id, { content: 'blocking fixture' });
  const { goal } = await first.createGoal({ title: 'Restart goal' });
  await first.updateGoal(goal.id, { action: 'start', queued: true });
  assert.equal(first.bootstrap().runs.at(-1).status, 'queued');
  await first.close(); await firstStore.close();
  const secondStore = await openStore(directory);
  const second = await createRuntime({ store: secondStore, provider: { configured: true, complete: async () => ({ content: JSON.stringify({ done: true, content: 'Recovered goal fixture' }) }) } });
  t.after(async () => { await second.close(); await secondStore.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await until(() => second.bootstrap().goals[0].status === 'review_required');
  assert.equal(second.bootstrap().goals[0].stepCount, 1);
});

test('fixture: exhausted output budget pauses goal before a further paid step', async t => {
  let calls = 0;
  const { runtime } = await fixture(t, { configured: true, complete: async ({ maxTokens }) => { calls++; assert.equal(maxTokens, 1600); return { content: JSON.stringify({ done: false, content: 'bounded fixture', nextStep: 'More' }), usage: { completionTokens: 1600 } }; } });
  const { goal } = await runtime.createGoal({ title: 'Bounded', maxSteps: 5, maxOutputTokens: 1600 });
  await runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => runtime.bootstrap().goals[0].status === 'paused');
  assert.equal(runtime.bootstrap().goals[0].lastError.code, 'TOKEN_BUDGET');
  await assert.rejects(runtime.updateGoal(goal.id, { action: 'resume' }), { code: 'TOKEN_BUDGET' });
  assert.equal(calls, 1);
});

test('fixture: goal deadline fences a provider that ignores AbortSignal indefinitely', async t => {
  const ignored = deferred();
  const { runtime } = await fixture(t, { configured: true, complete: () => ignored.promise }, { goalTimeoutMs: 15 });
  const { goal } = await runtime.createGoal({ title: 'Deadline' });
  await runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => runtime.bootstrap().goals[0].status === 'failed');
  assert.equal(runtime.bootstrap().goals[0].lastError.code, 'GOAL_TIMEOUT');
  ignored.resolve({ content: JSON.stringify({ done: true, content: 'LATE' }) });
  await sleep(15); assert.equal(runtime.bootstrap().goals[0].output, '');
});

test('fixture: scoped and disabled memories and disabled skills never reach another conversation', async t => {
  let sent;
  const { runtime, store } = await fixture(t, { configured: true, complete: async input => { sent = input; return { content: 'fixture' }; } });
  const a = (await runtime.createConversation({})).conversation;
  const b = (await runtime.createConversation({})).conversation;
  await runtime.createMemory({ content: 'GLOBAL_VISIBLE' });
  await runtime.createMemory({ content: 'SCOPED_PRIVATE', conversationId: a.id });
  await runtime.createMemory({ content: 'DISABLED_PRIVATE', enabled: false });
  await store.update(state => { for (const item of state.conversations) delete item.inputContext; state.capabilities ||= {}; state.capabilities.skills = [{ id: 'skill-on', name: 'on', instructions: 'SKILL_VISIBLE', enabled: true }, { id: 'skill-off', name: 'off', instructions: 'SKILL_PRIVATE', enabled: false }]; });
  await runtime.sendMessage(b.id, { content: 'test' });
  await until(() => sent);
  assert.match(JSON.stringify(sent.messages), /GLOBAL_VISIBLE/); assert.match(JSON.stringify(sent.messages), /SKILL_VISIBLE/);
  assert.doesNotMatch(JSON.stringify(sent.messages), /SCOPED_PRIVATE|DISABLED_PRIVATE|SKILL_PRIVATE/);
});

test('fixture: native session ID is persisted at session event, continued, and reset explicitly', async t => {
  const inputs = []; let closed = false;
  const { runtime } = await fixture(t, { configured: true, kind: 'deepseek-harness', close: async () => { closed = true; }, complete: async input => { inputs.push(input); await input.onEvent({ type: 'native.session', nativeSessionId: 'fixture-session-id' }); return { content: 'fixture', nativeSessionId: 'fixture-session-id' }; } });
  const { conversation } = await runtime.createConversation({});
  await runtime.sendMessage(conversation.id, { content: 'first' });
  await until(() => runtime.bootstrap().conversations[0].status === 'idle');
  await runtime.sendMessage(conversation.id, { content: 'second' });
  await until(() => runtime.bootstrap().conversations[0].status === 'idle');
  assert.equal(inputs[1].nativeSessionId, 'fixture-session-id');
  await runtime.resetSession(conversation.id);
  assert.equal(runtime.bootstrap().conversations[0].nativeSessionId, null);
  await runtime.sendMessage(conversation.id, { content: 'explicit fresh session' });
  await until(() => runtime.bootstrap().conversations[0].status === 'idle');
  assert.equal(inputs[2].nativeSessionId, undefined);
  await runtime.close(); assert.equal(closed, true);
});

test('fixture: retry creates a new explicit attempt without mutating original idempotency record', async t => {
  let calls = 0;
  const { runtime } = await fixture(t, { configured: true, complete: async () => { if (++calls === 1) throw new ProviderError('PROVIDER_RATE_LIMIT', 'Fixture failure'); return { content: 'Fixture retry' }; } });
  const { conversation } = await runtime.createConversation({});
  const first = await runtime.sendMessage(conversation.id, { content: 'Retry input', requestId: 'first-request' });
  await until(() => runtime.getRun(first.run.id).run.status === 'failed');
  const retry = await runtime.retryRun(first.run.id, { requestId: 'retry-request' });
  await until(() => runtime.getRun(retry.run.id).run.status === 'succeeded');
  assert.equal(runtime.listRuns().runs.length, 2); assert.equal(runtime.getRun(first.run.id).run.status, 'failed');
  assert.equal((await runtime.sendMessage(conversation.id, { content: 'Retry input', requestId: 'first-request' })).duplicate, true);
});

test('fixture: invalid structured responses and uncertain failures still debit goal allowance', async t => {
  let calls = 0;
  const { runtime } = await fixture(t, { configured: true, complete: async () => { calls++; return { content: 'INVALID_JSON', usage: { completionTokens: 1600 } }; } });
  const { goal } = await runtime.createGoal({ title: 'Invalid output fixture', maxSteps: 5, maxOutputTokens: 1600 });
  await runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => runtime.bootstrap().goals[0].status === 'failed');
  assert.equal(runtime.bootstrap().goals[0].outputTokens, 1600);
  assert.equal(runtime.listRuns().runs[0].usage.completionTokens, 1600);
  await assert.rejects(runtime.updateGoal(goal.id, { action: 'resume' }), { code: 'TOKEN_BUDGET' });
  assert.equal(calls, 1);
});

test('fixture: a provider exception conservatively retains pre-dispatch goal allowance', async t => {
  const { runtime } = await fixture(t, { configured: true, complete: async () => { throw new ProviderError('PROVIDER_UNREACHABLE', 'Unknown dispatch outcome'); } });
  const { goal } = await runtime.createGoal({ title: 'Uncertain fixture', maxOutputTokens: 1600 });
  await runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => runtime.bootstrap().goals[0].status === 'failed');
  assert.equal(runtime.bootstrap().goals[0].outputTokens, 1600);
  await assert.rejects(runtime.updateGoal(goal.id, { action: 'resume' }), { code: 'TOKEN_BUDGET' });
});

test('fixture: falsey invalid memory scopes never silently become global', async t => {
  const { runtime } = await fixture(t, { configured: false });
  for (const conversationId of [false, 0, '', {}, []]) await assert.rejects(runtime.createMemory({ content: 'Scoped data', conversationId }), { code: 'INVALID_INPUT' });
  assert.equal(runtime.bootstrap().memories.length, 0);
});

test('fixture: missing or zero completion usage cannot refund a nonempty generated response', async t => {
  const { runtime } = await fixture(t, { configured: true, complete: async () => ({ content: JSON.stringify({ done: false, content: 'Nonempty fixture' }), usage: { completionTokens: 0 } }) });
  const { goal } = await runtime.createGoal({ title: 'Unknown usage fixture', maxOutputTokens: 1600 });
  await runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => runtime.bootstrap().goals[0].status === 'paused');
  assert.equal(runtime.bootstrap().goals[0].outputTokens, 1600);
});

test('fixture: queued text-only run cannot acquire native tool permissions across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-scope-restart-'));
  const firstStore = await openStore(directory);
  const first = await createRuntime({ store: firstStore, maxConcurrentRuns: 1, provider: { configured: true, kind: 'deepseek-api', complete: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new ProviderError('CANCELLED', 'Fixture shutdown')), { once: true })) } });
  const a = (await first.createConversation({})).conversation;
  const b = (await first.createConversation({})).conversation;
  await first.sendMessage(a.id, { content: 'Active fixture' });
  const queued = await first.sendMessage(b.id, { content: 'Approved only as text', queued: true });
  await first.close(); await firstStore.close();
  let nativeCalls = 0;
  const secondStore = await openStore(directory);
  const second = await createRuntime({ store: secondStore, provider: { configured: true, kind: 'deepseek-harness', complete: async () => { nativeCalls++; return { content: 'Must not be run' }; } } });
  t.after(async () => { await second.close(); await secondStore.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await until(() => second.getRun(queued.run.id).run.status === 'blocked');
  assert.equal(second.getRun(queued.run.id).run.error.code, 'EXECUTION_SCOPE_CHANGED'); assert.equal(nativeCalls, 0);
});

test('fixture: shutdown aborts owned work and closes provider even if checkpoint persistence fails', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-shutdown-failure-'));
  const actual = await openStore(directory); let diskFailed = false; let aborted = false; let closed = false;
  const store = { read: actual.read, update: callback => diskFailed ? Promise.reject(new Error('Fixture disk failure')) : actual.update(callback) };
  const runtime = await createRuntime({ store, provider: { configured: true, kind: 'deepseek-harness', complete: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new ProviderError('CANCELLED', 'fixture')); }, { once: true })), close: async () => { closed = true; } } });
  t.after(async () => { await actual.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { conversation } = await runtime.createConversation({}); await runtime.sendMessage(conversation.id, { content: 'Fixture' });
  diskFailed = true;
  await assert.rejects(runtime.close(), /Fixture disk failure/);
  assert.equal(aborted, true); assert.equal(closed, true);
  await assert.rejects(runtime.close(), /Fixture disk failure/);
});

test('fixture: raw credential formats and exact configured secrets cannot be saved as memory', async t => {
  const { runtime } = await fixture(t, { configured: false, containsCredential: content => content.includes('opaque-fixture-credential') });
  for (const content of ['sk-123456789012345678901234567890', 'password=fixture-password-123', 'Bearer abcdefghijklmnopqrstuvwxyz', 'opaque-fixture-credential']) await assert.rejects(runtime.createMemory({ content }), { code: 'RAW_CREDENTIAL_REJECTED' });
  const { memory } = await runtime.createMemory({ content: 'Use environment references for API credentials' });
  await assert.rejects(runtime.updateMemory(memory.id, { content: 'opaque-fixture-credential' }), { code: 'RAW_CREDENTIAL_REJECTED' });
  assert.equal(runtime.bootstrap().memories[0].content, 'Use environment references for API credentials');
});

test('fixture: model change during reservation cannot execute a goal under a more expensive model', async t => {
  let calls = 0;
  const { runtime, store } = await fixture(t, { configured: true, complete: async () => { calls++; return { content: JSON.stringify({ done: true, content: 'Must not execute' }) }; } });
  const { goal } = await runtime.createGoal({ title: 'Scope race' });
  const update = store.update.bind(store); let changed = false;
  store.update = callback => update(callback).then(async result => {
    if (!changed && result === true && store.read().messages.some(item => item.goalId === goal.id && item.status === 'pending')) { changed = true; await runtime.updateSettings({ model: 'deepseek-v4-pro' }); }
    return result;
  });
  await runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => runtime.bootstrap().goals[0].status === 'blocked');
  assert.equal(changed, true); assert.equal(calls, 0); assert.equal(runtime.bootstrap().goals[0].lastError.code, 'EXECUTION_SCOPE_CHANGED');
});

test('fixture: native and absent provider usage is unknown rather than fabricated zero', async t => {
  const { runtime } = await fixture(t, { configured: true, kind: 'deepseek-harness', complete: async () => ({ content: 'Fixture output', usage: null }) });
  const { conversation } = await runtime.createConversation({}); const sent = await runtime.sendMessage(conversation.id, { content: 'No usage reported' });
  await until(() => runtime.getRun(sent.run.id).run.status === 'succeeded');
  assert.deepEqual(runtime.getRun(sent.run.id).run.usage, { promptTokens: null, completionTokens: null, totalTokens: null });
  assert.equal(runtime.getRun(sent.run.id).run.usageStatus, 'unknown');
});

test('fixture: a delayed cancellation of an old run cannot stop the newer run in that conversation', async t => {
  const first = deferred(); const second = deferred(); let calls = 0;
  const { runtime, store } = await fixture(t, { configured: true, complete: () => ++calls === 1 ? first.promise : second.promise });
  const { conversation } = await runtime.createConversation({}); const old = await runtime.sendMessage(conversation.id, { content: 'First' });
  const update = store.update.bind(store); let newerPromise, cancelPromise;
  store.update = callback => update(state => {
    const result = callback(state);
    if (!newerPromise && state.runs.some(run => run.id === old.run.id && run.status === 'succeeded')) {
      // Completion is not committed yet. Queue a new request, then an old-run cancel.
      newerPromise = runtime.sendMessage(conversation.id, { content: 'Second' });
      cancelPromise = runtime.cancelRun(old.run.id);
    }
    return result;
  });
  first.resolve({ content: 'First finished' }); await until(() => newerPromise);
  const newer = await newerPromise; const cancelled = await cancelPromise;
  assert.equal(cancelled.run.status, 'succeeded'); assert.equal(runtime.getRun(newer.run.id).run.status, 'running');
  second.resolve({ content: 'Second finished' }); await until(() => runtime.getRun(newer.run.id).run.status === 'succeeded');
});

test('fixture: cancelling a completed goal attempt never pauses its already-resumed successor', async t => {
  const first = deferred(); const second = deferred(); let calls = 0;
  const { runtime, store } = await fixture(t, { configured: true, complete: () => ++calls === 1 ? first.promise : second.promise });
  const { goal } = await runtime.createGoal({ title: 'Goal cancel race', maxSteps: 1 }); await runtime.updateGoal(goal.id, { action: 'start' });
  const oldId = runtime.bootstrap().goals[0].runId; const update = store.update.bind(store); let resumedPromise, cancelledPromise;
  store.update = callback => update(state => {
    const result = callback(state);
    if (!resumedPromise && state.runs.some(run => run.id === oldId && run.status === 'paused')) {
      resumedPromise = runtime.updateGoal(goal.id, { action: 'resume', maxSteps: 2 });
      cancelledPromise = runtime.cancelRun(oldId);
    }
    return result;
  });
  first.resolve({ content: JSON.stringify({ done: false, content: 'First step' }) }); await until(() => resumedPromise);
  const resumed = await resumedPromise; await cancelledPromise;
  assert.equal(runtime.bootstrap().goals[0].status, 'running'); assert.equal(runtime.bootstrap().goals[0].runId, resumed.goal.runId);
  second.resolve({ content: JSON.stringify({ done: true, content: 'Second step' }) }); await until(() => runtime.bootstrap().goals[0].status === 'review_required');
});
