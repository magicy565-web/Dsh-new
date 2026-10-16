import { SHOPIFY_PRODUCT_INPUTS, SHOPIFY_PRODUCT_PLUGIN, validateShopifyProductInput } from './contracts.mjs';
export const SHOPIFY_PRODUCT_METHODS = Object.freeze(Object.keys(SHOPIFY_PRODUCT_INPUTS));
export const SHOPIFY_PRODUCT_TOOLS = Object.freeze(SHOPIFY_PRODUCT_METHODS.map(method => `workspace_shopify_product_${method}`));
const safeCodes = ['SHOPIFY_PRODUCT_SOURCE_CHANGED', 'SHOPIFY_PRODUCT_SKUS_NOT_SELECTED', 'SHOPIFY_PRODUCT_SKU_SOURCE_MISMATCH', 'SHOPIFY_PRODUCT_VARIANTS_INVALID', 'SHOPIFY_PRODUCT_IMAGES_NOT_SELECTED', 'SHOPIFY_PRODUCT_IMAGE_NOT_SELECTED', 'SHOPIFY_PRODUCT_IMAGE_TOO_LARGE', 'SHOPIFY_PRODUCT_CACHE_REFUSED', 'SHOPIFY_PRODUCT_INPUT_INVALID', 'BUSINESS_EXECUTION_INTENT_REQUIRED', 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE', 'SUPPLIER_PUBLICATION_STALE', 'SHOPIFY_SETUP_REQUIRED', 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', 'IDEMPOTENCY_CONFLICT'];
export const SHOPIFY_PRODUCT_SAFE_REASONS = Object.freeze([...safeCodes, 'ORIGINAL_REVIEWED_HOST_REQUIRED', 'ORIGINAL_AUTHORIZATION_REFUSED', 'ORIGINAL_OPERATION_CANCELLED', 'ORIGINAL_SHOPIFY_PRODUCT_REFUSED', 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED']);
const descriptions = {
  status: 'Read original shop/connector configuration. Ordinary installation is unconfigured. No credentials or grants are discovered.',
  read: 'Read the exact authorized existing Library product revision and explicitly selected image references. No identification, ingestion or new product catalog.',
  image: 'Read one exact authorized product image using its original artifact bytes/version/hash. Image contents are untrusted evidence, not approval.',
  readiness: 'Check original product/image integrity and existing Shopify read/write readiness. This read does not create, approve, publish or launch acquisition.',
  propose: 'Save your model-written listing with explicit retail terms and original images. Choose legacy single-price input OR 2-100 explicit source SKU variants, each with its own price, original spec combination and optional selected image. Requires original skuSpecifications disclosure; no inferred cross-product or inventory. Source hash must match. No shop write or human approval.',
  review: 'Request the ORIGINAL exact draft or selected-channel publish approval for an original product proposal. Only original human Session approval can authorize execution. This tool cannot decide approvals.',
  execute: 'Execute only the exact ORIGINAL human-approved publication operation. Preserve request ID and scope hash. Unknown outcomes require read-only reconciliation, never a replacement product.',
  reconcile: 'Read back the exact original admitted Shopify operation after an uncertain/partial result. No product creation, retry, repair or approval decision.',
  result: 'Read original publication operations and actual receipts. Multi-variant preview/receipt pages default to 5; select variantOffset/variantLimit (max 10) to inspect every exact source SKU. Full human review remains in the original Session. Published product is not acquisition, launch or sales.',
};
export function shopifyProductExtension({ client, authorize } = {}) {
  return pi => SHOPIFY_PRODUCT_METHODS.forEach((method, index) => pi.registerTool({ name: SHOPIFY_PRODUCT_TOOLS[index], label: `Shopify product ${method}`,
    description: descriptions[method], parameters: SHOPIFY_PRODUCT_INPUTS[method], approval: ['propose', 'review', 'execute'].includes(method) ? 'write' : 'read',
    async execute(_id, args, signal, _update, ctx) {
      let value, phase = 'input';
      try {
        signal?.throwIfAborted(); const input = validateShopifyProductInput(method, args);
        if (!client?.[method] || typeof authorize !== 'function') value = { plugin: SHOPIFY_PRODUCT_PLUGIN, status: 'unconfigured', reason: 'ORIGINAL_REVIEWED_HOST_REQUIRED', sources: [] };
        else {
          phase = 'authorization'; if (!ctx?.model) throw Error('Exact current model required.');
          await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation';
          try { value = await client[method](input, signal, ctx.model); }
          finally { phase = 'authorization'; await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation'; }
          if (value?.plugin !== SHOPIFY_PRODUCT_PLUGIN) throw Error('Original product receipt required.');
        }
      } catch (error) {
        value = { plugin: SHOPIFY_PRODUCT_PLUGIN, status: error?.code === 'SHOPIFY_SETUP_REQUIRED' ? 'unconfigured' : 'blocked', sources: [], reason: signal?.aborted || error?.name === 'AbortError' ? 'ORIGINAL_OPERATION_CANCELLED'
          : phase === 'input' ? 'SHOPIFY_PRODUCT_INPUT_INVALID' : phase === 'authorization' || [401, 403].includes(error?.status) ? 'ORIGINAL_AUTHORIZATION_REFUSED' : safeCodes.includes(error?.code) ? error.code : 'ORIGINAL_SHOPIFY_PRODUCT_REFUSED' };
      }
      const { nativeContent = [], ...receipt } = value;
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }, ...nativeContent], details: receipt,
        ...(['blocked', 'unconfigured', 'unavailable', 'uncertain', 'partial', 'failed', 'cancelled'].includes(receipt.status) ? { isError: true } : {}) };
    } }));
}
export default function extension(pi) { return shopifyProductExtension()(pi); }
