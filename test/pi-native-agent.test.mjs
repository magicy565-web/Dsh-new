// Real pinned Pi Agent/Durable execution with an explicitly keyless faux model.
// These tests provide backend execution evidence, not real-model readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Agent } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { Harness, createRegistry, defineDoc, ProviderDoc } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider, PI_SOURCE, PI_VERSION } from '../server/pi-provider.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(5); } throw new Error('Native Agent fixture did not settle.'); }
async function fixture(t, responses = [], providerOptions = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-native-agent-');
  const faux = fauxProvider({ api: 'faux' }); faux.setResponses(responses);
  const models = createModels(); models.setProvider(faux.provider);
  const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1', ...providerOptions }) });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { app, faux, directory };
}
async function send(f, options = {}) {
  const conversation = (await f.app.runtime.createConversation({})).conversation;
  const sent = await f.app.runtime.sendMessage(conversation.id, { content: 'Original native input', requestId: 'native-original-request', ...options });
  await until(() => f.app.runtime.getRun(sent.run.id).run.status !== 'running');
  return { conversation, run: f.app.runtime.getRun(sent.run.id).run };
}

test('real Agent.prompt executes the native tool loop once and keeps source/hash, original identity and provider affinity', async t => {
  const originalPrompt = Agent.prototype.prompt;
  let prompts = 0;
  Agent.prototype.prompt = function (...args) { prompts++; return originalPrompt.apply(this, args); };
  t.after(() => { Agent.prototype.prompt = originalPrompt; });
  const f = await fixture(t);
  const artifact = (await f.app.artifacts.create({ filename: 'native-input.txt', content: 'Explicit original bytes', mimeType: 'text/plain' })).artifact;
  const sessions = [];
  f.faux.setResponses([
    (_request, options) => { sessions.push(options.sessionId); return fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: artifact.id }), { stopReason: 'toolUse' }); },
    (request, options) => {
      sessions.push(options.sessionId);
      const tool = request.messages.at(-1);
      assert.equal(tool.role, 'toolResult'); assert.equal(tool.isError, false);
      const selected = JSON.parse(tool.content[0].text);
      assert.equal(selected.id, artifact.id); assert.equal(selected.version, artifact.currentVersion); assert.equal(selected.sha256, artifact.sha256);
      assert.equal(selected.content, 'Explicit original bytes');
      return fauxAssistantMessage('Completed by actual Agent.prompt');
    },
  ]);
  const { run, conversation } = await send(f, { inputContext: { artifacts: [{ id: artifact.id, version: artifact.currentVersion }], skills: [], memoryIds: [], connectorActions: [] } });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); assert.equal(prompts, 1); assert.equal(f.faux.state.callCount, 2);
  assert.ok(run.piNativeTaskId); assert.equal(run.piSubmissionId, undefined);
  const reply = f.app.store.read().messages.find(message => message.id === run.assistantId);
  assert.deepEqual({ execution: reply.runtime.execution, source: reply.runtime.source, version: reply.runtime.version, nativeTaskId: reply.runtime.nativeTaskId, modelTurns: reply.runtime.modelTurns },
    { execution: 'agent-prompt', source: PI_SOURCE, version: PI_VERSION, nativeTaskId: run.piNativeTaskId, modelTurns: 2 });
  assert.match(reply.runtime.providerSessionId, /^[a-f0-9-]{36}$/); assert.deepEqual(sessions, [reply.runtime.providerSessionId, reply.runtime.providerSessionId]);
  const duplicate = await f.app.runtime.sendMessage(conversation.id, { content: 'Original native input', requestId: 'native-original-request', inputContext: { artifacts: [{ id: artifact.id, version: artifact.currentVersion }], skills: [], memoryIds: [], connectorActions: [] } });
  assert.equal(duplicate.run.id, run.id); assert.equal(duplicate.duplicate, true); assert.equal(prompts, 1);
  f.faux.setResponses([(_request, options) => { assert.equal(options.sessionId, sessions[0]); return fauxAssistantMessage('Same original Pi conversation'); }]);
  const follow = await f.app.runtime.sendMessage(conversation.id, { content: 'Next input', requestId: 'native-next-request' });
  await until(() => f.app.runtime.getRun(follow.run.id).run.status !== 'running');
  assert.equal(f.app.runtime.getRun(follow.run.id).run.status, 'succeeded');
});

test('native Agent completion ends structured chat and Goal without JSON nextStep driving another invocation', async t => {
  const f = await fixture(t, [request => {
    assert.ok(!JSON.stringify(request.messages).includes('Return JSON only'));
    return fauxAssistantMessage(JSON.stringify({ done: false, content: 'Native turn complete', nextStep: 'Do not launch an extra Workspace request' }));
  }]);
  const { run } = await send(f, { workspaceExecution: true });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); assert.equal(run.stepCount, 1); assert.equal(f.faux.state.callCount, 1);
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: false, content: 'Review native Goal output', nextStep: 'No automatic outer loop' }))]);
  const goal = (await f.app.runtime.createGoal({ title: 'Native reviewed Goal', maxSteps: 1 })).goal;
  const started = await f.app.runtime.updateGoal(goal.id, { action: 'start' });
  await until(() => f.app.runtime.getRun(started.goal.runId).run.status !== 'running');
  const saved = f.app.store.read().goals.find(value => value.id === goal.id);
  assert.equal(saved.status, 'review_required'); assert.equal(saved.stepCount, 1); assert.equal(f.faux.state.callCount, 2);
  assert.notEqual(saved.status, 'completed', 'A native text result does not certify a business Goal.');
});

test('native final JSON documents and optional artifact envelopes do not require the legacy scheduling schema', async t => {
  const document = JSON.stringify({ product: 'Selected product', questions: ['Confirm original source'], businessGoalAchieved: false });
  const f = await fixture(t, [fauxAssistantMessage(document)]);
  const { run } = await send(f, { workspaceExecution: true });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(f.app.store.read().messages.find(message => message.id === run.assistantId).content, document);
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: 'Native artifact for review', artifact: { filename: 'native-reviewed.txt', content: 'Original native deliverable' } }))]);
  const saved = await send(f, { workspaceExecution: true });
  assert.equal(saved.run.status, 'succeeded', JSON.stringify(saved.run.error)); assert.ok(saved.run.outputArtifactId);
});

test('native Agent fails confirmed model errors and enforces four durable requests without new model or tool permission', async t => {
  const f = await fixture(t, [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Fixture model failure' })]);
  const failed = await send(f);
  assert.equal(failed.run.status, 'failed'); assert.equal(failed.run.error.code, 'PI_MODEL_ERROR');
  f.faux.setResponses(Array.from({ length: 5 }, () => fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: 'unselected' }), { stopReason: 'toolUse' })));
  const bounded = await send(f, { workspaceExecution: true });
  assert.equal(bounded.run.status, 'failed'); assert.equal(bounded.run.error.code, 'TOKEN_BUDGET');
  assert.equal(f.faux.state.callCount, 5, 'One failed model request plus exactly four requests in the new invocation.');
  assert.equal(f.app.artifacts.list().artifacts.length, 0); assert.equal(f.app.capabilities.listApprovals().length, 0); assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
});

test('native Agent text cannot bypass the original exact-action approval tool', async t => {
  const f = await fixture(t, [fauxAssistantMessage(JSON.stringify({ done: false, content: 'Unauthorized text action', action: { connectorId: 'unselected', action: 'write', resource: 'anywhere', payload: {} } }))]);
  const { run } = await send(f, { workspaceExecution: true });
  assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'PI_TOOL_PERMISSION');
  assert.equal(f.app.capabilities.listApprovals().length, 0); assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
});

test('native host timeout aborts the actual model signal, fails its task and retains the unconfirmed request reservation', async t => {
  let aborted = false;
  const f = await fixture(t, [async (_request, options) => {
    assert.equal(options.timeoutMs, 30); assert.equal(options.maxRetries, 0);
    await new Promise(resolve => options.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }], { timeoutMs: 30 });
  const { run } = await send(f, { workspaceExecution: true });
  assert.equal(aborted, true); assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'TIMEOUT');
  assert.equal(run.outputTokens, 1600); assert.equal(f.faux.state.callCount, 1);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
});

test('actual SIGKILL after a completed owned ToolTask resumes Agent.prompt with the same receipt, identity and conservative uncertain budget', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-native-tool-kill-');
  const child = spawn(process.execPath, ['test/fixtures/pi-native-tool-crash-child.mjs', directory], { env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let stderr = '', app;
  child.stderr.on('data', data => { stderr += data; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; await app?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Native crash fixture stalled: ' + stderr)), 15000);
    child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0])); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Native crash child exited: ' + stderr)); });
  });
  child.kill('SIGKILL'); assert.equal((await exited)[1], 'SIGKILL');
  const location = path.join(directory, 'pi', createHash('sha256').update(ready.conversationId).digest('hex'));
  const RecordDoc = defineDoc({ kind: 'workspace.pi-invocations', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ records: {}, active: null }) });
  async function inspect() {
    const storage = await openNodeJsonlStorage(location, BACKGROUND_CONTEXT, { fsync: true });
    const harness = await Harness.open(storage, { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
    try {
      const root = await harness.root(BACKGROUND_CONTEXT);
      const doc = await harness.snapshot(RecordDoc, root.id, BACKGROUND_CONTEXT);
      const provider = await harness.snapshot(ProviderDoc, root.id, BACKGROUND_CONTEXT);
      const tools = await Promise.all(Object.values(doc.active.nativeTools).map(id => harness.getTask(id, BACKGROUND_CONTEXT)));
      return { doc, provider, tools };
    } finally { await harness.close(BACKGROUND_CONTEXT); }
  }
  const before = await inspect();
  assert.equal(before.doc.active.requests.length, 2); assert.equal(before.doc.active.requests[1].usage, null);
  assert.ok(before.doc.active.requests[0].usage?.completionTokens > 0, 'The explicitly pinned faux transport must durably settle its first confirmed counter.');
  assert.equal(before.tools.length, 1); assert.equal(before.tools[0].kind, 'pi.tool'); assert.equal(before.tools[0].state.outcome.status, 'completed');
  assert.equal(before.tools[0].owner, ready.nativeTaskId);
  const originalReceipt = before.tools[0].state.outcome.result.entryId;
  const faux = fauxProvider({ api: 'faux' }), models = createModels(); models.setProvider(faux.provider);
  const consumed = before.doc.active.requests[0].usage.completionTokens + ready.interruptedCeiling;
  faux.setResponses([(request, options) => {
    assert.equal(options.sessionId, ready.sessionId); assert.equal(options.maxTokens, Math.floor((1600 - consumed) / 2));
    assert.equal(request.messages.at(-1).role, 'toolResult'); assert.equal(request.messages.at(-1).toolCallId, 'original-selected-read-call');
    assert.deepEqual(JSON.parse(request.messages.at(-1).content[0].text), ready.selected);
    return fauxAssistantMessage(JSON.stringify({ done: false, content: 'Native recovered original tool receipt', nextStep: 'No outer retry' }));
  }]);
  app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
  assert.equal(app.runtime.getRun(ready.runId).run.status, 'interrupted'); assert.equal(faux.state.callCount, 0);
  await app.runtime.recoverPiRun(ready.runId, { requestId: 'recover-original-owned-tool' });
  await until(() => app.runtime.getRun(ready.runId).run.status !== 'running');
  const afterRun = app.runtime.getRun(ready.runId).run;
  assert.equal(afterRun.status, 'succeeded', JSON.stringify(afterRun.error)); assert.equal(faux.state.callCount, 1);
  assert.equal(afterRun.piNativeTaskId, ready.nativeTaskId); assert.equal(afterRun.piRequestId, ready.requestId); assert.equal(afterRun.assistantId, ready.replyId);
  assert.equal(afterRun.piSubmissionId, undefined); assert.equal(afterRun.usage.completionTokens, null); assert.equal(afterRun.outputTokens, 1600);
  assert.equal(app.runtime.listRuns().runs.length, 1); assert.equal(app.store.read().messages.filter(message => message.role === 'user').length, 1);
  await app.close(); app = null;
  const after = await inspect();
  assert.equal(after.provider.sessionId, before.provider.sessionId); assert.equal(after.tools.length, 1);
  assert.equal(after.tools[0].id, before.tools[0].id); assert.equal(after.tools[0].state.outcome.result.entryId, originalReceipt, 'Completed ToolTask was not rerun.');
  assert.equal(after.doc.active.requests.length, 3); assert.equal(after.doc.active.requests[1].usage, null);
});

test('actual pre-upgrade Harness submission recovers through its legacy path without relabeling its identity or issuing a model request', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-legacy-upgrade-kill-');
  const child = spawn(process.execPath, ['test/fixtures/pi-legacy-crash-child.mjs', directory], { env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let stderr = '', app;
  child.stderr.on('data', data => { stderr += data; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; await app?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Legacy crash fixture stalled: ' + stderr)), 15000);
    child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0])); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Legacy crash child exited: ' + stderr)); });
  });
  child.kill('SIGKILL'); assert.equal((await exited)[1], 'SIGKILL');
  const faux = fauxProvider({ api: 'faux' }), models = createModels(); models.setProvider(faux.provider);
  app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
  assert.equal(app.runtime.getRun(ready.runId).run.status, 'interrupted');
  await app.runtime.recoverPiRun(ready.runId, { requestId: 'explicit-legacy-upgrade-recovery' });
  await until(() => app.runtime.getRun(ready.runId).run.status !== 'running');
  const run = app.runtime.getRun(ready.runId).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); assert.equal(run.piSubmissionId, ready.submissionId); assert.equal(run.piNativeTaskId, undefined);
  assert.equal(run.assistantId, ready.replyId); assert.equal(faux.state.callCount, 0);
  const reply = app.store.read().messages.find(message => message.id === ready.replyId);
  assert.equal(reply.content, 'Real legacy submission answer'); assert.equal(reply.runtime.execution, 'legacy-submission');
  assert.equal(reply.runtime.submissionId, ready.submissionId); assert.equal(reply.runtime.nativeTaskId, undefined);
});

test('actual SIGKILL after native accounting reuses the same pending chat/Goal reply with one step and one usage charge, including exhausted reservations', async t => {
  for (const mode of ['chat', 'goal', 'chat-unknown', 'goal-unknown']) {
    const directory = await fs.mkdtemp('/tmp/workspace-accounted-native-kill-');
    const child = spawn(process.execPath, ['test/fixtures/pi-accounted-crash-child.mjs', directory, mode], { env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let stderr = '', app;
    child.stderr.on('data', data => { stderr += data; });
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; await app?.close(); await fs.rm(directory, { recursive: true, force: true }); });
    const ready = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Accounting crash fixture stalled (' + mode + '): ' + stderr)), 15000);
      child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0])); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Accounting crash child exited: ' + stderr)); });
    });
    child.kill('SIGKILL'); assert.equal((await exited)[1], 'SIGKILL');
    assert.equal(ready.stepCount, 1);
    if (mode.endsWith('-unknown')) {
      assert.equal(ready.outputTokens, 1600); assert.equal(ready.usage.completionTokens, null);
    } else {
      assert.ok(ready.usage.completionTokens > 0, 'Measured fixtures must carry confirmed faux counters before the accounting crash.');
      assert.equal(ready.outputTokens, ready.usage.completionTokens);
    }
    const faux = fauxProvider(mode.endsWith('-unknown') ? { api: 'faux-unknown-wire' } : { api: 'faux' }), models = createModels(); models.setProvider(faux.provider);
    app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
    const before = app.runtime.getRun(ready.runId).run;
    assert.equal(before.status, 'interrupted'); assert.equal(before.piNativeTaskId, ready.nativeTaskId);
    await app.runtime.recoverPiRun(ready.runId, { requestId: 'recover-accounted-original-' + mode });
    await until(() => app.runtime.getRun(ready.runId).run.status !== 'running');
    const run = app.runtime.getRun(ready.runId).run;
    assert.equal(run.status, 'succeeded', JSON.stringify({ mode, error: run.error })); assert.equal(run.piNativeTaskId, ready.nativeTaskId); assert.equal(run.assistantId, ready.replyId);
    assert.deepEqual(run.usage, ready.usage); assert.equal(faux.state.callCount, 0); assert.equal(app.runtime.listRuns().runs.length, 1);
    const reply = app.store.read().messages.find(message => message.id === ready.replyId);
    assert.equal(reply.status, 'complete'); assert.equal(reply.providerResultAccounted, ready.nativeTaskId); assert.equal(reply.reservedOutputTokens, ready.reservedOutputTokens);
    assert.equal(app.store.read().messages.filter(message => message.role === 'assistant').length, 1);
    if (ready.goalId) {
      const goal = app.store.read().goals.find(value => value.id === ready.goalId);
      assert.equal(goal.stepCount, 1); assert.equal(goal.outputTokens, ready.outputTokens); assert.equal(goal.status, 'review_required');
    } else {
      assert.equal(run.stepCount, 1); assert.equal(run.outputTokens, ready.outputTokens); assert.equal(run.agentPresetResult.businessGoalAchieved, false);
    }
    await app.close(); app = null;
  }
});
