import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/store.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../scripts/recovery.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'business-library-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { data: path.join(root, 'data'), backup: path.join(root, 'backup'), restored: path.join(root, 'restored') };
}

// These source URLs and captured values are synthetic provenance fixtures.
// No external source is fetched and no live workspace or worker is touched.
function publicSource(fieldPath, capturedValue, batchId) {
  return { kind: 'public_reference', referenceOnly: true, sourceUrl: 'https://example.com/reference', fetchedAt: '2026-10-09T12:00:00.000Z', batchId, fieldSources: [{ fieldPath, sourceUrl: 'https://example.com/reference', locator: `fixture:${fieldPath}`, capturedValue }] };
}

test('real v3 library API data, public provenance and pinned conversation references survive verified backup and restore', async t => {
  let app;
  t.after(() => app?.close());
  const f = await fixture(t); app = await createApp({ dataDirectory: f.data });
  let address = await app.listen(0);
  async function api(route, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  }
  const conversation = (await api('/api/conversations', 'POST', { title: 'Recovery references fixture' })).conversation;
  const artifact = (await api('/api/artifacts', 'POST', { requestId: randomUUID(), filename: 'reference.txt', content: 'Exact fixture document version one', metadata: { businessLibrary: { visibility: 'internal' } } })).artifact;
  const asset = { artifactId: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256 };
  const batchId = randomUUID(), documentSource = publicSource('title', 'Public specification fixture', batchId), productSource = publicSource('name', 'Public product fixture', batchId);
  const document = (await api('/api/library/documents', 'POST', { requestId: randomUUID(), title: 'Public specification fixture', slotKey: 'specification', source: documentSource, asset })).document;
  const product = (await api('/api/library/products', 'POST', { requestId: randomUUID(), name: 'Public product fixture', source: productSource, documents: [{ documentId: document.id, documentVersion: 1, purpose: 'Exact reference version' }] })).product;
  const updatedProduct = (await api(`/api/library/products/${product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: product.revision, changes: { description: 'Locally saved reference description' } })).product;
  const versionedDocument = (await api('/api/library/documents', 'POST', { requestId: randomUUID(), title: 'Enterprise versioned fixture', slotKey: 'other', asset })).document;
  const secondArtifact = (await api('/api/artifacts', 'POST', { requestId: randomUUID(), filename: 'reference-v2.txt', content: 'Newer fixture document version two', metadata: { businessLibrary: { visibility: 'internal' } } })).artifact;
  await api(`/api/library/documents/${versionedDocument.id}/versions`, 'POST', { requestId: randomUUID(), expectedRevision: versionedDocument.revision, asset: { artifactId: secondArtifact.id, version: secondArtifact.currentVersion, sha256: secondArtifact.sha256 } });
  const savedReferenceResponse = await api(`/api/conversations/${conversation.id}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references: { products: [{ productId: product.id, productRevision: updatedProduct.revision }], documents: [{ documentId: document.id, documentVersion: 1 }, { documentId: versionedDocument.id, documentVersion: 1 }] } });
  const reference = app.store.read().businessLibrary.conversationReferences[0];
  const savedLibrary = app.store.read().businessLibrary;
  await app.close(); app = null;
  const before = await fs.readFile(path.join(f.data, 'workspace.json'));
  assert.equal((await createBackup(f.data, f.backup)).verified, true);
  assert.equal((await restoreBackup(f.backup, f.restored)).queuedWorkResumed, false);
  const restoredJson = JSON.parse(await fs.readFile(path.join(f.restored, 'workspace.json'), 'utf8'));
  assert.equal(restoredJson.version, 3);
  assert.deepEqual(restoredJson.businessLibrary, savedLibrary);
  assert.deepEqual(restoredJson.businessLibrary.products[0].source, productSource);
  assert.deepEqual(restoredJson.businessLibrary.documents[0].source, documentSource);
  assert.deepEqual(restoredJson.businessLibrary.conversationReferences, [reference]);
  assert.equal(restoredJson.businessLibrary.documents.find(entry => entry.id === versionedDocument.id).currentVersion, 2);
  assert.equal(restoredJson.businessLibrary.conversationReferences[0].documents.find(entry => entry.documentId === versionedDocument.id).documentVersion, 1);
  app = await createApp({ dataDirectory: f.restored }); address = await app.listen(0);
  assert.equal((await api(`/api/library/products/${product.id}`)).product.description, 'Locally saved reference description');
  const restoredDocument = (await api(`/api/library/documents/${document.id}`)).document;
  assert.deepEqual(restoredDocument.source, documentSource);
  assert.deepEqual(restoredDocument.versions[0].asset, asset);
  const download = await fetch(`http://127.0.0.1:${address.port}/api/artifacts/${artifact.id}/download?version=1`);
  assert.equal(download.status, 200); assert.equal(await download.text(), 'Exact fixture document version one');
  const bootstrap = await api('/api/bootstrap'); assert.equal(Object.hasOwn(bootstrap, 'businessLibrary'), false);
  assert.deepEqual((await api(`/api/conversations/${conversation.id}/library-references`)).libraryReferences, savedReferenceResponse.libraryReferences);
  assert.deepEqual(app.store.read().businessLibrary.conversationReferences, [reference]);
  assert.deepEqual(await fs.readFile(path.join(f.data, 'workspace.json')), before);
  assert.equal((await verifyBackup(f.backup)).verified, true);
});

test('earlier v3 backups missing conversation references verify and restore without schema migration or source loss', async t => {
  const f = await fixture(t), initial = await openStore(f.data);
  await initial.update(state => {
    state.businessLibrary.company.displayName = 'Earlier v3 fixture';
    state.businessLibrary.products.push({ id: randomUUID(), revision: 1, name: 'Stored source fixture', source: publicSource('name', 'Stored source fixture', randomUUID()) });
  });
  await initial.close();
  const filename = path.join(f.data, 'workspace.json'), state = JSON.parse(await fs.readFile(filename, 'utf8'));
  delete state.businessLibrary.conversationReferences;
  const earlierBytes = `${JSON.stringify(state, null, 4)}\n`; await fs.writeFile(filename, earlierBytes);
  const opened = await openStore(f.data);
  assert.deepEqual(opened.read().businessLibrary.conversationReferences, []);
  assert.equal(opened.diagnostics().startup.action, 'opened');
  assert.equal(await fs.readFile(filename, 'utf8'), earlierBytes); await opened.close();
  await createBackup(f.data, f.backup); await restoreBackup(f.backup, f.restored);
  const restoredBytes = await fs.readFile(path.join(f.restored, 'workspace.json'), 'utf8'), restoredState = JSON.parse(restoredBytes);
  assert.equal(restoredState.version, 3);
  assert.equal(Object.hasOwn(restoredState.businessLibrary, 'conversationReferences'), false);
  assert.deepEqual(restoredState.businessLibrary, state.businessLibrary);
  const restored = await openStore(f.restored); t.after(() => restored.close());
  assert.deepEqual(restored.read().businessLibrary.conversationReferences, []);
  assert.deepEqual(restored.read().businessLibrary.products[0].source, state.businessLibrary.products[0].source);
  assert.equal(restored.diagnostics().startup.action, 'opened');
  assert.equal(await fs.readFile(path.join(f.restored, 'workspace.json'), 'utf8'), restoredBytes);
  assert.equal(await fs.readFile(filename, 'utf8'), earlierBytes);
});
