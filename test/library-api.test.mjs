import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

const req = () => randomUUID();
function signedHttp(url, {method,headers,body}) { return new Promise((resolve,reject) => { const request = http.request(url,{method,headers}, response => resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}))); request.on('error',reject); request.end(body); }); }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'business-library-http-'));
  let app = await createApp({ dataDirectory: directory, ...options }); let address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, method = 'GET', body) { const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const data = await response.json(); return { status: response.status, data }; }
  return { directory, get app() { return app; }, api, async restart() { await app.close(); app = await createApp({ dataDirectory: directory, ...options }); address = await app.listen(0); }, async upload(content = 'Real inert file', filename = 'certificate.txt', metadata = { businessLibrary: { visibility: 'internal' } }) { const result = await api('/api/artifacts', 'POST', { requestId: req(), filename, content, metadata }); assert.equal(result.status, 201); const record = result.data.artifact; return { artifactId: record.id, version: record.currentVersion, sha256: record.sha256 }; } };
}
const create = (f, name = 'Saved product', more = {}) => f.api('/api/library/products', 'POST', { requestId: req(), name, ...more });
const change = (f, product, changes) => f.api(`/api/library/products/${product.id}`, 'PATCH', { requestId: req(), expectedRevision: product.revision, changes });
const validSku = () => ({ id: req(), code: 'SKU-A', specs: [{ key: 'Size', value: 'M' }], unit: 'piece', moq: 10, pricingMode: 'tiered', pricingNote: '', priceTiers: [{ minQuantity: 10, unitPrice: '2.50', currency: 'USD' }], leadTimeDays: 7 });

test('library HTTP products: durable same-transaction receipts, replay, revision conflict and restart', async t => {
  const f = await fixture(t), body = { requestId: req(), name: 'Durable product', description: 'Real storage fixture' };
  const created = await f.api('/api/library/products', 'POST', body); assert.equal(created.status, 201); const p = created.data.product;
  const repeated = await f.api('/api/library/products', 'POST', body); assert.equal(repeated.status, 201); assert.equal(repeated.data.product.id, p.id); assert.equal(repeated.data.operation.duplicate, true);
  const conflict = await f.api('/api/library/products', 'POST', { ...body, name: 'Other' }); assert.equal(conflict.status, 409); assert.equal(conflict.data.error.code, 'IDEMPOTENCY_CONFLICT');
  const edit = { requestId: req(), expectedRevision: p.revision, changes: { description: 'Edited and persisted' } };
  const saved = await f.api(`/api/library/products/${p.id}`, 'PATCH', edit); assert.equal(saved.status, 200); assert.equal(saved.data.product.revision, 2);
  const stale = await change(f, p, { name: 'Unsaved stale draft' }); assert.equal(stale.status, 409); assert.equal(stale.data.error.code, 'REVISION_CONFLICT');
  await f.restart(); const reopened = await f.api(`/api/library/products/${p.id}`); assert.equal(reopened.data.product.description, 'Edited and persisted');
  const retriedAfterRestart = await f.api(`/api/library/products/${p.id}`, 'PATCH', edit); assert.equal(retriedAfterRestart.data.operation.duplicate, true); assert.equal(retriedAfterRestart.data.operation.committedRevision, 2);
  const receipt = await f.api(`/api/library/operations/${edit.requestId}`); assert.equal(receipt.data.operation.entityId, p.id); assert.equal(receipt.data.operation.committedRevision, 2);
  const disk = JSON.parse(await fs.readFile(path.join(f.directory, 'workspace.json'))); assert.equal(disk.version, 3); assert.equal(disk.businessLibrary.products.length, 1); assert.equal(disk.businessLibrary.operations.length, 2);
});

test('library HTTP concurrent duplicate requests create one entity and keep both responses correlated', async t => {
  const f = await fixture(t), body = { requestId: req(), name: 'Double click' };
  const results = await Promise.all([f.api('/api/library/products', 'POST', body), f.api('/api/library/products', 'POST', body)]);
  assert.ok(results.every(value => value.status === 201)); assert.equal(results[0].data.product.id, results[1].data.product.id); assert.equal((await f.api('/api/library/products')).data.items.length, 1); assert.equal(f.app.store.read().businessLibrary.operations.length, 1);
});

test('library HTTP query paging is bounded, typed and bound to query and sequence', async t => {
  const f = await fixture(t); await create(f, 'Find A'); await create(f, 'Find B'); await create(f, 'Other');
  const first = await f.api('/api/library/products?q=Find&limit=1'); assert.equal(first.data.items.length, 1); assert.ok(first.data.nextCursor);
  const second = await f.api(`/api/library/products?q=Find&limit=1&cursor=${first.data.nextCursor}`); assert.equal(second.status, 200); assert.equal(second.data.items.length, 1); assert.notEqual(first.data.items[0].id, second.data.items[0].id);
  assert.equal((await f.api(`/api/library/products?q=Other&limit=1&cursor=${first.data.nextCursor}`)).status, 400);
  await create(f, 'Another'); assert.equal((await f.api(`/api/library/products?q=Find&limit=1&cursor=${first.data.nextCursor}`)).status, 409);
  for (const query of ['limit=0', 'limit=101', 'limit=20.1', 'status=published', 'q=x&q=y', 'unknown=x', `q=${'x'.repeat(201)}`, `cursor=${'x'.repeat(1025)}`]) assert.equal((await f.api(`/api/library/products?${query}`)).status, 400, query);
});

test('library HTTP documents: exact real bytes, history, immutable association, staged retention and delete protection', async t => {
  const f = await fixture(t), asset = await f.upload();
  const created = await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Company certificate', slotKey: 'certificate', asset, certificate: { expiryMode: 'dated', validUntil: '2030-12-31' } }); assert.equal(created.status, 201); const doc = created.data.document;
  const content = await f.api(`/api/artifacts/${asset.artifactId}/content?version=1`); assert.equal(content.data.content, 'Real inert file');
  const download = await fetch(`http://127.0.0.1:${f.app.server.address().port}/api/artifacts/${asset.artifactId}/download?version=1`); assert.equal(await download.text(), 'Real inert file');
  assert.equal((await f.api(`/api/artifacts/${asset.artifactId}`, 'DELETE')).data.error.code, 'REFERENCED_ASSET');
  const second = await f.upload('Version two'); const appended = await f.api(`/api/library/documents/${doc.id}/versions`, 'POST', { requestId: req(), expectedRevision: doc.revision, asset: second, certificate: { expiryMode: 'dated', validUntil: '2031-12-31' } }); assert.equal(appended.status, 201); assert.equal(appended.data.document.currentVersion, 2); assert.equal(appended.data.document.versions[0].asset.sha256, asset.sha256);
  const p = (await create(f)).data.product; const linked = await change(f, p, { documents: [{ documentId: doc.id, documentVersion: 1, purpose: 'Evidence' }] }); assert.equal(linked.status, 200); assert.equal(linked.data.product.documents[0].documentVersion, 1);
  const staged = await f.upload('Failed link stays'); const fail = await f.api(`/api/library/documents/${doc.id}/versions`, 'POST', { requestId: req(), expectedRevision: 1, asset: staged }); assert.equal(fail.status, 409); assert.equal((await f.api(`/api/artifacts/${staged.artifactId}/content`)).data.content, 'Failed link stays');
  const visibility = await f.api(`/api/artifacts/${asset.artifactId}`, 'PATCH', { expectedRevision: 1, metadata: {} }); assert.equal(visibility.status, 400);
  await f.restart(); assert.equal((await f.api(`/api/library/documents/${doc.id}`)).data.document.versions.length, 2); assert.equal((await f.api(`/api/artifacts/${asset.artifactId}`, 'DELETE')).status, 409);
});

test('library HTTP link/delete race cannot commit a dangling reference; preexisting artifacts are claimed internal', async t => {
  const f = await fixture(t), asset = await f.upload('Unclaimed file', 'generic.txt', {}), original = f.app.artifacts.download.bind(f.app.artifacts); let release; const barrier = new Promise(resolve => { release = resolve; }); let reached; const entered = new Promise(resolve => { reached = resolve; });
  f.app.artifacts.download = async (...args) => { const value = await original(...args); reached(); await barrier; return value; };
  const linking = f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Race', asset }); await entered; assert.equal((await f.api(`/api/artifacts/${asset.artifactId}`, 'DELETE')).status, 200); release(); assert.equal((await linking).data.error.code, 'LINK_CONFLICT');
  f.app.artifacts.download = original;
  const retained = await f.upload('Claimed file', 'claim.txt', {}); const linked = await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Claim', asset: retained }); assert.equal(linked.status, 201); assert.equal(f.app.artifacts.get(retained.artifactId).artifact.metadata.businessLibrary.visibility, 'internal'); assert.equal((await f.api(`/api/artifacts/${retained.artifactId}`, 'DELETE')).status, 409);
});

test('library HTTP asset links require saved hash and real bytes, never external URLs or file paths', async t => {
  const f = await fixture(t), asset = await f.upload();
  for (const ref of [{ ...asset, sha256: 'a'.repeat(64) }, { ...asset, url: 'https://example.invalid/file' }, { artifactId: '/etc/passwd', version: 1, sha256: asset.sha256 }]) { const result = await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Bad link', asset: ref }); assert.ok([400, 409].includes(result.status)); }
  await fs.writeFile(path.join(f.directory, 'artifacts', `${asset.artifactId}.v1.${asset.sha256}.blob`), 'Corrupted'); const result = await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Bad bytes', asset }); assert.equal(result.status, 409); assert.equal(result.data.error.code, 'ARTIFACT_INTEGRITY'); assert.equal(f.app.store.read().businessLibrary.documents.length, 0);
});

test('library HTTP SKU, decimal pricing, image and fields validation retain valid drafts and reject unsafe input', async t => {
  const f = await fixture(t), p = (await create(f)).data.product, good = validSku();
  const saved = await change(f, p, { skus: [good], supply: { paymentTerms: 'Internal 30%', packaging: 'Box' } }); assert.equal(saved.status, 200); assert.equal(saved.data.product.skus[0].priceTiers[0].unitPrice, '2.50');
  const other = await create(f, 'Other', { skus: [{ ...good, id: req() }] }); assert.equal(other.status, 409);
  for (const bad of [{ ...good, priceTiers: [{ minQuantity: 10, unitPrice: 2.5, currency: 'USD' }] }, { ...good, pricingMode: 'on_request' }, { ...good, priceTiers: [{ minQuantity: 10, unitPrice: '-1', currency: 'USD' }] }, { ...good, priceTiers: [{ minQuantity: 10, unitPrice: '2', currency: 'usd' }] }, { ...good, moq: -1 }]) assert.equal((await change(f, saved.data.product, { skus: [bad] })).status, 400);
  assert.equal((await change(f, saved.data.product, { images: 'not array' })).status, 400);
  assert.equal((await create(f, 'Unsafe', { images: 'not array' })).status, 400);
  assert.equal((await change(f, saved.data.product, { published: true })).status, 400);
  assert.equal((await create(f, '')).status, 400);
  const textAsset = await f.upload(); assert.equal((await change(f, saved.data.product, { images: [{ id: req(), asset: textAsset, alt: '', order: 0, isPrimary: true }] })).status, 400);
});

test('library HTTP readiness distinguishes missing, unknown, expired, human verification and internal review', async t => {
  const f = await fixture(t, { accessClock: () => Date.parse('2026-10-09T12:00:00Z') }), p = (await create(f)).data.product;
  const initial = (await f.api(`/api/library/products/${p.id}/readiness`)).data.readiness; assert.equal(initial.overall, 'incomplete'); assert.ok(initial.checks.some(entry => entry.status === 'missing')); assert.equal(initial.policyVersion, 'library-v1');
  const asset = await f.upload(), doc = (await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Unknown certificate', slotKey: 'certificate', asset })).data.document;
  let product = (await change(f, p, { documents: [{ documentId: doc.id, documentVersion: 1, purpose: 'Certificate' }] })).data.product;
  const unknown = (await f.api(`/api/library/products/${p.id}/readiness`)).data.readiness; assert.ok(unknown.checks.some(entry => entry.key.endsWith('-validity') && entry.status === 'unverified')); assert.equal((await f.api(`/api/library/documents/${doc.id}/versions/1/reviews`, 'POST', { requestId: req(), expectedRevision: doc.revision, decision: 'verified', reviewedBy: 'forged' })).status, 400);
  assert.equal((await f.api(`/api/library/documents/${doc.id}/versions/1/reviews`, 'POST', { requestId: req(), expectedRevision: doc.revision, decision: 'verified' })).status, 400);
  const expiredAsset = await f.upload('Expired certificate'); const expiredDoc = (await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Expired certificate', slotKey: 'certificate', asset: expiredAsset, certificate: { expiryMode: 'dated', validUntil: '2026-10-08' } })).data.document;
  product = (await change(f, product, { documents: [{ documentId: expiredDoc.id, documentVersion: 1, purpose: 'Certificate' }] })).data.product; assert.ok((await f.api(`/api/library/products/${p.id}/readiness`)).data.readiness.checks.some(entry => entry.status === 'expired'));
  const currentAsset = await f.upload('Current certificate'); const currentDoc = (await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Current certificate', slotKey: 'certificate', asset: currentAsset, certificate: { expiryMode: 'dated', validUntil: '2026-10-09' } })).data.document;
  const reviewed = await f.api(`/api/library/documents/${currentDoc.id}/versions/1/reviews`, 'POST', { requestId: req(), expectedRevision: currentDoc.revision, decision: 'verified', note: 'Checked exact saved file' }); assert.equal(reviewed.status, 201); assert.equal(reviewed.data.document.reviews[0].reviewedBy, 'local-operator'); assert.equal(reviewed.data.document.reviews[0].reviewedAt, '2026-10-09T12:00:00.000Z');
  product = (await change(f, product, { documents: [{ documentId: currentDoc.id, documentVersion: 1, purpose: 'Certificate' }] })).data.product; const readiness = (await f.api(`/api/library/products/${p.id}/readiness`)).data.readiness; assert.ok(readiness.checks.some(entry => entry.key.endsWith('-review') && entry.status === 'verified')); assert.notEqual(readiness.dependencyFingerprint, unknown.dependencyFingerprint); assert.equal((await f.api(`/api/library/products/${p.id}/publish`, 'POST', {})).status, 404);
});

test('library HTTP a complete draft is only ready for internal review; image refs and administrator evidence persist', async t => {
  const f = await fixture(t, { accessClock: () => Date.parse('2026-10-09T12:00:00Z') });
  const company = await f.api('/api/library/company', 'PATCH', { requestId: req(), expectedRevision: 1, changes: { legalName: 'Synthetic enterprise', displayName: 'Private brand' } }); assert.equal(company.status, 200);
  const uploaded = await f.api('/api/artifacts', 'POST', { requestId: req(), filename: 'product.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==', metadata: { businessLibrary: { visibility: 'internal' } } }); assert.equal(uploaded.status, 201); const image = uploaded.data.artifact;
  const asset = await f.upload('Reviewed private specification'); const doc = (await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Specification', slotKey: 'specification', asset })).data.document;
  assert.equal((await f.api(`/api/library/documents/${doc.id}/versions/1/reviews`, 'POST', { requestId: req(), expectedRevision: doc.revision, decision: 'verified', note: 'Exact bytes checked' })).status, 201);
  const created = await create(f, 'Complete internal draft', { description: 'Saved description', category: 'Apparel', skus: [validSku()], supply: { packaging: 'Box', samplePolicy: 'Samples on request', paymentTerms: 'Private terms', shippingTerms: 'EXW', capacityNote: '' }, documents: [{ documentId: doc.id, documentVersion: 1, purpose: 'Specification' }], images: [{ id: req(), asset: { artifactId: image.id, version: 1, sha256: image.sha256 }, alt: 'Product photo', order: 0, isPrimary: true }] }); assert.equal(created.status, 201);
  const ready = (await f.api(`/api/library/products/${created.data.product.id}/readiness`)).data.readiness; assert.equal(ready.overall, 'ready_for_review'); assert.ok(ready.checks.every(entry => entry.status === 'verified')); assert.equal((await f.api(`/api/artifacts/${image.id}`, 'DELETE')).status, 409);
  await f.restart(); assert.equal((await f.api(`/api/library/products/${created.data.product.id}/readiness`)).data.readiness.overall, 'ready_for_review');
});

test('library HTTP durable receipt capacity fails closed and never forgets past requestIds', async t => {
  const f = await fixture(t), body = { requestId: req(), name: 'Original' }, created = await f.api('/api/library/products', 'POST', body); await f.app.store.update(state => { const first = state.businessLibrary.operations[0]; for (let i = 1; i < 10000; i++) { const requestId = req(); state.businessLibrary.operations.push({ ...first, id: requestId, requestId }); } });
  assert.equal((await create(f, 'Beyond capacity')).data.error.code, 'STORAGE_LIMIT'); const duplicate = await f.api('/api/library/products', 'POST', body); assert.equal(duplicate.data.product.id, created.data.product.id); assert.equal(duplicate.data.operation.duplicate, true);
});

// Disposable offline signed ingress and ephemeral sessions; no real identity/secret/runtime data.
test('library enterprise HTTP: viewer read-only, operator CRUD, admin exact-version reviews, CSRF and actor binding', async t => {
  const pair = generateKeyPairSync('ed25519'), origin = 'https://library.example'; const config = { mode: 'enterprise', publicOrigin: origin, workspaceId: 'fixture', issuer: 'fixture-ingress', keyId: 'fixture-key', publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }), members: [{ subject: 'admin', role: 'admin' }, { subject: 'operator', role: 'operator' }, { subject: 'viewer', role: 'viewer' }] };
  const f = await fixture(t, { access: config });
  async function signed(route, method = 'GET', body, subject = 'admin', session, more = {}) { const bytes = body === undefined ? '' : JSON.stringify(body); const response = await signedHttp(`http://127.0.0.1:${f.app.server.address().port}${route}`, { method, headers: { Host: 'library.example', ...(!['GET', 'HEAD'].includes(method) ? { Origin: origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...config, subject, method, target: route, body: bytes }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...more }, ...(body === undefined ? {} : { body: bytes }) }); return { status: response.status, response, data: await response.json() }; }
  async function login(subject) { const result = await signed('/api/session/login', 'POST', {}, subject, undefined, { 'X-Workspace-Login': '1' }); assert.equal(result.status, 200, JSON.stringify(result.data)); return { cookie: result.response.headers.get('set-cookie').split(';')[0], csrfToken: result.data.csrfToken }; }
  const admin = await login('admin'), operator = await login('operator'), viewer = await login('viewer');
  const body = { requestId: req(), name: 'Enterprise private product' }; const created = await signed('/api/library/products', 'POST', body, 'operator', operator); assert.equal(created.status, 201); const p = created.data.product;
  assert.equal((await signed(`/api/library/products/${p.id}`, 'GET', undefined, 'viewer', viewer)).status, 200);
  const conversation = (await signed('/api/conversations', 'POST', { title: 'Signed references' }, 'operator', operator)).data.conversation; const refsRoute = `/api/conversations/${conversation.id}/library-references`; const refBody = { requestId: req(), expectedRevision: 0, references: { products: [{ productId: p.id, productRevision: 1 }], documents: [] } };
  assert.equal((await signed(refsRoute, 'PATCH', refBody, 'viewer', viewer)).status, 403); const bound = await signed(refsRoute, 'PATCH', refBody, 'operator', operator); assert.equal(bound.status, 200); assert.equal((await signed(refsRoute, 'GET', undefined, 'viewer', viewer)).data.libraryReferences.revision, 1);
  assert.equal((await signed(refsRoute, 'PATCH', refBody, 'admin', admin)).data.error.code, 'IDEMPOTENCY_CONFLICT');
  for (const [route, method, value] of [['/api/library/products', 'POST', { requestId: req(), name: 'Denied' }], [`/api/library/products/${p.id}`, 'PATCH', { requestId: req(), expectedRevision: 1, changes: { name: 'Denied' } }], ['/api/library/company', 'PATCH', { requestId: req(), expectedRevision: 1, changes: { legalName: 'Denied' } }], ['/api/artifacts', 'POST', { filename: 'denied.txt', content: 'Denied' }]]) assert.equal((await signed(route, method, value, 'viewer', viewer)).status, 403);
  assert.equal((await signed('/api/library/products', 'POST', { requestId: req(), name: 'CSRF' }, 'operator', { ...operator, csrfToken: 'wrong' })).status, 403);
  assert.equal((await signed('/api/library/products', 'POST', body, 'admin', admin)).data.error.code, 'IDEMPOTENCY_CONFLICT');
  const uploaded = await signed('/api/artifacts', 'POST', { requestId: req(), filename: 'enterprise.txt', content: 'Private library file', metadata: { businessLibrary: { visibility: 'internal' } } }, 'operator', operator); assert.equal(uploaded.status, 201); const a = uploaded.data.artifact;
  const doc = (await signed('/api/library/documents', 'POST', { requestId: req(), title: 'Company file', slotKey: 'company', asset: { artifactId: a.id, version: 1, sha256: a.sha256 } }, 'operator', operator)).data.document;
  const reviewBody = { requestId: req(), expectedRevision: doc.revision, decision: 'verified' }; assert.equal((await signed(`/api/library/documents/${doc.id}/versions/1/reviews`, 'POST', reviewBody, 'operator', operator)).status, 403); const reviewed = await signed(`/api/library/documents/${doc.id}/versions/1/reviews`, 'POST', reviewBody, 'admin', admin); assert.equal(reviewed.status, 201); assert.equal(reviewed.data.document.reviews[0].reviewedBy, 'admin');
  const bootstrap = await signed('/api/bootstrap', 'GET', undefined, 'operator', operator); assert.equal(bootstrap.data.businessLibrary, undefined); assert.ok(!bootstrap.data.artifacts.some(entry => entry.id === a.id)); assert.deepEqual((await signed('/api/search?q=enterprise.txt', 'GET', undefined, 'viewer', viewer)).data.results, []);
});

const publicSource = (fieldPath = 'name') => ({ kind: 'public_reference', referenceOnly: true, sourceUrl: 'https://www.patagonia.com/product/fixture-reference/', fetchedAt: '2026-10-09T12:00:00.000Z', batchId: req(), fieldSources: [{ fieldPath, sourceUrl: 'https://www.patagonia.com/product/fixture-reference/', locator: 'Synthetic source fixture; no external fetch', capturedValue: '  Captured original value\n' }] });

test('library public provenance remains locked after local edits and cannot masquerade as enterprise supply or qualification', async t => {
  const f = await fixture(t), provenance = publicSource();
  const created = await create(f, 'Public reference sample', { source: provenance }); assert.equal(created.status, 201); const p = created.data.product; assert.equal(p.source.referenceOnly, true); assert.equal(p.source.fieldSources[0].capturedValue, '  Captured original value\n');
  const edited = await change(f, p, { name: 'Locally annotated reference sample', description: 'My own note' }); assert.equal(edited.status, 200); assert.deepEqual(edited.data.product.source, provenance);
  const current = edited.data.product;
  for (const source of [null, { ...provenance, kind: 'user_provided', referenceOnly: false }, { ...provenance, sourceUrl: 'https://other.example.com/' }, { ...provenance, batchId: req() }, { ...provenance, fieldSources: [{ ...provenance.fieldSources[0], capturedValue: 'Changed capture' }] }]) assert.equal((await change(f, current, { source })).status, 400);
  for (const changes of [{ skus: [validSku()] }, { supply: { packaging: 'Our package' } }, { skus: [{ ...validSku(), moq: null, leadTimeDays: null, pricingMode: 'on_request', priceTiers: [], pricingNote: 'Quote us' }] }]) assert.equal((await change(f, current, changes)).status, 400);
  const externalAsset = await f.upload('Synthetic public specification'); const docSource = publicSource('title'); const publicDoc = await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Public specification, not enterprise qualification', slotKey: 'specification', asset: externalAsset, source: docSource }); assert.equal(publicDoc.status, 201); const doc = publicDoc.data.document;
  assert.equal(f.app.artifacts.get(externalAsset.artifactId).artifact.metadata.businessLibrary.visibility, 'internal');
  assert.equal((await f.api(`/api/library/documents/${doc.id}`, 'PATCH', { requestId: req(), expectedRevision: 1, changes: { slotKey: 'certificate' } })).status, 400);
  assert.equal((await f.api(`/api/library/documents/${doc.id}`, 'PATCH', { requestId: req(), expectedRevision: 1, changes: { source: null } })).status, 400);
  const newAsset = await f.upload('New arbitrary file'); assert.equal((await f.api(`/api/library/documents/${doc.id}/versions`, 'POST', { requestId: req(), expectedRevision: 1, asset: newAsset })).status, 400); assert.equal((await f.api(`/api/artifacts/${newAsset.artifactId}/content`)).data.content, 'New arbitrary file');
  const enterpriseAsset = await f.upload('Private company material'); const privateDoc = (await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Private company profile', slotKey: 'company', asset: enterpriseAsset })).data.document;
  assert.equal((await change(f, current, { documents: [{ documentId: privateDoc.id, documentVersion: 1, purpose: 'Qualification' }] })).status, 400);
  const linked = await change(f, current, { documents: [{ documentId: doc.id, documentVersion: 1, purpose: 'Public source summary' }] }); assert.equal(linked.status, 200); const readiness = (await f.api(`/api/library/products/${p.id}/readiness`)).data.readiness; assert.ok(readiness.checks.some(entry => entry.key === 'public-reference' && entry.status === 'unverified')); assert.notEqual(readiness.overall, 'ready_for_review'); assert.ok(readiness.checks.every(entry => /[\u4e00-\u9fff]/u.test(entry.label) && /[\u4e00-\u9fff]/u.test(entry.message)));
  await f.restart(); assert.deepEqual((await f.api(`/api/library/products/${p.id}`)).data.product.source, provenance); assert.deepEqual((await f.api(`/api/library/documents/${doc.id}`)).data.document.source, docSource);
});

test('library public source inputs reject credential URLs, local hosts, incomplete captures and forged certificate metadata', async t => {
  const f = await fixture(t), good = publicSource();
  for (const source of [{ ...good, sourceUrl: 'http://example.com/' }, { ...good, sourceUrl: 'https://user:pass@example.com/' }, { ...good, sourceUrl: 'https://127.0.0.1/' }, { ...good, sourceUrl: 'https://localhost/' }, { ...good, referenceOnly: false }, { ...good, fetchedAt: 'yesterday' }, { ...good, batchId: 'not-uuid' }, { ...good, fieldSources: [] }, { ...good, fieldSources: [{ ...good.fieldSources[0], fieldPath: 'skus.0.moq' }] }, { ...good, fieldSources: [{ ...good.fieldSources[0], capturedValue: 'x'.repeat(4001) }] }]) assert.equal((await create(f, 'Rejected reference', { source })).status, 400);
  const asset = await f.upload(); const result = await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Forged reference certificate', slotKey: 'specification', asset, source: publicSource('title'), certificate: { number: 'NOT-OUR-CERTIFICATE' } }); assert.equal(result.status, 400);
});

test('library conversation references save exact selections with independent revisions, receipts, stale resolution and restart', async t => {
  const f = await fixture(t), conversation = (await f.api('/api/conversations', 'POST', { title: 'One real conversation' })).data.conversation;
  const endpoint = `/api/conversations/${conversation.id}/library-references`; const empty = await f.api(endpoint); assert.deepEqual(empty.data.libraryReferences, { conversationId: conversation.id, revision: 0, products: [], documents: [], updatedAt: null });
  const p = (await create(f, 'Selected product')).data.product, asset = await f.upload('Version one'); const doc = (await f.api('/api/library/documents', 'POST', { requestId: req(), title: 'Selected document', asset })).data.document;
  const body = { requestId: req(), expectedRevision: 0, references: { products: [{ productId: p.id, productRevision: 1 }], documents: [{ documentId: doc.id, documentVersion: 1 }] } };
  const results = await Promise.all([f.api(endpoint, 'PATCH', body), f.api(endpoint, 'PATCH', body)]); assert.ok(results.every(value => value.status === 200)); assert.ok(results.some(value => value.data.operation.duplicate)); assert.equal(results[0].data.libraryReferences.revision, 1);
  assert.equal((await f.api(endpoint, 'PATCH', { ...body, requestId: req() })).data.error.code, 'REVISION_CONFLICT'); assert.equal((await f.api(endpoint, 'PATCH', { ...body, references: { products: [], documents: [] } })).data.error.code, 'IDEMPOTENCY_CONFLICT');
  const updated = (await change(f, p, { description: 'New product revision' })).data.product; const second = await f.upload('Version two'); assert.equal((await f.api(`/api/library/documents/${doc.id}/versions`, 'POST', { requestId: req(), expectedRevision: 1, asset: second })).status, 201);
  const stale = await f.api(endpoint); assert.equal(stale.data.libraryReferences.products[0].productRevision, 1); assert.equal(stale.data.resolution.products[0].status, 'updated'); assert.equal(stale.data.resolution.products[0].currentRevision, 2); assert.equal(stale.data.libraryReferences.documents[0].documentVersion, 1); assert.equal(stale.data.resolution.documents[0].status, 'updated');
  assert.equal((await f.api(endpoint, 'PATCH', { ...body, requestId: req(), expectedRevision: 1 })).data.error.code, 'LINK_CONFLICT');
  const updatedBody = { requestId: req(), expectedRevision: 1, references: { products: [{ productId: updated.id, productRevision: updated.revision }], documents: [{ documentId: doc.id, documentVersion: 1 }] } }; const saved = await f.api(endpoint, 'PATCH', updatedBody); assert.equal(saved.status, 200); assert.equal(saved.data.libraryReferences.revision, 2); assert.equal(saved.data.resolution.documents[0].status, 'updated');
  await f.restart(); const reopened = await f.api(endpoint); assert.deepEqual(reopened.data.libraryReferences, saved.data.libraryReferences); assert.equal((await f.api(endpoint, 'PATCH', updatedBody)).data.operation.duplicate, true); assert.equal((await f.api(`/api/library/operations/${updatedBody.requestId}`)).data.operation.committedRevision, 2);
  assert.equal(f.app.store.read().conversations[0].inputContext?.artifacts?.length ?? 0, 0);
  await f.api(`/api/library/documents/${doc.id}`, 'PATCH', { requestId: req(), expectedRevision: 2, changes: { status: 'archived' } }); assert.equal((await f.api(endpoint)).data.resolution.documents[0].status, 'archived');
  assert.equal((await f.api(endpoint, 'PATCH', { ...updatedBody, requestId: req(), expectedRevision: 2 })).data.error.code, 'LINK_CONFLICT');
  assert.equal((await f.api(`/api/conversations/${req()}/library-references`)).status, 404);
});
