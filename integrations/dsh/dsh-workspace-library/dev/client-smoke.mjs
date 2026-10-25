// Development-only DOM smoke test for the client half.
//
// It mounts the real panel with React DOM in jsdom and a mocked Host surface,
// then walks products, the company tab, a document and an editor. React,
// react-dom and jsdom come from this repository's devDependencies (or the
// directory in DSH_CLIENT_TEST_MODULES); none ship with the plugin bundle.
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const here = dirname(fileURLToPath(import.meta.url));
const modules = resolve(process.env.DSH_CLIENT_TEST_MODULES || join(here, '..', '..', '..', '..', 'node_modules'));
const load = async specifier => import(pathToFileURL(join(modules, specifier)).href);

const ReactModule = await load('react/index.js');
const React = ReactModule.default ?? ReactModule;
const ReactDomClient = await load('react-dom/client.js');
const { createRoot } = ReactDomClient.default ?? ReactDomClient;
const ReactDomTestUtils = await load('react-dom/test-utils.js');
const { act } = ReactDomTestUtils.default ?? ReactDomTestUtils;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const JsdomModule = await load('jsdom/lib/api.js');
const { JSDOM } = JsdomModule.default ?? JsdomModule;

const dom = new JSDOM('<!doctype html><html><head><meta name="dsh-workspace-library-token" content="test-token"></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:59355/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = handle => clearTimeout(handle);

const company = { id: 'company', revision: 2, legalName: '示例有限公司', displayName: '示例公司', description: '做工业配件的示例企业。', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
const product = {
  id: 'prd_1',
  revision: 3,
  companyId: 'company',
  name: '示例产品',
  description: '用于冒烟测试的示例产品。',
  category: '工业配件',
  status: 'draft',
  skus: [{ id: 'sku_1', code: 'SKU-1', specs: [{ key: '材质', value: '不锈钢' }], unit: '件', moq: 10, pricingMode: 'tiered', pricingNote: '', priceTiers: [{ minQuantity: 10, unitPrice: '12.50', currency: 'CNY' }], leadTimeDays: 15 }],
  images: [{ id: 'img_1', fileName: 'main.png', mimeType: 'image/png', bytes: 68, sha256: 'b'.repeat(64), attachment: { attachmentId: `sha256:${'b'.repeat(64)}`, name: 'main.png', bytes: 68 }, alt: '主图', order: 0, isPrimary: true }],
  supply: { packaging: '纸箱', samplePolicy: '样品收费', paymentTerms: '预付 30%', shippingTerms: 'FOB 上海', capacityNote: '月产 1000 件' },
  documents: [{ documentId: 'doc_1', documentVersion: 1, purpose: '投标资质' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
};
const documentEntity = {
  id: 'doc_1',
  revision: 2,
  companyId: 'company',
  title: '示例资质证书',
  slotKey: 'certificate',
  tags: ['示例'],
  status: 'active',
  currentVersion: 1,
  versions: [{ version: 1, fileName: 'certificate.txt', content: '', mimeType: 'text/plain', bytes: 21, sha256: 'a'.repeat(64), attachment: { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'certificate.txt', bytes: 21 }, certificate: { number: 'CERT-001', issuer: '示例机构', scope: '示例范围', validFrom: '2020-01-01', validUntil: '2099-12-31', expiryMode: 'dated', expiryNote: '' }, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'local-operator' }],
  reviews: [{ id: 'rev_1', documentVersion: 1, sha256: 'a'.repeat(64), decision: 'verified', note: '示例审核', reviewedAt: '2026-01-02T00:00:00.000Z', reviewedBy: 'local-operator' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const readiness = {
  productRevision: 3,
  asOf: '2026-01-03T00:00:00.000Z',
  overall: 'ready_for_review',
  checks: [
    { key: 'name', fieldPath: 'name', label: '产品名称', status: 'verified', message: '已填写产品名称。' },
    { key: 'document-doc_1', fieldPath: 'documents', label: '资料：示例资质证书', status: 'verified', message: 'v1 已人工审核通过。' },
  ],
};
const productSummary = { ...product, description: product.description, skuCount: 1, documentCount: 1, readiness: 'ready_for_review' };
const documentSummary = { ...documentEntity, slotLabel: '资质证书', versionCount: 1, reviewState: 'verified', hasContent: true };
delete productSummary.skus;
delete productSummary.supply;
delete productSummary.documents;
productSummary.primaryImageId = 'img_1';
productSummary.imageCount = 1;

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(String(url), 'http://127.0.0.1:59355').pathname;
  calls.push({ path, method: init.method || 'GET' });
  const json = data => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path === '/workspace-library-api/state') {
    return json({ version: 1, sequence: 4, updatedAt: '2026-01-03T00:00:00.000Z', dataFile: 'C:/tmp/library.json', company: { revision: 2, name: '示例公司' }, counts: { products: 1, documents: 1, documentsBySlot: { certificate: 1 } } });
  }
  if (path === '/workspace-library-api/company') return json(company);
  if (path === '/workspace-library-api/products') return json({ items: [productSummary], total: 1, sequence: 4 });
  if (path === '/workspace-library-api/documents') return json({ items: [documentSummary], total: 1, slotCounts: { certificate: 1 }, sequence: 4 });
  if (path === '/workspace-library-api/products/prd_1') return json({ product, readiness });
  if (path === '/workspace-library-api/products/prd_1/images/img_1') return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  if (path === '/workspace-library-api/documents/doc_1') return json({ document: documentEntity, reviewState: 'verified' });
  return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: `unmocked ${path}` } }), { status: 404 });
};

let exportsModule = null;
globalThis.window.__ModuleLoader__ = {
  load({ factory }) {
    exportsModule = factory(name => {
      if (name === 'react') return React;
      throw new Error(`unexpected require: ${name}`);
    });
  },
};

await import(pathToFileURL(join(here, '..', 'client.js')).href);
if (!exportsModule) throw new Error('client module did not register');

const registrations = new Map();
const ctx = {
  inputTriggers: { registerSource() { return () => {}; } },
  effect(callback) {
    return callback();
  },
  locale: {
    register() {
      return () => {};
    },
    bind() {
      return key => key;
    },
  },
  slots: {
    inject(_owner, callback) {
      callback();
      return () => {};
    },
    register(options, component) {
      registrations.set(options.name === 'main' ? `main:${options.key}` : `${options.name}:${options.id}`, component);
      return () => {};
    },
  },
};
exportsModule.apply(ctx);
if (!registrations.has('main:workspace-library') || !registrations.has('sidebar.panellist:workspace-library')) {
  throw new Error(`missing registrations: ${[...registrations.keys()].join(', ')}`);
}

const Panel = registrations.get('main:workspace-library');
const container = document.getElementById('root');
const root = createRoot(container);
const settle = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};
const fail = message => {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('style').forEach(element => element.remove());
  console.error(clone.textContent.slice(0, 2000));
  console.error(calls);
  throw new Error(message);
};
const click = element => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const findByText = (selector, text) => [...container.querySelectorAll(selector)].find(element => element.textContent.includes(text));

root.render(React.createElement(Panel, { t: key => key }));
await settle();
if (!container.textContent.includes('示例产品')) fail('product list did not render');
if (!container.textContent.includes('tab.products')) fail('library tabs missing');
click(findByText('button.wl-row', '示例产品'));
await settle();
if (!container.textContent.includes('SKU-1')) fail('product detail missing SKU');
if (!container.textContent.includes('12.50')) fail('product detail missing price tier');
if (!container.querySelector('.wl-image') && !container.textContent.includes('main.png')) fail('product image gallery missing');
if (!container.textContent.includes('readiness.checks') && !container.textContent.includes('check.verified')) fail('readiness list missing');
if (!container.textContent.includes('示例资质证书')) fail('pinned document title missing');

const edit = findByText('button.wl-btn', 'action.edit');
if (!edit) fail('edit button missing');
click(edit);
await settle();
if (!container.querySelector('form')) fail('product editor form missing');
if (!container.querySelector('input[value="示例产品"]')) fail('editor did not prefill the product name');

click(findByText('button', 'action.cancel'));
await settle();
const backToLibrary = container.querySelector('button.wl-back');
if (!backToLibrary) fail('product back link missing');
click(backToLibrary);
await settle();
click([...container.querySelectorAll('button[role="tab"]')].find(button => button.textContent.includes('tab.company')));
await settle();
if (!container.querySelector('input[value="示例公司"]')) fail('company profile form missing');
if (!container.textContent.includes('示例资质证书')) fail('document list missing');
click(findByText('button.wl-row', '示例资质证书'));
await settle();
if (!container.textContent.includes('document.versions')) fail('document detail missing versions');
if (!container.textContent.includes('CERT-001')) fail('document certificate missing');
if (!container.textContent.includes('document.verify')) fail('review actions missing');
if (!container.textContent.includes('certificate.txt')) fail('document file name missing');
if (!container.textContent.includes('document.download')) fail('document download action missing');

const editInfo = findByText('button.wl-btn', 'document.editInfo');
if (!editInfo) fail('document info action missing');
click(editInfo);
await settle();
if (!container.textContent.includes('metadata.title')) fail('document metadata editor missing');
click(findByText('button.wl-btn', 'action.cancel'));
await settle();
if (!container.textContent.includes('document.versions')) fail('document detail did not return from metadata editor');

root.unmount();
dom.window.close();
console.log(`OK: client panel mounted and navigated; ${calls.length} mocked requests`);
