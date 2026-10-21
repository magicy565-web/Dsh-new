import { createHash } from 'node:crypto';
import { SHOPIFY_API_VERSION } from './shopify.mjs';
import { supplierFail, supplierHash } from './supplier-profile.mjs';
import { assertSupplierProductSource } from './supplier-draft.mjs';
import { multiVariantPreview, inspectReviewedVariants } from './shopify-variant-publication.mjs';

// A host-installed action adapter for the ORIGINAL capability service. It is
// never a model tool and does not own approvals, a queue, or a separate store.
export const SUPPLIER_SHOPIFY_ADAPTER = 'workspace-supplier-shopify';
export const SUPPLIER_SHOPIFY_ACTIONS = Object.freeze(['supplier.shopify.draft', 'supplier.shopify.publish', 'supplier.shopify.repair_draft']);

/**
 * Target descriptor. The supplier publication flow reads this instead of
 * hard-coding Shopify identifiers, so a second commerce target (Medusa) can
 * implement the same contract without forking the business flow.
 * See docs/MEDUSA-SHOPIFY-PARITY.md.
 */
export const SUPPLIER_SHOPIFY_TARGET = Object.freeze({
  id: 'shopify',
  label: 'Shopify',
  adapter: SUPPLIER_SHOPIFY_ADAPTER,
  actions: SUPPLIER_SHOPIFY_ACTIONS,
  connectorRequestId: 'builtin-supplier-shopify-connector-v1',
  connectorName: '供应商 Shopify 商品发布',
  connectorDescription: 'Explicitly reviewed supplier retail fields/images, draft creation and exact-channel publication.',
  credentialRefs: Object.freeze({ shopify: 'WORKSPACE_SHOPIFY_ADMIN_TOKEN' }),
  resourcePrefix: 'shopify',
  isProductId: value => /^gid:\/\/shopify\/Product\/\d+$/u.test(value ?? ''),
  isVariantId: value => /^gid:\/\/shopify\/ProductVariant\/\d+$/u.test(value ?? ''),
  isPublicationId: value => /^gid:\/\/shopify\/Publication\/\d+$/u.test(value ?? ''),
  actionName: action => `supplier.shopify.${action}`,
  draftStatus: 'shopify_draft',
  clientConfigured: ({ commerce, shopify }) => Boolean((commerce ?? shopify)?.status?.().configured),
  /** Identity/capability verification owned by the target, not the business flow. */
  verify: ({ commerce, shopify }) => (commerce ?? shopify).verify(),
  allowsAction: (verified, action) => Array.isArray(verified?.scopes)
    && verified.scopes.includes('write_products')
    && (action === 'publish' ? verified.scopes.includes('write_publications') : true),
  consumerCurrency: verified => verified?.shop?.currency ?? null,
  scopeFields: (verified, body) => ({ shopDomain: verified.shop.domain, shopId: verified.shop.id, publicationId: body.publicationId || null }),
});

const NS = 'cnsubscribe_workspace';
const gid = (kind, value) => typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/\\d+$`).test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const money = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(value) ? value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value : null;
const INFO = 'query SupplierPublicationShop { shop { id name myshopifyDomain currencyCode } currentAppInstallation { accessScopes { handle } } }';
const PRODUCT = `id handle title descriptionHtml status publishedAt onlineStoreUrl
  intent: metafield(namespace: "${NS}", key: "draft_intent") { value }
  release: metafield(namespace: "${NS}", key: "publication_intent") { value }
  variants(first: 2) { nodes { id sku price } pageInfo { hasNextPage } }
  media(first: 12) { nodes { id mediaContentType status alt ... on MediaImage { image { url } } } pageInfo { hasNextPage } }`;
const LOOKUP = `query SupplierPublicationReceipt($identifier: ProductIdentifierInput!, $publicationId: ID!) {
  product: productByIdentifier(identifier: $identifier) { ${PRODUCT} publishedOnPublication(publicationId: $publicationId) }
}`;
const LOOKUP_DRAFT = `query SupplierDraftReceipt($identifier: ProductIdentifierInput!) { product: productByIdentifier(identifier: $identifier) { ${PRODUCT} } }`;
const MULTI_PRODUCT = PRODUCT.replace('variants(first: 2) { nodes { id sku price }', 'options { name optionValues { name } } variants(first: 101) { nodes { id sku price selectedOptions { name value } media(first: 2) { nodes { id } pageInfo { hasNextPage } } }');
const LOOKUP_MULTI = `query SupplierMultiPublicationReceipt($identifier: ProductIdentifierInput!, $publicationId: ID!) {
  product: productByIdentifier(identifier: $identifier) { ${MULTI_PRODUCT} publishedOnPublication(publicationId: $publicationId) }
}`;
const LOOKUP_MULTI_DRAFT = `query SupplierMultiDraftReceipt($identifier: ProductIdentifierInput!) { product: productByIdentifier(identifier: $identifier) { ${MULTI_PRODUCT} } }`;
const CREATE_VARIANTS = `mutation SupplierCreateReviewedVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) { productVariants { id } userErrors { field message } }
}`;
const CREATE = `mutation SupplierCreateDraft($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
  productCreate(product: $product, media: $media) { product { id handle media(first: 12) { nodes { id } pageInfo { hasNextPage } } variants(first: 2) { nodes { id } pageInfo { hasNextPage } } } userErrors { field message } }
}`;
const PRICE = `mutation SupplierSetRetailVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) { productVariants { id price sku } userErrors { field message } }
}`;
const ACTIVATE = `mutation SupplierActivateReviewedDraft($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id status } userErrors { field message } } }`;
const PUBLISH = `mutation SupplierPublishReviewedProduct($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { publishable { availablePublicationsCount { count } } userErrors { field message } }
}`;
const STAGE = `mutation SupplierStageReviewedImage($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
}`;

function operationFrom(state, scope) {
  const row = state.workspaceSupplierServices?.services.find(item => item.id === scope.serviceId && item.subject === scope.subject && item.workspaceId === scope.workspaceId && item.conversationId === scope.conversationId);
  const operation = row?.publicationOperations?.find(item => item.id === scope.operationId);
  if (!operation || operation.scopeHash !== supplierHash(scope)) supplierFail(409, 'SUPPLIER_PUBLICATION_SCOPE_CHANGED', 'The original supplier publication scope changed.');
  assertSupplierProductSource(state, row);
  return { row, operation };
}

function safeStagingUrl(raw) {
  let url; try { url = new URL(raw); } catch { supplierFail(502, 'SHOPIFY_STAGING_INVALID', 'Shopify returned an invalid staged upload target.'); }
  const host = url.hostname;
  const allowed = host === 'shopify-staged-uploads.storage.googleapis.com' || host === 'storage.googleapis.com' && url.pathname.startsWith('/shopify-staged-uploads/');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) supplierFail(502, 'SHOPIFY_STAGING_INVALID', 'The staged target is outside the bounded Shopify upload hosts.');
  return url.href;
}

async function boundedJson(response) {
  if (!response.body || Number(response.headers.get('content-length')) > 1_000_000) supplierFail(502, 'SHOPIFY_PUBLICATION_RESPONSE_INVALID', 'The publication response is unavailable or too large.');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1_000_000) supplierFail(502, 'SHOPIFY_PUBLICATION_RESPONSE_INVALID', 'The publication response exceeded its bound.'); chunks.push(Buffer.from(part.value)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error.code) throw error; supplierFail(502, 'SHOPIFY_PUBLICATION_RESPONSE_INVALID', 'The publication response could not be verified.'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Uses the existing host Shopify credential. No secret enters scope/receipt. */
export function createShopifyPublicationAdapter({ environment = process.env, fetchImpl = fetch, clock = Date.now, readImage, store } = {}) {
  const domain = environment.WORKSPACE_SHOPIFY_SHOP_DOMAIN || '', secret = environment.WORKSPACE_SHOPIFY_ADMIN_TOKEN || '';
  const enabled = environment.WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED === '1';
  const configured = /^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/.test(domain) && typeof secret === 'string' && !!secret.trim();
  const fingerprint = supplierHash({ domain, apiVersion: SHOPIFY_API_VERSION, enabled, credentialConfiguration: digest(secret) });
  const at = () => new Date(clock()).toISOString();
  const status = () => ({ enabled, configured, fingerprint, domain: configured ? domain : null, apiVersion: SHOPIFY_API_VERSION, writesEnabled: enabled && configured, automaticRetry: false });
  function scopeConfig(scope, writing = false) {
    if (!configured) supplierFail(409, 'SHOPIFY_SETUP_REQUIRED', 'Configure the existing authorized shop on the server.');
    if (writing && !enabled) supplierFail(409, 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', 'Supplier Shopify writes are explicitly disabled on this host.');
    if (writing && scope.configFingerprint !== fingerprint || scope.shopDomain !== domain) supplierFail(409, 'SHOPIFY_SCOPE_CHANGED', 'Review the current host and shop configuration again.');
  }
  async function graphql(query, variables, signal) {
    if (!configured) supplierFail(409, 'SHOPIFY_SETUP_REQUIRED', 'The existing Shopify host is unconfigured.');
    let response;
    try { response = await fetchImpl(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': secret }, body: JSON.stringify({ query, variables }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }); }
    catch { supplierFail(502, 'SHOPIFY_PUBLICATION_UNCERTAIN', 'The external response was not acknowledged. Reconcile the original operation; do not repeat the write.'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); supplierFail(response.status === 401 || response.status === 403 ? 409 : 502, 'SHOPIFY_PUBLICATION_UNCERTAIN', 'Shopify did not acknowledge this operation; preserve and reconcile its original receipt.'); }
    if (response.headers.get('x-shopify-api-version') && response.headers.get('x-shopify-api-version') !== SHOPIFY_API_VERSION) supplierFail(502, 'SHOPIFY_API_VERSION_MISMATCH', 'The Shopify API version changed.');
    const result = await boundedJson(response);
    if (result.errors?.length || !result.data || typeof result.data !== 'object') supplierFail(502, 'SHOPIFY_PUBLICATION_UNCERTAIN', 'Shopify returned an incomplete operation response.');
    return result.data;
  }
  const resultOf = (data, name) => { const value = data[name]; if (!value || !Array.isArray(value.userErrors) || value.userErrors.length) supplierFail(502, 'SHOPIFY_PUBLICATION_REJECTED', 'Shopify rejected the reviewed change. Its raw message is not persisted.'); return value; };
  async function verify(scope, signal) {
    scopeConfig(scope);
    const data = await graphql(INFO, {}, signal), shop = data.shop, scopes = data.currentAppInstallation?.accessScopes;
    if (!gid('Shop', shop?.id) || shop.myshopifyDomain !== domain || shop.id !== scope.shopId || shop.currencyCode !== scope.preview.market.currency || !Array.isArray(scopes)) supplierFail(409, 'SHOPIFY_SCOPE_CHANGED', 'Shop identity or consumer currency differs from the reviewed scope.');
    const handles = scopes.map(item => item.handle);
    if (!handles.some(value => ['read_products', 'write_products'].includes(value))) supplierFail(409, 'SHOPIFY_PRODUCT_SCOPE_REQUIRED', 'The existing product read permission is required.');
    return handles;
  }
  function inspect(scope, product) {
    if (product === null) return { status: 'not_found', found: false, complete: false, observedAt: at(), error: { code: 'SHOPIFY_RECEIPT_NOT_FOUND' } };
    const expectedMarker = scope.action === 'draft' ? supplierHash(scope) : scope.draftScopeHash;
    if (!gid('Product', product?.id) || product.handle !== scope.handle || product.intent?.value !== expectedMarker || scope.productId && product.id !== scope.productId) supplierFail(409, 'SHOPIFY_RECEIPT_SCOPE_MISMATCH', 'The remote product does not carry this exact original draft marker.');
    const multi = multiVariantPreview(scope);
    if (!Array.isArray(product.variants?.nodes) || product.variants.pageInfo?.hasNextPage !== false || (multi ? product.variants.nodes.length > 100 : product.variants.nodes.length !== 1) || !Array.isArray(product.media?.nodes) || product.media.pageInfo?.hasNextPage !== false) supplierFail(409, 'SHOPIFY_RECEIPT_INCOMPLETE', 'The remote variant/media scope is incomplete.');
    const variant = product.variants.nodes[0], issues = [];
    const draftScope = scope.action === 'draft' ? scope : scope.draftScope;
    const original = store && operationFrom(store.read(), draftScope);
    const creation = original?.operation.steps.find(item => item.step === 'product_create' && item.status === 'acknowledged')?.receipt;
    const mediaSnapshot = product.media.nodes.map(item => ({ id: item.id, mediaContentType: item.mediaContentType, status: item.status, alt: item.alt ?? null, imageUrl: item.image?.url ?? null }));
    // A new human-approved observation can resolve a lost create response. It
    // never rewrites the original create/upload checkpoints as acknowledged.
    const mediaReview = !Array.isArray(creation?.mediaIds) && original?.row.publicationOperations.find(item => {
      if (item.action !== 'repair_draft' || item.scope.draftOperationId !== draftScope.operationId || !item.scope.repair?.approveObservedMedia || !item.connectorRunId || supplierHash(item.scope.repair.mediaSnapshot) !== supplierHash(mediaSnapshot)) return false;
      const state = store.read(), run = state.capabilities.connectorRuns.find(run => run.id === item.connectorRunId), approval = state.capabilities.approvals.find(approval => approval.id === item.approvalId);
      return run?.action === 'supplier.shopify.repair_draft' && run.connectorId === item.connectorId && run.approvalId === item.approvalId && approval?.status === 'consumed' && approval.payload.binding?.operationId === item.id && approval.payload.binding.scopeHash === item.scopeHash;
    });
    const expectedMediaIds = creation?.mediaIds || mediaReview?.scope.repair.mediaSnapshot.map(item => item.id);
    if (!Array.isArray(expectedMediaIds) || expectedMediaIds.length !== scope.preview.images.length || supplierHash(expectedMediaIds) !== supplierHash(product.media.nodes.map(item => item.id)) || expectedMediaIds.some(id => !gid('MediaImage', id))) issues.push('media_identity_unconfirmed');
    if (product.variants.nodes.some(v => !gid('ProductVariant', v.id)) || new Set(product.variants.nodes.map(v => v.id)).size !== product.variants.nodes.length) supplierFail(502, 'SHOPIFY_RECEIPT_INCOMPLETE', 'The variant receipt has no distinct exact identity.');
    if (product.title !== scope.preview.product.title || product.descriptionHtml !== scope.preview.product.descriptionHtml) issues.push('product_content_changed');
    const variants = multi ? inspectReviewedVariants(scope, product, expectedMediaIds,
      original?.operation.steps.find(s => s.step === 'retail_variants' && s.status === 'acknowledged')?.receipt?.variantIds, money) : null;
    if (multi) issues.push(...variants.issues);
    else if (money(variant.price) !== money(scope.preview.saleUnit.consumerPrice) || scope.preview.variants[0].sku !== null && variant.sku !== scope.preview.variants[0].sku) issues.push('retail_variant_changed');
    if (product.media.nodes.length !== scope.preview.images.length || product.media.nodes.some(item => item.mediaContentType !== 'IMAGE' || item.status !== 'READY' || typeof item.image?.url !== 'string' || !item.image.url.startsWith('https://'))) issues.push('media_not_ready');
    const remoteContentHash = supplierHash({ title: product.title, descriptionHtml: product.descriptionHtml, ...(multi ? { options: variants.options } : {}), variants: multi ? variants.snapshot : product.variants.nodes.map(item => ({ id: item.id, sku: item.sku, price: money(item.price) })), media: product.media.nodes.map(item => ({ id: item.id, mediaContentType: item.mediaContentType, alt: item.alt ?? null, imageUrl: item.image?.url ?? null })) });
    const originalHash = scope.action === 'publish' ? scope.remoteContentHash : store ? operationFrom(store.read(), scope).operation.remoteContentHash : null;
    if (originalHash && originalHash !== remoteContentHash) issues.push('remote_content_changed');
    if (!['DRAFT', 'ACTIVE'].includes(product.status) || scope.action !== 'publish' && product.status !== 'DRAFT') issues.push('product_status_changed');
    const published = scope.action === 'publish' && product.status === 'ACTIVE' && product.publishedOnPublication === true && product.release?.value === supplierHash(scope);
    if (scope.action === 'publish' && typeof product.publishedOnPublication !== 'boolean') supplierFail(502, 'SHOPIFY_PUBLICATION_RECEIPT_INVALID', 'The selected publication was not acknowledged.');
    if (scope.action === 'publish' && product.release?.value !== supplierHash(scope)) issues.push('publication_marker_changed');
    if (scope.action === 'publish' && !published) issues.push('publication_not_acknowledged');
    const onlineAt = typeof product.publishedAt === 'string' && Number.isFinite(Date.parse(product.publishedAt)) && typeof product.onlineStoreUrl === 'string' && product.onlineStoreUrl.startsWith('https://') ? product.publishedAt : null;
    const variantIds = product.variants.nodes.map(v => v.id);
    const repairBasisHash = supplierHash({ productId: product.id, handle: product.handle, title: product.title, descriptionHtml: product.descriptionHtml, productStatus: product.status, publicationIntentHash: product.release?.value || null, variantIds, mediaSnapshot });
    return { status: published && !issues.length ? 'published' : product.status === 'DRAFT' ? 'shopify_draft' : 'unpublished', found: true, complete: !issues.length, readyForPublication: !issues.length && scope.action !== 'publish', productId: product.id, productStatus: product.status, variantIds, ...(multi ? { variantReceipts: variants.variantReceipts, variantEvidence: variants.variantEvidence, inventory: variants.inventory } : {}), handle: scope.handle, shopId: scope.shopId, shopDomain: domain, publicationId: scope.publicationId, published: published && !issues.length,
      // Product.publishedAt is Online Store specific, not arbitrary channel time.
      publishedAt: null, publicationTimeSource: null, onlineStorePublishedAt: onlineAt, onlineStoreUrl: onlineAt ? product.onlineStoreUrl : null,
      observedAt: at(), previewHash: scope.previewHash, remoteContentHash, repairBasisHash, publicationIntentHash: product.release?.value || null, mediaSnapshot, mediaIds: product.media.nodes.map(item => item.id), mediaEvidence: { sourceBytes: scope.preview.images.every(item => item.kind === 'artifact') ? 'reviewed_sha256_uploaded' : 'remote_url_not_hashed', remote: mediaReview ? 'separately_approved_observed_ids_and_shopify_status' : expectedMediaIds ? 'acknowledged_ids_and_shopify_status' : 'unconfirmed', reviewOperationId: mediaReview?.id || null, remoteBytesVerified: false }, issues, externalStatus: published && !issues.length ? 'published' : product.status === 'DRAFT' ? 'shopify_draft' : 'unpublished' };
  }
  async function reconcile(scope, { signal } = {}) {
    await verify(scope, signal);
    const query = multiVariantPreview(scope) ? scope.action === 'publish' ? LOOKUP_MULTI : LOOKUP_MULTI_DRAFT : scope.action === 'publish' ? LOOKUP : LOOKUP_DRAFT;
    const data = await graphql(query, { identifier: { handle: scope.handle }, ...(scope.action === 'publish' ? { publicationId: scope.publicationId } : {}) }, signal);
    return inspect(scope, data.product);
  }
  async function planRepair(draftScope, { approveObservedMedia = false, signal } = {}) {
    if (multiVariantPreview(draftScope)) supplierFail(409, 'SHOPIFY_MULTI_VARIANT_REPAIR_UNSUPPORTED', 'Multi-variant partial results require original read-only reconciliation; legacy single-variant repair cannot be applied.');
    const { row, operation } = operationFrom(store.read(), draftScope), observed = await reconcile(draftScope, { signal });
    if (!observed.found) supplierFail(409, 'SHOPIFY_REPAIR_PRODUCT_REQUIRED', 'No exact original remote product exists to repair.');
    if (observed.productStatus !== 'DRAFT' || observed.publicationIntentHash || row.publicationOperations.some(item => item.action === 'publish' && item.connectorRunId && item.scope.productId === observed.productId)) supplierFail(409, 'SHOPIFY_REPAIR_PUBLICATION_PRESENT', 'An active or previously admitted publication cannot be rolled back or repaired as a draft.');
    if (observed.complete || operation.remoteContentHash) supplierFail(409, 'SHOPIFY_REPAIR_NOT_REQUIRED', 'A completed draft is not a missing-step repair. Reconcile it without writing.');
    if (observed.issues.some(issue => !['retail_variant_changed', 'media_identity_unconfirmed'].includes(issue))) supplierFail(409, 'SHOPIFY_REPAIR_MEDIA_OR_CONTENT_CHANGED', 'Repair cannot replace missing/unready/changed media or altered public content. Reconcile the original source first.');
    const creation = operation.steps.find(item => item.step === 'product_create');
    if (!creation) supplierFail(409, 'SHOPIFY_REPAIR_PRODUCT_REQUIRED', 'The original product-create intent has no receipt to reconcile.');
    const adopt = observed.issues.includes('media_identity_unconfirmed');
    if (adopt && (!approveObservedMedia || creation.status === 'acknowledged' && Array.isArray(creation.receipt?.mediaIds))) supplierFail(409, 'SHOPIFY_REPAIR_MEDIA_REVIEW_REQUIRED', 'Explicitly review the observed existing media identities after a lost create response; known media cannot be substituted.');
    if (adopt) for (const [index, image] of draftScope.preview.images.entries()) {
      if (image.kind === 'artifact' && !operation.steps.some(step => step.step === `image_${index}_upload` && step.status === 'acknowledged' && step.receipt?.sourceHash === image.asset.sha256)) supplierFail(409, 'SHOPIFY_REPAIR_MEDIA_TRANSFER_UNCONFIRMED', 'The original reviewed image upload is unacknowledged; no retransmission or invented upload receipt is allowed.');
    }
    const repairVariant = observed.issues.includes('retail_variant_changed');
    if (repairVariant && (operation.steps.some(item => item.step === 'retail_variant' && item.status === 'acknowledged') || row.publicationOperations.some(item => item.action === 'repair_draft' && item.scope.draftOperationId === operation.id && item.steps.some(step => step.step === 'retail_variant_repair' && step.status === 'acknowledged')))) supplierFail(409, 'SHOPIFY_REPAIR_VARIANT_ALREADY_ACKNOWLEDGED', 'This variant was already written; an external edit needs a separately scoped update, not a missing-step repair.');
    return { observed, repair: { steps: repairVariant ? ['retail_variant'] : [], approveObservedMedia: adopt, mediaSnapshot: observed.mediaSnapshot, repairBasisHash: observed.repairBasisHash, beforeRemoteContentHash: observed.remoteContentHash, originalCreateStatus: creation.status } };
  }
  async function assertExecuting(scope, runId, signal) {
    if (signal?.aborted) supplierFail(409, 'SHOPIFY_OPERATION_INTERRUPTED', 'The original execution was cancelled; reconcile previous steps without replay.');
    scopeConfig(scope, true);
    if (!store) supplierFail(409, 'SUPPLIER_ORIGINAL_STORE_REQUIRED', 'The original business store must attest this write.');
    const state = store.read(), { row, operation } = operationFrom(state, scope);
    const run = state.capabilities.connectorRuns.find(item => item.id === runId);
    const connector = state.capabilities.connectors.find(item => item.id === operation.connectorId);
    if (!run || run.connectorId !== operation.connectorId || run.status !== 'running' || !connector?.enabled || connector.adapter !== SUPPLIER_SHOPIFY_ADAPTER || connector.revision !== run.connectorRevision || connector.credentialRefs.shopify !== 'WORKSPACE_SHOPIFY_ADMIN_TOKEN' || Object.keys(connector.credentialRefs).length !== 1 || !connector.capabilities.includes(`supplier.shopify.${scope.action}`) || row.cancelledAt || row.rejectedAt) supplierFail(409, 'SHOPIFY_OPERATION_INTERRUPTED', 'The original connector grant or supplier intake changed; no further write is authorized.');
    if (operation.status !== 'running' || operation.connectorRunId !== runId || row.revision !== scope.serviceRevision || row.preview?.previewHash !== scope.previewHash || supplierHash(row.preview) !== scope.previewSnapshotHash) supplierFail(409, 'SUPPLIER_PUBLICATION_SCOPE_CHANGED', 'The exact original operation and preview are no longer current.');
  }
  async function checkpoint(scope, runId, step, statusValue, receipt = null) {
    await store.update(state => { const { operation } = operationFrom(state, scope); if (operation.connectorRunId !== runId || operation.status !== 'running') supplierFail(409, 'SUPPLIER_PUBLICATION_SCOPE_CHANGED', 'The original connector run changed.'); const prior = operation.steps.find(item => item.step === step); if (statusValue === 'started' && prior) supplierFail(409, 'SHOPIFY_WRITE_REPLAY_FORBIDDEN', 'An external write step cannot be replayed automatically.'); if (prior) Object.assign(prior, { status: statusValue, receipt, updatedAt: at() }); else operation.steps.push({ step, status: statusValue, receipt, updatedAt: at() }); });
  }
  async function step(scope, runId, signal, name, call, project = value => value) {
    await assertExecuting(scope, runId, signal); await checkpoint(scope, runId, name, 'started');
    await assertExecuting(scope, runId, signal);
    const result = await call(); await checkpoint(scope, runId, name, 'acknowledged', project(result)); return result;
  }
  async function mediaSources(scope, runId, signal) {
    const media = [];
    for (let index = 0; index < scope.preview.images.length; index++) {
      const image = scope.preview.images[index];
      if (image.kind === 'public_url') { media.push({ originalSource: image.url, mediaContentType: 'IMAGE', alt: scope.preview.product.title }); continue; }
      if (!readImage || image.kind !== 'artifact') supplierFail(409, 'SUPPLIER_IMAGE_TRANSFER_REQUIRED', 'The approved exact original image transfer is unavailable.');
      const file = await readImage(scope, image.asset);
      if (file.version.sha256 !== image.asset.sha256 || digest(file.bytes) !== image.asset.sha256 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType) || file.bytes.length > 20_000_000) supplierFail(409, 'SUPPLIER_IMAGE_TRANSFER_REQUIRED', 'The reviewed image bytes, version, or type changed.');
      const suffix = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.mimeType], filename = `supplier-${scope.operationId}-${index}.${suffix}`;
      const staged = await step(scope, runId, signal, `image_${index}_stage`, async () => resultOf(await graphql(STAGE, { input: [{ filename, mimeType: file.mimeType, resource: 'IMAGE', httpMethod: 'POST', fileSize: String(file.bytes.length) }] }, signal), 'stagedUploadsCreate'), () => ({ imageIndex: index, sourceHash: image.asset.sha256 }));
      if (!Array.isArray(staged.stagedTargets) || staged.stagedTargets.length !== 1) supplierFail(502, 'SHOPIFY_STAGING_INVALID', 'Exactly one reviewed image upload target was expected.');
      const target = staged.stagedTargets[0], uploadUrl = safeStagingUrl(target.url), resourceUrl = safeStagingUrl(target.resourceUrl);
      if (!Array.isArray(target.parameters) || target.parameters.length > 30 || target.parameters.some(item => typeof item.name !== 'string' || typeof item.value !== 'string' || item.name.length > 200 || item.value.length > 20000)) supplierFail(502, 'SHOPIFY_STAGING_INVALID', 'The staged image form is invalid.');
      await step(scope, runId, signal, `image_${index}_upload`, async () => { const form = new FormData(); for (const item of target.parameters) form.append(item.name, item.value); form.append('file', new Blob([file.bytes], { type: file.mimeType }), filename); let response; try { response = await fetchImpl(uploadUrl, { method: 'POST', redirect: 'error', body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }); } catch { supplierFail(502, 'SHOPIFY_UPLOAD_UNCERTAIN', 'The original image upload result is unknown.'); } await response.body?.cancel().catch(() => {}); if (!response.ok) supplierFail(502, 'SHOPIFY_UPLOAD_UNCERTAIN', 'The original image upload was not acknowledged.'); return { imageIndex: index, sourceHash: image.asset.sha256, bytes: file.bytes.length }; });
      // Signed upload parameters never enter the durable operation or logs.
      media.push({ originalSource: resourceUrl, mediaContentType: 'IMAGE', alt: scope.preview.product.title });
    }
    return media;
  }
  const adapter = {
    target: SUPPLIER_SHOPIFY_TARGET,
    status, fingerprint, reconcile, planRepair,
    capabilities: [...SUPPLIER_SHOPIFY_ACTIONS], credentialEnvNames: ['WORKSPACE_SHOPIFY_ADMIN_TOKEN'],
    actionDescriptions: { 'supplier.shopify.draft': 'Create one reviewed Shopify draft and transfer only its explicitly reviewed retail fields/images.', 'supplier.shopify.publish': 'Activate and publish one exact approved draft to one existing selected Shopify publication.', 'supplier.shopify.repair_draft': 'Complete only a separately reviewed missing retail-variant step on one exact existing draft; never create, upload, activate or publish.' },
    async execute({ action, payload: scope, binding, idempotencyKey: runId, signal, credentials, connectorId }) {
      if (binding?.type !== 'supplier-publication' || binding.operationId !== scope?.operationId || binding.scopeHash !== supplierHash(scope) || action !== `supplier.shopify.${scope.action}`) supplierFail(403, 'SUPPLIER_PUBLICATION_BINDING_REQUIRED', 'Only the original supplier approval can execute this adapter.');
      if (typeof credentials?.shopify !== 'string' || credentials.shopify !== secret || Object.keys(credentials).length !== 1 || operationFrom(store.read(), scope).operation.connectorId !== connectorId) supplierFail(403, 'SHOPIFY_APPROVED_CREDENTIAL_REQUIRED', 'Use the exact credential delivered by the original approved connector.');
      await assertExecuting(scope, runId, signal);
      const scopes = await verify(scope, signal);
      if (!scopes.includes('write_products') || scope.action === 'publish' && !scopes.includes('write_publications')) supplierFail(409, 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', 'The existing shop authorization does not grant this exact write.');
      if (scope.action === 'draft') {
        const existing = await reconcile(scope, { signal });
        if (existing.found) supplierFail(409, 'SHOPIFY_EXISTING_DRAFT_RECONCILIATION_REQUIRED', 'The deterministic handle already exists. Reconcile it instead of creating another product.');
        const media = await mediaSources(scope, runId, signal);
        const multi = multiVariantPreview(scope);
        const created = await step(scope, runId, signal, 'product_create', async () => resultOf(await graphql(CREATE, { product: { title: scope.preview.product.title, descriptionHtml: scope.preview.product.descriptionHtml, status: 'DRAFT', handle: scope.handle, ...(multi ? { productOptions: scope.preview.options.map(o => ({ name: o.name, values: o.values.map(name => ({ name })) })) } : {}), metafields: [{ namespace: NS, key: 'draft_intent', type: 'single_line_text_field', value: supplierHash(scope) }] }, media }, signal), 'productCreate'), value => ({ productId: value.product?.id || null, handle: value.product?.handle || null, mediaIds: value.product?.media?.pageInfo?.hasNextPage === false ? value.product.media.nodes?.map(item => item.id) : null }));
        const product = created.product;
        if (!gid('Product', product?.id) || product.handle !== scope.handle || product.variants?.nodes?.length !== 1 || product.variants.pageInfo?.hasNextPage !== false || !gid('ProductVariant', product.variants.nodes[0].id)) supplierFail(502, 'SHOPIFY_DRAFT_RECEIPT_INVALID', 'The original draft or variant was not completely acknowledged.');
        if (multi) {
          if (product.media?.pageInfo?.hasNextPage !== false || product.media.nodes.length !== scope.preview.images.length || product.media.nodes.some(m => !gid('MediaImage', m.id))) supplierFail(502, 'SHOPIFY_DRAFT_RECEIPT_INVALID', 'Exact created media IDs are required for variant associations.');
          await step(scope, runId, signal, 'retail_variants', async () => resultOf(await graphql(CREATE_VARIANTS, { productId: product.id,
            variants: scope.preview.variants.map(v => ({ price: v.price, inventoryItem: { sku: v.sku }, optionValues: v.selectedOptions.map(o => ({ optionName: o.name, name: o.value })),
              ...(v.imageIndex === null ? {} : { mediaId: product.media.nodes[v.imageIndex].id }) })) }, signal), 'productVariantsBulkCreate'), value => ({ variantIds: value.productVariants?.map(v => v.id) || [] }));
        } else await step(scope, runId, signal, 'retail_variant', async () => resultOf(await graphql(PRICE, { productId: product.id, variants: [{ id: product.variants.nodes[0].id, price: scope.preview.saleUnit.consumerPrice, ...(scope.preview.variants[0].sku === null ? {} : { inventoryItem: { sku: scope.preview.variants[0].sku } }) }] }, signal), 'productVariantsBulkUpdate'), value => ({ variantIds: value.productVariants?.map(item => item.id) || [] }));
        return reconcile(scope, { signal });
      }
      if (scope.action === 'repair_draft') {
        const checkRepair = async () => {
          const observed = await reconcile(scope, { signal });
          if (observed.productStatus !== 'DRAFT' || observed.publicationIntentHash || observed.productId !== scope.productId || observed.repairBasisHash !== scope.repair.repairBasisHash || observed.issues.some(issue => issue !== 'retail_variant_changed')) supplierFail(409, 'SHOPIFY_REPAIR_STALE', 'The reviewed existing draft/media scope changed; do not write or publish.');
          if (!observed.complete && observed.remoteContentHash !== scope.repair.beforeRemoteContentHash) supplierFail(409, 'SHOPIFY_REPAIR_STALE', 'The observed retail variant changed after this repair review.');
          return observed;
        };
        const before = await checkRepair();
        if (before.complete) return before;
        if (!scope.repair.steps.includes('retail_variant')) supplierFail(409, 'SHOPIFY_REPAIR_STALE', 'This review did not approve a missing variant write.');
        await step(scope, runId, signal, 'retail_variant_repair', async () => {
          const current = await checkRepair();
          if (current.complete) return { productVariants: current.variantIds.map(id => ({ id })), skipped: true };
          await assertExecuting(scope, runId, signal);
          return resultOf(await graphql(PRICE, { productId: scope.productId, variants: [{ id: scope.variantIds[0], price: scope.preview.saleUnit.consumerPrice, ...(scope.preview.variants[0].sku === null ? {} : { inventoryItem: { sku: scope.preview.variants[0].sku } }) }] }, signal), 'productVariantsBulkUpdate');
        }, value => ({ variantIds: value.productVariants?.map(item => item.id) || [], skippedAlreadyComplete: value.skipped === true }));
        return reconcile(scope, { signal });
      }
      const before = await reconcile(scope.draftScope, { signal });
      if (!before.complete || before.productId !== scope.productId || before.status !== 'shopify_draft') supplierFail(409, 'SHOPIFY_DRAFT_CHANGED', 'Read and review the actual complete original Shopify draft before publication.');
      await step(scope, runId, signal, 'activate_product', async () => resultOf(await graphql(ACTIVATE, { product: { id: scope.productId, status: 'ACTIVE', metafields: [{ namespace: NS, key: 'publication_intent', type: 'single_line_text_field', value: supplierHash(scope) }] } }, signal), 'productUpdate'), value => ({ productId: value.product?.id || null, productStatus: value.product?.status || null }));
      const activated = await reconcile(scope, { signal });
      if (!activated.found || activated.productStatus !== 'ACTIVE' || activated.issues.some(issue => issue !== 'publication_not_acknowledged')) supplierFail(409, 'SHOPIFY_PRODUCT_CHANGED_BEFORE_PUBLICATION', 'The exact remote product content or publication marker changed before publication.');
      if (activated.published) return activated;
      await step(scope, runId, signal, 'publish_product', async () => resultOf(await graphql(PUBLISH, { id: scope.productId, input: [{ publicationId: scope.publicationId }] }, signal), 'publishablePublish'), () => ({ productId: scope.productId, publicationId: scope.publicationId }));
      return reconcile(scope, { signal });
    },
  };
  return adapter;
}
