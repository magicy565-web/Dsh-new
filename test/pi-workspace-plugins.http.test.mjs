import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { promises as fs } from 'node:fs';
import { api, taskFixture, TOKEN_A, TOKEN_B, until } from './fixtures/pi-task-helpers.mjs';
import { PUBLIC_PROCUREMENT, syntheticFrontend, callBusinessTool, actualToolReceipt } from './fixtures/pi-workspace-agent-faux.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：本阶段仅整理明确提供的产品资料，未覆盖信息需逐项核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议核对原始材料并确认下一步。', sources: [] }], questions: [{ text: '是否可以补充原始报价与证据来源？', sources: [] }],
}), { stopReason: 'toolUse' });

test('real task-list API is read-only, bounded and original-member scoped without private inputs or artifact bodies', async t => {
  const reader = 'public-synthetic-plugin-read-only';
  const f = await taskFixture(t, { enterprise: true, principals: [
    { subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: sha(TOKEN_A), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-b', workspaceId: 'pi-enterprise-test', tokenSha256: sha(TOKEN_B), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: sha(reader), scopes: ['agent:read'] },
  ], responses: Array.from({ length: 8 }, complete) });
  const submitted = await api(f, '/api/agent/v1/tasks', { type: 'procurement', title: 'Public original plugin record', input: PUBLIC_PROCUREMENT.input }, { headers: { 'Idempotency-Key': 'plugin-list-owned' } });
  assert.equal(submitted.status, 201); const id = submitted.json.taskId;
  await until(() => f.app.store.read().workspaceAgentTasks.tasks[0].status === 'done');
  const before = f.app.store.read().meta.sequence;
  const value = await api(f, '/api/agent/v1/tasks?limit=1&status=done&withArtifacts=1', undefined, { token: reader });
  assert.equal(value.status, 200); assert.deepEqual(value.json.tasks.map(row => row.taskId), [id]);
  assert.equal(value.json.tasks[0].input, undefined); assert.equal(value.json.tasks[0].artifacts, undefined);
  assert.equal(value.json.tasks[0].artifactCount, 3); assert.equal(value.json.tasks[0].result.businessGoalAchieved, false);
  assert.equal(f.app.store.read().meta.sequence, before); assert.equal(f.faux.state.callCount, 4);
  assert.deepEqual((await api(f, '/api/agent/v1/tasks', undefined, { token: TOKEN_B })).json.tasks, []);
  for (const query of ['limit=0', 'limit=21', 'limit=', 'limit=1&limit=2', 'status=finished', 'status=', 'withArtifacts=true',
    'subject=member-b', 'workspaceId=other', 'url=https://other.example', 'limit=1&input=private'])
    assert.equal((await api(f, '/api/agent/v1/tasks?' + query, undefined, { token: reader })).status, 400, query);
  assert.equal((await api(f, '/api/agent/v1/tasks', undefined, { token: 'not-valid-synthetic-principal' })).status, 401);
  assert.equal((await api(f, '/api/agent/v1/tasks', PUBLIC_PROCUREMENT, { token: reader })).status, 403);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
});

test('credential-bearing original metadata is denied before reaching the official model rather than redelivered or fabricated', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const actualClient = createWorkspaceClient(f);
  const saved = await actualClient.businessSubmit(PUBLIC_PROCUREMENT);
  await until(() => f.app.store.read().workspaceAgentTasks.tasks[0].status === 'done');
  const forbidden = 'sk-synthetic-never-valid-secret-0123456789';
  // Synthetic authority corruption only; no real private/credential source is read.
  await f.app.store.update(state => { state.workspaceAgentTasks.tasks[0].title = 'api_key=' + forbidden; });
  const directory = await fs.mkdtemp('/tmp/workspace-plugin-secret-guard-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const frontend = await syntheticFrontend([callBusinessTool('workspace_business_tasks', {}), actualToolReceipt,
    callBusinessTool('workspace_business_result', { taskId: saved.task.taskId }), actualToolReceipt]);
  const { runtime } = await createWorkspaceAgentRuntime({ client: actualClient, isolationDirectory: directory, ...frontend });
  t.after(() => runtime.dispose()); await runtime.session.bindExtensions({});
  await runtime.session.prompt('列出我的任务。'); await runtime.session.prompt('读取上次成果。');
  const results = runtime.session.agent.state.messages.filter(row => row.role === 'toolResult');
  assert.ok(results.every(row => row.isError));
  assert.match(JSON.stringify(results), /credential-like/); assert.ok(!JSON.stringify(runtime.session.agent.state.messages).includes(forbidden));
  assert.ok(!JSON.stringify(runtime.session.agent.state.messages).includes(f.token));
  assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1);
});

test('task-list transport strips unexpected schema fields instead of exposing unapproved private payloads', async () => {
  const client = createWorkspaceClient({ baseURL: 'http://127.0.0.1:1', token: 'public-synthetic-plugin-principal', fetchImpl: async () => new Response(JSON.stringify({
    tasks: [{ taskId: 'original-task', type: 'procurement', title: 'Public original', status: 'done', created_at: '2026-10-14T01:00:00.000Z', artifactCount: 1,
      result: { state: 'completed', completion: 'documents_ready', businessGoalAchieved: false, futurePrivateField: 'PRIVATE_UNREVIEWED_FIELD' }, input: { private: 'PRIVATE_UNREVIEWED_FIELD' } }],
    limit: 20, hasMore: false, order: 'created_at_desc', futurePrivateField: 'PRIVATE_UNREVIEWED_FIELD',
  }), { headers: { 'content-type': 'application/json' } }) });
  const value = await client.businessTasks(); assert.equal(value.tasks.length, 1);
  assert.ok(!JSON.stringify(value).includes('PRIVATE_UNREVIEWED_FIELD')); assert.equal(value.sources[0].recordId, 'original-task');
});
