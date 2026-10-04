import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { parseWorkspaceResponse } from '../server/workspace-bridge.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let count = 0; count < 500; count++) { if (await check()) return; await sleep(5); } throw new Error('Bridge fixture condition timed out'); }
const answer = value => ({ content: JSON.stringify(value), usage: { promptTokens: 10, completionTokens: 100, totalTokens: 110 } });
async function fixture(t, complete, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-business-bridge-'));
  const requests = [];
  const provider = { configured: true, complete: input => { requests.push(input); return complete(input, requests.length); } };
  const app = await createApp({ dataDirectory: directory, provider, schedulerIntervalMs: 60_000, ...options });
  await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { app, provider, requests, directory };
}
async function connector(app, adapter = 'workspace-library', actions = ['create_file']) {
  const saved = (await app.capabilities.createConnector({ name: 'Reviewed local files', adapter, capabilities: actions })).connector;
  return (await app.capabilities.updateConnector(saved.id, { enabled: true })).connector;
}
async function task(app, selected, extra = {}) {
  const { goal } = await app.runtime.createGoal({ title: 'Prepare a local report', inputContext: { connectorActions: [{ connectorId: selected.id, action: selected.capabilities[0] }] }, ...extra });
  const result = await app.runtime.updateGoal(goal.id, { action: 'start' });
  const runId = result.goal.runId;
  await until(() => app.runtime.getRun(runId).run.status !== 'running');
  return { goal, runId, run: app.runtime.getRun(runId).run };
}
async function approve(app, run) { return app.runtime.resolveRunAction(run.id, { proposalId: run.proposals.at(-1).id, decision: 'approved', confirmed: true }); }
const createAction = id => ({ connectorId: id, action: 'create_file', resource: 'library:new', payload: { filename: 'draft.md', content: '# Exact approved draft' } });

test('workspace goal pauses for exact approval, executes once and resumes with receipt, plan and real output file', async t => {
  let id;
  const { app, requests } = await fixture(t, async (_input, call) => call === 1 ? answer({ done: false, content: 'Create draft.md with the displayed text.', plan: [{ id: 'draft', title: 'Create the file', status: 'in_progress' }], action: createAction(id) }) : answer({ done: true, content: 'The approved file was saved. Final summary is ready.', plan: [{ id: 'draft', title: 'Create the file', status: 'completed' }], artifact: { filename: 'summary.md', content: '# Final summary' } }));
  id = (await connector(app)).id;
  const { run } = await task(app, app.capabilities.getConnector(id));
  assert.equal(run.status, 'awaiting_approval'); assert.equal(app.artifacts.list().artifacts.length, 0); assert.equal(requests.length, 1);
  assert.equal(app.runtime.bootstrap().goals[0].status, 'awaiting_approval');
  await assert.rejects(app.runtime.resumeRun(run.id), { code: 'APPROVAL_REQUIRED' });
  await assert.rejects(app.capabilities.decideApproval(run.proposals[0].approvalId, { decision: 'approved', confirmed: true }), { code: 'RUN_APPROVAL_BOUND' });
  await approve(app, run);
  await assert.rejects(app.capabilities.executeConnector(id, { ...createAction(id), connectorId: undefined }), { code: 'INVALID_INPUT' });
  const { connectorId: _, ...manual } = createAction(id);
  await assert.rejects(app.capabilities.executeConnector(id, { ...manual, approvalId: run.proposals[0].approvalId }), { code: 'APPROVAL_MISMATCH' });
  await app.runtime.resumeRun(run.id, { requestId: 'resume-once' });
  await until(() => app.runtime.getRun(run.id).run.status === 'succeeded');
  const finished = app.runtime.getRun(run.id).run;
  assert.equal(finished.proposals[0].status, 'succeeded'); assert.equal(finished.proposals[0].receipt.result.saved, true);
  assert.equal(finished.plan[0].status, 'completed'); assert.ok(finished.outputArtifactId);
  assert.equal((await app.artifacts.read(finished.outputArtifactId)).content, '# Final summary');
  assert.equal(app.artifacts.get(finished.outputArtifactId).artifact.sourceRunId, run.id);
  assert.match(JSON.stringify(requests[1].messages), /Verified application connector receipt/);
  assert.match(JSON.stringify(requests[1].messages), /Exact approved draft|saved/);
  assert.equal(app.runtime.bootstrap().goals[0].outputTokens, 200);
  assert.equal((await app.runtime.resumeRun(run.id, { requestId: 'resume-once' })).duplicate, true);
  assert.equal(app.capabilities.listConnectorRuns().length, 1);
});

test('chat workspace task uses same approval lifecycle and connector receipts without granting direct tools', async t => {
  let id;
  const { app, requests } = await fixture(t, async (_input, call) => answer(call === 1 ? { done: false, content: 'Review the exact create operation.', action: createAction(id) } : { done: true, content: 'Saved and verified.' }));
  id = (await connector(app)).id;
  const { conversation } = await app.runtime.createConversation({});
  const { run: sent } = await app.runtime.sendMessage(conversation.id, { content: 'Create my report', inputContext: { connectorActions: [{ connectorId: id, action: 'create_file' }] } });
  await until(() => app.runtime.getRun(sent.id).run.status === 'awaiting_approval');
  const waiting = app.runtime.getRun(sent.id).run; await approve(app, waiting);
  await app.runtime.resumeRun(sent.id, {}); await until(() => app.runtime.getRun(sent.id).run.status === 'succeeded');
  assert.equal(requests.length, 2); assert.equal(requests[0].json, true);
  assert.equal(app.runtime.getRun(sent.id).run.stepCount, 2);
  assert.equal(app.runtime.getRun(sent.id).run.outputTokens, 200);
  assert.match(requests[0].messages[0].content, /application will stop for actual user approval/);
});

test('unselected model-proposed connector action fails without approval or execution', async t => {
  let id;
  const { app } = await fixture(t, async () => answer({ done: false, content: 'Unauthorized request', action: createAction(id) }));
  id = (await connector(app)).id;
  const goal = (await app.runtime.createGoal({ title: 'No connector selected' })).goal;
  const started = await app.runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => app.runtime.getRun(started.goal.runId).run.status === 'failed');
  assert.equal(app.runtime.getRun(started.goal.runId).run.error.code, 'CONNECTOR_SCOPE_DENIED');
  assert.equal(app.capabilities.listApprovals().length, 0); assert.equal(app.capabilities.listConnectorRuns().length, 0);
});

test('denying or cancelling a pending action closes the run and never calls adapter or model again', async t => {
  for (const action of ['denied', 'cancelled']) {
    let id;
    const { app, requests } = await fixture(t, async () => answer({ done: false, content: 'Review operation', action: createAction(id) }));
    id = (await connector(app)).id; const { run } = await task(app, app.capabilities.getConnector(id));
    if (action === 'denied') await app.runtime.resolveRunAction(run.id, { proposalId: run.proposals[0].id, decision: 'denied', confirmed: true });
    else await app.runtime.cancelRun(run.id);
    await assert.rejects(app.runtime.resumeRun(run.id), { code: 'RUN_NOT_ACTIVE' });
    assert.equal(app.capabilities.listConnectorRuns().length, 0); assert.equal(requests.length, 1);
    assert.equal(app.capabilities.getApproval(run.proposals[0].approvalId).status, 'denied');
  }
});

test('connector or model change after proposal invalidates exact continuation', async t => {
  for (const change of ['connector', 'model']) {
    let id;
    const { app } = await fixture(t, async () => answer({ done: false, content: 'Review operation', action: createAction(id) }));
    id = (await connector(app)).id; const { run } = await task(app, app.capabilities.getConnector(id));
    await approve(app, run);
    if (change === 'connector') await app.capabilities.updateConnector(id, { name: 'Changed' });
    else await app.runtime.updateSettings({ model: 'deepseek-v4-pro' });
    await assert.rejects(app.runtime.resumeRun(run.id), { code: change === 'connector' ? 'CONNECTOR_SCOPE_CHANGED' : 'EXECUTION_SCOPE_CHANGED' });
    assert.equal(app.capabilities.listConnectorRuns().length, 0);
  }
});

test('concurrent resume calls cannot consume approval twice', async t => {
  let id;
  const { app } = await fixture(t, async (_input, count) => answer(count === 1 ? { done: false, content: 'Review operation', action: createAction(id) } : { done: true, content: 'Completed.' }));
  id = (await connector(app)).id; const { run } = await task(app, app.capabilities.getConnector(id)); await approve(app, run);
  const resumed = await Promise.allSettled([app.runtime.resumeRun(run.id, { requestId: 'one' }), app.runtime.resumeRun(run.id, { requestId: 'two' })]);
  assert.equal(resumed.filter(item => item.status === 'fulfilled').length, 1);
  await until(() => app.runtime.getRun(run.id).run.status === 'succeeded');
  assert.equal(app.capabilities.listConnectorRuns().length, 1);
});

test('adapter failure retains uncertain receipt and never retries or resumes model automatically', async t => {
  let id;
  const { app, requests } = await fixture(t, async () => answer({ done: false, content: 'Review operation', action: { connectorId: id, action: 'send', resource: 'fixture:only', payload: {} } }), { connectorAdapters: { fixture: { capabilities: ['send'], execute: async () => { throw new Error('PRIVATE_RAW_ERROR'); } } } });
  id = (await connector(app, 'fixture', ['send'])).id; const { run } = await task(app, app.capabilities.getConnector(id)); await approve(app, run);
  await app.runtime.resumeRun(run.id); await until(() => app.runtime.getRun(run.id).run.status === 'failed');
  assert.equal(requests.length, 1); assert.equal(app.capabilities.listConnectorRuns()[0].status, 'failed');
  assert.equal(app.runtime.getRun(run.id).run.proposals[0].receipt.status, 'failed');
  assert.doesNotMatch(JSON.stringify(app.runtime.bootstrap()), /PRIVATE_RAW_ERROR/);
});

test('schema rejects model-made approval and action/artifact conflicts', () => {
  for (const response of [
    { done: true, content: 'bad', action: createAction('id') },
    { done: false, content: 'bad', approved: true, action: createAction('id') },
    { done: false, content: 'bad', artifact: { filename: 'x.md', content: 'x' } },
    { done: true, content: 'bad', plan: [{ id: '1', title: 'x', status: 'completed' }, { id: '1', title: 'y', status: 'pending' }] },
  ]) assert.throws(() => parseWorkspaceResponse(JSON.stringify(response)), { code: 'INVALID_GOAL_RESPONSE' });
});

test('native resumed goal receives current selected references and action receipt in its latest user turn', async t => {
  const { createHarnessProvider } = await import('../server/harness-provider.mjs');
  const nativeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-native-bridge-'));
  const bin = path.join(nativeDirectory, 'fixture.mjs'), patch = path.join(nativeDirectory, 'reviewed.yml');
  await fs.writeFile(bin, '// inert constructor fixture, never launched'); await fs.writeFile(patch, '# inert reviewed fixture');
  t.after(() => fs.rm(nativeDirectory, { recursive: true, force: true }));
  const prompts = []; let id;
  const provider = createHarnessProvider({ apiKey: 'fixture-not-real-secret', dshBin: bin, profilePatch: patch, dshHome: nativeDirectory, workspaceDirectory: nativeDirectory, HarnessClass: class {
    async run(input, { sessionId }) {
      prompts.push(input);
      return { sessionId, finalResponse: JSON.stringify(prompts.length === 1 ? { done: false, content: 'Review exact local file write.', action: createAction(id) } : { done: true, content: 'Native continuation verified the application receipt.' }) };
    }
    async close() {}
  } });
  const { app } = await fixture(t, () => { throw new Error('Unused text provider'); }, { provider });
  id = (await connector(app)).id;
  const file = (await app.artifacts.create({ filename: 'source.txt', content: 'PINNED_SOURCE_REFERENCE_FOR_NATIVE' })).artifact;
  const { run } = await task(app, app.capabilities.getConnector(id), { inputContext: { artifacts: [{ id: file.id, version: 1 }], connectorActions: [{ connectorId: id, action: 'create_file' }] } });
  assert.equal(run.status, 'awaiting_approval'); await approve(app, run); await app.runtime.resumeRun(run.id);
  await until(() => app.runtime.getRun(run.id).run.status === 'succeeded');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Continue the existing native session/);
  assert.match(prompts[1], /PINNED_SOURCE_REFERENCE_FOR_NATIVE/);
  assert.match(prompts[1], /Verified application connector receipt/);
  assert.match(prompts[1], /"saved":true/);
  assert.match(prompts[1], /Step 2 of/);
  assert.doesNotMatch(prompts[1], /Review exact local file write\./);
});

test('new conversations opt into context explicitly while immutable selected file versions feed queued runs', async t => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const { app, requests } = await fixture(t, async (_input, number) => number === 1 ? hold : { content: 'Read the selected version.' }, { maxConcurrentRuns: 1 });
  await app.runtime.createMemory({ content: 'UNSELECTED_MEMORY_SHOULD_STAY_OUT' });
  const file = (await app.artifacts.create({ filename: 'source.txt', content: 'SELECTED_OLD_VERSION' })).artifact;
  const a = (await app.runtime.createConversation({})).conversation, b = (await app.runtime.createConversation({})).conversation;
  await app.runtime.sendMessage(a.id, { content: 'Hold' });
  const second = await app.runtime.sendMessage(b.id, { content: 'Summarize', queued: true, inputContext: { artifacts: [{ id: file.id, version: 1 }] } });
  await app.artifacts.update(file.id, { content: 'UNSELECTED_NEW_VERSION' });
  release({ content: 'First done' });
  await until(() => app.runtime.getRun(second.run.id).run.status === 'succeeded');
  assert.match(JSON.stringify(requests[1].messages), /SELECTED_OLD_VERSION/);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /UNSELECTED_NEW_VERSION|UNSELECTED_MEMORY_SHOULD_STAY_OUT/);
  assert.equal(app.runtime.getRun(second.run.id).run.inputContextSnapshot.artifacts[0].version, 1);
});

test('cancelling an executing action aborts it and cannot resume or resurrect a deleted conversation', async t => {
  let id, started = false, aborted = false;
  const { app, requests } = await fixture(t, async () => answer({ done: false, content: 'Review fixture action', action: { connectorId: id, action: 'send', resource: 'fixture:only', payload: {} } }), { connectorAdapters: { fixture: { capabilities: ['send'], execute: async ({ signal }) => { started = true; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted fixture')); }, { once: true })); } } } });
  id = (await connector(app, 'fixture', ['send'])).id; const { run } = await task(app, app.capabilities.getConnector(id)); await approve(app, run);
  await app.runtime.resumeRun(run.id); await until(() => started);
  await app.runtime.deleteConversation(run.conversationId); await until(() => aborted && app.capabilities.listConnectorRuns()[0].status === 'interrupted');
  await until(() => app.runtime.status().queue.active === 0);
  assert.equal(requests.length, 1);
  assert.equal(app.runtime.bootstrap().messages.filter(item => item.conversationId === run.conversationId).length, 0);
  assert.equal(app.runtime.getRun(run.id).run.proposals[0].receipt.status, 'interrupted');
});

test('pending approval survives restart without executing or replaying a model call', async t => {
  let id;
  const { app, requests, directory } = await fixture(t, async () => answer({ done: false, content: 'Review before restart', action: createAction(id) }));
  id = (await connector(app)).id; const { run } = await task(app, app.capabilities.getConnector(id));
  await app.close();
  let nextCalls = 0;
  const next = await createApp({ dataDirectory: directory, provider: { configured: true, complete: async () => { nextCalls++; return answer({ done: true, content: 'Confirmed after explicitly approved continuation.' }); } } });
  await next.listen(0); t.after(() => next.close());
  assert.equal(next.runtime.getRun(run.id).run.status, 'awaiting_approval');
  assert.equal(nextCalls, 0); assert.equal(requests.length, 1); assert.equal(next.artifacts.list().artifacts.length, 0);
  await approve(next, next.runtime.getRun(run.id).run); await next.runtime.resumeRun(run.id);
  await until(() => next.runtime.getRun(run.id).run.status === 'succeeded');
  assert.equal(nextCalls, 1); assert.equal(next.capabilities.listConnectorRuns().length, 1);
  await next.close();
});

test('draft goal follows current conversation selections at admission unless goal explicitly pins its own selection', async t => {
  const { app, requests } = await fixture(t, async () => answer({ done: true, content: 'Used the reviewed inputs.' }));
  const first = (await app.artifacts.create({ filename: 'first.txt', content: 'FIRST_SOURCE_FOR_EXPLICIT_GOAL' })).artifact;
  const second = (await app.artifacts.create({ filename: 'second.txt', content: 'SECOND_SOURCE_FOR_CONVERSATION' })).artifact;
  const implicit = (await app.runtime.createGoal({ title: 'Draft created before selection' })).goal;
  assert.equal(Object.hasOwn(implicit, 'inputContext'), false);
  await app.runtime.updateConversationInputContext(implicit.conversationId, { inputContext: { artifacts: [{ id: second.id, version: 1 }] } });
  const started = await app.runtime.updateGoal(implicit.id, { action: 'start' });
  await until(() => app.runtime.getRun(started.goal.runId).run.status === 'succeeded');
  assert.match(JSON.stringify(requests[0].messages), /SECOND_SOURCE_FOR_CONVERSATION/);
  const explicit = (await app.runtime.createGoal({ title: 'Goal pins its own source', inputContext: { artifacts: [{ id: first.id, version: 1 }] } })).goal;
  await app.runtime.updateConversationInputContext(explicit.conversationId, { inputContext: { artifacts: [{ id: second.id, version: 1 }] } });
  const pinned = await app.runtime.updateGoal(explicit.id, { action: 'start' });
  await until(() => app.runtime.getRun(pinned.goal.runId).run.status === 'succeeded');
  assert.match(JSON.stringify(requests[1].messages), /FIRST_SOURCE_FOR_EXPLICIT_GOAL/);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /SECOND_SOURCE_FOR_CONVERSATION/);
});
