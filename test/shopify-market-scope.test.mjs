import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedMarketPublication } from './fixtures/shopify-market-scope.mjs';
import { productFixture, multiDraft, MODEL } from './fixtures/shopify-product.mjs';
import { marketPlan } from './fixtures/market-validation-plan-data.mjs';
import { readShopifyMarketScope } from '../server/shopify-market-scope.mjs';
import { supplierHash as hash } from '../server/supplier-profile.mjs';
import { libraryReadHash } from '../server/library-model-read-contract.mjs';
import { createShopifyProductClient } from '../server/shopify-product-client.mjs';
import { createMarketValidationLaunchReader } from '../server/market-validation-launch-reader.mjs';
import { createMarketValidationMonitor } from '../server/market-validation-monitor.mjs';
import { productCohortMetrics } from '../server/supplier-metrics.mjs';

const actor = { subject: 'synthetic-owner', workspaceId: 'synthetic-workspace', role: 'admin' };
function seeded(skuCount = 4) {
  const conversationId = randomUUID(), state = { conversations: [{ id: conversationId, createdBy: actor.subject, workspaceId: actor.workspaceId }] };
  return { state, actor, ...seedMarketPublication(state, { actor, conversationId, skuCount }) };
}
const read = f => readShopifyMarketScope({ ...f, launch: f.launch, sources: f.sources });
for (const count of [4, 100]) test(`${count} SKU complete Store receipt maps by source identity across arbitrary remote order`, () => {
  const f = seeded(count), first = read(f);
  assert.equal(first.mappings.length, count); assert.equal(first.variantIds.length, count);
  assert.equal(first.salesScope, 'product_all_variants'); assert.equal(first.libraryProductId, f.source.productId);
  f.operation.receipt.variantReceipts.reverse(); f.operation.receipt.variantIds = [...f.operation.receipt.variantIds].reverse(); f.launch.variantIds.reverse();
  assert.deepEqual(read(f), first);
});

const mutations = {
  'missing reference': f => { delete f.launch.shopifyPublication; },
  'model pages supplied as reference': f => { f.launch.shopifyPublication.variantPage = {}; },
  'empty launch variants': f => { f.launch.variantIds = []; },
  'subset launch variants': f => { f.launch.variantIds.pop(); },
  'duplicate launch variants': f => { f.launch.variantIds[1] = f.launch.variantIds[0]; },
  'partial operation': f => { f.operation.status = 'partial'; },
  'uncertain operation': f => { f.operation.status = 'uncertain'; },
  'incomplete receipt': f => { f.operation.receipt.complete = false; },
  'draft only': f => { f.operation.receipt.published = false; },
  'wrong original operation': f => { f.launch.shopifyPublication.operationId = randomUUID(); },
  'cross shop launch': f => { f.launch.shopId = 'gid://shopify/Shop/9'; },
  'cross shop receipt': f => { f.operation.receipt.shopId = 'gid://shopify/Shop/9'; },
  'cross shop domain': f => { f.operation.receipt.shopDomain = 'other.myshopify.com'; },
  'cross product': f => { f.launch.productId = 'gid://shopify/Product/9'; },
  'wrong plan source': f => { f.sources[0].recordId = randomUUID(); },
  'ambiguous plan sources': f => { f.sources.push({ ...f.sources[0] }); },
  'cross owner': f => { f.actor.subject = 'other-owner'; },
  'wrong plan revision': f => { f.sources[0].revision++; },
  'changed Library revision': f => { f.state.businessLibrary.products[0].revision++; },
  'changed Library SKU without revision': f => { f.state.businessLibrary.products[0].skus[0].code = 'changed'; },
  'changed service revision': f => { f.row.revision++; },
  'truncated mapping': f => { f.operation.receipt.variantReceipts.pop(); },
  'duplicate source mapping': f => { f.operation.receipt.variantReceipts[1].sourceSkuId = f.operation.receipt.variantReceipts[0].sourceSkuId; },
  'duplicate target mapping': f => { f.operation.receipt.variantReceipts[1].variantId = f.operation.receipt.variantReceipts[0].variantId; },
  'unreviewed field mapping': f => { f.operation.receipt.variantReceipts[0].matchesReviewedFields = false; },
  'wrong SKU receipt': f => { f.operation.receipt.variantReceipts[0].reviewedSku = 'wrong'; },
  'remote content differs from review': f => { f.operation.receipt.remoteContentHash = 'd'.repeat(64); },
  'unconsumed human approval': f => { f.state.capabilities.approvals[0].status = 'approved'; },
  'later uncertain operation': f => { f.row.publicationOperations.push({ connectorRunId: randomUUID(), status: 'uncertain' }); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`Store mapping rejects ${name}`, () => {
  const f = structuredClone(seeded()); mutate(f);
  assert.throws(() => read(f), error => ['SHOPIFY_MARKET_SCOPE_INVALID', 'SHOPIFY_PRODUCT_SOURCE_CHANGED', 'SUPPLIER_SERVICE_NOT_FOUND'].includes(error.code));
});

// Original publisher + human decision entry + Store + launch reader + monitor.
// Shopify, model authority, human decisions, launch and outcome records here
// are explicit finite local substitutes, never real business evidence.
async function published(t, count) {
  const f = await productFixture(t, { skuCount: count });
  const client = createShopifyProductClient({ ...f.app, materialsClient: { materials: () => f.materials(), status: async () => ({ ...(await f.materials()), fields: f.policy.factoryMaterials.productFields }) },
    identity: f.actor, conversationId: f.cid, authorize: async () => {}, assertCurrent() {}, canSave: () => true });
  const proposal = multiDraft(f); proposal.unitsPerPack = 6;
  const saved = await client.propose({ productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'scope-proposal', draft: proposal }, undefined, MODEL);
  const sid = saved.view.serviceId;
  for (const action of ['draft', 'publish']) {
    const review = await client.review({ serviceId: sid, requestId: 'scope-review-' + action, action, ...(action === 'publish' ? { publicationId: 'gid://shopify/Publication/7' } : {}) }, undefined, MODEL);
    const op = review.view.publication.selectedOperation;
    await f.app.supplierPublication.forActor(f.actor).decidePublication(f.cid, sid, { requestId: randomUUID(), operationId: op.id, expectedScopeHash: op.scopeHash, confirmed: true, decision: 'approved' });
    await client.execute({ serviceId: sid, requestId: 'scope-execute-' + action, operationId: op.id, expectedScopeHash: op.scopeHash }, undefined, MODEL);
  }
  const row = f.app.store.read().workspaceSupplierServices.services.find(r => r.id === sid), operation = row.publicationOperations.at(-1);
  assert.equal(operation.status, 'succeeded');
  // Model projection intentionally contains only a page. The binding below
  // never reads it; it consumes the complete original Store operation.
  const page = await client.result({ serviceId: sid, operationId: operation.id, variantLimit: 4 }, undefined, MODEL);
  assert.equal(page.view.publication.selectedOperation.receipt.variantReceipts.length, 4);
  assert.equal(page.acquisition.startedAt, null); assert.equal(page.acquisition.launchEvidence, false);
  assert.equal(f.app.store.read().goals.length, 0);
  const plan = marketPlan('b2c');
  const artifact = (await f.app.artifacts.create({ requestId: 'scope-plan', filename: 'scope-plan.json', sourceConversationId: f.cid,
    content: JSON.stringify({ schema: 'workspace.market-validation-plan.v1', plan, sources: (await f.materials()).sources }),
    metadata: { marketValidationPlan: { ownerHash: libraryReadHash([f.actor.workspaceId, f.actor.subject, f.cid]), planHash: libraryReadHash(plan) } } })).artifact;
  const startedAt = new Date(Date.now() - 60000).toISOString();
  const launch = { id: 'synthetic-original-acquisition', planId: artifact.id, planRevision: 1, planHash: libraryReadHash(plan), planSha256: artifact.sha256,
    planAcquisitionId: plan.paths[0].acquisition[0].id, approved: true, status: 'launched', evidenceKind: 'real', launchKind: 'acquisition',
    startedAt, timezone: plan.timeZone, productId: operation.receipt.productId, variantIds: [...operation.receipt.variantIds], shopId: operation.receipt.shopId,
    channelId: 'synthetic-execution-channel', businessMode: 'b2c', conversationId: f.cid,
    shopifyPublication: { serviceId: sid, operationId: operation.id, scopeHash: operation.scopeHash } };
  const reader = createMarketValidationLaunchReader({ store: f.app.store, artifacts: f.app.artifacts, resolveLaunchReceipt: async () => structuredClone(launch) });
  let acknowledgeUnits = true, outcomeCalls = 0, seenScope;
  const outcomeAdapter = { id: 'synthetic-reviewed-payment', authorizationReviewed: true, async readOutcomes(scope) {
    outcomeCalls++; seenScope = scope;
    return { ...scope, sourceId: this.id, status: 'available', sampledAt: new Date().toISOString(), dataLagSeconds: 0,
      definition: 'Synthetic exact mapped cohort; verified net payments expressed in physical pieces, with 6 pieces per sale unit.',
      metrics: { paidOrders: 1, paidUnits: 12, netPaidOrders: 1, netPaidUnits: 6, refundedUnits: 6 },
      ...(acknowledgeUnits ? { unitBasis: { unit: 'physical_units', unitsPerPack: 6, shopifyScopeHash: hash(scope.shopifyScope) } } : {}) };
  } };
  const monitor = await createMarketValidationMonitor({ store: f.app.store, runtime: f.app.runtime, capabilities: f.app.capabilities, shopify: f.app.shopify,
    authorizeOwner: (_state, a) => a.subject === f.actor.subject && a.workspaceId === f.actor.workspaceId, resolveLaunchReceipt: reader, outcomeAdapter });
  t.after(() => monitor.close());
  const bound = monitor.forActor(f.actor), request = { requestId: 'scope-create', planId: artifact.id, planRevision: 1, launchReceiptId: launch.id, confirmed: true };
  return { ...f, client, row, operation, reader, launch, bound, request, get outcomeCalls() { return outcomeCalls; }, get seenScope() { return seenScope; }, acknowledgeUnits: value => { acknowledgeUnits = value; } };
}
const observation = (task, requestId) => ({ goalId: task.goalId, expectedScopeHash: task.scopeHash, requestId, confirmed: true });
for (const count of [4, 100]) test(`original ${count} SKU publisher -> launch reader -> scopeHash -> outcomeAdapter uses full receipt`, async t => {
  const f = await published(t, count), task = await f.bound.create(f.request);
  assert.equal(task.shopifyScope.mappings.length, count); assert.equal(task.scheduleEnabled, false);
  assert.equal(task.shopifyScope.libraryProductRevision, f.product.revision);
  const goal = f.app.store.read().goals.find(g => g.id === task.goalId);
  assert.equal(goal.serviceTask.scopeHash, task.scopeHash); assert.ok(goal.description.length < 20000);
  const remoteProduct = [...f.remote.products.values()][0]; remoteProduct.variants.nodes.reverse();
  const result = await f.bound.observe(observation(task, 'mapped-observation'));
  assert.equal(result.observation.sample.cohort.status, 'available');
  assert.equal(result.observation.sample.cohort.quantities.retainedUnits, 0);
  assert.equal(result.observation.sample.cohort.quantityBasis.unit, 'sale_units');
  assert.equal(result.observation.sample.cohort.quantityBasis.unitsPerPack, 6);
  assert.equal(f.seenScope.shopifyScope.mappings.length, count);
  assert.equal(result.observation.sample.outcomes.metrics.netPaidUnits, 6);
  f.acknowledgeUnits(false);
  const missingBasis = await f.bound.observe(observation(task, 'missing-pack-basis'));
  assert.equal(missingBasis.observation.sample.outcomes.metrics.netPaidUnits, null);
  assert.ok(missingBasis.observation.sample.errors.some(e => e.code === 'OUTCOME_UNIT_BASIS_REQUIRED'));
  const before = f.outcomeCalls;
  await f.app.store.update(state => { state.workspaceSupplierServices.services.find(r => r.id === f.row.id).productSource.sourceHash = 'e'.repeat(64); });
  await assert.rejects(f.bound.observe(observation(task, 'changed-source-hash')), { code: 'LAUNCH_SCOPE_CHANGED' });
  assert.equal(f.outcomeCalls, before);
  await f.app.store.update(state => { state.workspaceSupplierServices.services.find(r => r.id === f.row.id).productSource.sourceHash = f.row.productSource.sourceHash; });
  const complete = structuredClone(remoteProduct.variants);
  for (const [name, mutate, code] of [
    ['extra', v => v.nodes.push({ ...v.nodes[0], id: 'gid://shopify/ProductVariant/999999' }), 'SHOPIFY_SCOPE_CHANGED'],
    ['subset', v => v.nodes.pop(), 'SHOPIFY_SCOPE_CHANGED'],
    ['partial', v => { v.pageInfo.hasNextPage = true; }, 'SHOPIFY_VARIANTS_INCOMPLETE'],
    ['duplicate', v => { v.nodes[1].id = v.nodes[0].id; }, 'SHOPIFY_VARIANTS_INCOMPLETE'],
  ]) {
    remoteProduct.variants = structuredClone(complete); mutate(remoteProduct.variants);
    await assert.rejects(f.bound.observe(observation(task, 'remote-' + name)), { code });
    assert.equal(f.outcomeCalls, before);
  }
  await f.app.store.update(state => { state.businessLibrary.products.find(p => p.id === f.product.id).revision++; });
  await assert.rejects(f.bound.observe(observation(task, 'stale-source')), { code: 'SHOPIFY_PRODUCT_SOURCE_CHANGED' });
  assert.equal(f.outcomeCalls, before);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierCreateReviewedVariants'), 1);
});

test('multi-SKU order counts once; refunds, cancellations and overlap stay sale units without payment inference', () => {
  const f = seeded(), scope = { ...f.launch, from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' };
  const line = (i, quantity, currentQuantity) => ({ id: `gid://shopify/LineItem/${i}`, quantity, currentQuantity, product: { id: scope.productId }, variant: { id: scope.variantIds[i % 4] } });
  const base = (i, nodes, cancelledAt = null) => ({ id: `gid://shopify/Order/${i}`, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', test: false, cancelledAt, lineItems: { nodes, pageInfo: { hasNextPage: false } }, refunds: [] });
  const orders = [base(1, [line(1, 3, 2), line(2, 2, 2)]), base(2, [line(3, 2, 1), line(4, 1, 1)], '2026-10-09T00:00:00.000Z')];
  for (const [i, order] of orders.entries()) order.refunds.push({ id: `gid://shopify/Refund/${i + 1}`, createdAt: '2026-10-09T00:00:00.000Z', refundLineItems: { nodes: [{ quantity: 1, lineItem: { id: order.lineItems.nodes[0].id } }], pageInfo: { hasNextPage: false } } });
  const metrics = productCohortMetrics(orders, scope);
  assert.equal(metrics.grossOrders, 2); assert.equal(metrics.grossUnits, 8); assert.equal(metrics.retainedOrders, 1); assert.equal(metrics.retainedUnits, 4);
  assert.equal(metrics.refundedUnits, 2); assert.equal(metrics.cancelledUnits, 3); assert.equal(metrics.cancelledRefundedOverlapUnits, 1);
  assert.equal(metrics.netPaidUnits, undefined);
  assert.throws(() => productCohortMetrics([...orders, orders[0]], scope), { code: 'SHOPIFY_ORDERS_INCOMPLETE' });
});
