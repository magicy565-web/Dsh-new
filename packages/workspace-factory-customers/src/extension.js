// A single injected original-artifact save adapter. The official model/tool
// loop selects public research tools; this package neither invokes nor orders them.
export const FACTORY_CUSTOMER_TOOLS = Object.freeze(['workspace_factory_customers_save']);
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function publicText(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum
    || /workspace-(?:factory-materials|library)|\b(?:authorization|scopeFingerprint|assets?|artifactId|artifactVersion|documentVersion|sessionFile|recipient|workspaceId|cookie|csrfToken|client_secret|api_key|access_token|refresh_token|password)\b\s*["']?\s*[:=]|\bBearer\s+|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|file:\/\/|(?:^|[\s"'])(?:\/(?:tmp|home|root|workspace|etc|var)\/|[A-Za-z]:\\)/iu.test(value)) throw new Error('Public draft input refused.');
  return value;
}
export function validateCustomerDrafts(input) {
  if (!exact(input, ['requestId', 'documents', 'sourceToolCallIds'])) throw new Error('Unexpected selectors.');
  publicText(input.requestId, 128);
  if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 5
    || !Array.isArray(input.sourceToolCallIds) || input.sourceToolCallIds.length < 1 || input.sourceToolCallIds.length > 20) throw new Error('Bounded documents and references required.');
  for (const document of input.documents) {
    if (!exact(document, ['name', 'content']) || typeof document.name !== 'string' || document.name.length > 100
      || !/^[A-Za-z0-9][A-Za-z0-9_-]*\.md$/u.test(document.name)) throw new Error('Safe Markdown name required.');
    publicText(document.content, 24000);
  }
  if (new Set(input.documents.map(row => row.name)).size !== input.documents.length
    || input.documents.reduce((sum, row) => sum + row.content.length, 0) > 60000
    || new Set(input.sourceToolCallIds).size !== input.sourceToolCallIds.length) throw new Error('Duplicate or oversized input.');
  for (const id of input.sourceToolCallIds) publicText(id, 200);
  return { requestId: input.requestId, documents: input.documents.map(({ name, content }) => ({ name, content })), sourceToolCallIds: [...input.sourceToolCallIds] };
}
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value,
  ...(['blocked', 'unavailable', 'unconfigured'].includes(value.status) ? { isError: true } : {}) });
const refused = (status, reason) => response({ plugin: 'workspace-factory-customers', status, reason, sources: [], sent: false, humanReviewRequired: true });
export function factoryCustomersExtension({ client, authorize } = {}) {
  return pi => pi.registerTool({ name: FACTORY_CUSTOMER_TOOLS[0], label: 'Save public customer research drafts',
    description: 'Only when requested, save model-written public customer research drafts through original Workspace artifacts. Reference exact successful original workspace_public_search/browser tool call IDs from this conversation. The Host verifies sources, current authority and idempotency. No research orchestration, business task, contact, sending or buyer verification.',
    parameters: schema({ requestId: string(128), documents: { type: 'array', minItems: 1, maxItems: 5,
      items: schema({ name: { ...string(100), pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*\\.md$' }, content: string(24000) }, ['name', 'content']) },
      sourceToolCallIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: string(200) } }, ['requestId', 'documents', 'sourceToolCallIds']),
    async execute(_id, input, signal, _update, ctx) {
      try {
        input = validateCustomerDrafts(input);
        if (typeof client?.save !== 'function' || typeof authorize !== 'function') return refused('unconfigured', 'ORIGINAL_ARTIFACT_SAVE_HOST_REQUIRED');
        if (!ctx?.model) return refused('blocked', 'EXACT_MODEL_RECEIVER_REQUIRED');
        signal?.throwIfAborted(); await authorize(signal, ctx.model); signal?.throwIfAborted();
        let saved;
        try { saved = await client.save(input, signal, ctx.model); }
        finally { await authorize(signal, ctx.model); signal?.throwIfAborted(); }
        if (!saved || saved.plugin !== 'workspace-factory-customers' || typeof saved.status !== 'string') throw new Error('Original save receipt required.');
        return response(saved);
      } catch {
        return refused('blocked', signal?.aborted ? 'ORIGINAL_OPERATION_CANCELLED' : 'PUBLIC_DRAFT_OR_ORIGINAL_HOST_OPERATION_REFUSED');
      }
    } });
}
export default function extension(pi) { return factoryCustomersExtension()(pi); }
