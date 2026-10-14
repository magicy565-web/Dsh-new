import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { taskFixture, until, api, TOKEN_A, TOKEN_B } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
const BASE = '/api/agent/v1/tasks';
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '公开合成产品资料仅用于文书整理，客户线索和供货缺项待人工核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议核对来源材料后再决定是否联系。', sources: [] }],
  questions: [{ text: '是否可补充明确的产品与客户来源证据？', sources: [] }],
}), { stopReason: 'toolUse' });
const draft = { type: 'factory-export', title: '公开合成工厂客户开发材料', requestId: 'factory-public-stable-key',
  input: { product: '公开合成杯子', spec: '明确提交的合成规格', target_market: '公开目标市场',
    factory_materials: '用户提交的公开产品材料；产能未知',
    customer_materials: '用户提交的合成经销商资料；不是检索结果',
    rfq: '客户规格和计划数量待确认', supply_conditions: '产能、价格和交期均待确认' } };
const task = (f, id) => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === id);
async function finished(f, id) { await until(() => ['done', 'failed', 'interrupted'].includes(task(f, id)?.status)); }
function client(f, token = TOKEN_A, partial = false) {
  return createWorkspaceClient({ baseURL: f.baseURL, token, fetchImpl: async (url, options) => {
    if (partial && url.endsWith('/artifacts/customer-match-evidence.md')) return Response.json({ error: 'Synthetic partial artifact failure' }, { status: 404 });
    const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search,
      { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } });
}

test('factory export uses original four stages, stable task, exact documents and reload with no buyer or outreach execution', async t => {
  const directory = await fs.mkdtemp('/tmp/factory-export-original-');
  const f = await taskFixture(t, { directory, enterprise: true, responses: Array.from({ length: 4 }, complete) });
  const c = client(f); assert.ok((await c.businessPresets()).some(row => row.id === 'factory-export'));
  const [a, b] = await Promise.all([c.businessSubmit(draft), c.businessSubmit(draft)]);
  assert.equal(a.task.taskId, b.task.taskId); const id = a.task.taskId; await finished(f, id);
  const receipt = await c.businessStatus(id), saved = structuredClone(task(f, id));
  assert.equal(receipt.task.status, 'done'); assert.equal(receipt.task.result.businessGoalAchieved, false);
  assert.equal(receipt.task.result.completion, 'documents_ready'); assert.equal(receipt.task.result.evidenceStatus, 'user_supplied_only');
  assert.deepEqual(saved.steps.map(row => row.key), ['product_readiness', 'customer_evidence', 'rfq_match', 'outreach_review']);
  assert.equal(saved.steps.filter(row => row.status === 'succeeded').length, 4);
  assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().runs.length, 4);
  assert.deepEqual(receipt.artifacts.map(row => row.name), ['factory-product-brief.md', 'customer-match-evidence.md', 'outreach-review-draft.md']);
  for (const artifact of receipt.artifacts) {
    const original = saved.deliverables.find(row => row.name === artifact.name);
    assert.equal(artifact.status, 'available');
    assert.equal(createHash('sha256').update(artifact.content).digest('hex'), original.sha256);
    assert.equal(Buffer.byteLength(artifact.content), original.bytes);
  }
  const letter = receipt.artifacts.find(row => row.name === 'outreach-review-draft.md').content;
  assert.match(letter, /没有发送或批准|未发送/); assert.match(letter, /recipient to confirm/); assert.match(letter, /待确认/);
  for (const run of f.app.store.read().runs) { assert.equal(run.agentTaskId, id); assert.equal(run.connectorGrants?.length || 0, 0); }
  await assert.rejects(c.businessSubmit({ ...draft, title: 'Changed original content' }), /HTTP 409/);
  const partial = await client(f, TOKEN_A, true).businessStatus(id);
  assert.equal(partial.artifacts.filter(row => row.status === 'available').length, 2);
  assert.equal(partial.artifacts.find(row => row.name === 'customer-match-evidence.md').status, 'unavailable');
  await f.app.close();
  const restored = await taskFixture(t, { directory, enterprise: true, responses: [] });
  // Register directory cleanup after both applications' shutdown hooks.
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const reloaded = await client(restored).businessStatus(id);
  assert.equal(reloaded.task.status, 'done'); assert.equal(restored.faux.state.callCount, 0);
  assert.deepEqual(task(restored, id).deliverables, saved.deliverables);
  assert.equal(restored.app.store.read().workspaceAgentTasks.tasks.length, 1);
  assert.equal(restored.app.store.read().runs.length, 4);
  if (process.env.FACTORY_EXPORT_EVIDENCE) await fs.writeFile(process.env.FACTORY_EXPORT_EVIDENCE, JSON.stringify({
    version: 1, syntheticOnly: true, transport: 'actual-original-http', model: 'original-pi-durable-explicit-faux',
    originalTaskCount: 1, originalStages: saved.steps.map(row => row.key), originalRuns: 4, reloadModelCalls: 0,
    artifacts: saved.deliverables.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
    partialArtifactReads: 'two available; one unavailable', buyerProcurement: false, paidModelCalls: 0,
    independentCustomerDiscovery: false, businessGoalAchieved: false, externalActions: 0,
  }, null, 2) + '\n');
});

test('factory export keeps existing member/workspace permissions and rejects authority or private input before admission', async t => {
  const readOnly = 'factory-public-read-only', hash = value => createHash('sha256').update(value).digest('hex');
  const f = await taskFixture(t, { enterprise: true, principals: [
    { subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: hash(TOKEN_A), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-b', workspaceId: 'pi-enterprise-test', tokenSha256: hash(TOKEN_B), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-a', workspaceId: 'pi-enterprise-test', tokenSha256: hash(readOnly), scopes: ['agent:read'] },
  ], responses: Array.from({ length: 4 }, complete) });
  const c = client(f);
  for (const invalid of [{ ...draft, model: 'arbitrary' }, { ...draft, requestId: 'invalid key' },
    { ...draft, input: { ...draft.input, file: '/tmp/private' } },
    { ...draft, input: { ...draft.input, factory_materials: 'password=synthetic-never-real-value' } }])
    await assert.rejects(c.businessSubmit(invalid));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  await assert.rejects(client(f, readOnly).businessSubmit(draft), /HTTP 403/);
  const saved = await c.businessSubmit(draft), id = saved.task.taskId; await finished(f, id);
  await assert.rejects(client(f, TOKEN_B).businessStatus(id), /HTTP 404/);
  assert.equal((await api(f, `${BASE}/${id}/review`, { decision: 'accepted', note: '人工确认文书，仍未授权发送。' }, { token: readOnly })).status, 403);
  const other = await taskFixture(t, { enterprise: true, workspaceId: 'different-workspace' });
  await assert.rejects(client(other).businessStatus(id), /HTTP 404/);
  assert.equal(other.faux.state.callCount, 0);
});
