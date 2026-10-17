import { marketValidationMonitorExtension } from './monitor.js';
import { PRODUCT_INPUT_SCHEMA, SAVE_INPUT_SCHEMA, validateProductInput, validatePlanInput } from './plan.mjs';
export const MARKET_VALIDATION_TOOLS = Object.freeze(['workspace_market_validation_product', 'workspace_market_validation_plan_save']);
export function marketValidationExtension({ client, authorize } = {}) {
  return pi => {
    for (const [index, method, schema, validate] of [[0, 'read', PRODUCT_INPUT_SCHEMA, validateProductInput], [1, 'save', SAVE_INPUT_SCHEMA, validatePlanInput]]) {
      pi.registerTool({ name: MARKET_VALIDATION_TOOLS[index], label: index ? 'Save seven-day validation plan draft' : 'Read authorized original product',
        description: index ? 'Save a model-written editable B2B/B2C plan to original artifacts. Supply fresh original sources. Optional pre-service references keep TikTok/Amazon sample statistics separate; sales targets stay proposed until original prelaunch human confirmation. Every budget and commission is proposed, unapproved and unspent. No publishing, advertising, scheduling or seven-day start. Ask missing questions without saving if useful.'
          : 'Read one explicitly authorized original uploaded product revision and optional exact document versions through the existing materials client. Preserve missing/partial facts. No private field expansion, new upload, network discovery or supply claims.',
        parameters: schema, approval: method === 'save' ? 'write' : 'read',
        async execute(_id, input, signal, _update, ctx) {
          let receipt, phase = 'input';
          try {
            signal?.throwIfAborted();
            validate(input);
            if (typeof client?.[method] !== 'function' || typeof authorize !== 'function') receipt = { status: 'unconfigured', reason: 'REVIEWED_ORIGINAL_HOST_BINDING_REQUIRED', sources: [] };
            else {
              phase = 'authorization';
              if (!ctx?.model) throw Error('Current model receiver required.');
              signal?.throwIfAborted(); await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation';
              try { receipt = await client[method](input, signal, ctx.model); }
              finally { phase = 'authorization'; signal?.throwIfAborted(); await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation'; }
              if (receipt?.plugin !== 'workspace-market-validation' || !['available', 'partial', 'saved-draft'].includes(receipt.status)) throw Error('Original plan receipt required.');
            }
          } catch (error) { receipt = { status: 'blocked', sources: [], reason: signal?.aborted || error?.name === 'AbortError' ? 'ORIGINAL_OPERATION_CANCELLED' : phase === 'input' ? 'MARKET_PLAN_INPUT_INVALID' : phase === 'authorization' ? 'ORIGINAL_AUTHORIZATION_REFUSED' : ['MARKET_PLAN_SOURCE_CHANGED', 'MARKET_PLAN_REQUEST_CHANGED', 'MARKET_PLAN_CACHE_REFUSED', 'MARKET_PLAN_DOCUMENT_NOT_LINKED', 'MARKET_PLAN_SOURCE_REFUSED'].includes(error?.code) ? error.code : [401, 403].includes(error?.status) ? 'ORIGINAL_AUTHORIZATION_REFUSED' : 'ORIGINAL_MARKET_VALIDATION_REFUSED' }; }
          receipt = { ...receipt, plugin: 'workspace-market-validation', humanReviewRequired: true, humanReviewed: false, externalActions: false, startedAt: null };
          return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt, ...(['blocked', 'unavailable', 'unconfigured'].includes(receipt.status) ? { isError: true } : {}) };
        } });
    }
  };
}
// Normal manifest loading grants no ambient Session, credentials or effects.
export default function extension(pi) { let host; pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}}); marketValidationExtension({client:host?.planClient,authorize:host?.authorize})(pi); return marketValidationMonitorExtension({client:host?.monitorClient,authorize:host?.authorize})(pi); }
