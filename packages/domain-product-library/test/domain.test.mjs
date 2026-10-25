import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
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


async function mounted(options = {}) {
  let state = structuredClone(options.initial ?? {});
  const storage = {
    read: () => structuredClone(state),
    update: async fn => {
      const draft = structuredClone(state);
      const result = fn(draft);
      state = draft;
      return structuredClone(result);
    },
  };
  const source = options.source ?? syntheticSource(options.rows);
  const artifacts = options.artifacts ?? fakeArtifacts();
  return { source, artifacts, service: createProductLibraryService({ storage, source, artifacts, workspaceId: 'local' }) };
}

// Test-only argument adapter: the preserved fixtures exercise domain methods,
// not HTTP routing, tool registration or a standalone application.
async function invoke(service, operation, { params = {}, body = {}, query = {}, actor = ADMIN } = {}) {
  const context = { actor };
  if (['status', 'list', 'search', 'read'].includes(operation)) {
    const args = operation === 'status' ? [] : [context, operation === 'read' ? params.productId : query];
    return { status: 200, body: await service[operation](...args) };
  }
  if (operation === 'downloadDocument') {
    const value = await service.downloadDocument(context, params.productId, params.documentId);
    return new Response(value.bytes, { headers: { 'content-type': value.mimeType } });
  }
  const args = [context, params.productId];
  if (['savePage', 'comment', 'approve'].includes(operation)) args.push(params.pageId);
  return service[operation](...args, body);
}

test('an unconfigured source is explicit and still lists rooms already stored', async () => {
  const harness = await mounted({ source: { configured: false, kind: 'unconfigured', list: async () => ({ items: [] }), read: async () => null } });
  const status = await invoke(harness.service, 'status');
  assert.equal(status.body.configured, false);
  assert.equal(status.body.source, 'unconfigured');
  const list = await invoke(harness.service, 'list');
  assert.equal(list.body.source.live, false);
  assert.equal(list.body.source.warning, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED');
  await assert.rejects(
    () => invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } }),
    error => error.code === 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED' && error.status === 503,
  );
});

test('open pins the approved product context and read exposes the exact pin', async () => {
  const harness = await mounted();
  const opened = await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.created, true);
  const read = await invoke(harness.service, 'read', { params: { productId: 'prod_alpha' } });
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
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const created = await invoke(harness.service, 'createPage', {
    params: { productId: 'prod_alpha' },
    body: { requestId: randomUUID(), title: 'US launch brief', body: 'Target resorts.', citations: [
      { source: 'context', field: 'buyer_profile' },
      { source: 'product', field: 'title' },
      { source: 'evidence', field: 'ev_1' },
    ] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.version, 1);
  const read = await invoke(harness.service, 'read', { params: { productId: 'prod_alpha' } });
  const page = read.body.pages[0];
  assert.deepEqual(page.citations.map(item => item.status), ['current', 'current', 'current']);
  assert.equal(page.citations[0].preview, 'Resort wear brands in the US and EU.');

  await assert.rejects(
    () => invoke(harness.service, 'createPage', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), title: 'Bad', body: '', citations: [{ source: 'context', field: 'not_a_field' }] },
    }),
    error => error.code === 'PRODUCT_LIBRARY_CITATION_UNKNOWN' && error.status === 400,
  );
});

test('savePage enforces the exact revision, replays a requestId and rejects a changed replay', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await invoke(harness.service, 'createPage', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Draft', body: 'one' },
  })).body;
  const requestId = randomUUID();
  const saved = await invoke(harness.service, 'savePage', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId, expectedRevision: 1, title: 'Draft', body: 'two' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 2);
  const replay = await invoke(harness.service, 'savePage', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId, expectedRevision: 1, title: 'Draft', body: 'two' },
  });
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.version, 2);
  await assert.rejects(
    () => invoke(harness.service, 'savePage', {
      params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId, expectedRevision: 1, title: 'Draft', body: 'three' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_IDEMPOTENCY_CONFLICT' && error.status === 409,
  );
  await assert.rejects(
    () => invoke(harness.service, 'savePage', {
      params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 1, title: 'Draft', body: 'three' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_REVISION_CONFLICT' && error.status === 409,
  );
});

test('sync re-pins the context and makes old citations stale until they are saved again', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await invoke(harness.service, 'createPage', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Brief', body: 'pinned', citations: [{ source: 'context', field: 'buyer_profile' }] },
  })).body;
  const next = row();
  next.context.buyer_profile = 'Outdoor brands in Canada.';
  next.context.review_version = 4;
  next.context.source_hash = 'c'.repeat(64);
  harness.source.replace([next]);
  const synced = await invoke(harness.service, 'sync', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  assert.equal(synced.body.changed, true);
  assert.ok(synced.body.changedFields.includes('context.buyer_profile'));
  assert.deepEqual(synced.body.stalePages, [page.pageId]);
  const read = await invoke(harness.service, 'read', { params: { productId: 'prod_alpha' } });
  assert.equal(read.body.pages[0].citations[0].status, 'stale');
  const refreshed = await invoke(harness.service, 'savePage', {
    params: { productId: 'prod_alpha', pageId: page.pageId },
    body: { requestId: randomUUID(), expectedRevision: 1, title: 'Brief', body: 'pinned', citations: [{ source: 'context', field: 'buyer_profile' }] },
  });
  assert.equal(refreshed.status, 200);
  const after = await invoke(harness.service, 'read', { params: { productId: 'prod_alpha' } });
  assert.equal(after.body.pages[0].citations[0].status, 'current');
});

test('approval is administrator-only and editing an approved page withdraws it', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await invoke(harness.service, 'createPage', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Brief', body: 'v1' },
  })).body;
  await assert.rejects(
    () => invoke(harness.service, 'approve', {
      params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 1, approved: true }, actor: VIEWER,
    }),
    error => error.code === 'PRODUCT_LIBRARY_FORBIDDEN' && error.status === 403,
  );
  const approved = await invoke(harness.service, 'approve', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 1, approved: true },
  });
  assert.equal(approved.body.status, 'approved');
  const saved = await invoke(harness.service, 'savePage', {
    params: { productId: 'prod_alpha', pageId: page.pageId }, body: { requestId: randomUUID(), expectedRevision: 2, title: 'Brief', body: 'v2' },
  });
  assert.equal(saved.body.status, 'draft');
  assert.equal(saved.body.approvalWithdrawn, true);
});

test('a viewer may comment but may not create, save or open', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const page = (await invoke(harness.service, 'createPage', {
    params: { productId: 'prod_alpha' }, body: { requestId: randomUUID(), title: 'Brief', body: 'v1' },
  })).body;
  const comment = await invoke(harness.service, 'comment', {
    params: { productId: 'prod_alpha', pageId: page.pageId },
    body: { requestId: randomUUID(), expectedRevision: 1, version: 1, body: 'Please add the EU market.' }, actor: VIEWER,
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.comments, 1);
  await assert.rejects(
    () => invoke(harness.service, 'savePage', {
      params: { productId: 'prod_alpha', pageId: page.pageId },
      body: { requestId: randomUUID(), expectedRevision: 2, title: 'Brief', body: 'v2' }, actor: VIEWER,
    }),
    error => error.code === 'PRODUCT_LIBRARY_FORBIDDEN',
  );
  await assert.rejects(
    () => invoke(harness.service, 'open', { params: { productId: 'prod_beta' }, body: { requestId: randomUUID() }, actor: VIEWER }),
    error => error.code === 'PRODUCT_LIBRARY_FORBIDDEN',
  );
});

test('search returns bounded snippets across pages and documents', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  await invoke(harness.service, 'createPage', {
    params: { productId: 'prod_alpha' },
    body: { requestId: randomUUID(), title: 'Resort launch', body: 'Target resort shirts and summer sets in the US.' },
  });
  await invoke(harness.service, 'attachDocument', {
    params: { productId: 'prod_alpha' },
    body: { requestId: randomUUID(), filename: 'certificate.pdf', base64: Buffer.from('pdf').toString('base64'), label: 'OEKO certificate', kind: 'certificate' },
  });
  const pageHits = await invoke(harness.service, 'search', { query: { q: 'resort' } });
  assert.equal(pageHits.status, 200);
  assert.ok(pageHits.body.items.some(item => item.kind === 'page' && item.title === 'Resort launch'));
  assert.ok(pageHits.body.items.every(item => item.snippet.toLowerCase().includes('resort')));
  const docHits = await invoke(harness.service, 'search', { query: { q: 'oeko' } });
  assert.ok(docHits.body.items.some(item => item.kind === 'document' && item.title === 'OEKO certificate'));
  const none = await invoke(harness.service, 'search', { query: { q: 'nothing-matches-this' } });
  assert.equal(none.body.total, 0);
  await assert.rejects(
    () => invoke(harness.service, 'search', { query: { q: '   ' } }),
    error => error.code === 'PRODUCT_LIBRARY_INPUT',
  );
});

test('documents are uploaded through the artifacts seam and downloaded only by hash match', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const bytes = Buffer.from('%PDF-1.4 synthetic spec sheet\n', 'utf8');
  const base64 = bytes.toString('base64');
  const requestId = randomUUID();
  const attached = await invoke(harness.service, 'attachDocument', {
    params: { productId: 'prod_alpha' },
    body: { requestId, filename: 'spec.pdf', base64, label: 'Test certificate', kind: 'certificate', evidenceId: 'ev_1' },
  });
  assert.equal(attached.status, 201);
  assert.equal(attached.body.size, bytes.length);
  assert.equal(attached.body.sha256, createHash('sha256').update(bytes).digest('hex'));
  const read = await invoke(harness.service, 'read', { params: { productId: 'prod_alpha' } });
  assert.equal(read.body.documents.length, 1);
  assert.equal(read.body.documents[0].label, 'Test certificate');
  assert.equal(read.body.documents[0].evidenceId, 'ev_1');
  assert.match(read.body.documents[0].downloadPath, /\/documents\//u);
  assert.equal(read.body.counts.documents, 1);

  const download = await invoke(harness.service, 'downloadDocument', {
    params: { productId: 'prod_alpha', documentId: attached.body.documentId },
  });
  assert.ok(download instanceof Response);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

  const replay = await invoke(harness.service, 'attachDocument', {
    params: { productId: 'prod_alpha' },
    body: { requestId, filename: 'spec.pdf', base64, label: 'Test certificate', kind: 'certificate', evidenceId: 'ev_1' },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.documentId, attached.body.documentId);
});

test('documents reject unknown evidence, non-canonical base64 and oversized files', async () => {
  const harness = await mounted();
  await invoke(harness.service, 'open', { params: { productId: 'prod_alpha' }, body: { requestId: randomUUID() } });
  const small = Buffer.from('hello').toString('base64');
  await assert.rejects(
    () => invoke(harness.service, 'attachDocument', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), filename: 'note.txt', base64: small, evidenceId: 'ev_missing' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_CITATION_UNKNOWN' && error.status === 400,
  );
  await assert.rejects(
    () => invoke(harness.service, 'attachDocument', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), filename: 'note.txt', base64: 'not-base64!' },
    }),
    error => error.code === 'PRODUCT_LIBRARY_INPUT',
  );
  const huge = Buffer.alloc(512 * 1024 + 1, 7).toString('base64');
  await assert.rejects(
    () => invoke(harness.service, 'attachDocument', {
      params: { productId: 'prod_alpha' },
      body: { requestId: randomUUID(), filename: 'big.pdf', base64: huge },
    }),
    error => error.code === 'PRODUCT_LIBRARY_DOCUMENT_TOO_LARGE' && error.status === 413,
  );
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

test('the product id guard is exact', () => {
  assert.ok(PRODUCT_ID.test('prod_alpha'));
  assert.equal(PRODUCT_ID.test('prod_'), false);
  assert.equal(PRODUCT_ID.test('prod_a b'), false);
  assert.equal(PRODUCT_ID.test('alpha'), false);
});
