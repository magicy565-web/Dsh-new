import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { taskFixture, TOKEN_A, until } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
const model = { provider: 'factory-customers-host-faux', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const product = 'Public synthetic cup', targetMarket = 'United States';
const completeStage = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '仅按原公开工具回执整理合成客户来源；匹配、意向和联系许可仍待核实。', sources: ['input.product'] }],
  recommendations: [{ text: '人工核对官网、供货条件和收件人。', sources: [] }], questions: [{ text: '产品适配与联系许可是否已核对？', sources: [] }],
}), { stopReason: 'toolUse' });
async function fixture(t, { execute, failure = false }) {
  let f;
  f = await taskFixture(t, { enterprise: true, responses: Array.from({ length: 4 }, completeStage), businessAgentOptions: {
    recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths(), configuration, factoryCustomers: true,
      publicTools: { searchProvider: 'duckduckgo', browserExecutable: null },
      syntheticPublicSearchResponses: [{ status: failure ? 403 : 200, body: failure ? 'Synthetic refusal' : '<div class="result"><a class="result__a" href="https://example.com/synthetic-cup-catalog">Synthetic cup distributor catalog</a><a class="result__snippet">Synthetic distributor cup catalog, not verified demand.</a></div>' }],
      syntheticResponses: [
        { tool: 'workspace_factory_customers_research', arguments: { product, targetMarket, query: 'public synthetic cup distributor catalog', limit: 1, inspectPages: false } },
        ...(failure ? [{ text: 'The actual selected search transport returned no admissible sources. Customer evidence remains unavailable.', expectedContextText: 'ORIGINAL_PUBLIC_SEARCH_UNAVAILABLE' }]
          : [{ tool: 'workspace_factory_customers_save', arguments: { title: 'Synthetic public customer research', product, spec: 'Public synthetic cup', targetMarket,
            researchCallId: 'workspace-omp-1', requestId: 'original-customer-save' }, expectedContextText: 'https://example.com/synthetic-cup-catalog' },
          { text: execute ? 'Only an original document task was requested; sources are synthetic and neither demand nor contact consent is verified.' : 'Saving was refused by original execution intent. No task was created.' }]),
      ] }),
    resolveBinding: async () => ({ model, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
      const r = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body,
        headers: { ...options.headers, Host: 'workspace.example' } });
      return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
    } }) }),
  } });
  const c = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Synthetic public factory customer discovery', requestId: randomUUID(), inputContext: empty() } });
  assert.equal(c.status, 201, c.text); const cid = c.json.conversation.id;
  const r = await f.workspace(`/api/conversations/${cid}/messages`, { subject: 'member-a', body: { content: 'Research the explicitly supplied public synthetic cup category. Save only when originally admitted.',
    requestId: randomUUID(), workspaceExecution: execute, inputContext: empty() } });
  assert.equal(r.status, 202, r.text);
  for (let i = 0; i < 400; i++) {
    const run = f.app.store.read().runs.find(v => v.id === r.json.run.id);
    if (run && !['queued', 'running'].includes(run.status)) return { f, cid, run };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Original customer frontend Run did not settle.');
}
for (const execute of [false, true]) test(`actual customer profile preserves original explicit execution intent=${execute} and source receipts`, { timeout: 60000 }, async t => {
  const { f, cid, run } = await fixture(t, { execute }); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  let state = f.app.store.read(); assert.equal(state.workspaceAgentTasks.tasks.length, execute ? 1 : 0);
  assert.equal(state.conversations.find(v => v.id === cid).businessAgentSession.engineScope, 'omp:18.10.4:factory-customers-v1');
  const entries = (await fs.readFile(state.conversations.find(v => v.id === cid).businessAgentSession.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const research = entries.find(v => v.message?.toolName === 'workspace_factory_customers_research').message;
  assert.ok(!research.isError); assert.equal(research.details.sources[0].url, 'https://example.com/synthetic-cup-catalog');
  assert.equal(research.details.verifiedBuyer, false); assert.equal(research.details.contactPermission, false);
  assert.ok(!entries.some(v => v.message?.toolName?.startsWith('workspace_factory_material')));
  if (!execute) { assert.equal(f.faux.state.callCount, 0); assert.equal(state.runs.length, 1); return; }
  const taskId = state.workspaceAgentTasks.tasks[0].id;
  await until(() => f.app.store.read().workspaceAgentTasks.tasks[0].status === 'done'); state = f.app.store.read();
  assert.equal(state.runs.length, 5); assert.equal(f.faux.state.callCount, 4);
  assert.equal(state.workspaceAgentTasks.tasks[0].type, 'factory-export');
  const saved = await f.workspace(`/api/conversations/${cid}/business-results`, { subject: 'member-a' }); assert.equal(saved.status, 200);
  assert.equal(saved.json.results[0].task.taskId, taskId); assert.equal(saved.json.results[0].artifacts.length, 3);
  assert.ok(saved.json.results[0].artifacts.some(a => a.content.includes('https://example.com/synthetic-cup-catalog')));
});
test('actual customer profile preserves original native search refusal with zero sources and zero replacement tasks', { timeout: 60000 }, async t => {
  const { f, cid, run } = await fixture(t, { execute: false, failure: true }); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const state = f.app.store.read(), mapping = state.conversations.find(v => v.id === cid).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const value = entries.find(v => v.message?.toolName === 'workspace_factory_customers_research').message;
  assert.equal(value.isError, true); assert.equal(value.details.status, 'blocked'); assert.deepEqual(value.details.sources, []);
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(state.runs.length, 1); assert.equal(f.faux.state.callCount, 0);
});
