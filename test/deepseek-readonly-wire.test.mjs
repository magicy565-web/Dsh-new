// Real pinned Pi SDK/AgentSession + real original HTTP/Store. DeepSeek wire and
// the seeded business stage model are explicit synthetic substitutes throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { createWorkspaceAgentModel, createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { runReadonlySession } from '../scripts/acceptance-deepseek-readonly.mjs';
import { acceptanceConfiguration, modelAdmission, readonlyWorkspaceFetch } from '../server/deepseek-acceptance-policy.mjs';
import { PUBLIC_PROCUREMENT, syntheticFrontend, callBusinessTool, actualToolReceipt } from './fixtures/pi-workspace-agent-faux.mjs';
import { until } from './fixtures/pi-task-helpers.mjs';

function sse(model, delta, finish = 'stop') {
  const chunk = { id: 'explicit-mocked-deepseek', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: ' + JSON.stringify({ ...chunk,
    choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
    + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

test('real SDK serializes DeepSeek tools, reads original Store over HTTP and cites the actual source; zero real model calls', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const seedClient = createWorkspaceClient(f), submitted = await seedClient.businessSubmit(PUBLIC_PROCUREMENT);
  await until(() => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === submitted.task.taskId)?.status === 'done');
  const before = { tasks: f.app.store.read().workspaceAgentTasks.tasks.length, runs: f.app.store.read().runs.length, backendCalls: f.faux.state.callCount };
  const originalFetch = globalThis.fetch, wire = [], http = [];
  const config = acceptanceConfiguration({ PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: 'synthetic-deepseek-invalid', WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: f.token });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === 'https://api.deepseek.com/chat/completions') {
      const body = await request.json(); wire.push(body);
      assert.equal(request.headers.get('authorization'), 'Bearer synthetic-deepseek-invalid');
      assert.equal(body.model, 'deepseek-flash'); assert.equal(body.max_tokens, 1600); assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['workspace_business_tasks']);
      assert.equal(body.messages.some(m => m.role === 'developer'), false);
      if (wire.length === 1) return sse(body.model, { tool_calls: [{ index: 0, id: 'synthetic-readonly-call', type: 'function',
        function: { name: 'workspace_business_tasks', arguments: '{"limit":1}' } }] }, 'tool_calls');
      assert.equal(wire.length, 2);
      const receipt = JSON.parse(body.messages.findLast(m => m.role === 'tool').content);
      assert.equal(receipt.sources[0].recordId, submitted.task.taskId);
      return sse(body.model, { content: `Synthetic mocked answer: ${receipt.tasks[0].status}; source ${receipt.sources[0].recordId} ${receipt.sources[0].api}. Business achievement remains unverified.` });
    }
    assert.equal(new URL(request.url).origin, f.baseURL, 'fixture cannot escape to another network destination');
    http.push({ method: request.method, path: new URL(request.url).pathname });
    return originalFetch(request);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const admission = modelAdmission(config, { expiresAt: Date.now() + 60_000 });
  const frontend = await createWorkspaceAgentModel(config, [f.token], admission);
  const directory = await fs.mkdtemp('/tmp/deepseek-readonly-wire-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const client = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: readonlyWorkspaceFetch(f.baseURL) });
  const result = await runReadonlySession({ client, frontend, isolationDirectory: directory, createRuntime: createWorkspaceAgentRuntime });
  assert.equal(result.status, 'passed'); assert.equal(result.citedSourceCount, 1); assert.equal(admission.calls(), 2);
  assert.ok(result.answer.includes(submitted.task.taskId)); assert.equal(result.sources[0].recordId, submitted.task.taskId);
  assert.ok(http.every(row => row.method === 'GET')); assert.ok(http.some(row => row.path === '/api/agent/v1/tasks'));
  assert.deepEqual({ tasks: f.app.store.read().workspaceAgentTasks.tasks.length, runs: f.app.store.read().runs.length, backendCalls: f.faux.state.callCount }, before);
  t.diagnostic('Actual SDK and original tools/Store verified; all DeepSeek responses/usage and seeded business content are synthetic. Real-model requests: 0.');
});

test('transport admission rejection happens before any provider fetch, without leaking configured secrets', async t => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not run'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const configuration = { apiKey: 'synthetic-invalid', providerId: 'workspace-deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
  const frontend = await createWorkspaceAgentModel(configuration, [], { beforeModelRequest: async () => { throw new Error('synthetic-invalid'); } });
  const result = await frontend.modelRuntime.streamSimple(frontend.model, { messages: [{ role: 'user', content: 'synthetic', timestamp: 1 }] }).result();
  assert.equal(calls, 0); assert.ok(!JSON.stringify(result).includes('synthetic-invalid'));
  assert.equal(result.stopReason, 'error');
});

test('a synthetic model forcing an inactive write tool cannot submit business work through the read-only client', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const directory = await fs.mkdtemp('/tmp/deepseek-readonly-forced-write-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const client = createWorkspaceClient({ baseURL: f.baseURL, token: f.token,
    fetchImpl: readonlyWorkspaceFetch(f.baseURL, async (request, options) => { calls.push(request.method); return fetch(request, options); }) });
  const frontend = await syntheticFrontend([callBusinessTool('workspace_business_task', PUBLIC_PROCUREMENT), actualToolReceipt]);
  await assert.rejects(runReadonlySession({ client, frontend, isolationDirectory: directory, createRuntime: createWorkspaceAgentRuntime }), /RECEIPT/);
  assert.ok(calls.every(method => method === 'GET'));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 0);
  assert.equal(f.faux.state.callCount, 0);
});
