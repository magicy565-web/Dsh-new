import test from 'node:test';
import assert from 'node:assert/strict';
import { createMedusaPublicationAdapter, createMedusaAdminClient, SUPPLIER_MEDUSA_TARGET } from '../server/medusa-publication.mjs';
import { supplierHash } from '../server/supplier-profile.mjs';

const ENV = {
  WORKSPACE_MEDUSA_BASE_URL: 'https://medusa.example.test',
  WORKSPACE_MEDUSA_SECRET_API_KEY: 'sk_synthetic_medusa_key_0001',
  WORKSPACE_MEDUSA_SALES_CHANNEL_ID: 'sc_default',
  WORKSPACE_SUPPLIER_MEDUSA_WRITES_ENABLED: '1',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function scopeFor(action = 'draft') {
  return {
    schema: 'workspace.supplier-publication-scope.v1', operationId: 'op-1', action, subject: 'owner', workspaceId: 'local',
    serviceId: 'svc-1', serviceRevision: 1, previewHash: 'a'.repeat(64), previewSnapshotHash: 'b'.repeat(64),
    handle: 'cnsub-printed-rayon',
    salesChannelId: 'sc_default', productId: action === 'publish' ? 'prod_existing' : null,
    draftScopeHash: 'c'.repeat(64),
    preview: {
      product: { title: 'Printed Rayon Voile', descriptionHtml: '<p>Lightweight printed rayon.</p>' },
      market: { currency: 'USD' },
      saleUnit: { consumerPrice: '21.50' },
      images: [{ kind: 'public_url', url: 'https://cdn.example.test/rayon.jpg' }],
      options: [{ name: 'Color', values: ['Ivory', 'Blue'] }],
      variants: [
        { price: '21.50', sku: 'RV-IVORY', selectedOptions: [{ name: 'Color', value: 'Ivory' }] },
        { price: '22.00', sku: 'RV-BLUE', selectedOptions: [{ name: 'Color', value: 'Blue' }] },
      ],
    },
  };
}

function remoteProduct(scope, overrides = {}) {
  return {
    id: 'prod_exists', handle: scope.handle, title: scope.preview.product.title,
    description: scope.preview.product.descriptionHtml, status: 'draft',
    metadata: { workspace_draft_intent: supplierHash(scope) },
    images: scope.preview.images.map((image, index) => ({ id: `img_${index}`, url: image.url, rank: index })),
    sales_channels: [],
    variants: scope.preview.variants.map((variant, index) => ({
      id: `variant_${index}`, sku: variant.sku,
      prices: [{ currency_code: 'usd', amount: Number(variant.price) }],
    })),
    ...overrides,
  };
}

function harness(initial = null) {
  const calls = [];
  let state = initial;
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST' && /^\/admin\/products$/u.test(new URL(url).pathname)) {
      const body = JSON.parse(init.body);
      state = {
        id: 'prod_created', handle: body.handle, title: body.title, description: body.description, status: 'draft',
        metadata: body.metadata, sales_channels: [],
        images: (body.images || []).map((image, index) => ({ id: `img_${index}`, url: image.url, rank: index })),
        variants: (body.variants || []).map((variant, index) => ({ id: `variant_${index}`, sku: variant.sku ?? null, prices: variant.prices })),
      };
      return json({ product: state });
    }
    if (init.method === 'POST' && /^\/admin\/products\/[^/]+$/u.test(new URL(url).pathname)) {
      const body = JSON.parse(init.body);
      state = { ...state, ...body };
      return json({ product: state });
    }
    return json({ products: state ? [state] : [], count: state ? 1 : 0 });
  };
  return { fetchImpl, calls, get state() { return state; } };
}

test('an unconfigured Medusa host stays fail-closed', async () => {
  const adapter = createMedusaPublicationAdapter({ environment: {}, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(adapter.status().configured, false);
  await assert.rejects(adapter.reconcile(scopeFor()), { code: 'MEDUSA_SETUP_REQUIRED' });
});

test('the target descriptor mirrors the Shopify contract', () => {
  assert.equal(SUPPLIER_MEDUSA_TARGET.adapter, 'workspace-supplier-medusa');
  assert.deepEqual([...SUPPLIER_MEDUSA_TARGET.actions].sort(), ['supplier.medusa.draft', 'supplier.medusa.publish', 'supplier.medusa.repair_draft']);
  assert.equal(SUPPLIER_MEDUSA_TARGET.actionName('draft'), 'supplier.medusa.draft');
  assert.ok(SUPPLIER_MEDUSA_TARGET.isProductId('prod_123'));
  assert.ok(SUPPLIER_MEDUSA_TARGET.isVariantId('variant_123'));
  assert.ok(SUPPLIER_MEDUSA_TARGET.isPublicationId('sc_123'));
  assert.equal(SUPPLIER_MEDUSA_TARGET.isProductId('gid://shopify/Product/1'), false);
  assert.equal(SUPPLIER_MEDUSA_TARGET.scopeFields({ storeId: 'store_1' }, { publicationId: 'sc_1' }).salesChannelId, 'sc_1');
});

test('reconcile accepts only the exact reviewed marker and prices', async () => {
  const scope = scopeFor('draft');
  const exact = harness(remoteProduct(scope));
  const adapter = createMedusaPublicationAdapter({ environment: ENV, fetchImpl: exact.fetchImpl });
  const receipt = await adapter.reconcile(scope);
  assert.equal(receipt.status, 'medusa_draft');
  assert.equal(receipt.complete, true);
  assert.equal(receipt.productId, 'prod_exists');
  assert.deepEqual(receipt.variantIds, ['variant_0', 'variant_1']);

  const wrongMarker = harness(remoteProduct(scope, { metadata: { workspace_draft_intent: 'f'.repeat(64) } }));
  const strict = createMedusaPublicationAdapter({ environment: ENV, fetchImpl: wrongMarker.fetchImpl });
  await assert.rejects(strict.reconcile(scope), { code: 'MEDUSA_RECEIPT_SCOPE_MISMATCH' });
});

test('draft creation refuses an existing handle and sends the reviewed payload', async () => {
  const scope = scopeFor('draft');
  const existing = harness(remoteProduct(scope, { handle: scope.handle }));
  const adapter = createMedusaPublicationAdapter({ environment: ENV, fetchImpl: existing.fetchImpl });
  await assert.rejects(adapter.execute({ action: 'supplier.medusa.draft', payload: scope, binding: { type: 'supplier-publication', operationId: scope.operationId, scopeHash: supplierHash(scope) } }), { code: 'MEDUSA_EXISTING_DRAFT_RECONCILIATION_REQUIRED' });

  const fresh = harness(null);
  const creator = createMedusaPublicationAdapter({ environment: ENV, fetchImpl: fresh.fetchImpl });
  const receipt = await creator.execute({ action: 'supplier.medusa.draft', payload: scope, binding: { type: 'supplier-publication', operationId: scope.operationId, scopeHash: supplierHash(scope) } });
  const create = fresh.calls.find(call => call.method === 'POST' && call.path === '/admin/products');
  assert.ok(create);
  assert.equal(create.body.status, 'draft');
  assert.equal(create.body.handle, scope.handle);
  assert.equal(create.body.options[0].title, 'Color');
  assert.deepEqual(create.body.variants.map(variant => variant.prices[0].amount), [21.5, 22]);
  assert.deepEqual(create.body.variants.map(variant => variant.options.Color), ['Ivory', 'Blue']);
  assert.equal(create.body.images[0].url, 'https://cdn.example.test/rayon.jpg');
  assert.equal(create.body.metadata.workspace_draft_intent, supplierHash(scope));
  assert.equal(receipt.complete, true);
  assert.equal(receipt.status, 'medusa_draft');
});

test('publish requires a sales channel and acknowledges it explicitly', async () => {
  const draft = scopeFor('draft');
  const product = remoteProduct(draft, { id: 'prod_existing' });
  const scope = { ...scopeFor('publish'), productId: 'prod_existing', draftScope: draft, draftScopeHash: supplierHash(draft) };
  product.metadata = { workspace_draft_intent: supplierHash(draft) };
  const harnessed = harness(product);
  const adapter = createMedusaPublicationAdapter({ environment: ENV, fetchImpl: harnessed.fetchImpl });
  await assert.rejects(adapter.execute({ action: 'supplier.medusa.publish', payload: { ...scope, salesChannelId: 'invalid' }, binding: { type: 'supplier-publication', operationId: scope.operationId, scopeHash: supplierHash({ ...scope, salesChannelId: 'invalid' }) } }), { code: 'MEDUSA_SALES_CHANNEL_REQUIRED' });

  const receipt = await adapter.execute({ action: 'supplier.medusa.publish', payload: scope, binding: { type: 'supplier-publication', operationId: scope.operationId, scopeHash: supplierHash(scope) } });
  const update = harnessed.calls.find(call => call.method === 'POST' && call.path === '/admin/products/prod_existing');
  assert.ok(update);
  assert.equal(update.body.status, 'published');
  assert.deepEqual(update.body.sales_channels, [{ id: 'sc_default' }]);
  assert.equal(receipt.status, 'published');
  assert.equal(receipt.published, true);
});

test('missing-step repair is refused instead of invented', async () => {
  const adapter = createMedusaPublicationAdapter({ environment: ENV, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.throws(() => adapter.planRepair(scopeFor('draft')), { code: 'MEDUSA_REPAIR_UNSUPPORTED' });
  await assert.rejects(adapter.execute({ action: 'supplier.medusa.repair_draft', payload: { ...scopeFor('draft'), action: 'repair_draft' }, binding: { type: 'supplier-publication', operationId: 'op-1', scopeHash: supplierHash({ ...scopeFor('draft'), action: 'repair_draft' }) } }), { code: 'MEDUSA_REPAIR_UNSUPPORTED' });
});

test('the read-only client reports identity, currency and explicit write scope', async () => {
  const client = createMedusaAdminClient({ environment: ENV, fetchImpl: async url => {
    if (url.includes('/admin/stores')) return json({ stores: [{ id: 'store_1', default_currency_code: 'usd' }] });
    return json({ sales_channels: [{ id: 'sc_default' }] });
  } });
  const verified = await client.verify();
  assert.equal(verified.storeId, 'store_1');
  assert.equal(verified.currency, 'usd');
  assert.deepEqual(verified.salesChannelIds, ['sc_default']);
  assert.deepEqual(verified.scopes, []);
  const reviewed = createMedusaAdminClient({ environment: { ...ENV, WORKSPACE_MEDUSA_KEY_SCOPE_REVIEWED: '1' }, fetchImpl: async url => url.includes('/admin/stores') ? json({ stores: [{ id: 'store_1', default_currency_code: 'usd' }] }) : json({ sales_channels: [] }) });
  assert.deepEqual((await reviewed.verify()).scopes, ['products:write']);
});
