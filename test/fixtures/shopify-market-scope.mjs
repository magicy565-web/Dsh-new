// Explicit in-memory source/approval/publication substitutes for reader tests.
// These are never reported as real shop, human review, payment or acquisition.
import { randomUUID } from 'node:crypto';
import { supplierHash as hash } from '../../server/supplier-profile.mjs';

export function seedMarketPublication(state, { actor, conversationId, productId = randomUUID(), skuCount = 4, unitsPerPack = 1 } = {}) {
  state.businessLibrary ||= { products: [], documents: [] };
  let product = state.businessLibrary.products.find(p => p.id === productId);
  if (!product) {
    product = { id: productId, revision: 1, status: 'active', images: [], skus: Array.from({ length: skuCount }, (_, i) => ({ id: randomUUID(), code: 'SYNTHETIC-' + i, specs: [{ key: 'Size', value: String(i) }] })) };
    state.businessLibrary.products.push(product);
  }
  const source = { productId, revision: product.revision, sourceHash: 'a'.repeat(64), images: structuredClone(product.images),
    skus: product.skus.map(s => ({ id: s.id, code: s.code, specs: s.specs })) };
  const preview = { previewHash: 'b'.repeat(64), images: product.images.map(i => ({ asset: i.asset })),
    saleUnit: { unit: 'piece', unitsPerPack, consumerPrice: '19.99' },
    variants: source.skus.map(s => ({ sourceSkuId: s.id, sku: s.code, price: '19.99', selectedOptions: s.specs.map(x => ({ name: x.key, value: x.value })) })) };
  const row = { id: randomUUID(), subject: actor.subject, workspaceId: actor.workspaceId, conversationId, revision: 1, preview, productSource: source,
    productReference: { productId, productRevision: product.revision }, publicationOperations: [] };
  const operationId = randomUUID(), variantIds = source.skus.map((s, i) => 'gid://shopify/ProductVariant/' + (9000 + i));
  const scope = { operationId, action: 'publish', subject: actor.subject, workspaceId: actor.workspaceId, conversationId, serviceId: row.id,
    serviceRevision: row.revision, previewHash: preview.previewHash, previewSnapshotHash: hash(preview), preview,
    shopId: 'gid://shopify/Shop/1', shopDomain: 'fixture-shop.myshopify.com', productId: 'gid://shopify/Product/123', variantIds,
    publicationId: 'gid://shopify/Publication/7', remoteContentHash: 'c'.repeat(64) };
  const receipt = { complete: true, found: true, published: true, issues: [], productId: scope.productId, variantIds, shopId: scope.shopId, shopDomain: scope.shopDomain,
    publicationId: scope.publicationId, previewHash: scope.previewHash, remoteContentHash: 'c'.repeat(64),
    variantReceipts: preview.variants.map((v, i) => ({ sourceSkuId: v.sourceSkuId, variantId: variantIds[i], reviewedSku: v.sku, reviewedPrice: v.price, selectedOptions: v.selectedOptions, matchesReviewedFields: true })) };
  const operation = { id: operationId, action: 'publish', status: 'succeeded', scope, scopeHash: hash(scope), receipt, approvalId: randomUUID(), connectorRunId: randomUUID() };
  row.publicationOperations.push(operation); row.external = { ...receipt, operationId };
  state.workspaceSupplierServices ||= { version: 1, services: [], monitors: [], commands: [] };
  state.workspaceSupplierServices.services.push(row);
  state.capabilities ||= { approvals: [] };
  state.capabilities.approvals.push({ id: operation.approvalId, status: 'consumed', payload: { binding: { type: 'supplier-publication', subject: actor.subject,
    workspaceId: actor.workspaceId, conversationId, serviceId: row.id, operationId, scopeHash: operation.scopeHash } } });
  return { row, operation, source, sources: [{ kind: 'factory-product', recordId: productId, revision: product.revision, workspaceId: actor.workspaceId }],
    launch: { productId: scope.productId, variantIds: [...variantIds], shopId: scope.shopId, conversationId,
      shopifyPublication: { serviceId: row.id, operationId, scopeHash: operation.scopeHash } } };
}
