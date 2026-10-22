// Run context assembly: the skills a message selects are pinned by body hash,
// injected into the system prompt and recorded on the run for audit.
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

function setup({ load = null } = {}) {
  const chat = createChatService({ storage: fakeStorage() });
  const requests = [];
  const llm = {
    complete: async request => {
      requests.push(request);
      return { text: '好的。', toolCalls: [], usage: {}, model: 'fake' };
    },
  };
  const skills = load ? { load } : null;
  const runner = createRunner({ chat, llm, skills });
  chat.onPrepared(({ runId }) => { runner.enqueue(runId); });
  return { chat, runner, requests };
}

async function startRun(chat, selection) {
  const { conversation } = await chat.createConversation({ actor: ADMIN }, { requestId: crypto.randomUUID() });
  return chat.postMessage({ actor: ADMIN }, conversation.id, {
    requestId: crypto.randomUUID(), content: '帮我回这个客户', ...(selection ? { selection } : {}),
  });
}

test('a selected skill is hashed, injected and recorded on the run', async () => {
  const harness = setup({ load: name => ({ name, description: 'd', body: '先核对 MOQ，再回复客户。', source: 'test' }) });
  const posted = await startRun(harness.chat, { skills: ['trade-terms'] });
  await harness.runner.drain();

  const system = harness.requests[0].messages[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /用户保存的技能指令/u);
  assert.match(system.content, /先核对 MOQ，再回复客户。/u);

  const run = harness.chat.readRun({ actor: ADMIN }, posted.run.id);
  assert.equal(run.status, 'completed');
  assert.equal(run.snapshot.skills.length, 1);
  assert.equal(run.snapshot.skills[0].name, 'trade-terms');
  assert.match(run.snapshot.skills[0].sha256, /^[a-f0-9]{64}$/u);
  assert.equal(run.snapshot.skills[0].chars, '先核对 MOQ，再回复客户。'.length);

  const events = harness.chat.readEvents({ actor: ADMIN }, posted.run.id, 0).events.map(event => event.type);
  assert.ok(events.includes('run.context_ready'), `events: ${events.join(',')}`);
});

test('an unavailable skill fails the run instead of being dropped silently', async () => {
  const harness = setup({ load: () => { const error = new Error('nope'); error.code = 'SKILL_NOT_FOUND'; throw error; } });
  const posted = await startRun(harness.chat, { skills: ['missing-skill'] });
  await harness.runner.drain();

  const run = harness.chat.readRun({ actor: ADMIN }, posted.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'SKILL_UNAVAILABLE');
  assert.equal(harness.requests.length, 0, 'no model call without a resolvable context');
});

test('selected skills that exceed the context budget are refused', async () => {
  const harness = setup({ load: name => ({ name, body: 'x'.repeat(13_000), description: 'd', source: 'test' }) });
  const posted = await startRun(harness.chat, { skills: ['a', 'b'] });
  await harness.runner.drain();
  assert.equal(harness.chat.readRun({ actor: ADMIN }, posted.run.id).error.code, 'SKILL_TOO_LARGE');
});

test('a run without a skills selection still records an empty context', async () => {
  const harness = setup({});
  const posted = await startRun(harness.chat);
  await harness.runner.drain();
  const run = harness.chat.readRun({ actor: ADMIN }, posted.run.id);
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.snapshot.skills, []);
  assert.equal(typeof run.snapshot.contextChars, 'number');
});
