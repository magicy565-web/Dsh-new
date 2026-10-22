import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration, stableId } from './migrate-legacy.mjs';
import { createChatService } from '../plugins/workspace-chat/src/domain.mjs';
import { createGoalService } from '../plugins/workspace-goals/src/domain.mjs';

const legacy = {
  version: 3,
  conversations: [
    { id: 'c1', title: '海祺补货', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z' },
    { id: 'c2', title: '   ', createdAt: '2026-09-01T08:00:00.000Z' },
    { id: 'c3', title: '旧目标', createdAt: 'not-a-date' },
  ],
  goals: [
    { id: 'g1', title: '把补货节奏固定下来', description: '每周复盘', status: 'draft', createdAt: '2026-09-01T09:00:00.000Z' },
    { id: 'g2', title: '已完成的', status: 'done', createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-05T09:00:00.000Z' },
    { id: 'g3', title: '运行中的', status: 'running', createdAt: '2026-09-01T09:00:00.000Z' },
    { id: 'g4', title: '', status: 'draft', createdAt: '2026-09-01T09:00:00.000Z' },
  ],
  messages: [
    { id: 'm1', conversationId: 'c1', role: 'user', content: '海祺这个月该补货吗？', createdAt: '2026-09-01T08:01:00.000Z' },
    { id: 'm2', conversationId: 'c1', role: 'assistant', content: '建议补 200 件。', createdAt: '2026-09-01T08:02:00.000Z' },
    { id: 'm3', conversationId: 'c1', role: 'system', content: '忽略我', createdAt: '2026-09-01T08:03:00.000Z' },
    { id: 'm4', conversationId: 'missing', role: 'user', content: '孤儿消息', createdAt: '2026-09-01T08:04:00.000Z' },
    { id: 'm5', conversationId: 'c1', role: 'user', content: '   ', createdAt: '2026-09-01T08:05:00.000Z' },
  ],
};

test('ids are deterministic and idempotent', () => {
  const first = stableId('conversation', 'c1');
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.equal(stableId('conversation', 'c1'), first);
  assert.notEqual(stableId('message', 'c1'), stableId('conversation', 'c1'));
});

test('planning imports valid records and explains the rest', () => {
  const plan = planMigration(legacy, {});
  assert.equal(plan.conversations, 1);
  assert.equal(plan.messages, 2);
  assert.equal(plan.skipped, 7);
  assert.equal(plan.goals, 2);
  const reasons = Object.fromEntries(plan.skippedReasons);
  assert.equal(reasons.CONVERSATION_TITLE, 1);
  assert.equal(reasons.CONVERSATION_CREATED_AT, 1);
  assert.equal(reasons.MESSAGE_ROLE_SYSTEM, 1);
  assert.equal(reasons.MESSAGE_CONVERSATION, 1);
  assert.equal(reasons.MESSAGE_CONTENT, 1);
  assert.equal(reasons.GOAL_STATUS_RUNNING, 1);
  assert.equal(reasons.GOAL_TITLE, 1);
});

test('a second plan over the migrated state imports nothing', () => {
  const first = planMigration(legacy, {});
  const second = planMigration(legacy, first.nextWorkspace);
  assert.equal(second.conversations, 0);
  assert.equal(second.messages, 0);
});

test('the migrated state is accepted by the real chat service', async () => {
  const plan = planMigration(legacy, {});
  const state = { workspaces: { local: plan.nextWorkspace } };
  const chat = createChatService({
    storage: { read: () => structuredClone(state), update: async fn => { const draft = structuredClone(state); fn(draft); return null; } },
  });
  const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
  const listed = chat.listConversations({ actor }, {});
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].title, '海祺补货');
  const detail = chat.readConversation({ actor }, listed.items[0].id);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].role, 'user');
  assert.equal(detail.messages[1].content, '建议补 200 件。');
});

test('the migrated goals are accepted by the real goals service', () => {
  const plan = planMigration(legacy, {});
  const state = { workspaces: { local: plan.nextWorkspace } };
  const goals = createGoalService({
    storage: { read: () => structuredClone(state), update: async fn => { const draft = structuredClone(state); fn(draft); return null; } },
  });
  const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
  const listed = goals.list({ actor }, { status: 'all' });
  assert.equal(listed.total, 2);
  const done = listed.items.find(item => item.status === 'done');
  assert.ok(done, 'the done goal was imported');
  assert.ok(done.closedAt, 'a terminal goal carries closedAt');
  assert.equal(goals.list({ actor }, { status: 'open' }).total, 1);
});
test('an unsupported legacy version is refused instead of guessed', () => {
  assert.throws(() => planMigration({ version: 9, conversations: [] }), error => error.code === 'MIGRATION_VERSION');
  assert.throws(() => planMigration({ version: 3, conversations: 'nope' }), error => error.code === 'MIGRATION_INVALID');
  assert.throws(() => planMigration(null), error => error.code === 'MIGRATION_INVALID');
});
