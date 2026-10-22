import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleService } from '../src/domain.mjs';
import { apply, ROUTES } from '../src/index.mjs';

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
const VIEWER = { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' };
const requestId = () => crypto.randomUUID();
const conversationId = () => crypto.randomUUID();

function fakeChat() {
  const posts = [];
  const runs = new Map();
  return {
    posts,
    async postMessage(context, conversation, body) {
      if (body.content === 'fail') { const error = new Error('boom'); error.code = 'CHAT_FULL'; throw error; }
      const key = body.requestId;
      if (!runs.has(key)) runs.set(key, { id: crypto.randomUUID(), conversationId: conversation, goalId: body.goalId ?? null });
      const run = runs.get(key);
      posts.push({ context, conversation, body, run });
      return { run, message: { id: crypto.randomUUID() }, replayed: false };
    },
  };
}

function build({ clock } = {}) {
  const storage = fakeStorage();
  const chat = fakeChat();
  let now = clock ?? Date.parse('2026-10-23T00:00:00.000Z');
  const service = createScheduleService({ storage, chat, clock: () => now });
  return {
    service, chat, storage,
    advance(ms) { now += ms; },
    get now() { return now; },
  };
}

async function createEvery(harness, overrides = {}) {
  return harness.service.create({ actor: ADMIN }, {
    requestId: requestId(), title: '每天盯库存', prompt: '检查库存并给出补货建议',
    conversationId: conversationId(), kind: 'every', everySeconds: 60, ...overrides,
  });
}

test('a new schedule is disabled until a person enables it', async () => {
  const harness = build();
  const { schedule } = await createEvery(harness);
  assert.equal(schedule.status, 'disabled');
  assert.ok(schedule.nextAt);

  assert.equal((await harness.service.tick()).dispatched, 0, 'disabled schedules never dispatch');
  const enabled = await harness.service.setStatus({ actor: ADMIN }, schedule.id, { status: 'enabled' });
  assert.equal(enabled.schedule.status, 'enabled');
});

test('a due schedule posts into its conversation with the goal and a deterministic request id', async () => {
  const harness = build();
  const goalId = crypto.randomUUID();
  const { schedule } = await createEvery(harness, { goalId });
  await harness.service.setStatus({ actor: ADMIN }, schedule.id, { status: 'enabled' });
  harness.advance(61_000);

  const result = await harness.service.tick();
  assert.equal(result.dispatched, 1);
  assert.equal(harness.chat.posts.length, 1);
  const post = harness.chat.posts[0];
  assert.equal(post.context.trustedService, true);
  assert.equal(post.body.content, '检查库存并给出补货建议');
  assert.equal(post.body.goalId, goalId);
  assert.equal(post.body.requestId, `schedule:${schedule.id}:${schedule.nextAt}`);

  const detail = harness.service.get({ actor: ADMIN }, schedule.id);
  assert.equal(detail.schedule.lastRunId, post.run.id);
  assert.equal(detail.schedule.status, 'enabled');
  assert.equal(detail.receipts.length, 1);
  assert.equal(detail.receipts[0].runId, post.run.id);

  const next = Date.parse(detail.schedule.nextAt);
  assert.ok(next > harness.now, 'the next instant is in the future');
});

test('a one-shot schedule retires after it fires', async () => {
  const harness = build();
  const at = new Date(harness.now + 60_000).toISOString();
  const { schedule } = await harness.service.create({ actor: ADMIN }, {
    requestId: requestId(), title: '一次性复盘', prompt: '复盘本周', conversationId: conversationId(), kind: 'at', at,
  });
  await harness.service.setStatus({ actor: ADMIN }, schedule.id, { status: 'enabled' });
  harness.advance(61_000);
  assert.equal((await harness.service.tick()).dispatched, 1);

  const detail = harness.service.get({ actor: ADMIN }, schedule.id);
  assert.equal(detail.schedule.status, 'done');
  assert.equal(detail.schedule.nextAt, null);
  assert.equal((await harness.service.tick()).dispatched, 0);
});

test('missed occurrences collapse into one dispatch and the next instant is in the future', async () => {
  const harness = build();
  const { schedule } = await createEvery(harness);
  await harness.service.setStatus({ actor: ADMIN }, schedule.id, { status: 'enabled' });
  harness.advance(10 * 60_000);

  assert.equal((await harness.service.tick()).dispatched, 1);
  const detail = harness.service.get({ actor: ADMIN }, schedule.id);
  assert.ok(Date.parse(detail.schedule.nextAt) > harness.now);
  assert.equal(harness.chat.posts.length, 1, 'one catch-up dispatch, not a backlog');
});

test('a dispatch failure blocks the schedule instead of retrying forever', async () => {
  const harness = build();
  const { schedule } = await createEvery(harness, { prompt: 'fail' });
  await harness.service.setStatus({ actor: ADMIN }, schedule.id, { status: 'enabled' });
  harness.advance(61_000);
  assert.equal((await harness.service.tick()).dispatched, 0);
  const detail = harness.service.get({ actor: ADMIN }, schedule.id);
  assert.equal(detail.schedule.status, 'blocked');
  assert.match(detail.schedule.note, /DISPATCH_FAILED/);
});

test('invalid schedules and viewer writes are refused', async () => {
  const harness = build();
  await assert.rejects(
    harness.service.create({ actor: ADMIN }, { requestId: requestId(), title: 't', prompt: 'p', conversationId: conversationId(), kind: 'at', at: '2020-01-01T00:00:00.000Z' }),
    error => error.code === 'SCHEDULE_INPUT',
  );
  await assert.rejects(
    harness.service.create({ actor: ADMIN }, { requestId: requestId(), title: 't', prompt: 'p', conversationId: conversationId(), kind: 'every', everySeconds: 30 }),
    error => error.code === 'SCHEDULE_INPUT',
  );
  const { schedule } = await createEvery(harness);
  await assert.rejects(
    harness.service.setStatus({ actor: VIEWER }, schedule.id, { status: 'enabled' }),
    error => error.code === 'SCHEDULE_FORBIDDEN',
  );
});

test('the HTTP surface creates, lists and enables a schedule', async () => {
  const routes = new Map();
  const health = new Map();
  const ctx = {
    storage: fakeStorage(),
    chat: fakeChat(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: (name, fn) => health.set(name, fn) },
    provide: () => () => {},
  };
  await apply(ctx, { tickMs: 3_600_000 });
  assert.equal(routes.size, ROUTES.length);
  for (const [method, path] of ROUTES) assert.ok(routes.has(`${method} ${path}`), `${method} ${path}`);

  const call = async (key, { params = {}, body = {}, query = {}, actor = ADMIN } = {}) => {
    const [method, pathname] = key.split(' ');
    return routes.get(key).handler({}, {}, { method, pathname, params, body, query, actor });
  };
  const created = await call('POST /api/schedules', {
    body: { requestId: requestId(), title: 't', prompt: 'p', conversationId: conversationId(), kind: 'every', everySeconds: 3600 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.schedule.status, 'disabled');
  const id = created.body.schedule.id;

  const enabled = await call('POST /api/schedules/:id/status', { params: { id }, body: { status: 'enabled' } });
  assert.equal(enabled.body.schedule.status, 'enabled');

  const listed = await call('GET /api/schedules');
  assert.equal(listed.body.total, 1);
  assert.equal(health.get('schedules')().status, 'ok');
});
