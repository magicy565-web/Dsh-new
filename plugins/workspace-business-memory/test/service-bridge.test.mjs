// The host service bridge is the only HTTP path a separate process may use.
// These tests pin its two properties: it fails closed without a dedicated
// token, and it only ever answers for this composition's own workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { applyService } from '../src/index.mjs';
import { createBusinessMemoryService } from '../src/domain.mjs';

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

function fakeContext() {
  const routes = new Map();
  const tools = new Map();
  const ctx = {
    storage: fakeStorage(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
  };
  const call = async (key, { params = {}, body = {}, query = {}, headers = {} } = {}) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, pathname] = key.split(' ');
    return definition.handler({ headers }, {}, { method, pathname, params, body, query });
  };
  return { ctx, routes, call };
}

async function tokenFile() {
  const dir = await mkdtemp(join(tmpdir(), 'bm-service-'));
  const path = join(dir, 'service.token');
  const token = randomBytes(32).toString('base64url');
  await writeFile(path, token, { mode: 0o600 });
  return { dir, path, token };
}

function proposal(overrides = {}) {
  return {
    requestId: randomUUID(),
    subjectType: 'customer',
    subjectId: 'customer-haiqi',
    subjectLabel: '海祺贸易',
    factKey: 'reorder-window',
    kind: 'fact',
    statement: '海祺贸易通常在每年 3 月和 9 月补货。',
    source: { kind: 'operator', basis: '2026-10-21 与客户采购负责人通话确认', label: '电话记录' },
    ...overrides,
  };
}

async function mountBridge({ withToken = true } = {}) {
  const harness = fakeContext();
  const service = createBusinessMemoryService({ storage: harness.ctx.storage });
  const file = await tokenFile();
  await applyService(harness.ctx, service, {
    workspaceId: 'local',
    serviceTokenFile: withToken ? file.path : null,
  });
  return { ...harness, service, file };
}

test('the bridge is unavailable until a service token is configured', async () => {
  const harness = await mountBridge({ withToken: false });
  try {
    await assert.rejects(
      harness.call('POST /api/business-memory/service/context', { body: { query: '补货' } }),
      error => error.code === 'BUSINESS_MEMORY_SERVICE_UNCONFIGURED' && error.status === 503,
    );
  } finally { await rm(harness.file.dir, { recursive: true, force: true }); }
});

test('the bridge refuses a missing or wrong service token', async () => {
  const harness = await mountBridge();
  try {
    await assert.rejects(
      harness.call('POST /api/business-memory/service/context', { body: { query: '补货' } }),
      error => error.code === 'BUSINESS_MEMORY_SERVICE_UNAUTHORIZED' && error.status === 401,
    );
    await assert.rejects(
      harness.call('POST /api/business-memory/service/context', {
        body: { query: '补货' },
        headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
      }),
      error => error.code === 'BUSINESS_MEMORY_SERVICE_UNAUTHORIZED',
    );
    await assert.rejects(
      harness.call('POST /api/business-memory/service/context', {
        body: { query: '补货' },
        headers: { authorization: harness.file.token },
      }),
      error => error.code === 'BUSINESS_MEMORY_SERVICE_UNAUTHORIZED',
    );
  } finally { await rm(harness.file.dir, { recursive: true, force: true }); }
});

test('an authenticated service compiles exactly the recalled facts and leaves one receipt', async () => {
  const harness = await mountBridge();
  const auth = { authorization: `Bearer ${harness.file.token}` };
  try {
    const pending = await harness.service.propose({}, proposal({ statement: '海祺贸易的补货窗口是 3 月和 9 月。' }));
    await harness.service.review({}, pending.record.id, { decision: 'approve', requestId: randomUUID() });

    const response = await harness.call('POST /api/business-memory/service/context', {
      body: { taskId: 'task-1', query: '海祺 补货' }, headers: auth,
    });
    assert.equal(response.status, 200);
    assert.match(response.body.text, /海祺贸易/);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].id, pending.record.id);
    assert.equal(response.body.counts.injected, 1);

    const receipts = harness.service.injections({}, { taskId: 'task-1' });
    assert.equal(receipts.items.length, 1);
    assert.deepEqual(receipts.items[0].ids, [pending.record.id]);
  } finally { await rm(harness.file.dir, { recursive: true, force: true }); }
});

test('the bridge cannot widen its own workspace through the body', async () => {
  const harness = await mountBridge();
  try {
    await assert.rejects(
      harness.call('POST /api/business-memory/service/context', {
        body: { query: '补货', workspaceId: 'another-tenant' },
        headers: { authorization: `Bearer ${harness.file.token}` },
      }),
      error => error.code === 'BUSINESS_MEMORY_INPUT',
    );
  } finally { await rm(harness.file.dir, { recursive: true, force: true }); }
});

test('verify reports a superseded fact as changed, without rewriting the receipt', async () => {
  const harness = await mountBridge();
  const auth = { authorization: `Bearer ${harness.file.token}` };
  try {
    const first = await harness.service.propose({}, proposal());
    await harness.service.review({}, first.record.id, { decision: 'approve', requestId: randomUUID() });
    const compiled = await harness.call('POST /api/business-memory/service/context', {
      body: { taskId: 'task-2', query: '补货' }, headers: auth,
    });
    const ids = compiled.body.items.map(item => item.id);

    const current = await harness.call('POST /api/business-memory/service/verify', { body: { ids }, headers: auth });
    assert.equal(current.body.current, true);
    assert.deepEqual(current.body.changed, []);

    const second = await harness.service.propose({}, proposal({ statement: '海祺贸易改为每年 4 月和 10 月补货。' }));
    await harness.service.review({}, second.record.id, { decision: 'approve', requestId: randomUUID() });

    const stale = await harness.call('POST /api/business-memory/service/verify', { body: { ids }, headers: auth });
    assert.equal(stale.body.current, false);
    assert.deepEqual(stale.body.changed, ids);

    const receipts = harness.service.injections({}, { taskId: 'task-2' });
    assert.deepEqual(receipts.items[0].ids, ids, 'verify must not rewrite what the run saw');
  } finally { await rm(harness.file.dir, { recursive: true, force: true }); }
});
