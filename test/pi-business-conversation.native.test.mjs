// Actual official AgentSession/plugin + original HTTP/Runtime/Pi Durable.
// Frontend and backend model responses are finite, explicit, keyless faux fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { request } from './agent-service.helpers.mjs';
import { taskFixture, until, api, TOKEN_A, TOKEN_B } from './fixtures/pi-task-helpers.mjs';
import { syntheticFrontend, PUBLIC_PROCUREMENT, callBusinessTool, actualToolReceipt } from './fixtures/pi-workspace-agent-faux.mjs';

const recipient = { kind: 'pi-coding-agent', provider: 'workspace-agent-test-faux', model: 'workspace-agent-test', destination: 'faux://keyless-synthetic' };
const emptyContext = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const completeStage = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：本阶段仅整理明确提供的产品资料，未覆盖信息需逐项核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议核对原始材料并确认下一步。', sources: [] }],
  questions: [{ text: '是否可以补充原始报价与证据来源？', sources: [] }],
}), { stopReason: 'toolUse' });
const state = f => f.app.store.read();
const originalTask = (f, id) => state(f).workspaceAgentTasks.tasks.find(row => row.id === id);
const originalConversation = (f, id) => state(f).conversations.find(row => row.id === id);
const originalRun = (f, id) => state(f).runs.find(row => row.id === id);
const workspace = (f, route, body, subject = 'member-a') => f.workspace(route, { subject, ...(body === undefined ? {} : { body }) });

function clientFor(f, token, calls = []) {
  return createWorkspaceClient({ baseURL: f.baseURL, token, fetchImpl: async (url, options) => {
    const target = new URL(url).pathname + new URL(url).search;
    calls.push({ method: options.method, target });
    const response = await request(f.baseURL, target, { method: options.method, rawBody: options.body,
      headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } });
}
async function fixture(t, { frontendResponses = [], backendResponses = [], directory, clientToken = TOKEN_A, clientOverride, frontendFor, listenPort = 0, recipientOverride = recipient } = {}) {
  const frontend = await syntheticFrontend(frontendResponses), calls = [];
  let f;
  f = await taskFixture(t, { enterprise: true, directory, listenPort, responses: backendResponses, businessAgentOptions: { recipient: recipientOverride,
    resolveBinding: async ({ conversation }) => {
      const selected = frontendFor?.(conversation.id) || frontend;
      return { client: clientOverride || clientFor(f, clientToken, calls), modelRuntime: selected.modelRuntime, model: selected.model };
    } } });
  return Object.assign(f, { frontend, calls });
}
async function conversation(f, requestId, title = 'Public synthetic business conversation') {
  const response = await workspace(f, '/api/conversations', { title, requestId, inputContext: emptyContext() });
  assert.equal(response.status, 201, response.text); return response.json.conversation.id;
}
async function send(f, conversationId, requestId, content, execute = true) {
  const response = await workspace(f, `/api/conversations/${conversationId}/messages`, {
    content, requestId, workspaceExecution: execute, inputContext: emptyContext(),
  });
  assert.equal(response.status, 202, response.text); return response.json;
}
async function terminalRun(f, runId) {
  return until(() => { const run = originalRun(f, runId); return run && !['queued', 'running'].includes(run.status) && run; });
}
async function transcript(f, conversationId) {
  const mapping = originalConversation(f, conversationId).businessAgentSession;
  assert.ok(mapping?.agentSessionId && mapping.sessionFile);
  const text = await fs.readFile(mapping.sessionFile, 'utf8');
  assert.ok(!text.includes(TOKEN_A) && !text.includes(TOKEN_B), 'Original client credentials are not transcript content.');
  return { mapping, text, rows: text.trim().split('\n').map(line => JSON.parse(line)) };
}
const toolReceipt = (rows, name) => rows.filter(row => row.message?.role === 'toolResult' && row.message.toolName === name)
  .map(row => JSON.parse(row.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))).at(-1);

test('existing alpha ThreadHarness records are retained without adopting a second executor', async t => {
  const old = await taskFixture(t, { enterprise: true });
  const retained = { version: 1, turns: [{ id: 'synthetic-old-alpha-turn', status: 'interrupted' }], threads: [], sessions: [], messages: [], commands: [], graphs: [], events: [] };
  await old.app.store.update(state => { state.workspaceThreadHarness = retained; }); await old.app.close();
  await assert.rejects(() => fixture(t, { directory: old.directory }), /alpha ThreadHarness records are retained/);
  const inspection = await taskFixture(t, { directory: old.directory, enterprise: true });
  assert.deepEqual(state(inspection).workspaceThreadHarness, retained);
  assert.equal(inspection.faux.state.callCount, 0); assert.equal(state(inspection).runs.length, 0);
  await inspection.app.close();
});

test('an authenticated client for another application cannot dispatch there even with matching member/workspace labels', async t => {
  const foreign = await taskFixture(t, { enterprise: true });
  const f = await fixture(t, { clientOverride: clientFor(foreign, TOKEN_A), frontendResponses: [fauxAssistantMessage('Must not be called.')] });
  const id = await conversation(f, 'same-labels-instance-isolation');
  const response = await workspace(f, `/api/conversations/${id}/messages`, { content: 'Public synthetic input.', requestId: 'foreign-instance-message', workspaceExecution: true });
  assert.equal(response.status, 403); assert.equal(response.json.error.code, 'BUSINESS_AGENT_IDENTITY_CHANGED');
  assert.equal(f.frontend.faux.state.callCount, 0); assert.equal(f.faux.state.callCount, 0); assert.equal(foreign.faux.state.callCount, 0);
  assert.equal(state(f).runs.length, 0); assert.equal(state(f).workspaceAgentTasks.tasks.length, 0); assert.equal(state(foreign).workspaceAgentTasks.tasks.length, 0);
});

test('public composer dispatches the official business plugin into four original durable stages and exact original deliverables', async t => {
  const f = await fixture(t, { frontendResponses: [callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'conversation-procurement-one' }), actualToolReceipt],
    backendResponses: Array.from({ length: 4 }, completeStage) });
  const id = await conversation(f, 'business-conversation-one');
  const input = 'Prepare procurement documents for the explicitly supplied public synthetic cup, specification and quantity 10.';
  const admitted = await send(f, id, 'public-composer-one', input);
  assert.equal((await terminalRun(f, admitted.run.id)).status, 'succeeded');
  const run = originalRun(f, admitted.run.id);
  assert.ok(run.events.some(event => event.type === 'pi.tool.started' && event.toolName === 'workspace_business_task'));
  assert.ok(run.events.some(event => event.type === 'pi.tool.finished' && event.toolName === 'workspace_business_task'));
  assert.ok(run.events.every(event => !['arguments', 'result', 'content'].some(field => field in event)));
  assert.equal(run.executionRefs.length, 1);
  const taskId = run.executionRefs[0].taskId;
  await until(() => ['done', 'failed', 'interrupted'].includes(originalTask(f, taskId)?.status));
  assert.equal(originalTask(f, taskId).status, 'done', JSON.stringify(originalTask(f, taskId).result));
  const task = originalTask(f, taskId), reply = state(f).messages.find(row => row.id === run.assistantId);
  assert.equal(f.frontend.faux.state.callCount, 2); assert.equal(f.faux.state.callCount, 4);
  assert.equal(reply.runtime.execution, 'agent-session'); assert.equal(reply.runtime.originalRunId, run.id);
  assert.equal(reply.runtime.nativeTaskId, undefined); assert.equal(reply.providerResultAccounted, undefined);
  assert.equal(run.piNativeTaskId, undefined); assert.equal(run.reservedOutputTokens, 1600);
  assert.equal(state(f).runs.length, 5, 'Exactly one frontend run and four original stage runs.');
  assert.equal(state(f).messages.filter(row => row.conversationId === id).length, 2);
  assert.equal(state(f).workspaceThreadHarness, undefined);
  assert.equal(task.steps.filter(row => row.status === 'succeeded').length, 4);
  for (const step of task.steps) {
    const stageRun = originalRun(f, step.runId), stageReply = state(f).messages.find(row => row.id === stageRun.assistantId);
    assert.equal(stageRun.agentPresetContext.taskId, taskId); assert.equal(stageRun.status, 'succeeded');
    assert.equal(stageReply.runtime.execution, 'agent-prompt'); assert.ok(Number.isSafeInteger(stageReply.runtime.nativeTaskId));
  }
  assert.equal(task.result.completion, 'documents_ready'); assert.equal(task.result.businessGoalAchieved, false);
  assert.deepEqual(task.deliverables.map(row => row.name), ['inquiry-pack.md', 'comparison.md', 'procurement-brief.md']);
  const saved = await transcript(f, id);
  assert.equal(toolReceipt(saved.rows, 'workspace_business_task').task.taskId, taskId);
  assert.ok(f.calls.some(row => row.method === 'POST' && row.target === '/api/agent/v1/tasks'));
  const before = { backend: f.faux.state.callCount, frontend: f.frontend.faux.state.callCount, runs: state(f).runs.length };
  const results = await workspace(f, `/api/conversations/${id}/business-results`);
  assert.equal(results.status, 200, results.text); assert.equal(results.json.results.length, 1);
  const result = results.json.results[0];
  assert.equal(result.task.taskId, taskId); assert.equal(result.status, 'available');
  assert.deepEqual(results.json.executionRefs[0].stageRunIds, task.steps.map(row => row.runId));
  for (const document of result.artifacts) {
    assert.equal(document.status, 'available');
    assert.equal(createHash('sha256').update(document.content).digest('hex'), task.deliverables.find(row => row.name === document.name).sha256);
  }
  assert.equal(state(f).artifacts.length, 0, 'Task documents remain original task deliverables, without global Artifact copies.');
  assert.deepEqual({ backend: f.faux.state.callCount, frontend: f.frontend.faux.state.callCount, runs: state(f).runs.length }, before, 'Result read cannot execute or recover work.');
  const graph = await workspace(f, `/api/conversations/${id}/task-graph`); assert.equal(graph.status, 200); assert.equal(graph.json.taskGraph, null);
  const bootstrap = await workspace(f, '/api/bootstrap'); assert.equal(bootstrap.status, 200);
  assert.ok(bootstrap.json.conversations.some(row => row.id === id), 'Owned conversation remains in original bootstrap.');
  assert.ok(!JSON.stringify(bootstrap.json).includes('sessionFile'), 'Private SDK session paths do not cross HTTP projection.');
  const read = await workspace(f, `/api/conversations/${id}`); assert.equal(read.status, 200);
  const replay = await send(f, id, 'public-composer-one', input);
  assert.equal(replay.duplicate, true); assert.equal(replay.run.id, admitted.run.id);
  assert.equal(state(f).workspaceAgentTasks.tasks.length, 1); assert.equal(state(f).runs.length, before.runs);
  const conflict = await workspace(f, `/api/conversations/${id}/messages`, { content: 'Changed input.', requestId: 'public-composer-one', workspaceExecution: true, inputContext: emptyContext() });
  assert.equal(conflict.status, 409);
  f.frontend.faux.appendResponses([callBusinessTool('workspace_business_result', { taskId }), context => {
    const last = context.messages.at(-1); assert.equal(last.role, 'toolResult');
    const result = JSON.parse(last.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
    assert.equal(result.task.taskId, taskId); assert.equal(result.status, 'available');
    return fauxAssistantMessage('The original task has three saved documents available for human review.');
  }]);
  const reread = await send(f, id, 'public-composer-results', 'Read my actual saved task documents.', false);
  assert.equal((await terminalRun(f, reread.run.id)).status, 'succeeded');
  assert.equal((await transcript(f, id)).mapping.agentSessionId, saved.mapping.agentSessionId);
  assert.equal(toolReceipt((await transcript(f, id)).rows, 'workspace_business_result').task.taskId, taskId);
  assert.equal(f.faux.state.callCount, 4); assert.equal(state(f).workspaceAgentTasks.tasks.length, 1);
  if (process.env.PI_BUSINESS_CONVERSATION_EVIDENCE_FILE) {
    const filename = process.env.PI_BUSINESS_CONVERSATION_EVIDENCE_FILE;
    assert.ok(filename.startsWith('/tmp/'));
    await fs.writeFile(filename, JSON.stringify({ publicInput: 'Explicit public synthetic cup/specification/quantity10; no market research',
      conversationId: id, frontendRunId: run.id, taskId, agentSessionId: saved.mapping.agentSessionId,
      originalStages: task.steps.map(step => ({ key: step.key, runId: step.runId,
        nativeTaskId: state(f).messages.find(row => row.id === originalRun(f, step.runId).assistantId).runtime.nativeTaskId })),
      documents: task.deliverables.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
      resultRead: { api: `/api/conversations/${id}/business-results`, documentsVerifiedAgainstOriginal: true, extraModelCalls: 0 },
      completed: task.result.completion, businessGoalAchieved: task.result.businessGoalAchieved, globalArtifactCopies: state(f).artifacts.length,
      workspaceThreadHarnessPresent: false, frontendModelCalls: f.frontend.faux.state.callCount, backendModelCalls: f.faux.state.callCount,
      modelTransport: 'explicit finite keyless faux', liveModelCalls: 0 }, null, 2) + '\n', { mode: 0o600 });
  }
  t.diagnostic('Verified public composer -> official AgentSession/plugin -> original HTTP task -> four original Pi Durable stage runs -> three hash-matching original documents; no live model or business achievement claimed.');
});

test('two original conversations keep distinct official transcripts and reopen only their own context', async t => {
  const a = await syntheticFrontend([fauxAssistantMessage('A public synthetic answer.')]);
  const b = await syntheticFrontend([fauxAssistantMessage('B public synthetic answer.')]);
  const selected = new Map();
  const f = await fixture(t, { frontendFor: id => selected.get(id) });
  const first = await conversation(f, 'isolated-context-a', 'A'), second = await conversation(f, 'isolated-context-b', 'B');
  selected.set(first, a); selected.set(second, b);
  const runs = await Promise.all([send(f, first, 'isolated-message-a', 'A_PUBLIC_CONTEXT_SENTINEL', false), send(f, second, 'isolated-message-b', 'B_PUBLIC_CONTEXT_SENTINEL', false)]);
  assert.ok((await Promise.all(runs.map(row => terminalRun(f, row.run.id)))).every(row => row.status === 'succeeded'));
  const savedA = await transcript(f, first), savedB = await transcript(f, second);
  assert.notEqual(savedA.mapping.agentSessionId, savedB.mapping.agentSessionId); assert.notEqual(savedA.mapping.sessionFile, savedB.mapping.sessionFile);
  assert.match(savedA.text, /A_PUBLIC_CONTEXT_SENTINEL/); assert.doesNotMatch(savedA.text, /B_PUBLIC_CONTEXT_SENTINEL/);
  assert.match(savedB.text, /B_PUBLIC_CONTEXT_SENTINEL/); assert.doesNotMatch(savedB.text, /A_PUBLIC_CONTEXT_SENTINEL/);
  a.faux.appendResponses([context => { const messages = JSON.stringify(context.messages); assert.match(messages, /A_PUBLIC_CONTEXT_SENTINEL/); assert.doesNotMatch(messages, /B_PUBLIC_CONTEXT_SENTINEL/); return fauxAssistantMessage('Same original A context reopened.'); }]);
  const reopened = await send(f, first, 'isolated-message-a-two', 'Read this conversation context.', false);
  assert.equal((await terminalRun(f, reopened.run.id)).status, 'succeeded');
  assert.equal((await transcript(f, first)).mapping.agentSessionId, savedA.mapping.agentSessionId);
  assert.equal((await transcript(f, second)).text, savedB.text);
  assert.equal(state(f).workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
});

test('a reopened host cannot send an existing official transcript to a changed model recipient with the same member/client binding', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-business-recipient-change-');
  let f, next;
  t.after(async () => { await next?.app.close(); await f?.app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  f = await fixture(t, { directory, frontendResponses: [fauxAssistantMessage('Original receiver public answer.')] });
  const id = await conversation(f, 'original-recipient-context');
  const sent = await send(f, id, 'original-recipient-message', 'PUBLIC_ORIGINAL_RECEIVER_SENTINEL', false);
  assert.equal((await terminalRun(f, sent.run.id)).status, 'succeeded');
  const saved = await transcript(f, id), originalOrigin = f.baseURL;
  assert.match(saved.mapping.recipientFingerprint, /^[a-f0-9]{64}$/);
  await f.app.close();
  const changedFrontend = await syntheticFrontend([fauxAssistantMessage('Must never receive the previous model transcript.')]);
  // An exact HTTPS tuple is supplied but is intentionally never registered for
  // transport: rejection must precede SDK creation, model lookup and dispatch.
  const changedModel = { ...changedFrontend.model, api: 'openai-completions', provider: 'public-synthetic-other-provider', id: 'public-synthetic-other-model', baseUrl: 'https://public-synthetic-model.example/v1' };
  let modelLookups = 0;
  changedFrontend.modelRuntime.getModel = () => { modelLookups += 1; throw new Error('Changed recipient must be rejected before official Session construction.'); };
  const changedRecipient = { kind: 'pi-coding-agent', provider: changedModel.provider, model: changedModel.id, destination: changedModel.baseUrl };
  next = await fixture(t, { directory, listenPort: Number(new URL(originalOrigin).port), recipientOverride: changedRecipient,
    frontendFor: () => ({ ...changedFrontend, model: changedModel }) });
  assert.equal(next.baseURL, originalOrigin);
  const denied = await workspace(next, `/api/conversations/${id}/messages`, { content: 'Continue the original conversation.', requestId: 'changed-recipient-message', workspaceExecution: false, inputContext: emptyContext() });
  assert.equal(denied.status, 403); assert.equal(denied.json.error.code, 'BUSINESS_AGENT_RECIPIENT_CHANGED');
  const read = await workspace(next, `/api/conversations/${id}/business-results`);
  assert.equal(read.status, 403); assert.equal(read.json.error.code, 'BUSINESS_AGENT_RECIPIENT_CHANGED');
  assert.equal(modelLookups, 0); assert.equal(changedFrontend.faux.state.callCount, 0); assert.equal(next.faux.state.callCount, 0);
  assert.equal(state(next).runs.length, 1); assert.equal(state(next).messages.filter(row => row.conversationId === id).length, 2);
  assert.deepEqual((await transcript(next, id)).mapping, saved.mapping); assert.equal((await transcript(next, id)).text, saved.text);
  assert.equal(state(next).workspaceAgentTasks.tasks.length, 0);
});

test('read-only intent, public input boundary and original member/client ownership cannot gain business execution', async t => {
  const f = await fixture(t, { frontendResponses: [callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'blocked-read-only-submit' }), actualToolReceipt] });
  const id = await conversation(f, 'read-only-business-context');
  const accepted = await send(f, id, 'read-only-message', 'Read public task capabilities.', false);
  assert.equal((await terminalRun(f, accepted.run.id)).status, 'succeeded');
  const saved = await transcript(f, id);
  const rejected = saved.rows.find(row => row.message?.role === 'toolResult' && row.message.toolName === 'workspace_business_task');
  assert.equal(rejected.message.isError, true); assert.match(JSON.stringify(rejected.message), /Read-only conversation input/);
  assert.equal(state(f).workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  const command = await workspace(f, `/api/conversations/${id}/messages`, { content: '/ws-business-cancel any-task', requestId: 'web-terminal-command', workspaceExecution: true });
  assert.equal(command.status, 400); assert.equal(f.frontend.faux.state.callCount, 2);
  for (const inputContext of [{ ...emptyContext(), memoryIds: ['public-selection-not-admitted'] }, { ...emptyContext(), connectorActions: [{ connectorId: 'not-admitted', action: 'write' }] }]) {
    const response = await workspace(f, `/api/conversations/${id}/messages`, { content: 'Public text.', requestId: 'nonempty-input', workspaceExecution: true, inputContext });
    assert.equal(response.status, 403); assert.equal(response.json.error.code, 'BUSINESS_AGENT_PUBLIC_INPUT_ONLY');
  }
  for (const route of [`/api/conversations/${id}`, `/api/conversations/${id}/business-results`, `/api/conversations/${id}/task-graph`])
    assert.equal((await workspace(f, route, undefined, 'member-b')).status, 404);
  assert.equal((await workspace(f, `/api/conversations/${id}/messages`, { content: 'Another member.', requestId: 'wrong-member', workspaceExecution: true }, 'member-b')).status, 404);
  const otherBootstrap = await workspace(f, '/api/bootstrap', undefined, 'member-b');
  assert.ok(!otherBootstrap.json.conversations.some(row => row.id === id));
  assert.equal(state(f).runs.length, 1);
  const wrongClient = await fixture(t, { clientToken: TOKEN_B });
  const wrongId = await conversation(wrongClient, 'wrong-client-context');
  const denied = await workspace(wrongClient, `/api/conversations/${wrongId}/messages`, { content: 'Public text.', requestId: 'wrong-client-message', workspaceExecution: true });
  assert.equal(denied.status, 403); assert.equal(denied.json.error.code, 'BUSINESS_AGENT_IDENTITY_CHANGED');
  assert.equal(state(wrongClient).runs.length, 0); assert.equal(wrongClient.frontend.faux.state.callCount, 0);
  const unboundClient = await fixture(t, { clientToken: 'public-synthetic-unbound-agent-client' });
  const unboundId = await conversation(unboundClient, 'unbound-client-context');
  const unauthorized = await workspace(unboundClient, `/api/conversations/${unboundId}/messages`, { content: 'Public text.', requestId: 'unbound-client-message', workspaceExecution: true });
  assert.equal(unauthorized.status, 403); assert.equal(unauthorized.json.error.code, 'BUSINESS_AGENT_BINDING_UNAVAILABLE');
  assert.equal(state(unboundClient).runs.length, 0); assert.equal(unboundClient.frontend.faux.state.callCount, 0);
});

test('original signed-body and revoked browser Session checks reject mutation or tool dispatch before business admission', async t => {
  let entered = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { frontendResponses: [async () => {
    entered = true; await gate;
    return callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'session-revoked-submit' });
  }, fauxAssistantMessage('Must not run after original Session revocation.')] });
  const id = await conversation(f, 'signed-body-context');
  let serialization = 0;
  const altered = await workspace(f, `/api/conversations/${id}/messages`, { toJSON() {
    return { content: ++serialization === 1 ? 'Signed public text.' : 'Altered public text.', requestId: 'signed-body-alteration', workspaceExecution: true, inputContext: emptyContext() };
  } });
  assert.equal(altered.status, 401); assert.equal(altered.json.error.code, 'ASSERTION_BODY_MISMATCH');
  assert.equal(state(f).runs.length, 0); assert.equal(f.frontend.faux.state.callCount, 0);
  const accepted = await send(f, id, 'revoked-session-message', 'Prepare the public supplied procurement documents.');
  await until(() => entered);
  assert.equal((await workspace(f, '/api/session/logout', {})).status, 200);
  release();
  assert.equal((await terminalRun(f, accepted.run.id)).status, 'failed');
  assert.equal(f.frontend.faux.state.callCount, 1); assert.equal(f.faux.state.callCount, 0);
  assert.equal(state(f).workspaceAgentTasks.tasks.length, 0);
  assert.equal((await workspace(f, `/api/conversations/${id}/business-results`)).status, 401);
});

test('original frontend reservation bounds four 400-token SDK requests and blocks a fifth without another task or queue', async t => {
  const observed = [], responses = Array.from({ length: 3 }, () => (_context, options) => { observed.push(options.maxTokens); return callBusinessTool('workspace_business_presets', {}); });
  responses.push((_context, options) => { observed.push(options.maxTokens); return fauxAssistantMessage('Four bounded native requests completed.'); });
  const f = await fixture(t, { frontendResponses: responses });
  const id = await conversation(f, 'four-request-context');
  const accepted = await send(f, id, 'four-request-message', 'Read public capabilities.', false);
  assert.equal((await terminalRun(f, accepted.run.id)).status, 'succeeded'); assert.deepEqual(observed, [400, 400, 400, 400]);
  assert.equal(originalRun(f, accepted.run.id).reservedOutputTokens, 1600);
  const fifth = await fixture(t, { frontendResponses: Array.from({ length: 6 }, () => callBusinessTool('workspace_business_presets', {})) });
  const fifthId = await conversation(fifth, 'five-request-context');
  const blocked = await send(fifth, fifthId, 'five-request-message', 'Read public capabilities.', false);
  assert.equal((await terminalRun(fifth, blocked.run.id)).status, 'failed'); assert.equal(fifth.frontend.faux.state.callCount, 4);
  assert.equal(originalRun(fifth, blocked.run.id).reservedOutputTokens, 1600);
  assert.equal(originalRun(fifth, blocked.run.id).outputTokens, 1600, 'Failed/uncertain frontend retains the original conservative reservation.');
  assert.equal(state(fifth).workspaceAgentTasks.tasks.length, 0); assert.equal(state(fifth).runs.length, 1);
});

test('stop-answer cancels only the original frontend run, preserves its SDK mapping and cannot recover it as a durable task', async t => {
  let frontendWaiting = false, backendAborted = false;
  const wait = marker => async (_context, options) => {
    marker(); await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  };
  const f = await fixture(t, { frontendResponses: [callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'cancel-admitted-business' }), wait(() => { frontendWaiting = true; })],
    backendResponses: [async (context, options) => { const value = await wait(() => {})(context, options); backendAborted = true; return value; }] });
  const id = await conversation(f, 'stop-answer-context');
  const accepted = await send(f, id, 'stop-answer-message', 'Prepare the public supplied procurement documents.');
  await until(() => frontendWaiting && originalRun(f, accepted.run.id)?.executionRefs?.length && f.faux.state.callCount === 1);
  const taskId = originalRun(f, accepted.run.id).executionRefs[0].taskId;
  const stopped = await workspace(f, `/api/conversations/${id}/cancel`, {});
  assert.equal(stopped.status, 200); assert.equal(stopped.json.backendTasksCancelled, false);
  assert.equal((await terminalRun(f, accepted.run.id)).status, 'cancelled');
  assert.equal(originalTask(f, taskId).status, 'running'); assert.equal(backendAborted, false);
  assert.equal(originalRun(f, originalTask(f, taskId).steps[0].runId).status, 'running');
  assert.ok(originalConversation(f, id).businessAgentSession?.agentSessionId, 'First interrupted SDK turn retains its exact context mapping.');
  for (const method of ['recoverPiRun', 'retryRun']) await assert.rejects(f.app.runtime[method](accepted.run.id, { requestId: 'no-frontend-replay' }), error => error.code === 'BUSINESS_AGENT_CHECKPOINT_UNAVAILABLE');
  const route = `/api/conversations/${id}/business-tasks/${taskId}/resume`;
  assert.equal((await workspace(f, route, { requestId: 'missing-confirmation' })).status, 400);
  assert.equal((await workspace(f, route, { requestId: 'wrong-owner-confirmation', confirmed: true }, 'member-b')).status, 404);
  assert.equal((await workspace(f, `/api/conversations/${id}/business-tasks/unrelated-task/resume`, { requestId: 'unrelated-task-resume', confirmed: true })).status, 404);
  assert.equal((await api(f, `/api/agent/v1/tasks/${taskId}/cancel`, {})).status, 200);
  await until(() => backendAborted);
  assert.equal(state(f).workspaceAgentTasks.tasks.length, 1); assert.equal(state(f).runs.length, 2);
});

test('confirmed original business resume after a real app restart reuses the interrupted durable stage and prior documents', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-business-conversation-restart-');
  let f, next;
  t.after(async () => { await next?.app.close(); await f?.app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const paused = async (_context, options) => { await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); };
  f = await fixture(t, { directory, frontendResponses: [callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'restart-admitted-business' }), actualToolReceipt],
    backendResponses: [completeStage(), completeStage(), paused] });
  const id = await conversation(f, 'restart-business-context');
  const admitted = await send(f, id, 'restart-business-message', 'Prepare public supplied procurement documents.');
  assert.equal((await terminalRun(f, admitted.run.id)).status, 'succeeded');
  const taskId = originalRun(f, admitted.run.id).executionRefs[0].taskId;
  await until(() => f.faux.state.callCount === 3 && originalTask(f, taskId)?.steps[2].runId || originalTask(f, taskId)?.status === 'failed');
  assert.notEqual(originalTask(f, taskId).status, 'failed', JSON.stringify(originalTask(f, taskId).result));
  const before = structuredClone(originalTask(f, taskId)), saved = await transcript(f, id), baseURL = f.baseURL;
  assert.equal(before.deliverables.length, 1); await f.app.close();
  next = await fixture(t, { directory, listenPort: Number(new URL(baseURL).port), backendResponses: [completeStage(), completeStage()] });
  await until(() => originalTask(next, taskId)?.status === 'interrupted');
  assert.equal(next.faux.state.callCount, 0); assert.equal(next.frontend.faux.state.callCount, 0);
  const partial = await workspace(next, `/api/conversations/${id}/business-results`); assert.equal(partial.status, 200, partial.text);
  assert.equal(partial.json.results[0].status, 'partial'); assert.equal(next.faux.state.callCount, 0);
  const route = `/api/conversations/${id}/business-tasks/${taskId}/resume`, body = { requestId: 'confirmed-original-resume', confirmed: true };
  assert.equal((await workspace(next, route, { requestId: body.requestId })).status, 400);
  const resumed = await Promise.all([workspace(next, route, body), workspace(next, route, body)]);
  assert.ok(resumed.every(response => response.status === 200), JSON.stringify(resumed.map(row => row.json)));
  await until(() => originalTask(next, taskId)?.status === 'done');
  const done = originalTask(next, taskId);
  assert.equal(done.steps[2].runId, before.steps[2].runId); assert.equal(done.steps[2].requestId, before.steps[2].requestId);
  assert.equal(done.deliverables[0].sha256, before.deliverables[0].sha256); assert.deepEqual(done.budget, before.budget);
  assert.equal(done.resumeRequests.length, 1); assert.equal(done.attempt, 2);
  assert.equal(next.faux.state.callCount, 2); assert.equal(next.frontend.faux.state.callCount, 0);
  assert.equal(state(next).runs.length, 5); assert.equal(state(next).workspaceAgentTasks.tasks.length, 1);
  assert.equal((await transcript(next, id)).mapping.agentSessionId, saved.mapping.agentSessionId);
  assert.equal((await workspace(next, route, body)).status, 200); assert.equal(next.faux.state.callCount, 2);
  const result = await workspace(next, `/api/conversations/${id}/business-results`);
  assert.equal(result.status, 200); assert.equal(result.json.results[0].status, 'available');
  assert.equal(result.json.results[0].task.result.businessGoalAchieved, false); assert.equal(state(next).artifacts.length, 0);
});
