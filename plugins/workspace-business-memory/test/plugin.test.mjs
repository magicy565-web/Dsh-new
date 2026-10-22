import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { apply, ROUTES, TOOL_NAMES } from '../src/index.mjs';
import { HarnessError } from '../../../packages/harness-contracts/src/index.mjs';

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const OPERATOR = { subject: 'operator-1', role: 'operator', workspaceId: 'local' };
const VIEWER = { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' };

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

function fakeContext(options = {}) {
  const storage = options.storage ?? fakeStorage();
  const routes = new Map(), tools = new Map(), health = new Map();
  const ctx = {
    storage,
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    health: { register: (name, fn) => { health.set(name, fn); } },
  };
  if (options.workspace) ctx.workspace = options.workspace;
  if (options.audit) ctx.audit = options.audit;
  const call = async (key, { params = {}, body = {}, query = {}, actor = ADMIN } = {}) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, pathname] = key.split(' ');
    return definition.handler({}, {}, { method, pathname, params, body, query, actor });
  };
  const run = (name, args, actor = ADMIN) => tools.get(name).handler(args, { actor });
  return { ctx, storage, routes, tools, health, call, run };
}

function operatorSource(basis = '2026-10-21 与客户采购负责人通话确认') {
  return { kind: 'operator', basis, label: '电话记录' };
}

function proposalBody(overrides = {}) {
  return {
    requestId: randomUUID(),
    subjectType: 'customer',
    subjectId: 'customer-haiqi',
    subjectLabel: '海祺贸易',
    factKey: 'reorder-window',
    kind: 'fact',
    statement: '海祺贸易通常在每年 3 月和 9 月补货。',
    source: operatorSource(),
    tags: ['复购'],
    ...overrides,
  };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { return await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('the plugin registers every route, tool and its health probe', async () => {
  const harness = fakeContext();
  const dispose = await apply(harness.ctx, {});
  assert.equal(harness.routes.size, ROUTES.length);
  assert.deepEqual([...harness.tools.keys()].sort(), [...TOOL_NAMES].sort());
  for (const name of ['business_memory_status', 'business_memory_recall', 'business_memory_read',
    'business_memory_map', 'business_memory_brief']) {
    assert.equal(harness.tools.get(name).approval, 'never');
    assert.equal(harness.tools.get(name).readOnly, true);
  }
  for (const name of ['business_memory_propose', 'business_memory_review', 'business_memory_revoke']) {
    assert.equal(harness.tools.get(name).approval, 'always');
  }
  assert.equal(harness.health.get('business-memory')().status, 'ok');
  assert.equal(typeof dispose, 'function');
});

test('the HTTP surface proposes, reviews and recalls through one workspace', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  const created = await harness.call('POST /api/business-memory/records', { body: proposalBody(), actor: OPERATOR });
  assert.equal(created.status, 201);
  assert.equal(created.body.record.status, 'proposed');
  const active = await harness.call('GET /api/business-memory/records', { actor: VIEWER });
  assert.equal(active.body.total, 0);
  const pending = await harness.call('GET /api/business-memory/records', { query: { status: 'proposed' }, actor: ADMIN });
  assert.equal(pending.body.total, 1);
  const reviewed = await harness.call('POST /api/business-memory/records/:id/review', {
    params: { id: created.body.record.id }, body: { decision: 'approve', requestId: randomUUID() }, actor: ADMIN,
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.record.status, 'active');
  const recalled = await harness.call('GET /api/business-memory/records', { actor: VIEWER });
  assert.equal(recalled.body.total, 1);
  assert.equal(recalled.body.items[0].source.attestation, 'human-attested');
  const detail = await harness.call('GET /api/business-memory/records/:id', {
    params: { id: created.body.record.id }, actor: VIEWER,
  });
  assert.equal(detail.body.record.statement, '海祺贸易通常在每年 3 月和 9 月补货。');
  assert.equal(detail.body.record.canReview, false);
  const map = await harness.call('GET /api/business-memory/map');
  assert.equal(map.body.counts.active, 1);
  const brief = await harness.call('GET /api/business-memory/brief');
  assert.ok(Array.isArray(brief.body.items));
  const status = await harness.call('GET /api/business-memory/status');
  assert.equal(status.body.workspaceId, 'local');
});

test('the area page is a self-contained HTML response with a strict CSP', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  const response = await harness.call('GET /business-memory');
  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/u);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/u);
  const body = await response.text();
  assert.match(body, /经营记忆/u);
  assert.match(body, /未审核的提案不会进入经营判断/u);
  assert.match(body, /\/api\/business-memory\/brief/u);
  assert.equal(body.includes('<script src='), false, 'no external script');
});

test('bad configuration fails at mount time', async () => {
  const harness = fakeContext();
  await assert.rejects(() => apply(harness.ctx, { unknown: true }), error => error instanceof HarnessError && error.code === 'HARNESS_MANIFEST_INVALID');
  await assert.rejects(() => apply(harness.ctx, { productLibraryBaseURL: 'http://example.com' }), error => /loopback/u.test(error.message));
  await assert.rejects(() => apply(harness.ctx, { productLibraryBaseURL: 'http://127.0.0.1:8790/path' }), error => /exact HTTP/u.test(error.message));
  await assert.rejects(() => apply(harness.ctx, { timeoutMs: 5 }), error => /timeoutMs/u.test(error.message));
});

test('a missing service seam fails at mount time', async () => {
  await assert.rejects(() => apply({ http: { route() {} } }, {}), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
});

test('product-page sources are verified against the reviewed product library', async () => {
  const pageId = '11111111-1111-4111-8111-111111111111';
  const versionTwo = 'b'.repeat(64);
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    assert.equal(req.url, '/api/product-library/products/prod_alpha');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      productId: 'prod_alpha',
      pin: { product: { title: '亚麻衬衫' } },
      pages: [{
        id: pageId, version: 2, title: '销售说明', status: 'approved',
        history: [{ version: 1, sha256: 'a'.repeat(64) }, { version: 2, sha256: versionTwo }],
      }],
    }));
  }, async baseURL => {
    const harness = fakeContext();
    await apply(harness.ctx, { productLibraryBaseURL: baseURL });
    const source = { kind: 'product-page', productId: 'prod_alpha', pageId, version: 2, sha256: versionTwo };
    const created = await harness.call('POST /api/business-memory/records', {
      body: proposalBody({ subjectType: 'product', subjectId: 'prod_alpha', subjectLabel: '亚麻衬衫', source }), actor: OPERATOR,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.record.source.verified, true);
    assert.equal(created.body.record.source.sha256, versionTwo);
    assert.equal(created.body.record.source.label, '产品资料 · 亚麻衬衫 · 销售说明');
    const approved = await harness.call('POST /api/business-memory/records/:id/review', {
      params: { id: created.body.record.id }, body: { decision: 'approve', requestId: randomUUID() }, actor: ADMIN,
    });
    assert.equal(approved.body.record.source.attestation, 'source-verified');
    assert.equal(requests, 2, 'approval re-verifies the exact pinned version');

    await assert.rejects(
      () => harness.call('POST /api/business-memory/records', {
        body: proposalBody({ subjectId: 'prod_alpha', source: { ...source, sha256: 'c'.repeat(64) } }), actor: OPERATOR,
      }),
      error => error.code === 'BUSINESS_MEMORY_SOURCE_MISMATCH' && error.status === 409,
    );
    await assert.rejects(
      () => harness.call('POST /api/business-memory/records', {
        body: proposalBody({ subjectId: 'prod_alpha', source: { ...source, version: 3, sha256: undefined } }), actor: OPERATOR,
      }),
      error => error.code === 'BUSINESS_MEMORY_SOURCE_STALE',
    );
  });
});

test('a product-page source that no longer exists is refused instead of guessed', async () => {
  await withServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'PRODUCT_LIBRARY_ROOM_NOT_FOUND', message: 'missing' } }));
  }, async baseURL => {
    const harness = fakeContext();
    await apply(harness.ctx, { productLibraryBaseURL: baseURL });
    await assert.rejects(
      () => harness.call('POST /api/business-memory/records', {
        body: proposalBody({
          source: { kind: 'product-page', productId: 'prod_missing', pageId: '22222222-2222-4222-8222-222222222222', version: 1 },
        }), actor: OPERATOR,
      }),
      error => error.code === 'BUSINESS_MEMORY_SOURCE_NOT_FOUND' && error.status === 409,
    );
  });
});

test('an unreachable product library fails closed without writing memory', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, { productLibraryBaseURL: 'http://127.0.0.1:1' });
  await assert.rejects(
    () => harness.call('POST /api/business-memory/records', {
      body: proposalBody({
        source: { kind: 'product-page', productId: 'prod_alpha', pageId: '33333333-3333-4333-8333-333333333333', version: 1 },
      }), actor: OPERATOR,
    }),
    error => error.code === 'BUSINESS_MEMORY_SOURCE_UNAVAILABLE' && error.status === 503,
  );
  assert.equal(harness.storage.snapshot().workspaces, undefined, 'nothing was written');
});

test('conversation sources can be disabled for a reviewed composition', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, { allowConversationSources: false });
  await assert.rejects(
    () => harness.call('POST /api/business-memory/records', {
      body: proposalBody({ source: { kind: 'conversation', ref: 'conversation-42' } }), actor: OPERATOR,
    }),
    error => error.code === 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED',
  );
});

test('the workspace seam decides the role, not the actor header claim', async () => {
  const workspace = {
    resolve: actor => ({
      workspaceId: 'local',
      subject: actor.subject,
      role: actor.subject === 'viewer-1' ? 'viewer' : actor.role,
    }),
  };
  const harness = fakeContext({ workspace });
  await apply(harness.ctx, {});
  await assert.rejects(
    () => harness.call('POST /api/business-memory/records', { body: proposalBody(), actor: { ...ADMIN, subject: 'viewer-1', role: 'admin' } }),
    error => error.code === 'BUSINESS_MEMORY_FORBIDDEN',
  );
  const created = await harness.call('POST /api/business-memory/records', { body: proposalBody(), actor: OPERATOR });
  await assert.rejects(
    () => harness.call('POST /api/business-memory/records/:id/review', {
      params: { id: created.body.record.id }, body: { decision: 'approve', requestId: randomUUID() }, actor: OPERATOR,
    }),
    error => error.code === 'BUSINESS_MEMORY_ADMIN_REQUIRED',
  );
});

test('model tools recall only active memory and propose pending candidates', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  const created = await harness.run('business_memory_propose', proposalBody());
  assert.equal(created.status, 'proposed');
  const active = await harness.run('business_memory_recall', {});
  assert.equal(active.total, 0);
  const pending = await harness.run('business_memory_recall', { status: 'proposed' });
  assert.equal(pending.total, 1);
  const read = await harness.run('business_memory_read', { id: created.id });
  assert.equal(read.record.statement.includes('3 月和 9 月'), true);
  const map = await harness.run('business_memory_map', {});
  assert.equal(map.counts.proposed, 1);
  const brief = await harness.run('business_memory_brief', {});
  assert.ok(brief.items.length >= 1);
  assert.equal(brief.basedOn.active, 0);
});

test('the context endpoint compiles the task block and keeps an injection receipt', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  const created = await harness.call('POST /api/business-memory/records', { body: proposalBody(), actor: OPERATOR });
  await harness.call('POST /api/business-memory/records/:id/review', {
    params: { id: created.body.record.id }, body: { decision: 'approve', requestId: randomUUID() }, actor: ADMIN,
  });
  const context = await harness.call('POST /api/business-memory/context', {
    body: { taskId: 'session-1:1', sessionId: 'session-1', query: '海祺 补货', refs: [{ subjectType: 'customer', subjectId: 'customer-haiqi' }] },
  });
  assert.equal(context.status, 200);
  assert.match(context.body.text, new RegExp(`mem:${created.body.record.id}`, 'u'));
  assert.equal(context.body.items[0].why, 'subject-match');
  assert.equal(context.body.counts.active, 1);
  const receipts = await harness.call('GET /api/business-memory/injections', { query: { taskId: 'session-1:1' } });
  assert.equal(receipts.body.total, 1);
  assert.deepEqual(receipts.body.items[0].ids, [created.body.record.id]);
  await assert.rejects(
    () => harness.call('GET /api/business-memory/injections', { actor: VIEWER }),
    error => error.code === 'BUSINESS_MEMORY_ADMIN_REQUIRED',
  );
});
