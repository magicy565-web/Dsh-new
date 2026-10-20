import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.mjs';
import { DEMO_WORKERS } from '../src/catalog.mjs';

const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };

function fakeContext(initial = {}) {
  const state = structuredClone(initial);
  const routes = new Map(), tools = new Map(), health = new Map();
  const storage = {
    directory: 'fake',
    read: () => structuredClone(state),
    update: async mutator => {
      const clone = structuredClone(state);
      const result = mutator(clone);
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, clone);
      return structuredClone(result);
    },
    close: async () => {},
  };
  const ctx = {
    storage,
    approval: {
      request: async () => ({ id: 'ticket', status: 'pending', expiresAt: null }),
      decide: async () => ({ id: 'ticket', status: 'approved' }),
      consume: async () => true,
      list: () => [],
    },
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: tool => { tools.set(tool.name, tool); } },
    health: { register: (name, fn) => { health.set(name, fn); } },
  };
  const call = async (key, { params = {}, body = {}, query = {}, actor: who = actor } = {}) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, pathname] = key.split(' ');
    const result = await definition.handler({}, {}, { method, pathname, params, body, query, actor: who });
    if (typeof Response !== 'undefined' && result instanceof Response) {
      return { status: result.status, headers: result.headers, text: await result.text() };
    }
    return result;
  };
  return { ctx, routes, tools, health, state, call };
}

test('the plugin registers its routes, tools, health probe and static Muse page', async () => {
  const { ctx, routes, tools, health } = fakeContext();
  const dispose = await apply(ctx, { demo: false });
  assert.equal(routes.size, 11);
  assert.deepEqual([...tools.keys()].sort(), ['market_activate_worker', 'market_desk', 'market_workers']);
  assert.equal(tools.get('market_activate_worker').approval, 'always');
  for (const name of ['market_workers', 'market_desk']) {
    assert.equal(tools.get(name).approval, 'never');
    assert.equal(tools.get(name).readOnly, true);
  }
  assert.ok(health.has('market'));
  assert.equal(typeof dispose, 'function');
});

test('the plugin refuses missing seams and an invalid config', async () => {
  await assert.rejects(() => apply({}), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  const { ctx } = fakeContext();
  await assert.rejects(() => apply({ ...ctx, storage: undefined }), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(() => apply({ ...ctx, http: undefined }), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(() => apply(ctx, { demo: 'yes' }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  await assert.rejects(() => apply(ctx, null), error => error.code === 'HARNESS_MANIFEST_INVALID');
});

test('demo: true seeds the published catalog while the default stays empty', async () => {
  const demoContext = fakeContext();
  await apply(demoContext.ctx, { demo: true });
  const status = await demoContext.call('GET /api/market/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.source, 'demo');
  assert.equal(status.body.demo, true);
  assert.equal(status.body.runtime, 'off');
  assert.equal(status.body.counts.workers, DEMO_WORKERS.length);

  const list = await demoContext.call('GET /api/market/workers');
  assert.equal(list.body.total, DEMO_WORKERS.length);
  assert.equal(list.body.workers.length, DEMO_WORKERS.length);
  for (const row of list.body.workers) {
    assert.equal(row.rating.label, '还没有评价');
    assert.equal(row.rating.average, null);
    assert.equal(row.owner.bio, undefined);
  }
  const inquiry = list.body.workers.find(row => row.id === 'inquiry-assistant');
  assert.equal(inquiry.owner.verificationLevel, 'email_verified');

  const filtered = await demoContext.call('GET /api/market/workers', { query: { q: '询盘' } });
  assert.ok(filtered.body.workers.some(row => row.id === 'inquiry-assistant'));
  const research = await demoContext.call('GET /api/market/workers', { query: { category: '研究' } });
  assert.ok(research.body.workers.length >= 1);
  assert.ok(research.body.workers.every(row => row.category === '研究'));

  const emptyContext = fakeContext();
  await apply(emptyContext.ctx, {});
  const emptyStatus = await emptyContext.call('GET /api/market/status');
  assert.equal(emptyStatus.body.source, 'workspace');
  assert.equal(emptyStatus.body.counts.workers, 0);
  assert.equal(emptyContext.health.get('market')().status, 'degraded');
  const emptyList = await emptyContext.call('GET /api/market/workers');
  assert.deepEqual(emptyList.body.workers, []);
});

test('scheme pages expose the five blocks and refuse unknown or unpublished workers', async () => {
  const plain = fakeContext();
  await apply(plain.ctx, { demo: false });
  const seeded = fakeContext();
  await apply(seeded.ctx, { demo: true });
  const scheme = await seeded.call('GET /api/market/workers/:workerId/scheme', { params: { workerId: 'inquiry-assistant' } });
  assert.equal(scheme.status, 200);
  assert.equal(scheme.body.scheme.editable, false);
  assert.equal(scheme.body.scheme.services.length, 1);
  assert.equal(scheme.body.scheme.doesNot, '不代替买方对外发送。');
  assert.equal(scheme.body.scheme.owner.verificationProvider, 'stub');
  assert.deepEqual(scheme.body.scheme.portfolio, []);
  assert.deepEqual(scheme.body.scheme.reviews, []);
  assert.equal(scheme.body.scheme.reviewSummary.label, '还没有评价');
  assert.equal(scheme.body.scheme.ctaLabel, '开通');

  await assert.rejects(
    () => seeded.call('GET /api/market/workers/:workerId/scheme', { params: { workerId: 'not-a-worker' } }),
    error => error.code === 'HARNESS_MARKET_WORKER_NOT_FOUND' && error.status === 404,
  );
  await assert.rejects(
    () => plain.call('GET /api/market/workers/:workerId/scheme', { params: { workerId: 'inquiry-assistant' } }),
    error => error.code === 'HARNESS_MARKET_WORKER_NOT_FOUND' && error.status === 404,
  );
});

test('activation creates work computers, validates input and is idempotent on requestId', async () => {
  const seeded = fakeContext();
  await apply(seeded.ctx, { demo: true });

  const created = await seeded.call('POST /api/market/workers/:workerId/activate', {
    params: { workerId: 'inquiry-assistant' },
    body: { scale: 'standard', budgetCap: 800, confirmActionIds: ['allow-draft'], requestId: 'req-1' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.duplicate, false);
  assert.equal(created.body.activation.computers, 2);
  assert.equal(created.body.computers.length, 2);
  for (const computer of created.body.computers) assert.equal(computer.status, 'booting');

  const duplicate = await seeded.call('POST /api/market/workers/:workerId/activate', {
    params: { workerId: 'inquiry-assistant' },
    body: { scale: 'standard', budgetCap: 800, confirmActionIds: ['allow-draft'], requestId: 'req-1' },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.activation.id, created.body.activation.id);

  const desk = await seeded.call('GET /api/market/desk');
  assert.equal(desk.body.status, 'ready');
  assert.equal(desk.body.hires.length, 1);
  assert.equal(desk.body.instances.length, 2);

  await assert.rejects(
    () => seeded.call('POST /api/market/workers/:workerId/activate', {
      params: { workerId: 'inquiry-assistant' }, body: { scale: 'huge', budgetCap: 800 },
    }),
    error => error.code === 'HARNESS_MARKET_SCALE_INVALID' && error.status === 400,
  );
  await assert.rejects(
    () => seeded.call('POST /api/market/workers/:workerId/activate', {
      params: { workerId: 'inquiry-assistant' }, body: { scale: 'light', budgetCap: 1e9 },
    }),
    error => error.code === 'HARNESS_MARKET_BUDGET_INVALID' && error.status === 400,
  );
  await assert.rejects(
    () => seeded.call('POST /api/market/workers/:workerId/activate', {
      params: { workerId: 'inquiry-assistant' }, body: { scale: 'light', budgetCap: 10, confirmActionIds: ['send-anything'] },
    }),
    error => error.code === 'HARNESS_MARKET_CONFIRM_INVALID' && error.status === 400,
  );
  await assert.rejects(
    () => seeded.call('POST /api/market/workers/:workerId/activate', {
      params: { workerId: 'missing-worker' }, body: { scale: 'light', budgetCap: 10 },
    }),
    error => error.code === 'HARNESS_MARKET_WORKER_NOT_FOUND' && error.status === 404,
  );
});

test('desk screens stay unavailable while the computer runtime is off', async () => {
  const seeded = fakeContext();
  await apply(seeded.ctx, { demo: true });
  const created = await seeded.call('POST /api/market/workers/:workerId/activate', {
    params: { workerId: 'research-analyst' },
    body: { scale: 'fast', budgetCap: 1200 },
  });
  assert.equal(created.body.computers.length, 4);
  const computerId = created.body.computers[0].id;

  await assert.rejects(
    () => seeded.call('POST /api/market/desk/computers/:computerId/screen', { params: { computerId } }),
    error => error.code === 'COMPUTER_SCREEN_UNAVAILABLE' && error.status === 409,
  );
  await assert.rejects(
    () => seeded.call('POST /api/market/desk/computers/:computerId/screen', { params: { computerId: 'pc-missing' } }),
    error => error.code === 'HARNESS_MARKET_COMPUTER_NOT_FOUND' && error.status === 404,
  );
});

test('tools expose published workers, the desk and approval-gated activation', async () => {
  const seeded = fakeContext();
  await apply(seeded.ctx, { demo: true });
  const execution = { actor };

  const workers = await seeded.tools.get('market_workers').handler({ q: '询盘', limit: 5 }, execution);
  assert.equal(workers.source, 'demo');
  assert.ok(workers.workers.some(row => row.id === 'inquiry-assistant'));
  assert.ok(workers.workers.every(row => row.rating === undefined));

  const desk = await seeded.tools.get('market_desk').handler({}, execution);
  assert.equal(desk.status, 'empty');
  assert.equal(desk.runtime, 'off');

  const activated = await seeded.tools.get('market_activate_worker').handler({
    workerId: 'listing-auditor', scale: 'standard', budgetCap: 500, confirmActionIds: ['publish'], requestId: 'tool-1',
  }, execution);
  assert.equal(activated.duplicate, false);
  assert.equal(activated.scaleLabel, '标准');
  assert.equal(activated.computers.length, 2);

  const nextDesk = await seeded.tools.get('market_desk').handler({}, execution);
  assert.equal(nextDesk.status, 'ready');
  assert.equal(nextDesk.instances.length, 2);
});

test('the static page is self-contained, Muse-branded and served with a CSP', async () => {
  const seeded = fakeContext();
  await apply(seeded.ctx, { demo: true });

  const page = await seeded.call('GET /market');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(page.text, /<title>Muse · AI Worker 市场<\/title>/);
  assert.match(page.text, /\/market\/app\.js/);

  const css = await seeded.call('GET /market/app.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.text, /--muse-ink:#141b29/);

  const js = await seeded.call('GET /market/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.match(js.text, /\/api\/market\/status/);

  const redirect = await seeded.call('GET /');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/market');
});
