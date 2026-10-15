// Thin original Library/artifact adapter. No model, writing template or loop.
import { ApiError } from './runtime.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { validateInquiryDrafts } from '../packages/workspace-factory-inquiries/src/drafts.mjs';
const fail = (status, code) => { throw new ApiError(status, code, 'Original authority, unchanged source references and unreviewed draft content are required.'); };
const flags = { humanReviewRequired: true, humanReviewed: false, sent: false, externalActions: false };
const selectors = input => ({ inquiryDocumentId: input.inquiryDocumentId, documentVersion: input.documentVersion, productId: input.productId });
export function createFactoryInquiryClient({ materialsClient, artifacts, store, identity, conversationId, runId = null, authorize, canSave }) {
  async function readSources(input, signal, model) {
    signal?.throwIfAborted(); await authorize();
    const inquiry = await materialsClient.document({ documentId: input.inquiryDocumentId, documentVersion: input.documentVersion }, signal, model);
    const materials = await materialsClient.materials({ productId: input.productId }, signal, model);
    await authorize();
    if (!['available', 'partial'].includes(inquiry.status) || materials.status !== 'available'
      || inquiry.authorization.workspaceId !== identity.workspaceId || inquiry.authorization.subject !== identity.subject
      || libraryReadHash(inquiry.authorization) !== libraryReadHash(materials.authorization)) fail(403, 'FACTORY_INQUIRY_SOURCE_REFUSED');
    return { authorization: inquiry.authorization, sources: [...inquiry.sources, ...materials.sources],
      extraction: { status: inquiry.document.status, notice: inquiry.document.notice ?? null, ocrStatus: inquiry.document.ocrStatus ?? 'unknown', textTruncated: inquiry.document.textTruncated ?? null } };
  }
  function assertCurrent(state, context, group, batchHash) {
    if (!canSave()) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
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
    if (state.artifacts.some(a => a.metadata?.factoryInquiry?.requestGroup === group && a.metadata.factoryInquiry.batchHash !== batchHash))
      fail(409, 'FACTORY_INQUIRY_REQUEST_CHANGED');
  }
  async function save(input, signal, model) {
    const selected = validateInquiryDrafts(input); await authorize();
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
        await authorize(); saved.push({ name: draft.name, artifactId: result.artifact.id, version: result.artifact.currentVersion, sha256: result.artifact.sha256, duplicate: result.duplicate === true });
      } catch (error) { if ([401, 403, 409].includes(error.status) || signal?.aborted) throw error; failed = true; break; }
    }
    await authorize();
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
    for (const ref of receipt.artifacts) {
      if (Object.keys(ref).some(k => !['name', 'artifactId', 'version', 'sha256', 'duplicate'].includes(k)) || typeof ref.duplicate !== 'boolean')
        throw Error('Cached inquiry artifact reference contains unvalidated content.');
      const record = artifacts.get(ref.artifactId).artifact, meta = record.metadata?.factoryInquiry;
      if (record.sourceConversationId !== conversationId || record.currentVersion !== ref.version || record.sha256 !== ref.sha256 || record.filename !== ref.name
        || meta?.humanReviewed !== false || meta.sent !== false || meta.humanReviewRequired !== true || meta.sourceHash !== receipt.sourceHash
        || meta.batchHash !== receipt.batchHash || libraryReadHash(meta.sources) !== libraryReadHash(context.sources)) throw Error('Cached inquiry artifact scope changed.');
      const file = await artifacts.download(ref.artifactId, { version: ref.version }); if (file.version.sha256 !== ref.sha256) throw Error('Cached inquiry artifact bytes changed.');
    }
    await authorize();
  }
  return Object.freeze({ save, revalidateReceipt });
}
