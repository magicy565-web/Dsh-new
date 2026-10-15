// Real original Session/Run/Library/artifact services and official OMP SDK.
// Explicit finite keyless model responses only, no sender/customer connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
async function fixture(t, { mode = 'reply' } = {}) {
  let f; const lifecycle = [];
  f = await materialsFixture(t, { businessAgentOptions: data => {
    const selection = { inquiryDocumentId: data.document.id, documentVersion: 1, productId: data.product.id };
    const documents = mode === 'two' ? [{ name: 'reply.md', content: 'Thank you for the specification. Please confirm quantity before an offer.' },
      { name: 'questions.md', content: 'Which destination and requested quantity should the factory review?' }] : [{ name: 'reply.md', content: 'Thank you for the specification. Please confirm quantity before an offer.' }];
    const responses = mode === 'skill' ? [{ tool: 'workspace_skill', arguments: { name: 'workspace-factory-inquiries' } },
      { text: 'Loaded the reviewed inquiry Skill using the official resolver.', expectedContextText: 'Decide what to do from the actual inquiry' }] : [
      { tool: 'workspace_factory_document', arguments: { documentId: data.document.id, documentVersion: 1 } },
      { tool: 'workspace_factory_materials', arguments: { productId: data.product.id } },
      ...(mode === 'ask' ? [] : [{ tool: 'workspace_factory_inquiry_save', arguments: { ...selection, documents, requestId: 'same-model-draft' }, sourcesFromPreviousTools: true }]),
      { text: mode === 'ask' ? 'Which quantity and destination should we assess? No draft saved because these details are missing.' : 'The model-written reply is saved as an unreviewed draft. No message was sent.' }];
    responses[0].expectedToolNames = ['workspace_factory_materials_status', 'workspace_factory_materials', 'workspace_factory_document', 'workspace_factory_inquiry_save', 'workspace_skill'];
    return { recipient: RECIPIENT,
      engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths(), factoryInquiries: true, onWorkerLifecycle: event => lifecycle.push(event),
        configuration: { providerId: MODEL.provider, model: MODEL.id, baseUrl: MODEL.baseUrl }, syntheticResponses: responses }),
      resolveBinding: async () => ({ model: MODEL, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
        const r = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
        return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
      } }) }) };
  } }); f.lifecycle = lifecycle; return f;
}
async function create(f) {
  const r = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Synthetic exact inquiry drafts', requestId: randomUUID(), inputContext: empty() } });
  assert.equal(r.status, 201, r.text); return r.json.conversation.id;
}
async function send(f, cid, execute) {
  const r = await f.workspace(`/api/conversations/${cid}/messages`, { subject: 'member-a', body: { content: 'Prepare the selected original inquiry and exact factory product as unsent human-review drafts.', requestId: randomUUID(), workspaceExecution: execute, inputContext: empty() } });
  assert.equal(r.status, 202, r.text);
  for (let i = 0; i < 400; i++) {
    const run = f.app.store.read().runs.find(v => v.id === r.json.run.id);
    if (run && !['queued', 'running'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 50));
  } throw Error('Original inquiry Run did not settle.');
}
for (const mode of ['ask', 'reply', 'two', 'skill']) test(`official inquiry loop accepts finite scripted choice=${mode}; source adapter does not choose tools or file count`, { timeout: 60000 }, async t => {
  const f = await fixture(t, { mode }), cid = await create(f), run = await send(f, cid, true); assert.equal(run.status, 'succeeded', JSON.stringify({ run, lifecycle: f.lifecycle }));
  const state = f.app.store.read(), mapping = state.conversations.find(c => c.id === cid).businessAgentSession;
  const journal = await fs.readFile(mapping.sessionFile, 'utf8'); assert.ok(!journal.includes(TOKEN_A)); assert.ok(!journal.includes('UNAPPROVED_PRIVATE_PRICE_NOTE'));
  const entries = journal.trim().split('\n').map(line => JSON.parse(line)), names = entries.filter(e => e.message?.role === 'toolResult').map(e => e.message.toolName);
  assert.ok(!names.includes('workspace_factory_inquiry_prepare'));
  assert.deepEqual(names, mode === 'skill' ? ['workspace_skill'] : ['workspace_factory_document', 'workspace_factory_materials', ...(mode === 'ask' ? [] : ['workspace_factory_inquiry_save'])]);
  const files = state.artifacts.filter(a => a.metadata.factoryInquiry); assert.equal(files.length, mode === 'two' ? 2 : mode === 'reply' ? 1 : 0);
  for (const artifact of files) { assert.equal(artifact.sourceConversationId, cid); assert.equal(artifact.sourceRunId, run.id); assert.equal(artifact.metadata.factoryInquiry.humanReviewed, false);
    const file = await f.app.artifacts.download(artifact.id, { version: 1 }); assert.match(file.bytes.toString(), /NOT SENT/); }
  const foreign = await f.workspace(`/api/conversations/${cid}/messages`, { subject: 'member-b', body: { content: 'Reuse draft', requestId: randomUUID(), workspaceExecution: true, inputContext: empty() } }); assert.equal(foreign.status, 404);
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  t.diagnostic('Actual official OMP AgentSession/tool dispatch and original services. All choices and prose above are finite synthetic model responses, not evidence of model intelligence or real business quality.');
});
test('a model draft-save attempt in a readonly original Run creates no artifact', { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await create(f), run = await send(f, cid, false); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
  const mapping = f.app.store.read().conversations.find(c => c.id === cid).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const denied = entries.find(e => e.message?.toolName === 'workspace_factory_inquiry_save').message;
  assert.equal(denied.details.status, 'blocked'); assert.equal(denied.isError, true);
});
test('actual inquiry whole-journal replay refuses changed original source before another model request', { timeout: 60000 }, async t => {
  const f = await fixture(t, { mode: 'ask' }), cid = await create(f), first = await send(f, cid, false); assert.equal(first.status, 'succeeded', JSON.stringify(first));
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'UNREVIEWED_INQUIRY_SOURCE_CHANGE' } }, f.actor);
  const next = await send(f, cid, false); assert.equal(next.status, 'failed');
  assert.equal(next.events.filter(e => e.type === 'pi.agent-session.request').length, 0);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
});

test('the original whole-journal guard refuses a forged saved extraction receipt before any further model request', { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await create(f), first = await send(f, cid, true); assert.equal(first.status, 'succeeded', JSON.stringify(first));
  const mapping = f.app.store.read().conversations.find(c => c.id === cid).businessAgentSession;
  const rows = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const saved = rows.find(e => e.message?.role === 'toolResult' && e.message.toolName === 'workspace_factory_inquiry_save').message;
  const forged = structuredClone(saved.details); forged.extraction.notice = 'UNADMITTED_CACHED_EXTRACTION_TEXT';
  await fs.appendFile(mapping.sessionFile, JSON.stringify({ type: 'message', id: randomUUID(), parentId: rows.at(-1).id,
    timestamp: new Date().toISOString(), message: { ...saved, toolCallId: 'synthetic-forged-cache', details: forged,
      content: [{ type: 'text', text: JSON.stringify(forged) }] } }) + '\n');
  const refused = await send(f, cid, false); assert.equal(refused.status, 'failed');
  assert.equal(refused.events.filter(e => e.type === 'pi.agent-session.request').length, 0);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 1);
});

test('original HTTP cancellation before an inquiry artifact commit preserves original inputs and creates no draft file', { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await create(f), original = f.app.artifacts.create;
  let release; const gate = new Promise(resolve => { release = resolve; }); let pending = false;
  f.app.artifacts.create = async (...args) => { if (args[0].filename === 'reply.md') { pending = true; await gate; } return original(...args); };
  t.after(() => release());
  const completion = send(f, cid, true);
  for (let i = 0; i < 300 && !pending; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(pending, true, 'Actual original save must reach its precommit gate.');
  const runId = f.app.store.read().conversations.find(c => c.id === cid).activeRunId;
  const cancelled = await f.workspace(`/api/conversations/${cid}/cancel`, { subject: 'member-a', body: {} }); assert.equal(cancelled.status, 200, cancelled.text);
  release(); const run = await completion; assert.equal(run.status, 'cancelled'); assert.equal(run.id, runId);
  for (let i = 0; i < 100 && !f.lifecycle.some(e => e.phase === 'exit'); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(f.lifecycle.some(e => e.phase === 'exit'));
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
  assert.equal(f.app.store.read().artifacts.some(a => a.id === f.asset.artifactId), true);
  assert.equal((await f.app.artifacts.download(f.asset.artifactId, { version: 1 })).version.sha256, f.asset.sha256);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 1);
});
