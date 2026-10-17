// Thin original Library/artifact adapter. No model, writing template or loop.
import { ApiError } from './runtime.mjs';
import { createHash } from 'node:crypto';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { validateInquiryDrafts } from '../plugins/workspace-factory-inquiries/src/contracts.mjs';
const fail = (status, code) => { throw new ApiError(status, code, 'Original authority, unchanged source references and unreviewed draft content are required.'); };
const flags = { humanReviewRequired: true, humanReviewed: false, sent: false, externalActions: false };
const selectors = input => ({ inquiryDocumentId: input.inquiryDocumentId, documentVersion: input.documentVersion, productId: input.productId });
// Node delivery reuses the original Host clients after worker exit. This reads
// native SDK context only; it creates no Session, authority, model or artifact.
export async function revalidateInquiryJournal(messages, { materialsClient, inquiryClient, model, signal }) {
  const materialTools = ['workspace_factory_materials_status', 'workspace_factory_materials', 'workspace_factory_document'];
  const reasons = ['ORIGINAL_REVIEWED_SESSION_CLIENT_REQUIRED', 'REVIEWED_LIBRARY_SESSION_AND_HOST_GUARD_REQUIRED',
    'EXACT_MODEL_RECEIVER_REQUIRED', 'ORIGINAL_OPERATION_CANCELLED', 'FACTORY_INQUIRY_INPUT_INVALID', 'FACTORY_MATERIAL_INPUT_INVALID',
    'ORIGINAL_AUTHORIZATION_REFUSED', 'INVALID_ORIGINAL_SAVE_RECEIPT', 'INVALID_ORIGINAL_READ_RECEIPT', 'ORIGINAL_HOST_OPERATION_FAILED',
    'FACTORY_INQUIRY_SOURCE_CHANGED', 'FACTORY_INQUIRY_REQUEST_CHANGED', 'FACTORY_INQUIRY_ARTIFACT_CHANGED', 'FACTORY_INQUIRY_SOURCE_REFUSED'];
  for (const message of messages) {
    signal?.throwIfAborted();
    if (message?.role !== 'toolResult' || message.toolName === 'workspace_skill') continue;
    const inquiry = message.toolName === 'workspace_factory_inquiry_save';
    if (!inquiry && !materialTools.includes(message.toolName)) throw Error('FACTORY_INQUIRY_JOURNAL_REFUSED');
    if (!Array.isArray(message.content) || message.content.some(block => block.type !== 'text' || typeof block.text !== 'string'))
      throw Error('FACTORY_INQUIRY_JOURNAL_REFUSED');
    let receipt;
    try { receipt = JSON.parse(message.content.map(block => block.text).join('\n')); }
    catch {
      // Native schema errors contain no Host data; earlier successful receipts
      // remain subject to their original source/Artifact checks below.
      if (message.isError === true && message.details === undefined) continue;
      throw Error('FACTORY_INQUIRY_JOURNAL_REFUSED');
    }
    if (!receipt || receipt.plugin !== (inquiry ? 'workspace-factory-inquiries' : 'workspace-factory-materials'))
      throw Error('FACTORY_INQUIRY_JOURNAL_REFUSED');
    if (['blocked', 'unconfigured', 'unavailable'].includes(receipt.status)) {
      if (!reasons.includes(receipt.reason) || !Array.isArray(receipt.sources) || receipt.sources.length
        || Object.keys(receipt).some(key => !['plugin', 'status', 'reason', 'sources', 'detail', ...Object.keys(flags)].includes(key))
        || Object.entries(flags).some(([key, value]) => key in receipt && receipt[key] !== value)
        || 'detail' in receipt && receipt.detail !== 'No reviewed original Library Session client and authorization guard were injected. No material was read. Agent Bearer credentials do not grant Library disclosure.')
        throw Error('FACTORY_INQUIRY_JOURNAL_REFUSED');
      continue;
    }
    const client = inquiry ? inquiryClient : materialsClient;
    if (typeof client?.revalidateReceipt !== 'function') throw Error('FACTORY_INQUIRY_JOURNAL_REFUSED');
    await client.revalidateReceipt(receipt, model, signal);
    signal?.throwIfAborted();
  }
}
export function createFactoryInquiryClient({ materialsClient, artifacts, store, identity, conversationId, runId = null, authorize, canSave }) {
  async function readSources(input, signal, model) {
    signal?.throwIfAborted(); await authorize();
    const inquiry = await materialsClient.document({ documentId: input.inquiryDocumentId, documentVersion: input.documentVersion }, signal, model);
    signal?.throwIfAborted();
    const materials = await materialsClient.materials({ productId: input.productId }, signal, model);
    signal?.throwIfAborted(); await authorize(); signal?.throwIfAborted();
    if (!['available', 'partial'].includes(inquiry.status) || materials.status !== 'available'
      || inquiry.authorization.workspaceId !== identity.workspaceId || inquiry.authorization.subject !== identity.subject
      || libraryReadHash(inquiry.authorization) !== libraryReadHash(materials.authorization)) fail(403, 'FACTORY_INQUIRY_SOURCE_REFUSED');
    return { authorization: inquiry.authorization, sources: [...inquiry.sources, ...materials.sources],
      extraction: { status: inquiry.document.status, notice: inquiry.document.notice ?? null, ocrStatus: inquiry.document.ocrStatus ?? 'unknown', textTruncated: inquiry.document.textTruncated ?? null } };
  }
  function assertSourcesCurrent(state, context) {
    if (Date.now() >= Date.parse(context.authorization.expiresAt)) fail(403, 'LIBRARY_READ_SCOPE_EXPIRED');
    for (const source of context.sources) {
      const row = state.businessLibrary[source.kind === 'factory-document' ? 'documents' : 'products'].find(r => r.id === source.recordId);
      if (!row || row.revision !== source.revision || source.workspaceId !== identity.workspaceId) fail(409, 'FACTORY_INQUIRY_SOURCE_CHANGED');
      if (source.kind === 'factory-document') {
        const asset = row.versions.find(v => v.version === source.documentVersion)?.asset;
        if (row.currentVersion !== source.documentVersion || asset?.artifactId !== source.artifactId || asset?.version !== source.version || asset?.sha256 !== source.sha256)
          fail(409, 'FACTORY_INQUIRY_SOURCE_CHANGED');
      }
    }
  }
  function assertCurrent(state, context, group, batchHash) {
    if (!canSave()) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
    assertSourcesCurrent(state, context);
    if (state.artifacts.some(a => a.metadata?.factoryInquiry?.requestGroup === group && a.metadata.factoryInquiry.batchHash !== batchHash))
      fail(409, 'FACTORY_INQUIRY_REQUEST_CHANGED');
  }
  async function save(input, signal, model) {
    signal?.throwIfAborted(); const selected = validateInquiryDrafts(input); await authorize(); signal?.throwIfAborted();
    if (!canSave()) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
    const context = await readSources(selected, signal, model);
    if (libraryReadHash(context.sources) !== libraryReadHash(selected.sources)) fail(409, 'FACTORY_INQUIRY_SOURCE_CHANGED');
    const sourceHash = libraryReadHash(context), batchHash = libraryReadHash({ context, documents: selected.documents });
    const group = libraryReadHash([identity.workspaceId, identity.subject, conversationId, selected.requestId]);
    assertCurrent(store.read(), context, group, batchHash);
    const saved = []; let failed = false;
    for (const draft of selected.documents) {
      await authorize(); signal?.throwIfAborted();
      try {
        const originalKey = 'factory-inquiry-' + libraryReadHash([group, draft.name]);
        const original = store.read().artifacts.find(a => a.requestId === originalKey), sourceRunId = original?.sourceRunId || runId;
        // Only provenance/review markers are fixed; the complete substantive body
        // comes from the model input. The server does not verify its truth.
        const content = 'Human review required. NOT SENT. Model draft; factual and commercial claims are unverified.\n\n'
          + draft.content + '\n\n---\nOriginal source references (not approval):\n' + JSON.stringify(context.sources, null, 2)
          + '\nExtraction limits: ' + JSON.stringify(context.extraction) + '\n';
        const result = await artifacts.create({ requestId: originalKey, filename: draft.name, content,
          description: 'Unreviewed model-written factory inquiry draft.', metadata: { businessLibrary: { visibility: 'internal' },
            factoryInquiry: { ...flags, requestGroup: group, batchHash, sourceHash, sources: context.sources, contentOrigin: 'model-draft-unverified' } },
          sourceConversationId: conversationId, ...(sourceRunId ? { sourceRunId } : {}) }, { check(state) { signal?.throwIfAborted(); assertCurrent(state, context, group, batchHash); } });
        const record = result.artifact, meta = record.metadata?.factoryInquiry;
        if (record.currentVersion !== 1 || record.sha256 !== createHash('sha256').update(content).digest('hex') || record.filename !== draft.name
          || record.sourceConversationId !== conversationId || meta?.requestGroup !== group || meta.batchHash !== batchHash || meta.sourceHash !== sourceHash
          || Object.entries(flags).some(([key, value]) => meta[key] !== value) || libraryReadHash(meta.sources) !== libraryReadHash(context.sources)) fail(409, 'FACTORY_INQUIRY_ARTIFACT_CHANGED');
        signal?.throwIfAborted(); await authorize(); signal?.throwIfAborted(); saved.push({ name: draft.name, artifactId: result.artifact.id, version: result.artifact.currentVersion, sha256: result.artifact.sha256, duplicate: result.duplicate === true });
      } catch (error) { if ([401, 403, 409].includes(error.status) || signal?.aborted) throw error; failed = true; break; }
    }
    signal?.throwIfAborted(); await authorize(); signal?.throwIfAborted();
    return { plugin: 'workspace-factory-inquiries', status: failed ? 'partial' : 'saved-draft', ...context, ...flags,
      input: selectors(selected), sourceHash, batchHash, artifacts: saved, ...(failed ? { reason: 'ORIGINAL_ARTIFACT_SAVE_INCOMPLETE' } : {}) };
  }
  async function revalidateReceipt(receipt, model, signal) {
    const fields = ['plugin', 'status', 'authorization', 'sources', 'extraction', ...Object.keys(flags), 'input', 'sourceHash', 'batchHash', 'artifacts', 'reason'];
    if (Object.keys(receipt).some(k => !fields.includes(k)) || receipt.plugin !== 'workspace-factory-inquiries'
      || !['partial', 'saved-draft'].includes(receipt.status) || Object.entries(flags).some(([k, v]) => receipt[k] !== v)
      || receipt.reason !== undefined && receipt.reason !== 'ORIGINAL_ARTIFACT_SAVE_INCOMPLETE'
      || !/^[a-f0-9]{64}$/.test(receipt.batchHash || '') || !Array.isArray(receipt.artifacts) || receipt.artifacts.length > 5
      || receipt.status === 'saved-draft' && receipt.artifacts.length < 1
      || new Set(receipt.artifacts.map(r => r.artifactId)).size !== receipt.artifacts.length
      || libraryReadHash(receipt.input) !== libraryReadHash(selectors(receipt.input))) throw Error('Cached inquiry receipt cannot claim approval or carry unvalidated content.');
    const context = await readSources(receipt.input, signal, model);
    if (libraryReadHash(context) !== receipt.sourceHash || libraryReadHash(context.sources) !== libraryReadHash(receipt.sources)
      || libraryReadHash(context.authorization) !== libraryReadHash(receipt.authorization)
      || libraryReadHash(context.extraction) !== libraryReadHash(receipt.extraction)) throw Error('Cached inquiry source, extraction or receiver changed.');
    const assertArtifactCurrent = ref => {
      if (Object.keys(ref).some(k => !['name', 'artifactId', 'version', 'sha256', 'duplicate'].includes(k)) || typeof ref.duplicate !== 'boolean')
        throw Error('Cached inquiry artifact reference contains unvalidated content.');
      const record = artifacts.get(ref.artifactId).artifact, meta = record.metadata?.factoryInquiry;
      if (record.sourceConversationId !== conversationId || record.currentVersion !== ref.version || record.sha256 !== ref.sha256 || record.filename !== ref.name
        || !meta || Object.entries(flags).some(([key, value]) => meta[key] !== value) || meta.sourceHash !== receipt.sourceHash
        || meta.batchHash !== receipt.batchHash || libraryReadHash(meta.sources) !== libraryReadHash(context.sources)) throw Error('Cached inquiry artifact scope changed.');
    };
    for (const ref of receipt.artifacts) {
      assertArtifactCurrent(ref);
      const file = await artifacts.download(ref.artifactId, { version: ref.version }); if (file.version.sha256 !== ref.sha256) throw Error('Cached inquiry artifact bytes changed.');
    }
    // Download and authorization await original services. Re-read the exact
    // source projection, then check synchronous current records after the last
    // await so changes during those reads cannot authorize a stale result.
    const finalContext = await readSources(receipt.input, signal, model);
    if (libraryReadHash(finalContext) !== receipt.sourceHash) throw Error('Cached inquiry source changed during artifact read.');
    signal?.throwIfAborted(); await authorize(); signal?.throwIfAborted();
    assertSourcesCurrent(store.read(), finalContext);
    for (const ref of receipt.artifacts) assertArtifactCurrent(ref);
  }
  return Object.freeze({ save, revalidateReceipt });
}
