import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createPluginLibraryModule } from '../../server/plugin-library/http.mjs';
import { fixture, call, requestBody, signer, workspaceId, TestApiError, code } from './fixtures.mjs';
const rootPath = '/api/plugin-library';
test('HTTP module is opt-in and does not read unselected configuration', async () => {
  const environment = new Proxy({}, { get(target, key) { if (key === 'WORKSPACE_PLUGIN_LIBRARY_ENABLED') return undefined; assert.fail('unselected secret read'); } });
  assert.equal(await createPluginLibraryModule({ environment }), null);
});
test('HTTP module refuses an enterprise configuration without original authority', async t => {
  const f = await fixture(t); await assert.rejects(f.module([], { access: null }), code('PLUGIN_LIBRARY_AUTHORITY_REQUIRED')); assert.deepEqual(await fs.readdir(f.directory), []);
});
test('HTTP exposes real inventory and explicit unsupported execution flags', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); const result = await call(mod, a);
  assert.equal(result.status, 200); assert.equal(result.body.inventory.packages[0].id, f.pluginId); assert.equal(result.body.capabilities.appliesChanges, false); assert.equal(result.body.capabilities.isolatedExecution, false); assert.equal(result.body.capabilities.enterpriseDataGrants, false);
});
test('HTTP refuses foreign workspace, viewer and forged role on a current session', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin();
  await assert.rejects(call(mod, { ...a, workspaceId: 'other' }), code('PLUGIN_LIBRARY_ROLE_REQUIRED'));
  await assert.rejects(call(mod, f.admin('viewer', 'viewer')), code('PLUGIN_LIBRARY_ROLE_REQUIRED'));
  const operator = f.admin('operator', 'operator'); const forged = { ...operator, role: 'admin', session: { ...operator.session, role: 'admin' } };
  await assert.rejects(call(mod, forged), code('PLUGIN_LIBRARY_SESSION_REVOKED'));
});
test('HTTP rechecks current authority after logout even with an unexpired context', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); await call(mod, a); f.revoke(a);
  await assert.rejects(call(mod, a), code('PLUGIN_LIBRARY_SESSION_REVOKED'));
});
test('HTTP rechecks current authority after the final asynchronous access audit', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); let delivered = false;
  await assert.rejects(call(mod, a, rootPath, undefined, { res: { accessFinish: async () => f.revoke(a) }, respond: async (res, status, value, beforeWrite) => { await res.accessFinish(status); beforeWrite(); delivered = true; } }), code('PLUGIN_LIBRARY_SESSION_REVOKED'));
  assert.equal(delivered, false);
});
test('HTTP refuses an expired signed assertion and operator mutations', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); const body = await requestBody(f, mod, a);
  await assert.rejects(call(mod, f.admin('operator', 'operator'), rootPath + '/requests', body), code('PLUGIN_LIBRARY_SIGNED_ADMIN_REQUIRED'));
  a.claims.exp = f.clock() / 1000; await assert.rejects(call(mod, a), code('PLUGIN_LIBRARY_SESSION_REVOKED'));
});
test('HTTP records a bounded request without applying tool or backend changes', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); const body = await requestBody(f, mod, a); const before = await fs.readFile(path.join(f.root, 'config.json'));
  const result = await call(mod, a, rootPath + '/requests', body); assert.equal(result.body.executed, false); assert.equal(result.body.intent.status, 'awaiting-verified-executor'); assert.equal(Date.parse(result.body.intent.expiresAt) - f.clock(), 86400000); assert.deepEqual(await fs.readFile(path.join(f.root, 'config.json')), before);
});
test('HTTP exact retry returns original receipt after inventory bytes change', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); const body = await requestBody(f, mod, a); const first = await call(mod, a, rootPath + '/requests', body);
  await f.write(f.pluginId + '/README.md', 'changed after the original request was committed');
  const second = await call(mod, a, rootPath + '/requests', body); assert.deepEqual(second.body, first.body);
  await assert.rejects(call(mod, a, rootPath + '/requests', { ...body, action: 'enable-tools' }), code('PLUGIN_CONTROL_REQUEST_CONFLICT'));
});
test('HTTP refuses stale new requests and does not mutate source after a conflict', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); const body = await requestBody(f, mod, a); await f.write(f.pluginId + '/README.md', 'new source');
  await assert.rejects(call(mod, a, rootPath + '/requests', body), code('PLUGIN_INVENTORY_CHANGED'));
  assert.equal((await call(mod, a)).body.revision, 0);
});
test('HTTP cancels a pending own request and retains both original and current receipts', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(); const body = await requestBody(f, mod, a); const first = (await call(mod, a, rootPath + '/requests', body)).body;
  const cancel = { requestId: randomUUID(), expectedRevision: first.revision, intentId: first.intent.id };
  const result = (await call(mod, a, rootPath + `/requests/${body.requestId}/cancel`, cancel)).body; assert.equal(result.intent.status, 'cancelled'); assert.equal(result.executed, false);
  const receipt = (await call(mod, a, rootPath + `/requests/${body.requestId}`)).body;
  assert.equal(receipt.intent.status, 'awaiting-verified-executor'); assert.equal(receipt.currentIntent.status, 'cancelled'); assert.equal(receipt.currentRevision, 2);
  assert.deepEqual((await call(mod, a, rootPath + `/requests/${body.requestId}/cancel`, cancel)).body, result);
});
test('HTTP does not reveal or cancel another administrators request', async t => {
  const f = await fixture(t), mod = await f.module(), a = f.admin(), b = f.admin('admin-b'); const body = await requestBody(f, mod, a); const first = (await call(mod, a, rootPath + '/requests', body)).body;
  await assert.rejects(call(mod, b, rootPath + `/requests/${body.requestId}`), code('PLUGIN_REQUEST_NOT_FOUND'));
  await assert.rejects(call(mod, b, rootPath + `/requests/${body.requestId}/cancel`, { requestId: randomUUID(), expectedRevision: 1, intentId: first.intent.id }), code('PLUGIN_REQUEST_NOT_FOUND'));
});
test('HTTP release import, independent review, publication and suspension use real signatures', async t => {
  const f = await fixture(t), s = signer(), mod = await f.module([s.record]), a = f.admin(), b = f.admin('admin-b');
  const imported = (await call(mod, a, rootPath + '/releases/import', { requestId: randomUUID(), expectedRevision: 0, envelope: s.envelope(s.manifest) })).body;
  const row = imported.release, input = { expectedRevision: 1, fingerprint: row.fingerprint };
  await assert.rejects(call(mod, a, rootPath + `/releases/${row.id}/review`, { ...input, requestId: randomUUID(), decision: 'approve', note: 'self' }), code('PLUGIN_RELEASE_INDEPENDENT_REVIEW_REQUIRED'));
  await assert.rejects(call(mod, a, rootPath + `/releases/${row.id}/publish`, { ...input, requestId: randomUUID() }), code('PLUGIN_RELEASE_APPROVAL_REQUIRED'));
  await call(mod, b, rootPath + `/releases/${row.id}/review`, { ...input, requestId: randomUUID(), decision: 'approve', note: 'Reviewed fixture descriptor, not image execution.' });
  await call(mod, a, rootPath + `/releases/${row.id}/publish`, { ...input, expectedRevision: 2, requestId: randomUUID() });
  const published = (await call(mod, a, rootPath + `/releases/${row.id}/manifest`)).body; assert.equal(published.fingerprint, row.fingerprint); assert.equal(published.descriptorOnly, true); assert.equal(published.codeInstalled, false);
  await call(mod, b, rootPath + `/releases/${row.id}/suspend`, { ...input, expectedRevision: 3, requestId: randomUUID(), note: 'Withdraw fixture.' });
  await assert.rejects(call(mod, a, rootPath + `/releases/${row.id}/manifest`), code('PLUGIN_RELEASE_NOT_PUBLISHED'));
});
test('HTTP can suspend a descriptor after its publisher trust is revoked on restart', async t => {
  const f = await fixture(t), s = signer(), mod = await f.module([s.record]), a = f.admin();
  const row = (await call(mod, a, rootPath + '/releases/import', { requestId: randomUUID(), expectedRevision: 0, envelope: s.envelope(s.manifest) })).body.release;
  await mod.close(); const restarted = await f.module([]);
  assert.equal((await call(restarted, a)).body.releases[0].status, 'trust-unavailable');
  await call(restarted, a, rootPath + `/releases/${row.id}/suspend`, { requestId: randomUUID(), expectedRevision: 1, fingerprint: row.fingerprint, note: 'Withdraw after key revocation.' });
  const disk = JSON.parse(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8')); assert.equal(disk.releases[0].status, 'suspended');
});
test('HTTP immutable release versions reject replacement with a new signed body', async t => {
  const f = await fixture(t), s = signer(), mod = await f.module([s.record]), a = f.admin();
  await call(mod, a, rootPath + '/releases/import', { requestId: randomUUID(), expectedRevision: 0, envelope: s.envelope(s.manifest) });
  await assert.rejects(call(mod, a, rootPath + '/releases/import', { requestId: randomUUID(), expectedRevision: 1, envelope: s.envelope({ ...s.manifest, description: 'changed immutable version' }) }), code('PLUGIN_RELEASE_VERSION_IMMUTABLE'));
});
test('HTTP new module completes a real loopback JSON request with synthetic identity', async t => {
  const f = await fixture(t), mod = await f.module(), actor = f.admin();
  const server = http.createServer(async (req, res) => {
    try { const matched = await mod.handle({ req, res, pathname: req.url, context: actor, respond: async (out, status, body, beforeWrite) => { beforeWrite?.(); out.writeHead(status, { 'content-type': 'application/json' }); out.end(JSON.stringify(body)); } }); if (!matched) { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: error.code })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${rootPath}`); assert.equal(response.status, 200); assert.equal((await response.json()).workspaceId, workspaceId);
  f.revoke(actor); assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${rootPath}`)).status, 403);
});
