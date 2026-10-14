import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { createWorkspaceTuiRuntime } from '../scripts/pi-workspace-tui.mjs';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { taskFixture, until, TOKEN_A, TOKEN_B } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';

const publicTask = (requestId = 'public-procurement') => ({ type: 'procurement', title: '公开合成采购文书', input: { product: '公开合成杯子', spec: '公开规格', quantity: 10 }, requestId });
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '资料缺口需逐项核对。', sources: ['input.product'] }], recommendations: [{ text: '建议确认原材料。', sources: [] }], questions: [{ text: '是否补充原始证据？', sources: [] }],
}), { stopReason: 'toolUse' });
const original = (f, id) => f.app.store.read().workspaceAgentTasks.tasks.find(task => task.id === id);
async function finished(f, id) { await until(() => ['done', 'failed', 'interrupted'].includes(original(f, id)?.status)); }
function client(f, token = f.token) {
  return createWorkspaceClient({ baseURL: f.baseURL, token, ...(f.enterprise ? { fetchImpl: async (url, options) => {
    // Same original loopback HTTP ingress fixture as the enterprise suite;
    // Node fetch intentionally does not override Host from request headers.
    const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body,
      headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } } : {}) });
}

test('business adapter executes four original procurement Pi stages, stable replay, actual events and authenticated document bytes', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const c = client(f);
  const presets = await c.businessPresets(); assert.deepEqual(presets.map(row => row.id).sort(), ['factory-export', 'opportunity-discovery', 'procurement', 'supplier-sourcing']);
  const [a, b] = await Promise.all([c.businessSubmit(publicTask()), c.businessSubmit(publicTask())]);
  assert.equal(a.task.taskId, b.task.taskId); assert.equal(a.profile, 'business-preset'); assert.equal(a.delegatedExecution, false);
  const id = a.task.taskId; await finished(f, id); const receipt = await c.businessStatus(id);
  assert.equal(receipt.task.status, 'done'); assert.equal(receipt.task.result.completion, 'documents_ready'); assert.equal(receipt.task.result.businessGoalAchieved, false);
  assert.equal(receipt.task.result.evidenceStatus, 'user_supplied_only'); assert.equal(f.faux.state.callCount, 4);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.app.store.read().runs.length, 4);
  assert.equal(receipt.events.filter(event => event.kind === 'stage').length, 4); assert.equal(receipt.events.at(-1).kind, 'done');
  assert.deepEqual(receipt.artifacts.map(row => row.name), ['inquiry-pack.md', 'comparison.md', 'procurement-brief.md']);
  for (const artifact of receipt.artifacts) {
    assert.equal(artifact.status, 'available'); const saved = original(f, id).deliverables.find(row => row.name === artifact.name);
    assert.equal(createHash('sha256').update(artifact.content).digest('hex'), saved.sha256);
    assert.match(artifact.content, /未独立核验|未经独立核验/); assert.match(artifact.content, /待确认|待回收/);
  }
  for (const run of f.app.store.read().runs) { assert.equal(run.agentTaskId, id); assert.equal(run.piTaskContext, undefined); assert.equal(run.agentPresetResult.businessGoalAchieved, false); }
  await assert.rejects(c.businessSubmit({ ...publicTask(), title: 'Changed public title' }), /HTTP 409/);
  assert.equal(f.faux.state.callCount, 4);
  // A generic run identity cannot select a business task or vice versa.
  await assert.rejects(c.status(id), /HTTP 404/);
  await assert.rejects(c.businessStatus(receipt.task.workspace.runIds[0]), /HTTP 404/);
});

test('business input rejects host authority, file/model/budget selectors and credentials before admission', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const c = client(f);
  const valid = publicTask();
  for (const value of [{ ...valid, agentPresetContext: {} }, { ...valid, tools: [] }, { ...valid, delegation: true }, { ...valid, requestId: undefined },
    { ...valid, input: { ...valid.input, file: '/tmp/private' } }, { ...valid, input: { ...valid.input, quotes: [{ artifactId: 'private' }] } },
    { ...valid, input: { ...valid.input, quotes: [{ model: 'arbitrary', budget: 999 }] } }, { ...valid, input: { ...valid.input, requirements: 'password=synthetic-never-real-value' } },
    { ...valid, type: 'unknown' }]) await assert.rejects(c.businessSubmit(value));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.faux.state.callCount, 0);
  await assert.rejects(c.businessSubmit({ ...valid, input: { ...valid.input, quantity: 0 } }), /HTTP 400/);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});

test('research presets remain visibly blocked without configured search and preserve available partial documents', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const c = client(f);
  for (const type of ['opportunity-discovery', 'supplier-sourcing']) {
    const submitted = await c.businessSubmit({ type, title: '公开研究缺口', input: type === 'opportunity-discovery' ? { product: '公开杯子', market: '公开市场' } : { product: '公开杯子', spec: '公开规格' }, requestId: type });
    await finished(f, submitted.task.taskId); const receipt = await c.businessStatus(submitted.task.taskId);
    assert.equal(receipt.task.status, 'failed'); assert.equal(receipt.task.result.reason, 'AGENT_REQUIRED_CAPABILITY_MISSING');
    assert.equal(receipt.task.result.businessGoalAchieved, false); assert.equal(receipt.task.result.completion, 'incomplete'); assert.equal(receipt.events.at(-1).kind, 'error');
    assert.ok(receipt.artifacts.some(row => row.status === 'available' && row.content.includes('部分交付')));
    assert.ok(!receipt.artifacts.some(row => /^(suppliers|opportunity-report)\.md$/.test(row.name)));
  }
  assert.equal(f.faux.state.callCount, 1, 'Only supplier requirements ran; no research transport was created');
});

test('business artifact reads tolerate one original failure and cannot follow metadata URLs or arbitrary names', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const c = client(f);
  const submitted = await c.businessSubmit(publicTask('partial-read')); await finished(f, submitted.task.taskId);
  const requested = [];
  const partial = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: async (url, options) => {
    requested.push(url); if (url.endsWith('/artifacts/comparison.md')) return Response.json({ error: 'Synthetic unavailable text' }, { status: 404 });
    return fetch(url, options);
  } });
  const receipt = await partial.businessStatus(submitted.task.taskId);
  assert.equal(receipt.artifacts.filter(row => row.status === 'available').length, 2); assert.equal(receipt.artifacts.find(row => row.name === 'comparison.md').status, 'unavailable');
  assert.ok(requested.every(url => new URL(url).origin === f.baseURL));
  const bad = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: async (url, options) => {
    if (url.endsWith('/tasks/' + submitted.task.taskId)) { const response = await fetch(url, options); const value = await response.json(); value.artifacts.push({ name: '../../private.md', bytes: 1, url: 'https://arbitrary.example/private' }); return Response.json(value); }
    return fetch(url, options);
  } });
  assert.equal((await bad.businessStatus(submitted.task.taskId)).artifacts.at(-1).status, 'blocked');
  const mismatch = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: async (url, options) => {
    if (url.endsWith('/tasks/' + submitted.task.taskId)) { const response = await fetch(url, options); const value = await response.json(); value.artifacts[0].bytes = 1; return Response.json(value); }
    return fetch(url, options);
  } });
  const bounded = await mismatch.businessStatus(submitted.task.taskId);
  assert.equal(bounded.artifacts[0].status, 'unavailable'); assert.equal(bounded.artifacts[0].content, undefined);
  assert.equal(bounded.artifacts.filter(row => row.status === 'available').length, 2);
});

test('original enterprise task ownership, submit scope and expired binding refuse business reads and continuation', async t => {
  const f = await taskFixture(t, { enterprise: true, responses: [complete(), complete(), complete(), complete()] }); const a = client(f, TOKEN_A), b = client(f, TOKEN_B);
  const submitted = await a.businessSubmit(publicTask('member-business')); await finished(f, submitted.task.taskId);
  await assert.rejects(b.businessStatus(submitted.task.taskId), /HTTP 404/); await assert.rejects(b.businessResume(submitted.task.taskId), /HTTP 404/);
  let clock = Date.parse('2026-10-13T19:00:00.000Z');
  const readOnly = await taskFixture(t, { enterprise: true, accessClock: () => clock, principals: [{ subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: createHash('sha256').update(TOKEN_A).digest('hex'), scopes: ['agent:read'], expiresAt: '2026-10-13T19:01:00.000Z' }] });
  const limited = client(readOnly, TOKEN_A); assert.equal((await limited.businessPresets()).length, 4);
  await assert.rejects(limited.businessSubmit(publicTask('read-only')), /HTTP 403/);
  assert.equal(readOnly.app.store.read().workspaceAgentTasks.tasks.length, 0); clock += 120_000;
  await assert.rejects(limited.businessPresets(), /HTTP 401|HTTP 403/); assert.equal(readOnly.faux.state.callCount, 0);
});

test('official frontend Agent dispatches a registered business tool to original HTTP and reads the actual task receipt', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const directory = await fs.mkdtemp('/tmp/workspace-pi-business-sdk-');
  const { runtime, faux } = await createWorkspaceTuiRuntime({ client: client(f), isolationDirectory: directory, sample: true });
  t.after(async () => { await runtime.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  await runtime.session.bindExtensions({}); await runtime.session.prompt('PUBLIC_BUSINESS_FIXTURE ' + JSON.stringify(publicTask('native-business-tool')));
  assert.equal(faux.state.callCount, 2); const task = f.app.store.read().workspaceAgentTasks.tasks[0]; assert.ok(task); await finished(f, task.id);
  assert.equal(original(f, task.id).status, 'done'); assert.equal(f.faux.state.callCount, 4);
  const transcript = runtime.session.agent.state.messages;
  assert.ok(transcript.some(row => row.role === 'assistant' && row.content.some(block => block.type === 'toolCall' && block.name === 'workspace_business_task')));
  assert.match(JSON.stringify(transcript.at(-1)), new RegExp(task.id));
  assert.match(JSON.stringify(transcript.at(-1)), /\/ws-business-status TASK_ID/);
  assert.doesNotMatch(JSON.stringify(transcript.at(-1)), /\/ws-status RUN_ID/);
  assert.equal(runtime.session.getActiveToolNames().some(name => /resume|approve|continue/.test(name)), false);
});
