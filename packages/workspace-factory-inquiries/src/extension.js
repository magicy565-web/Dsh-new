import { validateInquiryDrafts } from './drafts.mjs';
export const FACTORY_INQUIRY_TOOLS = Object.freeze(['workspace_factory_inquiry_save']);
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const source = object({ api: text(2000), kind: { enum: ['factory-document', 'factory-product'], type: 'string' }, workspaceId: text(1000), recordId: uuid,
  revision: { type: 'integer', minimum: 1 }, projectionSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  documentVersion: { type: 'integer', minimum: 1 }, artifactId: uuid, version: { type: 'integer', minimum: 1 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
  ['kind', 'workspaceId', 'recordId', 'revision', 'projectionSha256']);
export function factoryInquiriesExtension({ client, authorize } = {}) {
  return pi => pi.registerTool({ name: FACTORY_INQUIRY_TOOLS[0], label: 'Save unreviewed inquiry reply drafts',
    description: 'Persist one to five model-written Markdown drafts through original artifacts. First read authorized inquiry/product with the existing materials tools; supply their exact sources. Choose content and file count for the actual goal, or ask missing questions without saving. Original execution intent required. Sources/hash verify provenance, not semantic correctness or human approval. Never approves or sends.',
    parameters: object({ inquiryDocumentId: uuid, documentVersion: { type: 'integer', minimum: 1, maximum: 100 }, productId: uuid,
      sources: { type: 'array', items: source, minItems: 2, maxItems: 2 }, documents: { type: 'array', minItems: 1, maxItems: 5,
        items: object({ name: text(83), content: text(60000) }) }, requestId: text(128) }),
    async execute(_id, input, signal, _update, ctx) {
      let value;
      try {
        validateInquiryDrafts(input);
        if (typeof client?.save !== 'function' || typeof authorize !== 'function') value = { status: 'unconfigured', reason: 'ORIGINAL_REVIEWED_SESSION_CLIENT_REQUIRED' };
        else {
          if (!ctx?.model) throw Error('Current model required');
          signal?.throwIfAborted(); await authorize(signal, ctx.model);
          try { value = await client.save(input, signal, ctx.model); }
          finally { await authorize(signal, ctx.model); signal?.throwIfAborted(); }
        }
      } catch { value = { status: 'blocked', reason: 'ORIGINAL_INQUIRY_DRAFT_SAVE_REFUSED' }; }
      const receipt = { plugin: 'workspace-factory-inquiries', sources: [], ...value, humanReviewRequired: true, humanReviewed: false, sent: false, externalActions: false };
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt,
        ...(['blocked', 'unavailable'].includes(receipt.status) ? { isError: true } : {}) };
    } });
}
export default function extension(pi) { return factoryInquiriesExtension()(pi); }
