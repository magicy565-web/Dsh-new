import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createApp } from '../server/index.mjs';
import { productFixture, draft, multiDraft, MODEL } from './fixtures/shopify-product.mjs';
import { createShopifyProductClient } from '../server/shopify-product-client.mjs';
import { shopifyProductExtension } from '../packages/workspace-shopify-product/src/extension.js';
const PUB = 'gid://shopify/Publication/7';
async function fixture(t, options) {
  const f = await productFixture(t, options), guards = { live: true, writable: true };
  const assertCurrent = () => { if (!guards.live) throw Object.assign(Error('Explicit authority fixture revoked'), { status: 403 }); };
  const authorize = async () => assertCurrent();
  const client = createShopifyProductClient({ materialsClient: { materials: () => f.materials(), status: async () => ({ ...(await f.materials()), fields: f.policy.factoryMaterials.productFields }) },
    ...f.app, identity: f.actor, conversationId: f.cid, authorize, assertCurrent, canSave: () => guards.writable });
  const tools = []; shopifyProductExtension({ client, authorize })({ registerTool: t => tools.push(t) });
  const call = async (method, input, signal) => tools.find(t => t.name === 'workspace_shopify_product_' + method).execute('finite', input, signal, undefined, { model: MODEL });
  const proposeInput = async () => ({ productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'model-proposal', draft: draft(f.imageId) });
  const operation = sid => f.app.supplierPublication.forActor(f.actor).publication(f.cid, sid).publication.latest;
  const approve = (sid, op) => f.app.supplierPublication.forActor(f.actor).decidePublication(f.cid, sid, { requestId: randomUUID(), operationId: op.id, expectedScopeHash: op.scopeHash, confirmed: true, decision: 'approved' });
  const command = (sid, op, requestId = randomUUID()) => ({ serviceId: sid, operationId: op.id, expectedScopeHash: op.scopeHash, requestId });
  return Object.assign(f, { client, guards, call, proposeInput, operation, approve, command });
}
test('original Library images, model prose and original proposal idempotency without a second catalog or shop write', async t => {
  const f = await fixture(t), input = await f.proposeInput();
  const read = await f.call('read', { productId: f.product.id }); assert.equal(read.details.sourceHash, input.sourceHash);
  const image = await f.call('image', { productId: f.product.id, imageId: f.imageId }); assert.equal(image.content[1].mimeType, 'image/png');
  const ready = await f.call('readiness', { productId: f.product.id }); assert.equal(ready.details.view.sourceReady, true); assert.equal(ready.details.view.verifiedWrite, false);
  const first = await f.call('propose', input); assert.ok(!first.isError, JSON.stringify(first));
  const sid = first.details.view.serviceId; assert.equal((await f.call('propose', input)).details.view.serviceId, sid);
  assert.equal(first.details.view.preview.product.title, input.draft.title);
  assert.equal(first.details.view.preview.product.descriptionHtml, '<p>Model-authored cup story &lt;script&gt;inert&lt;/script&gt; &amp; custom prose.</p>');
  assert.deepEqual(first.details.view.preview.display.paragraphs, [input.draft.description]);
  assert.equal(first.details.view.preview.humanReviewed, false); assert.equal(f.app.store.read().businessLibrary.products.length, 1);
  assert.equal(f.app.store.read().workspaceSupplierServices.services.length, 1); assert.equal(f.remote.calls.length, 0);
  const mismatch = await f.call('propose', { ...input, draft: { ...input.draft, title: 'Different' } }); assert.equal(mismatch.details.reason, 'IDEMPOTENCY_CONFLICT');
  const forged = structuredClone(first.details); forged.view.preview.product.title = 'FORGED APPROVED'; forged.view.productCreatedOrPublished = true;
  const fresh = await f.client.refresh(forged, MODEL); assert.equal(fresh.view.productCreatedOrPublished, false); assert.equal(fresh.view.preview.product.title, input.draft.title);
  await assert.rejects(f.client.refresh({ ...forged, sourceHash: '0'.repeat(64) }, MODEL), { code: 'SHOPIFY_PRODUCT_CACHE_REFUSED' });
  const native = image.content.slice(1); native[0].data = 'altered'; const { nativeContent, ...receipt } = await f.client.image({ productId: f.product.id, imageId: f.imageId }, undefined, MODEL);
  await assert.rejects(f.client.refresh(receipt, MODEL, undefined, native), { code: 'SHOPIFY_PRODUCT_CACHE_REFUSED' });
});
test('two separate original human approvals execute draft then exact-channel publish; no acquisition, Goal or schedule', async t => {
  const f = await fixture(t), sid = (await f.call('propose', await f.proposeInput())).details.view.serviceId;
  await f.call('review', { serviceId: sid, requestId: 'review-draft', action: 'draft' }); const op = f.operation(sid);
  assert.equal(op.status, 'pending_approval'); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
  assert.equal((await f.call('execute', f.command(sid, op))).isError, true); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
  await f.approve(sid, op); const cmd = f.command(sid, op), created = await f.call('execute', cmd);
  assert.ok(!created.isError, JSON.stringify(created)); assert.equal(created.details.view.publication.latest.receipt.status, 'shopify_draft');
  assert.equal(created.details.view.publication.latest.receipt.published, false); await f.call('execute', cmd); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  await f.call('review', { serviceId: sid, requestId: 'review-publish', action: 'publish', publicationId: PUB }); const publish = f.operation(sid);
  assert.equal(publish.status, 'pending_approval'); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
  await f.approve(sid, publish); const done = await f.call('execute', f.command(sid, publish)); assert.ok(!done.isError, JSON.stringify(done));
  assert.equal(done.details.view.publication.latest.receipt.status, 'published'); assert.equal(done.details.view.acquisitionStarted, false);
  assert.equal(done.details.acquisition.startedAt, null); assert.equal(f.remote.state.uploads, 1);
  assert.equal(f.app.capabilities.listApprovals().length, 2); assert.ok(f.app.capabilities.listApprovals().every(a => a.status === 'consumed'));
  assert.equal(f.app.store.read().goals.length, 0); assert.equal(f.app.capabilities.listSchedules().length, 0);
});
test('closed inputs, original execution intent, exact images, cancellation and revoked authority refuse before saves', async t => {
  const f = await fixture(t), input = await f.proposeInput();
  for (const extra of [{ approved: true }, { confirmed: true }, { token: 'secret' }]) assert.equal((await f.call('propose', { ...input, ...extra })).details.reason, 'SHOPIFY_PRODUCT_INPUT_INVALID');
  f.guards.writable = false; assert.equal((await f.call('propose', input)).isError, true); f.guards.writable = true;
  assert.equal((await f.call('propose', { ...input, draft: { ...input.draft, imageIds: [randomUUID()] } })).isError, true);
  const controller = new AbortController(); controller.abort(); assert.equal((await f.call('propose', input, controller.signal)).details.reason, 'ORIGINAL_OPERATION_CANCELLED');
  f.guards.live = false; assert.equal((await f.call('propose', input)).details.reason, 'ORIGINAL_AUTHORIZATION_REFUSED');
  assert.equal(f.app.store.read().workspaceSupplierServices?.services.length || 0, 0); assert.equal(f.remote.calls.length, 0);
});
test('source revision and image changes fence original approved operations and cached disclosures', async t => {
  const f = await fixture(t), receipt = (await f.call('propose', await f.proposeInput())).details, sid = receipt.view.serviceId;
  await f.call('review', { serviceId: sid, requestId: 'review', action: 'draft' }); const op = f.operation(sid); await f.approve(sid, op);
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { images: [] } }, f.actor);
  assert.equal((await f.call('execute', f.command(sid, op))).isError, true);
  const { serviceId, ...originalCommand } = f.command(sid, op);
  await assert.rejects(f.app.supplierPublication.forActor(f.actor).executePublication(f.cid, sid, { ...originalCommand, confirmed: true }), { code: 'SHOPIFY_PRODUCT_SOURCE_CHANGED' });
  await assert.rejects(f.client.refresh(receipt, MODEL)); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
});
test('lost synthetic Shopify response reconciles the same original operation without another creation', async t => {
  const f = await fixture(t), sid = (await f.call('propose', await f.proposeInput())).details.view.serviceId;
  await f.call('review', { serviceId: sid, requestId: 'review', action: 'draft' }); const op = f.operation(sid); await f.approve(sid, op);
  f.remote.state.drops.add('SupplierCreateDraft'); const uncertain = await f.call('execute', f.command(sid, op));
  assert.equal(uncertain.isError, true); assert.equal(uncertain.details.status, 'uncertain'); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  const reconciled = await f.call('reconcile', f.command(sid, op)); assert.equal(reconciled.details.view.publication.latest.id, op.id);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.app.capabilities.listConnectorRuns().length, 1);
});
test('missing Shopify configuration is explicit while source proposals remain private and inert', async t => {
  const f = await fixture(t, { configured: false }); assert.equal((await f.call('status', {})).details.status, 'unconfigured');
  const ready = await f.call('readiness', { productId: f.product.id }); assert.equal(ready.details.status, 'unconfigured'); assert.equal(ready.details.view.uploadReady, false);
  const sid = (await f.call('propose', await f.proposeInput())).details.view.serviceId;
  assert.equal((await f.call('review', { serviceId: sid, requestId: 'no-config-review', action: 'draft' })).details.status, 'unconfigured');
  assert.equal(f.app.capabilities.listApprovals().length, 0); assert.equal(f.remote.calls.length, 0);
});
test('cancellation or source/Run revocation during original shop verification cannot commit a new review approval', async t => {
  for (const mode of ['cancel', 'source', 'run']) await t.test(mode, async t => {
    const f = await fixture(t), sid = (await f.call('propose', await f.proposeInput())).details.view.serviceId, controller = new AbortController();
    f.remote.state.afterResponsePrepared = async ({ data }) => {
      if (!data.shop) return;
      if (mode === 'cancel') controller.abort();
      else if (mode === 'run') f.guards.writable = false;
      else await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'Changed during verification' } }, f.actor);
    };
    assert.equal((await f.call('review', { serviceId: sid, action: 'draft', requestId: 'cancel-review' }, controller.signal)).isError, true);
    assert.equal(f.app.capabilities.listApprovals().length, 0); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
    assert.equal(f.app.store.read().workspaceSupplierServices.services[0].publicationOperations?.length || 0, 0);
  });
});
for (const skuCount of [0, 4]) test(`cold original-app reopen preserves ${skuCount || 1} variants and the exact operation for read-only reconciliation`, async t => {
  const f = await fixture(t, { skuCount }), input = await f.proposeInput(); if (skuCount) input.draft = multiDraft(f);
  const sid = (await f.call('propose', input)).details.view.serviceId;
  await f.call('review', { serviceId: sid, requestId: 'cold-review', action: 'draft' }); const op = f.operation(sid); await f.approve(sid, op);
  await f.call('execute', f.command(sid, op)); await f.app.close();
  const reopened = await createApp({ dataDirectory: f.directory, capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'supplier-fixture.myshopify.com',
    WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'LOCAL-SYNTHETIC-SHOPIFY-CREDENTIAL', WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED: '1' }, shopifyFetch: f.remote.fetchImpl });
  try {
    const domain = reopened.supplierPublication.forActor(f.actor), current = domain.publication(f.cid, sid).publication.latest;
    assert.equal(current.id, op.id); assert.equal(current.approvalStatus, 'consumed');
    const { serviceId, ...cmd } = f.command(sid, op); const result = await domain.reconcilePublication(f.cid, sid, { ...cmd, confirmed: true });
    assert.equal(result.operation.id, op.id); assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(reopened.store.read().businessLibrary.products.length, 1);
  } finally { await reopened.close(); }
});
for (const skuCount of [0, 4]) test(`actual Pi SDK chooses original reads and saves ${skuCount ? 'multi-variant' : 'single-variant'} prose with synthetic authority`, async t => {
  const f = await fixture(t, { skuCount }), sdk = await import('@earendil-works/pi-coding-agent'), ai = await import('@earendil-works/pi-ai');
  const dir = await fs.mkdtemp('/tmp/shopify-product-pi-sdk-'); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const faux = ai.fauxProvider({ api: 'faux', provider: MODEL.provider, models: [{ id: MODEL.id, maxTokens: 512 }] });
  const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false }); runtime.registerNativeProvider(faux.provider);
  const settings = sdk.SettingsManager.create(dir, dir + '/agent'); settings.setCompactionEnabled(false);
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir + '/agent', settingsManager: settings, noContextFiles: true, noSkills: true, noExtensions: true,
    extensionFactories: [shopifyProductExtension({ client: f.client, authorize: async () => {} })] }); await loader.reload();
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir + '/agent', settingsManager: settings, resourceLoader: loader, modelRuntime: runtime,
    model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(dir) }); await session.bindExtensions({});
  try {
    let calls = 0;
    faux.setResponses([
      context => { calls++; return ai.fauxAssistantMessage([{ type: 'toolCall', id: 'read', name: 'workspace_shopify_product_read', arguments: { productId: f.product.id } }], { stopReason: 'toolUse' }); },
      context => { calls++; const receipt = JSON.parse(context.messages.at(-1).content.filter(b => b.type === 'text').map(b => b.text).join('\n')); assert.equal(receipt.view.product.name, f.product.name);
        return ai.fauxAssistantMessage([{ type: 'toolCall', id: 'propose', name: 'workspace_shopify_product_propose', arguments: { productId: f.product.id, sourceHash: receipt.sourceHash, requestId: 'pi-model-draft', draft: skuCount ? multiDraft(f) : draft(f.imageId) } }], { stopReason: 'toolUse' }); },
      context => { calls++; const receipt = JSON.parse(context.messages.at(-1).content.filter(b => b.type === 'text').map(b => b.text).join('\n')); assert.equal(receipt.view.preview.product.title, draft(f.imageId).title); return ai.fauxAssistantMessage('Original synthetic proposal saved.'); },
    ]);
    await session.prompt('Finite keyless SDK fixture: choose a read, draft your own listing and propose it.');
    const results = session.messages.filter(r => r.role === 'toolResult'); assert.ok(results.every(r => !r.isError), JSON.stringify(results));
    assert.equal(session.messages.at(-1)?.stopReason, 'stop', JSON.stringify(session.messages.at(-1))); assert.deepEqual(results.map(r => r.toolName), ['workspace_shopify_product_read', 'workspace_shopify_product_propose']);
    assert.ok(results.every(r => !r.isError), JSON.stringify(results)); assert.equal(calls, 3); assert.equal(f.remote.calls.length, 0); assert.equal(f.app.store.read().workspaceSupplierServices.services.length, 1);
  } finally { await session.dispose(); }
});
test('explicit source SKUs/prices/media survive original separate draft and publish approvals without inventory or cross-product generation', async t => {
  const f = await fixture(t, { skuCount: 4 }), input = { productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'multi', draft: multiDraft(f) };
  const proposed = await f.call('propose', input); assert.ok(!proposed.isError, JSON.stringify(proposed));
  const sid = proposed.details.view.serviceId; assert.equal((await f.call('propose', input)).details.view.serviceId, sid);
  assert.equal(proposed.details.view.preview.variants.length, 4); assert.equal(proposed.details.view.preview.saleUnit.consumerPrice, null);
  const readiness = await f.call('readiness', { productId: f.product.id }); assert.equal(readiness.details.view.variantSources.skuCount, 4);
  await f.call('review', { serviceId: sid, requestId: 'multi-review', action: 'draft' }); let op = f.operation(sid);
  assert.deepEqual(op.scope.preview.options, input.draft.options); assert.deepEqual(op.scope.preview.variants.map(v => v.price), input.draft.variants.map(v => v.consumerPrice));
  assert.equal((await f.call('execute', f.command(sid, op))).isError, true); await f.approve(sid, op);
  const cmd = f.command(sid, op), result = await f.call('execute', cmd); assert.ok(!result.isError, JSON.stringify(result));
  const receipt = result.details.view.publication.latest.receipt; assert.equal(receipt.complete, true); assert.equal(receipt.variantIds.length, 4);
  assert.ok(receipt.variantReceipts.every(v => v.matchesReviewedFields)); assert.equal(receipt.inventory, 'unknown_not_written');
  assert.equal(receipt.variantReceipts[0].mediaId, 'gid://shopify/MediaImage/1000'); assert.equal(receipt.variantReceipts[1].mediaId, null);
  const sent = f.remote.calls.find(c => c.name === 'SupplierCreateReviewedVariants').variables;
  assert.equal(sent.variants.length, 4); assert.ok(sent.variants.every(v => !Object.hasOwn(v, 'inventoryQuantities') && !Object.hasOwn(v, 'quantityAdjustments')));
  await f.call('execute', cmd); assert.equal(f.remote.count('SupplierCreateReviewedVariants'), 1); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  // Variant order is presentation, while original IDs/options/prices/media remain exact.
  [...f.remote.products.values()][0].variants.nodes.reverse();
  await f.call('review', { serviceId: sid, requestId: 'multi-publish-review', action: 'publish', publicationId: PUB }); op = f.operation(sid); assert.equal(op.status, 'pending_approval');
  await f.approve(sid, op); const published = await f.call('execute', f.command(sid, op)); assert.ok(!published.isError, JSON.stringify(published));
  assert.equal(published.details.view.publication.latest.receipt.published, true); assert.equal(published.details.acquisition.startedAt, null);
  const oldDraft = await f.call('reconcile', { ...cmd, requestId: 'old-draft-observation' });
  assert.equal(oldDraft.details.view.publication.selectedOperation.id, cmd.operationId); assert.equal(oldDraft.details.view.publication.latest.id, op.id);
  assert.equal(oldDraft.details.status, 'partial');
  assert.equal(f.app.store.read().businessLibrary.products.length, 1); assert.equal(f.app.capabilities.listSchedules().length, 0);
});
test('ambiguous SKUs/combinations, missing price, invented specs and unselected source/media refuse without writes', async t => {
  const f = await fixture(t, { skuCount: 4 }), base = { productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'bad-multi', draft: multiDraft(f) };
  const changes = [
    d => { d.variants[1].sourceSkuId = d.variants[0].sourceSkuId; }, d => { d.variants[1].skuCode = d.variants[0].skuCode.toLowerCase(); },
    d => { d.variants[1].optionValues = d.variants[0].optionValues; }, d => { delete d.variants[0].consumerPrice; }, d => { d.variants[0].consumerPrice = '0'; },
    d => { d.variants[0].imageId = randomUUID(); }, d => { d.variants[0].sourceSkuId = randomUUID(); }, d => { d.variants[0].skuCode = 'INVENTED'; },
    d => { d.options[0].values.push('red'); }, d => { d.options.push(d.options[0]); }, d => { d.options[0].values.push('Unused'); },
    d => { d.consumerPrice = '1'; }, d => { d.variants[0].inventoryQuantities = [{ availableQuantity: 999 }]; },
    d => { d.variants[0].optionValues[1].value = 'Size-1'; },
  ];
  for (const change of changes) { const input = structuredClone(base); change(input.draft); assert.equal((await f.call('propose', input)).isError, true, JSON.stringify(input)); }
  assert.equal(f.app.store.read().workspaceSupplierServices?.services.length || 0, 0); assert.equal(f.remote.calls.length, 0);
  const absent = await fixture(t, { skuCount: 4, policy: p => ({ ...p, factoryMaterials: { ...p.factoryMaterials, productFields: ['name', 'images'] } }) });
  assert.equal((await absent.call('readiness', { productId: absent.product.id })).details.view.variantSources.status, 'not_selected');
  assert.equal((await absent.call('propose', { ...base, productId: absent.product.id, sourceHash: await absent.sourceHash(), draft: multiDraft(absent) })).isError, true);
});
for (const mode of ['lost_variants', 'partial_variants', 'lost_create']) test(`multi-variant ${mode} reconciles original attempts without duplicate creation or legacy repair`, async t => {
  const f = await fixture(t, { skuCount: 4 }), input = { productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'uncertain-multi', draft: multiDraft(f) };
  const sid = (await f.call('propose', input)).details.view.serviceId; await f.call('review', { serviceId: sid, requestId: 'review', action: 'draft' }); const op = f.operation(sid); await f.approve(sid, op);
  if (mode === 'partial_variants') f.remote.state.partialVariants = true; else f.remote.state.drops.add(mode === 'lost_create' ? 'SupplierCreateDraft' : 'SupplierCreateReviewedVariants');
  const cmd = f.command(sid, op); assert.equal((await f.call('execute', cmd)).isError, true);
  const reconciled = await f.call('reconcile', f.command(sid, op)), current = reconciled.details.view.publication.latest;
  assert.equal(current.id, op.id); assert.equal(current.status, mode === 'lost_variants' ? 'succeeded' : 'partial');
  assert.equal(current.receipt.complete, mode === 'lost_variants'); await f.call('execute', cmd);
  if (mode !== 'lost_create') assert.notEqual(current.steps.find(s => s.step === 'retail_variants').status, 'acknowledged');
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierCreateReviewedVariants'), mode === 'lost_create' ? 0 : 1);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 1); assert.equal(f.app.capabilities.listApprovals().length, 1);
  if (mode !== 'lost_variants') await assert.rejects(f.app.supplierPublication.forActor(f.actor).reviewPublication(f.cid, sid, { requestId: 'no-legacy-repair',
    expectedRevision: 1, expectedPreviewHash: op.scope.previewHash, action: 'repair_draft', draftOperationId: op.id, expectedRemoteContentHash: current.receipt.remoteContentHash, confirmed: true }), { code: 'SHOPIFY_MULTI_VARIANT_REPAIR_UNSUPPORTED' });
});
for (const mode of ['cancel', 'connector', 'source']) test(`multi-variant ${mode} after remote product creation prevents further variant writes`, async t => {
  const f = await fixture(t, { skuCount: 4 }), sid = (await f.call('propose', { productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'guard', draft: multiDraft(f) })).details.view.serviceId;
  await f.call('review', { serviceId: sid, action: 'draft', requestId: 'guard-review' }); const op = f.operation(sid); await f.approve(sid, op); const controller = new AbortController();
  f.remote.state.afterResponsePrepared = async ({ name }) => { if (name !== 'SupplierCreateDraft') return;
    if (mode === 'cancel') controller.abort();
    else if (mode === 'connector') await f.app.capabilities.updateConnector(f.app.supplierPublication.connectorId, { enabled: false });
    else await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { skus: [] } }, f.actor);
  };
  assert.equal((await f.call('execute', f.command(sid, op), controller.signal)).isError, true);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierCreateReviewedVariants'), 0); assert.equal(f.operation(sid).status, 'uncertain');
  if (mode === 'source') { assert.equal(f.operation(sid).stale, true); assert.equal(f.operation(sid).canExecute, false); }
});
for (const field of ['price', 'sku', 'options', 'media']) test(`remote multi-variant ${field} edits invalidate exact publish review`, async t => {
  const f = await fixture(t, { skuCount: 4 }), sid = (await f.call('propose', { productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'changed-remote', draft: multiDraft(f) })).details.view.serviceId;
  await f.call('review', { serviceId: sid, requestId: 'draft-review', action: 'draft' }); const op = f.operation(sid); await f.approve(sid, op);
  assert.ok(!(await f.call('execute', f.command(sid, op))).isError);
  const product = [...f.remote.products.values()][0], variant = product.variants.nodes[0];
  if (field === 'price') variant.price = '999.00'; else if (field === 'sku') variant.sku = 'UNREVIEWED';
  else if (field === 'media') variant.media.nodes = []; else variant.selectedOptions[0].value = 'Unreviewed';
  assert.equal((await f.call('review', { serviceId: sid, requestId: 'blocked-publish', action: 'publish', publicationId: PUB })).isError, true);
  assert.equal(f.app.capabilities.listApprovals().length, 1); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
});
test('100 explicit original SKUs fit the original bounded receipts and no absent combinations are manufactured', async t => {
  const f = await fixture(t, { skuCount: 100 }), input = { productId: f.product.id, sourceHash: await f.sourceHash(), requestId: 'maximum', draft: multiDraft(f) };
  const proposed = await f.call('propose', input); assert.ok(!proposed.isError, JSON.stringify(proposed)); const sid = proposed.details.view.serviceId;
  await f.call('review', { serviceId: sid, action: 'draft', requestId: 'max-review' }); const op = f.operation(sid); await f.approve(sid, op);
  const result = await f.call('execute', f.command(sid, op)); assert.ok(!result.isError, JSON.stringify(result)); assert.equal(result.details.view.publication.latest.receipt.variantIds.length, 100);
  const ids = [], prices = [];
  for (let offset = 0; offset < 100; offset += 10) {
    const page = await f.call('result', { serviceId: sid, variantOffset: offset, variantLimit: 10 });
    assert.equal(page.details.view.variantPage.total, 100); assert.equal(page.details.view.variantPage.hasMore, offset < 90);
    ids.push(...page.details.view.publication.latest.receipt.variantReceipts.map(v => v.sourceSkuId)); prices.push(...page.details.view.preview.variants.map(v => v.price));
  }
  assert.deepEqual(ids, f.product.skus.map(s => s.id)); assert.deepEqual(prices, input.draft.variants.map(v => v.consumerPrice));
  assert.ok(Buffer.byteLength(JSON.stringify(result.details)) < 1500000); assert.equal(f.remote.count('SupplierCreateReviewedVariants'), 1);
  const diagonal = await fixture(t, { skuCount: 4 }), d = multiDraft(diagonal); d.variants = [d.variants[0], d.variants[3]];
  const selected = await diagonal.call('propose', { productId: diagonal.product.id, sourceHash: await diagonal.sourceHash(), requestId: 'diagonal', draft: d });
  assert.equal(selected.details.view.preview.variants.length, 2);
});
