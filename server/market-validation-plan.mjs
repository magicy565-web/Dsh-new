// Thin original Library/artifact adapter. The official AgentSession chooses
// whether to ask, read or write; this service never runs business steps.
import { ApiError } from './runtime.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { supplierOwned } from './supplier-draft.mjs';
import { looksLikeCredential } from './security.mjs';
import { validateProductInput, validatePlanInput, buildPreServiceReview, referencesForPath } from '../plugins/workspace-market-validation/src/plan.mjs';

const fail = (status, code) => { throw new ApiError(status, code, 'Use the original owned conversation, current authorized product sources and an unreviewed plan.'); };
export const MARKET_PLAN_FLAGS = Object.freeze({ humanReviewRequired: true, humanReviewed: false, externalActions: false, startedAt: null });
// References only: this adapter never calls these mutation APIs. Original
// supplier readiness, explicit public-field preview and exact approvals remain
// authoritative. The current retail adapter does not implement a B2B RFQ page.
export const MARKET_SHOPIFY_HANDOFF = Object.freeze({ service: 'original-supplier-service',
  route: '/api/conversations/{conversationId}/supplier-services/{serviceId}',
  preview: 'preview', previewPage: 'preview-page', publication: 'publication',
  review: 'shopify-review', decision: 'shopify-decision', execute: 'shopify-execute', reconcile: 'shopify-reconcile',
  trafficAuthorizationRequired: true, b2bRfqPage: 'not_implemented', planIsPublicationApproval: false });
const inputSelectors = v => ({ productId: v.productId, documents: v.documents });
const plugin = 'workspace-market-validation';
const clone = structuredClone;

export function createMarketValidationPlanClient({ materialsClient, artifacts, store, identity, conversationId, runId = null, authorize, canSave, clock = Date.now } = {}) {
  if (!materialsClient || !['materials', 'document'].every(k => typeof materialsClient[k] === 'function') || typeof authorize !== 'function'
    || typeof canSave !== 'function' || !artifacts || !store || !identity?.subject || !identity?.workspaceId)
    throw new TypeError('Inject the original reviewed material client, artifact service, Store and authority guards.');
  const ownerHash = libraryReadHash([identity.workspaceId, identity.subject, conversationId]);
  function owner(state = store.read()) { supplierOwned(state, identity, conversationId); }
  async function guard(signal, model) { signal?.throwIfAborted(); owner(); await authorize(signal, model); signal?.throwIfAborted(); owner(); }
  async function context(input, signal, model) {
    const selected = validateProductInput(input); await guard(signal, model);
    const materials = await materialsClient.materials({ productId: selected.productId }, signal, model);
    if (materials.status !== 'available' || materials.products.length !== 1 || materials.products[0].id !== selected.productId
      || materials.sources.length !== 1 || materials.authorization?.subject !== identity.subject || materials.authorization?.workspaceId !== identity.workspaceId)
      fail(403, 'MARKET_PLAN_SOURCE_REFUSED');
    const documents = [];
    for (const ref of selected.documents) {
      // A selected product cannot be used to read unrelated authorized files.
      if (!materials.products[0].documentReferences?.some(d => d.documentId === ref.documentId && d.documentVersion === ref.documentVersion)) fail(403, 'MARKET_PLAN_DOCUMENT_NOT_LINKED');
      const doc = await materialsClient.document(ref, signal, model);
      if (!['available', 'partial', 'blocked'].includes(doc.status) || !doc.document || doc.sources?.length !== 1
        || libraryReadHash(doc.authorization) !== libraryReadHash(materials.authorization)) fail(403, 'MARKET_PLAN_SOURCE_REFUSED');
      documents.push(doc);
    }
    await guard(signal, model);
    const sources = [...materials.sources, ...documents.flatMap(d => d.sources)];
    const extraction = documents.map(d => ({ documentId: d.document.id, status: d.status, textTruncated: d.document.textTruncated,
      ocrStatus: d.document.ocrStatus, pagesNeedingOcr: d.document.pagesNeedingOcr, reason: d.document.reason ?? null, notice: d.document.notice ?? null }));
    const result = { authorization: materials.authorization, sources, extraction };
    current(store.read(), result, false);
    return { ...result, materialReceipt: materials, documentReceipts: documents };
  }
  function current(state, ctx, writing) {
    owner(state);
    if (writing && canSave(state) !== true) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
    if (clock() >= Date.parse(ctx.authorization.expiresAt)) fail(403, 'LIBRARY_READ_SCOPE_EXPIRED');
    for (const source of ctx.sources) {
      const row = state.businessLibrary?.[source.kind === 'factory-product' ? 'products' : 'documents']?.find(r => r.id === source.recordId);
      if (!row || row.revision !== source.revision || row.status === 'archived' || source.workspaceId !== identity.workspaceId) fail(409, 'MARKET_PLAN_SOURCE_CHANGED');
      if (source.kind === 'factory-document') {
        const asset = row.versions.find(v => v.version === source.documentVersion)?.asset;
        if (row.currentVersion !== source.documentVersion || libraryReadHash(asset) !== libraryReadHash({ artifactId: source.artifactId, version: source.version, sha256: source.sha256 })) fail(409, 'MARKET_PLAN_SOURCE_CHANGED');
      }
    }
  }
  const provenance = ctx => ({ authorization: ctx.authorization, sources: ctx.sources, extraction: ctx.extraction });
  function readReceipt(input, ctx) {
    return { plugin, status: ctx.documentReceipts.some(d => d.status !== 'available') ? 'partial' : 'available', input: clone(input),
      ...ctx, ...MARKET_PLAN_FLAGS };
  }
  async function read(input, signal, model) { const selected = validateProductInput(input); return readReceipt(selected, await context(selected, signal, model)); }
  function envelope(selected, ctx) {
    return { schema: 'workspace.market-validation-plan.v1', plan: selected.plan, sources: ctx.sources, extraction: ctx.extraction,
      contentOrigin: 'model-draft-unverified', ...MARKET_PLAN_FLAGS,
      ...(selected.plan.paths.some(path => referencesForPath(path).length) ? { preServiceReview: buildPreServiceReview(selected.plan) } : {}),
      execution: { status: 'not_started', durationDays: 7, timeZone: selected.plan.timeZone,
        startPolicy: selected.plan.paths.some(path => path.serviceTarget) ? 'approved_actual_acquisition_after_exact_pre_service_target_confirmation' : 'approved_actual_launch_with_baseline_and_authorized_traffic', baseline: null, actualStartedAt: null, endsAt: null },
      shopifyHandoff: clone(MARKET_SHOPIFY_HANDOFF) };
  }
  const artifactRef = (row, duplicate) => ({ artifactId: row.id, version: row.currentVersion, sha256: row.sha256, duplicate });
  const saveReceipt = (selected, ctx, row, duplicate) => ({ plugin, status: 'saved-draft', input: inputSelectors(selected),
    ...provenance(ctx), planHash: libraryReadHash(selected.plan), sourceHash: libraryReadHash(provenance(ctx)), artifact: artifactRef(row, duplicate), ...(selected.plan.paths.some(path => referencesForPath(path).length) ? { preServiceReview: buildPreServiceReview(selected.plan) } : {}), ...MARKET_PLAN_FLAGS });
  async function save(input, signal, model) {
    const selected = validatePlanInput(input);
    if (looksLikeCredential(JSON.stringify(selected))) fail(400, 'RAW_CREDENTIAL_REJECTED');
    await guard(signal, model);
    if (canSave(store.read()) !== true) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED');
    const ctx = await context(inputSelectors(selected), signal, model);
    if (libraryReadHash(ctx.sources) !== libraryReadHash(selected.sources)) fail(409, 'MARKET_PLAN_SOURCE_CHANGED');
    const sourceHash = libraryReadHash(provenance(ctx)), planHash = libraryReadHash(selected.plan), requestGroup = libraryReadHash([ownerHash, selected.requestId]);
    const metadata = { ownerHash, requestGroup, sourceHash, planHash, ...MARKET_PLAN_FLAGS };
    const key = 'market-validation-' + requestGroup;
    const check = state => {
      signal?.throwIfAborted(); current(state, ctx, true);
      const prior = state.artifacts.find(a => a.requestId === key);
      if (prior && libraryReadHash(prior.metadata?.marketValidationPlan) !== libraryReadHash(metadata)) fail(409, 'MARKET_PLAN_REQUEST_CHANGED');
    };
    check(store.read()); await guard(signal, model);
    const prior = store.read().artifacts.find(a => a.requestId === key);
    const result = await artifacts.create({ requestId: key, filename: 'market-validation-plan.json', content: JSON.stringify(envelope(selected, ctx), null, 2) + '\n',
      description: 'Unreviewed seven-day market validation plan; no launch, publication or spend authorized.',
      metadata: { businessLibrary: { visibility: 'internal' }, marketValidationPlan: metadata }, sourceConversationId: conversationId,
      ...((prior?.sourceRunId || runId) ? { sourceRunId: prior?.sourceRunId || runId } : {}) }, { check });
    await guard(signal, model);
    return saveReceipt(selected, ctx, result.artifact, result.duplicate === true);
  }
  async function revalidateReceipt(receipt, model, signal) {
    await guard(signal, model);
    if (receipt?.plugin !== plugin) fail(403, 'MARKET_PLAN_CACHE_REFUSED');
    const ctx = await context(receipt.input, signal, model);
    if (['available', 'partial'].includes(receipt.status)) {
      if (libraryReadHash(readReceipt(receipt.input, ctx)) !== libraryReadHash(receipt)) fail(403, 'MARKET_PLAN_CACHE_REFUSED');
    } else if (receipt.status === 'saved-draft') {
      const ref = receipt.artifact;
      if (!ref || typeof ref.duplicate !== 'boolean') fail(403, 'MARKET_PLAN_CACHE_REFUSED');
      const row = artifacts.get(ref.artifactId).artifact, meta = row.metadata?.marketValidationPlan;
      const file = await artifacts.download(ref.artifactId, { version: ref.version });
      let saved; try { saved = JSON.parse(file.bytes.toString('utf8')); } catch { fail(403, 'MARKET_PLAN_CACHE_REFUSED'); }
      const selected = validatePlanInput({ ...receipt.input, sources: ctx.sources, plan: saved.plan, requestId: 'cache-validation' });
      const expected = envelope(selected, ctx);
      if (row.sourceConversationId !== conversationId || row.currentVersion !== ref.version || file.version.sha256 !== ref.sha256
        || meta?.ownerHash !== ownerHash || meta.sourceHash !== libraryReadHash(provenance(ctx)) || meta.planHash !== libraryReadHash(selected.plan)
        || Object.entries(MARKET_PLAN_FLAGS).some(([k, v]) => meta[k] !== v)
        || libraryReadHash(saved) !== libraryReadHash(expected)
        || libraryReadHash(saveReceipt(selected, ctx, row, ref.duplicate)) !== libraryReadHash(receipt)) fail(403, 'MARKET_PLAN_CACHE_REFUSED');
    } else fail(403, 'MARKET_PLAN_CACHE_REFUSED');
    await guard(signal, model);
  }
  return Object.freeze({ read, save, revalidateReceipt });
}
