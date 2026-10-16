import { buildPreServiceReview, freezeConfirmedServiceTarget, preServiceHash, referencesForPath } from '../plugins/workspace-market-validation/src/plan.mjs';
import { ApiError } from './runtime.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { readShopifyMarketScope } from './shopify-market-scope.mjs';

// Read the original Artifact; neither model flags nor this reader grant launch
// approval. The injected original acquisition service must resolve its own
// reviewed approval/execution receipt for the exact immutable plan reference.
export function createMarketValidationLaunchReader({ store, artifacts, resolveLaunchReceipt }) {
  if (typeof resolveLaunchReceipt !== 'function') return null;
  const reject = () => { throw new ApiError(409, 'MARKET_PLAN_RECEIPT_MISMATCH', 'Use the original owned plan Artifact version/hash and its exact acquisition receipt.'); };
  return async input => {
    input.signal?.throwIfAborted();
    const row = store.read().artifacts.find(item => item.id === input.planId), meta = row?.metadata?.marketValidationPlan;
    if (!row || row.currentVersion !== input.planRevision || !meta || meta.ownerHash !== libraryReadHash([input.actor.workspaceId, input.actor.subject, row.sourceConversationId])) reject();
    const file = await artifacts.download(input.planId, { version: input.planRevision });
    if (file.version.sha256 !== row.sha256) reject();
    let document; try { document = JSON.parse(file.bytes.toString('utf8')); } catch { reject(); }
    if (document?.schema !== 'workspace.market-validation-plan.v1' || !document.plan || libraryReadHash(document.plan) !== meta.planHash || !Array.isArray(document.plan.paths)) reject();
    const original = await resolveLaunchReceipt({ ...input, planArtifact: { artifactId: row.id, version: row.currentVersion, sha256: file.version.sha256, planHash: meta.planHash, ...(document.plan.paths.some(path => referencesForPath(path).length) ? { preServiceReview: buildPreServiceReview(document.plan) } : {}) } });
    input.signal?.throwIfAborted();
    const current = store.read().artifacts.find(item => item.id === row.id);
    if (!current || current.revision !== row.revision || current.sourceConversationId !== row.sourceConversationId || current.currentVersion !== row.currentVersion || current.sha256 !== row.sha256 || current.metadata?.marketValidationPlan?.planHash !== meta.planHash || current.metadata?.marketValidationPlan?.ownerHash !== meta.ownerHash) reject();
    if (!original || original.planSha256 !== file.version.sha256 || original.planHash !== meta.planHash || original.conversationId !== row.sourceConversationId) reject();
    const path = document.plan.paths.find(item => item.mode === original.businessMode);
    if (!path || document.plan.timeZone !== original.timezone || !path.acquisition?.some(item => item.id === original.planAcquisitionId)
      || !Array.isArray(path.metrics) || !path.metrics.length || !path.metrics.some(item => item.id === path.salesRequirement?.metric)) reject();
    let serviceTarget = null;
    if (path.serviceTarget) {
      if (document.plan.budget?.status !== 'proposed' || document.plan.budget.totalCap == null || !document.plan.budget.currency) reject();
      try { serviceTarget = freezeConfirmedServiceTarget(path, original.serviceTargetConfirmation, { planId: row.id, planRevision: row.currentVersion,
        planHash: meta.planHash, planSha256: file.version.sha256, subject: input.actor.subject, workspaceId: input.actor.workspaceId,
        startedAt: original.startedAt, createdAt: row.createdAt, channelId: original.channelId }); } catch { reject(); }
      if (document.preServiceReview && preServiceHash(document.preServiceReview) !== preServiceHash(buildPreServiceReview(document.plan))) reject();
    }
    const shopifyScope = original.businessMode === 'b2c' ? readShopifyMarketScope({ state: store.read(), actor: input.actor, launch: original, sources: document.sources }) : null;
    return { ...original, ...(shopifyScope ? { shopifyScope } : {}), serviceTarget, requiredMetrics: path.metrics.map(item => ({ id: item.id, definition: item.definition })), salesRequirement: path.salesRequirement, resultAssessment: path.resultAssessment ?? null };
  };
}
