// Ordinary supplier business tests. Real local HTTP + original Store/capability
// service, with a clearly synthetic Shopify server. No real accounts or writes.
import test from 'node:test';
import { fakeShopify } from './fixtures/supplier-shopify-http.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createCapabilityService } from '../server/capabilities.mjs';
import { createShopifyClient } from '../server/shopify.mjs';
import { createSupplierService } from '../server/supplier-service.mjs';
import { createShopifyPublicationAdapter, SUPPLIER_SHOPIFY_ADAPTER } from '../server/shopify-publication.mjs';
import { createSupplierPublication } from '../server/supplier-publication.mjs';

const PUB = 'gid://shopify/Publication/7';
const PUBLIC = ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'];

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/supplier-publication-test-'), remote = await fakeShopify(t), cid = randomUUID();
  const actor = { subject: 'local-supplier-fixture', workspaceId: 'local', role: options.muse ? 'admin' : 'operator' };
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==', 'base64'), image = { artifactId: randomUUID(), version: 1, sha256: createHash('sha256').update(imageBytes).digest('hex') };
  let museReads = 0, ordinaryReads = 0;
  const artifacts = { async download(id, { version }) { ordinaryReads++; assert.ok(!options.muse, 'Original Muse images cannot use ordinary artifact download'); assert.equal(id, image.artifactId); assert.equal(version, image.version); return { bytes: imageBytes, mimeType: 'image/png', version: { sha256: image.sha256 } }; } };
  const environment = { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'supplier-fixture.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'LOCAL-SYNTHETIC-SHOPIFY-CREDENTIAL', WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED: options.disabled ? '0' : '1' };
  let store, capabilities, adapter, domain, supplier, shopify;
  async function open() {
    store = await openStore(directory); adapter = createShopifyPublicationAdapter({ store, environment, fetchImpl: remote.fetchImpl,
      readImage: (scope, ref) => supplier.forActor({ ...actor, role: scope.actorRole }).readImage(scope.conversationId, scope.serviceId, ref) });
    capabilities = await createCapabilityService({ store, environment, adapters: { [SUPPLIER_SHOPIFY_ADAPTER]: adapter } });
    shopify = createShopifyClient({ environment, fetchImpl: remote.fetchImpl });
    domain = await createSupplierPublication({ store, capabilities, shopify, adapter });
    supplier = createSupplierService({ store, capabilities, shopify, artifacts, runtime: {}, provider: { kind: 'pi-durable' }, businessLibrary: {}, readMuseImage: async (context, conversationId, ref) => { assert.equal(context.subject, actor.subject); assert.equal(context.role, 'admin'); assert.equal(conversationId, cid); assert.deepEqual(ref, image); museReads++; return { bytes: imageBytes, mimeType: 'image/png', version: { sha256: image.sha256 } }; } });
  }
  await open();
  if (!options.disabled) { await domain.ensureConnector(); await capabilities.updateConnector(domain.connectorId, { enabled: true }); }
  await store.update(state => state.conversations.push({ id: cid, createdBy: actor.subject, workspaceId: actor.workspaceId, title: 'Local supplier publication fixture' }));
  if (options.muse) await store.update(state => state.artifacts.push({ id: image.artifactId, metadata: { museNativeAgentId: cid } }));
  const facts = { name: 'Local cotton shirt', description: 'Explicit supplier retail description', targetMarket: 'US', currency: 'USD', skuCode: 'LOCAL-RETAIL-SKU', supplierUnit: 'piece', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30, retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', handlingDays: 3, shippingDays: 7, images: [{ kind: 'artifact', asset: image, sourceNote: 'Explicit local test image; no real supplier asset' }] };
  const created = await supplier.forActor(actor).request(cid, { requestId: 'initial-fixture-facts', facts });
  let serviceId = created.serviceId;
  await supplier.forActor(actor).preview(cid, serviceId, { requestId: 'initial-fixture-preview', expectedRevision: 1, publicFields: PUBLIC, confirmed: true });
  const bound = () => domain.forActor(actor, { get: supplier.forActor(actor).get });
  const review = action => { const current = supplier.forActor(actor).get(cid, serviceId); return { requestId: randomUUID(), action, expectedRevision: current.revision, expectedPreviewHash: current.preview.previewHash, ...(action === 'publish' ? { publicationId: PUB } : {}), confirmed: true }; };
  const command = operation => ({ requestId: randomUUID(), operationId: operation.id, expectedScopeHash: operation.scopeHash, confirmed: true });
  const approve = operation => bound().decidePublication(cid, serviceId, { ...command(operation), decision: 'approved' });
  async function createDraft() { const reviewed = await bound().reviewPublication(cid, serviceId, review('draft')); await approve(reviewed.operation); return bound().executePublication(cid, serviceId, command(reviewed.operation)); }
  t.after(async () => { await capabilities.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { remote, actor, cid, serviceId, directory, environment, image, bound, review, command, approve, createDraft,
    get store() { return store; }, get capabilities() { return capabilities; }, get adapter() { return adapter; }, get reads() { return { muse: museReads, ordinary: ordinaryReads }; }, get domain() { return domain; }, get supplier() { return supplier; },
    async restart() { await capabilities.close(); await store.close(); await open(); },
  };
}

test('host defaults and the original disabled connector block writes without preparing approval', async t => {
  const f = await fixture(t, { disabled: true });
  const result = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('draft'));
  assert.equal(result.status, 'blocked'); assert.equal(result.error.code, 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED');
  assert.equal(f.capabilities.listConnectors().length, 0); assert.equal(f.capabilities.listApprovals().length, 0); assert.equal(f.remote.calls.length, 0);
});

test('original approval and connectorRuns create one exact draft then publish a separately approved version', async t => {
  const f = await fixture(t), draft = await f.createDraft();
  assert.equal(draft.status, 'succeeded', JSON.stringify(draft.operation)); assert.equal(draft.operation.receipt.status, 'shopify_draft');
  assert.equal(draft.operation.businessCompletion, 'draft_only'); assert.equal(draft.operation.receipt.published, false);
  const scope = JSON.stringify(draft.operation.scope.preview); for (const privateValue of ['wholesaleUnitPrice', 'supplierMoq', 'productionDays', '2.50', 'CNY']) assert.ok(!scope.includes(privateValue));
  assert.equal(f.remote.state.uploads, 1); assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
  const review = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish'));
  assert.equal(review.operation.status, 'pending_approval'); assert.equal(review.operation.scope.publicationId, PUB);
  assert.equal(review.operation.scope.productId, draft.operation.receipt.productId); assert.equal(review.approval.payload.binding.subject, f.actor.subject);
  await f.approve(review.operation); const published = await f.bound().executePublication(f.cid, f.serviceId, f.command(review.operation));
  assert.equal(published.status, 'succeeded', JSON.stringify(published.operation)); assert.equal(published.operation.receipt.status, 'published');
  assert.equal(published.operation.businessCompletion, 'published'); assert.equal(f.capabilities.listConnectorRuns().length, 2);
  assert.ok(f.capabilities.listApprovals().every(item => item.status === 'consumed'));
  assert.equal(published.service.external.status, 'published');
  assert.equal(published.operation.receipt.publishedAt, null, 'arbitrary selected-channel receipt must not invent a channel-specific timestamp');
  const stored = await fs.readFile(f.directory + '/workspace.json', 'utf8');
  assert.ok(!stored.includes(f.environment.WORKSPACE_SHOPIFY_ADMIN_TOKEN)); assert.ok(!stored.includes('LOCAL-EPHEMERAL-UPLOAD-AUTH-NEVER-PERSIST'));
});

test('repeated submissions, lost local response and cold reopen retain the same operation, approval and remote product', async t => {
  const f = await fixture(t), input = f.review('draft'), first = await f.bound().reviewPublication(f.cid, f.serviceId, input);
  assert.equal((await f.bound().reviewPublication(f.cid, f.serviceId, input)).operation.id, first.operation.id);
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, { ...input, action: 'publish', publicationId: PUB }), { code: 'IDEMPOTENCY_CONFLICT' });
  await f.approve(first.operation); const execution = f.command(first.operation); await f.bound().executePublication(f.cid, f.serviceId, execution);
  await f.restart(); const recovered = f.bound().publication(f.cid, f.serviceId).publication.latest;
  assert.equal(recovered.id, first.operation.id); assert.equal(recovered.approvalStatus, 'consumed');
  assert.equal((await f.bound().executePublication(f.cid, f.serviceId, execution)).duplicate, true);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.capabilities.listConnectorRuns().length, 1); assert.equal(f.capabilities.listApprovals().length, 1);
});

test('changed preview invalidates the previous approval and allows a separate current review without writing', async t => {
  const f = await fixture(t), initial = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('draft')); await f.approve(initial.operation);
  await f.supplier.forActor(f.actor).profile(f.cid, f.serviceId, { requestId: 'changed-unit', expectedRevision: 2, facts: { unitsPerPack: 3 } });
  await assert.rejects(f.bound().executePublication(f.cid, f.serviceId, f.command(initial.operation)), { code: 'SUPPLIER_PUBLICATION_STALE' });
  await f.supplier.forActor(f.actor).preview(f.cid, f.serviceId, { requestId: 'changed-preview', expectedRevision: 3, confirmed: true, publicFields: PUBLIC });
  const current = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('draft')); assert.notEqual(current.operation.id, initial.operation.id); assert.equal(current.operation.scope.preview.saleUnit.unitsPerPack, 3);
  assert.equal(f.bound().publication(f.cid, f.serviceId).publication.operations[0].status, 'stale'); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
});

test('remote draft acknowledgement lost after price update is read-only reconciled after restart', async t => {
  const f = await fixture(t); f.remote.state.drops.add('SupplierSetRetailVariant');
  const first = await f.createDraft(); assert.equal(first.status, 'uncertain'); assert.equal(f.remote.products.size, 1);
  await f.restart(); const state = f.bound().publication(f.cid, f.serviceId).publication.latest; assert.equal(state.id, first.operation.id);
  const recovered = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(state)); assert.equal(recovered.status, 'succeeded'); assert.equal(recovered.operation.receipt.status, 'shopify_draft');
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierSetRetailVariant'), 1); assert.equal(f.capabilities.listConnectorRuns().length, 1);
  await assert.rejects(f.bound().executePublication(f.cid, f.serviceId, f.command(state)), { code: 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE' });
});

test('lost create acknowledgement preserves a partial draft and never automatically performs missing variant writes', async t => {
  const f = await fixture(t); f.remote.state.drops.add('SupplierCreateDraft');
  const first = await f.createDraft(); assert.equal(first.status, 'uncertain');
  await f.restart(); const recovered = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(first.operation));
  assert.equal(recovered.status, 'partial'); assert.equal(recovered.operation.receipt.productId, [...f.remote.products.values()][0].id); assert.ok(recovered.operation.receipt.issues.includes('retail_variant_changed'));
  assert.equal(f.remote.count('SupplierSetRetailVariant'), 0); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
});

test('publication response loss is reconciled by product marker and channel receipt without a second publish', async t => {
  const f = await fixture(t); await f.createDraft(); const reviewed = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')); await f.approve(reviewed.operation);
  f.remote.state.drops.add('SupplierPublishReviewedProduct'); const first = await f.bound().executePublication(f.cid, f.serviceId, f.command(reviewed.operation)); assert.equal(first.status, 'uncertain');
  await f.restart(); const recovered = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(reviewed.operation));
  assert.equal(recovered.status, 'succeeded'); assert.equal(recovered.operation.receipt.published, true); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 1); assert.equal(f.remote.count('SupplierActivateReviewedDraft'), 1);
});

test('pending media can later be reconciled and unowned or altered external markers never count as completion', async t => {
  const f = await fixture(t); f.remote.state.mediaReady = false; const first = await f.createDraft(); assert.equal(first.status, 'partial');
  const product = [...f.remote.products.values()][0]; product.media.nodes[0].status = 'READY'; product.media.nodes[0].image = { url: 'https://cdn.shopify.com/fixture/media-1000.png' };
  const ready = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(first.operation)); assert.equal(ready.status, 'succeeded');
  product.intent.value = 'unrelated-remote-product-marker'; const mismatch = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(first.operation)); assert.equal(mismatch.status, 'uncertain'); assert.equal(mismatch.observation.error.code, 'SHOPIFY_RECEIPT_SCOPE_MISMATCH');
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierSetRetailVariant'), 1);
  assert.throws(() => f.domain.forActor({ ...f.actor, subject: 'another-local-fixture' }).publication(f.cid, f.serviceId), { status: 404 });
});

test('a review response gap before approval creation resumes the original operation rather than leaving preparing forever', async t => {
  const f = await fixture(t), input = f.review('draft'), original = f.capabilities.requestApproval;
  f.capabilities.requestApproval = async () => { throw Object.assign(new Error('Local deliberate pre-approval interruption'), { code: 'LOCAL_INTERRUPTION' }); };
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, input), { code: 'LOCAL_INTERRUPTION' });
  const operation = f.bound().publication(f.cid, f.serviceId).publication.latest; assert.equal(operation.status, 'preparing');
  f.capabilities.requestApproval = original; const retried = await f.bound().reviewPublication(f.cid, f.serviceId, input);
  assert.equal(retried.operation.id, operation.id); assert.equal(retried.operation.status, 'pending_approval'); assert.equal(f.capabilities.listApprovals().length, 1); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
});

test('turning off writes retains read-only access to an original uncertain receipt', async t => {
  const f = await fixture(t); f.remote.state.drops.add('SupplierSetRetailVariant'); const first = await f.createDraft();
  f.environment.WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED = '0'; await f.restart();
  const recovered = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(first.operation)); assert.equal(recovered.status, 'succeeded'); assert.equal(recovered.operation.stale, true); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
});

test('a remote image replacement after draft creation cannot be published as the original approved preview', async t => {
  const f = await fixture(t), draft = await f.createDraft();
  [...f.remote.products.values()][0].media.nodes[0].id = 'gid://shopify/MediaImage/99999';
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')), { code: 'SHOPIFY_DRAFT_CHANGED' });
  const read = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(draft.operation)); assert.equal(read.status, 'partial'); assert.ok(read.operation.receipt.issues.includes('remote_content_changed'));
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')), { code: 'SHOPIFY_DRAFT_CHANGED' });
  assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
});

test('content or publication metadata changed during activation is observed before any channel publish', async t => {
  for (const mutation of ['content', 'publication_marker']) await t.test(mutation, async sub => {
    const f = await fixture(sub); await f.createDraft();
    const prepared = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')); await f.approve(prepared.operation);
    f.remote.state.afterResponsePrepared = ({ name, products }) => {
      if (name !== 'SupplierActivateReviewedDraft') return;
      const product = [...products.values()][0];
      if (mutation === 'content') product.title = 'Unreviewed external title change';
      else product.release.value = 'unreviewed-external-publication-marker';
    };
    const result = await f.bound().executePublication(f.cid, f.serviceId, f.command(prepared.operation));
    assert.equal(result.status, 'uncertain'); assert.equal(result.service.external.status, 'uncertain');
    assert.equal(f.remote.count('SupplierActivateReviewedDraft'), 1); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
    const observed = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(prepared.operation));
    assert.equal(observed.status, 'partial');
    assert.ok(observed.operation.receipt.issues.includes(mutation === 'content' ? 'remote_content_changed' : 'publication_marker_changed'));
    assert.equal(observed.operation.businessCompletion, 'draft_only');
  });
});

test('older draft reconciliation cannot replace a later publication and unknown latest receipts are visibly uncertain', async t => {
  const f = await fixture(t), draft = await f.createDraft();
  const prepared = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')); await f.approve(prepared.operation);
  await f.bound().executePublication(f.cid, f.serviceId, f.command(prepared.operation));
  const old = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(draft.operation));
  assert.equal(old.status, 'partial'); assert.equal(old.service.external.status, 'published');
  assert.equal(old.service.external.operationId, prepared.operation.id);
  [...f.remote.products.values()][0].intent.value = 'changed-external-owner-marker';
  const latest = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(prepared.operation));
  assert.equal(latest.status, 'uncertain'); assert.equal(latest.service.external.status, 'uncertain');
  assert.equal(latest.service.external.published, false); assert.equal(latest.service.external.publishedAt, null);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 1);
});

test('an expired unused review remains recorded and a new explicit review can request a fresh original approval', async t => {
  const f = await fixture(t), first = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('draft'));
  await f.store.update(state => { state.capabilities.approvals.find(item => item.id === first.operation.approvalId).expiresAt = new Date(Date.now() - 1000).toISOString(); });
  await assert.rejects(f.approve(first.operation), { code: 'APPROVAL_EXPIRED' });
  const next = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('draft'));
  assert.notEqual(next.operation.id, first.operation.id); assert.notEqual(next.operation.approvalId, first.operation.approvalId);
  const history = f.bound().publication(f.cid, f.serviceId).publication.operations;
  assert.equal(history[0].status, 'stale'); assert.equal(history[0].canExecute, false);
  assert.equal(f.capabilities.listApprovals().length, 2); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
});

test('revoking the original connector after staging interrupts transfer without creating a product', async t => {
  const f = await fixture(t);
  f.remote.state.afterResponsePrepared = async ({ name }) => {
    if (name === 'SupplierStageReviewedImage') await f.capabilities.updateConnector(f.domain.connectorId, { enabled: false });
  };
  const result = await f.createDraft();
  assert.equal(result.status, 'uncertain');
  assert.equal(f.remote.count('SupplierStageReviewedImage'), 1);
  assert.equal(f.remote.state.uploads, 0); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
  assert.equal(result.operation.steps[0].status, 'acknowledged');
  await f.restart();
  const observed = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(result.operation));
  assert.equal(observed.observation.status, 'not_found'); assert.equal(observed.status, 'uncertain');
  assert.equal(f.remote.state.uploads, 0);
});

test('a credential omitted from the original broker cannot be replaced by the host secret', async t => {
  const f = await fixture(t), prepared = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('draft'));
  await assert.rejects(f.adapter.execute({ action: 'supplier.shopify.draft', payload: prepared.operation.scope,
    binding: { type: 'supplier-publication', operationId: prepared.operation.id, scopeHash: prepared.operation.scopeHash },
    connectorId: f.domain.connectorId, idempotencyKey: 'unadmitted-fixture-run', credentials: {} }), { code: 'SHOPIFY_APPROVED_CREDENTIAL_REQUIRED' });
  assert.equal(f.remote.count('SupplierCreateDraft'), 0); assert.equal(f.remote.state.uploads, 0);
  assert.equal(f.capabilities.listConnectorRuns().length, 0);
});

test('same media identity with a changed CDN URL is incomplete and cannot be published', async t => {
  const f = await fixture(t), draft = await f.createDraft();
  assert.equal(draft.operation.receipt.mediaEvidence.remoteBytesVerified, false);
  [...f.remote.products.values()][0].media.nodes[0].image.url = 'https://cdn.shopify.com/fixture/replaced.png';
  const observed = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(draft.operation));
  assert.equal(observed.status, 'partial'); assert.ok(observed.observation.issues.includes('remote_content_changed'));
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')), { code: 'SHOPIFY_DRAFT_CHANGED' });
  assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
});

test('image transfer follows the exact reviewed original file reference before staged authorization', async t => {
  const f = await fixture(t), bound = f.supplier.forActor(f.actor);
  const file = await bound.readImage(f.cid, f.serviceId, f.image);
  assert.equal(file.version.sha256, f.image.sha256);
  await assert.rejects(bound.readImage(f.cid, f.serviceId, { ...f.image, version: 2 }), { code: 'SUPPLIER_IMAGE_UNAVAILABLE' });
  assert.equal(f.remote.count('SupplierStageReviewedImage'), 0);
});

test('original Muse image transfer retains the approved administrator role and uses the owned Session reader', async t => {
  const f = await fixture(t, { muse: true }), draft = await f.createDraft();
  assert.equal(draft.status, 'succeeded'); assert.equal(draft.operation.scope.actorRole, 'admin');
  assert.equal(f.reads.ordinary, 0); assert.ok(f.reads.muse >= 2);
  assert.equal(f.remote.state.uploads, 1);
  assert.equal(draft.operation.receipt.mediaEvidence.remoteBytesVerified, false);
});

const repairReview = (f, original, extras = {}) => ({ ...f.review('repair_draft'), draftOperationId: original.id,
  expectedRemoteContentHash: original.receipt.remoteContentHash, ...extras });
async function partialDraft(f, mode = 'lost_create') {
  if (mode === 'lost_create') f.remote.state.drops.add('SupplierCreateDraft');
  else f.remote.state.rejectVariant = true;
  const attempt = await f.createDraft(); assert.equal(attempt.status, 'uncertain');
  f.remote.state.rejectVariant = false;
  return f.bound().reconcilePublication(f.cid, f.serviceId, f.command(attempt.operation));
}
async function repairDraft(f, original, extras = {}) {
  const review = await f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, original, extras));
  await f.approve(review.operation);
  return f.bound().executePublication(f.cid, f.serviceId, f.command(review.operation));
}

test('separately approved lost-create repair reuses exact product/media without rewriting original attempt checkpoints', async t => {
  const f = await fixture(t), partial = await partialDraft(f), reads = f.reads.ordinary;
  assert.equal(partial.status, 'partial'); assert.ok(partial.observation.issues.includes('media_identity_unconfirmed'));
  const repaired = await repairDraft(f, partial.operation, { approveObservedMedia: true });
  assert.equal(repaired.status, 'succeeded', JSON.stringify(repaired.operation.error));
  assert.equal(repaired.operation.action, 'repair_draft'); assert.equal(repaired.operation.receipt.productId, partial.observation.productId);
  assert.deepEqual(repaired.operation.receipt.mediaIds, partial.observation.mediaIds);
  assert.equal(repaired.operation.receipt.mediaEvidence.remote, 'separately_approved_observed_ids_and_shopify_status');
  assert.equal(repaired.operation.receipt.mediaEvidence.remoteBytesVerified, false);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierStageReviewedImage'), 1);
  assert.equal(f.remote.state.uploads, 1); assert.equal(f.reads.ordinary, reads); assert.equal(f.remote.count('SupplierSetRetailVariant'), 1);
  const original = f.bound().publication(f.cid, f.serviceId).publication.operations.find(item => item.id === partial.operation.id);
  assert.equal(original.status, 'succeeded'); assert.deepEqual(original.repairedBy, [repaired.operation.id]);
  assert.equal(original.steps.find(item => item.step === 'product_create').status, 'started');
  assert.equal(f.capabilities.listConnectorRuns().find(item => item.id === original.connectorRunId).status, 'failed');
  const publish = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')); await f.approve(publish.operation);
  const released = await f.bound().executePublication(f.cid, f.serviceId, f.command(publish.operation));
  assert.equal(released.status, 'succeeded'); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 1); assert.equal(f.capabilities.listApprovals().length, 3);
});

test('unknown draft must be reconciled first and unknown media needs its own explicit observed-ID review', async t => {
  const f = await fixture(t); f.remote.state.drops.add('SupplierCreateDraft');
  const unknown = await f.createDraft();
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, { ...f.review('repair_draft'), draftOperationId: unknown.operation.id, expectedRemoteContentHash: '0'.repeat(64), approveObservedMedia: true }), { code: 'SHOPIFY_REPAIR_RECONCILIATION_REQUIRED' });
  const partial = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(unknown.operation));
  await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, partial.operation)), { code: 'SHOPIFY_REPAIR_MEDIA_REVIEW_REQUIRED' });
  assert.equal(f.capabilities.listApprovals().length, 1); assert.equal(f.remote.count('SupplierSetRetailVariant'), 0);
});

test('acknowledged create plus rejected retail variant repairs only the missing variant on the original identity', async t => {
  const f = await fixture(t), partial = await partialDraft(f, 'rejected_variant');
  assert.deepEqual(partial.observation.issues, ['retail_variant_changed']);
  const repaired = await repairDraft(f, partial.operation);
  assert.equal(repaired.status, 'succeeded'); assert.equal(repaired.operation.scope.repair.approveObservedMedia, false);
  assert.deepEqual(repaired.operation.scope.repair.steps, ['retail_variant']);
  assert.equal(f.remote.count('SupplierSetRetailVariant'), 2); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  assert.equal(f.remote.state.uploads, 1); assert.equal(repaired.operation.receipt.mediaEvidence.remote, 'acknowledged_ids_and_shopify_status');
});

test('lost repair response survives reopen and only reads original repair receipt without a second variant update', async t => {
  const f = await fixture(t), partial = await partialDraft(f);
  const prepared = await f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, partial.operation, { approveObservedMedia: true }));
  await f.approve(prepared.operation); f.remote.state.drops.add('SupplierSetRetailVariant');
  const body = f.command(prepared.operation), first = await f.bound().executePublication(f.cid, f.serviceId, body);
  assert.equal(first.status, 'uncertain'); await f.restart();
  const duplicate = await f.bound().executePublication(f.cid, f.serviceId, body); assert.equal(duplicate.duplicate, true);
  const rootObserved = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(partial.operation));
  assert.equal(rootObserved.status, 'succeeded');
  const publication = await f.bound().reviewPublication(f.cid, f.serviceId, f.review('publish')); await f.approve(publication.operation);
  await assert.rejects(f.bound().executePublication(f.cid, f.serviceId, f.command(publication.operation)), { code: 'SUPPLIER_PUBLICATION_PENDING' });
  const recovered = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(prepared.operation));
  assert.equal(recovered.status, 'succeeded'); assert.equal(recovered.operation.receipt.productId, first.operation.scope.productId);
  assert.equal(f.remote.count('SupplierSetRetailVariant'), 1); assert.equal(f.remote.state.uploads, 1);
  const released = await f.bound().executePublication(f.cid, f.serviceId, f.command(publication.operation));
  assert.equal(released.status, 'succeeded'); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 1);
});

test('an existing Connector does not acquire the repair capability automatically', async t => {
  const f = await fixture(t), partial = await partialDraft(f);
  await f.capabilities.updateConnector(f.domain.connectorId, { capabilities: ['supplier.shopify.draft', 'supplier.shopify.publish'] });
  await f.restart();
  const response = await f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, partial.operation, { approveObservedMedia: true }));
  assert.equal(response.status, 'blocked'); assert.equal(response.error.code, 'SUPPLIER_REPAIR_CONNECTOR_REVIEW_REQUIRED');
  assert.deepEqual(f.capabilities.getConnector(f.domain.connectorId).capabilities, ['supplier.shopify.draft', 'supplier.shopify.publish']);
  assert.equal(f.capabilities.listApprovals().length, 1); assert.equal(f.remote.count('SupplierSetRetailVariant'), 0);
});

test('changed remote content, substituted media and active products cannot execute an earlier repair review', async t => {
  for (const changed of ['title', 'media', 'active']) await t.test(changed, async sub => {
    const f = await fixture(sub), partial = await partialDraft(f), prepared = await f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, partial.operation, { approveObservedMedia: true }));
    await f.approve(prepared.operation); const product = [...f.remote.products.values()][0];
    if (changed === 'title') product.title = 'External content edit';
    if (changed === 'media') product.media.nodes[0].id = 'gid://shopify/MediaImage/9999';
    if (changed === 'active') { product.status = 'ACTIVE'; product.publishedOnPublication = true; }
    const result = await f.bound().executePublication(f.cid, f.serviceId, f.command(prepared.operation));
    assert.equal(result.status, 'uncertain'); assert.equal(f.remote.count('SupplierSetRetailVariant'), 0);
    assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.state.uploads, 1);
    assert.equal(product.status, changed === 'active' ? 'ACTIVE' : 'DRAFT');
    assert.equal(f.remote.count('SupplierActivateReviewedDraft'), 0); assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0);
  });
});

test('a repair whose retail goal was already completed does not write it again', async t => {
  const f = await fixture(t), partial = await partialDraft(f), prepared = await f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, partial.operation, { approveObservedMedia: true }));
  await f.approve(prepared.operation); Object.assign([...f.remote.products.values()][0].variants.nodes[0], { price: '9.50', sku: 'LOCAL-RETAIL-SKU' });
  const complete = await f.bound().executePublication(f.cid, f.serviceId, f.command(prepared.operation));
  assert.equal(complete.status, 'succeeded'); assert.equal(f.remote.count('SupplierSetRetailVariant'), 0);
  assert.equal(complete.operation.steps.length, 0); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
});

test('failed media, unconfirmed upload and already acknowledged variant writes are explicit non-repairable states', async t => {
  for (const mode of ['failed_media', 'unconfirmed_upload', 'acknowledged_variant']) await t.test(mode, async sub => {
    const f = await fixture(sub);
    let partial;
    if (mode === 'acknowledged_variant') {
      f.remote.state.mediaReady = false; const initial = await f.createDraft(); assert.equal(initial.status, 'partial');
      const product = [...f.remote.products.values()][0]; product.media.nodes[0].status = 'READY'; product.media.nodes[0].image = { url: 'https://cdn.shopify.com/fixture/media-1000.png' }; product.variants.nodes[0].price = '0.00';
      partial = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(initial.operation));
    } else {
      partial = await partialDraft(f);
      if (mode === 'failed_media') { [...f.remote.products.values()][0].media.nodes[0].status = 'FAILED'; partial = await f.bound().reconcilePublication(f.cid, f.serviceId, f.command(partial.operation)); }
      if (mode === 'unconfirmed_upload') await f.store.update(state => { state.workspaceSupplierServices.services[0].publicationOperations[0].steps.find(item => item.step === 'image_0_upload').status = 'started'; });
    }
    const prices = f.remote.count('SupplierSetRetailVariant');
    await assert.rejects(f.bound().reviewPublication(f.cid, f.serviceId, repairReview(f, partial.operation, { approveObservedMedia: true })), { code: mode === 'failed_media' ? 'SHOPIFY_REPAIR_MEDIA_OR_CONTENT_CHANGED' : mode === 'unconfirmed_upload' ? 'SHOPIFY_REPAIR_MEDIA_TRANSFER_UNCONFIRMED' : 'SHOPIFY_REPAIR_VARIANT_ALREADY_ACKNOWLEDGED' });
    assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.state.uploads, 1);
    assert.equal(f.remote.count('SupplierSetRetailVariant'), prices);
  });
});

test('duplicate repair requests create one original approval and admit at most one variant mutation', async t => {
  const f = await fixture(t), partial = await partialDraft(f);
  const body = repairReview(f, partial.operation, { approveObservedMedia: true });
  const prepared = await f.bound().reviewPublication(f.cid, f.serviceId, body);
  assert.equal((await f.bound().reviewPublication(f.cid, f.serviceId, body)).operation.id, prepared.operation.id);
  await f.approve(prepared.operation); const command = f.command(prepared.operation);
  const results = await Promise.allSettled([f.bound().executePublication(f.cid, f.serviceId, command), f.bound().executePublication(f.cid, f.serviceId, command)]);
  assert.ok(results.some(item => item.status === 'fulfilled' && item.value.status === 'succeeded'));
  for (const item of results) if (item.status === 'rejected') assert.equal(item.reason.code, 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE');
  assert.equal(f.remote.count('SupplierSetRetailVariant'), 1); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  assert.equal(f.capabilities.listApprovals().length, 2); assert.equal(f.capabilities.listConnectorRuns().length, 2);
});
