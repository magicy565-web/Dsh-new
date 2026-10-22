import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apply, proposalRequestId } from '../index.js';

function fakeContext() {
  const tools = new Map();
  const effects = [];
  return {
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    effect: callback => { const disposer = callback(); effects.push(disposer); return disposer; },
    toolsMap: tools,
    effects,
  };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  process.env.BUSINESS_MEMORY_BASE_URL = `http://127.0.0.1:${port}`;
  try { return await run(`http://127.0.0.1:${port}`); }
  finally {
    delete process.env.BUSINESS_MEMORY_BASE_URL;
    await new Promise(resolve => server.close(resolve));
  }
}

const sample = {
  subjectType: 'customer', subjectId: 'customer-haiqi', subjectLabel: '海祺贸易',
  factKey: 'reorder-window', kind: 'fact', statement: '海祺贸易通常在每年 3 月和 9 月补货。',
  source: { kind: 'operator', basis: '2026-10-21 与客户采购负责人通话确认', label: '电话记录' },
  tags: ['复购'],
};

test('registers six tools and no human decision tool', () => {
  const ctx = fakeContext();
  apply(ctx, {});
  assert.deepEqual([...ctx.toolsMap.keys()].sort(), [
    'business_memory_brief', 'business_memory_map', 'business_memory_propose',
    'business_memory_read', 'business_memory_recall', 'business_memory_status',
  ]);
  assert.equal(ctx.toolsMap.has('business_memory_review'), false);
  assert.equal(ctx.toolsMap.has('business_memory_revoke'), false);
  for (const tool of ctx.toolsMap.values()) {
    assert.equal(typeof tool.output.render, 'function');
    assert.deepEqual(tool.output.render({}, { ok: true }), [{ type: 'text', text: '{\n  "ok": true\n}' }]);
    assert.equal(tool.execute.length, 2);
  }
  assert.equal(ctx.effects.length, 6);
});

test('status, map and brief proxy the harness surface', async () => {
  const seen = [];
  await withServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    assert.equal((await ctx.toolsMap.get('business_memory_status').execute({}, {})).path, '/api/business-memory/status');
    assert.equal((await ctx.toolsMap.get('business_memory_map').execute({}, {})).path, '/api/business-memory/map');
    assert.equal((await ctx.toolsMap.get('business_memory_brief').execute({}, {})).path, '/api/business-memory/brief');
  });
  assert.deepEqual(seen, ['/api/business-memory/status', '/api/business-memory/map', '/api/business-memory/brief']);
});

test('recall builds a bounded query and never asks for non-active status', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/api/business-memory/records?q=linen&subjectType=product&limit=5');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total: 0, items: [] }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const value = await ctx.toolsMap.get('business_memory_recall').execute({ q: 'linen', subjectType: 'product', limit: 5 }, {});
    assert.equal(value.total, 0);
  });
});

test('propose creates a deterministic idempotent command and strips unknown fields', async () => {
  const bodies = [];
  await withServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/business-memory/records');
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      bodies.push(JSON.parse(text));
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ record: { id: '11111111-1111-4111-8111-111111111111', status: 'proposed' } }));
    });
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const tool = ctx.toolsMap.get('business_memory_propose');
    await tool.execute(sample, {});
    await tool.execute({ ...sample }, {});
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].requestId, bodies[1].requestId, 'an identical retry replays the same candidate');
    assert.match(bodies[0].requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/u);
    assert.equal(bodies[0].status, undefined);
    assert.equal(bodies[0].source.kind, 'operator');
    const changed = proposalRequestId({ ...sample, statement: '另一条事实' });
    assert.notEqual(changed, bodies[0].requestId);
  });
});

test('a harness refusal keeps its error code and message', async () => {
  await withServer((_req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED', message: 'No verified product-page source is configured.' } }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    await assert.rejects(
      () => ctx.toolsMap.get('business_memory_propose').execute(sample, {}),
      /BUSINESS_MEMORY_SOURCE_UNCONFIGURED: No verified product-page source is configured\./u,
    );
  });
});

test('read rejects malformed ids before any request', async () => {
  const ctx = fakeContext();
  apply(ctx, {});
  await assert.rejects(() => ctx.toolsMap.get('business_memory_read').execute({ id: '../secret' }, {}), /BUSINESS_MEMORY_INPUT/u);
});

test('an unreachable harness fails with an explicit code instead of fabricating memory', async () => {
  process.env.BUSINESS_MEMORY_BASE_URL = 'http://127.0.0.1:1';
  try {
    const ctx = fakeContext();
    apply(ctx, {});
    await assert.rejects(() => ctx.toolsMap.get('business_memory_status').execute({}, {}), /BUSINESS_MEMORY_UNAVAILABLE/u);
  } finally {
    delete process.env.BUSINESS_MEMORY_BASE_URL;
  }
});

test('the base URL must be an exact HTTP(S) origin', () => {
  process.env.BUSINESS_MEMORY_BASE_URL = 'http://127.0.0.1:8790/api';
  try {
    assert.throws(() => apply(fakeContext(), {}), /exact HTTP\(S\) origin/u);
  } finally {
    delete process.env.BUSINESS_MEMORY_BASE_URL;
  }
});
