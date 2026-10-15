// Thin source/ownership mapping into original Library, supplier publication and
// capabilities. No model transport, execution registry, connector or scheduler.
import { ApiError } from './runtime.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { supplierOwned, supplierFind, assertSupplierProductSource } from './supplier-draft.mjs';
import { looksLikeCredential } from './security.mjs';
import { SHOPIFY_PRODUCT_PLUGIN as plugin, validateShopifyProductInput } from '../packages/workspace-shopify-product/src/contracts.mjs';
const fail = (status, code) => { throw new ApiError(status, code, 'Use the original authorized product, image, Run and human-approved operation.'); };
const clone = structuredClone;
const acquisition = Object.freeze({ startedAt: null, launchEvidence: false });
export function createShopifyProductClient({ materialsClient, store, artifacts, supplierService, supplierPublication, shopify, identity, conversationId, runId = null, authorize, canSave, assertCurrent } = {}) {
  if (!materialsClient || !store || !artifacts || !supplierService || !supplierPublication || !shopify || typeof authorize !== 'function' || typeof canSave !== 'function' || typeof assertCurrent !== 'function')
    throw TypeError('Inject original Host services and live guards.');
  function assertLive() {
    const checked = assertCurrent();
    if (checked === false || checked && typeof checked.then === 'function') { checked?.catch?.(() => {}); fail(403, 'SHOPIFY_PRODUCT_SOURCE_CHANGED'); }
  }
  function writeFence(state, signal) {
    signal?.throwIfAborted(); assertLive(); supplierOwned(state, identity, conversationId);
    if (canSave(state) !== true) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
  }
  async function guard(signal, model, writing = false) {
    signal?.throwIfAborted(); assertLive(); supplierOwned(store.read(), identity, conversationId); await authorize(signal, model); signal?.throwIfAborted(); assertLive();
    if (writing && canSave(store.read()) !== true) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
  }
  async function selected(productId, signal, model) {
    await guard(signal, model);
    const material = await materialsClient.materials({ productId }, signal, model);
    if (material.status !== 'available' || material.products?.length !== 1 || material.products[0].id !== productId || material.sources?.length !== 1
      || material.authorization?.workspaceId !== identity.workspaceId || material.authorization?.subject !== identity.subject) fail(403, 'SHOPIFY_PRODUCT_SOURCE_CHANGED');
    const product = material.products[0];
    if (!Array.isArray(product.images)) fail(403, 'SHOPIFY_PRODUCT_IMAGES_NOT_SELECTED');
    await guard(signal, model);
    return { material, product, sourceHash: libraryReadHash({ product, sources: material.sources, authorization: material.authorization }) };
  }
  async function bytes(ctx, imageId, signal, model) {
    const image = ctx.product.images.find(i => i.id === imageId);
    if (!image) fail(403, 'SHOPIFY_PRODUCT_IMAGE_NOT_SELECTED');
    const file = await artifacts.download(image.asset.artifactId, { version: image.asset.version });
    if (file.version.sha256 !== image.asset.sha256 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType)) fail(409, 'SHOPIFY_PRODUCT_SOURCE_CHANGED');
    await guard(signal, model); return { image, file };
  }
  const result = (method, input, ctx, status, view) => ({ plugin, method, input: clone(input), status, sourceHash: ctx?.sourceHash ?? null,
    authorization: clone(ctx?.material.authorization ?? null), sources: clone(ctx?.material.sources ?? []), view: clone(view), acquisition: clone(acquisition) });
  async function status(input, signal, model) {
    validateShopifyProductInput('status', input); await guard(signal, model);
    const material = await materialsClient.status(signal, model);
    if (material.status !== 'available') return { plugin, status: 'unconfigured', reason: 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED', sources: [] };
    return result('status', input, { material }, shopify.status().configured ? 'available' : 'unconfigured',
      { shopify: shopify.status(), publication: supplierPublication.status(), libraryFields: material.fields, humanReviewRequired: true });
  }
  async function read(input, signal, model) { validateShopifyProductInput('read', input); const ctx = await selected(input.productId, signal, model); return result('read', input, ctx, 'available', { product: ctx.product }); }
  async function image(input, signal, model) {
    validateShopifyProductInput('image', input); const ctx = await selected(input.productId, signal, model), { file, image: ref } = await bytes(ctx, input.imageId, signal, model);
    if (file.bytes.length > 900000) fail(409, 'SHOPIFY_PRODUCT_IMAGE_TOO_LARGE');
    return { ...result('image', input, ctx, 'available', { image: ref, mimeType: file.mimeType }), nativeContent: [{ type: 'image', data: file.bytes.toString('base64'), mimeType: file.mimeType }] };
  }
  async function readiness(input, signal, model) {
    validateShopifyProductInput('readiness', input); const ctx = await selected(input.productId, signal, model), images = [];
    for (const ref of ctx.product.images) {
      try { const { file } = await bytes(ctx, ref.id, signal, model); images.push({ imageId: ref.id, available: file.bytes.length <= 20000000 }); }
      catch (error) { if (signal?.aborted || [401, 403].includes(error.status)) throw error; images.push({ imageId: ref.id, available: false }); }
    }
    const shop = shopify.status(), publication = supplierPublication.status();
    return result('readiness', input, ctx, shop.configured ? 'available' : 'unconfigured', { shopify: shop, publication, images,
      sourceReady: images.some(i => i.available), shopReadVerified: shop.readiness?.readConfirmed === true,
      uploadReady: images.some(i => i.available) && publication.configured === true && publication.enabled === true && publication.connectorStatus === 'ready'
        && shop.readiness?.readConfirmed === true && shop.scopes.includes('write_products'), humanReviewRequired: true, verifiedWrite: false });
  }
  async function bound(serviceId, signal, model) {
    await guard(signal, model); const row = supplierFind(store.read(), identity, conversationId, serviceId);
    if (!row.productSource) fail(403, 'SHOPIFY_PRODUCT_SOURCE_CHANGED');
    const ctx = await selected(row.productSource.productId, signal, model);
    if (ctx.sourceHash !== row.productSource.sourceHash) fail(409, 'SHOPIFY_PRODUCT_SOURCE_CHANGED');
    assertSupplierProductSource(store.read(), row); return { row, ctx };
  }
  async function resultRead(input, signal, model) {
    validateShopifyProductInput('result', input); const { row, ctx } = await bound(input.serviceId, signal, model);
    const view = supplierPublication.forActor(identity).publication(conversationId, row.id).publication;
    // Original operation scopes contain only the already proposed public preview.
    return result('result', input, ctx, ['uncertain', 'partial', 'failed', 'blocked', 'cancelled'].includes(view.latest?.status) ? view.latest.status : 'available', { serviceId: row.id, revision: row.revision, preview: row.preview, publication: view,
      humanReviewRequired: true, productCreatedOrPublished: view.latest?.receipt?.found === true, acquisitionStarted: false });
  }
  async function propose(input, signal, model) {
    const data = validateShopifyProductInput('propose', input); await guard(signal, model, true);
    if (looksLikeCredential(JSON.stringify(data))) fail(400, 'RAW_CREDENTIAL_REJECTED');
    const ctx = await selected(data.productId, signal, model);
    if (ctx.sourceHash !== data.sourceHash) fail(409, 'SHOPIFY_PRODUCT_SOURCE_CHANGED');
    const images = [];
    for (const id of data.draft.imageIds) { const { image: ref } = await bytes(ctx, id, signal, model); images.push(ref); }
    const { title, imageIds, ...terms } = data.draft;
    const facts = { ...terms, name: title, images: images.map(ref => ({ kind: 'artifact', asset: ref.asset, sourceNote: `Original Library image ${ref.id}; unreviewed publication proposal` })) };
    const source = { productId: data.productId, revision: ctx.product.revision, sourceHash: ctx.sourceHash, images: clone(images) };
    const saved = await supplierService.proposeProduct({ actor: identity, conversationId, runId, requestId: data.requestId, facts, source }, {
      assertCurrent(state) {
        writeFence(state, signal);
        assertSupplierProductSource(state, { productSource: source });
      },
    });
    await guard(signal, model); return resultRead({ serviceId: saved.serviceId }, signal, model);
  }
  async function review(input, signal, model) {
    const data = validateShopifyProductInput('review', input); await guard(signal, model, true);
    const { row } = await bound(data.serviceId, signal, model);
    const proposal = await supplierPublication.forActor(identity, { signal, assertCurrent: state => writeFence(state, signal) }).reviewPublication(conversationId, row.id, {
      requestId: data.requestId, action: data.action, expectedRevision: row.revision, expectedPreviewHash: row.preview.previewHash,
      ...(data.publicationId ? { publicationId: data.publicationId } : {}), confirmed: true,
    });
    if (!proposal.operation) fail(409, proposal.error?.code || 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED');
    // confirmed above admits only the displayed proposal. Actual human decision
    // and original one-use approval consumption remain in the original service.
    await guard(signal, model); return resultRead({ serviceId: row.id }, signal, model);
  }
  async function action(method, input, signal, model) {
    const data = validateShopifyProductInput(method, input); await guard(signal, model, true);
    await bound(data.serviceId, signal, model);
    await supplierPublication.forActor(identity, { signal, assertCurrent: state => writeFence(state, signal) })[method === 'execute' ? 'executePublication' : 'reconcilePublication'](conversationId, data.serviceId,
      { requestId: data.requestId, operationId: data.operationId, expectedScopeHash: data.expectedScopeHash, confirmed: true });
    await guard(signal, model); return resultRead({ serviceId: data.serviceId }, signal, model);
  }
  const methods = { status, read, image, readiness, propose, review, execute: (...args) => action('execute', ...args), reconcile: (...args) => action('reconcile', ...args), result: resultRead };
  async function refresh(receipt, model, signal, nativeContent = []) {
    if (receipt?.plugin !== plugin || !['status', 'read', 'image', 'readiness', 'result'].includes(receipt.method)
      || Object.keys(receipt).some(k => !['plugin', 'method', 'input', 'status', 'sourceHash', 'authorization', 'sources', 'view', 'acquisition'].includes(k))) fail(403, 'SHOPIFY_PRODUCT_CACHE_REFUSED');
    const fresh = await methods[receipt.method](receipt.input, signal, model);
    if (fresh.sourceHash !== receipt.sourceHash || libraryReadHash(fresh.authorization) !== libraryReadHash(receipt.authorization)
      || libraryReadHash(fresh.sources) !== libraryReadHash(receipt.sources) || libraryReadHash(receipt.acquisition) !== libraryReadHash(acquisition)
      || receipt.method === 'image' && libraryReadHash(nativeContent) !== libraryReadHash(fresh.nativeContent)) fail(403, 'SHOPIFY_PRODUCT_CACHE_REFUSED');
    // Mutable publication/readiness views are reconstructed from original state
    // before disclosure. Never trust cached/model-written status or prose.
    return fresh;
  }
  return Object.freeze({ ...methods, refresh });
}
