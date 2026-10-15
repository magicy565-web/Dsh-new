// A single injected original-artifact save adapter. The official model/tool
// loop selects public research tools; this package neither invokes nor orders them.
export const FACTORY_CUSTOMER_TOOLS = Object.freeze(['workspace_factory_customers_save']);
import { FACTORY_CUSTOMER_INPUT, validateCustomerDrafts } from './contracts.mjs';
export { validateCustomerDrafts } from './contracts.mjs';
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value,
  ...(['blocked', 'unavailable', 'unconfigured', 'partial'].includes(value.status) ? { isError: true } : {}) });
const refused = (status, reason) => response({ plugin: 'workspace-factory-customers', status, reason, sources: [], sent: false, humanReviewed: false, humanReviewRequired: true, externalActions: false, verifiedBuyer: false, contactPermission: false });
export function factoryCustomersExtension({ client, authorize } = {}) {
  return pi => pi.registerTool({ name: FACTORY_CUSTOMER_TOOLS[0], label: 'Save public customer research drafts',
    description: 'Only when requested, save model-written public customer research drafts through original Workspace artifacts. Reference exact successful original workspace_public_search/browser tool call IDs from this conversation. The Host verifies sources, current authority and idempotency. No research orchestration, business task, contact, sending or buyer verification.',
    parameters: FACTORY_CUSTOMER_INPUT, approval: 'write',
    async execute(_id, input, signal, _update, ctx) {
      let phase = 'input';
      try {
        signal?.throwIfAborted(); input = validateCustomerDrafts(input);
        if (typeof client?.save !== 'function' || typeof authorize !== 'function') return refused('unconfigured', 'ORIGINAL_ARTIFACT_SAVE_HOST_REQUIRED');
        if (!ctx?.model) return refused('blocked', 'EXACT_MODEL_RECEIVER_REQUIRED');
        phase = 'authorization'; await authorize(signal, ctx.model); signal?.throwIfAborted();
        let saved;
        phase = 'operation';
        try { saved = await client.save(input, signal, ctx.model); }
        finally { phase = 'authorization'; signal?.throwIfAborted(); await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation'; }
        phase = 'receipt';
        if (!saved || saved.plugin !== 'workspace-factory-customers' || !['saved-draft', 'partial', 'blocked', 'unavailable', 'unconfigured'].includes(saved.status)
          || !Array.isArray(saved.sources) || saved.sent !== false || saved.humanReviewed !== false || saved.humanReviewRequired !== true
          || saved.externalActions !== false || saved.verifiedBuyer !== false || saved.contactPermission !== false) throw new Error('Invalid original save receipt.');
        return response(saved);
      } catch (error) {
        const conflicts = ['PUBLIC_DRAFT_REQUEST_CHANGED', 'PUBLIC_DRAFT_ARTIFACT_CHANGED', 'ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED', 'PUBLIC_SOURCE_URL_REFUSED', 'PUBLIC_SOURCE_METADATA_LIMIT'];
        return refused('blocked', signal?.aborted || error?.name === 'AbortError' ? 'ORIGINAL_OPERATION_CANCELLED'
          : phase === 'input' ? 'FACTORY_CUSTOMER_INPUT_INVALID'
          : phase === 'authorization' || [401, 403].includes(error?.status) ? 'ORIGINAL_AUTHORIZATION_REFUSED'
          : phase === 'receipt' ? 'INVALID_ORIGINAL_SAVE_RECEIPT'
          : conflicts.includes(error?.code) ? error.code : 'ORIGINAL_HOST_OPERATION_FAILED');
      }
    } });
}
export default function extension(pi) { return factoryCustomersExtension()(pi); }
