// Original-journal source lookup and original artifact persistence only.
import { ApiError } from './runtime.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { validateCustomerDrafts } from '../packages/workspace-factory-customers/src/extension.js';
const fail = (code, status = 409) => { throw new ApiError(status, code, 'Original successful source receipts and current draft-save authority are required.'); };
const flags = { humanReviewRequired: true, humanReviewed: false, sent: false, externalActions: false, verifiedBuyer: false, contactPermission: false };
const url = value => { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.port) fail('PUBLIC_SOURCE_URL_REFUSED'); return u.href; };
export function createFactoryCustomerDraftClient({ artifacts, store, identity, conversationId, runId, authorize, canSave, readJournal }) {
  async function save(input, signal) {
    input = validateCustomerDrafts(input); await authorize(); signal?.throwIfAborted();
    if (!canSave()) fail('BUSINESS_EXECUTION_INTENT_REQUIRED', 403);
    const entries = await readJournal(), sources = [];
    for (const callId of input.sourceToolCallIds) {
      const rows = entries.filter(e => e.message?.role === 'toolResult' && e.message.toolCallId === callId);
      if (rows.length !== 1) fail('ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED');
      const message = rows[0].message;
      if (message.isError || !['workspace_public_search', 'workspace_public_browser'].includes(message.toolName)) fail('ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED');
      const receipt = JSON.parse(message.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
      if (!Number.isFinite(Date.parse(receipt.observedAt))) fail('ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED');
      const refs = message.toolName === 'workspace_public_search' && receipt.status === 'sources_observed' ? receipt.sources
        : message.toolName === 'workspace_public_browser' && receipt.status === 'page_observed' ? [receipt] : [];
      if (!Array.isArray(refs) || refs.length < 1 || refs.length > 5) fail('ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED');
      sources.push({ toolCallId: callId, originalTool: message.toolName, receiptHash: libraryReadHash(receipt), observedAt: receipt.observedAt,
        observations: refs.map(ref => ({ url: url(ref.url), title: String(ref.title || '').slice(0, 400), excerpt: String(ref.excerpt || '').slice(0, 6000) })), provenance: 'public-web-unverified' });
    }
    if (Buffer.byteLength(JSON.stringify(sources)) > 10000) fail('PUBLIC_SOURCE_METADATA_LIMIT');
    const group = libraryReadHash([identity.workspaceId, identity.subject, conversationId, input.requestId]);
    const batchHash = libraryReadHash({ documents: input.documents, sources });
    const check = state => {
      signal?.throwIfAborted(); if (!canSave()) fail('BUSINESS_EXECUTION_INTENT_REQUIRED', 403);
      if (state.artifacts.some(a => a.metadata?.factoryCustomerDraft?.requestGroup === group && a.metadata.factoryCustomerDraft.batchHash !== batchHash)) fail('PUBLIC_DRAFT_REQUEST_CHANGED');
    };
    check(store.read()); const saved = []; let failed = false;
    for (const draft of input.documents) {
      await authorize(); signal?.throwIfAborted();
      try {
        const key = 'factory-customer-' + libraryReadHash([group, draft.name]);
        const original = store.read().artifacts.find(a => a.requestId === key);
        const result = await artifacts.create({ requestId: key, filename: draft.name,
          content: 'Human review required. NOT SENT. Unverified model draft; candidates are not verified buyers.\n\n' + draft.content
            + '\n\n---\nOriginal public source receipts (not approval):\n' + JSON.stringify(sources, null, 2) + '\n',
          description: 'Unreviewed public customer research draft.', metadata: { factoryCustomerDraft: { ...flags, requestGroup: group, batchHash, sources } },
          sourceConversationId: conversationId, sourceRunId: original?.sourceRunId || runId }, { check });
        await authorize(); saved.push({ name: draft.name, artifactId: result.artifact.id, version: result.artifact.currentVersion, sha256: result.artifact.sha256, duplicate: result.duplicate === true });
      } catch (error) { if ([401, 403, 409].includes(error.status) || signal?.aborted) throw error; failed = true; break; }
    }
    await authorize();
    return { plugin: 'workspace-factory-customers', status: failed ? 'partial' : 'saved-draft', ...flags, sources, artifacts: saved,
      ...(failed ? { reason: 'ORIGINAL_ARTIFACT_SAVE_INCOMPLETE' } : {}) };
  }
  return Object.freeze({ save });
}
