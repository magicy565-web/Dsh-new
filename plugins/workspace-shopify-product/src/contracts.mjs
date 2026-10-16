export const SHOPIFY_PRODUCT_PLUGIN = 'workspace-shopify-product';
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = (maxLength = 200) => ({ type: 'string', minLength: 1, maxLength });
const uuid = { ...text(36), pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const hash = { ...text(64), pattern: '^[a-f0-9]{64}$' };
const requestId = { ...text(128), pattern: '^[A-Za-z0-9_-]{1,128}$' };
const selector = { productId: uuid };
const operation = { serviceId: uuid, operationId: uuid, expectedScopeHash: hash, requestId };
const price = { ...text(24), pattern: '^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,6})?$' };
const list = (items, minItems, maxItems) => ({ type: 'array', minItems, maxItems, items });
const commonDraft = {
  title: text(), description: text(4000), targetMarket: { ...text(2), pattern: '^[A-Z]{2}$' }, currency: { ...text(3), pattern: '^[A-Z]{3}$' },
  retailUnit: text(), unitsPerPack: { type: 'integer', minimum: 1, maximum: 100000000 },
  handlingDays: { type: 'integer', minimum: 0, maximum: 3650 }, shippingDays: { type: 'integer', minimum: 0, maximum: 3650 },
  imageIds: { ...list(uuid, 1, 12), uniqueItems: true },
};
const multiDraft = object({ ...commonDraft,
  options: list(object({ name: text(100), values: { ...list(text(200), 1, 100), uniqueItems: true } }), 1, 3),
  variants: list(object({ sourceSkuId: uuid, skuCode: text(100), consumerPrice: price,
    optionValues: list(object({ name: text(100), value: text(200) }), 1, 3), imageId: uuid }, ['sourceSkuId', 'skuCode', 'consumerPrice', 'optionValues']), 2, 100),
});
export const shopifyOptionKey = value => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
export const shopifyCombinationKey = values => JSON.stringify(values.map(v => [shopifyOptionKey(v.name), shopifyOptionKey(v.value)]).sort((a, b) => a[0].localeCompare(b[0])));
export const SHOPIFY_PRODUCT_INPUTS = Object.freeze({
  status: object({}), read: object(selector), readiness: object(selector),
  image: object({ ...selector, imageId: uuid }),
  propose: object({ ...selector, sourceHash: hash, requestId, draft: { anyOf: [object({ ...commonDraft, consumerPrice: price, skuCode: { anyOf: [text(), { type: 'null' }] } }), multiDraft] } }),
  review: object({ serviceId: uuid, requestId, action: { enum: ['draft', 'publish'] }, publicationId: { ...text(100), pattern: '^gid://shopify/Publication/[0-9]+$' } }, ['serviceId', 'requestId', 'action']),
  execute: object(operation), reconcile: object(operation), result: object({ serviceId: uuid, operationId: uuid,
    variantOffset: { type: 'integer', minimum: 0, maximum: 99 }, variantLimit: { type: 'integer', minimum: 1, maximum: 10 } }, ['serviceId']),
});
function check(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(s => check(s, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(k => Object.hasOwn(schema.properties, k)) && schema.required.every(k => Object.hasOwn(value, k))
    && Object.entries(value).every(([k, v]) => check(schema.properties[k], v));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems
    && (!schema.uniqueItems || new Set(value).size === value.length) && value.every(v => check(schema.items, v));
  if (schema.type === 'string') return typeof value === 'string' && value.trim().length > 0 && value.length >= schema.minLength && value.length <= schema.maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value) && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  return true;
}
export function validateShopifyProductInput(method, value) {
  if (!Object.hasOwn(SHOPIFY_PRODUCT_INPUTS, method) || !check(SHOPIFY_PRODUCT_INPUTS[method], value)
    || method === 'propose' && !value.draft.variants && Number(value.draft.consumerPrice) <= 0
    || method === 'review' && (value.action === 'publish') !== Object.hasOwn(value, 'publicationId'))
    throw Object.assign(new TypeError('Use the closed Shopify product input; model approval and credential fields are forbidden.'), { code: 'SHOPIFY_PRODUCT_INPUT_INVALID' });
  if (method === 'propose' && value.draft.variants) {
    const { options, variants, imageIds } = value.draft;
    const unique = values => new Set(values).size === values.length;
    const invalid = !unique(options.map(o => shopifyOptionKey(o.name))) || options.some(o => !unique(o.values.map(shopifyOptionKey)))
      || !unique(variants.map(v => v.sourceSkuId)) || !unique(variants.map(v => shopifyOptionKey(v.skuCode)))
      || !unique(variants.map(v => shopifyCombinationKey(v.optionValues)))
      || variants.some(v => Number(v.consumerPrice) <= 0 || v.optionValues.length !== options.length || !unique(v.optionValues.map(o => shopifyOptionKey(o.name)))
        || options.some(o => !v.optionValues.some(x => x.name === o.name && o.values.includes(x.value))) || v.imageId && !imageIds.includes(v.imageId))
      || options.some(o => o.values.some(value => !variants.some(v => v.optionValues.some(x => x.name === o.name && x.value === value))));
    if (invalid) throw Object.assign(new TypeError('Use distinct source SKUs, explicit prices/combinations and selected original images; no invented cross-product or inventory.'), { code: 'SHOPIFY_PRODUCT_VARIANTS_INVALID' });
  }
  return structuredClone(value);
}
