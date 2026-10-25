import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore, createLibraryService, createHttpHandler, apply, API_PREFIX } from '../index.js';

const DAY = () => Date.parse('2026-10-26T00:00:00Z');
const sku = { code: 'LINEN-165', unit: '件', moq: 370, leadTimeDays: 17,
  specs: [{ key: '克重', value: '165 GSM' }], pricingMode: 'tiered',
  priceTiers: [{ minQuantity: 370, unitPrice: '37.50', currency: 'USD' }] };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-product-context-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blobs = new Map();
  let reads = 0;
  const attachments = {
    async saveFile({ data, name }) {
      const attachmentId = 'sha256:' + createHash('sha256').update(data).digest('hex');
      blobs.set(attachmentId, Buffer.from(data));
      return { attachmentId, name, bytes: data.length };
    },
    async *readFileStream(ref) { reads++; yield blobs.get(ref.attachmentId); },
  };
  const store = new LibraryStore({ dir, clock: DAY });
  return { dir, store, attachments, blobs, reads: () => reads, service: createLibraryService(store, { attachments }) };
}
const link = document => ({ documentId: document.id, documentVersion: 1, purpose: '客户条款依据' });

test('one product snapshot preserves fields and exact historical source; metadata never reads or certifies bytes', async t => {
  const fixture = await setup(t), { service } = fixture;
  await service.saveCompany({ expectedRevision: 1, changes: { displayName: '测试企业' } });
  const document = await service.addDocument({ title: '条款', fileName: 'policy.txt', data: Buffer.from('MOQ 370; delivery 17 days') });
  await service.reviewDocument(document.id, 1, { expectedRevision: 1, decision: 'verified' });
  await service.addDocumentVersion(document.id, { content: 'MOQ 940; delivery 31 days' });
  const product = await service.saveProduct({ name: '麻混纺', description: '合成数据', category: '服装', skus: [sku], documents: [link(document)] });
  await service.saveProduct({ name: '另一款产品', skus: [{ ...sku, code: 'OTHER', moq: 888 }] });
  const sequence = (await service.status()).sequence;
  const context = await service.productContext({ productId: product.id, expectedRevision: 1 });
  assert.equal(context.source.productId, product.id);
  assert.equal(context.source.revision, 1);
  assert.equal(context.source.reviewState, 'unreviewed');
  assert.equal(context.source.companyRevision, 2);
  assert.equal(context.company.displayName, '测试企业');
  assert.equal(context.product.skus[0].moq, 370);
  assert.equal(context.product.skus[0].priceTiers[0].unitPrice, '37.50');
  assert.equal(context.internalPricing, true);
  assert.equal(JSON.stringify(context).includes('OTHER'), false);
  const source = context.documents[0];
  assert.equal(source.version, 1);
  assert.equal(source.currentVersion, 2);
  assert.equal(source.reviewState, 'verified');
  assert.equal(source.isCurrentVersion, false);
  assert.equal(source.contentRead, false);
  assert.equal(source.byteIntegrity, 'not-checked');
  assert.equal(source.availability, 'text-reference');
  assert.equal(context.documentContentIncluded, false);
  assert.equal(JSON.stringify(context).includes('delivery 17'), false);
  assert.equal(fixture.reads(), 0);
  assert.ok(context.gaps.some(gap => gap.code === 'HISTORICAL_VERSION'));
  assert.match(context.source.snapshotSha256, /^[a-f0-9]{64}$/u);
  const restarted = createLibraryService(new LibraryStore({ dir: fixture.dir, clock: DAY }), { attachments: fixture.attachments });
  assert.deepEqual(await restarted.productContext({ productId: product.id }), context);
  context.product.name = 'do not mutate storage';
  assert.equal((await service.product(product.id)).product.name, '麻混纺');
  assert.equal((await service.status()).sequence, sequence);
  const read = await service.readReferences([source.reference]);
  assert.equal(read.items[0].content, 'MOQ 370; delivery 17 days');
  fixture.blobs.set(document.versions[0].attachment.attachmentId, Buffer.from('corrupt'));
  await assert.rejects(() => service.readReferences([source.reference]), { code: 'REFERENCE_CHANGED' });
});

test('latest rejection overrides past approval and certificate dates are checked separately', async t => {
  const { service } = await setup(t);
  const doc = await service.addDocument({ title: '检测报告', slotKey: 'test_report', content: '合成报告',
    certificate: { expiryMode: 'dated', validUntil: '2026-10-25' } });
  // A prior legitimate approval in an earlier date remains history, not evidence of current validity.
  const state = (await service.document(doc.id)).document;
  state.reviews.push({ documentVersion: 1, sha256: doc.versions[0].sha256, decision: 'verified' });
  await service.reviewDocument(doc.id, 1, { expectedRevision: 1, decision: 'rejected', note: '已过期' });
  const product = await service.saveProduct({ name: '过期来源产品', documents: [link(doc)] });
  const result = await service.productContext({ productId: product.id });
  assert.equal(result.documents[0].reviewState, 'rejected');
  assert.equal(result.documents[0].validity, 'expired');
  assert.ok(result.gaps.some(gap => gap.code === 'DOCUMENT_REJECTED'));
  assert.ok(result.gaps.some(gap => gap.code === 'CERTIFICATE_VALIDITY'));
});

test('missing fields stay explicit; archived, binary, unreviewed and missing links remain distinct', async t => {
  const { service, store } = await setup(t);
  const archived = await service.addDocument({ title: '已归档', content: 'do not read' });
  const pdf = await service.addDocument({ title: 'PDF', fileName: 'a.pdf', data: Buffer.from('%PDF-1.4') });
  const unknown = await service.addDocument({ title: '有效期未知', slotKey: 'certificate', content: 'unknown dates' });
  const missingVersion = await service.addDocument({ title: '丢失版本', content: 'missing' });
  const missingDoc = await service.addDocument({ title: '丢失文档', content: 'missing' });
  await service.reviewDocument(archived.id, 1, { expectedRevision: 1, decision: 'verified' });
  const product = await service.saveProduct({ name: '资料有缺口', skus: [{ code: 'GAP', specs: [{ key: '材质', value: '' }], pricingMode: 'on_request' }],
    documents: [archived, pdf, unknown, missingVersion, missingDoc].map(link) });
  await service.updateDocument(archived.id, { expectedRevision: 2, changes: { status: 'archived' } });
  const state = await store.state();
  state.documents.find(doc => doc.id === missingVersion.id).versions = [];
  state.documents = state.documents.filter(doc => doc.id !== missingDoc.id);
  const result = await service.productContext({ productId: product.id });
  assert.deepEqual(result.documents.map(doc => doc.availability), ['archived', 'unsupported-format', 'text-reference', 'missing-version', 'missing-document']);
  assert.equal(result.documents[0].reviewState, 'verified');
  assert.equal(result.documents[1].reviewState, 'unreviewed');
  assert.equal(result.documents[0].reference, null);
  assert.equal(result.documents[1].reference, null);
  assert.ok(result.documents.filter(doc => doc.availability !== 'text-reference').every(doc => doc.reference === null && doc.readWith === null));
  assert.ok(result.gaps.some(gap => gap.code === 'DOCUMENT_UNREVIEWED' && gap.documentId === pdf.id && gap.version === 1));
  assert.equal(result.gaps.some(gap => gap.code === 'DOCUMENT_UNREVIEWED' && gap.documentId === archived.id), false);
  assert.equal(result.documents[2].validity, 'unknown');
  assert.ok(result.gaps.some(gap => gap.path === 'product.skus[0].moq'));
  assert.ok(result.gaps.some(gap => gap.path === 'product.skus[0].leadTimeDays'));
  assert.ok(result.gaps.some(gap => gap.path === 'product.skus[0].specs[0].value'));
  assert.ok(result.gaps.some(gap => gap.path === 'product.skus[0].pricingMode' && gap.code === 'QUOTE_REQUIRED'));
  assert.ok(result.gaps.some(gap => gap.path === 'product.supply.paymentTerms'));
  assert.ok(result.gaps.some(gap => gap.code === 'DOCUMENT_UNREVIEWED'));
  assert.equal(result.product.skus[0].moq, null);
});

test('exact revision guards, archive rejection and cancellation do not substitute another product', async t => {
  const { service, store } = await setup(t);
  const product = await service.saveProduct({ name: '固定修订' });
  const first = await service.productContext({ productId: product.id });
  await service.saveProduct({ productId: product.id, expectedRevision: 1, changes: { description: 'changed' } });
  await assert.rejects(() => service.productContext({ productId: product.id, expectedRevision: 1 }), { code: 'PRODUCT_CONTEXT_CHANGED' });
  assert.notEqual((await service.productContext({ productId: product.id })).source.snapshotSha256, first.source.snapshotSha256);
  await service.saveProduct({ productId: product.id, expectedRevision: 2, changes: { status: 'archived' } });
  await assert.rejects(() => service.productContext({ productId: product.id }), { code: 'PRODUCT_CONTEXT_ARCHIVED' });
  await assert.rejects(() => service.productContext({ productId: 'prd_00000000-0000-0000-0000-000000000000' }), { code: 'PRODUCT_CONTEXT_NOT_FOUND' });
  await assert.rejects(() => service.productContext({ productId: '../private' }), { code: 'PRODUCT_CONTEXT_INPUT' });
  await assert.rejects(() => service.productContext({ productId: product.id, expectedRevision: 0 }), { code: 'PRODUCT_CONTEXT_INPUT' });
  await assert.rejects(() => service.productContext({ productId: product.id, actor: 'admin' }), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.productContext({ productId: product.id }, { signal: AbortSignal.abort() }), { code: 'PRODUCT_CONTEXT_CANCELLED' });
  const duringRead = new AbortController(), read = store.state.bind(store);
  store.state = async () => { duringRead.abort(); return read(); };
  await assert.rejects(() => service.productContext({ productId: product.id }, { signal: duringRead.signal }), { code: 'PRODUCT_CONTEXT_CANCELLED' });
});

test('all source metadata is returned up to the bounded view; oversized output is rejected rather than truncated', async t => {
  const { service } = await setup(t);
  const docs = [];
  for (let i = 0; i < 9; i++) docs.push(await service.addDocument({ title: `文档 ${i}`, content: 'small' }));
  const product = await service.saveProduct({ name: '多来源', documents: docs.map(link) });
  const context = await service.productContext({ productId: product.id });
  assert.equal(context.documents.length, 9);
  assert.equal(context.documentReadLimits.maxReferences, 8);
  // Valid stored products can exceed the smaller model-facing view when link purposes are repeated as source metadata.
  const large = await service.saveProduct({ name: '大产品', description: 'x'.repeat(8000),
    skus: Array.from({ length: 45 }, (_, i) => ({ code: String(i), specs: [{ key: 'k', value: 'v'.repeat(500) }] })),
    documents: docs.map(doc => ({ ...link(doc), purpose: 'p'.repeat(1000) })) });
  await assert.rejects(() => service.productContext({ productId: large.id }), { code: 'PRODUCT_CONTEXT_TOO_LARGE' });
});

test('HTTP context uses the existing native authentication boundary and rejects revision drift', async t => {
  const { service } = await setup(t);
  const product = await service.saveProduct({ name: 'HTTP context' });
  const server = createServer(createHttpHandler(service, { authorize: req => req.headers.cookie === 'fixture=yes' ? undefined : 401 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}${API_PREFIX}/products/${product.id}/context`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url + '?expectedRevision=1', { headers: { cookie: 'fixture=yes' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.source.productId, product.id);
  assert.equal((await fetch(url + '?expectedRevision=2', { headers: { cookie: 'fixture=yes' } })).status, 409);
  assert.equal((await fetch(url + '?actor=admin', { headers: { cookie: 'fixture=yes' } })).status, 400);
});

test('the native context tool forwards cancellation, returns the same snapshot and unregisters on unload', async t => {
  const { service, dir } = await setup(t);
  const product = await service.saveProduct({ name: 'native context' });
  const tools = new Map(), dispose = [];
  apply({ attachments: null, tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } }, effect: fn => dispose.push(fn()), inject() {} }, { dataDir: dir });
  const tool = tools.get('workspace_library_product_context');
  const sameClockService = createLibraryService(new LibraryStore({ dir }));
  assert.deepEqual(await tool.execute({ productId: product.id }, {}), await sameClockService.productContext({ productId: product.id }));
  await assert.rejects(() => tool.execute({ productId: product.id }, { signal: AbortSignal.abort() }), { code: 'PRODUCT_CONTEXT_CANCELLED' });
  dispose.reverse().forEach(fn => fn?.());
  assert.equal(tools.has('workspace_library_product_context'), false);
});
