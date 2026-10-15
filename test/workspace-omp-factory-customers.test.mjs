import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { taskFixture, TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
const model = { provider: 'factory-customers-host-faux', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const product = 'Public synthetic cup', targetMarket = 'United States';
async function fixture(t, { execute, failure = false, save = true }) {
  let f;
  f = await taskFixture(t, { enterprise: true, businessAgentOptions: {
    recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths(), configuration, factoryCustomers: true,
      publicTools: { searchProvider: 'duckduckgo', browserExecutable: null },
      syntheticPublicSearchResponses: [{ status: failure ? 403 : 200, body: failure ? 'Synthetic refusal' : '<div class="result"><a class="result__a" href="https://example.com/synthetic-cup-catalog">Synthetic cup distributor catalog</a><a class="result__snippet">Synthetic distributor cup catalog, not verified demand.</a></div>' }],
      syntheticResponses: [
        { tool: 'workspace_public_search', arguments: { query: 'public synthetic cup distributor catalog', limit: 1 },
          expectedToolNames: ['workspace_public_search', 'workspace_factory_public_review', 'workspace_factory_customers_save', 'workspace_skill'] },
        ...(!failure && save ? [{ tool: 'workspace_factory_customers_save', arguments: { documents: [{ name: 'candidate-review.md', content: 'The source reports a cup catalog. Buyer identity and purchasing intent remain unverified.' }], requestId: 'original-public-draft' }, sourceToolIdsFromPreviousTools: true }] : []),
        { text: failure ? 'The original provider refused; no customer source or replacement task was produced.' : save ? 'Public research draft saved only if original execution intent was admitted. No contact occurred.' : 'Search evidence only; no browser or save was needed.' },
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
for (const execute of [false, true]) test(`official customer loop selects direct search and draft save with original intent=${execute}; no fixed backend stages`, { timeout: 60000 }, async t => {
  const { f, cid, run } = await fixture(t, { execute }); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const state = f.app.store.read(), mapping = state.conversations.find(c => c.id === cid).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const names = entries.filter(e => e.message?.role === 'toolResult').map(e => e.message.toolName);
  assert.deepEqual(names, ['workspace_public_search', 'workspace_factory_customers_save']);
  const saved = entries.find(e => e.message?.toolName === 'workspace_factory_customers_save').message;
  assert.equal(saved.details.status, execute ? 'saved-draft' : 'blocked');
  const files = state.artifacts.filter(a => a.metadata.factoryCustomerDraft); assert.equal(files.length, execute ? 1 : 0);
  if (execute) { const file = await f.app.artifacts.download(files[0].id, { version: 1 }); assert.match(file.bytes.toString(), /https:\/\/example.com\/synthetic-cup-catalog/); assert.equal(files[0].sourceRunId, run.id); assert.equal(files[0].metadata.factoryCustomerDraft.humanReviewed, false); }
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(state.runs.length, 1); assert.equal(f.faux.state.callCount, 0);
});
for (const failure of [false, true]) test(`official direct search may finish without browser, save or task; synthetic refusal=${failure}`, { timeout: 60000 }, async t => {
  const { f, cid, run } = await fixture(t, { execute: false, failure, save: false }); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const state = f.app.store.read(), mapping = state.conversations.find(c => c.id === cid).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  const tools = entries.filter(e => e.message?.role === 'toolResult'); assert.deepEqual(tools.map(e => e.message.toolName), ['workspace_public_search']);
  if (failure) { assert.equal(tools[0].message.details.status, 'unavailable'); assert.deepEqual(tools[0].message.details.sources, []); }
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(state.artifacts.length, 0); assert.equal(f.faux.state.callCount, 0);
});
