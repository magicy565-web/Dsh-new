import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatService } from '../../workspace-chat/src/domain.mjs';
import { createRunner } from '../src/runner.mjs';

function fakeStorage() {
  let state = {};
  return {
    read: () => structuredClone(state),
    update: async mutator => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    },
  };
}

function setup({ complete, memory = null } = {}) {
  const chat = createChatService({ storage: fakeStorage() });
  const calls = [];
  const llm = {
    complete: async request => {
      calls.push(request);
      return complete ? complete(request) : { text: '好的。', model: 'fake-1', usage: { outputTokens: 4 } };
    },
  };
  const runner = createRunner({ chat, llm, memory });
  chat.onPrepared(({ runId }) => { runner.enqueue(runId); });
  return { chat, runner, calls };
}

async function startRun(chat, content = '你好，帮我看看海祺的补货节奏。') {
  const { conversation } = await chat.createConversation({}, { requestId: crypto.randomUUID() });
  const posted = await chat.postMessage({}, conversation.id, { requestId: crypto.randomUUID(), content });
  return { conversation, ...posted };
}

const ADMIN = {};

test('a prepared run is executed and the answer is stored on the conversation', async () => {
  const harness = setup();
  const { conversation, run } = await startRun(harness.chat);
  await harness.runner.drain();

  const stored = harness.chat.readRun(ADMIN, run.id);
  assert.equal(stored.status, 'completed');
  assert.equal(stored.terminal, true);
  assert.deepEqual(stored.usage, { outputTokens: 4 });

  const { messages } = harness.chat.readConversation(ADMIN, conversation.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, '好的。');

  const events = harness.chat.readEvents(ADMIN, run.id, 0).events.map(event => event.type);
  assert.deepEqual(events, ['run.prepared', 'run.running', 'run.completed']);
});

test('the model request carries the system prompt, the history and the memory block', async () => {
  const memory = {
    compileContext: async (_context, body) => ({
      text: '【企业经营记忆 · 自动注入】\n- [mem:abc] 海祺贸易通常在 3 月和 9 月补货。',
      revision: 3,
      items: [{ id: '11111111-1111-4111-8111-111111111111' }],
      taskId: body.taskId,
    }),
  };
  const harness = setup({ memory });
  await startRun(harness.chat);
  await harness.runner.drain();

  assert.equal(harness.calls.length, 1);
  const [system, user] = harness.calls[0].messages;
  assert.equal(system.role, 'system');
  assert.match(system.content, /企业内部工作台/u);
  assert.match(system.content, /海祺贸易通常在 3 月和 9 月补货/u);
  assert.equal(user.role, 'user');
  assert.match(user.content, /补货节奏/u);
});

test('memory failure is recorded as an event and the run still answers', async () => {
  const memory = { compileContext: async () => { const error = new Error('memory down'); error.code = 'MEMORY_CONTEXT_UNAVAILABLE'; throw error; } };
  const harness = setup({ memory });
  const { run } = await startRun(harness.chat);
  await harness.runner.drain();

  const events = harness.chat.readEvents(ADMIN, run.id, 0).events;
  assert.deepEqual(events.map(event => event.type), ['run.prepared', 'run.running', 'run.memory_unavailable', 'run.completed']);
  assert.equal(events[2].data.code, 'MEMORY_CONTEXT_UNAVAILABLE');
  assert.equal(harness.chat.readRun(ADMIN, run.id).status, 'completed');
});

test('a provider failure fails the run and stores no answer', async () => {
  const failure = new Error('provider exploded with a secret');
  failure.code = 'LLM_FAILED';
  const harness = setup({ complete: async () => { throw failure; } });
  const { conversation, run } = await startRun(harness.chat);
  await harness.runner.drain();

  const stored = harness.chat.readRun(ADMIN, run.id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error.code, 'LLM_FAILED');
  assert.doesNotMatch(stored.error.message, /secret/u);
  assert.equal(harness.chat.readConversation(ADMIN, conversation.id).messages.length, 1);
});

test('cancelling a run while the model is running stores no answer', async () => {
  let release;
  const harness = setup({
    complete: () => new Promise(resolve => {
      release = () => resolve({ text: '迟到的回答', model: 'fake-1', usage: {} });
    }),
  });
  const { conversation, run } = await startRun(harness.chat);

  const until = Date.now() + 1000;
  while (harness.chat.readRun(ADMIN, run.id).status !== 'running' && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(harness.chat.readRun(ADMIN, run.id).status, 'running');

  await harness.chat.cancelRun(ADMIN, run.id, { reason: 'operator stopped it' });
  release();
  await harness.runner.drain();

  assert.equal(harness.chat.readRun(ADMIN, run.id).status, 'cancelled');
  const { messages } = harness.chat.readConversation(ADMIN, conversation.id);
  assert.equal(messages.length, 1, 'a cancelled run must not append a late answer');
  assert.equal(harness.runner.stats().cancelled, 1);
});

test('runs execute one at a time even when two arrive together', async () => {
  let active = 0;
  let peak = 0;
  const harness = setup({
    complete: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return { text: 'ok', model: 'fake-1', usage: {} };
    },
  });
  await startRun(harness.chat, '第一个问题');
  await startRun(harness.chat, '第二个问题');
  await harness.runner.drain();
  assert.equal(peak, 1);
  assert.equal(harness.runner.stats().completed, 2);
});
