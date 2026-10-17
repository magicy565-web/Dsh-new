// Original authenticated Host/Run/Library/Artifact and OMP worker. Only model
// responses and enterprise identity/material are explicit finite fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../plugins/workspace-procurement/src/workspace.mjs';
import { TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';

const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const hash = value => createHash('sha256').update(value).digest('hex');
const bodies = ['Synthetic reply: quantity 100. MOQ, delivery and certification remain unconfirmed.',
  'Synthetic revised reply: quantity 200. MOQ, delivery and certification remain unconfirmed.'];
async function setup(t, { afterWorkerExit } = {}) {
  let f, selection; const responses = [], lifecycle = [];
  f = await materialsFixture(t, { businessAgentOptions: data => {
    selection = { inquiryDocumentId: data.document.id, documentVersion: 1, productId: data.product.id };
    return { recipient: RECIPIENT,
      engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths({}), factoryInquiries: true,
        configuration: { providerId: MODEL.provider, model: MODEL.id, baseUrl: MODEL.baseUrl }, syntheticResponses: responses,
        onWorkerLifecycle(event) { lifecycle.push(event); if (event.phase === 'exit') afterWorkerExit?.(f); } }),
      resolveBinding: async () => ({ model: MODEL, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A,
        fetchImpl: async (url, options) => {
          const result = await request(f.baseURL, new URL(url).pathname + new URL(url).search, {
            method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' },
          });
          return new Response(result.bytes, { status: result.status, headers: { 'content-type': result.headers['content-type'] } });
        } }) }),
    };
  } });
  const created = await f.workspace('/api/conversations', { subject: 'member-a', body: {
    title: 'Synthetic original inquiry continuation', requestId: randomUUID(), inputContext: empty(),
  } });
  assert.equal(created.status, 201, created.text);
  return Object.assign(f, { cid: created.json.conversation.id, responses, selection, lifecycle });
}
async function send(f, content, specs, { execute = true, requestId = randomUUID() } = {}) {
  f.responses.splice(0, f.responses.length, ...specs);
  const accepted = await f.workspace(`/api/conversations/${f.cid}/messages`, { subject: 'member-a', body: {
    content, requestId, workspaceExecution: execute, inputContext: empty(),
  } });
  assert.equal(accepted.status, 202, accepted.text);
  for (let attempt = 0; attempt < 500; attempt++) {
    const run = f.app.store.read().runs.find(r => r.id === accepted.json.run.id);
    if (run && !['queued', 'running'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Original inquiry continuation Run did not settle.');
}
const firstSpecs = f => [
  { tool: 'workspace_factory_document', arguments: { documentId: f.document.id, documentVersion: 1 } },
  { tool: 'workspace_factory_materials', arguments: { productId: f.product.id } },
  { tool: 'workspace_factory_inquiry_save', arguments: { ...f.selection, documents: [{ name: 'reply.md', content: bodies[0] }], requestId: 'inquiry-first' }, sourcesFromPreviousTools: true },
  { text: 'Synthetic internal reply saved. Quantity 100; no sending.' },
];
const revisionSpecs = (f, requestId = 'inquiry-revision') => [
  { tool: 'workspace_factory_inquiry_save', arguments: { ...f.selection, documents: [{ name: 'reply-v2.md', content: bodies[1] }], requestId },
    sourcesFromPreviousTools: true, expectedContextText: bodies[0] },
  { text: 'Synthetic revised internal reply saved. Quantity 200; unknowns retained; no sending.', expectedContextText: bodies[1] },
];
const mapping = f => f.app.store.read().conversations.find(c => c.id === f.cid).businessAgentSession;
const drafts = f => f.app.store.read().artifacts.filter(a => a.metadata?.factoryInquiry);
const journal = async f => (await fs.readFile(mapping(f).sessionFile, 'utf8')).trim().split('\n').map(JSON.parse);
const modelCalls = run => run.events.filter(e => e.type === 'pi.agent-session.request').length;

test('original authenticated inquiry continues one native Session across two Runs and saves an unsent revision with original Artifact authority', { timeout: 60000 }, async t => {
  const f = await setup(t), firstGoal = 'Read the selected inquiry and product; save an internal reply for quantity 100. Do not send.';
  const first = await send(f, firstGoal, firstSpecs(f));
  assert.equal(first.status, 'succeeded', JSON.stringify({ first, lifecycle: f.lifecycle })); assert.equal(modelCalls(first), 4);
  const beforeMapping = mapping(f), prefix = await fs.readFile(beforeMapping.sessionFile), firstArtifact = drafts(f)[0];
  const firstBytes = (await f.app.artifacts.download(firstArtifact.id, { version: 1 })).bytes;
  const secondGoal = 'Revise that saved draft to quantity 200; retain unknowns and the original. Save a new internal revision; do not send.';
  const second = await send(f, secondGoal, revisionSpecs(f));
  assert.equal(second.status, 'succeeded', JSON.stringify({ second, lifecycle: f.lifecycle })); assert.equal(modelCalls(second), 2);
  assert.notEqual(first.id, second.id); assert.deepEqual(mapping(f), beforeMapping);
  const after = await fs.readFile(beforeMapping.sessionFile); assert.ok(after.subarray(0, prefix.length).equals(prefix));
  const records = drafts(f); assert.equal(records.length, 2);
  for (let index = 0; index < 2; index++) {
    const record = records.find(a => a.sourceRunId === [first.id, second.id][index]); assert.ok(record);
    const downloaded = await f.app.artifacts.download(record.id, { version: 1 });
    assert.equal(record.sourceConversationId, f.cid); assert.equal(record.currentVersion, 1);
    assert.equal(record.metadata.businessLibrary.visibility, 'internal');
    assert.equal(record.metadata.factoryInquiry.humanReviewed, false); assert.equal(record.metadata.factoryInquiry.sent, false);
    assert.equal(record.metadata.factoryInquiry.humanReviewRequired, true); assert.equal(record.metadata.factoryInquiry.externalActions, false);
    assert.equal(downloaded.version.sha256, hash(downloaded.bytes)); assert.ok(downloaded.bytes.toString().includes(bodies[index]));
    assert.equal(record.metadata.factoryInquiry.sources.length, 2);
    assert.ok(record.metadata.factoryInquiry.sources.some(s => s.kind === 'factory-document' && s.sha256 === f.asset.sha256 && s.documentVersion === 1));
    assert.ok(record.metadata.factoryInquiry.sources.some(s => s.kind === 'factory-product' && s.recordId === f.product.id && s.revision === 1));
  }
  assert.ok((await f.app.artifacts.download(firstArtifact.id, { version: 1 })).bytes.equals(firstBytes));
  const rows = await journal(f), messages = rows.filter(e => e.message).map(e => e.message);
  assert.equal(messages.filter(m => m.role === 'assistant').at(-1).stopReason, 'stop');
  for (const goal of [firstGoal, secondGoal]) assert.ok(messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes(goal)));
  assert.equal(messages.filter(m => m.role === 'toolResult' && m.toolName === 'workspace_factory_document').length, 1);
  assert.equal(messages.filter(m => m.role === 'toolResult' && m.toolName === 'workspace_factory_materials').length, 1);
  assert.equal(messages.filter(m => m.role === 'toolResult' && m.toolName === 'workspace_factory_inquiry_save').length, 2);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  assert.ok(!after.includes(Buffer.from(TOKEN_A))); assert.ok(!after.includes(Buffer.from('UNAPPROVED_PRIVATE_PRICE_NOTE')));
  t.diagnostic('Original signed Host/Store/Library/Artifact/fd3 and same OMP Session; finite model choices only, real external requests 0.');
});

for (const mode of ['readonly', 'request-conflict', 'source-drift']) test(`original inquiry second-turn protection: ${mode}`, { timeout: 60000 }, async t => {
  const f = await setup(t), first = await send(f, 'Save the original internal reply.', firstSpecs(f));
  assert.equal(first.status, 'succeeded'); const original = drafts(f)[0];
  if (mode === 'source-drift') await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'Synthetic changed source' } }, f.actor);
  const next = await send(f, 'Revise quantity to 200 and save internally.', revisionSpecs(f, mode === 'request-conflict' ? 'inquiry-first' : 'inquiry-revision'), { execute: mode !== 'readonly' });
  if (mode === 'source-drift') { assert.equal(next.status, 'failed'); assert.equal(modelCalls(next), 0); }
  else {
    assert.equal(next.status, 'succeeded');
    const rejected = (await journal(f)).filter(e => e.message?.toolName === 'workspace_factory_inquiry_save').at(-1).message;
    assert.equal(rejected.isError, true); assert.equal(rejected.details.status, 'blocked');
    // The original 403 intent refusal is deliberately redacted by the plugin.
    assert.equal(rejected.details.reason, mode === 'readonly' ? 'ORIGINAL_AUTHORIZATION_REFUSED' : 'FACTORY_INQUIRY_REQUEST_CHANGED');
  }
  assert.equal(drafts(f).length, 1); assert.equal(drafts(f)[0].id, original.id); assert.equal(drafts(f)[0].sha256, original.sha256);
});

test('inquiry final Node disclosure refuses an Artifact changed after the original worker exits', { timeout: 60000 }, async t => {
  let injected = false, mutationError;
  const f = await setup(t, { afterWorkerExit(current) {
    if (injected) return;
    try {
      const artifact = drafts(current)[0]; assert.ok(artifact);
      const blob = `${current.directory}/artifacts/${artifact.id}.v1.${artifact.sha256}.blob`;
      const bytes = readFileSync(blob); assert.equal(hash(bytes), artifact.sha256);
      // Test-owned synthetic blob only; mutate at the exact worker-exit/Node
      // delivery gap after all worker checks, before any proposed new guard.
      writeFileSync(blob, Buffer.concat([bytes, Buffer.from('\nSynthetic after-worker change.')]));
      injected = true;
    } catch (error) { mutationError = error; }
  } });
  const run = await send(f, 'Read and save an internal reply.', firstSpecs(f));
  if (mutationError) throw mutationError;
  assert.equal(injected, true); assert.equal(modelCalls(run), 4);
  assert.equal(run.status, 'failed', 'A saved Artifact is not proof it remained valid at Node disclosure.');
  assert.equal(run.error.code, 'OMP_DISCLOSURE_REFUSED');
  assert.equal(drafts(f).length, 1, 'No rollback claim for an already saved internal Artifact.');
});

for (const mode of ['control', 'source-version', 'draft-version', 'session-revoke']) test(`original inquiry final Artifact read race: ${mode}`, { timeout: 60000 }, async t => {
  let armed = false, injected = false, mutationCompleted = false;
  const f = await setup(t, { afterWorkerExit() { armed = true; } });
  const download = f.app.artifacts.download;
  f.app.artifacts.download = async (...args) => {
    const result = await download(...args);
    if (armed && !injected && result.artifact.metadata?.factoryInquiry) {
      assert.equal(result.artifact.currentVersion, 1); injected = true;
      if (mode === 'source-version') await f.app.businessLibrary.updateProduct(f.product.id, {
        requestId: randomUUID(), expectedRevision: 1, changes: { name: 'Synthetic change during final inquiry Artifact read' },
      }, f.actor);
      if (mode === 'draft-version') await f.app.artifacts.update(result.artifact.id, { content: 'Synthetic newer internal draft during final read.' });
      if (mode === 'session-revoke') {
        const session = f.app.access.listSessions().sessions.find(s => s.subject === 'member-a'); assert.ok(session);
        const revoked = await f.workspace(`/api/access/sessions/${session.id}/revoke`, { subject: 'member-a', body: {} });
        assert.equal(revoked.status, 200, revoked.text); assert.equal(f.app.access.nativeSessionById(session.id), null);
      }
      mutationCompleted = true;
    }
    return result;
  };
  t.after(() => { f.app.artifacts.download = download; });
  const run = await send(f, 'Read and save the original internal reply.', firstSpecs(f));
  assert.equal(injected, true, 'The original Node final Artifact download must be reached.');
  assert.equal(mutationCompleted, true); assert.equal(modelCalls(run), 4);
  assert.equal(run.status, mode === 'control' ? 'succeeded' : 'failed');
  if (mode !== 'control') assert.equal(run.error.code, 'OMP_DISCLOSURE_REFUSED');
  assert.equal(drafts(f).length, 1);
  assert.equal(drafts(f)[0].currentVersion, mode === 'draft-version' ? 2 : 1);
});
