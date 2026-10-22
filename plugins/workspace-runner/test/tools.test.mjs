// The guarded tool loop: model asks for a tool, a human approves the exact
// call, and only then does the tool execute under its one-shot ticket.
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

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const TOOL = {
  name: 'business_memory_propose',
  description: 'propose one memory',
  parameters: { type: 'object', properties: { factKey: { type: 'string' } } },
};

function harness({ approval = 'always', decision = 'approve', toolResult = { ok: true } } = {}) {
  const chat = createChatService({ storage: fakeStorage() });
  const executed = [];
  const decided = [];
  const tickets = [];
  const tools = {
    list: () => [{ ...TOOL, approval }],
    execute: async (name, args) => {
      executed.push({ name, args });
      return toolResult;
    },
  };
  const approvalService = {
    request: async payload => {
      const id = `ticket-${tickets.length + 1}`;
      tickets.push({ id, payload });
      return { id, status: 'pending' };
    },
    decide: async (id, value, actor) => {
      decided.push({ id, value, actor });
      return { id, status: value === 'approve' ? 'approved' : 'denied' };
    },
  };
  let turn = 0;
  const requests = [];
  const llm = {
    complete: async request => {
      requests.push(request);
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ name: TOOL.name, arguments: { factKey: 'moq' } }], usage: {}, model: 'fake' };
      return { text: '已经记下来了。', toolCalls: [], usage: { outputTokens: 5 }, model: 'fake' };
    },
  };
  const runner = createRunner({ chat, llm, tools, approval: approvalService });
  chat.onPrepared(({ runId }) => { runner.enqueue(runId); });
  return { chat, runner, tools, approvalService, executed, decided, tickets, requests, decision };
}

async function startRun(chat) {
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: crypto.randomUUID() });
  const posted = await chat.postMessage({ actor: ADMIN }, conversation.id, { requestId: crypto.randomUUID(), content: '把 MOQ 记下来' });
  return { conversation, run: posted.run };
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

test('a gated tool blocks the run until a human approves, then executes once', async () => {
  const h = harness();
  const { run } = await startRun(h.chat);

  assert.ok(await waitFor(() => h.chat.listApprovals({ actor: ADMIN }).total === 1), 'one approval should be pending');
  assert.equal(h.chat.readRun({ actor: ADMIN }, run.id).status, 'blocked');
  assert.equal(h.executed.length, 0, 'the tool must not run before the decision');

  const pending = h.chat.listApprovals({ actor: ADMIN }).items[0];
  assert.equal(pending.action, 'business_memory_propose');
  assert.deepEqual(pending.payload, { factKey: 'moq' });

  await h.chat.decideApproval({ actor: ADMIN }, pending.id, { decision: 'approve' });
  await h.runner.drain();

  assert.equal(h.chat.readRun({ actor: ADMIN }, run.id).status, 'completed');
  assert.equal(h.executed.length, 1);
  assert.equal(h.executed[0].args.approvalId, 'ticket-1');
  assert.deepEqual(h.decided, [{ id: 'ticket-1', value: 'approve', actor: { subject: 'local-operator', role: 'admin', workspaceId: 'local' } }]);

  const { messages } = h.chat.readConversation({ actor: ADMIN }, run.conversationId);
  assert.equal(messages.at(-1).content, '已经记下来了。');
  assert.ok(h.requests.at(-1).tools.length === 1, 'the model must see the tool offer');
});

test('denying the approval fails the run and never executes the tool', async () => {
  const h = harness();
  const { run } = await startRun(h.chat);
  assert.ok(await waitFor(() => h.chat.listApprovals({ actor: ADMIN }).total === 1));

  const pending = h.chat.listApprovals({ actor: ADMIN }).items[0];
  await h.chat.decideApproval({ actor: ADMIN }, pending.id, { decision: 'deny' });
  await h.runner.drain();

  assert.equal(h.chat.readRun({ actor: ADMIN }, run.id).status, 'failed');
  assert.equal(h.executed.length, 0);
  assert.equal(h.decided.length, 0, 'a denied call needs no enforcement ticket decision');
});

test('a read-only tool runs without any approval', async () => {
  const h = harness({ approval: 'never' });
  const { run } = await startRun(h.chat);
  await h.runner.drain();

  assert.equal(h.chat.readRun({ actor: ADMIN }, run.id).status, 'completed');
  assert.equal(h.executed.length, 1);
  assert.equal(h.executed[0].args.approvalId, undefined);
  assert.equal(h.tickets.length, 0);
  assert.equal(h.chat.listApprovals({ actor: ADMIN }).total, 0);
});

test('an unknown tool fails the run instead of guessing', async () => {
  const chat = createChatService({ storage: fakeStorage() });
  const tools = { list: () => [{ ...TOOL, approval: 'never' }], execute: async () => ({}) };
  const llm = {
    complete: async () => ({ text: '', toolCalls: [{ name: 'rm_rf', arguments: {} }], usage: {}, model: 'fake' }),
  };
  const runner = createRunner({ chat, llm, tools });
  chat.onPrepared(({ runId }) => { runner.enqueue(runId); });
  const { run } = await startRun(chat);
  await runner.drain();
  const stored = chat.readRun({ actor: ADMIN }, run.id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error.code, 'TOOL_UNKNOWN');
});

test('an empty final answer is a failure, not a silent success', async () => {
  const chat = createChatService({ storage: fakeStorage() });
  const tools = { list: () => [{ ...TOOL, approval: 'never' }], execute: async () => ({ ok: true }) };
  const llm = { complete: async () => ({ text: '   ', toolCalls: [], usage: {}, model: 'fake' }) };
  const runner = createRunner({ chat, llm, tools });
  chat.onPrepared(({ runId }) => { runner.enqueue(runId); });
  const { run } = await startRun(chat);
  await runner.drain();
  assert.equal(chat.readRun({ actor: ADMIN }, run.id).error.code, 'EMPTY_ANSWER');
});

test('a tool that produces a file pins it on the run', async () => {
  const artifact = { id: crypto.randomUUID(), filename: '报价单.md', currentVersion: 2, sha256: 'a'.repeat(64) };
  const h = harness({ toolResult: { artifact } });
  const { run } = await startRun(h.chat);
  assert.ok(await waitFor(() => h.chat.listApprovals({ actor: ADMIN }).total === 1));
  const pending = h.chat.listApprovals({ actor: ADMIN }).items[0];
  await h.chat.decideApproval({ actor: ADMIN }, pending.id, { decision: 'approve' });
  await h.runner.drain();

  const stored = h.chat.readRun({ actor: ADMIN }, run.id);
  assert.equal(stored.status, 'completed');
  assert.deepEqual(stored.snapshot.outputs, [{
    id: artifact.id, filename: '报价单.md', version: 2, sha256: 'a'.repeat(64),
  }]);
  const events = h.chat.readEvents({ actor: ADMIN }, run.id, 0).events.map(event => event.type);
  assert.ok(events.includes('run.output_created'), events.join(','));
});