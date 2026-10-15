// Thin draft preparation and original artifact dispatch. The original Library
// policy, Session, Runtime and artifact service remain the only authorities.
import { ApiError } from './runtime.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { prepareFactoryInquiry } from '../packages/workspace-factory-inquiries/src/drafts.mjs';
const fail = (status, code) => { throw new ApiError(status, code, 'Review the original inquiry, exact factory material and unchanged draft before saving.'); };
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fields = ['inquiryDocumentId', 'documentVersion', 'productId', 'requirements'];
function inputOf(input, save = false) {
  const allowed = [...fields, ...(save ? ['requestId', 'expectedDraftHash', 'confirmed'] : [])];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))
    || !input.requirements || typeof input.requirements !== 'object' || Array.isArray(input.requirements)
    || Object.keys(input.requirements).some(k => !['product', 'spec', 'quantity', 'targetMarket', 'requestedDelivery', 'requirements'].includes(k))
    || Object.values(input.requirements).some(v => v !== null && (typeof v !== 'string' || v.length > 1000))
    || !uuid(input.inquiryDocumentId) || !uuid(input.productId) || !Number.isInteger(input.documentVersion) || input.documentVersion < 1 || input.documentVersion > 100
    || save && (input.confirmed !== true || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.requestId || '') || !/^[a-f0-9]{64}$/.test(input.expectedDraftHash || '')))
    fail(400, 'FACTORY_INQUIRY_INPUT_INVALID');
  return Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, structuredClone(input[k])]));
}
export function createFactoryInquiryClient({ materialsClient, artifacts, store, identity, conversationId, runId = null, authorize, canSave }) {
  async function prepare(input, signal, model) {
    const selected = inputOf(input); signal?.throwIfAborted(); await authorize();
    const inquiry = await materialsClient.document({ documentId: selected.inquiryDocumentId, documentVersion: selected.documentVersion }, signal, model);
    const materials = await materialsClient.materials({ productId: selected.productId }, signal, model);
    await authorize();
    if (!['available', 'partial'].includes(inquiry.status) || materials.status !== 'available')
      return { plugin: 'workspace-factory-inquiries', status: 'blocked', reason: 'ORIGINAL_INQUIRY_OR_FACTORY_MATERIAL_UNAVAILABLE', sources: [] };
    return prepareFactoryInquiry({ inquiry, materials, requirements: selected.requirements });
  }
  function assertSourceCurrent(state, prepared) {
    if (Date.now() >= Date.parse(prepared.authorization.expiresAt)) fail(403, 'LIBRARY_READ_SCOPE_EXPIRED');
    for (const source of prepared.sources) {
      if (source.workspaceId !== identity.workspaceId) fail(403, 'FACTORY_INQUIRY_SOURCE_SCOPE_CHANGED');
      if (source.kind === 'factory-product') {
        const product = state.businessLibrary.products.find(p => p.id === source.recordId);
        if (!product || product.revision !== source.revision) fail(409, 'FACTORY_INQUIRY_SOURCE_CHANGED');
      } else if (source.kind === 'factory-document') {
        const document = state.businessLibrary.documents.find(d => d.id === source.recordId), version = document?.versions.find(v => v.version === source.documentVersion);
        if (!document || document.revision !== source.revision || document.currentVersion !== source.documentVersion || !version
          || version.asset.artifactId !== source.artifactId || version.asset.version !== source.version || version.asset.sha256 !== source.sha256) fail(409, 'FACTORY_INQUIRY_SOURCE_CHANGED');
      } else fail(403, 'FACTORY_INQUIRY_SOURCE_SCOPE_CHANGED');
    }
  }
  async function save(input, signal, model) {
    inputOf(input, true); await authorize();
    if (!canSave()) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
    const prepared = await prepare(inputOf(input, true), signal, model);
    if (!['available', 'partial'].includes(prepared.status) || prepared.draftHash !== input.expectedDraftHash) fail(409, 'FACTORY_INQUIRY_DRAFT_CHANGED');
    const saved = []; let failed = false;
    for (const draft of prepared.drafts) {
      await authorize(); signal?.throwIfAborted();
      try {
        const originalKey = 'factory-inquiry-' + libraryReadHash([identity.workspaceId, identity.subject, conversationId, input.requestId, draft.name]);
        const original = store.read().artifacts.find(a => a.requestId === originalKey);
        const sourceRunId = original?.sourceRunId || runId;
        const result = await artifacts.create({ requestId: originalKey,
          filename: draft.name, content: draft.content, description: 'Unsent factory inquiry draft; human review required.',
          metadata: { businessLibrary: { visibility: 'internal' }, factoryInquiry: { draftHash: prepared.draftHash, sources: prepared.sources,
            humanReviewRequired: true, sent: false } }, sourceConversationId: conversationId, ...(sourceRunId ? { sourceRunId } : {}) }, {
          check(state) {
            signal?.throwIfAborted();
            if (!canSave()) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
            assertSourceCurrent(state, prepared);
          },
        });
        await authorize();
        saved.push({ name: draft.name, artifactId: result.artifact.id, version: result.artifact.currentVersion,
          sha256: result.artifact.sha256, duplicate: result.duplicate === true });
      } catch (error) {
        if ([401, 403].includes(error.status) || signal?.aborted) throw error;
        failed = true; break; // Preserve committed original receipts. No retry.
      }
    }
    await authorize();
    return { plugin: 'workspace-factory-inquiries', status: failed ? 'partial' : 'saved', authorization: prepared.authorization,
      sources: prepared.sources, input: prepared.input, draftHash: prepared.draftHash, artifacts: saved,
      ...(failed ? { reason: 'ORIGINAL_ARTIFACT_SAVE_INCOMPLETE', retry: 'Replay the identical original request after reviewing its partial receipts.' } : {}),
      humanReviewRequired: true, sent: false, externalActions: false };
  }
  async function revalidateReceipt(receipt, model, signal) {
    const current = await prepare(receipt.input, signal, model);
    if (!['available', 'partial'].includes(current.status) || current.draftHash !== receipt.draftHash
      || libraryReadHash(current.authorization) !== libraryReadHash(receipt.authorization)
      || libraryReadHash(current.sources) !== libraryReadHash(receipt.sources)) throw Error('Cached factory inquiry source, receiver or exact draft changed.');
    if (receipt.drafts && libraryReadHash(current) !== libraryReadHash(receipt)) throw Error('Cached factory inquiry draft was modified.');
    if (receipt.artifacts !== undefined && (!Array.isArray(receipt.artifacts) || receipt.artifacts.length > 3)) throw Error('Invalid original inquiry artifact references.');
    for (const ref of receipt.artifacts || []) {
      const record = artifacts.get(ref.artifactId).artifact;
      if (record.sourceConversationId !== conversationId || record.currentVersion !== ref.version || record.sha256 !== ref.sha256
        || record.metadata?.factoryInquiry?.draftHash !== current.draftHash || libraryReadHash(record.metadata.factoryInquiry.sources) !== libraryReadHash(current.sources)
        || !current.drafts.some(d => d.name === record.filename && d.name === ref.name)) throw Error('Cached inquiry artifact scope changed.');
      const file = await artifacts.download(ref.artifactId, { version: ref.version });
      if (file.version.sha256 !== ref.sha256 || !current.drafts.some(d => d.name === ref.name && libraryReadHash(Buffer.from(d.content).toString('base64')) === libraryReadHash(file.bytes.toString('base64'))))
        throw Error('Cached inquiry original artifact bytes changed.');
    }
    await authorize();
  }
  return Object.freeze({ prepare, save, revalidateReceipt });
}
