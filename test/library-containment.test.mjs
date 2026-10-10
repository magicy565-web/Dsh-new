import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { createNativeWorkerConnectorAdapter } from '../server/worker-provider.mjs';

// Model responses and Worker executors below are inert scripted fixtures. HTTP,
// authentication gates, library transactions and artifact bytes use the real app.
async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'library-containment-http-'));
  const requests = [];
  const provider = { configured: true, kind: 'containment-scripted-fixture', complete: async input => {
    requests.push(input); return { content: 'Synthetic local model fixture reply' };
  } };
  let app = await createApp({ dataDirectory: directory, provider }), address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  async function upload(content, filename) {
    const result = await api('/api/artifacts', 'POST', { requestId: randomUUID(), filename, content, metadata: { businessLibrary: { visibility: 'internal' } } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const artifact = result.data.artifact;
    return { artifactId: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256 };
  }
  return { api, requests, upload, get app() { return app; }, async restart() {
    await app.close(); app = await createApp({ dataDirectory: directory, provider }); address = await app.listen(0);
  } };
}

async function privateLibrary(t) {
  const f = await fixture(t);
  const firstAsset = await f.upload('PRIVATE_DOCUMENT_VERSION_ONE', 'PRIVATE_CERTIFICATE_FILENAME.txt');
  const secondAsset = await f.upload('PRIVATE_DOCUMENT_VERSION_TWO', 'PRIVATE_SECOND_FILENAME.txt');
  const created = await f.api('/api/library/documents', 'POST', { requestId: randomUUID(), title: 'PRIVATE_DOCUMENT_TITLE', slotKey: 'certificate', asset: firstAsset });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const appended = await f.api(`/api/library/documents/${created.data.document.id}/versions`, 'POST', {
    requestId: randomUUID(), expectedRevision: created.data.document.revision, asset: secondAsset,
  });
  assert.equal(appended.status, 201, JSON.stringify(appended.data));
  const product = await f.api('/api/library/products', 'POST', {
    requestId: randomUUID(), name: 'PRIVATE_PRODUCT_NAME', description: 'PRIVATE_PRODUCT_DESCRIPTION',
    skus: [{ id: randomUUID(), code: 'PRIVATE_SKU_CODE', unit: 'piece', moq: 10, specs: [],
      pricingMode: 'tiered', pricingNote: 'PRIVATE_PRICE_NOTE', priceTiers: [{ minQuantity: 10, unitPrice: '98765.43', currency: 'USD' }], leadTimeDays: 7 }],
    supply: { packaging: 'PRIVATE_PACKAGING', samplePolicy: 'PRIVATE_SAMPLE_POLICY', paymentTerms: 'PRIVATE_PAYMENT_TERMS', shippingTerms: 'PRIVATE_SHIPPING_TERMS', capacityNote: 'PRIVATE_CAPACITY_NOTE' },
    documents: [{ documentId: appended.data.document.id, documentVersion: 1, purpose: 'PRIVATE_EVIDENCE_PURPOSE' }],
  });
  assert.equal(product.status, 201, JSON.stringify(product.data));
  const conversation = await f.api('/api/conversations', 'POST', { title: 'Independent local task' });
  assert.equal(conversation.status, 201);
  const references = {
    products: [{ productId: product.data.product.id, productRevision: product.data.product.revision }],
    documents: [{ documentId: appended.data.document.id, documentVersion: 1 }],
  };
  const route = `/api/conversations/${conversation.data.conversation.id}/library-references`;
  const empty = await f.api(route);
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.equal(empty.data.libraryReferences.revision, 0);
  const binding = await f.api(route, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references });
  assert.equal(binding.status, 200, JSON.stringify(binding.data));
  assert.equal(binding.data.libraryReferences.revision, 1);
  assert.equal(binding.data.resolution.documents[0].status, 'updated', 'the exact historic document version is selected');
  return { ...f, get app() { return f.app; }, conversationId: conversation.data.conversation.id, route, references, product: product.data.product, document: appended.data.document, firstAsset, secondAsset };
}

const privateData = [
  'businessLibrary', 'conversationReferences', 'libraryReferences', 'PRIVATE_', '98765.43',
];
function noPrivateData(value, extra = []) {
  const serialized = JSON.stringify(value);
  for (const marker of [...privateData, ...extra]) assert.equal(serialized.includes(marker), false, `Unexpected outbound/private marker: ${marker}`);
}
async function waitForRun(f, runId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await f.api(`/api/runs/${runId}`);
    if (result.data.run.status === 'succeeded') return result.data.run;
    assert.equal(['running', 'queued'].includes(result.data.run.status), true, JSON.stringify(result.data));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Scripted provider run did not finish');
}

test('real HTTP private conversation references persist locally and never enter bootstrap or scripted model requests', async t => {
  const f = await privateLibrary(t);
  const extra = [f.product.id, f.document.id, f.firstAsset.artifactId, f.secondAsset.artifactId];
  noPrivateData((await f.api('/api/bootstrap')).data, extra);
  const before = await f.api(`/api/conversations/${f.conversationId}/messages`, 'POST', {
    requestId: randomUUID(), content: 'Write an independent generic reply.',
  });
  assert.equal(before.status, 202);
  await waitForRun(f, before.data.run.id);
  assert.equal(f.requests.length, 1);
  noPrivateData(f.requests[0], extra);
  assert.equal(Object.hasOwn(f.requests[0], 'state'), false);
  assert.equal(Object.hasOwn(f.requests[0], 'bootstrap'), false);
  noPrivateData((await f.api('/api/bootstrap')).data, extra);
  await f.restart();
  assert.equal(f.requests.length, 1, 'restart does not invoke a model');
  const reopened = await f.api(f.route);
  assert.equal(reopened.status, 200);
  assert.deepEqual(reopened.data.libraryReferences.products, f.references.products);
  assert.deepEqual(reopened.data.libraryReferences.documents, f.references.documents);
  const after = await f.api(`/api/conversations/${f.conversationId}/messages`, 'POST', { requestId: randomUUID(), content: 'A second independent reply after restart.' });
  assert.equal(after.status, 202);
  await waitForRun(f, after.data.run.id);
  assert.equal(f.requests.length, 2);
  noPrivateData(f.requests[1], extra);
  noPrivateData((await f.api('/api/bootstrap')).data, extra);
});

test('real HTTP conversation bindings grant no generic input-context access to any private physical version', async t => {
  const f = await privateLibrary(t);
  const inputRoute = `/api/conversations/${f.conversationId}/input-context`;
  const fabricated = await f.api(inputRoute, 'PATCH', { inputContext: { libraryReferences: f.references } });
  assert.equal(fabricated.status, 400);
  assert.equal(fabricated.data.error.code, 'INVALID_INPUT_CONTEXT');
  for (const asset of [f.firstAsset, f.secondAsset]) {
    const selection = { artifacts: [{ id: asset.artifactId, version: asset.version }] };
    const selected = await f.api(inputRoute, 'PATCH', { inputContext: selection });
    assert.equal(selected.status, 403);
    assert.equal(selected.data.error.code, 'BUSINESS_LIBRARY_PRIVATE');
    const sent = await f.api(`/api/conversations/${f.conversationId}/messages`, 'POST', { requestId: randomUUID(), content: 'Attempt private input', inputContext: selection });
    assert.equal(sent.status, 403);
    assert.equal(sent.data.error.code, 'BUSINESS_LIBRARY_PRIVATE');
    assert.equal((await f.api(`/api/artifacts/${asset.artifactId}/content?version=${asset.version}`)).status, 200, 'authorized local preview remains available');
  }
  assert.equal(f.requests.length, 0);
  assert.deepEqual((await f.api(f.route)).data.libraryReferences.products, f.references.products);
});

test('real HTTP exact local connector approvals cannot read or overwrite files through conversation bindings', async t => {
  const f = await privateLibrary(t);
  const created = await f.api('/api/connectors', 'POST', { name: 'Local file connector containment fixture', adapter: 'workspace-library', capabilities: ['read_file', 'update_file'] });
  assert.equal(created.status, 201);
  const connectorId = created.data.connector.id;
  assert.equal((await f.api(`/api/connectors/${connectorId}`, 'PATCH', { enabled: true })).status, 200);
  for (const asset of [f.firstAsset, f.secondAsset]) {
    for (const action of ['read_file', 'update_file']) {
      const input = { action, resource: `artifact:${asset.artifactId}`, payload: action === 'read_file' ? { version: asset.version } : { expectedRevision: f.app.artifacts.get(asset.artifactId).artifact.revision, content: 'SHOULD_NOT_OVERWRITE' } };
      const approval = await f.api(`/api/connectors/${connectorId}/approval`, 'POST', input);
      assert.equal(approval.status, 201);
      const approvalId = approval.data.approval.id;
      assert.equal((await f.api(`/api/approvals/${approvalId}/decision`, 'POST', { decision: 'approved', confirmed: true })).status, 200);
      const executed = await f.api(`/api/connectors/${connectorId}/execute`, 'POST', { ...input, approvalId });
      assert.equal(executed.status, 200);
      assert.equal(executed.data.execution.status, 'failed');
      assert.equal(executed.data.execution.error.code, 'CONNECTOR_EXECUTION_FAILED');
      noPrivateData(executed.data);
      assert.equal(f.app.artifacts.get(asset.artifactId).artifact.currentVersion, 1);
    }
  }
  assert.equal(f.requests.length, 0);
});

test('real HTTP public reference provenance never makes its stored physical document automatic model input', async t => {
  const f = await fixture(t);
  const sourceUrl = 'https://fixtures.example.com/public-reference';
  const provenance = fieldPath => ({ kind: 'public_reference', referenceOnly: true, sourceUrl,
    fetchedAt: '2026-10-09T00:00:00.000Z', batchId: randomUUID(),
    fieldSources: [{ fieldPath, sourceUrl, locator: 'Synthetic fixture capture only', capturedValue: 'PUBLIC_CAPTURE_MARKER' }],
  });
  const uploaded = await f.api('/api/artifacts', 'POST', { requestId: randomUUID(), filename: 'reference.txt', content: 'PUBLIC_SOURCE_PHYSICAL_BYTES', metadata: {} });
  assert.equal(uploaded.status, 201);
  const record = uploaded.data.artifact, asset = { artifactId: record.id, version: record.currentVersion, sha256: record.sha256 };
  const document = await f.api('/api/library/documents', 'POST', { requestId: randomUUID(), title: 'PUBLIC_CAPTURE_MARKER', slotKey: 'specification', asset, source: provenance('title') });
  assert.equal(document.status, 201, JSON.stringify(document.data));
  const product = await f.api('/api/library/products', 'POST', { requestId: randomUUID(), name: 'PUBLIC_CAPTURE_MARKER', source: provenance('name'), documents: [{ documentId: document.data.document.id, documentVersion: 1, purpose: 'Reference specification' }] });
  assert.equal(product.status, 201, JSON.stringify(product.data));
  assert.equal(f.app.artifacts.get(record.id).artifact.metadata.businessLibrary.visibility, 'internal');
  const conversation = await f.api('/api/conversations', 'POST', { title: 'Public reference local binding fixture' });
  const conversationId = conversation.data.conversation.id;
  const binding = await f.api(`/api/conversations/${conversationId}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0,
    references: { products: [{ productId: product.data.product.id, productRevision: product.data.product.revision }], documents: [{ documentId: document.data.document.id, documentVersion: 1 }] },
  });
  assert.equal(binding.status, 200);
  const selected = await f.api(`/api/conversations/${conversationId}/input-context`, 'PATCH', { inputContext: { artifacts: [{ id: record.id, version: 1 }] } });
  assert.equal(selected.status, 403);
  assert.equal(selected.data.error.code, 'BUSINESS_LIBRARY_PRIVATE');
  const sent = await f.api(`/api/conversations/${conversationId}/messages`, 'POST', { requestId: randomUUID(), content: 'Give a generic response without any reference transfer.' });
  assert.equal(sent.status, 202);
  await waitForRun(f, sent.data.run.id);
  const extra = [sourceUrl, 'PUBLIC_CAPTURE_MARKER', 'PUBLIC_SOURCE_PHYSICAL_BYTES', product.data.product.id, document.data.document.id, record.id];
  noPrivateData(f.requests[0], extra);
  noPrivateData((await f.api('/api/bootstrap')).data, extra);
  assert.equal((await f.api(`/api/artifacts/${record.id}/content?version=1`)).data.content, 'PUBLIC_SOURCE_PHYSICAL_BYTES', 'authorized local reading of a reference remains available');
});

test('unchanged Worker adapter rejects private-reference fields without dispatching an executor', async () => {
  let submissions = 0;
  const adapter = createNativeWorkerConnectorAdapter({ workerProvider: { configured: true, submit() { submissions++; return {}; } } });
  for (const injected of [{ libraryReferences: { products: [{ productId: 'private-product', productRevision: 1 }], documents: [] } }, { artifactId: randomUUID(), version: 1 }, { businessLibrary: { company: { legalName: 'PRIVATE_COMPANY' } } }]) {
    await assert.rejects(adapter.execute({ action: 'submit', resource: 'reviewed-task', idempotencyKey: randomUUID(), payload: { taskKey: 'reviewed-task', jobId: 'fixture-job', deadlineAt: Date.now() + 60000, ...injected } }), { code: 'WORKER_UNAPPROVED_TASK' });
  }
  assert.equal(submissions, 0);
});
