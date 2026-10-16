// Synthetic materials only; real original Library/Store/enterprise signed HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { taskFixture, api } from './fixtures/pi-task-helpers.mjs';
import { createWorkspaceFactoryMaterialsClient } from '../plugins/workspace-procurement/src/workspace-factory-materials-client.mjs';
import { libraryReadHash } from '../server/library-model-read-contract.mjs';
import { extractFactoryDocument } from '../server/factory-document-extract.mjs';
import { publicPdfBytes, publicLongPdfBytes } from './fixtures/workspace-omp-public-pdf.mjs';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
const API = '/api/library/model-read/factory';
function client(f, { subject = 'member-a', recipient = RECIPIENT, calls = [] } = {}) {
  return createWorkspaceFactoryMaterialsClient({ recipient, request: async (route, options) => {
    calls.push(route); const r = await f.workspace(route, { subject, headers: options.headers });
    return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
  } });
}
test('factory tools project original exact materials/document bytes with source pins; unapproved prices stay absent', async t => {
  const f = await materialsFixture(t), c = client(f);
  const status = await c.status(undefined, MODEL); assert.equal(status.status, 'available');
  const receipt = await c.materials({ productId: f.product.id }, undefined, MODEL);
  assert.equal(receipt.status, 'available'); assert.equal(receipt.products[0].name, f.product.name);
  assert.equal(receipt.products[0].skuSpecifications[0].moq, null); assert.equal(receipt.products[0].capacityNote, '');
  assert.equal(receipt.sources[0].projectionSha256, libraryReadHash(receipt.products[0]));
  assert.ok(!JSON.stringify(receipt).includes('UNAPPROVED')); assert.equal(f.faux.state.callCount, 0);
  const doc = await c.document({ documentId: f.document.id, documentVersion: 1 }, undefined, MODEL);
  assert.equal(doc.status, 'available'); assert.match(doc.document.text, /original uploaded specification/);
  assert.deepEqual(doc.document.asset, f.asset); assert.equal(doc.document.internalReview, 'unreviewed'); assert.equal(doc.document.independentVerification, false);
  assert.equal(doc.document.validity, 'unknown'); await c.revalidateReceipt(receipt, MODEL); await c.revalidateReceipt(doc, MODEL);
  const seq = f.app.store.read().meta.sequence; await c.materials({}, undefined, MODEL); assert.equal(f.app.store.read().meta.sequence, seq);
});
test('factory disclosure refuses foreign members, Agent credentials, wrong models and tool-selected identities without record reads', async t => {
  const f = await materialsFixture(t), calls = [];
  assert.equal((await client(f, { subject: 'member-b' }).materials({}, undefined, MODEL)).status, 'blocked');
  assert.equal((await client(f, { calls }).materials({}, undefined, { ...MODEL, id: 'unreviewed' })).status, 'blocked'); assert.deepEqual(calls, []);
  assert.equal((await client(f, { calls }).materials({})).status, 'blocked'); assert.deepEqual(calls, []);
  const bearer = await api(f, API + '/status'); assert.ok([401, 403].includes(bearer.status));
  for (const suffix of ['/materials?subject=member-b', '/materials?fields=pricingNote', '/materials?limit=1&limit=2', '/materials?productId=', '/status?limit=1']) {
    const r = await f.workspace(API + suffix, { subject: 'member-a', headers: { 'X-Workspace-Library-Recipient': libraryReadHash(RECIPIENT) } }); assert.equal(r.status, 400);
  }
  const denied = await f.workspace(API + '/materials', { subject: 'member-a', body: { requestId: 'forbidden' } }); assert.equal(denied.status, 405);
  assert.equal(f.app.businessLibrary.getProduct(f.product.id).product.revision, 1);
});
test('original material client forwards AbortSignal and cancels a pending response body without disclosing data', async () => {
  const controller = new AbortController(); let requests = 0, closed = 0, reading;
  const started = new Promise(resolve => { reading = resolve; });
  const c = createWorkspaceFactoryMaterialsClient({ recipient: RECIPIENT, request: async (_route, options) => {
    requests++; assert.equal(options.signal, controller.signal);
    return new Response(new ReadableStream({ pull() { reading(); }, cancel() { closed++; } }), { headers: { 'content-type': 'application/json' } });
  } });
  const pending = c.materials({}, controller.signal, MODEL);
  await started; controller.abort();
  await assert.rejects(pending, e => e.name === 'AbortError'); assert.equal(closed, 1);
  await assert.rejects(c.status(controller.signal, MODEL), e => e.name === 'AbortError'); assert.equal(requests, 1);
});
test('factory default policy reads no private records and a missing second record never discloses the first projection', async t => {
  const disabled = await materialsFixture(t, { policy: null }); let reads = 0;
  for (const name of ['getProduct', 'getDocument']) disabled.app.businessLibrary[name] = () => { reads++; throw Error('Must not inspect an unconfigured Library'); };
  assert.equal((await client(disabled).materials({}, undefined, MODEL)).status, 'unconfigured'); assert.equal(reads, 0);
  const f = await materialsFixture(t);
  // Existing policy cannot mutate in place; rebuild with an explicit changed reviewed scope.
  await f.app.close();
  const policy = structuredClone(f.policy); policy.factoryMaterials.products.push({ id: randomUUID(), revision: 1 });
  const reopened = await taskFixture(t, { directory: f.directory, enterprise: true, libraryModelReadPolicy: policy });
  f.app = reopened.app;
  const value = await client(reopened).materials({ limit: 2 }, undefined, MODEL);
  assert.equal(value.status, 'blocked'); assert.deepEqual(value.sources, []); assert.equal(value.products, undefined);
  assert.equal((await client(reopened).materials({ limit: 1 }, undefined, MODEL)).products[0].id, f.product.id);
});
test('exact product/document changes and original Session revocation prevent receipt replay before disclosure', async t => {
  const f = await materialsFixture(t), c = client(f);
  const product = await c.materials({ productId: f.product.id }, undefined, MODEL);
  const document = await c.document({ documentId: f.document.id, documentVersion: 1 }, undefined, MODEL);
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'UNREVIEWED_NEW_NAME' } }, f.actor);
  assert.equal((await c.materials({ productId: f.product.id }, undefined, MODEL)).status, 'blocked');
  await assert.rejects(c.revalidateReceipt(product, MODEL), /cached|source|revision|changed/);
  const next = await f.app.artifacts.create({ requestId: randomUUID(), filename: 'version-two.txt', content: 'UNREVIEWED_NEW_FILE', metadata: { businessLibrary: { visibility: 'internal' } } });
  await f.app.businessLibrary.appendDocumentVersion(f.document.id, { requestId: randomUUID(), expectedRevision: 1, asset: { artifactId: next.artifact.id, version: 1, sha256: next.artifact.sha256 } }, f.actor);
  const blocked = await c.document({ documentId: f.document.id, documentVersion: 1 }, undefined, MODEL);
  assert.equal(blocked.status, 'blocked'); assert.ok(!JSON.stringify(blocked).includes('UNREVIEWED'));
  await assert.rejects(c.revalidateReceipt(document, MODEL), /cached|source|revision|changed/);
  const logout = await f.workspace('/api/session/logout', { subject: 'member-a', body: {} }); assert.equal(logout.status, 200);
  assert.equal((await c.status(undefined, MODEL)).status, 'blocked');
});
test('factory document extraction uses actual native PDF ReadTool and preserves scan/truncation uncertainty and owned cleanup', { timeout: 60000 }, async () => {
  const initial = (await fs.readdir('/tmp')).filter(x => x.startsWith('workspace-factory-document-')).sort();
  const plain = await extractFactoryDocument({ bytes: publicPdfBytes('Synthetic exact factory PDF text.'), mimeType: 'application/pdf' });
  assert.equal(plain.status, 'available'); assert.match(plain.text, /Synthetic exact factory PDF text/); assert.equal(plain.ocrStatus, 'native_hint_only');
  const scanned = await extractFactoryDocument({ bytes: publicPdfBytes(), mimeType: 'application/pdf' });
  assert.equal(scanned.status, 'partial'); assert.deepEqual(scanned.pagesNeedingOcr, [1]);
  const truncated = await extractFactoryDocument({ bytes: publicLongPdfBytes(), mimeType: 'application/pdf' });
  assert.equal(truncated.status, 'partial'); assert.equal(truncated.textTruncated, true); assert.equal(truncated.pagesNeedingOcr, null);
  assert.equal(truncated.ocrStatus, 'unknown_after_truncation');
  assert.equal((await extractFactoryDocument({ bytes: Buffer.from('%PDF-broken'), mimeType: 'application/pdf' })).status, 'blocked');
  assert.equal((await extractFactoryDocument({ bytes: Buffer.from('unsupported'), mimeType: 'application/octet-stream' })).status, 'blocked');
  assert.deepEqual((await fs.readdir('/tmp')).filter(x => x.startsWith('workspace-factory-document-')).sort(), initial);
});
test('an actual separate enterprise cannot inherit factory scope and unsafe original content is never returned', async t => {
  const f = await materialsFixture(t);
  const foreign = await taskFixture(t, { enterprise: true, workspaceId: 'separate-factory-enterprise', libraryModelReadPolicy: f.policy });
  const blocked = await client(foreign).materials({ productId: f.product.id }, undefined, MODEL);
  assert.equal(blocked.status, 'blocked'); assert.deepEqual(blocked.sources, []); assert.equal(blocked.products, undefined);
  const forbidden = 'api_key=sk-synthetic-never-real-factory-secret-123456789';
  await f.app.store.update(state => { state.businessLibrary.products.find(p => p.id === f.product.id).name = forbidden; });
  const unsafe = await client(f).materials({ productId: f.product.id }, undefined, MODEL);
  assert.equal(unsafe.status, 'blocked'); assert.ok(!JSON.stringify(unsafe).includes(forbidden));
});
test('factory receipt hashes and field allowlists refuse forged metadata or hidden additional contents', async t => {
  const f = await materialsFixture(t), value = await client(f).materials({ productId: f.product.id }, undefined, MODEL);
  for (const modify of [v => { v.sources[0].projectionSha256 = '0'.repeat(64); }, v => { v.secret = 'UNAPPROVED'; }, v => { v.products[0].skuSpecifications[0].pricingNote = 'UNAPPROVED'; }]) {
    const forged = structuredClone(value); modify(forged);
    const c = createWorkspaceFactoryMaterialsClient({ recipient: RECIPIENT, request: async () => new Response(JSON.stringify(forged), { headers: { 'content-type': 'application/json' } }) });
    await assert.rejects(c.materials({ productId: f.product.id }, undefined, MODEL), /receipt|projection/);
  }
});
