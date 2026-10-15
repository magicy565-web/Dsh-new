// Read-only binding to ORIGINAL supplier operations. Never assemble a scope
// from model pages, infer SKU identities by position, or authorize a launch.
import { ApiError } from './runtime.mjs';
import { supplierHash as hash } from './supplier-profile.mjs';
import { assertSupplierProductSource } from './supplier-draft.mjs';

const fail = () => { throw new ApiError(409, 'SHOPIFY_MARKET_SCOPE_INVALID', 'Use the current complete original reviewed publication and its full source-SKU mapping.'); };
const gid = (kind, value) => typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/\\d+$`).test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const unique = values => new Set(values).size === values.length;
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && unique(a) && unique(b) && hash([...a].sort()) === hash([...b].sort());
const canonicalMappings = values => values.map(v => ({ sourceSkuId: v.sourceSkuId, variantId: v.variantId })).sort((a, b) => a.sourceSkuId.localeCompare(b.sourceSkuId));

export function readShopifyMarketScope({ state, actor, launch, sources }) {
  const ref = launch.shopifyPublication;
  if (!ref || Object.keys(ref).length !== 3 || !['serviceId', 'operationId', 'scopeHash'].every(k => typeof ref[k] === 'string') || !sha(ref.scopeHash)) fail();
  // The original monitor authorizes the live owner, including scheduled calls
  // that carry subject/workspace rather than an interactive Session role.
  const row = state.workspaceSupplierServices?.services.find(r => r.id === ref.serviceId && r.subject === actor.subject
    && r.workspaceId === actor.workspaceId && r.conversationId === launch.conversationId);
  if (!row) fail();
  assertSupplierProductSource(state, row);
  const operation = row.publicationOperations?.find(op => op.id === ref.operationId), scope = operation?.scope, receipt = operation?.receipt;
  const source = row.productSource, productSources = sources?.filter(s => s.kind === 'factory-product');
  if (!source || !sha(source.sourceHash) || productSources?.length !== 1 || productSources[0].recordId !== source.productId
    || productSources[0].revision !== source.revision || productSources[0].workspaceId !== actor.workspaceId
    || row.productReference?.productId !== source.productId || row.productReference.productRevision !== source.revision
    || row.cancelledAt || row.rejectedAt || !operation || operation.action !== 'publish' || operation.status !== 'succeeded'
    || operation.scopeHash !== ref.scopeHash || hash(scope) !== ref.scopeHash
    || scope.operationId !== operation.id || scope.action !== operation.action || scope.serviceId !== row.id
    || scope.subject !== actor.subject || scope.workspaceId !== actor.workspaceId || scope.conversationId !== launch.conversationId
    || scope.serviceRevision !== row.revision || scope.previewHash !== row.preview?.previewHash
    || scope.previewSnapshotHash !== hash(row.preview) || hash(scope.preview) !== hash(row.preview)
    || !receipt || receipt.complete !== true || receipt.found !== true || receipt.published !== true || receipt.issues?.length !== 0
    || !gid('Product', receipt.productId) || receipt.productId !== scope.productId || receipt.productId !== launch.productId
    || !gid('Shop', receipt.shopId) || receipt.shopId !== scope.shopId || receipt.shopId !== launch.shopId
    || receipt.shopDomain !== scope.shopDomain || !/^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/.test(receipt.shopDomain)
    || receipt.publicationId !== scope.publicationId || !gid('Publication', receipt.publicationId)
    || receipt.previewHash !== scope.previewHash || !sha(receipt.remoteContentHash) || receipt.remoteContentHash !== scope.remoteContentHash
    || row.external?.operationId !== operation.id || row.external.complete !== true || row.external.published !== true) fail();
  const approval = state.capabilities?.approvals.find(a => a.id === operation.approvalId), binding = approval?.payload?.binding;
  if (approval?.status !== 'consumed' || binding?.type !== 'supplier-publication' || binding.operationId !== operation.id
    || binding.scopeHash !== operation.scopeHash || binding.serviceId !== row.id || binding.subject !== actor.subject
    || binding.workspaceId !== actor.workspaceId || binding.conversationId !== launch.conversationId) fail();
  // Even a successful old operation cannot silently replace a later original
  // attempt, including a later partial/uncertain attempt.
  if (row.publicationOperations.slice(row.publicationOperations.indexOf(operation) + 1).some(op => op.connectorRunId)) fail();
  const expected = scope.preview.variants, mappings = receipt.variantReceipts, sourceSkus = source.skus;
  if (!Array.isArray(expected) || expected.length < 1 || expected.length > 100 || !Array.isArray(sourceSkus)
    || !Array.isArray(mappings) || mappings.length !== expected.length || sourceSkus.length !== expected.length
    || !sameSet(sourceSkus.map(s => s.id), expected.map(v => v.sourceSkuId))
    || !sameSet(mappings.map(v => v.sourceSkuId), expected.map(v => v.sourceSkuId))
    || !sameSet(mappings.map(v => v.variantId), receipt.variantIds)
    || !sameSet(receipt.variantIds, scope.variantIds) || !sameSet(receipt.variantIds, launch.variantIds)
    || !receipt.variantIds.every(v => gid('ProductVariant', v))) fail();
  for (const mapping of mappings) {
    const reviewed = expected.find(v => v.sourceSkuId === mapping.sourceSkuId), sku = sourceSkus.find(s => s.id === mapping.sourceSkuId);
    if (typeof mapping.sourceSkuId !== 'string' || !mapping.sourceSkuId || mapping.matchesReviewedFields !== true || !Array.isArray(mapping.selectedOptions)
      || mapping.reviewedSku !== reviewed.sku || sku.code !== reviewed.sku || mapping.reviewedPrice !== reviewed.price
      || hash(mapping.selectedOptions) !== hash(reviewed.selectedOptions)) fail();
  }
  const saleUnit = scope.preview.saleUnit;
  if (typeof saleUnit?.unit !== 'string' || !saleUnit.unit.trim() || !Number.isSafeInteger(saleUnit.unitsPerPack) || saleUnit.unitsPerPack < 1) fail();
  return { schema: 'workspace.shopify-market-scope.v1', salesScope: 'product_all_variants',
    libraryProductId: source.productId, libraryProductRevision: source.revision, sourceHash: source.sourceHash,
    sourceSnapshotHash: hash(source), serviceId: row.id, serviceRevision: row.revision,
    operationId: operation.id, publicationScopeHash: operation.scopeHash, remoteContentHash: receipt.remoteContentHash,
    shopId: receipt.shopId, shopDomain: receipt.shopDomain, productId: receipt.productId, publicationId: receipt.publicationId,
    variantIds: [...receipt.variantIds].sort(), mappings: canonicalMappings(mappings),
    saleUnit: { unit: saleUnit.unit, unitsPerPack: saleUnit.unitsPerPack },
    shopifyQuantityUnit: 'sale_units', outcomeQuantityUnit: 'physical_units' };
}

// A trusted resolver may return this binding only after the Store read above.
// The monitor keeps it in its original scopeHash and forwards it to its existing
// reviewed outcomeAdapter; no new adapter or payment inference is introduced.
export function validateShopifyMarketScope(value, launch) {
  if (!value || value.schema !== 'workspace.shopify-market-scope.v1' || value.salesScope !== 'product_all_variants'
    || value.productId !== launch.productId || value.shopId !== launch.shopId || !sameSet(value.variantIds, launch.variantIds)
    || !value.variantIds.length || !Array.isArray(value.mappings) || value.mappings.length !== value.variantIds.length
    || !unique(value.mappings.map(v => v.sourceSkuId)) || !sameSet(value.mappings.map(v => v.variantId), value.variantIds)
    || !sha(value.publicationScopeHash) || !sha(value.sourceHash) || !sha(value.sourceSnapshotHash)
    || value.shopifyQuantityUnit !== 'sale_units' || value.outcomeQuantityUnit !== 'physical_units'
    || !Number.isSafeInteger(value.saleUnit?.unitsPerPack) || value.saleUnit.unitsPerPack < 1) fail();
  return structuredClone(value);
}
