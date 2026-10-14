import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { taskFixture, TOKEN_A, TOKEN_B, until } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
const paths = workspaceOmpPaths(process.env);
const configured = Boolean(process.env.WORKSPACE_OMP_PACKAGE_ROOT);
const model = { provider: 'workspace-omp-test', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const recipient = { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl };
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const completeStage = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '仅按提交的公开合成产品资料整理文书，客户来源和能力待人工核对。', sources: ['input.product'] }],
  recommendations: [{ text: '人工核对产品与客户来源。', sources: [] }], questions: [{ text: '是否补充明确供货条件？', sources: [] }],
}), { stopReason: 'toolUse' });
function clientFor(f, token = TOKEN_A) {
  return createWorkspaceClient({ baseURL: f.baseURL, token, fetchImpl: async (url, options) => {
    const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method,
      rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } });
}
async function fixture(t, responses, backend = [], token = TOKEN_A) {
  let f;
  f = await taskFixture(t, { enterprise: true, responses: backend, businessAgentOptions: { recipient,
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: responses }),
    resolveBinding: async () => ({ client: clientFor(f, token), model }),
  } });
  return f;
}
async function workspace(f, route, body, subject = 'member-a') { return f.workspace(route, { subject, ...(body === undefined ? {} : { body }) }); }
async function conversation(f, key) {
  const result = await workspace(f, '/api/conversations', { title: 'Public synthetic OMP factory entry', requestId: key, inputContext: empty() });
  assert.equal(result.status, 201, result.text); return result.json.conversation.id;
}
async function send(f, id, key, execute = false) {
  const result = await workspace(f, `/api/conversations/${id}/messages`, { content: 'Use the explicitly supplied public synthetic factory material.', requestId: key, workspaceExecution: execute, inputContext: empty() });
  assert.equal(result.status, 202, result.text); return result.json;
}
async function finished(f, id) {
  for (let i = 0; i < 300; i++) {
    const run = f.app.store.read().runs.find(row => row.id === id);
    if (run && !['queued', 'running'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Original OMP frontend run did not settle');
}
test('actual OMP SDK subprocess uses original Workspace identity, ledger and factory tools', { skip: !configured, timeout: 90000 }, async t => {
  const f = await fixture(t, [{ tool: 'workspace_factory_capabilities', arguments: {} }, { text: 'Public factory configuration inspected; Library is disabled.' }]);
  const id = await conversation(f, 'omp-native-public'), admitted = await send(f, id, 'omp-native-first');
  const run = await finished(f, admitted.run.id); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const state = f.app.store.read(), mapping = state.conversations.find(row => row.id === id).businessAgentSession;
  assert.equal(mapping.engineScope, 'omp:18.10.4:public-v1'); assert.ok(mapping.sessionFile.includes('/omp-agent-context/'));
  const transcript = await fs.readFile(mapping.sessionFile, 'utf8');
  assert.match(transcript, /workspace_factory_capabilities/); assert.ok(!transcript.includes(TOKEN_A) && !transcript.includes(TOKEN_B));
  assert.ok(run.events.some(row => row.type === 'pi.tool.finished' && row.toolName === 'workspace_factory_capabilities'));
  assert.equal(state.runs.length, 1); assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  assert.equal(state.workspaceThreadHarness, undefined);
  const duplicate = await send(f, id, 'omp-native-first'); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.run.id, run.id);
  const foreign = await workspace(f, `/api/conversations/${id}/business-results`, undefined, 'member-b'); assert.equal(foreign.status, 404);
});
test('OMP factory task produces four original stages and exact original documents, with no second business executor', { skip: !configured, timeout: 90000 }, async t => {
  const draft = { title: 'Public synthetic factory document task', requestId: 'omp-factory-task-one',
    input: { product: 'Public synthetic cup', spec: 'User supplied synthetic specification', target_market: 'Public target market', customer_materials: 'Explicit synthetic evidence; unverified.' } };
  const f = await fixture(t, [{ tool: 'workspace_factory_task', arguments: draft }, { text: 'Original factory document task admitted; completion is not customer discovery.' }], Array.from({ length: 4 }, completeStage));
  const id = await conversation(f, 'omp-factory-documents'), admitted = await send(f, id, 'omp-factory-create', true);
  const run = await finished(f, admitted.run.id); assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(run.executionRefs.length, 1);
  const taskId = run.executionRefs[0].taskId;
  await until(() => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId)?.status === 'done');
  const task = f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId); assert.equal(task.type, 'factory-export');
  assert.equal(task.steps.length, 4); assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().runs.length, 5);
  const saved = await workspace(f, `/api/conversations/${id}/business-results`); assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.results.length, 1); assert.equal(saved.json.results[0].task.taskId, taskId);
  for (const artifact of saved.json.results[0].artifacts) assert.equal(createHash('sha256').update(artifact.content).digest('hex'), task.deliverables.find(row => row.name === artifact.name).sha256);
  assert.equal(task.result.businessGoalAchieved, false); assert.equal(f.app.store.read().artifacts.length, 0);
});
test('OMP fresh scope refuses old Pi transcripts and read-only input cannot submit a factory task', { skip: !configured, timeout: 90000 }, async t => {
  const f = await fixture(t, [{ tool: 'workspace_factory_task', arguments: { title: 'Public synthetic task', requestId: 'omp-read-only', input: { product: 'cup', spec: 'spec', target_market: 'market' } } }, { text: 'The original service refused execution intent.' }]);
  const id = await conversation(f, 'omp-refusal'), admitted = await send(f, id, 'omp-refusal-one', false);
  await finished(f, admitted.run.id); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  await f.app.store.update(state => { delete state.conversations.find(row => row.id === id).businessAgentSession.engineScope; });
  const denied = await workspace(f, `/api/conversations/${id}/messages`, { content: 'Public text', requestId: 'old-pi-no-migration', inputContext: empty() });
  assert.equal(denied.status, 403); assert.equal(denied.json.error.code, 'BUSINESS_AGENT_ENGINE_CHANGED');
});
