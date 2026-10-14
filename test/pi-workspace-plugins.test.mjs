// Official Pi AgentSession, original HTTP and Store; finite explicit faux models only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { taskFixture, until, TOKEN_A, TOKEN_B } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { PUBLIC_PROCUREMENT, syntheticFrontend, callBusinessTool, actualToolReceipt } from './fixtures/pi-workspace-agent-faux.mjs';

const TOOLS = ['workspace_business_presets', 'workspace_business_task', 'workspace_business_status',
  'workspace_company_profile', 'workspace_products', 'workspace_product', 'workspace_business_tasks', 'workspace_business_result'];
const PRIVATE_SENTINEL = 'PRIVATE_ENTERPRISE_LIBRARY_MUST_NEVER_REACH_MODEL_20261014';
const results = runtime => runtime.session.agent.state.messages.filter(row => row.role === 'toolResult');
const textOf = row => row.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
const receipt = runtime => JSON.parse(textOf(results(runtime).at(-1)));
const stored = (f, id) => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === id);
async function finished(f, id) { await until(() => ['done', 'failed', 'interrupted'].includes(stored(f, id)?.status)); }
async function directory(t) { const dir = await fs.mkdtemp('/tmp/workspace-pi-plugins-'); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
async function seedPrivateLibrary(f) {
  const actor = { subject: 'synthetic-owner', role: 'admin' };
  const company = f.app.businessLibrary.getCompany().company;
  await f.app.businessLibrary.updateCompany({ requestId: randomUUID(), expectedRevision: company.revision,
    changes: { legalName: PRIVATE_SENTINEL, description: PRIVATE_SENTINEL } }, actor);
  return (await f.app.businessLibrary.createProduct({ requestId: randomUUID(), name: PRIVATE_SENTINEL, description: PRIVATE_SENTINEL }, actor)).product;
}
function tracedClient(f, token = f.token, calls = []) {
  return createWorkspaceClient({ baseURL: f.baseURL, token, fetchImpl: async (url, options) => {
    const route = new URL(url).pathname + new URL(url).search; calls.push({ method: options.method, route });
    if (!f.enterprise) return fetch(url, options);
    const response = await request(f.baseURL, route, { method: options.method, rawBody: options.body,
      headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } });
}
async function agent(t, client, responses, extra = {}) {
  const isolationDirectory = extra.isolationDirectory || await directory(t);
  const frontend = await syntheticFrontend(responses);
  const created = await createWorkspaceAgentRuntime({ client, isolationDirectory, ...frontend, ...extra });
  t.after(() => created.runtime.dispose()); await created.runtime.session.bindExtensions({});
  return { ...created, ...frontend, isolationDirectory };
}
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：本阶段仅整理明确提供的产品资料，未覆盖信息需逐项核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议核对原始材料并确认下一步。', sources: [] }],
  questions: [{ text: '是否可以补充原始报价与证据来源？', sources: [] }],
}), { stopReason: 'toolUse' });

test('official built-in plugins answer product questions with default unconfigured library and task/result questions with original records', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const product = await seedPrivateLibrary(f), calls = [], client = tracedClient(f, f.token, calls);
  const submitted = await client.businessSubmit({ ...PUBLIC_PROCUREMENT, requestId: 'plugins-original-public-task' });
  const id = submitted.task.taskId; await finished(f, id);
  const contexts = [];
  const tracked = response => context => { contexts.push(JSON.stringify(context)); return typeof response === 'function' ? response(context) : response; };
  const a = await agent(t, client, [callBusinessTool('workspace_products', {}), actualToolReceipt,
    callBusinessTool('workspace_product', { productId: product.id }), actualToolReceipt,
    callBusinessTool('workspace_business_tasks', { limit: 5, status: 'done' }), actualToolReceipt,
    callBusinessTool('workspace_business_result', {}), actualToolReceipt,
    callBusinessTool('workspace_company_profile', {}), actualToolReceipt].map(tracked));
  assert.deepEqual(a.runtime.session.getActiveToolNames().sort(), [...TOOLS].sort());
  for (const question of ['有哪些产品？', `产品 ${product.id} 的详情是什么？`]) {
    await a.runtime.session.prompt(question);
    assert.equal(receipt(a.runtime).status, 'unconfigured');
    assert.equal(receipt(a.runtime).reason, 'LIBRARY_SESSION_READ_UNCONFIGURED');
    assert.deepEqual(receipt(a.runtime).sources, []);
  }
  await a.runtime.session.prompt('任务进度如何？请查我已经完成的任务。');
  const listed = receipt(a.runtime); assert.equal(listed.status, 'available'); assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].taskId, id); assert.equal(listed.tasks[0].status, 'done');
  assert.equal(listed.tasks[0].input, undefined); assert.equal(listed.tasks[0].artifacts, undefined);
  assert.ok(JSON.stringify(listed.sources).includes(id));
  await a.runtime.session.prompt('上次成果是什么？请读取已保存的原成果。');
  const value = receipt(a.runtime); assert.equal(value.task.taskId, id); assert.equal(value.task.status, 'done');
  assert.equal(value.task.result.completion, 'documents_ready'); assert.equal(value.task.result.businessGoalAchieved, false);
  assert.equal(value.artifacts.length, 3);
  for (const artifact of value.artifacts) {
    assert.equal(artifact.status, 'available');
    const original = stored(f, id).deliverables.find(row => row.name === artifact.name);
    assert.equal(createHash('sha256').update(artifact.content).digest('hex'), original.sha256);
    assert.ok(JSON.stringify(value.sources).includes(artifact.name));
  }
  await a.runtime.session.prompt('公司资料是什么？'); assert.equal(receipt(a.runtime).status, 'unconfigured');
  assert.deepEqual(results(a.runtime).map(row => row.toolName), ['workspace_products', 'workspace_product', 'workspace_business_tasks', 'workspace_business_result', 'workspace_company_profile']);
  assert.ok(calls.some(row => row.route === '/api/agent/v1/tasks?limit=5&status=done'));
  assert.ok(calls.some(row => row.route === '/api/agent/v1/tasks?limit=1&withArtifacts=1'));
  assert.ok(calls.some(row => row.route === `/api/agent/v1/tasks/${id}/artifacts/procurement-brief.md`));
  assert.ok(calls.every(row => !row.route.startsWith('/api/library/')));
  assert.ok(!contexts.join('\n').includes(PRIVATE_SENTINEL));
  const transcript = JSON.stringify(a.runtime.session.agent.state.messages);
  assert.ok(!transcript.includes(PRIVATE_SENTINEL)); assert.ok(!transcript.includes(f.token));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
  t.diagnostic('Five official tool calls, actual original task list/detail/events/artifacts, private-library gaps without library HTTP, and artifact SHA match; both frontend/backend models explicitly faux, paid/live calls zero.');
});

test('empty task and result plugins return explicit empty receipts without fabricated products or tasks', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const calls = [], a = await agent(t, tracedClient(f, f.token, calls), [callBusinessTool('workspace_business_tasks', {}), actualToolReceipt,
    callBusinessTool('workspace_business_result', {}), actualToolReceipt]);
  await a.runtime.session.prompt('有哪些任务？'); assert.equal(receipt(a.runtime).status, 'empty');
  assert.deepEqual(receipt(a.runtime).tasks, []); assert.deepEqual(receipt(a.runtime).sources, []);
  await a.runtime.session.prompt('上次成果是什么？'); assert.equal(receipt(a.runtime).status, 'empty');
  assert.deepEqual(receipt(a.runtime).sources, []); assert.equal(receipt(a.runtime).task, undefined);
  assert.ok(calls.every(row => row.method === 'GET')); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  assert.equal(f.faux.state.callCount, 0); assert.equal(a.faux.state.callCount, 4);
});

test('original member and enterprise authorization isolate task lists, results and reopened plugin receipts', async t => {
  const f = await taskFixture(t, { enterprise: true, responses: [complete(), complete(), complete(), complete()] });
  const owner = tracedClient(f, TOKEN_A), saved = await owner.businessSubmit({ ...PUBLIC_PROCUREMENT, requestId: 'plugins-member-original' });
  const id = saved.task.taskId; await finished(f, id);
  assert.equal(stored(f, id).status, 'done');
  assert.equal(stored(f, id).steps.filter(row => row.status === 'succeeded').length, 4);
  assert.equal(stored(f, id).result.completion, 'documents_ready');
  for (const token of [TOKEN_B]) {
    const a = await agent(t, tracedClient(f, token), [callBusinessTool('workspace_business_tasks', {}), actualToolReceipt,
      callBusinessTool('workspace_business_result', { taskId: id }), actualToolReceipt]);
    await a.runtime.session.prompt('列出当前身份的任务。'); assert.equal(receipt(a.runtime).status, 'empty');
    assert.ok(!JSON.stringify(receipt(a.runtime)).includes(id));
    await a.runtime.session.prompt('读取另一个身份的成果。'); assert.equal(results(a.runtime).at(-1).isError, true);
    assert.match(textOf(results(a.runtime).at(-1)), /HTTP 404/);
  }
  const other = await taskFixture(t, { enterprise: true, workspaceId: 'pi-other-enterprise-test', responses: [complete(), complete(), complete(), complete()] });
  const foreign = await tracedClient(other, TOKEN_A).businessSubmit({ ...PUBLIC_PROCUREMENT, requestId: 'plugins-other-enterprise-original' });
  await finished(other, foreign.task.taskId);
  assert.equal(stored(other, foreign.task.taskId).status, 'done');
  assert.equal(stored(other, foreign.task.taskId).steps.filter(row => row.status === 'succeeded').length, 4);
  assert.equal(stored(other, foreign.task.taskId).result.completion, 'documents_ready');
  const scoped = await agent(t, owner, [callBusinessTool('workspace_business_tasks', {}), actualToolReceipt,
    callBusinessTool('workspace_business_result', { taskId: foreign.task.taskId }), actualToolReceipt]);
  await scoped.runtime.session.prompt('列出当前企业本人任务。');
  assert.deepEqual(receipt(scoped.runtime).tasks.map(row => row.taskId), [id]);
  assert.ok(!JSON.stringify(receipt(scoped.runtime)).includes(foreign.task.taskId));
  await scoped.runtime.session.prompt('读取另一个企业的成果。'); assert.equal(results(scoped.runtime).at(-1).isError, true);
  assert.match(textOf(results(scoped.runtime).at(-1)), /HTTP 404/);
  for (const toolName of ['workspace_business_tasks', 'workspace_business_result']) {
    const dir = await directory(t), sessionManager = SessionManager.create(dir, path.join(dir, 'sessions'));
    const a = await agent(t, owner, [callBusinessTool(toolName, toolName.endsWith('result') ? { taskId: id } : {}), actualToolReceipt],
      { isolationDirectory: dir, sessionManager });
    await a.runtime.session.prompt('查本人原任务成果并保存原工具回执。');
    const file = a.runtime.session.sessionFile; await a.runtime.dispose();
    const frontend = await syntheticFrontend([fauxAssistantMessage('Forbidden cached data must not reach this model.')]);
    await assert.rejects(createWorkspaceAgentRuntime({ client: tracedClient(f, TOKEN_B), isolationDirectory: dir, ...frontend,
      sessionManager: SessionManager.open(file, path.join(dir, 'sessions'), dir) }), /HTTP 404/);
    assert.equal(frontend.faux.state.callCount, 0);
  }
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
});

test('failed business execution remains incomplete original evidence', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const client = tracedClient(f), saved = await client.businessSubmit({ type: 'opportunity-discovery', title: 'Explicit missing research fixture',
    input: { product: 'Public synthetic cup', market: 'Public synthetic market' }, requestId: 'plugins-research-failure' });
  await finished(f, saved.task.taskId);
  const a = await agent(t, client, [callBusinessTool('workspace_business_result', { taskId: saved.task.taskId }), actualToolReceipt]);
  await a.runtime.session.prompt('这个研究任务完成了吗？'); const value = receipt(a.runtime);
  assert.equal(value.task.status, 'failed'); assert.equal(value.task.result.completion, 'incomplete'); assert.equal(value.status, 'partial');
  assert.equal(value.task.result.reason, 'AGENT_REQUIRED_CAPABILITY_MISSING'); assert.equal(value.task.result.businessGoalAchieved, false);
  assert.ok(JSON.stringify(value.sources).includes(saved.task.taskId)); assert.equal(f.faux.state.callCount, 0);
});

test('partial artifact read failure preserves original task status and cites only readable documents', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const saved = await tracedClient(f).businessSubmit({ ...PUBLIC_PROCUREMENT, requestId: 'plugins-partial-artifact-read' });
  await finished(f, saved.task.taskId);
  const client = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: (url, options) => {
    if (new URL(url).pathname.endsWith('/artifacts/comparison.md')) return new Response(JSON.stringify({ error: f.token }), { status: 503 });
    return fetch(url, options);
  } });
  const a = await agent(t, client, [callBusinessTool('workspace_business_result', {}), actualToolReceipt]);
  await a.runtime.session.prompt('读取上次保存的全部成果。'); const value = receipt(a.runtime);
  assert.equal(value.status, 'partial'); assert.equal(value.task.status, 'done');
  assert.equal(value.task.result.completion, 'documents_ready'); assert.equal(value.task.result.businessGoalAchieved, false);
  assert.equal(value.artifacts.find(row => row.name === 'comparison.md').status, 'unavailable');
  assert.deepEqual(value.sources.filter(row => row.kind === 'artifact').map(row => row.name), ['inquiry-pack.md', 'procurement-brief.md']);
  assert.ok(!JSON.stringify(a.runtime.session.agent.state.messages).includes(f.token));
  assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1);
});

test('plugin HTTP failure and invalid arguments do not fabricate successful reads or leak original bearer', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); let readCalls = 0;
  const client = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: (url, options) => {
    if (new URL(url).pathname === '/api/agent/v1/tasks') { readCalls++; return new Response(JSON.stringify({ error: f.token }), { status: 503 }); }
    return fetch(url, options);
  } });
  const a = await agent(t, client, [callBusinessTool('workspace_business_tasks', {}), actualToolReceipt,
    callBusinessTool('workspace_business_tasks', { limit: 21 }), actualToolReceipt,
    callBusinessTool('workspace_product', { productId: '../../private' }), actualToolReceipt,
    callBusinessTool('workspace_owner_approve', {}), actualToolReceipt]);
  await a.runtime.session.prompt('当前任务列表？'); assert.equal(results(a.runtime).at(-1).isError, true);
  assert.match(textOf(results(a.runtime).at(-1)), /HTTP 503/); assert.equal(readCalls, 1);
  await a.runtime.session.prompt('获取超过限定数量的任务。'); assert.equal(results(a.runtime).at(-1).isError, true); assert.equal(readCalls, 1);
  await a.runtime.session.prompt('读取非法产品编号。'); assert.equal(results(a.runtime).at(-1).isError, true);
  await a.runtime.session.prompt('自动给予模型审批权。'); assert.equal(results(a.runtime).at(-1).isError, true);
  assert.ok(!JSON.stringify(a.runtime.session.agent.state.messages).includes(f.token));
  assert.deepEqual(a.runtime.session.getActiveToolNames().sort(), [...TOOLS].sort());
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});
