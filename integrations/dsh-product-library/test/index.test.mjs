import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apply } from '../index.js';

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
  process.env.PRODUCT_LIBRARY_BASE_URL = `http://127.0.0.1:${port}`;
  try { return await run(`http://127.0.0.1:${port}`); }
  finally {
    delete process.env.PRODUCT_LIBRARY_BASE_URL;
    await new Promise(resolve => server.close(resolve));
  }
}

test('registers four read-only product library tools', () => {
  const ctx = fakeContext();
  apply(ctx, {});
  assert.deepEqual([...ctx.toolsMap.keys()].sort(), ['product_library_list', 'product_library_read', 'product_library_search', 'product_library_status']);
  for (const tool of ctx.toolsMap.values()) {
    assert.equal(typeof tool.output.render, 'function');
    assert.deepEqual(tool.output.render({}, { ok: true }), [{ type: 'text', text: '{\n  "ok": true\n}' }]);
    assert.equal(tool.execute.length, 2);
  }
  assert.equal(ctx.effects.length, 4);
});

test('status, list and search proxy the harness HTTP surface', async () => {
  const seen = [];
  await withServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/product-library/status') res.end(JSON.stringify({ configured: false, source: 'unconfigured', rooms: 0 }));
    else if (req.url?.startsWith('/api/product-library/search')) res.end(JSON.stringify({ total: 1, items: [{ kind: 'document', id: 'doc-1' }] }));
    else res.end(JSON.stringify({ source: { configured: false }, items: [], total: 0 }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const status = await ctx.toolsMap.get('product_library_status').execute({}, {});
    assert.equal(status.configured, false);
    const list = await ctx.toolsMap.get('product_library_list').execute({ q: 'linen', limit: 5 }, {});
    assert.equal(list.total, 0);
    const search = await ctx.toolsMap.get('product_library_search').execute({ q: 'oeko', limit: 3 }, {});
    assert.equal(search.total, 1);
  });
  assert.deepEqual(seen, [
    '/api/product-library/status',
    '/api/product-library/products?q=linen&limit=5',
    '/api/product-library/search?q=oeko&limit=3',
  ]);
});

test('read encodes the exact product id and rejects malformed ids before any request', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/api/product-library/products/prod_alpha');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ productId: 'prod_alpha', pages: [] }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const value = await ctx.toolsMap.get('product_library_read').execute({ productId: 'prod_alpha' }, {});
    assert.equal(value.productId, 'prod_alpha');
    await assert.rejects(() => ctx.toolsMap.get('product_library_read').execute({ productId: '../secret' }, {}), /PRODUCT_LIBRARY_INPUT/u);
  });
});

test('an unreachable harness fails with an explicit code instead of fabricating data', async () => {
  process.env.PRODUCT_LIBRARY_BASE_URL = 'http://127.0.0.1:1';
  try {
    const ctx = fakeContext();
    apply(ctx, {});
    await assert.rejects(() => ctx.toolsMap.get('product_library_status').execute({}, {}), /PRODUCT_LIBRARY_UNAVAILABLE/u);
  } finally {
    delete process.env.PRODUCT_LIBRARY_BASE_URL;
  }
});

test('a harness refusal keeps its error code and message', async () => {
  await withServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'PRODUCT_LIBRARY_ROOM_NOT_FOUND', message: 'Open this product first.' } }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    await assert.rejects(() => ctx.toolsMap.get('product_library_read').execute({ productId: 'prod_missing' }, {}), /PRODUCT_LIBRARY_ROOM_NOT_FOUND: Open this product first\./u);
  });
});

test('an optional authorization header is forwarded to a protected harness', async () => {
  const seen = [];
  await withServer((req, res) => {
    seen.push(req.headers.authorization ?? null);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ configured: true, source: 'medusa-approved-context', rooms: 0 }));
  }, async () => {
    process.env.PRODUCT_LIBRARY_AUTHORIZATION = 'Basic d29ya3NwYWNlOnNlY3JldA==';
    try {
      const ctx = fakeContext();
      apply(ctx, {});
      const status = await ctx.toolsMap.get('product_library_status').execute({}, {});
      assert.equal(status.configured, true);
    } finally { delete process.env.PRODUCT_LIBRARY_AUTHORIZATION; }
  });
  assert.deepEqual(seen, ['Basic d29ya3NwYWNlOnNlY3JldA==']);
});
