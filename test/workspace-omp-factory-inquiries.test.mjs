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
async function fixture(t, { save = true } = {}) {
  let f; const lifecycle = [];
  f = await materialsFixture(t, { businessAgentOptions: data => {
    const input = { inquiryDocumentId: data.document.id, documentVersion: 1, productId: data.product.id,
      requirements: { product: 'original uploaded specification', quantity: null } };
    return { recipient: RECIPIENT,
      engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths(), factoryInquiries: true, onWorkerLifecycle: event => lifecycle.push(event),
        configuration: { providerId: MODEL.provider, model: MODEL.id, baseUrl: MODEL.baseUrl },
        syntheticResponses: [{ tool: 'workspace_factory_inquiry_prepare', arguments: input },
          ...(save ? [{ tool: 'workspace_factory_inquiry_save', arguments: { ...input, requestId: 'same-original-inquiry-save', confirmed: true }, draftHashFromPreviousTool: true }] : []),
          { text: 'Only human-review drafts were prepared. Prices, samples, delivery commitments and recipient approval remain pending. No message was sent.', expectedContextText: 'Unit price: pending' }],
      }), resolveBinding: async () => ({ model: MODEL, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
        const r = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
        if (r.status >= 400) lifecycle.push({ phase: 'existing-agent-http-refused', path: new URL(url).pathname, status: r.status });
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
for (const execute of [false, true]) test(`actual inquiry profile keeps original save intent=${execute} with exact source/hash and no external task/send`, { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await create(f), run = await send(f, cid, execute); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const state = f.app.store.read(), mapping = state.conversations.find(c => c.id === cid).businessAgentSession;
  assert.equal(mapping.engineScope, 'omp:18.10.4:factory-inquiries-v1');
  const journal = await fs.readFile(mapping.sessionFile, 'utf8'); assert.ok(!journal.includes(TOKEN_A)); assert.ok(!journal.includes('UNAPPROVED_PRIVATE_PRICE_NOTE'));
  const entries = journal.trim().split('\n').map(s => JSON.parse(s));
  const prepared = entries.find(e => e.message?.toolName === 'workspace_factory_inquiry_prepare').message;
  assert.ok(!prepared.isError); assert.equal(prepared.details.drafts.length, 3); assert.equal(prepared.details.sent, false); assert.equal(prepared.details.match.accepted, false);
  const saved = entries.find(e => e.message?.toolName === 'workspace_factory_inquiry_save').message;
  assert.equal(saved.isError === true, !execute); assert.equal(saved.details.status, execute ? 'saved' : 'blocked');
  const artifacts = state.artifacts.filter(a => a.metadata.factoryInquiry);
  assert.equal(artifacts.length, execute ? 3 : 0);
  for (const artifact of artifacts) { assert.equal(artifact.sourceConversationId, cid); assert.equal(artifact.sourceRunId, run.id); assert.equal(artifact.metadata.factoryInquiry.sent, false);
    const file = await f.app.artifacts.download(artifact.id, { version: 1 }); assert.match(file.bytes.toString(), /NOT SENT/); }
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(state.runs.length, 1); assert.equal(f.faux.state.callCount, 0);
  assert.ok(run.events.every(e => !['workspace_public_search', 'workspace_public_browser', 'workspace_factory_task'].includes(e.toolName)));
  if (execute) {
    const replay = await send(f, cid, true); assert.equal(replay.status, 'succeeded', JSON.stringify({ run: replay, lifecycle: f.lifecycle }));
    const after = f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry); assert.deepEqual(after.map(a => a.id), artifacts.map(a => a.id));
    assert.ok(after.every(a => a.sourceRunId === run.id), 'Original creating Run linkage survives explicit receipt replay.');
  }
});
test('actual inquiry whole-journal replay refuses changed original source before another model request', { timeout: 60000 }, async t => {
  const f = await fixture(t, { save: false }), cid = await create(f), first = await send(f, cid, false); assert.equal(first.status, 'succeeded', JSON.stringify(first));
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'UNREVIEWED_INQUIRY_SOURCE_CHANGE' } }, f.actor);
  const next = await send(f, cid, false); assert.equal(next.status, 'failed');
  assert.equal(next.events.filter(e => e.type === 'pi.agent-session.request').length, 0);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
});

test('original HTTP cancellation before an inquiry artifact commit preserves original inputs and creates no draft file', { timeout: 60000 }, async t => {
  const f = await fixture(t), cid = await create(f), original = f.app.artifacts.create;
  let release; const gate = new Promise(resolve => { release = resolve; }); let pending = false;
  f.app.artifacts.create = async (...args) => { if (args[0].filename === 'quotation-review-draft.md') { pending = true; await gate; } return original(...args); };
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
