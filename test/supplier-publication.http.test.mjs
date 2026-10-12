// Actual application routes, original enterprise/owner checks and capability
// transactions. Shopify requests only reach the shared local HTTP fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createApp } from '../server/index.mjs';
import { fakeShopify } from './fixtures/supplier-shopify-http.mjs';

async function fixture(t) {
  const remote = await fakeShopify(t);
  const directory = await fs.mkdtemp('/tmp/supplier-publication-http-');
  const faux = fauxProvider();
  const environment = {
    WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'supplier-fixture.myshopify.com',
    WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'LOCAL-SYNTHETIC-SHOPIFY-CREDENTIAL',
    WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED: '1',
  };
  let app, address;
  const open = async () => {
    const models = createModels(); models.setProvider(faux.provider);
    app = await createApp({ dataDirectory: directory, capabilityEnvironment: environment,
      shopifyFetch: remote.fetchImpl, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
    address = await app.listen(0);
  };
  await open();
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const http = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal(app.capabilities.listConnectors().length, 0, 'app startup must not silently install or enable a writer');
  await app.supplierPublication.ensureConnector();
  const enabled = await http(`/api/connectors/${app.supplierPublication.connectorId}`, 'PATCH', { enabled: true });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  const conversation = await http('/api/conversations', 'POST', { title: 'Local supplier route fixture', requestId: 'publication-http-conversation' });
  assert.equal(conversation.status, 201, JSON.stringify(conversation.body));
  const base = `/api/conversations/${encodeURIComponent(conversation.body.conversation.id)}/supplier-services`;
  const uploaded = await http('/api/artifacts', 'POST', {
    requestId: 'publication-http-image', filename: 'approved-retail.png',
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==',
    metadata: { businessLibrary: { visibility: 'internal' } },
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const image = uploaded.body.artifact;
  const created = await http(base, 'POST', { requestId: 'publication-http-facts', facts: {
    name: 'HTTP fixture retail shirt', description: 'Known facts supplied through the existing service', targetMarket: 'US', currency: 'USD',
    skuCode: 'HTTP-RETAIL-SKU', supplierUnit: 'piece', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30,
    retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', handlingDays: 3, shippingDays: 7,
    images: [{ kind: 'artifact', asset: { artifactId: image.id, version: image.currentVersion, sha256: image.sha256 }, sourceNote: 'Explicit local fixture image' }],
  } });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const route = `${base}/${created.body.serviceId}`;
  const preview = await http(`${route}/preview`, 'POST', { requestId: 'publication-http-preview', expectedRevision: 1, confirmed: true,
    publicFields: ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'],
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const review = action => ({ requestId: randomUUID(), expectedRevision: preview.body.service.revision,
    expectedPreviewHash: preview.body.preview.previewHash, action,
    ...(action === 'publish' ? { publicationId: 'gid://shopify/Publication/7' } : {}), confirmed: true });
  const command = operation => ({ requestId: randomUUID(), operationId: operation.id, expectedScopeHash: operation.scopeHash, confirmed: true });
  return { remote, http, route, review, command, faux, get app() { return app; },
    async restart() { await app.close(); await open(); } };
}

test('actual HTTP publication routes preserve original approval binding and exact query recovery across restart', async t => {
  const f = await fixture(t);
  const body = f.review('draft');
  const prepared = await f.http(`${f.route}/shopify-review`, 'POST', body);
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const operation = prepared.body.operation;
  assert.equal(operation.status, 'pending_approval');
  assert.equal(operation.scope.subject, 'local-operator');
  assert.equal(operation.scope.workspaceId, 'local');
  assert.equal(prepared.body.approval.payload.binding.scopeHash, operation.scopeHash);
  const generic = await f.http(`/api/approvals/${operation.approvalId}/decision`, 'POST', { decision: 'approved', confirmed: true });
  assert.equal(generic.status, 409, JSON.stringify(generic.body));
  assert.equal(generic.body.error.code, 'RUN_APPROVAL_BOUND');
  assert.equal(f.app.capabilities.listApprovals().find(item => item.id === operation.approvalId).status, 'pending');
  assert.equal(f.remote.count('SupplierCreateDraft'), 0);
  const wrongScope = await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(operation), expectedScopeHash: '0'.repeat(64), decision: 'approved' });
  assert.equal(wrongScope.status, 409);
  const approved = await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(operation), decision: 'approved' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.operation.canExecute, true);

  // A generic original connector route has no domain binding, even if a
  // client copies the visible scope and knows the real approval identifier.
  const bypass = await f.http(`/api/connectors/${operation.connectorId}/execute`, 'POST', {
    action: 'supplier.shopify.draft',
    resource: `shopify:${operation.scope.shopDomain}:${operation.scope.handle}:draft`,
    payload: operation.scope, approvalId: operation.approvalId,
  });
  assert.equal(bypass.status, 403, JSON.stringify(bypass.body));
  assert.equal(bypass.body.error.code, 'APPROVAL_MISMATCH');
  assert.equal(f.remote.count('SupplierCreateDraft'), 0);

  const executionBody = f.command(operation);
  const executed = await f.http(`${f.route}/shopify-execute`, 'POST', executionBody);
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.status, 'succeeded');
  assert.equal(executed.body.operation.businessCompletion, 'draft_only');
  await f.restart();
  const queried = await f.http(`${f.route}/publication`);
  assert.equal(queried.status, 200, JSON.stringify(queried.body));
  assert.equal(queried.body.publication.latest.id, operation.id);
  assert.equal(queried.body.publication.latest.approvalStatus, 'consumed');
  assert.equal(queried.body.publication.latest.receipt.productId, executed.body.operation.receipt.productId);
  const repeatedReview = await f.http(`${f.route}/shopify-review`, 'POST', body);
  assert.equal(repeatedReview.body.operation.id, operation.id);
  const repeatedExecute = await f.http(`${f.route}/shopify-execute`, 'POST', executionBody);
  assert.equal(repeatedExecute.body.duplicate, true);
  const conflicting = await f.http(`${f.route}/shopify-review`, 'POST', { ...body, action: 'publish', publicationId: 'gid://shopify/Publication/7' });
  assert.equal(conflicting.status, 409);

  const publishReview = await f.http(`${f.route}/shopify-review`, 'POST', f.review('publish'));
  assert.equal(publishReview.status, 200, JSON.stringify(publishReview.body));
  const release = publishReview.body.operation;
  assert.notEqual(release.approvalId, operation.approvalId);
  await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(release), decision: 'approved' });
  const publication = await f.http(`${f.route}/shopify-execute`, 'POST', f.command(release));
  assert.equal(publication.status, 200, JSON.stringify(publication.body));
  assert.equal(publication.body.operation.businessCompletion, 'published');
  assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 1);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 2);
  assert.equal(f.faux.state.callCount, 0, 'a model cannot execute publication side effects');
});

test('original session revocation stops later Shopify steps and releases its existing watcher', async t => {
  const f = await fixture(t), review = await f.http(`${f.route}/shopify-review`, 'POST', f.review('draft'));
  const operation = review.body.operation;
  assert.equal(operation.scope.actorRole, 'admin');
  await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(operation), decision: 'approved' });
  let revoke, stopped = 0;
  f.app.access.watchStream = (context, close) => { assert.equal(context.subject, 'local-operator'); revoke = close; return { valid: () => true, stop() { stopped++; } }; };
  f.remote.state.afterResponsePrepared = ({ name }) => { if (name === 'SupplierStageReviewedImage') revoke(); };
  const executed = await f.http(`${f.route}/shopify-execute`, 'POST', f.command(operation));
  assert.equal(executed.status, 200); assert.equal(executed.body.status, 'uncertain');
  assert.equal(stopped, 1); assert.equal(f.remote.state.uploads, 0); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
  const replayed = await f.http(`${f.route}/shopify-execute`, 'POST', f.command(operation));
  assert.equal(replayed.status, 409); assert.equal(stopped, 2);
});

test('an expired original session before admission preserves the approval without any external call', async t => {
  const f = await fixture(t), review = await f.http(`${f.route}/shopify-review`, 'POST', f.review('draft'));
  const operation = review.body.operation;
  await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(operation), decision: 'approved' });
  let stopped = 0;
  f.app.access.watchStream = () => ({ valid: () => false, stop() { stopped++; } });
  const execution = await f.http(`${f.route}/shopify-execute`, 'POST', f.command(operation));
  assert.equal(execution.status, 401); assert.equal(execution.body.error.code, 'SESSION_REQUIRED');
  assert.equal(stopped, 1); assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
  assert.equal(f.app.capabilities.listApprovals().find(item => item.id === operation.approvalId).status, 'approved');
  assert.equal(f.remote.count('SupplierCreateDraft'), 0); assert.equal(f.remote.state.uploads, 0);
});

test('compatible HTTP review/decision/execute/reconcile routes repair the original draft and keep publication separately approved', async t => {
  const f = await fixture(t), draft = await f.http(`${f.route}/shopify-review`, 'POST', f.review('draft'));
  const original = draft.body.operation;
  await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(original), decision: 'approved' });
  f.remote.state.drops.add('SupplierCreateDraft');
  const unknown = await f.http(`${f.route}/shopify-execute`, 'POST', f.command(original));
  assert.equal(unknown.body.status, 'uncertain');
  const observed = await f.http(`${f.route}/shopify-reconcile`, 'POST', f.command(original));
  assert.equal(observed.body.status, 'partial');
  const reviewBody = { ...f.review('repair_draft'), draftOperationId: original.id, expectedRemoteContentHash: observed.body.operation.receipt.remoteContentHash, approveObservedMedia: true };
  const repair = await f.http(`${f.route}/shopify-review`, 'POST', reviewBody);
  assert.equal(repair.status, 200, JSON.stringify(repair.body));
  assert.equal(repair.body.review.repairsExistingDraft, true); assert.equal(repair.body.review.createsProduct, false); assert.equal(repair.body.review.uploadsMedia, false); assert.equal(repair.body.review.publishes, false);
  assert.equal(repair.body.operation.scope.productId, observed.body.observation.productId);
  const approved = await f.http(`${f.route}/shopify-decision`, 'POST', { ...f.command(repair.body.operation), decision: 'approved' });
  assert.equal(approved.status, 200);
  const command = f.command(repair.body.operation), fixed = await f.http(`${f.route}/shopify-execute`, 'POST', command);
  assert.equal(fixed.body.status, 'succeeded', JSON.stringify(fixed.body.operation.error));
  assert.equal(fixed.body.operation.businessCompletion, 'draft_only');
  await f.restart();
  const duplicate = await f.http(`${f.route}/shopify-execute`, 'POST', command); assert.equal(duplicate.body.duplicate, true);
  const query = await f.http(`${f.route}/publication`); assert.equal(query.body.publication.latest.id, repair.body.operation.id);
  assert.equal(query.body.publication.operations.find(item => item.id === original.id).status, 'succeeded');
  const publish = await f.http(`${f.route}/shopify-review`, 'POST', f.review('publish')); assert.equal(publish.body.status, 'pending_approval');
  assert.notEqual(publish.body.operation.approvalId, repair.body.operation.approvalId);
  assert.equal(f.remote.count('SupplierPublishReviewedProduct'), 0); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  assert.equal(f.remote.count('SupplierStageReviewedImage'), 1); assert.equal(f.remote.state.uploads, 1);
  assert.equal(f.remote.count('SupplierSetRetailVariant'), 1); assert.equal(f.faux.state.callCount, 0);
});
