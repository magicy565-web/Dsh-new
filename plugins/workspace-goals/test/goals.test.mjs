import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalService } from '../src/domain.mjs';
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

function service(overrides = {}) {
  return createGoalService({ storage: fakeStorage(), ...overrides });
}

test('a goal is created once and replayed by requestId', async () => {
  const goals = service();
  const key = requestId();
  const first = await goals.create({ actor: ADMIN }, { requestId: key, title: '把海祺的补货节奏固定下来' });
  assert.equal(first.goal.status, 'open');
  assert.equal(first.replayed, false);

  const replay = await goals.create({ actor: ADMIN }, { requestId: key, title: '另一个标题' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.goal.id, first.goal.id);
  assert.equal(replay.goal.title, '把海祺的补货节奏固定下来');
});

test('a goal follows the transition table and terminal states stay closed', async () => {
  const goals = service();
  const { goal } = await goals.create({ actor: ADMIN }, { requestId: requestId(), title: '目标' });

  await goals.setStatus({ actor: ADMIN }, goal.id, { status: 'active' });
  await goals.setStatus({ actor: ADMIN }, goal.id, { status: 'blocked', note: '等客户回复' });
  await goals.setStatus({ actor: ADMIN }, goal.id, { status: 'active' });
  const done = await goals.setStatus({ actor: ADMIN }, goal.id, { status: 'done' });
  assert.equal(done.goal.status, 'done');
  assert.equal(done.goal.terminal, true);
  assert.ok(done.goal.closedAt);

  await assert.rejects(
    goals.setStatus({ actor: ADMIN }, goal.id, { status: 'active' }),
    error => error.code === 'GOAL_TRANSITION' && error.status === 409,
  );
  await assert.rejects(
    goals.setStatus({ actor: ADMIN }, goal.id, { status: 'unknown' }),
    error => error.code === 'GOAL_INPUT',
  );
});

test('a viewer cannot move a goal but can read it', async () => {
  const goals = service();
  const { goal } = await goals.create({ actor: ADMIN }, { requestId: requestId(), title: '目标' });
  await assert.rejects(
    goals.setStatus({ actor: VIEWER }, goal.id, { status: 'active' }),
    error => error.code === 'GOAL_FORBIDDEN' && error.status === 403,
  );
  assert.equal(goals.get({ actor: VIEWER }, goal.id).goal.id, goal.id);
});

test('two workspaces cannot see each other', async () => {
  const resolveWorkspace = actor => ({ workspaceId: actor.workspaceId, subject: actor.subject, role: actor.role });
  const goals = service({ resolveWorkspace });
  const { goal } = await goals.create({ actor: ADMIN }, { requestId: requestId(), title: '目标' });
  assert.throws(
    () => goals.get({ actor: { subject: 'other', role: 'admin', workspaceId: 'other' } }, goal.id),
    error => error.code === 'GOAL_NOT_FOUND',
  );
  assert.equal(goals.list({ actor: { subject: 'other', role: 'admin', workspaceId: 'other' } }).total, 0);
});

test('a goal lists the runs the chat substrate owns', async () => {
  const runs = [
    { id: crypto.randomUUID(), goalId: null, status: 'completed', createdAt: new Date().toISOString(), endedAt: null, error: null },
  ];
  let goalId = null;
  const chat = {
    listRunsByGoal: (_context, id, { limit }) => ({
      total: runs.filter(run => run.goalId === id).length,
      items: runs.filter(run => run.goalId === id).slice(0, limit),
    }),
  };
  const goals = service({ chat });
  const created = await goals.create({ actor: ADMIN }, { requestId: requestId(), title: '目标' });
  goalId = created.goal.id;
  runs[0].goalId = goalId;

  const detail = goals.get({ actor: ADMIN }, goalId);
  assert.equal(detail.runs.total, 1);
  assert.equal(detail.runs.items[0].id, runs[0].id);
});

test('the HTTP surface creates, lists and moves a goal', async () => {
  const routes = new Map();
  const health = new Map();
  const ctx = {
    storage: fakeStorage(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: (name, fn) => health.set(name, fn) },
    provide: () => () => {},
  };
  await apply(ctx, {});
  assert.equal(routes.size, ROUTES.length);
  for (const [method, path] of ROUTES) assert.ok(routes.has(`${method} ${path}`), `${method} ${path}`);

  const page = await routes.get('GET /goals').handler({}, {}, {});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /新建目标/u);
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  assert.doesNotThrow(() => new Function(script), 'the inline page script parses');

  const call = async (key, { params = {}, body = {}, query = {}, actor = ADMIN } = {}) => {
    const [method, pathname] = key.split(' ');
    return routes.get(key).handler({}, {}, { method, pathname, params, body, query, actor });
  };

  const created = await call('POST /api/goals', { body: { requestId: requestId(), title: '目标' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.goal.status, 'open');
  const id = created.body.goal.id;

  const listed = await call('GET /api/goals', { query: { status: 'all' } });
  assert.equal(listed.body.total, 1);

  const moved = await call('POST /api/goals/:id/status', { params: { id }, body: { status: 'active' } });
  assert.equal(moved.body.goal.status, 'active');

  const detail = await call('GET /api/goals/:id', { params: { id } });
  assert.equal(detail.body.goal.id, id);
  assert.equal(detail.body.runs.total, 0);

  assert.equal(health.get('goals')().status, 'ok');
});
