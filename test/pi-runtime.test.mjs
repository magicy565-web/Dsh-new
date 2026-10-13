import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider, PI_SOURCE } from '../server/pi-provider.mjs';
import { capabilityPayloadHash } from '../server/capabilities.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(10); } throw new Error('Pi fixture did not settle'); }
function makeProvider(faux) { const models = createModels(); models.setProvider(faux.provider); return createPiProvider({ models, providerId: 'faux', model: 'faux-1' }); }
async function fixture(t, responses = []) {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-test-');
  const faux = fauxProvider(); faux.setResponses(responses);
  let app = await createApp({ dataDirectory: directory, provider: makeProvider(faux) });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, faux, get app() { return app; }, async reopen() { await app.close(); app = await createApp({ dataDirectory: directory, provider: makeProvider(faux) }); return app; } };
}
async function chat(f, content = 'Fixture input', extra = {}) {
  const conversation = (await f.app.runtime.createConversation({})).conversation;
  const result = await f.app.runtime.sendMessage(conversation.id, { content, requestId: 'pi-fixture-request', ...extra });
  return { conversation, result };
}


// PR59 used this exact policy digest for ordinary chat, Muse draft, supplier
// draft and Goal runs. The original scope did not include an endpoint field.
const PR59_POLICY_V4 = { version: 4, tools: ['workspace_input', 'workspace_propose_action', 'workspace_propose_muse_draft', 'workspace_propose_supplier_profile'], externalExecution: 'original-workspace-approval', replay: 'safe-only', storage: 'jsonl-fsync', budget: 'durable-request-reservations-wire-usage', museInput: 'original-owner-provenance', museDraft: 'quote-verified-inert-v1', supplier: 'quote-verified-private-v1' };
test('PR59 ordinary Pi policy fingerprint stays byte-compatible only on its original endpoint', () => {
  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider);
  const options = { models, providerId: 'faux', model: 'faux-1' };
  const p = createPiProvider(options);
  const original = capabilityPayloadHash({ ...PR59_POLICY_V4, providerId: 'faux', model: 'faux-1', source: PI_SOURCE });
  assert.equal(p.legacyPolicyCompatible, true);
  assert.equal(p.permissionFingerprint, original, 'Unchanged PR59 runs must not inherit Agent-only permissions.');
  assert.notEqual(p.agentPermissionFingerprint, original, 'Agent preset stages must have a separate V5 admission fingerprint.');
  const otherEndpoint = createPiProvider({ ...options, baseUrl: 'https://changed-endpoint.example/v1' });
  assert.equal(otherEndpoint.legacyPolicyCompatible, false);
  assert.notEqual(otherEndpoint.permissionFingerprint, original, 'A changed endpoint must never be admitted by the old V4 policy.');
  assert.equal(otherEndpoint.permissionFingerprint, otherEndpoint.agentPermissionFingerprint);
});

test('real Pi package fixture: durable text execution, usage, persisted submission and business dedupe', async t => {
  const f = await fixture(t, [fauxAssistantMessage('Pi fixture answer')]);
  const { conversation, result } = await chat(f);
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  const run = f.app.runtime.getRun(result.run.id).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.ok(run.piSubmissionId); assert.ok(run.piRequestId);
  assert.equal(f.app.runtime.bootstrap().messages.at(-1).content, 'Pi fixture answer');
  assert.equal(f.app.runtime.bootstrap().messages.at(-1).runtime.source, PI_SOURCE);
  await f.reopen();
  const repeated = await f.app.runtime.sendMessage(conversation.id, { content: 'Fixture input', requestId: 'pi-fixture-request' });
  assert.equal(repeated.duplicate, true); assert.equal(repeated.run.id, run.id);
  assert.equal(f.faux.state.callCount, 1);
});

test('real Pi package fixture: selected file tool uses original ID/version/SHA snapshot and cannot read ambient data', async t => {
  const f = await fixture(t);
  const artifact = (await f.app.artifacts.create({ filename: 'selected.txt', content: 'Selected fixture bytes', mimeType: 'text/plain' })).artifact;
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: artifact.id }), { stopReason: 'toolUse' }), (ctx) => {
    assert.ok(JSON.stringify(ctx).includes('Selected fixture bytes'));
    return fauxAssistantMessage('Verified selected input fixture');
  }]);
  const { result } = await chat(f, 'Read selected file', { inputContext: { artifacts: [{ id: artifact.id, version: artifact.currentVersion }], skills: [], memoryIds: [], connectorActions: [] } });
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'succeeded', JSON.stringify(f.app.runtime.getRun(result.run.id).run.error));
  assert.equal(f.faux.state.callCount, 2);
});

test('real Pi package fixture: user cancellation explicitly aborts durable work; reopen does not resume it', async t => {
  const f = await fixture(t, [async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const { result } = await chat(f);
  await until(() => f.faux.state.callCount === 1);
  await f.app.runtime.cancelRun(result.run.id);
  await until(() => f.app.runtime.status().queue.active === 0);
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'cancelled');
  await f.reopen(); await delay(40);
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'cancelled');
});

test('real Pi package fixture: close/reopen preserves pending durable execution; explicit retry reattaches same run/submission', async t => {
  const f = await fixture(t, [async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const { result } = await chat(f);
  await until(() => f.app.runtime.getRun(result.run.id).run.piSubmissionId && f.faux.state.callCount === 1);
  const originalRun = f.app.runtime.getRun(result.run.id).run;
  const submissionId = originalRun.piSubmissionId;
  assert.deepEqual(Object.keys(originalRun.execution).sort(), ['kind', 'model', 'permissionFingerprint'],
    'PR59 ordinary execution scopes must have no Agent-only endpoint field.');
  assert.equal(originalRun.executionHash, capabilityPayloadHash(originalRun.execution));
  await f.reopen();
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'interrupted');
  await delay(40); assert.equal(f.faux.state.callCount, 1);
  f.faux.setResponses([fauxAssistantMessage('Resumed fixture answer')]);
  const resumed = await f.app.runtime.retryRun(result.run.id, { requestId: 'recover-pi-fixture' });
  assert.equal(resumed.recovered, true); assert.equal(resumed.run.id, result.run.id);
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  const run = f.app.runtime.getRun(result.run.id).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); assert.equal(run.piSubmissionId, submissionId);
  assert.equal(f.app.runtime.bootstrap().messages.filter(value => value.role === 'user').length, 1);
});

test('real Pi package fixture: default boot is DSH-free, private storage shares original exclusive writer and Muse never falls back', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-default-');
  const app = await createApp({ dataDirectory: directory });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await (await fetch(base + '/api/health')).json()).provider.kind, 'pi-durable');
  await assert.rejects(createApp({ dataDirectory: directory }), /already open|lock|writer|owned/i);
  const conversation = (await app.runtime.createConversation({})).conversation;
  const response = await fetch(`${base}/api/conversations/${conversation.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Muse must remain original', provider: 'muse' }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'MW_NATIVE_CONVERSATION_REQUIRED');
  assert.equal(app.runtime.listRuns().runs.length, 0);
  assert.equal((await fs.stat(path.join(directory, 'pi'))).mode & 0o077, 0);
});

test('real Pi package fixture: connector proposal stops for original exact approval and explicit continuation', async t => {
  const f = await fixture(t);
  const saved = (await f.app.capabilities.createConnector({ name: 'Original local library', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
  const connector = (await f.app.capabilities.updateConnector(saved.id, { enabled: true })).connector;
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: 'Review exact local file creation', connectorId: connector.id, action: 'create_file', resource: 'library:new', payload: { filename: 'approved.md', content: '# Approved fixture bytes' } }), { stopReason: 'toolUse' })]);
  const { result } = await chat(f, 'Create after review', { workspaceExecution: true, inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [{ connectorId: connector.id, action: 'create_file' }] } });
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  let run = f.app.runtime.getRun(result.run.id).run;
  assert.equal(run.status, 'awaiting_approval', JSON.stringify(run.error));
  assert.equal(f.app.artifacts.list().artifacts.length, 0);
  assert.equal(f.faux.state.callCount, 1);
  const proposalId = run.proposals[0].id;
  await assert.rejects(f.app.runtime.resumeRun(run.id, { proposalId }), { code: 'APPROVAL_REQUIRED' });
  await f.app.runtime.resolveRunAction(run.id, { proposalId, decision: 'approved', confirmed: true });
  assert.equal(f.app.artifacts.list().artifacts.length, 0);
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Original adapter completed', artifact: { filename: 'delivery.txt', content: 'Pi fixture deliverable' } }))]);
  await f.app.runtime.resumeRun(run.id, { proposalId, requestId: 'explicit-pi-continue' });
  await until(() => f.app.runtime.getRun(run.id).run.status !== 'running');
  run = f.app.runtime.getRun(run.id).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(f.app.capabilities.listConnectorRuns().length, 1);
  const reply = f.app.runtime.bootstrap().messages.find(value => value.id === run.assistantId);
  assert.ok(reply.artifactReference.sha256);
  const download = await f.app.artifacts.download(reply.artifactReference.id, { version: reply.artifactReference.version });
  assert.equal(download.bytes.toString(), 'Pi fixture deliverable');
});

test('real Pi package fixture: unknown tools, unselected inputs and unselected connector proposals have no effects', async t => {
  for (const call of [fauxToolCall('bash', { command: 'DO_NOT_RUN' }), fauxToolCall('workspace_input', { kind: 'artifact', id: 'not-selected' }), fauxToolCall('workspace_propose_action', { content: 'Must deny', connectorId: 'not-selected', action: 'write', resource: 'external:any', payload: {} })]) {
    const f = await fixture(t, [fauxAssistantMessage(call, { stopReason: 'toolUse' }), (ctx) => { assert.equal(ctx.messages.at(-1).isError, true); return fauxAssistantMessage(JSON.stringify({ done: true, content: 'Permission denied fixture' })); }]);
    const { result } = await chat(f, 'Permission fixture', { workspaceExecution: true });
    await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
    assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'succeeded');
    assert.equal(f.app.capabilities.listApprovals().length, 0);
    assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
    assert.equal(f.app.artifacts.list().artifacts.length, 0);
  }
});

test('real Pi package fixture: interrupted goal resumes its original reservation and reply without duplicating a step', async t => {
  const f = await fixture(t, [async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const goal = (await f.app.runtime.createGoal({ title: 'Bounded durable fixture', maxSteps: 2 })).goal;
  const started = await f.app.runtime.updateGoal(goal.id, { action: 'start' });
  const runId = started.goal.runId;
  await until(() => f.app.runtime.getRun(runId).run.piSubmissionId && f.faux.state.callCount === 1);
  const before = f.app.runtime.getRun(runId).run;
  await f.reopen();
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Recovered goal fixture' }))]);
  await f.app.runtime.retryRun(runId, { requestId: 'recover-goal-fixture' });
  await until(() => f.app.runtime.getRun(runId).run.status !== 'running');
  const run = f.app.runtime.getRun(runId).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.assistantId, before.assistantId);
  assert.equal(run.reservedOutputTokens, before.reservedOutputTokens);
  assert.equal(f.app.runtime.bootstrap().goals[0].stepCount, 1);
});

test('real Pi package fixture: changed selected memory and execution scope block recovery without another model call', async t => {
  const f = await fixture(t, [async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const memory = (await f.app.runtime.createMemory({ content: 'Original selected fixture' })).memory;
  const { result } = await chat(f, 'Use selected note', { inputContext: { artifacts: [], skills: [], memoryIds: [memory.id], connectorActions: [] } });
  await until(() => f.app.runtime.getRun(result.run.id).run.piSubmissionId);
  await f.reopen();
  await f.app.runtime.updateMemory(memory.id, { content: 'Changed fixture' });
  await assert.rejects(f.app.runtime.retryRun(result.run.id, { requestId: 'must-block-recovery' }), { code: 'INPUT_MEMORY_CHANGED' });
  assert.equal(f.faux.state.callCount, 1);
});
