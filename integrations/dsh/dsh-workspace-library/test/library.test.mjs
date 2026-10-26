import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LibraryStore,
  createLibraryService,
  createHttpHandler,
  readinessOf,
  API_PREFIX,
  MAX_FILE_BYTES,
} from '../index.js';

/** Minimal content-addressed stand-in for the Host attachments service. */
function createFakeAttachments() {
  const objects = new Map();
  return {
    objects,
    async saveFile({ data, name }) {
      const sha = createHash('sha256').update(data).digest('hex');
      const ref = { attachmentId: `sha256:${sha}`, name: name || 'file', bytes: data.byteLength };
      objects.set(ref.attachmentId, Buffer.from(data));
      return ref;
    },
    async *readFileStream(ref) {
      const bytes = objects.get(String(ref.attachmentId));
      if (!bytes) throw new Error('attachment missing');
      yield bytes;
    },
  };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function withStore(run, { clock, attachments } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-library-test-'));
  try {
    const store = new LibraryStore({ dir, ...(clock ? { clock } : {}) });
    await run(createLibraryService(store, { attachments }), store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const completeProduct = {
  name: '示例产品',
  description: '用于验证资料库行为的示例条目。',
  category: '工业配件',
  status: 'draft',
  skus: [
    {
      code: 'SKU-1',
      unit: '件',
      moq: 10,
      pricingMode: 'tiered',
      priceTiers: [{ minQuantity: 10, unitPrice: '12.50', currency: 'CNY' }],
      leadTimeDays: 15,
      specs: [{ key: '材质', value: '不锈钢' }],
    },
  ],
  supply: {
    packaging: '纸箱',
    samplePolicy: '样品收费',
    paymentTerms: '预付 30%',
    shippingTerms: 'FOB 上海',
    capacityNote: '月产 1000 件',
  },
};

const certificateDocument = {
  title: '示例资质证书',
  slotKey: 'certificate',
  tags: ['示例'],
  fileName: 'certificate.txt',
  content: '证书正文：示例内容，用于验证版本与审核。',
  certificate: {
    number: 'CERT-001',
    issuer: '示例机构',
    scope: '示例范围',
    validFrom: '2020-01-01',
    validUntil: '2099-12-31',
    expiryMode: 'dated',
  },
};

test('empty state is readable and reports counts', async () => {
  await withStore(async service => {
    const status = await service.status();
    assert.equal(status.counts.products, 0);
    assert.equal(status.counts.documents, 0);
    assert.equal(status.company.name, '');
    assert.equal(status.sequence, 0);
    assert.match(status.dataFile, /library\.json$/u);
  });
});

test('company save bumps revision and refuses a stale revision', async () => {
  await withStore(async service => {
    const saved = await service.saveCompany({ expectedRevision: 1, changes: { legalName: '示例有限公司', displayName: '示例公司' } });
    assert.equal(saved.revision, 2);
    assert.equal((await service.company()).legalName, '示例有限公司');
    await assert.rejects(
      () => service.saveCompany({ expectedRevision: 1, changes: { displayName: '过期写入' } }),
      error => error.code === 'REVISION_CONFLICT' && error.status === 409,
    );
  });
});

test('product save, readiness progression and search', async () => {
  await withStore(async service => {
    await service.saveCompany({ expectedRevision: 1, changes: { displayName: '示例公司' } });
    const created = await service.saveProduct({ changes: completeProduct });
    assert.match(created.id, /^prd_/u);
    assert.equal(created.revision, 1);

    const first = await service.product(created.id);
    assert.equal(first.readiness.overall, 'incomplete');
    assert.equal(first.readiness.checks.find(check => check.key === 'documents').status, 'missing');

    const document = await service.addDocument(certificateDocument);
    await service.reviewDocument(document.id, 1, { expectedRevision: 1, decision: 'verified', note: '示例审核' });

    const updated = await service.saveProduct({
      productId: created.id,
      expectedRevision: 1,
      changes: { documents: [{ documentId: document.id, documentVersion: 1, purpose: '投标资质' }] },
    });
    assert.equal(updated.revision, 2);
    const ready = await service.product(created.id);
    assert.equal(ready.readiness.overall, 'ready_for_review', JSON.stringify(ready.readiness.checks, null, 2));

    const listed = await service.products({ q: '示例' });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].readiness, 'ready_for_review');

    const hits = await service.search('示例');
    assert.ok(hits.hits.some(hit => hit.type === 'document' && hit.id === document.id));
    assert.ok(hits.hits.some(hit => hit.type === 'product' && hit.id === created.id));
  });
});

test('a new document version resets readiness and keeps the old pin', async () => {
  await withStore(async service => {
    await service.saveCompany({ expectedRevision: 1, changes: { displayName: '示例公司' } });
    const document = await service.addDocument(certificateDocument);
    await service.reviewDocument(document.id, 1, { expectedRevision: 1, decision: 'verified' });
    const product = await service.saveProduct({
      changes: { ...completeProduct, documents: [{ documentId: document.id, documentVersion: 1, purpose: '资质' }] },
    });
    const versioned = await service.addDocumentVersion(document.id, { fileName: 'v2.txt', content: '第二版正文', certificate: certificateDocument.certificate });
    assert.equal(versioned.currentVersion, 2);

    const detail = await service.document(document.id);
    assert.equal(detail.reviewState, 'unreviewed');

    const current = await service.product(product.id);
    assert.equal(current.product.documents[0].documentVersion, 1);
    assert.ok(current.readiness.checks.some(check => check.key === `document-${document.id}-stale`));
    assert.notEqual(current.readiness.overall, 'ready_for_review');
  });
});

test('unsafe certificate verification is refused', async () => {
  await withStore(async service => {
    const document = await service.addDocument({
      ...certificateDocument,
      certificate: { number: 'X', expiryMode: 'unknown' },
    });
    await assert.rejects(
      () => service.reviewDocument(document.id, 1, { expectedRevision: 1, decision: 'verified' }),
      error => error.code === 'INVALID_INPUT',
    );
    const rejected = await service.reviewDocument(document.id, 1, { expectedRevision: 1, decision: 'rejected', note: '有效期未知' });
    assert.equal(rejected.reviews.at(-1).decision, 'rejected');
  });
});

test('state persists across store instances and is human-readable JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-library-test-'));
  try {
    const first = createLibraryService(new LibraryStore({ dir }));
    await first.saveCompany({ expectedRevision: 1, changes: { displayName: '持久化公司' } });
    const second = createLibraryService(new LibraryStore({ dir }));
    assert.equal((await second.company()).displayName, '持久化公司');
    const raw = JSON.parse(await readFile(join(dir, 'library.json'), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.company.displayName, '持久化公司');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a document version stores a real file and streams it back', async () => {
  const attachments = createFakeAttachments();
  const body = Buffer.from('%PDF-1.4\n示例文件内容');
  await withStore(async service => {
    const document = await service.addDocument({
      title: '示例检测报告',
      slotKey: 'test_report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      data: body,
    });
    const version = document.versions[0];
    assert.equal(version.mimeType, 'application/pdf');
    assert.equal(version.bytes, body.byteLength);
    assert.equal(version.content, '');
    assert.match(version.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(version.attachment.name, 'report.pdf');

    const file = await service.documentFile(document.id, 1);
    const chunks = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString('utf8'), body.toString('utf8'));
    assert.equal(file.mimeType, 'application/pdf');
    await assert.rejects(() => service.documentFile(document.id, 2), error => error.code === 'NOT_FOUND');
  }, { attachments });
});

test('product images upload, reorder and remove with revision checks', async () => {
  const attachments = createFakeAttachments();
  await withStore(async service => {
    const product = await service.saveProduct({ changes: completeProduct });
    const added = await service.addProductImage(product.id, {
      expectedRevision: 1,
      fileName: 'main.png',
      mimeType: 'image/png',
      data: PNG,
      alt: '主图',
      isPrimary: true,
    });
    assert.equal(added.revision, 2);
    assert.equal(added.images.length, 1);
    assert.equal(added.images[0].isPrimary, true);

    const second = await service.addProductImage(product.id, {
      expectedRevision: 2,
      fileName: 'second.png',
      mimeType: 'image/png',
      data: PNG,
      alt: '细节图',
    });
    assert.equal(second.images.length, 2);
    assert.equal(second.images[1].isPrimary, false);
    const [first, other] = second.images;

    const promoted = await service.updateProductImage(product.id, other.id, {
      expectedRevision: 3,
      isPrimary: true,
      order: 0,
    });
    assert.equal(promoted.revision, 4);
    assert.equal(promoted.images[0].id, other.id);
    assert.equal(promoted.images[0].isPrimary, true);
    assert.equal(promoted.images.find(image => image.id === first.id).isPrimary, false);

    const removed = await service.removeProductImage(product.id, other.id, { expectedRevision: 4 });
    assert.equal(removed.images.length, 1);
    assert.equal(removed.images[0].id, first.id);
    assert.equal(removed.images[0].isPrimary, true);

    await assert.rejects(
      () => service.addProductImage(product.id, { expectedRevision: 1, fileName: 'x.png', mimeType: 'image/png', data: PNG }),
      error => error.code === 'REVISION_CONFLICT',
    );
    await assert.rejects(
      () => service.addProductImage(product.id, { expectedRevision: 5, fileName: 'x.png', mimeType: 'image/png', data: Buffer.from('not a png') }),
      error => error.code === 'INVALID_INPUT',
    );

    const imageFile = await service.productImageFile(product.id, first.id);
    const chunks = [];
    for await (const chunk of imageFile.stream) chunks.push(Buffer.from(chunk));
    assert.equal(imageFile.mimeType, 'image/png');
    assert.equal(Buffer.concat(chunks).equals(PNG), true);
  }, { attachments });
});

test('file versions require attachment storage and honour the size limit', async () => {
  await withStore(async service => {
    await assert.rejects(
      () => service.addDocument({ title: '无附件服务', slotKey: 'other', fileName: 'a.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF') }),
      error => error.code === 'ATTACHMENT_UNAVAILABLE',
    );
  });
  await withStore(async service => {
    await assert.rejects(
      () => service.addDocument({ title: '太大', slotKey: 'other', fileName: 'a.pdf', data: Buffer.alloc(MAX_FILE_BYTES + 1) }),
      error => error.code === 'FILE_TOO_LARGE',
    );
  }, { attachments: createFakeAttachments() });
});

test('connection authorization rejections surface as 403', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-library-test-'));
  const service = createLibraryService(new LibraryStore({ dir }));
  const server = createServer(createHttpHandler(service, { authorize: () => 403 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}${API_PREFIX}`;
  try {
    const response = await fetch(`${base}/state`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'ORIGIN_DENIED');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('http surface serves JSON, uploaded files and images behind browser authentication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-library-test-'));
  const attachments = createFakeAttachments();
  const service = createLibraryService(new LibraryStore({ dir }), { attachments });
  const authorize = request => {
    if (request.headers['x-test-session'] !== 'ok') return 401;
    if (request.headers['x-test-cross'] === '1') return 403;
    return undefined;
  };
  const server = createServer(createHttpHandler(service, { authorize }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}${API_PREFIX}`;
  const auth = { 'x-test-session': 'ok' };
  try {
    const unauthenticated = await fetch(`${base}/state`);
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).error.code, 'UNAUTHORIZED');

    const status = await fetch(`${base}/state`, { headers: auth }).then(response => response.json());
    assert.equal(status.ok, true);
    assert.equal(status.data.attachments, true);
    assert.equal(status.data.counts.products, 0);

    const created = await fetch(`${base}/products`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(completeProduct),
    });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.equal(payload.data.name, '示例产品');

    const read = await fetch(`${base}/products/${payload.data.id}`, { headers: auth }).then(response => response.json());
    assert.equal(read.data.product.revision, 1);
    assert.equal(read.data.readiness.overall, 'incomplete');

    const imageUpload = await fetch(`${base}/products/${payload.data.id}/images`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, fileName: 'pic.png', mimeType: 'image/png', dataBase64: PNG.toString('base64'), alt: '主图' }),
    });
    assert.equal(imageUpload.status, 201);
    const imageBody = await imageUpload.json();
    assert.equal(imageBody.data.product.revision, 2);
    const imageId = imageBody.data.product.images[0].id;
    assert.equal(imageBody.data.product.images[0].isPrimary, true);

    const imageResponse = await fetch(`${base}/products/${payload.data.id}/images/${imageId}`, { headers: auth });
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.match(imageResponse.headers.get('content-disposition') || '', /^inline;/u);
    assert.equal(Buffer.from(await imageResponse.arrayBuffer()).equals(PNG), true);

    const fileUpload = await fetch(`${base}/documents`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '带文件资料',
        slotKey: 'other',
        fileName: 'note.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('hello file').toString('base64'),
      }),
    });
    assert.equal(fileUpload.status, 201);
    const fileBody = await fileUpload.json();
    const fileUrl = `${base}/documents/${fileBody.data.id}/versions/1/file`;
    const fileResponse = await fetch(fileUrl, { headers: auth });
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get('content-type'), 'text/plain');
    assert.match(fileResponse.headers.get('content-disposition') || '', /^attachment;/u);
    assert.equal(await fileResponse.text(), 'hello file');
    assert.equal((await fetch(fileUrl)).status, 401);

    const crossOrigin = await fetch(`${base}/products`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', origin: 'https://example.invalid' },
      body: JSON.stringify(completeProduct),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error.code, 'ORIGIN_DENIED');

    const wrongType = await fetch(`${base}/products`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal(wrongType.status, 415);

    const badBase64 = await fetch(`${base}/documents`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '坏文件', slotKey: 'other', fileName: 'x.bin', dataBase64: '!!!' }),
    });
    assert.equal(badBase64.status, 400);
    assert.equal((await badBase64.json()).error.code, 'INVALID_INPUT');

    const unknown = await fetch(`${base}/nope`, { headers: auth });
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('admin product and file indexes paginate after filtering with stable full-result sorting', async () => {
  await withStore(async service => {
    for (const name of ['Zeta', 'Alpha', 'Beta', 'Outside']) {
      await service.saveProduct({ changes: { name, category: name === 'Outside' ? 'other' : 'matching' } });
      await service.addDocument({ title: name, slotKey: 'other', fileName: `${name}.txt`, content: name === 'Outside' ? 'Other content' : 'Matching content' });
    }
    const products = await service.products({ q: 'matching', sort: 'name_asc', limit: 2 });
    assert.deepEqual(products.items.map(p => p.name), ['Alpha', 'Beta']); assert.equal(products.matched, 3); assert.equal(products.total, 4); assert.equal(products.nextOffset, 2);
    const next = await service.products({ q: 'matching', sort: 'name_asc', limit: 2, offset: products.nextOffset });
    assert.deepEqual(next.items.map(p => p.name), ['Zeta']); assert.equal(next.hasMore, false);
    const documents = await service.documents({ q: 'Matching', sort: 'name_desc', limit: 1, offset: '1' });
    assert.equal(documents.items[0].title, 'Beta'); assert.equal(documents.matched, 3); assert.equal(documents.total, 4);
    assert.equal((await service.products({ offset: 100 })).items.length, 0);
    await assert.rejects(service.products({ offset: -1 }), { code: 'INVALID_INPUT' });
    await assert.rejects(service.documents({ offset: '1.5' }), { code: 'INVALID_INPUT' });
    await assert.rejects(service.products({ sort: 'unknown' }), { code: 'INVALID_INPUT' });
  });
});
