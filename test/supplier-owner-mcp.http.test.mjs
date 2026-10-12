import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createApp } from '../server/index.mjs';
import { createSupplierOwnerMcpBinding, SUPPLIER_OWNER_MCP_TOOLS } from '../server/supplier-mcp.mjs';
import { supplierOwnerFixture, png, retailFacts, publicFields } from './fixtures/supplier-owner-mcp.mjs';
import { fakeShopify } from './fixtures/supplier-shopify-http.mjs';

test('owner MCP uses real initialize/list/call transport and original session/body/CSRF admission; worker credential is never owner', async t => {
  const f = await supplierOwnerFixture(t, { capabilityEnvironment: { WORKSPACE_SUPPLIER_MCP_ENABLED: 'true' } });
  const initialized = await f.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-owner-client', version: '1' } });
  assert.equal(initialized.status, 200); assert.equal(initialized.body.result.serverInfo.name, 'workspace-supplier-owner');
  assert.equal((await f.rpc('notifications/initialized')).status, 202);
  const listed = await f.rpc('tools/list');
  assert.deepEqual(listed.body.result.tools, SUPPLIER_OWNER_MCP_TOOLS);
  assert.equal(listed.body.result.tools.length, 15);
  assert.ok(listed.body.result.tools.every(tool => !/worker_|decision|schedule|notification/.test(tool.name)));
  const denied = await f.tool('intake', null, { requestId: 'no-grant', facts: { name: 'Unapproved' } });
  assert.equal(denied.error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED'); assert.equal(f.app.store.read().workspaceSupplierServices?.services.length || 0, 0);
  assert.equal((await f.rpc('tools/call', { name: 'workspace_worker_claim_task', arguments: {} })).status, 404);
  const worker = await f.api('/mcp', { unsigned: true, browser: false, headers: { Authorization: `Bearer ${f.workerToken}` }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(worker.status, 200);
  assert.deepEqual(worker.body.result.tools.filter(tool => tool.name.startsWith('workspace_supplier_')).map(tool => tool.name), ['workspace_supplier_listing_preview', 'workspace_supplier_monitor_status']);
  const workerWrite = await f.api('/mcp', { unsigned: true, browser: false, headers: { Authorization: `Bearer ${f.workerToken}` }, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workspace_supplier_owner_intake', arguments: { input: { requestId: 'worker-cannot-write', facts: { name: 'Forbidden' } } } } } });
  assert.equal(workerWrite.status, 404);
  assert.equal((await f.rpc('tools/list', {}, { unsigned: true, headers: { Authorization: `Bearer ${f.workerToken}` } })).status, 401);
  assert.equal((await f.rpc('tools/list', {}, { session: undefined, headers: { Authorization: `Bearer ${f.workerToken}` } })).status, 401);
  assert.equal((await f.rpc('tools/list', {}, { headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await f.rpc('tools/list', {}, { signedBody: '{}' })).body.error.code, 'ASSERTION_BODY_MISMATCH');
  const viewer = await f.login('viewer'); assert.equal((await f.rpc('tools/list', {}, { session: viewer })).body.error.code, 'ROLE_REQUIRED');
  const extra = await f.rpc('tools/call', { name: 'workspace_supplier_owner_intake', arguments: { subject: 'owner', input: { requestId: 'forged-identity', facts: { name: 'No' } } } });
  assert.equal(JSON.parse(extra.body.result.content[0].text).code, 'SUPPLIER_INPUT_INVALID');
  assert.equal((await f.rpc('initialize', { protocolVersion: 'bogus' })).status, 400);
  const modern = '2026-07-28', meta = { 'io.modelcontextprotocol/protocolVersion': modern, 'io.modelcontextprotocol/clientCapabilities': {} };
  const discovered = await f.rpc('server/discover', { _meta: meta }, { headers: { 'MCP-Protocol-Version': modern, 'MCP-Method': 'server/discover' } });
  assert.equal(discovered.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'workspace-supplier-owner');
  const audit = f.app.access.listAudit({ limit: 200 }).records;
  assert.ok(audit.some(entry => entry.type === 'request.finished' && entry.status === 200), 'the reused transport completes the original access audit');
});

test('missing owner resolver remains blocked and loopback local mode cannot impersonate an owner plugin', async t => {
  const f = await supplierOwnerFixture(t, { supplierOwnerMcpBinding: null });
  assert.equal((await f.rpc('tools/list')).body.error.code, 'SUPPLIER_OWNER_BINDING_REQUIRED');
  assert.equal(f.app.supplierService.catalog().services[0].ownerMcp.status, 'binding_required');
  const directory = await fs.mkdtemp('/tmp/supplier-owner-local-');
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'fixture', configured: false }, supplierOwnerMcpBinding: { readReviewedScope() { assert.fail('Local mode must not ask for owner grants'); } } });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { port } = await app.listen(0);
  const response = await fetch(`http://127.0.0.1:${port}/api/conversations/any/supplier-mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-worker-only' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'SUPPLIER_OWNER_AUTH_REQUIRED');
});

test('owner scope is exact, expiring and rechecked; foreign tenant/owner/conversation records and caller-supplied authority are rejected', async t => {
  const f = await supplierOwnerFixture(t), data = await f.retail();
  for (const patch of [{ subject: 'other' }, { workspaceId: 'another-tenant' }, { conversationId: 'other' }, { operations: [] }, { serviceIds: [] }, { revoked: true }, { expiresAt: '2020-01-01T00:00:00Z' }, { expiresAt: null }]) {
    f.grant('get', data.sid, {}, { scope: patch }); assert.equal((await f.tool('get', data.sid)).error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED');
  }
  const edit = { requestId: 'hash-exact', expectedRevision: 2, facts: { name: 'Owner reviewed name' } };
  f.grant('profile', data.sid, edit);
  assert.equal((await f.tool('profile', data.sid, { ...edit, facts: { name: 'Altered' } })).error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED');
  f.grant('profile', data.sid, edit, { scope: { inputHash: '0'.repeat(64) } });
  assert.equal((await f.tool('profile', data.sid, edit)).error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED');
  const other = await f.login('other');
  assert.equal((await f.rpc('tools/list', {}, { session: other })).status, 404);
  const c = await f.api('/api/conversations', { session: other, body: { title: 'Other original conversation', requestId: 'other-conversation' } });
  const otherCid = c.body.conversation.id;
  f.grant('get', data.sid, {}, { subject: 'other', cid: otherCid });
  assert.equal((await f.tool('get', data.sid, undefined, { session: other, cid: otherCid })).error.code, 'SUPPLIER_SERVICE_NOT_FOUND');
  const foreign = createSupplierOwnerMcpBinding({ service: f.app.supplierService, actor: { subject: 'owner', role: 'admin', workspaceId: 'foreign' }, conversationId: f.cid, readReviewedScope: async () => ({ subject: 'owner', workspaceId: 'foreign', conversationId: f.cid, operations: ['get'], serviceIds: [data.sid], expiresAt: '2099-01-01T00:00:00Z' }) });
  await assert.rejects(foreign.call('get', data.sid), { code: 'SUPPLIER_CONVERSATION_REQUIRED' });
  f.clearGrants(); assert.equal((await f.tool('get', data.sid)).error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED');
  assert.equal(f.app.supplierService.forActor({ subject: 'owner', workspaceId: f.access.workspaceId, role: 'admin' }).get(f.cid, data.sid).profile.name, retailFacts.name);
});

test('real MCP intake/image/consumer preview/private product receipts reload without duplicate effects; unknown public URLs remain unusable', async t => {
  const f = await supplierOwnerFixture(t);
  const initial = await f.reviewed('intake', null, { requestId: 'public-url-intake', facts: { ...retailFacts, images: [{ kind: 'public_url', url: 'https://images.example.com/unverified.png', sourceNote: 'Unfetched owner URL' }] } });
  const preview = await f.reviewed('preview', initial.serviceId, { requestId: 'unknown-url-preview', expectedRevision: 1, publicFields, confirmed: true });
  assert.equal(preview.preview.images[0].availability, 'unknown'); assert.equal(preview.preview.phase, 'needs_information'); assert.ok(preview.preview.missingFields.includes('usableImage'));
  const data = await f.retail();
  assert.equal(data.preview.preview.saleUnit.unitsPerPack, 2); assert.equal(data.preview.preview.saleUnit.consumerPrice, '9.50'); assert.equal(data.preview.preview.images[0].availability, 'available');
  const publicText = JSON.stringify(data.preview.preview); assert.ok(!publicText.includes('2.50')); assert.ok(!publicText.includes('supplierMoq'));
  const imageInput = { requestId: 'owner-fixture-image', filename: 'shirt.png', base64: png, sourceNote: 'Synthetic owner image' };
  const save = { requestId: 'save-original-product', expectedRevision: 2, confirmed: true };
  const product = await f.reviewed('save_product', data.sid, save);
  assert.equal(product.product.skus[0].moq, 500); assert.equal(product.product.images[0].asset.sha256, data.image.sha256);
  assert.equal(data.image.sourceConversationId, f.cid); assert.equal(data.image.metadata.businessLibrary.visibility, 'internal');
  await f.restart();
  assert.equal((await f.reviewed('image_upload', null, imageInput)).artifact.id, data.image.id);
  assert.equal((await f.reviewed('intake', null, { requestId: 'owner-fixture-facts', facts: data.facts })).serviceId, data.sid);
  assert.equal((await f.reviewed('save_product', data.sid, save)).duplicate, true);
  assert.equal((await f.reviewed('get', data.sid)).productReference.productId, product.product.id);
  assert.equal(f.app.store.read().artifacts.length, 1); assert.equal(f.app.store.read().businessLibrary.products.length, 1); assert.equal(f.app.store.read().runs.length, 0);
  const other = await f.login('other'), c = await f.api('/api/conversations', { session: other, body: { title: 'Other upload', requestId: 'other-upload' } });
  const second = await f.reviewed('image_upload', null, imageInput, { subject: 'other', cid: c.body.conversation.id, session: other });
  assert.notEqual(second.artifact.id, data.image.id, 'artifact request IDs are namespaced to the original actor and conversation');
});

test('MCP partial library response recovers the same pending receipt after reload without inventing a completed product', async t => {
  const f = await supplierOwnerFixture(t), data = await f.retail();
  const create = f.app.businessLibrary.createProduct;
  f.app.businessLibrary.createProduct = async (...args) => { await create(...args); throw Error('Synthetic lost response after commit; no secret should be returned'); };
  const input = { requestId: 'lost-product-receipt', expectedRevision: 2, confirmed: true };
  f.grant('save_product', data.sid, input);
  const failed = await f.tool('save_product', data.sid, input);
  assert.equal(failed.error.code, 'SUPPLIER_OWNER_TOOL_FAILED'); assert.ok(!JSON.stringify(failed.body).includes('Synthetic lost'));
  assert.equal(f.app.store.read().businessLibrary.products.length, 1);
  const pending = await f.reviewed('get', data.sid); assert.equal(pending.productReference, null);
  await f.restart();
  const recovered = await f.reviewed('save_product', data.sid, input); assert.ok(recovered.product.id);
  assert.equal(f.app.store.read().businessLibrary.products.length, 1);
  assert.equal((await f.reviewed('save_product', data.sid, input)).duplicate, true);
});

test('revocation during host grant resolution stops admission; text intake cannot borrow structured-facts authority', async t => {
  const f = await supplierOwnerFixture(t);
  const body = { requestId: 'pi-intake-needs-original-approval', content: 'Known product facts' };
  f.grant('intake', null, body); assert.equal((await f.tool('intake', null, body)).error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED');
  const input = { requestId: 'revoked-before-admission', facts: { name: 'Not admitted' } };
  const scope = f.grant('intake', null, input);
  f.hook(async () => { const logout = await f.api('/api/session/logout', { session: f.session }); assert.equal(logout.status, 200); return scope; });
  assert.equal((await f.tool('intake', null, input)).error.code, 'SESSION_REQUIRED');
  assert.equal(f.app.store.read().workspaceSupplierServices?.services.length || 0, 0);
});

async function publicationFixture(t) {
  const remote = await fakeShopify(t), f = await supplierOwnerFixture(t, { capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'supplier-fixture.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'SYNTHETIC-LOCAL-ONLY', WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED: '1' }, shopifyFetch: remote.fetchImpl });
  const data = await f.retail();
  await f.app.supplierPublication.ensureConnector();
  const enabled = await f.api(`/api/connectors/${f.app.supplierPublication.connectorId}`, { method: 'PATCH', session: f.session, body: { enabled: true } }); assert.equal(enabled.status, 200);
  const review = action => ({ requestId: `review-${action}`, expectedRevision: data.preview.service.revision, expectedPreviewHash: data.preview.preview.previewHash, action, confirmed: true, ...(action === 'publish' ? { publicationId: 'gid://shopify/Publication/7' } : {}) });
  const approve = async operation => { const response = await f.api(`/api/conversations/${f.cid}/supplier-services/${data.sid}/shopify-decision`, { session: f.session, body: { ...f.command(operation), decision: 'approved' } }); assert.equal(response.status, 200, JSON.stringify(response)); };
  return { ...f, original: f, data, remote, review, approve };
}

test('MCP publication consumes original manual approvals and monitor start uses actual shopify-observation, never write receipts', async t => {
  const f = await publicationFixture(t), sid = f.data.sid;
  const draft = await f.reviewed('publication_review', sid, f.review('draft'));
  assert.equal(draft.operation.status, 'pending_approval');
  const cmd = f.command(draft.operation); f.grant('publication_execute', sid, cmd);
  assert.equal((await f.tool('publication_execute', sid, cmd)).error.code, 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE'); assert.equal(f.remote.count('SupplierCreateDraft'), 0);
  await f.approve(draft.operation);
  const created = await f.reviewed('publication_execute', sid, cmd); assert.equal(created.operation.status, 'succeeded');
  assert.equal((await f.reviewed('publication_execute', sid, cmd)).duplicate, true); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  const publish = await f.reviewed('publication_review', sid, f.review('publish')); await f.approve(publish.operation);
  const published = await f.reviewed('publication_execute', sid, f.command(publish.operation));
  assert.equal(published.operation.receipt.published, true); assert.equal(published.operation.receipt.publishedAt, null);
  const monitorInput = { requestId: 'monitor-from-publication', expectedRevision: 2, startFromPublication: true, confirmed: true };
  f.grant('monitor_create', sid, monitorInput);
  assert.equal((await f.tool('monitor_create', sid, monitorInput)).error.code, 'SUPPLIER_PUBLICATION_TIME_REQUIRED');
  const observation = await f.reviewed('shopify_observation', sid, { requestId: 'read-real-publication-time', expectedRevision: 2, shopifyProductId: published.operation.receipt.productId, confirmed: true });
  assert.equal(observation.observation.evidenceKind, 'shopify_admin_read'); assert.equal(observation.observation.writeReceipt, null);
  const creation = await f.reviewed('monitor_create', sid, { ...monitorInput, expectedRevision: 3 });
  assert.equal(creation.monitor.scope.startAt, '2026-10-12T12:00:00.000Z'); assert.equal(creation.monitor.scheduleEnabled, false);
  const check = { requestId: 'manual-monitor-check', monitorId: creation.monitor.id, expectedMonitorHash: creation.monitor.scopeHash, confirmed: true };
  const sample = await f.reviewed('monitor_check', sid, check); assert.equal(sample.sample.sales.retainedUnits, 0); assert.equal(sample.sample.traffic, null); assert.equal(sample.sample.trafficStatus, 'unsupported');
  assert.equal(f.original.app.store.read().capabilities.schedules.filter(item => item.enabled).length, 0);
  await f.original.restart(); assert.equal((await f.reviewed('monitor_check', sid, check)).duplicate, true);
  assert.equal((await f.reviewed('publication', sid)).publication.latest.status, 'succeeded');
  const stopped = await f.reviewed('monitor_stop', sid, { ...check, requestId: 'manual-monitor-stop' }); assert.equal(stopped.monitor.status, 'stopped');
  assert.equal((await f.reviewed('monitors', sid)).monitors[0].id, creation.monitor.id);
});

test('MCP lost Shopify create response is uncertain, then read-only partial reconciliation; no automatic retry on reload', async t => {
  const f = await publicationFixture(t), sid = f.data.sid;
  const reviewed = await f.reviewed('publication_review', sid, f.review('draft')); await f.approve(reviewed.operation);
  f.remote.state.drops.add('SupplierCreateDraft');
  const input = f.command(reviewed.operation), uncertain = await f.reviewed('publication_execute', sid, input);
  assert.equal(uncertain.operation.status, 'uncertain'); assert.equal(f.remote.count('SupplierCreateDraft'), 1);
  await f.original.restart();
  assert.equal((await f.reviewed('publication_execute', sid, input)).duplicate, true);
  const reconciled = await f.reviewed('publication_reconcile', sid, f.command(reviewed.operation));
  assert.equal(reconciled.operation.status, 'partial'); assert.equal(reconciled.operation.receipt.complete, false);
  assert.equal(reconciled.operation.canExecute, false); assert.equal(reconciled.operation.automaticRetry, false);
  assert.equal(f.remote.count('SupplierCreateDraft'), 1); assert.equal(f.remote.count('SupplierSetRetailVariant'), 0);
  assert.equal(f.original.app.store.read().workspaceSupplierServices.services[0].external.published, false);
});
