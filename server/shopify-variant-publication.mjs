// Pure projection/comparison for the ORIGINAL publisher. No transport, task,
// credentials, persistence or retry. Review contains only explicit source SKUs.
import { supplierHash, supplierFail } from './supplier-profile.mjs';
import { shopifyCombinationKey } from '../packages/workspace-shopify-product/src/contracts.mjs';
export const multiVariantPreview = scope => Array.isArray(scope.preview.options);
export function inspectReviewedVariants(scope, product, mediaIds, acknowledgedIds, normalizeMoney) {
  const expected = scope.preview.variants, actual = product.variants.nodes, issues = [];
  const options = product.options?.map(o => ({ name: o.name, values: o.optionValues?.map(v => v.name) }));
  if (supplierHash(options || null) !== supplierHash(scope.preview.options)) issues.push('variant_options_changed');
  const validOptions = v => Array.isArray(v.selectedOptions) && v.selectedOptions.length <= 3
    && v.selectedOptions.every(o => typeof o.name === 'string' && typeof o.value === 'string');
  if (actual.some(v => !validOptions(v) || !Array.isArray(v.media?.nodes) || v.media.pageInfo?.hasNextPage !== false
    || v.media.nodes.some(m => !/^gid:\/\/shopify\/MediaImage\/\d+$/.test(m.id)))) supplierFail(409, 'SHOPIFY_RECEIPT_INCOMPLETE', 'The variant options/media receipt is incomplete.');
  const byCombination = new Map();
  for (const v of actual) {
    const key = shopifyCombinationKey(v.selectedOptions);
    if (byCombination.has(key)) issues.push('retail_variant_changed');
    byCombination.set(key, v);
  }
  if (actual.length !== expected.length) issues.push('retail_variant_changed');
  const variantReceipts = expected.map(e => {
    const a = byCombination.get(shopifyCombinationKey(e.selectedOptions));
    const ordered = scope.preview.options.map(o => a?.selectedOptions.find(x => x.name === o.name));
    const selectedMedia = e.imageIndex === null ? [] : [mediaIds?.[e.imageIndex]];
    const matchesReviewedFields = !!a && a.sku === e.sku && normalizeMoney(a.price) === normalizeMoney(e.price)
      && supplierHash(ordered) === supplierHash(e.selectedOptions) && supplierHash(a.media.nodes.map(m => m.id)) === supplierHash(selectedMedia);
    if (!matchesReviewedFields) issues.push('retail_variant_changed');
    return { sourceSkuId: e.sourceSkuId, variantId: a?.id || null, reviewedSku: e.sku, reviewedPrice: e.price,
      selectedOptions: e.selectedOptions, mediaId: e.imageIndex === null ? null : mediaIds?.[e.imageIndex] || null, matchesReviewedFields };
  });
  if (acknowledgedIds && supplierHash([...acknowledgedIds].sort()) !== supplierHash(actual.map(v => v.id).sort())) issues.push('variant_identity_changed');
  const snapshot = actual.map(v => ({ id: v.id, sku: v.sku, price: normalizeMoney(v.price), selectedOptions: [...v.selectedOptions].sort((a, b) => a.name.localeCompare(b.name)), mediaIds: v.media.nodes.map(m => m.id) })).sort((a, b) => a.id.localeCompare(b.id));
  return { issues: [...new Set(issues)], variantReceipts, snapshot, options: options || null,
    variantEvidence: acknowledgedIds ? 'acknowledged_ids_and_exact_readback' : 'readback_only_original_attempt_unacknowledged', inventory: 'unknown_not_written' };
}
