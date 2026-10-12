import { createHash } from 'node:crypto';

export class SupplierServiceError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { name: 'SupplierServiceError', status, code }); }
}
export const supplierFail = (status, code, message) => { throw new SupplierServiceError(status, code, message); };
export const SUPPLIER_FIELDS = Object.freeze(['name', 'description', 'targetMarket', 'currency', 'skuCode', 'supplierUnit', 'supplierMoq', 'wholesaleUnitPrice', 'wholesaleCurrency', 'internalUnitCost', 'internalCostCurrency', 'recommendedRetailPrice', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'productionDays', 'handlingDays', 'shippingDays', 'images']);
export const PUBLIC_LISTING_FIELDS = Object.freeze(['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images']);
const money = new Set(['wholesaleUnitPrice', 'internalUnitCost', 'recommendedRetailPrice', 'consumerPrice']);
const days = new Set(['productionDays', 'handlingDays', 'shippingDays']);
const currencies = new Set(['currency', 'wholesaleCurrency', 'internalCostCurrency']);
export const canonicalSupplier = value => Array.isArray(value) ? '[' + value.map(canonicalSupplier).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalSupplier(value[key])).join(',') + '}' : JSON.stringify(value);
export const supplierHash = value => createHash('sha256').update(canonicalSupplier(value)).digest('hex');
export const blankSupplierProfile = () => Object.fromEntries(SUPPLIER_FIELDS.map(field => [field, field === 'images' ? [] : null]));
export function supplierObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Use only the documented supplier service fields.');
}
export function normalizeSupplierProfile(input, previous = blankSupplierProfile()) {
  supplierObject(input, SUPPLIER_FIELDS);
  const result = structuredClone(previous);
  for (const [field, value] of Object.entries(input)) {
    if (field === 'images') {
      if (!Array.isArray(value) || value.length > 12) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Use at most twelve image sources.');
      result.images = value.map(image => {
        supplierObject(image, ['kind', 'url', 'asset', 'sourceNote']);
        if (typeof image.sourceNote !== 'string' || !image.sourceNote.trim() || image.sourceNote.length > 500) supplierFail(400, 'SUPPLIER_IMAGE_SOURCE_REQUIRED', 'Each image needs an explicit provenance note.');
        if (image.kind === 'artifact') {
          supplierObject(image.asset, ['artifactId', 'version', 'sha256']);
          if (image.url !== undefined || !/^[a-f0-9-]{36}$/.test(image.asset.artifactId) || !Number.isSafeInteger(image.asset.version) || image.asset.version < 1 || !/^[a-f0-9]{64}$/.test(image.asset.sha256)) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Use the original file/version/SHA image reference.');
          return { kind: 'artifact', asset: structuredClone(image.asset), sourceNote: image.sourceNote.trim() };
        }
        let url;
        try { url = new URL(image.url); } catch { supplierFail(400, 'SUPPLIER_IMAGE_SOURCE_REQUIRED', 'Use a documented HTTPS image source.'); }
        if (image.kind !== 'public_url' || image.asset !== undefined || url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /(?:localhost|\.local|\.internal)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Image URL must use a public HTTPS hostname without credentials.');
        return { kind: 'public_url', url: url.href, sourceNote: image.sourceNote.trim() };
      });
      continue;
    }
    if (value === null) { result[field] = null; continue; }
    if (days.has(field) || ['supplierMoq', 'unitsPerPack'].includes(field)) {
      if (!Number.isSafeInteger(value) || value < (days.has(field) ? 0 : 1) || value > (days.has(field) ? 3650 : 100000000)) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Use explicit integer durations, quantities or null.');
    } else if (typeof value !== 'string' || !value.trim() || value.length > (field === 'description' ? 4000 : 200) || /[\u0000-\u001f\u007f]/u.test(value)) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Use bounded explicit product facts or null.');
    if (money.has(field) && (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(value) || Number(value) <= 0)) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Money requires a positive decimal string; it is not inferred from another price.');
    if (currencies.has(field) && !/^[A-Z]{3}$/.test(value) || field === 'targetMarket' && !/^[A-Z]{2}$/.test(value)) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Specify an explicit market country code and currency.');
    result[field] = typeof value === 'string' ? value.trim() : value;
  }
  return result;
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function supplierListingPreview(profile, publicFields, imageAvailability = []) {
  if (!Array.isArray(publicFields) || new Set(publicFields).size !== publicFields.length || publicFields.some(field => !PUBLIC_LISTING_FIELDS.includes(field))) supplierFail(400, 'SUPPLIER_PUBLIC_FIELDS_INVALID', 'Supplier MOQ, wholesale price, internal cost, recommended price and production time are private; select retail fields explicitly.');
  const publicValue = field => publicFields.includes(field) ? profile[field] : null;
  const missingFields = ['name', 'description', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays'].filter(field => publicValue(field) === null);
  for (const field of ['targetMarket', 'currency']) if (profile[field] === null) missingFields.push(field);
  const images = publicFields.includes('images') ? profile.images.map((image, index) => ({ ...image, availability: imageAvailability[index] || 'unknown', transferStatus: image.kind === 'artifact' ? 'private_file_requires_reviewed_transfer' : 'unverified_remote_source' })) : [];
  if (!images.some(image => image.availability === 'available')) missingFields.push('usableImage');
  const paragraphs = [publicValue('description'), publicValue('unitsPerPack') === null ? null : `包装数量：${profile.unitsPerPack} ${publicValue('retailUnit') || ''}`, publicValue('handlingDays') === null ? null : `处理及发货：${profile.handlingDays} 天`, publicValue('shippingDays') === null ? null : `运输：${profile.shippingDays} 天`].filter(value => value !== null);
  return { schema: 'workspace.supplier-listing.v1', phase: missingFields.length ? 'needs_information' : 'preview_ready', missingFields,
    market: { countryCode: profile.targetMarket, currency: profile.currency },
    saleUnit: { unit: publicValue('retailUnit'), unitsPerPack: publicValue('unitsPerPack'), consumerPrice: publicValue('consumerPrice') },
    product: { title: publicValue('name'), descriptionHtml: paragraphs.map(value => '<p>' + escape(value) + '</p>').join(''), status: 'DRAFT' },
    variants: [{ sku: publicValue('skuCode'), price: publicValue('consumerPrice') }], images,
    fulfillment: { handlingDays: publicValue('handlingDays'), shippingDays: publicValue('shippingDays') },
    display: { title: publicValue('name'), paragraphs, imageStatus: images.some(image => image.availability === 'available') ? 'available' : images.length ? 'unknown' : 'missing' },
    externalStatus: 'preview', published: false, shopifyProductId: null, publicFields: [...publicFields] };
}
