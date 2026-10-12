import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createSupplierMcpClient, SUPPLIER_TOOLS } from '../supplier-mcp-client.mjs';
import { createRequestJournal } from '../request-journal.mjs';
import { registerWorkspaceMuse } from '../extensions/workspace-muse.mjs';
import { createNativeOwnerTransport } from '../owner-session-transport.mjs';
import { supplierFixture, actor, origin, png, facts, publicFields } from './fixtures/supplier-owner.mjs';

function commandUI(request, directory) {
  const commands = new Map(), events = new Map(), messages = [], inputs = [], confirmations = [];
  let confirmed = true;
  registerWorkspaceMuse({ registerCommand: (name, definition) => commands.set(name, definition), on: (name, fn) => events.set(name, fn) }, {
    transport: async () => request, supplierJournal: createRequestJournal(path.join(directory, 'supplier-journal')), journal: createRequestJournal(path.join(directory, 'muse-journal')),
  });
  const ctx = { mode: 'tui', hasUI: true, ui: { input: async () => inputs.shift(), notify: (message, level) => messages.push({ message, level }), setStatus() {}, confirm: async (...args) => { confirmations.push(args); return confirmed; } } };
  return { commands, events, messages, inputs, confirmations, ctx, decline() { confirmed = false; }, allow() { confirmed = true; },
    run: args => commands.get('workspace-supplier').handler(args, ctx), value: () => JSON.parse(messages.at(-1).message), error: () => messages.at(-1).message,
    async call(operation, args) { inputs.push(JSON.stringify(args)); await this.run(`call ${operation}`); assert.notEqual(messages.at(-1).level, 'error', this.error()); return this.value().result; },
  };
}

test('same Pi extension registers all 15 original supplier tools and completes initialize/list/upload/intake/get/preview over signed native HTTP', async t => {
  const f = await supplierFixture(); t.after(() => f.close());
  const ui = commandUI(f.transport(), f.directory);
  assert.ok(ui.commands.has('workspace-muse')); assert.ok(ui.commands.has('workspace-supplier'));
  await ui.run('connect'); assert.equal(ui.value().toolCount, 15); assert.equal(ui.value().modelToolsRegistered, false);
  assert.deepEqual(f.trace.slice(0, 3).map(item => item.method), ['initialize', 'notifications/initialized', 'tools/list']);
  await ui.run('tools'); assert.deepEqual(ui.value().map(tool => tool.name), SUPPLIER_TOOLS.map(tool => 'workspace_supplier_owner_' + tool));
  for (const operation of SUPPLIER_TOOLS) { await ui.run(`schema ${operation}`); assert.equal(ui.value().type, 'object'); }
  const schemaProbe = createSupplierMcpClient(f.transport());
  for (const operation of SUPPLIER_TOOLS) await assert.rejects(schemaProbe.call(operation, {}), { code: 'SUPPLIER_MCP_ARGUMENTS_INVALID' });
  assert.deepEqual([...new Set(f.trace.filter(item => item.method === 'tools/call').map(item => item.tool))], SUPPLIER_TOOLS.map(tool => 'workspace_supplier_owner_' + tool));
  assert.equal(f.snapshot().services.length, 0); assert.equal(f.snapshot().artifacts.length, 0);
  const image = (await ui.call('image_upload', { input: { filename: 'tui.png', base64: png, sourceNote: 'Synthetic original image' } })).artifact;
  const savedFacts = { ...facts, images: [{ kind: 'artifact', asset: { artifactId: image.id, version: image.currentVersion, sha256: image.sha256 }, sourceNote: 'Synthetic original image' }] };
  const saved = await ui.call('intake', { input: { facts: savedFacts } });
  const get = await ui.call('get', { serviceId: saved.serviceId });
  assert.equal(get.profile.supplierMoq, 500); assert.equal(get.profile.wholesaleUnitPrice, '2.50');
  const preview = await ui.call('preview', { serviceId: saved.serviceId, input: { expectedRevision: 1, confirmed: true, publicFields } });
  assert.equal(preview.preview.saleUnit.unitsPerPack, 2);
  assert.equal(JSON.stringify(preview.preview).includes('wholesaleUnitPrice'), false);
  assert.equal(f.snapshot().artifacts.length, 1); assert.equal(f.snapshot().services.length, 1);
  assert.equal(f.snapshot().modelRuns, 0); assert.equal(f.snapshot().orders.length, 0);
  const originalGet = await f.http(`/api/conversations/${encodeURIComponent(actor.nativeAgentId)}/supplier-services/${saved.serviceId}`);
  assert.equal(originalGet.body.service.id, saved.serviceId); assert.match(preview.preview.previewHash, /^[a-f0-9]{64}$/);
  assert.equal(originalGet.body.service.preview.previewHash, preview.preview.previewHash);
  await f.restart();
  const fresh = commandUI(f.transport(), f.directory);
  const reloaded = await fresh.call('get', { serviceId: saved.serviceId });
  assert.equal(reloaded.revision, 2); assert.equal(reloaded.profile.images[0].asset.artifactId, image.id);
  assert.equal(reloaded.preview.previewHash, preview.preview.previewHash);
});

test('supplier command confirms writes, journals exact UUID/body before dispatch, and reads same task after lost response without automatic retry', async t => {
  const f = await supplierFixture(); t.after(() => f.close());
  const transport = f.transport(); let lose = true, mutationCount = 0;
  const request = async input => {
    const response = await transport(input);
    if (input.body?.method === 'tools/call' && input.body.params.name.endsWith('_intake')) {
      mutationCount++; if (lose) { lose = false; throw new Error('Synthetic lost response'); }
    }
    return response;
  };
  const ui = commandUI(request, f.directory);
  ui.decline(); ui.inputs.push(JSON.stringify({ input: { facts } })); await ui.run('call intake');
  assert.equal(ui.error(), 'Action cancelled.'); assert.equal(mutationCount, 0);
  ui.allow(); ui.inputs.push(JSON.stringify({ input: { facts } })); await ui.run('call intake');
  assert.equal(ui.error(), 'SUPPLIER_RESULT_UNKNOWN_READ_FIRST'); assert.equal(mutationCount, 1);
  const journalFile = (await readdir(path.join(f.directory, 'supplier-journal')))[0];
  const pending = JSON.parse(await readFile(path.join(f.directory, 'supplier-journal', journalFile), 'utf8'));
  assert.match(pending.args.input.requestId, /^[a-f0-9-]{36}$/); assert.equal(JSON.stringify(pending).includes(f.token), false);
  await ui.run('retry'); assert.equal(ui.value().result.duplicate, true); assert.equal(mutationCount, 2); assert.equal(f.snapshot().services.length, 1);
  await assert.rejects(ui.commands.get('workspace-supplier').handler('call intake', { ...ui.ctx, mode: 'rpc' }), { code: 'INTERACTIVE_TUI_REQUIRED' });
  assert.deepEqual(await ui.events.get('input')({}, ui.ctx), { action: 'handled' });
  assert.match(ui.error(), /model tools are disabled/);
  await writeFile(path.join(f.directory, 'supplier-journal', journalFile), JSON.stringify({ ...pending, operation: 'publication_execute' }));
  await ui.run('retry'); assert.equal(ui.error(), 'SUPPLIER_READ_OR_RECONCILE_REQUIRED');
});

test('original permission/privacy/ownership/approval and unknown-image guards remain enforced through supplier MCP', async t => {
  const f = await supplierFixture(); t.after(() => f.close());
  const api = createSupplierMcpClient(f.transport());
  const saved = await api.call('intake', { input: { requestId: 'unknown-image-facts', facts: { ...facts, images: [{ kind: 'public_url', url: 'https://images.example.com/unverified.png', sourceNote: 'Unverified fixture URL' }] } } });
  const preview = await api.call('preview', { serviceId: saved.serviceId, input: { requestId: 'unknown-image-preview', expectedRevision: 1, confirmed: true, publicFields } });
  assert.equal(JSON.stringify(preview).includes('"availability":"unknown"'), true);
  await assert.rejects(api.call('profile', { serviceId: saved.serviceId, input: { requestId: 'stale-profile', expectedRevision: 1, facts: { name: 'Stale' } } }), { code: 'SUPPLIER_REVISION_CONFLICT' });
  await assert.rejects(api.call('publication_execute', { serviceId: saved.serviceId, input: { requestId: 'no-approval', operationId: 'not-approved', expectedScopeHash: 'a'.repeat(64), confirmed: true } }));
  const target = `/api/conversations/${encodeURIComponent(actor.nativeAgentId)}/supplier-session-mcp`;
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const other = await f.login('synthetic-other'), viewer = await f.login('synthetic-viewer');
  for (const options of [
    { unsigned: true, cookie: null, headers: { Authorization: `Bearer ${f.workerToken}` } },
    { workspaceId: 'wrong-tenant' }, { csrf: 'wrong-csrf' },
    { subject: 'synthetic-other', cookie: other.cookie, csrf: other.csrfToken },
    { subject: 'synthetic-viewer', cookie: viewer.cookie, csrf: viewer.csrfToken },
  ]) {
    const result = await f.http(target, { method: 'POST', body, ...options });
    assert.ok(result.status >= 400, JSON.stringify(result.body));
  }
  assert.equal((await f.http(target.replace('/supplier-session-mcp', '/supplier-mcp'), { method: 'POST', body })).body.error.code, 'SUPPLIER_OWNER_BINDING_REQUIRED');
  await assert.rejects(f.transport()({ method: 'POST', path: target.replace('original%3Asupplier%2Ftui', 'other'), body }), { code: 'OWNER_ROUTE_FORBIDDEN' });
  await assert.rejects(f.transport()({ method: 'POST', path: target.replace('/supplier-session-mcp', '/supplier-mcp'), body }), { code: 'OWNER_ROUTE_FORBIDDEN' });
  const worker = createNativeOwnerTransport({ origin, token: f.workerToken.padEnd(43, 'x'), scope: { workspaceId: f.access.workspaceId, subject: actor.subject, conversationId: actor.nativeAgentId } }, { fetchImpl: f.fetchImpl });
  await assert.rejects(worker({ method: 'POST', path: target, body }), { code: 'OWNER_SESSION_EXPIRED' });
  const privateImage = (await f.app.artifacts.create({ requestId: 'synthetic-private-owner-image', filename: 'private.png', base64: png,
    metadata: { museNativeAgentId: actor.nativeAgentId, museOwnerSubject: actor.subject } })).artifact;
  const ordinary = await f.http('/api/conversations', { method: 'POST', body: { title: 'Synthetic other owner', requestId: 'other-conversation' },
    subject: 'synthetic-other', cookie: other.cookie, csrf: other.csrfToken });
  assert.equal(ordinary.status, 201);
  const privateAttempt = await f.http(`/api/conversations/${ordinary.body.conversation.id}/supplier-session-mcp`, { method: 'POST',
    subject: 'synthetic-other', cookie: other.cookie, csrf: other.csrfToken,
    body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workspace_supplier_owner_intake', arguments: { input: { requestId: 'forbidden-private-image',
      facts: { name: 'Forbidden reference', images: [{ kind: 'artifact', asset: { artifactId: privateImage.id, version: 1, sha256: privateImage.sha256 }, sourceNote: 'Not the original owner image' }] } } } } } });
  assert.equal(privateAttempt.status, 403); assert.equal(privateAttempt.body.error.code, 'MUSE_OWNER_REQUIRED');
  assert.equal(f.snapshot().modelRuns, 0);
  await f.restart();
  await assert.rejects(api.call('get', { serviceId: saved.serviceId }), { code: 'OWNER_SESSION_EXPIRED' });
});
