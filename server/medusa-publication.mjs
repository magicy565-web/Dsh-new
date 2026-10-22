// Medusa v2 commerce target for the supplier publication contract.
// Mirrors server/shopify-publication.mjs action-for-action; see
// docs/MEDUSA-SHOPIFY-PARITY.md. No demo data, no model tools, no parallel
// business store: it only translates the reviewed scope into Medusa Admin calls.
import { createHash } from 'node:crypto';
import { supplierFail, supplierHash } from './supplier-profile.mjs';

export const SUPPLIER_MEDUSA_ADAPTER = 'workspace-supplier-medusa';
export const SUPPLIER_MEDUSA_ACTIONS = Object.freeze(['supplier.medusa.draft', 'supplier.medusa.publish', 'supplier.medusa.repair_draft']);
const MARKER_DRAFT = 'workspace_draft_intent';
const MARKER_PUBLICATION = 'workspace_publication_intent';

export const SUPPLIER_MEDUSA_TARGET = Object.freeze({
  id: 'medusa',
  label: 'Medusa',
  adapter: SUPPLIER_MEDUSA_ADAPTER,
  actions: SUPPLIER_MEDUSA_ACTIONS,
  connectorRequestId: 'builtin-supplier-medusa-connector-v1',
  connectorName: '渚涘簲鍟?Medusa 鍟嗗搧鍙戝竷',
  connectorDescription: 'Explicitly reviewed supplier retail fields/images, draft creation and exact sales-channel publication on the self-hosted Medusa instance.',
  credentialRefs: Object.freeze({ medusa: 'WORKSPACE_MEDUSA_SECRET_API_KEY' }),
  resourcePrefix: 'medusa',
  isProductId: value => typeof value === 'string' && /^prod_[A-Za-z0-9]+$/u.test(value),
  isVariantId: value => typeof value === 'string' && /^variant_[A-Za-z0-9]+$/u.test(value),
  isPublicationId: value => typeof value === 'string' && /^sc_[A-Za-z0-9]+$/u.test(value),
  actionName: action => `supplier.medusa.${action}`,
  draftStatus: 'medusa_draft',
  clientConfigured: ({ commerce }) => Boolean(commerce?.status?.().configured),
  verify: ({ commerce }) => commerce.verify(),
  allowsAction: verified => Array.isArray(verified?.scopes) ? verified.scopes.includes('products:write') : verified?.canWrite === true,
  consumerCurrency: verified => verified?.currency ?? null,
  scopeFields: (verified, body) => ({ storeId: verified.storeId, salesChannelId: body.publicationId || null }),
});

const digest = value => createHash('sha256').update(value).digest('hex');
const money = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(value)) return Number(value);
  return null;
};

async function boundedJson(response) {
  if (!response.body || Number(response.headers.get('content-length')) > 1_000_000)
    supplierFail(502, 'MEDUSA_RESPONSE_INVALID', 'The Medusa response is unavailable or too large.');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_000_000) supplierFail(502, 'MEDUSA_RESPONSE_INVALID', 'The Medusa response exceeded its bound.');
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error.code) throw error;
    supplierFail(502, 'MEDUSA_RESPONSE_INVALID', 'The Medusa response could not be verified.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/**
 * Minimal, read-only Medusa admin client used to verify identity/currency before
 * a publication review. It never exposes the secret and never writes. Product
 * write scope cannot be discovered from a secret key, so the host must state it
 * explicitly; otherwise announcements stay read-only.
 */
export function createMedusaAdminClient({ environment = process.env, fetchImpl = fetch } = {}) {
  const baseURL = (environment.WORKSPACE_MEDUSA_BASE_URL || '').replace(/\/+$/u, '');
  const secret = environment.WORKSPACE_MEDUSA_SECRET_API_KEY || '';
  const allowLoopbackHTTP = environment.WORKSPACE_MEDUSA_ALLOW_LOOPBACK_HTTP === '1';
  const configured = (allowLoopbackHTTP ? /^http:\/\/127\.0\.0\.1(?::\d{2,5})?$/u : /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/iu).test(baseURL) && secret.trim().length >= 16;
  const scopeReviewed = environment.WORKSPACE_MEDUSA_KEY_SCOPE_REVIEWED === '1';
  async function get(path) {
    if (!configured) supplierFail(409, 'MEDUSA_SETUP_REQUIRED', 'The existing Medusa host is unconfigured.');
    let response;
    try { response = await fetchImpl(baseURL + path, { method: 'GET', redirect: 'error', headers: { Authorization: `Basic ${secret}` }, signal: AbortSignal.timeout(15000) }); }
    catch { supplierFail(502, 'MEDUSA_VERIFY_UNCERTAIN', 'The Medusa identity could not be read; no write was attempted.'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); supplierFail(409, 'MEDUSA_VERIFY_FAILED', 'The Medusa credential or endpoint was rejected.'); }
    try { return await response.json(); }
    catch { supplierFail(502, 'MEDUSA_VERIFY_INVALID', 'The Medusa identity response could not be verified.'); }
  }
  return {
    status: () => ({ configured, baseURL: configured ? baseURL : null, scopeReviewed }),
    async verify() {
      const stores = await get('/admin/stores?limit=1');
      const store = Array.isArray(stores?.stores) ? stores.stores[0] : null;
      if (!store?.id) supplierFail(409, 'MEDUSA_VERIFY_FAILED', 'No Medusa store was returned for this credential.');
      const channels = await get('/admin/sales-channels?limit=100');
      return {
        storeId: store.id,
        currency: store.default_currency_code ?? null,
        salesChannelIds: (channels?.sales_channels || []).map(item => item.id),
        scopes: scopeReviewed ? ['products:write'] : [],
      };
    },
  };
}

/** Uses the host-held Medusa secret key. It never enters scope, receipts or logs. */
export function createMedusaPublicationAdapter({ environment = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
  const baseURL = (environment.WORKSPACE_MEDUSA_BASE_URL || '').replace(/\/+$/u, '');
  const secret = environment.WORKSPACE_MEDUSA_SECRET_API_KEY || '';
  const salesChannelId = environment.WORKSPACE_MEDUSA_SALES_CHANNEL_ID || '';
  const allowLoopbackHTTP = environment.WORKSPACE_MEDUSA_ALLOW_LOOPBACK_HTTP === '1';
  const enabled = environment.WORKSPACE_SUPPLIER_MEDUSA_WRITES_ENABLED === '1';
  const configured = (allowLoopbackHTTP ? /^http:\/\/127\.0\.0\.1(?::\d{2,5})?$/u : /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/iu).test(baseURL) && typeof secret === 'string' && secret.trim().length >= 16;
  const fingerprint = supplierHash({ baseURL, enabled, salesChannelId: salesChannelId || null, credentialConfiguration: digest(secret) });
  const at = () => new Date(clock()).toISOString();
  const status = () => ({ enabled, configured, fingerprint, baseURL: configured ? baseURL : null, apiVersion: 'admin-v2', writesEnabled: enabled && configured, salesChannelConfigured: Boolean(salesChannelId), automaticRetry: false });

  async function request(method, path, body, signal) {
    if (!configured) supplierFail(409, 'MEDUSA_SETUP_REQUIRED', 'The existing Medusa host is unconfigured.');
    let response;
    try {
      response = await fetchImpl(baseURL + path, {
        method, redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${secret}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
    } catch { supplierFail(502, 'MEDUSA_PUBLICATION_UNCERTAIN', 'The external response was not acknowledged. Reconcile the original operation; do not repeat the write.'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      supplierFail(response.status === 401 || response.status === 403 ? 409 : 502, 'MEDUSA_PUBLICATION_UNCERTAIN', 'Medusa did not acknowledge this operation; preserve and reconcile its original receipt.');
    }
    const result = await boundedJson(response);
    if (!result || typeof result !== 'object') supplierFail(502, 'MEDUSA_PUBLICATION_UNCERTAIN', 'Medusa returned an incomplete operation response.');
    return result;
  }

  const fields = 'id,title,description,handle,status,metadata,thumbnail,images,options,sales_channels,updated_at,*variants,*variants.prices';
  async function lookup(scope, signal) {
    const query = new URLSearchParams({ handle: scope.handle, fields, limit: '2' });
    const answer = await request('GET', `/admin/products?${query}`, undefined, signal);
    const products = Array.isArray(answer?.products) ? answer.products : [];
    const exact = products.filter(item => item?.handle === scope.handle);
    if (exact.length > 1) supplierFail(409, 'MEDUSA_RECEIPT_SCOPE_MISMATCH', 'More than one remote product carries this reviewed handle.');
    return exact[0] || null;
  }

  function inspect(scope, product) {
    if (product === null) return { status: 'not_found', found: false, complete: false, observedAt: at(), error: { code: 'MEDUSA_RECEIPT_NOT_FOUND' } };
    const expectedMarker = scope.action === 'draft' ? supplierHash(scope) : scope.draftScopeHash;
    if (!SUPPLIER_MEDUSA_TARGET.isProductId(product.id) || product.handle !== scope.handle || product.metadata?.[MARKER_DRAFT] !== expectedMarker || (scope.productId && product.id !== scope.productId))
      supplierFail(409, 'MEDUSA_RECEIPT_SCOPE_MISMATCH', 'The remote product does not carry this exact original draft marker.');
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const images = Array.isArray(product.images) ? product.images : [];
    const issues = [];
    if (!variants.length || variants.some(variant => !SUPPLIER_MEDUSA_TARGET.isVariantId(variant.id))) supplierFail(502, 'MEDUSA_RECEIPT_INCOMPLETE', 'The variant receipt has no distinct exact identity.');
    const variantSnapshot = variants.map(variant => ({
      id: variant.id, sku: variant.sku ?? null,
      prices: (variant.prices || []).map(price => ({ currencyCode: price.currency_code, amount: money(price.amount) })),
    }));
    const expectedPrices = scope.preview.variants.map(variant => money(variant.price ?? scope.preview.saleUnit.consumerPrice));
    const currency = scope.preview.market.currency.toLowerCase();
    const priced = variantSnapshot.every(variant => expectedPrices.some(expected => variant.prices.some(price => price.currencyCode === currency && price.amount === expected)));
    if (!priced) issues.push('retail_price_changed');
    if (images.length !== scope.preview.images.length) issues.push('media_scope_changed');
    if (product.title !== scope.preview.product.title) issues.push('product_content_changed');
    if (product.status !== 'draft' && scope.action !== 'publish') issues.push('product_status_changed');
    const remoteContentHash = supplierHash({
      title: product.title, description: product.description ?? '',
      variants: variantSnapshot,
      images: images.map(image => image.url),
      status: product.status,
    });
    const published = scope.action === 'publish' && product.status === 'published'
      && Array.isArray(product.sales_channels) && product.sales_channels.some(channel => channel.id === scope.salesChannelId)
      && product.metadata?.[MARKER_PUBLICATION] === supplierHash(scope);
    if (scope.action === 'publish' && !published) issues.push('publication_not_acknowledged');
    return {
      status: published && !issues.length ? 'published' : product.status === 'draft' ? 'medusa_draft' : 'unpublished',
      found: true, complete: !issues.length, readyForPublication: !issues.length && scope.action !== 'publish',
      productId: product.id, productStatus: product.status,
      variantIds: variants.map(variant => variant.id),
      handle: scope.handle, storeId: product.store_id ?? scope.storeId ?? null,
      salesChannelId: scope.salesChannelId ?? null, publicationId: scope.salesChannelId ?? null,
      published: published && !issues.length, publishedAt: null, publicationTimeSource: null,
      observedAt: at(), previewHash: scope.previewHash, remoteContentHash,
      mediaSnapshot: images.map(image => ({ id: image.id ?? null, url: image.url, rank: image.rank ?? null })),
      mediaIds: images.map(image => image.id ?? null), issues,
      externalStatus: published && !issues.length ? 'published' : product.status === 'draft' ? 'medusa_draft' : 'unpublished',
    };
  }

  async function reconcile(scope, { signal } = {}) {
    return inspect(scope, await lookup(scope, signal));
  }

  function optionsFor(scope) {
    if (Array.isArray(scope.preview.options) && scope.preview.options.length)
      return scope.preview.options.map(option => ({ title: option.name ?? option.title, values: [...option.values] }));
    return [{ title: 'Default', values: ['Default'] }];
  }
  function variantsFor(scope) {
    const currency = scope.preview.market.currency.toLowerCase();
    const source = Array.isArray(scope.preview.variants) && scope.preview.variants.length ? scope.preview.variants : null;
    if (!source) return [{
      title: 'Default', prices: [{ currency_code: currency, amount: money(scope.preview.saleUnit.consumerPrice) }],
      ...(scope.preview.variants?.[0]?.sku ? { sku: scope.preview.variants[0].sku } : {}),
      options: { Default: 'Default' },
    }];
    return source.map((variant, index) => ({
      title: variant.selectedOptions.map(option => option.value).join(' / ') || `Variant ${index + 1}`,
      options: Object.fromEntries(variant.selectedOptions.map(option => [option.name, option.value])),
      prices: [{ currency_code: currency, amount: money(variant.price) }],
      ...(variant.sku ? { sku: variant.sku } : {}),
    }));
  }
  function imagesFor(scope) {
    return scope.preview.images.map((image, index) => {
      if (image.kind !== 'public_url' || typeof image.url !== 'string' || !image.url.startsWith('https://'))
        supplierFail(409, 'MEDUSA_IMAGE_TRANSFER_UNSUPPORTED', `Image ${index + 1} is a private artifact; Medusa upload transfer is not part of this slice.`);
      return { url: image.url };
    });
  }

  const adapter = {
    target: SUPPLIER_MEDUSA_TARGET,
    status, fingerprint, reconcile,
    planRepair() { supplierFail(409, 'MEDUSA_REPAIR_UNSUPPORTED', 'Missing-step repair is not implemented for Medusa; reconcile the original draft and review it again.'); },
    capabilities: [...SUPPLIER_MEDUSA_ACTIONS],
    credentialEnvNames: ['WORKSPACE_MEDUSA_SECRET_API_KEY'],
    actionDescriptions: {
      'supplier.medusa.draft': 'Create one reviewed Medusa draft with its exact retail variants, prices and public images.',
      'supplier.medusa.publish': 'Publish the exact approved draft to one existing Medusa sales channel.',
      'supplier.medusa.repair_draft': 'Not implemented for Medusa; the adapter refuses instead of inventing a write.',
    },
    async execute({ action, payload: scope, binding, signal }) {
      if (binding?.type !== 'supplier-publication' || binding.operationId !== scope?.operationId || binding.scopeHash !== supplierHash(scope) || action !== `supplier.medusa.${scope.action}`)
        supplierFail(403, 'SUPPLIER_PUBLICATION_BINDING_REQUIRED', 'Only the original supplier approval can execute this adapter.');
      if (scope.action === 'repair_draft') supplierFail(409, 'MEDUSA_REPAIR_UNSUPPORTED', 'Missing-step repair is not implemented for Medusa.');
      if (scope.action === 'publish' && !SUPPLIER_MEDUSA_TARGET.isPublicationId(scope.salesChannelId))
        supplierFail(409, 'MEDUSA_SALES_CHANNEL_REQUIRED', 'Select one Medusa sales channel before reviewing publication.');
      const existing = await reconcile(scope.action === 'publish' ? scope.draftScope : scope, { signal });
      if (scope.action === 'draft') {
        if (existing.found) supplierFail(409, 'MEDUSA_EXISTING_DRAFT_RECONCILIATION_REQUIRED', 'The deterministic handle already exists. Reconcile it instead of creating another product.');
        if (!enabled) supplierFail(409, 'MEDUSA_PRODUCT_WRITE_NOT_AUTHORIZED', 'Supplier Medusa writes are explicitly disabled on this host.');
        const created = await request('POST', '/admin/products', {
          title: scope.preview.product.title,
          description: scope.preview.product.descriptionHtml ?? scope.preview.product.description ?? '',
          status: 'draft',
          handle: scope.handle,
          options: optionsFor(scope),
          variants: variantsFor(scope),
          images: imagesFor(scope),
          metadata: { [MARKER_DRAFT]: supplierHash(scope), workspace_id: scope.workspaceId, source_service_id: scope.serviceId },
        }, signal);
        if (!SUPPLIER_MEDUSA_TARGET.isProductId(created?.product?.id))
          supplierFail(502, 'MEDUSA_DRAFT_RECEIPT_INVALID', 'The original draft was not completely acknowledged.');
        return reconcile(scope, { signal });
      }
      if (!existing.found || !existing.complete || existing.productStatus !== 'draft')
        supplierFail(409, 'MEDUSA_DRAFT_CHANGED', 'Read and review the actual complete Medusa draft before publication.');
      const remote = await lookup(scope, signal);
      if (!remote) supplierFail(409, 'MEDUSA_DRAFT_CHANGED', 'The exact Medusa draft could not be read again before publication.');
      const updated = await request('POST', `/admin/products/${encodeURIComponent(existing.productId)}`, {
        status: 'published',
        sales_channels: [{ id: scope.salesChannelId }],
        metadata: { ...(remote.metadata || {}), [MARKER_PUBLICATION]: supplierHash(scope) },
      }, signal);
      if (!SUPPLIER_MEDUSA_TARGET.isProductId(updated?.product?.id))
        supplierFail(502, 'MEDUSA_PUBLICATION_RECEIPT_INVALID', 'The selected sales channel was not acknowledged.');
      return reconcile(scope, { signal });
    },
  };
  return adapter;
}
