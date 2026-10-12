import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createApp } from '../server/index.mjs';
import { SUPPLIER_OWNER_MCP_TOOLS } from '../server/supplier-mcp.mjs';
import { supplierOwnerFixture, png, retailFacts, publicFields } from './fixtures/supplier-owner-mcp.mjs';
import { fakeShopify } from './fixtures/supplier-shopify-http.mjs';

const sessionCall = async (f, operation, sid, input, extra = {}) => {
  const response = await f.tool(operation, sid, input, { sessionMcp: true, ...extra });
  assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.error, undefined, JSON.stringify(response));
  return response.value;
};
async function product(f) {
  const imageInput = { requestId: 'session-image', filename: 'session.png', base64: png, sourceNote: 'Synthetic original owner image' };
  const image = (await sessionCall(f, 'image_upload', null, imageInput)).artifact;
  const input = { requestId: 'session-facts', facts: { ...retailFacts, images: [{ kind: 'artifact', asset: { artifactId: image.id, version: image.currentVersion, sha256: image.sha256 }, sourceNote: 'Synthetic original owner image' }] } };
  const created = await sessionCall(f, 'intake', null, input);
  const preview = await sessionCall(f, 'preview', created.serviceId, { requestId: 'session-preview', expectedRevision: 1, confirmed: true, publicFields });
  return { image, imageInput, input, sid: created.serviceId, preview };
}

test('original signed owner session initializes/lists/calls without any resolver and persists the same HTTP service', async t => {
  const f = await supplierOwnerFixture(t, { supplierOwnerMcpBinding: null });
  const initialize = await f.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'original-owner-http-fixture', version: '1' } }, { sessionMcp: true });
  assert.equal(initialize.status, 200); assert.equal(initialize.body.result.serverInfo.name, 'workspace-supplier-owner-session');
  assert.equal((await f.rpc('notifications/initialized', {}, { sessionMcp: true })).status, 202);
  assert.deepEqual((await f.rpc('tools/list', {}, { sessionMcp: true })).body.result.tools, SUPPLIER_OWNER_MCP_TOOLS);
  const modern = '2026-07-28', meta = { 'io.modelcontextprotocol/protocolVersion': modern, 'io.modelcontextprotocol/clientCapabilities': {} };
  const discovered = await f.rpc('server/discover', { _meta: meta }, { sessionMcp: true, headers: { 'MCP-Protocol-Version': modern, 'MCP-Method': 'server/discover' } });
  assert.equal(discovered.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'workspace-supplier-owner-session');
  const token = f.session.cookie.slice(f.session.cookie.indexOf('=') + 1);
  assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, session: undefined,
    headers: { 'X-Workspace-Session': token, 'X-CSRF-Token': f.session.csrfToken } })).status, 200);
  const data = await product(f), saved = await sessionCall(f, 'save_product', data.sid, { requestId: 'session-save', expectedRevision: 2, confirmed: true });
  assert.equal(saved.product.skus[0].moq, 500); assert.equal(data.preview.preview.saleUnit.unitsPerPack, 2);
  const path = `/api/conversations/${f.cid}/supplier-services/${data.sid}`;
  const httpRead = await f.api(path, { method: 'GET', session: f.session });
  assert.equal(httpRead.body.service.id, data.sid); assert.equal(httpRead.body.service.productReference.productId, saved.product.id);
  const update = await f.api(`${path}/profile`, { session: f.session, body: { requestId: 'original-http-profile', expectedRevision: 2, facts: { name: 'Original HTTP and MCP share this service' } } });
  assert.equal(update.status, 200);
  assert.equal((await sessionCall(f, 'get', data.sid)).profile.name, update.body.service.profile.name);
  await f.restart();
  assert.equal((await sessionCall(f, 'get', data.sid)).revision, 3);
  assert.equal((await sessionCall(f, 'intake', null, data.input)).serviceId, data.sid);
  assert.equal((await sessionCall(f, 'image_upload', null, data.imageInput)).artifact.id, data.image.id);
  assert.equal(f.app.store.read().workspaceSupplierServices.services.length, 1);
  assert.equal(f.app.store.read().businessLibrary.products.length, 1); assert.equal(f.app.store.read().artifacts.length, 1);
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.seen.length, 0);
  assert.equal((await f.rpc('tools/list')).body.error.code, 'SUPPLIER_OWNER_BINDING_REQUIRED');
  const catalog = f.app.supplierService.catalog().services[0];
  assert.equal(catalog.ownerMcp.status, 'binding_required'); assert.equal(catalog.ownerSessionMcp.status, 'original_session_required');
  assert.equal(catalog.ownerSessionMcp.externalConnectorGrant, false);
  assert.ok(f.app.access.listAudit({ limit: 200 }).records.some(row => row.type === 'request.finished' && row.status === 200));
});

test('session MCP rejects wrong workspace, method, path, body, signature, CSRF, worker and foreign conversation at original HTTP boundary', async t => {
  const f = await supplierOwnerFixture(t, { supplierOwnerMcpBinding: null, capabilityEnvironment: { WORKSPACE_SUPPLIER_MCP_ENABLED: 'true' } });
  for (const options of [
    { unsigned: true }, { headers: { 'X-Workspace-Assertion': 'invalid.synthetic.signature' } },
    { assertionOverrides: { workspaceId: 'foreign-workspace' } }, { assertionOverrides: { method: 'PATCH' } },
    { assertionOverrides: { target: `/api/conversations/${f.cid}/supplier-mcp` } }, { signedBody: '{}' },
    { session: undefined, headers: { Authorization: `Bearer ${f.workerToken}` } },
  ]) assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, ...options })).status, 401);
  assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, unsigned: true, browser: false, headers: { Authorization: `Bearer ${f.workerToken}` } })).body.error.code, 'ORIGIN_REQUIRED');
  assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, headers: { 'X-CSRF-Token': '' } })).status, 403);
  const viewer = await f.login('viewer'); assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, session: viewer })).body.error.code, 'ROLE_REQUIRED');
  const other = await f.login('other'); assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, session: other })).status, 404);
  const data = await product(f);
  const created = await f.api('/api/conversations', { session: other, body: { title: 'Separate original owner', requestId: 'other-original-session' } });
  const foreign = await f.tool('get', data.sid, undefined, { sessionMcp: true, session: other, cid: created.body.conversation.id });
  assert.equal(foreign.error.code, 'SUPPLIER_SERVICE_NOT_FOUND');
  const otherFacts = await sessionCall(f, 'intake', null, { requestId: 'own-operator-facts', facts: { name: 'Operator owns this original conversation' } }, { session: other, cid: created.body.conversation.id });
  assert.ok(otherFacts.serviceId);
  const identity = await f.rpc('tools/call', { name: 'workspace_supplier_owner_intake', arguments: { subject: 'other', input: { requestId: 'forged-owner', facts: { name: 'Forbidden' } } } }, { sessionMcp: true });
  assert.equal(JSON.parse(identity.body.result.content[0].text).code, 'SUPPLIER_INPUT_INVALID');
  for (const name of ['workspace_supplier_owner_publication_decision', 'workspace_supplier_owner_monitor_activate', 'workspace_supplier_owner_notification_execute', 'workspace_worker_claim_task']) {
    assert.equal((await f.rpc('tools/call', { name, arguments: {} }, { sessionMcp: true })).status, 404);
  }
  const worker = await f.api('/mcp', { unsigned: true, browser: false, headers: { Authorization: `Bearer ${f.workerToken}` }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.deepEqual(worker.body.result.tools.filter(row => row.name.startsWith('workspace_supplier_')).map(row => row.name), ['workspace_supplier_listing_preview', 'workspace_supplier_monitor_status']);
  assert.equal((await f.rpc('tools/list', {}, { sessionMcp: true, method: 'GET' })).status, 405);
});

test('session MCP performs the original recursive body privacy check before supplier mutation', async t => {
  const f = await supplierOwnerFixture(t, { supplierOwnerMcpBinding: null });
  const privateImage = (await f.app.artifacts.create({ requestId: 'synthetic-muse-private-image', filename: 'private.png', base64: png,
    metadata: { museNativeAgentId: 'original-private-native-session', museOwnerSubject: 'other-original-owner' } })).artifact;
  const result = await f.tool('intake', null, { requestId: 'cannot-borrow-private-file', facts: { name: 'Forbidden reference', images: [{ kind: 'artifact', asset: { artifactId: privateImage.id, version: 1, sha256: privateImage.sha256 }, sourceNote: 'Not authorized for this owner' }] } }, { sessionMcp: true });
  assert.equal(result.status, 403); assert.equal(result.error.code, 'MUSE_OWNER_REQUIRED');
  assert.equal(f.app.store.read().workspaceSupplierServices?.services.length || 0, 0);
});

test('session MCP publication still requires the original manual approval and creates only disabled monitors', async t => {
  const remote = await fakeShopify(t), f = await supplierOwnerFixture(t, { supplierOwnerMcpBinding: null,
    capabilityEnvironment: { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'supplier-fixture.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'SYNTHETIC-LOCAL-ONLY', WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED: '1' }, shopifyFetch: remote.fetchImpl });
  const data = await product(f);
  await f.app.supplierPublication.ensureConnector();
  assert.equal((await f.api(`/api/connectors/${f.app.supplierPublication.connectorId}`, { method: 'PATCH', session: f.session, body: { enabled: true } })).status, 200);
  const review = await sessionCall(f, 'publication_review', data.sid, { requestId: 'session-draft-review', expectedRevision: 2, expectedPreviewHash: data.preview.preview.previewHash, action: 'draft', confirmed: true });
  const execute = f.command(review.operation);
  assert.equal((await f.tool('publication_execute', data.sid, execute, { sessionMcp: true })).error.code, 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE');
  assert.equal(remote.count('SupplierCreateDraft'), 0);
  const decision = await f.api(`/api/conversations/${f.cid}/supplier-services/${data.sid}/shopify-decision`, { session: f.session, body: { ...f.command(review.operation), decision: 'approved' } });
  assert.equal(decision.status, 200);
  assert.equal((await sessionCall(f, 'publication_execute', data.sid, execute)).operation.status, 'succeeded');
  await f.restart();
  assert.equal((await sessionCall(f, 'publication_execute', data.sid, execute)).duplicate, true); assert.equal(remote.count('SupplierCreateDraft'), 1);
  const monitor = await sessionCall(f, 'monitor_create', data.sid, { requestId: 'session-disabled-monitor', expectedRevision: 2, shopifyProductId: 'gid://shopify/Product/123', startAt: '2026-10-12T12:00:00Z', confirmed: true });
  assert.equal(monitor.monitor.scheduleEnabled, false); assert.equal(f.app.store.read().capabilities.schedules.some(row => row.enabled), false);
  assert.equal(f.seen.length, 0);
});

test('session MCP creates no local-mode owner identity and does not fall back from an external denied grant', async t => {
  const f = await supplierOwnerFixture(t);
  f.hook(() => { assert.fail('The original session endpoint must never manufacture or resolve an external grant.'); });
  await sessionCall(f, 'intake', null, { requestId: 'session-is-separate', facts: { name: 'Original HTTP authority only' } });
  f.hook(() => null);
  assert.equal((await f.tool('intake', null, { requestId: 'external-denied', facts: { name: 'Denied external request' } })).error.code, 'SUPPLIER_MCP_SCOPE_REQUIRED');
  const directory = await fs.mkdtemp('/tmp/supplier-session-local-');
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'fixture', configured: false } });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { port } = await app.listen(0);
  const response = await fetch(`http://127.0.0.1:${port}/api/conversations/local/supplier-session-mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'SUPPLIER_OWNER_AUTH_REQUIRED');
  assert.equal(app.supplierService.catalog().services[0].ownerSessionMcp.available, false);
});

test('session MCP keeps the original request expiry live through image admission', { timeout: 10000 }, async t => {
  const f = await supplierOwnerFixture(t, { supplierOwnerMcpBinding: null }), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const create = f.app.artifacts.create;
  f.app.artifacts.create = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
  const pending = f.tool('image_upload', null, { requestId: 'session-expired-before-commit', filename: 'expired.png', base64: png, sourceNote: 'Synthetic original assertion expiry' }, { sessionMcp: true });
  try { await entered.promise; f.advance(31000); } finally { release.resolve(); }
  assert.equal((await pending).error.code, 'SESSION_REQUIRED'); assert.equal(f.app.store.read().artifacts.length, 0);
  await f.restart(); assert.equal(f.app.store.read().artifacts.length, 0);
});
