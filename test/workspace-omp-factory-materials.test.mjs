// Actual enterprise Session -> original Run -> private fd -> OMP SDK -> original
// Library policy/Store. Every model answer is an explicit finite keyless fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../plugins/workspace-procurement/src/workspace.mjs';
import { ORDINARY_FACTORY_TOOLS } from '../plugins/workspace-procurement/src/extension.js';
import { FACTORY_MATERIAL_TOOLS } from '../plugins/workspace-factory-materials/src/extension.js';
import { TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { randomUUID } from 'node:crypto';
const paths = workspaceOmpPaths();
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
function originalClient(f) {
  return createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
    const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method,
      rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } });
}
async function fixture(t, { policy, responses } = {}) {
  let f;
  f = await materialsFixture(t, { ...(policy === null ? { policy: null } : {}), businessAgentOptions: data => ({ recipient: RECIPIENT,
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, factoryMaterials: true,
      configuration: { providerId: MODEL.provider, model: MODEL.id, baseUrl: MODEL.baseUrl },
      syntheticResponses: responses ? responses(data) : [
        { tool: 'workspace_factory_materials', arguments: { productId: data.product.id }, expectedToolNames: [...ORDINARY_FACTORY_TOOLS, ...FACTORY_MATERIAL_TOOLS, 'workspace_skill'] },
        { tool: 'workspace_factory_document', arguments: { documentId: data.document.id, documentVersion: 1 }, expectedContextText: data.product.name },
        { text: 'Only the original synthetic factory material was read. MOQ, capacity and certificate authentication remain pending.', expectedContextText: 'original uploaded specification' },
      ] }), resolveBinding: async () => ({ client: originalClient(f), model: MODEL }) }) });
  return f;
}
async function conversation(f) {
  const r = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Synthetic factory materials read', requestId: randomUUID(), inputContext: empty() } });
  assert.equal(r.status, 201, r.text); return r.json.conversation.id;
}
async function send(f, cid, content = 'Read only the explicitly reviewed factory material. Missing facts remain pending.') {
  const r = await f.workspace(`/api/conversations/${cid}/messages`, { subject: 'member-a', body: { content, requestId: randomUUID(), workspaceExecution: false, inputContext: empty() } });
  assert.equal(r.status, 202, r.text);
  for (let i = 0; i < 300; i++) {
    const run = f.app.store.read().runs.find(row => row.id === r.json.run.id);
    if (run && !['queued', 'running'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Original factory materials Run did not settle.');
}
test('actual OMP worker reads approved original Library product/file with source versions and no public tools or business task', { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await conversation(f), run = await send(f, cid);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const state = f.app.store.read(), mapping = state.conversations.find(row => row.id === cid).businessAgentSession;
  assert.equal(mapping.engineScope, 'omp:18.10.4:factory-materials-v1');
  const text = await fs.readFile(mapping.sessionFile, 'utf8');
  const entries = text.trim().split('\n').map(line => JSON.parse(line));
  const receipts = entries.filter(e => e.message?.role === 'toolResult').map(e => e.message);
  assert.ok(receipts.some(r => r.toolName === 'workspace_factory_materials' && !r.isError));
  const document = receipts.find(r => r.toolName === 'workspace_factory_document'); assert.ok(document && !document.isError, text);
  const value = JSON.parse(document.content[0].text); assert.deepEqual(value.document.asset, f.asset); assert.equal(value.document.independentVerification, false);
  assert.ok(!text.includes('UNAPPROVED_PRIVATE_PRICE_NOTE')); assert.ok(!text.includes(TOKEN_A));
  assert.equal(state.runs.length, 1); assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  assert.equal(state.messages.find(row => row.id === run.assistantId).runtime.modelCalls, 3);
  const nativePublicTools = ['workspace_public_document', 'workspace_public_search', 'workspace_public_browser', 'workspace_factory_public_review', 'workspace_factory_task'];
  assert.ok(run.events.every(e => !nativePublicTools.includes(e.toolName)));
  assert.deepEqual((await fs.readdir(f.directory + '/omp-agent-context')).length, 1);
});
test('actual OMP reopened whole journal revalidates original product revision before any further model request', { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await conversation(f), first = await send(f, cid); assert.equal(first.status, 'succeeded', JSON.stringify(first));
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'UNREVIEWED_UPDATED_FACTORY_PRODUCT' } }, f.actor);
  const second = await send(f, cid, 'Use the previous material again.');
  assert.equal(second.status, 'failed', JSON.stringify(second));
  assert.equal(second.events.filter(e => e.type === 'pi.agent-session.request').length, 0);
  const mapping = f.app.store.read().conversations.find(row => row.id === cid).businessAgentSession;
  assert.ok(!(await fs.readFile(mapping.sessionFile, 'utf8')).includes('UNREVIEWED_UPDATED_FACTORY_PRODUCT'));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});
test('factory profile with no original reviewed disclosure returns unconfigured without private record reads', { timeout: 60000 }, async t => {
  const f = await fixture(t, { policy: null, responses: () => [
    { tool: 'workspace_factory_materials', arguments: {} }, { text: 'The original Library model disclosure is not configured; no material was read.', expectedContextText: 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED' },
  ] });
  let reads = 0; f.app.businessLibrary.getProduct = () => { reads++; throw Error('No private record read admitted'); };
  const cid = await conversation(f), run = await send(f, cid); assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(reads, 0);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});

test('actual OMP factory tool failure remains a safe receipt and later original reads recover in the same journal', { timeout: 60000 }, async t => {
  const f = await fixture(t, { responses: data => [
    { tool: 'workspace_factory_document', arguments: { documentId: data.document.id, documentVersion: 99 } },
    { tool: 'workspace_factory_materials', arguments: { productId: data.product.id }, expectedContextText: 'FACTORY_MATERIAL_SESSION_REFUSED_HTTP_404' },
    { text: 'The document version is not approved. The original product is available; missing supply facts still need confirmation.', expectedContextText: data.product.name },
  ] });
  const cid = await conversation(f), run = await send(f, cid); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  const mapping = f.app.store.read().conversations.find(r => r.id === cid).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const denied = entries.find(r => r.message?.toolName === 'workspace_factory_document').message;
  assert.equal(denied.isError, true); assert.equal(JSON.parse(denied.content[0].text).status, 'blocked');
});
test('original enterprise terminal pins the factory scope and refuses a public-scope assumption without creating a Run', async t => {
  const { createWorkspaceOmpTerminalClient } = await import('../server/workspace-omp-terminal-client.mjs');
  const f = await fixture(t);
  const requestImpl = async ({ method, path, body }) => {
    assert.equal(method, body === undefined ? 'GET' : 'POST');
    const value = await f.workspace(path, { subject: 'member-a', ...(body === undefined ? {} : { body }) });
    return { status: value.status, body: value.json };
  };
  const options = { baseURL: 'https://workspace.example', requestImpl };
  await assert.rejects(createWorkspaceOmpTerminalClient(options).verifySession(), /fixed OMP|frontend/);
  const controlled = createWorkspaceOmpTerminalClient({ ...options, expectedEngineScope: 'omp:18.10.4:factory-materials-v1' });
  assert.equal((await controlled.verifySession()).authenticated, true);
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.app.store.read().conversations.length, 0);
});
