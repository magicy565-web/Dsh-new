import { PRODUCT_INPUT_SCHEMA, SAVE_INPUT_SCHEMA, validateProductInput, validatePlanInput } from './plan.mjs';
export const MARKET_VALIDATION_TOOLS = Object.freeze(['workspace_market_validation_product', 'workspace_market_validation_plan_save']);
export function marketValidationExtension({ client, authorize } = {}) {
  return pi => {
    for (const [index, method, schema, validate] of [[0, 'read', PRODUCT_INPUT_SCHEMA, validateProductInput], [1, 'save', SAVE_INPUT_SCHEMA, validatePlanInput]]) {
      pi.registerTool({ name: MARKET_VALIDATION_TOOLS[index], label: index ? 'Save seven-day validation plan draft' : 'Read authorized original product',
        description: index ? 'Save a model-written editable B2B/B2C plan to original artifacts. Supply fresh original sources. Every budget and commission is proposed, unapproved and unspent. No publishing, advertising, scheduling or seven-day start. Ask missing questions without saving if useful.'
          : 'Read one explicitly authorized original uploaded product revision and optional exact document versions through the existing materials client. Preserve missing/partial facts. No private field expansion, new upload, network discovery or supply claims.',
        parameters: schema,
        async execute(_id, input, signal, _update, ctx) {
          let receipt;
          try {
            validate(input);
            if (typeof client?.[method] !== 'function' || typeof authorize !== 'function') receipt = { status: 'unconfigured', reason: 'REVIEWED_ORIGINAL_HOST_BINDING_REQUIRED', sources: [] };
            else {
              if (!ctx?.model) throw Error('Current model receiver required.');
              signal?.throwIfAborted(); await authorize(signal, ctx.model);
              try { receipt = await client[method](input, signal, ctx.model); }
              finally { await authorize(signal, ctx.model); signal?.throwIfAborted(); }
              if (receipt?.plugin !== 'workspace-market-validation' || !['available', 'partial', 'saved-draft'].includes(receipt.status)) throw Error('Original plan receipt required.');
            }
          } catch { receipt = { status: 'blocked', reason: 'ORIGINAL_MARKET_VALIDATION_REFUSED', sources: [] }; }
          receipt = { ...receipt, plugin: 'workspace-market-validation', humanReviewRequired: true, humanReviewed: false, externalActions: false, startedAt: null };
          return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt, ...(receipt.status === 'blocked' ? { isError: true } : {}) };
        } });
    }
  };
}
// Normal manifest loading grants no ambient Session, credentials or effects.
export default function extension(pi) { return marketValidationExtension()(pi); }
