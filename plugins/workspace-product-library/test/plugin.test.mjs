import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { apply, applyService } from '../src/index.mjs';
import { createProductLibraryService, PRODUCT_ID } from '../src/library.mjs';
import { createMedusaProductContextSource, readPrivateToken } from '../src/source.mjs';

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const VIEWER = { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' };

function row(overrides = {}) {
  const id = overrides.id ?? 'prod_alpha';
  return {
    product: {
      id, title: 'Washed Linen Blend 165 GSM', subtitle: 'Natural texture', handle: 'washed-linen-165',
      description: 'Washed linen blend for resort shirts.', status: 'published', thumbnail: 'https://cdn.example/linen.jpg',
      variants: [{ id: 'variant_1', title: 'Sand', sku: 'WLB165-SAND' }],
    },
    context: {
      id: 'pctx_1', product_id: id, status: 'approved', readiness_score: 92,
      buyer_profile: 'Resort wear brands in the US and EU.',
      target_markets: ['United States', 'Germany'], use_cases: ['Resort shirts', 'Summer sets'],
      selling_points: ['Breathable', 'Reactive dye'], evidence: [{ id: 'ev_1', label: 'OEKO-TEX certificate', type: 'certificate', status: 'verified', sha256: 'a'.repeat(64) }],
      commercial_policy: { moq: 300, currency: 'USD', price_min: 2.9, price_max: 3.4, lead_time_days: 30 },
      missing_evidence: [], agent_summary: 'Ready for US resortwear sampling.',
      source_hash: 'b'.repeat(64), review_version: 3, updated_at: '2026-10-20T00:00:00.000Z',
    },
    ...overrides,
  };
}

function syntheticSource(rows = [row()]) {
  let current = structuredClone(rows);
  return {
    configured: true,
    kind: 'synthetic-approved-context',
    async list({ q = '' } = {}) {
      return { items: current.filter(item => !q || item.product.title.toLowerCase().includes(q.toLowerCase())) };
    },
    async read(id) { return current.find(item => item.product.id === id) ?? null; },
    replace(next) { current = structuredClone(next); },
  };
}

function fakeArtifacts() {
  const blobs = new Map();
  return {
    async create(body) {
      const bytes = Buffer.from(body.base64, 'base64');
      const id = randomUUID();
      const mimeType = body.mimeType ?? 'application/pdf';
      const artifact = { id, filename: body.filename, mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      blobs.set(id, { bytes, filename: body.filename, mimeType });
      return { artifact };
    },
    async download(id) {
      const blob = blobs.get(id);
      if (!blob) { const error = new Error('missing artifact'); error.code = 'ARTIFACT_NOT_FOUND'; throw error; }
      return { bytes: Buffer.from(blob.bytes), filename: blob.filename, mimeType: blob.mimeType };
    },
    async delete(id) { blobs.delete(id); },
  };
}

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
    artifacts: fakeArtifacts(),
    approval: { request: async () => ({ id: 't', status: 'pending' }), decide: async () => ({ id: 't', status: 'approved' }), consume: async () => true, list: () => [] },
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: tool => { tools.set(tool.name, tool); } },
    health: { register: (name, fn) => { health.set(name, fn); } },
  };
  const call = async (key, { params = {}, body = {}, query = {}, actor = ADMIN } = {}) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, pathname] = key.split(' ');
    return definition.handler({}, {}, { method, pathname, params, body, query, actor });
  };
  const run = (name, args, actor = ADMIN) => tools.get(name).handler(args, { actor });
  return { ctx, routes, tools, health, state, call, run };
}

async function mounted(options = {}) {
  const source = options.source ?? syntheticSource(options.rows);
  const harness = fakeContext(options.initial);
  const artifacts = options.artifacts ?? fakeArtifacts();
  const service = createProductLibraryService({ storage: harness.ctx.storage, source, artifacts, workspaceId: 'local' });
  const dispose = await applyService(harness.ctx, service);
  return { ...harness, source, artifacts, service, dispose };
}

test('the plugin registers its routes, tools and health probe', async () => {
  const harness = await mounted();
  assert.equal(harness.routes.size, 13);
  assert.deepEqual([...harness.tools.keys()].sort(), [
    'product_library_approve_page', 'product_library_comment', 'product_library_create_page',
    'product_library_list', 'product_library_open', 'product_library_read',
    'product_library_save_page', 'product_library_search', 'product_library_status', 'product_library_sync',
  ]);
  for (const name of ['product_library_status', 'product_library_list', 'product_library_search', 'product_library_read']) {
    assert.equal(harness.tools.get(name).approval, 'never');
    assert.equal(harness.tools.get(name).readOnly, true);
  }
  for (const name of ['product_library_open', 'product_library_sync', 'product_library_save_page', 'product_library_comment', 'product_library_approve_page']) {
    assert.equal(harness.tools.get(name).approval, 'always');
  }
  assert.equal(harness.health.get('product-library')().status, 'ok');
  assert.equal(typeof harness.dispose, 'function');
});

test('an unconfigured source is explicit and still lists rooms already stored', async () => {
  const harness = await mounted({ source: { configured: false, kind: 'unconfigured', list: async () => ({ items: [] }), read: async () => null } });
  const status = await harness.call('GET /api/product-library/status');
  assert.equal(status.body.configured, false);
  assert.equal(status.body.source, 'unconfigured');
  const list = await harness.call('GET /api/product-library/products');
  assert.equal(list.body.source.live, false);
  assert.equal(list.body.source.warning, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED');
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } }),
    error => error.code === 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED' && error.status === 503,
  );
});

test('open pins the approved product context and read exposes the exact pin', async () => {
  const harness = await mounted();
  const opened = await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.created, true);
  const read = await harness.call('GET /api/product-library/products/:productId', { params: { productId: 'prod_alpha' } });
  assert.equal(read.status, 200);
  assert.equal(read.body.pin.product.title, 'Washed Linen Blend 165 GSM');
  assert.equal(read.body.pin.context.reviewVersion, 3);
  assert.match(read.body.pin.hash, /^[a-f0-9]{64}$/u);
  assert.equal(read.body.canEdit, true);
  assert.equal(read.body.canApprove, true);
  assert.equal(read.body.source.configured, true);
  assert.equal(read.body.pages.length, 0);
});

test('a page stores citation hashes and reports current, unknown citations are refused', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const created = await harness.call('POST /api/product-library/products/:productId/pages', {
    params: { productId: 'prod_alpha' },
    body: { requestId: randomUUID(), title: 'US launch brief', body: 'Target resorts.', citations: [
      { source: 'context', field: 'buyer_profile' },
      { source: 'product', field: 'title' },
      { source: 'evidence', field: 'ev_1' },
    ] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.version, 1);
  const read = await harness.call('GET /api/product-library/products/:productId', { params: { productId: 'prod_alpha' } });
  const page = read.body.pages[0];
  assert.deepEqual(page.citations.map(item => item.status), ['current', 'current', 'current']);
  assert.equal(page.citations[0].preview, 'Resort wear brands in the US and EU.');

  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/pages', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), title: 'Bad', body: '', citations: [{ source: 'context', field: 'not_a_field' }] },
    }),
    error => error.code === 'PRODUCT_LIBRARY_CITATION_UNKNOWN' && error.status === 400,
  );
});

test('savePage enforces the exact revision, replays a requestId and rejects a changed replay', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await harness.call('POST /api/product-library/products/:productId/pages', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Draft', body: 'one' },
  })).body;
  const requestId = randomUUID();
  const saved = await harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId, expectedRevision: 1, title: 'Draft', body: 'two' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 2);
  const replay = await harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId, expectedRevision: 1, title: 'Draft', body: 'two' },
  });
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.version, 2);
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
      params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId, expectedRevision: 1, title: 'Draft', body: 'three' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_IDEMPOTENCY_CONFLICT' && error.status === 409,
  );
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
      params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 1, title: 'Draft', body: 'three' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_REVISION_CONFLICT' && error.status === 409,
  );
});

test('sync re-pins the context and makes old citations stale until they are saved again', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await harness.call('POST /api/product-library/products/:productId/pages', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Brief', body: 'pinned', citations: [{ source: 'context', field: 'buyer_profile' }] },
  })).body;
  const next = row();
  next.context.buyer_profile = 'Outdoor brands in Canada.';
  next.context.review_version = 4;
  next.context.source_hash = 'c'.repeat(64);
  harness.source.replace([next]);
  const synced = await harness.call('POST /api/product-library/products/:productId/sync', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  assert.equal(synced.body.changed, true);
  assert.ok(synced.body.changedFields.includes('context.buyer_profile'));
  assert.deepEqual(synced.body.stalePages, [page.pageId]);
  const read = await harness.call('GET /api/product-library/products/:productId', { params: { productId: 'prod_alpha' } });
  assert.equal(read.body.pages[0].citations[0].status, 'stale');
  const refreshed = await harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
    params: { productId: 'prod_alpha', pageId: page.pageId },
    body: { requestId: randomUUID(), expectedRevision: 1, title: 'Brief', body: 'pinned', citations: [{ source: 'context', field: 'buyer_profile' }] },
  });
  assert.equal(refreshed.status, 200);
  const after = await harness.call('GET /api/product-library/products/:productId', { params: { productId: 'prod_alpha' } });
  assert.equal(after.body.pages[0].citations[0].status, 'current');
});

test('approval is administrator-only and editing an approved page withdraws it', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await harness.call('POST /api/product-library/products/:productId/pages', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Brief', body: 'v1' },
  })).body;
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/pages/:pageId/approve', {
      params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 1, approved: true }, actor: VIEWER,
    }),
    error => error.code === 'PRODUCT_LIBRARY_FORBIDDEN' && error.status === 403,
  );
  const approved = await harness.call('POST /api/product-library/products/:productId/pages/:pageId/approve', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 1, approved: true },
  });
  assert.equal(approved.body.status, 'approved');
  const saved = await harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 2, title: 'Brief', body: 'v2' },
  });
  assert.equal(saved.body.status, 'draft');
  assert.equal(saved.body.approvalWithdrawn, true);
});

test('a viewer may comment but may not create, save or open', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await harness.call('POST /api/product-library/products/:productId/pages', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Brief', body: 'v1' },
  })).body;
  const comment = await harness.call('POST /api/product-library/products/:productId/pages/:pageId/comments', {
    params: { productId: 'prod_alpha', pageId: page.pageId },
    body: { requestId: randomUUID(), expectedRevision: 1, version: 1, body: 'Please add the EU market.' }, actor: VIEWER,
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.comments, 1);
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/pages/:pageId/save', {
      params: { productId: 'prod_alpha', pageId: page.pageId },
      body: { requestId: randomUUID(), expectedRevision: 2, title: 'Brief', body: 'v2' }, actor: VIEWER,
    }),
    error => error.code === 'PRODUCT_LIBRARY_FORBIDDEN',
  );
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_beta' }, body: { requestId: randomUUID() }, actor: VIEWER }),
    error => error.code === 'PRODUCT_LIBRARY_FORBIDDEN',
  );
});

test('search returns bounded snippets across pages and documents', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  await harness.call('POST /api/product-library/products/:productId/pages', {
    params: { productId: 'prod_alpha' },
    body: { requestId: randomUUID(), title: 'Resort launch', body: 'Target resort shirts and summer sets in the US.' },
  });
  await harness.call('POST /api/product-library/products/:productId/documents', {
    params: { productId: 'prod_alpha' },
    body: { requestId: randomUUID(), filename: 'certificate.pdf', base64: Buffer.from('pdf').toString('base64'), label: 'OEKO certificate', kind: 'certificate' },
  });
  const pageHits = await harness.call('GET /api/product-library/search', { query: { q: 'resort' } });
  assert.equal(pageHits.status, 200);
  assert.ok(pageHits.body.items.some(item => item.kind === 'page' && item.title === 'Resort launch'));
  assert.ok(pageHits.body.items.every(item => item.snippet.toLowerCase().includes('resort')));
  const docHits = await harness.call('GET /api/product-library/search', { query: { q: 'oeko' } });
  assert.ok(docHits.body.items.some(item => item.kind === 'document' && item.title === 'OEKO certificate'));
  const none = await harness.call('GET /api/product-library/search', { query: { q: 'nothing-matches-this' } });
  assert.equal(none.body.total, 0);
  await assert.rejects(
    () => harness.call('GET /api/product-library/search', { query: { q: '   ' } }),
    error => error.code === 'PRODUCT_LIBRARY_INPUT',
  );
  const viaTool = await harness.run('product_library_search', { q: 'resort' });
  assert.ok(viaTool.items.some(item => item.kind === 'page'));
});

test('documents are uploaded through the artifacts seam and downloaded only by hash match', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const bytes = Buffer.from('%PDF-1.4 synthetic spec sheet\n', 'utf8');
  const base64 = bytes.toString('base64');
  const requestId = randomUUID();
  const attached = await harness.call('POST /api/product-library/products/:productId/documents', {
    params: { productId: 'prod_alpha' },
    body: { requestId, filename: 'spec.pdf', base64, label: 'Test certificate', kind: 'certificate', evidenceId: 'ev_1' },
  });
  assert.equal(attached.status, 201);
  assert.equal(attached.body.size, bytes.length);
  assert.equal(attached.body.sha256, createHash('sha256').update(bytes).digest('hex'));
  const read = await harness.call('GET /api/product-library/products/:productId', { params: { productId: 'prod_alpha' } });
  assert.equal(read.body.documents.length, 1);
  assert.equal(read.body.documents[0].label, 'Test certificate');
  assert.equal(read.body.documents[0].evidenceId, 'ev_1');
  assert.match(read.body.documents[0].downloadPath, /\/documents\//u);
  assert.equal(read.body.counts.documents, 1);

  const download = await harness.call('GET /api/product-library/products/:productId/documents/:documentId', {
    params: { productId: 'prod_alpha', documentId: attached.body.documentId },
  });
  assert.ok(download instanceof Response);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

  const replay = await harness.call('POST /api/product-library/products/:productId/documents', {
    params: { productId: 'prod_alpha' },
    body: { requestId, filename: 'spec.pdf', base64, label: 'Test certificate', kind: 'certificate', evidenceId: 'ev_1' },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.documentId, attached.body.documentId);
});

test('documents reject unknown evidence, non-canonical base64 and oversized files', async () => {
  const harness = await mounted();
  await harness.call('POST /api/product-library/products/:productId/open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const small = Buffer.from('hello').toString('base64');
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/documents', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), filename: 'note.txt', base64: small, evidenceId: 'ev_missing' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_CITATION_UNKNOWN' && error.status === 400,
  );
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/documents', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), filename: 'note.txt', base64: 'not-base64!' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_INPUT',
  );
  const huge = Buffer.alloc(512 * 1024 + 1, 7).toString('base64');
  await assert.rejects(
    () => harness.call('POST /api/product-library/products/:productId/documents', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), filename: 'big.pdf', base64: huge },
    }),
    error => error.code === 'PRODUCT_LIBRARY_DOCUMENT_TOO_LARGE' && error.status === 413,
  );
});

test('the tools return the same domain results through execution.actor', async () => {
  const harness = await mounted();
  const opened = await harness.run('product_library_open', { productId: 'prod_alpha', requestId: randomUUID() });
  assert.equal(opened.created, true);
  const listed = await harness.run('product_library_list', {});
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].inLibrary, true);
  const created = await harness.run('product_library_create_page', {
    productId: 'prod_alpha', requestId: randomUUID(), title: 'Tool page', body: 'from tool',
    citations: [{ source: 'context', field: 'target_markets' }],
  });
  const read = await harness.run('product_library_read', { productId: 'prod_alpha' });
  assert.equal(read.pages[0].id, created.pageId);
  assert.equal(read.pages[0].citations[0].status, 'current');
});

test('the reviewed HTTP source reads only approved contexts and never leaks its token', async () => {
  const token = 'read-token-0123456789';
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('{}'); return; }
    if (req.url === '/agent/product-contexts?limit=100') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', generated_at: new Date().toISOString(), count: 1, items: [row()] }));
      return;
    }
    if (req.url === '/agent/product-contexts/prod_alpha') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', generated_at: new Date().toISOString(), ...row() }));
      return;
    }
    if (req.url === '/agent/product-contexts/prod_missing') { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(500); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const source = createMedusaProductContextSource({
      baseURL: `http://127.0.0.1:${port}`, readToken: token, allowLoopbackHTTP: true,
      authorizeActor: actor => actor?.workspaceId === 'local',
    });
    const list = await source.list({}, ADMIN);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].context.status, 'approved');
    const detail = await source.read('prod_alpha', ADMIN);
    assert.equal(detail.product.id, 'prod_alpha');
    assert.equal(await source.read('prod_missing', ADMIN), null);
    await assert.rejects(() => source.read('prod_alpha', { workspaceId: 'other' }), error => error.code === 'PRODUCT_LIBRARY_SOURCE_UNAUTHORIZED');
    const leaked = createMedusaProductContextSource({
      baseURL: `http://127.0.0.1:${port}`, readToken: token, allowLoopbackHTTP: true, authorizeActor: () => true,
    });
    // The synthetic server never echoes the token; the client additionally refuses any echoed copy.
    assert.ok(!JSON.stringify(await leaked.list({}, ADMIN)).includes(token));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the source refuses a token echo, malformed payloads and non-reviewed origins', async () => {
  const token = 'read-token-0123456789';
  const echo = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', count: 0, items: [], echo: token }));
  });
  await new Promise(resolve => echo.listen(0, '127.0.0.1', resolve));
  const { port } = echo.address();
  try {
    const source = createMedusaProductContextSource({
      baseURL: `http://127.0.0.1:${port}`, readToken: token, allowLoopbackHTTP: true, authorizeActor: () => true,
    });
    await assert.rejects(() => source.list({}, ADMIN), error => error.code === 'PRODUCT_LIBRARY_SOURCE_INVALID');
    assert.throws(() => createMedusaProductContextSource({
      baseURL: 'http://medusa.example.com', readToken: token, allowLoopbackHTTP: true, authorizeActor: () => true,
    }), /exact HTTPS Medusa origin/u);
  } finally {
    await new Promise(resolve => echo.close(resolve));
  }
});

test('the private token file is read strictly and is not accepted from an invalid file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'product-library-'));
  const good = path.join(directory, 'token');
  await writeFile(good, 'read-token-0123456789', { mode: 0o600 });
  assert.equal(await readPrivateToken(good), 'read-token-0123456789'.trimEnd());
  const short = path.join(directory, 'short');
  await writeFile(short, 'short', { mode: 0o600 });
  await assert.rejects(() => readPrivateToken(short), error => error.code === 'PRODUCT_LIBRARY_CONFIG');
  await assert.rejects(() => readPrivateToken('relative-token'), error => error.code === 'PRODUCT_LIBRARY_CONFIG');
});

test('the plugin refuses a bad config and missing seams', async () => {
  const harness = fakeContext();
  await assert.rejects(() => apply(harness.ctx, { source: { kind: 'nope' } }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  await assert.rejects(() => apply({ ...harness.ctx, storage: undefined }), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(() => apply({ ...harness.ctx, artifacts: undefined }), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(() => apply({ ...harness.ctx, http: undefined }), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(() => apply(harness.ctx, null), error => error.code === 'HARNESS_MANIFEST_INVALID');
});

test('the product id guard is exact', () => {
  assert.ok(PRODUCT_ID.test('prod_alpha'));
  assert.equal(PRODUCT_ID.test('prod_'), false);
  assert.equal(PRODUCT_ID.test('prod_a b'), false);
  assert.equal(PRODUCT_ID.test('alpha'), false);
});

test('the product page is self-contained and its script parses', async () => {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  const response = await harness.call('GET /products');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/u);
  const html = await response.text();
  assert.match(html, /产品库/u);
  assert.match(html, /id="banner"/u);
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  assert.doesNotThrow(() => new Function(script), 'the inline page script parses');
});