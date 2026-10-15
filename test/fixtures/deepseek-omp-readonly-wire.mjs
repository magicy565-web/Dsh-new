// Actual OMP SDK/AgentSession; explicit mocked DeepSeek wire only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWorkspaceClient } from '../../pi/extensions/workspace.mjs';
import { acceptanceConfiguration, readonlyWorkspaceFetch } from '../../server/deepseek-acceptance-policy.mjs';
import { runOmpReadonlySession } from '../../scripts/acceptance-deepseek-readonly.mjs';
const originalFetch = globalThis.fetch, http = [], wire = [], mode = process.env.SYNTHETIC_MODE;
const directory = await fs.mkdtemp('/tmp/deepseek-omp-wire-');
const client = createWorkspaceClient({ baseURL: process.env.SYNTHETIC_BASE, token: process.env.SYNTHETIC_TOKEN,
  fetchImpl: readonlyWorkspaceFetch(process.env.SYNTHETIC_BASE, async request => { http.push(request.method); return originalFetch(request); }) });
const configuration = acceptanceConfiguration({ DEEPSEEK_API_KEY: 'synthetic-invalid-only' });
function sse(body, delta, reason) {
  const frame = { id: 'synthetic-omp-deepseek', model: body.model, object: 'chat.completion.chunk', created: 1, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  return new Response('data: ' + JSON.stringify(frame) + '\n\ndata: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: reason }],
    ...(mode === 'missing-usage' ? {} : { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
try {
  let result;
  try { result = await runOmpReadonlySession({ client, configuration, directory, packageRoot: process.env.WORKSPACE_OMP_PACKAGE_ROOT,
    fetchImpl: async request => {
      assert.equal(request.url, 'https://api.deepseek.com/chat/completions'); assert.equal(request.redirect, 'error');
      const body = await request.json(); wire.push(body);
      assert.equal(body.model, 'deepseek-flash'); assert.equal(body.max_tokens, 512); assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.deepEqual(body.tools.map(t => t.function.name), ['workspace_business_tasks']);
      if (mode === 'auth-error') return new Response('{}', { status: 401 });
      if (wire.length === 1 || mode === 'exhausted') return sse(body, { tool_calls: [{ index: 0, id: 'synthetic-call-' + wire.length, type: 'function', function: { name: mode === 'forced-write' ? 'workspace_business_task' : 'workspace_business_tasks', arguments: '{"limit":1}' } }] }, 'tool_calls');
      const receipt = JSON.parse(body.messages.findLast(m => m.role === 'tool').content);
      assert.equal(receipt.sources[0].recordId, process.env.SYNTHETIC_TASK_ID);
      return sse(body, { content: `Mocked model only: ${receipt.tasks[0].status}; source ${receipt.sources[0].recordId} ${receipt.sources[0].api}. Business achievement unverified.` }, 'stop');
    } }); } catch (error) { if (mode === 'happy') throw error; }
  assert.equal(Boolean(result), mode === 'happy');
  assert.ok(http.every(method => method === 'GET')); assert.ok(wire.length <= 2);
  if (mode === 'happy') { assert.equal(result.modelRequests, 2); assert.equal(result.citedSourceCount, 1); assert.equal(result.sdk, 'omp@18.10.4'); }
  if (['missing-usage', 'auth-error', 'forced-write'].includes(mode)) assert.equal(wire.length, 1);
  console.log(JSON.stringify({ passed: true, mode, sdk: 'omp@18.10.4', mockedWireRequests: wire.length, realModelRequests: 0 }));
} finally { await fs.rm(directory, { recursive: true, force: true }); }
