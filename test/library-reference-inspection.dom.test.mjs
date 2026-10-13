import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { originalHttp, bundleRenderer, wait, button, click } from './fixtures/conversation-ui.mjs';

// Current production bundle, original loopback HTTP/Store and synthetic files.
// The missing-version case explicitly truncates a real response DTO; no model,
// native account, external sharing or production acceptance is represented.
async function fixture(t) {
  const http = await originalHttp(t), renderer = await bundleRenderer(t, http.transport);
  return { ...renderer, request: (path, method, body) => http.request('/api' + path, method, body), get modelCalls() { return http.modelCalls; } };
}
const conversation = async (f, title) => (await f.request('/conversations', 'POST', { title })).conversation;

test('selected Library references inspect their fixed document version and distinguish current product facts without rebinding', async t => {
  const f = await fixture(t), current = await conversation(f, 'Pinned inspection fixture');
  const product = (await f.request('/library/products', 'POST', { requestId: randomUUID(), name: 'Pinned Product', description: 'PRIVATE_PRODUCT_R1' })).product;
  const first = (await f.request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'pinned-v1.md', content: 'PRIVATE_DOCUMENT_V1' })).artifact;
  const document = (await f.request('/library/documents', 'POST', { requestId: randomUUID(), title: 'Pinned Document', asset: { artifactId: first.id, version: 1, sha256: first.sha256 } })).document;
  const references = { products: [{ productId: product.id, productRevision: 1 }], documents: [{ documentId: document.id, documentVersion: 1 }] };
  await f.request(`/conversations/${current.id}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references });
  await f.request(`/library/products/${product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, changes: { description: 'PRIVATE_PRODUCT_R2' } });
  const second = (await f.request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'pinned-v2.md', content: 'PRIVATE_DOCUMENT_V2' })).artifact;
  await f.request(`/library/documents/${document.id}/versions`, 'POST', { requestId: randomUUID(), expectedRevision: 1, asset: { artifactId: second.id, version: 1, sha256: second.sha256 } });
  const ui = await f.render(`/chat/${current.id}`), selected = title => [...ui.document.querySelectorAll('.bl-selected-reference')].find(row => row.querySelector('strong')?.textContent === title);
  await wait(() => button(ui, '会话资料 · 1 个产品 / 1 份文件'), 'current reference summary');
  await click(ui, button(ui, '会话资料 · 1 个产品 / 1 份文件')); await wait(() => selected(document.title), 'fixed document selection');
  await click(ui, selected(document.title).querySelector('button')); await wait(() => ui.document.querySelector('.bl-picker-detail pre')?.textContent === 'PRIVATE_DOCUMENT_V1', 'inspection reads selected v1 rather than current v2');
  assert.equal(ui.document.querySelector('select[aria-label="会话固定资料版本"]').value, '1');
  assert.equal(ui.document.querySelector('.bl-picker-detail .bl-download').getAttribute('href'), `/api/artifacts/${first.id}/download?version=1`);
  assert.equal(await (await ui.window.fetch(ui.document.querySelector('.bl-picker-detail .bl-download').getAttribute('href'))).text(), 'PRIVATE_DOCUMENT_V1');
  await click(ui, button(ui, '返回选择列表')); await wait(() => selected(product.name), 'original product reference');
  await click(ui, selected(product.name).querySelector('button')); await wait(() => button(ui, '选择此产品修订 2'), 'current actual product loaded');
  assert.match(ui.document.querySelector('.bl-picker-detail [role="status"]').textContent, /当前展示产品修订 2；会话仍引用修订 1。重新选择才会更新引用/);
  assert.match(ui.document.querySelector('.bl-picker-detail').textContent, /PRIVATE_PRODUCT_R2/);
  assert.equal(button(ui, '保存关联并返回会话').disabled, true, 'inspection alone does not rebind');
  assert.deepEqual((await f.request(`/conversations/${current.id}/library-references`)).libraryReferences.products, references.products);
  assert.deepEqual((await f.request(`/conversations/${current.id}/library-references`)).libraryReferences.documents, references.documents);
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0);
  await click(ui, button(ui, '选择此产品修订 2')); await wait(() => !button(ui, '保存关联并返回会话').disabled, 'only explicit current-revision selection enables a change');
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0, 'selection still requires an explicit save');
  await click(ui, button(ui, '保存关联并返回会话')); await wait(() => !ui.document.querySelector('.bl-picker'), 'explicit product revision update saved');
  const changed = (await f.request(`/conversations/${current.id}/library-references`)).libraryReferences;
  assert.deepEqual(changed.products, [{ productId: product.id, productRevision: 2 }]); assert.deepEqual(changed.documents, references.documents);
  const writes = f.requests.filter(item => item.method !== 'GET'); assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PATCH'); assert.equal(writes[0].body.expectedRevision, 1);
  assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
});

test('missing fixed document version stays explicit and cannot silently fall back or be selected', async t => {
  const f = await fixture(t), current = await conversation(f, 'Missing fixed version fixture');
  const first = (await f.request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'original-v1.md', content: 'ORIGINAL_V1' })).artifact;
  const document = (await f.request('/library/documents', 'POST', { requestId: randomUUID(), title: 'Exact Document', asset: { artifactId: first.id, version: 1, sha256: first.sha256 } })).document;
  await f.request(`/conversations/${current.id}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references: { products: [], documents: [{ documentId: document.id, documentVersion: 1 }] } });
  const second = (await f.request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'current-v2.md', content: 'CURRENT_V2' })).artifact;
  await f.request(`/library/documents/${document.id}/versions`, 'POST', { requestId: randomUUID(), expectedRevision: 1, asset: { artifactId: second.id, version: 1, sha256: second.sha256 } });
  const ui = await f.render(`/chat/${current.id}`), originalFetch = ui.window.fetch;
  // Explicit transport fault: remove v1 only from the real original HTTP DTO.
  // The original file/store is intact; unavailable references must remain visible.
  ui.window.fetch = async (path, options) => { const response = await originalFetch(path, options); if (path !== `/api/library/documents/${document.id}`) return response; const result = await response.json(); return new Response(JSON.stringify({ ...result, document: { ...result.document, versions: result.document.versions.filter(item => item.version !== 1) } }), { headers: { 'Content-Type': 'application/json' } }); };
  await wait(() => button(ui, '会话资料 · 0 个产品 / 1 份文件'), 'fixed reference readable');
  await click(ui, button(ui, '会话资料 · 0 个产品 / 1 份文件')); await wait(() => ui.document.querySelector('.bl-selected-reference'), 'selected missing version');
  await click(ui, ui.document.querySelector('.bl-selected-reference button')); await wait(() => ui.document.querySelector('.bl-picker-detail [role="alert"]'), 'missing fixed version exposed');
  assert.equal(ui.document.querySelector('select[aria-label="会话固定资料版本"]').value, '1');
  assert.match(ui.document.querySelector('.bl-picker-detail [role="alert"]').textContent, /固定资料版本 v1 已不可读取，未切换到其他版本/);
  assert.equal(button(ui, '选择此资料版本 v1').disabled, true); assert.equal(ui.document.querySelector('.bl-picker-detail pre'), null); assert.equal(ui.document.querySelector('.bl-picker-detail .bl-download'), null);
  assert.equal(button(ui, '保存关联并返回会话').disabled, true);
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
});

