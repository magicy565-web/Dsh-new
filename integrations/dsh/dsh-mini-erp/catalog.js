import { ErpError } from './store.js';
const fail = (code, message) => { throw new ErpError(code, message); };

export function resolveSku(products, productId, skuId, quantity) {
  const product = products.find(p => p.id === productId);
  if (!product || product.status === 'archived') fail('CATALOG_UNAVAILABLE', 'Source product is missing or archived');
  const matches = product.skus.filter(s => s.id === skuId);
  if (matches.length !== 1) fail('CATALOG_UNAVAILABLE', 'SKU is missing or its source identity is ambiguous');
  const sku = matches[0];
  const q = quantity ?? Math.max(sku.moq ?? 1, sku.priceTiers[0]?.minQuantity ?? 1);
  if (!Number.isSafeInteger(q) || q < 1 || q > 1e9) fail('INPUT', 'quantity must be a positive integer');
  let reason = null, price = null, currency = null;
  if (sku.moq !== null && q < sku.moq) reason = 'Quantity is below the source MOQ';
  else if (sku.pricingMode !== 'tiered') reason = 'Source SKU requires an explicit quotation';
  else if (new Set(sku.priceTiers.map(t => t.currency)).size !== 1) reason = 'Price tiers use mixed currencies';
  else {
    const tier = sku.priceTiers.filter(t => t.minQuantity <= q).at(-1);
    if (!tier) reason = 'No price tier applies to this quantity';
    else if (!['USD', 'EUR', 'GBP', 'CNY'].includes(tier.currency) || !/^\d+(?:\.\d{1,2})?$/.test(tier.unitPrice)) reason = 'Price must use a supported currency and at most two decimal places';
    else {
      const [whole, fraction = ''] = tier.unitPrice.split('.');
      const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(minor) || minor > 1e9) reason = 'Price exceeds supported integer range';
      else { price = minor; currency = tier.currency; }
    }
  }
  return { productId, skuId, revision: product.revision, name: product.name, quantity: q,
    unitPriceMinor: price, currency, quoteStatus: reason ? 'required' : 'priced', quoteReason: reason,
    source: `workspace-library:${productId}/${skuId}@${product.revision}`, product, sku };
}

export function createErpService(store, { library, registry }) {
  function workspace(w) { if (!registry.list().some(r => r.id === w)) fail('WORKSPACE_REQUIRED', 'Select an existing workspace'); return w; }
  const withProducts = fn => {
    const current = library();
    if (!current?.withProducts) fail('CATALOG_UNAVAILABLE', 'The native product library is required');
    return current.withProducts(fn);
  };
  function decorate(w, row, products, quantity) {
    const link = store.link(w, row.id);
    if (!link) return { ...row, catalogStatus: 'legacy-unlinked' };
    try {
      const c = resolveSku(products, link.product_id, link.sku_id, quantity);
      return { ...row, name: c.name, currency: c.currency, unitPriceMinor: c.unitPriceMinor,
        allocationSource: row.source, source: c.source, catalogStatus: 'linked', catalogProductId: c.productId,
        skuId: c.skuId, skuCode: c.sku.code, catalogRevision: c.revision, quoteQuantity: c.quantity,
        quoteStatus: c.quoteStatus, quoteReason: c.quoteReason, description: c.product.description,
        category: c.product.category, specs: c.sku.specs, unit: c.sku.unit, moq: c.sku.moq,
        leadTimeDays: c.sku.leadTimeDays, priceTiers: c.sku.priceTiers, supply: c.product.supply,
        images: c.product.images, documents: c.product.documents };
    } catch (e) {
      if (e.code !== 'CATALOG_UNAVAILABLE') throw e;
      return { ...row, currency: null, unitPriceMinor: null, catalogStatus: 'unavailable', quoteStatus: 'required',
        quoteReason: e.message, catalogProductId: link.product_id, skuId: link.sku_id };
    }
  }
  function readFrom(w, input, products) {
    const { quantity, ...query } = input;
    if (quantity !== undefined && (!['product', 'supply'].includes(query.entity) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1e9)) fail('INPUT', 'quantity is only supported for product/supply quotes');
    const result = store.read(w, query);
    if (input.entity === 'product') return result.items
      ? { ...result, items: result.items.map(p => decorate(w, p, products, quantity)) }
      : decorate(w, result, products, quantity);
    if (input.entity === 'supply') return { ...result, product: decorate(w, result.product, products, quantity) };
    return result;
  }
  return {
    workspaces: () => registry.list().map(({ id, title }) => ({ id, title })),
    overview(w) { workspace(w); return store.overview(w); },
    async catalog() {
      return withProducts(products => ({ items: products.filter(p => p.status !== 'archived').map(p => ({ id: p.id, name: p.name, revision: p.revision, category: p.category,
        skus: p.skus.map(s => ({ id: s.id, code: s.code, unit: s.unit, pricingMode: s.pricingMode })) })) }));
    },
    async read(w, input) {
      workspace(w);
      if (['product', 'supply'].includes(input.entity)) {
        if (!library()?.withProducts) return readFrom(w, input, []);
        return withProducts(products => readFrom(w, input, products));
      }
      return readFrom(w, input, []);
    },
    async write(w, input, actor, check = () => {}) {
      workspace(w); check();
      if (!input || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.requestId)) fail('INPUT', 'A valid requestId is required');
      // An already committed request is safe to replay even if its source was later archived.
      if (store.prior(w, input.requestId)) {
        const result = store.write(w, input, actor);
        if (result.entity === 'product') result.current = await this.read(w, { entity: 'product', id: result.id });
        return result;
      }
      if (['add_product', 'update_product'].includes(input.action)) fail('CATALOG_AUTHORITY', 'Create/edit products and prices in the native product library; link SKU or update allocation here');
      if (input.action === 'link_sku' || input.action === 'reserve' && store.link(w, input.productId)) {
        return withProducts(products => {
          check(); workspace(w);
          const link = input.action === 'link_sku' ? { product_id: input.catalogProductId, sku_id: input.skuId } : store.link(w, input.productId);
          const c = resolveSku(products, link.product_id, link.sku_id, input.action === 'reserve' ? input.quantity : undefined);
          const expected = input.action === 'link_sku' ? input.catalogRevision : input.expectedCatalogRevision;
          if (expected !== c.revision) fail('CATALOG_CHANGED', 'Source product changed; read it again');
          if (input.action === 'reserve' && c.unitPriceMinor === null) fail('QUOTE_REQUIRED', c.quoteReason);
          const result = store.write(w, input, actor, c);
          if (result.entity === 'product') result.current = decorate(w, result.current, products);
          return result;
        });
      }
      const result = store.write(w, input, actor);
      if (result.entity === 'product') result.current = await this.read(w, { entity: 'product', id: result.id });
      return result;
    },
  };
}
