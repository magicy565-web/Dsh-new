import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

test('Original Workspace HTTP routes preview and create only a reviewed unpublished Medusa v2 draft', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-medusa-http-'));
  const writes = []; let remote = null;
  const medusaFetch = async (url, init) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:9000\/admin\/products/u);
    assert.equal(init.headers.Authorization, 'Basic test_secret');
    assert.equal(init.redirect, 'error');
    if (init.method === 'GET') return Response.json({ products: remote ? [remote] : [], count: remote ? 1 : 0 });
    const body = JSON.parse(init.body);
    writes.push(body);
    remote = { id: 'prod_original_medusa', ...body };
    return Response.json({ product: remote });
  };
  const capabilityEnvironment = { WORKSPACE_MEDUSA_BASE_URL: 'http://127.0.0.1:9000',
    WORKSPACE_MEDUSA_SECRET_API_KEY: 'test_secret', WORKSPACE_MEDUSA_WORKSPACE_ID: 'local',
    WORKSPACE_MEDUSA_SINGLE_TENANT_ACK: '1' };
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment, medusaFetch });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const api = async (endpoint, method = 'GET', body) => {
    const response = await fetch('http://127.0.0.1:' + address.port + endpoint, { method,
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const created = await api('/api/library/products', 'POST',
    { requestId: randomUUID(), name: 'Owner product', description: 'Approved public-facing draft text' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const product = created.body.product;
  const base = '/api/medusa/products/' + product.id;
  const status = await api('/api/medusa/catalog/status');
  assert.equal(status.status, 200); assert.equal(status.body.medusa.configured, true);
  assert.equal(status.body.medusa.connection, 'configured_unverified');

  const local = await api(base + '/preview');
  assert.equal(local.status, 200, JSON.stringify(local.body));
  const preview = local.body.preview;
  assert.equal(preview.productId, product.id);
  assert.equal(writes.length, 0, 'Read and preview must not send any Medusa writes.');
  const missing = await api(base + '/remote');
  assert.equal(missing.body.remote.status, 'missing');

  const invalid = await api(base + '/draft', 'POST',
    { requestId: randomUUID(), expectedRevision: preview.revision, sourceHash: 'f'.repeat(64), confirmed: true });
  assert.equal(invalid.status, 409);
  assert.equal(writes.length, 0);

  const command = { requestId: randomUUID(), expectedRevision: preview.revision,
    sourceHash: preview.sourceHash, confirmed: true };
  const committed = await api(base + '/draft', 'POST', command);
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.created, true); assert.equal(committed.body.remote.status, 'linked');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'draft');
  assert.equal(Object.hasOwn(writes[0], 'variants'), false);
  assert.equal(Object.hasOwn(writes[0], 'sales_channels'), false);
  assert.equal(Object.hasOwn(writes[0], 'prices'), false);

  const replay = await api(base + '/draft', 'POST', command);
  assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.created, false);
  assert.equal(writes.length, 1);
  const remoteRead = await api(base + '/remote'); assert.equal(remoteRead.body.remote.status, 'linked');
  const changed = await api('/api/library/products/' + product.id, 'PATCH', {
    requestId: randomUUID(), expectedRevision: product.revision, changes: { description: 'New owner copy' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await api(base + '/remote')).body.remote.status, 'stale');
  const stale = await api(base + '/draft', 'POST', command);
  assert.equal(stale.status, 409);
  assert.equal(writes.length, 1);
});
