import { FACTORY_INQUIRY_INPUT, validateInquiryDrafts } from './contracts.mjs';
export const FACTORY_INQUIRY_TOOLS = Object.freeze(['workspace_factory_inquiry_save']);
export function factoryInquiriesExtension({ client, authorize } = {}) {
  return pi => pi.registerTool({ name: FACTORY_INQUIRY_TOOLS[0], label: 'Save unreviewed inquiry reply drafts',
    description: 'Persist one to five model-written Markdown drafts through original artifacts. First read authorized inquiry/product with the existing materials tools; supply their exact sources. Choose content and file count for the actual goal, or ask missing questions without saving. Original execution intent required. Sources/hash verify provenance, not semantic correctness or human approval. Never approves or sends.',
    parameters: FACTORY_INQUIRY_INPUT, approval: 'write',
    async execute(_id, input, signal, _update, ctx) {
      let value, phase = 'input';
      try {
        signal?.throwIfAborted(); input = validateInquiryDrafts(input);
        if (typeof client?.save !== 'function' || typeof authorize !== 'function') value = { status: 'unconfigured', reason: 'ORIGINAL_REVIEWED_SESSION_CLIENT_REQUIRED' };
        else if (!ctx?.model) value = { status: 'blocked', reason: 'EXACT_MODEL_RECEIVER_REQUIRED' };
        else {
          phase = 'authorization'; await authorize(signal, ctx.model); signal?.throwIfAborted();
          phase = 'operation';
          try { value = await client.save(input, signal, ctx.model); }
          finally { phase = 'authorization'; signal?.throwIfAborted(); await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation'; }
          phase = 'receipt';
          if (!value || value.plugin !== 'workspace-factory-inquiries' || !['saved-draft', 'partial', 'blocked', 'unavailable', 'unconfigured'].includes(value.status)
            || !Array.isArray(value.sources) || value.humanReviewed !== false || value.humanReviewRequired !== true || value.sent !== false || value.externalActions !== false)
            throw new Error('Invalid original save receipt.');
        }
      } catch (error) {
        const conflicts = ['FACTORY_INQUIRY_SOURCE_CHANGED', 'FACTORY_INQUIRY_REQUEST_CHANGED', 'FACTORY_INQUIRY_ARTIFACT_CHANGED', 'FACTORY_INQUIRY_SOURCE_REFUSED'];
        value = { status: 'blocked', reason: signal?.aborted || error?.name === 'AbortError' ? 'ORIGINAL_OPERATION_CANCELLED'
          : phase === 'input' ? 'FACTORY_INQUIRY_INPUT_INVALID'
          : phase === 'authorization' || [401, 403].includes(error?.status) ? 'ORIGINAL_AUTHORIZATION_REFUSED'
          : phase === 'receipt' ? 'INVALID_ORIGINAL_SAVE_RECEIPT'
          : conflicts.includes(error?.code) ? error.code : 'ORIGINAL_HOST_OPERATION_FAILED' };
      }
      const receipt = { plugin: 'workspace-factory-inquiries', sources: [], ...value, humanReviewRequired: true, humanReviewed: false, sent: false, externalActions: false };
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt,
        ...(['blocked', 'unavailable', 'unconfigured', 'partial'].includes(receipt.status) ? { isError: true } : {}) };
    } });
}
export default function extension(pi) { return factoryInquiriesExtension()(pi); }
