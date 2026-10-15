import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createApp } from '../server/index.mjs';
import { productFixture, draft, MODEL } from './fixtures/shopify-product.mjs';
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
test('cold original-app reopen preserves the proposal, exact operation and remote product for read-only reconciliation', async t => {
  const f = await fixture(t), sid = (await f.call('propose', await f.proposeInput())).details.view.serviceId;
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
test('actual Pi SDK chooses original reads and saves model prose into the original supplier record with synthetic authority', async t => {
  const f = await fixture(t), sdk = await import('@earendil-works/pi-coding-agent'), ai = await import('@earendil-works/pi-ai');
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
        return ai.fauxAssistantMessage([{ type: 'toolCall', id: 'propose', name: 'workspace_shopify_product_propose', arguments: { productId: f.product.id, sourceHash: receipt.sourceHash, requestId: 'pi-model-draft', draft: draft(f.imageId) } }], { stopReason: 'toolUse' }); },
      context => { calls++; const receipt = JSON.parse(context.messages.at(-1).content.filter(b => b.type === 'text').map(b => b.text).join('\n')); assert.equal(receipt.view.preview.product.title, draft(f.imageId).title); return ai.fauxAssistantMessage('Original synthetic proposal saved.'); },
    ]);
    await session.prompt('Finite keyless SDK fixture: choose a read, draft your own listing and propose it.');
    const results = session.messages.filter(r => r.role === 'toolResult'); assert.ok(results.every(r => !r.isError), JSON.stringify(results));
    assert.equal(session.messages.at(-1)?.stopReason, 'stop', JSON.stringify(session.messages.at(-1))); assert.deepEqual(results.map(r => r.toolName), ['workspace_shopify_product_read', 'workspace_shopify_product_propose']);
    assert.ok(results.every(r => !r.isError), JSON.stringify(results)); assert.equal(calls, 3); assert.equal(f.remote.calls.length, 0); assert.equal(f.app.store.read().workspaceSupplierServices.services.length, 1);
  } finally { await session.dispose(); }
});
