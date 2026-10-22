import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatService } from '../src/domain.mjs';

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
    snapshot: () => structuredClone(state),
  };
}

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const OTHER = { subject: 'other', role: 'admin', workspaceId: 'other' };

function service(overrides = {}) {
  return createChatService({ storage: fakeStorage(), ...overrides });
}

const requestId = () => crypto.randomUUID();

test('a conversation is created once and replayed by requestId', async () => {
  const chat = service();
  const key = requestId();
  const first = await chat.createConversation({ actor: ADMIN }, { requestId: key, title: '海祺补货' });
  assert.equal(first.conversation.title, '海祺补货');
  assert.equal(first.replayed, false);

  const replay = await chat.createConversation({ actor: ADMIN }, { requestId: key, title: '另一个标题' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.conversation.id, first.conversation.id);
  assert.equal(replay.conversation.title, '海祺补货', 'a replay never mutates the stored conversation');
});

test('a user message creates a prepared run and one event', async () => {
  const chat = service();
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  const posted = await chat.postMessage({ actor: ADMIN }, conversation.id, {
    requestId: requestId(), content: '海祺这个月该补货了吗？',
  });
  assert.equal(posted.message.role, 'user');
  assert.equal(posted.run.status, 'prepared');
  assert.equal(posted.run.snapshot.messageId, posted.message.id);

  const events = chat.readEvents({ actor: ADMIN }, posted.run.id, 0);
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].type, 'run.prepared');
  assert.equal(events.run.terminal, false);
});

test('posting the same requestId twice returns the same message and run', async () => {
  const chat = service();
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  const key = requestId();
  const first = await chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: key, content: 'hi' });
  const second = await chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: key, content: 'hi again' });
  assert.equal(second.replayed, true);
  assert.equal(second.message.id, first.message.id);
  assert.equal(second.run.id, first.run.id);
  assert.equal(chat.readConversation({ actor: ADMIN }, conversation.id).messages.length, 1);
});

test('a prepared run can be cancelled and a terminal run cannot move again', async () => {
  const chat = service();
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  const { run } = await chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: requestId(), content: 'stop me' });

  const cancelled = await chat.cancelRun({ actor: ADMIN }, run.id, { reason: 'operator stopped it' });
  assert.equal(cancelled.run.status, 'cancelled');
  assert.equal(cancelled.run.terminal, true);
  assert.ok(cancelled.run.endedAt);

  const replay = await chat.cancelRun({ actor: ADMIN }, run.id, {});
  assert.equal(replay.replayed, true);

  await assert.rejects(
    chat.advance({ actor: ADMIN }, run.id, 'running'),
    error => error.code === 'CHAT_RUN_TRANSITION' && error.status === 409,
  );
});

test('a run follows the transition table and records one event per step', async () => {
  const chat = service();
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  const { run } = await chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: requestId(), content: 'go' });

  await chat.advance({ actor: ADMIN }, run.id, 'running');
  await chat.advance({ actor: ADMIN }, run.id, 'blocked');
  await chat.advance({ actor: ADMIN }, run.id, 'running');
  await chat.advance({ actor: ADMIN }, run.id, 'completed', { usage: { outputTokens: 12 } });

  const events = chat.readEvents({ actor: ADMIN }, run.id, 0);
  assert.deepEqual(events.events.map(event => event.type), [
    'run.prepared', 'run.running', 'run.blocked', 'run.running', 'run.completed',
  ]);
  assert.equal(events.run.terminal, true);
  assert.deepEqual(events.run.usage, { outputTokens: 12 });

  await assert.rejects(
    chat.advance({ actor: ADMIN }, run.id, 'running'),
    error => error.code === 'CHAT_RUN_TRANSITION',
  );
});

test('an assistant message is appendable only through the run path', async () => {
  const chat = service();
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  const { run } = await chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: requestId(), content: 'q' });
  const message = await chat.appendMessage({ actor: ADMIN }, run.id, { content: 'answer' });
  assert.equal(message.role, 'assistant');
  assert.equal(chat.readConversation({ actor: ADMIN }, conversation.id).messages.at(-1).content, 'answer');
  await assert.rejects(
    chat.appendMessage({ actor: ADMIN }, run.id, { role: 'user', content: 'nope' }),
    error => error.code === 'CHAT_INPUT',
  );
});

test('two workspaces cannot see each other', async () => {
  const storage = fakeStorage();
  const resolveWorkspace = actor => ({ workspaceId: actor.workspaceId, subject: actor.subject, role: actor.role });
  const chat = createChatService({ storage, resolveWorkspace });
  const mine = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  assert.throws(
    () => chat.readConversation({ actor: OTHER }, mine.conversation.id),
    error => error.code === 'CHAT_CONVERSATION_NOT_FOUND' && error.status === 404,
  );
  assert.equal(chat.listConversations({ actor: OTHER }).total, 0);
});

test('invalid input is refused instead of stored', async () => {
  const chat = service();
  await assert.rejects(
    chat.createConversation({ actor: ADMIN }, { requestId: requestId(), extra: true }),
    error => error.code === 'CHAT_INPUT',
  );
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  await assert.rejects(
    chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: requestId(), content: '   ' }),
    error => error.code === 'CHAT_INPUT',
  );
  assert.throws(
    () => chat.readConversation({ actor: ADMIN }, conversation.id, { messageLimit: 10_000 }),
    error => error.code === 'CHAT_INPUT',
  );
});

test('a damaged store fails closed instead of being reset', async () => {
  const storage = fakeStorage();
  const chat = createChatService({ storage });
  await chat.createConversation({ actor: ADMIN }, { requestId: requestId() });
  const state = storage.snapshot();
  state.workspaces.local.harnessChat.runs.push({ nope: true });
  storage.update(draft => { Object.assign(draft, state); return null; });
  assert.throws(
    () => chat.status({ actor: ADMIN }),
    error => error.code === 'CHAT_INVALID' && error.status === 500,
  );
});
