// Requires unchanged root-lock dependencies. Import failures are blockers, never
// skipped passes. Real signed HTTP upload/Library/current authority below;
// only synthetic documents, identity material and local Docling responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { taskFixture } from '../fixtures/pi-task-helpers.mjs';
import { createLibraryModelRead } from '../../server/library-model-read.mjs';
import { createFactoryLibraryIngestionClient } from '../../server/factory-library-ingestion.mjs';
import { libraryReadHash } from '../../server/library-model-read-contract.mjs';
import { leaves } from '../../plugins/workspace-factory-ingestion/src/contract.mjs';
import { model, recipient, sha, texts, parserFixture, payload, code } from './fixtures.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/document-provenance-upload-');
  const seed = await taskFixture(t, { directory, enterprise: true }), pins = [];
  for (const [i, text] of texts.entries()) {
    // Same filename deliberately: names cannot establish source identity.
    const upload = await seed.workspace('/api/artifacts', { subject: 'member-a', body: { requestId: randomUUID(),
      filename: 'synthetic-specification.txt', base64: Buffer.from(text).toString('base64'), metadata: { businessLibrary: { visibility: 'internal' } } } });
    assert.equal(upload.status, 201, upload.text);
    const record = upload.json.artifact, asset = { artifactId: record.id, version: record.currentVersion, sha256: record.sha256 };
    assert.equal(asset.sha256, sha(text));
    const linked = await seed.workspace('/api/library/documents', { subject: 'member-a', body: { requestId: randomUUID(),
      title: 'SYNTHETIC ' + (i ? 'BOWL-B' : 'CUP-A'), slotKey: 'specification', asset } });
    assert.equal(linked.status, 201, linked.text);
    pins.push({ documentId: linked.json.document.id, revision: linked.json.document.revision,
      documentVersion: linked.json.document.currentVersion, asset });
  }
  await seed.app.close();
  const policy = { enabled: true, reviewed: true, workspaceId: 'pi-enterprise-test', subject: 'member-a',
    expiresAt: '2099-01-01T00:00:00Z', recipient, company: null, products: [], productFields: ['name'],
    factoryMaterials: { products: [], productFields: ['name'], documents: pins.map(p => ({ id: p.documentId, revision: p.revision, documentVersion: p.documentVersion, asset: p.asset })) },
    factoryIngestion: { uploads: pins.map(p => p.asset), companyRevision: null, products: [], fields: { company: [], product: ['name', 'skus'] } } };
  const f = await taskFixture(t, { directory, enterprise: true, libraryModelReadPolicy: policy });
  const sessions = await f.workspace('/api/access/sessions', { subject: 'member-a' }); assert.equal(sessions.status, 200, sessions.text);
  const session = sessions.json.sessions.find(row => row.subject === 'member-a'); assert.ok(session);
  const identity = { sessionId: session.id, subject: session.subject, role: session.role, workspaceId: policy.workspaceId };
  const parser = await parserFixture(t);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  parser.state.onResponse = bytes => { const i = pins.findIndex(p => p.asset.sha256 === sha(bytes)); assert.ok(i >= 0); parser.state.response = payload(texts[i]); };
  const binding = await f.app.enterpriseContextSessionBinding(identity, { recipient,
    selection: { enabled: true, reviewed: true, customerId: 'synthetic-buyer', sources: pins }, connection: parser.connection,
    authorizeParserTransfer: async request => pins.some(p => p.documentId === request.documentId
      && request.documentRevision === p.revision && request.documentVersion === p.documentVersion
      && libraryReadHash(request.target) === libraryReadHash(p.asset))
      && request.recipient.destination === parser.connection.baseURL + '/v1/convert/file'
      && request.purpose === 'document-extraction' && request.transfer === 'complete-file' });
  const control = binding.open('synthetic-document-provenance-native');
  // Same original permission class and live signed Session, not a no-op permit.
  const authority = createLibraryModelRead({ library: f.app.businessLibrary, artifacts: f.app.artifacts, access: f.app.access, policy });
  const permit = () => authority.factoryIngestionForSession({ identity, recipientHash: libraryReadHash(recipient) });
  const conversation = await f.app.runtime.createConversation({ title: 'SYNTHETIC provenance intake', inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [] } }, identity);
  const parsed = new Map();
  const client = createFactoryLibraryIngestionClient({ store: f.app.store, artifacts: f.app.artifacts, identity,
    conversationId: conversation.conversation.id, scope: permit().scope,
    authorize: async () => permit(), canSave: () => true, // Synthetic explicit intake intent, not a production Run/SDK test.
    sourceReader: async ({ bytes }) => {
      const pin = pins.find(p => p.asset.sha256 === sha(bytes)); assert.ok(pin);
      // Test-only composition of existing capabilities, not a new parser/cache
      // implementation. Reuse original authenticated receipts with fresh checks.
      if (!parsed.has(pin.asset.sha256)) parsed.set(pin.asset.sha256, await control.parseUpload(pin.asset, undefined, model));
      const receipt = parsed.get(pin.asset.sha256);
      control.verifyBody(receipt.authorization, receipt); await control.check(receipt.authorization, undefined, model);
      return structuredClone(receipt);
    } });
  return { ...f, pins, parser, control, client, identity };
}

async function plan(f) {
  // Reverse read and record order so position and filename cannot identify SKU.
  const order = [1, 0], reads = [];
  for (const index of order) reads.push(await f.client.read({ asset: f.pins[index].asset }, undefined, model));
  const values = [{ name: 'SYNTHETIC BOWL-B', skus: [{ code: 'BOWL-B', moq: 780 }] },
    { name: 'SYNTHETIC CUP-A', skus: [{ code: 'CUP-A', moq: 120 }] }];
  return { requestId: 'synthetic-reversed-products', sources: reads.map(r => r.source), records: values.map((value, i) => ({
    key: 'record-' + i, kind: 'product', values: value,
    evidence: leaves(value).map(([path]) => ({ path, sourceIndex: i, start: 0, end: reads[i].text.length - 1, quote: reads[i].text.slice(0, -1) })),
    missing: [], conflicts: [],
  })) };
}

test('real upload and Docling-bound reversed multi-product intake preserve each product reference', async t => {
  const f = await fixture(t), input = await plan(f), saved = await f.client.save(input, undefined, model);
  const queried = await f.client.query({ requestId: input.requestId }, undefined, model);
  assert.equal(saved.humanConfirmed, false); assert.equal(saved.independentVerification, false);
  for (const [i, index] of [1, 0].entries()) {
    const product = f.app.businessLibrary.getProduct(queried.records[i].recordId).product, refs = product.documents;
    assert.equal(refs.length, 1); assert.equal(refs[0].documentId, f.pins[index].documentId);
    const document = f.app.businessLibrary.getDocument(refs[0].documentId).document;
    assert.deepEqual(document.versions.find(v => v.version === refs[0].documentVersion).asset, f.pins[index].asset);
    assert.equal(product.skus[0].moq, index ? 780 : 120);
  }
  // Actual persistence oracle, pending dependency availability: a document A
  // classification may cite B, but its report must retain B's index/quote/asset.
  // Both sources already exist as Library documents; this checks saved evidence,
  // not new-document classification semantics or a certificate's truth.
  const quote = 'BOWL-B', start = texts[1].indexOf(quote), originalTitle = f.app.businessLibrary.getDocument(f.pins[0].documentId).document.title;
  const classification = { requestId: 'synthetic-cross-source-report', sources: [input.sources[1], input.sources[0]], records: [{
    key: 'classify-A-using-B', kind: 'document', sourceIndex: 0, values: { title: quote },
    evidence: [{ path: 'title', sourceIndex: 1, start, end: start + quote.length, quote }], missing: [], conflicts: [],
  }] };
  const classified = await f.client.save(classification, undefined, model);
  const reportFile = await f.app.artifacts.read(classified.report.artifactId, { version: classified.report.version });
  const persisted = JSON.parse(reportFile.content);
  assert.deepEqual(persisted.input, classification);
  const evidence = persisted.input.records[0].evidence[0];
  assert.equal(evidence.sourceIndex, 1); assert.equal(evidence.quote, quote);
  assert.deepEqual(persisted.input.sources[evidence.sourceIndex].asset, f.pins[1].asset);
  assert.deepEqual(persisted.sources[evidence.sourceIndex].source.asset, f.pins[1].asset);
  assert.equal(f.app.businessLibrary.getDocument(f.pins[0].documentId).document.title, originalTitle);
  const crossQuery = await f.client.query({ requestId: classification.requestId }, undefined, model);
  assert.deepEqual(crossQuery.report.input, classification);
});

test('real intake refuses cross-document fragments and missing source evidence without partial catalog writes', async t => {
  const f = await fixture(t), input = await plan(f), cross = structuredClone(input);
  cross.records[0].evidence[0].sourceIndex = 1;
  await assert.rejects(f.client.save(cross, undefined, model), code('FACTORY_INGESTION_QUOTE_MISMATCH'));
  const missing = structuredClone(input); missing.records[0].evidence = [];
  await assert.rejects(f.client.save(missing, undefined, model), /Every populated leaf requires original evidence/);
  assert.equal(f.app.store.read().businessLibrary.products.length, 0);
});

test('real document version advance rejects cached parse despite retained historical upload bytes', async t => {
  const f = await fixture(t), pin = f.pins[0], receipt = await f.control.parseUpload(pin.asset, undefined, model);
  const upload = await f.workspace('/api/artifacts', { subject: 'member-a', body: { requestId: randomUUID(),
    filename: 'synthetic-new-version.txt', content: 'SYNTHETIC CUP-A MOQ 240 v2', metadata: { businessLibrary: { visibility: 'internal' } } } });
  assert.equal(upload.status, 201, upload.text); const a = upload.json.artifact;
  const changed = await f.workspace('/api/library/documents/' + pin.documentId + '/versions', { subject: 'member-a',
    body: { requestId: randomUUID(), expectedRevision: pin.revision, asset: { artifactId: a.id, version: a.currentVersion, sha256: a.sha256 } } });
  assert.equal(changed.status, 201, changed.text);
  assert.equal((await f.app.artifacts.download(pin.asset.artifactId, { version: 1 })).bytes.toString(), texts[0]);
  await assert.rejects(f.control.check(receipt.authorization, undefined, model), code('FACTORY_DOCUMENT_REVISION_CHANGED'));
  assert.equal(f.parser.state.calls.length, 1);
});

test('real signed Session logout denies previously authorized receipt reuse', async t => {
  const f = await fixture(t), receipt = await f.control.parseUpload(f.pins[0].asset, undefined, model);
  const logout = await f.workspace('/api/session/logout', { subject: 'member-a', body: {} }); assert.equal(logout.status, 200, logout.text);
  await assert.rejects(f.control.check(receipt.authorization, undefined, model), code('OSS_SESSION_REVOKED'));
  assert.equal(f.parser.state.calls.length, 1);
});
