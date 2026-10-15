import test from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceOmpHostRequest } from '../server/workspace-omp-terminal-host.mjs';
import { createWorkspaceOmpTerminalClient } from '../server/workspace-omp-terminal-client.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { taskFixture, TOKEN_A, TOKEN_B, api, until } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';

const model = { provider: 'public-terminal-session', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
test('enterprise OMP terminal transport preserves native Session, CSRF, exact identity and original execution readiness', { timeout: 45000 }, async t => {
  let f, executable = true, token = TOKEN_A;
  const existingBinding = () => ({ model, client: createWorkspaceClient({ baseURL: f.baseURL, token, fetchImpl: async (url, init) => {
    const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: init.method, rawBody: init.body, headers: { ...init.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } }) });
  f = await taskFixture(t, { enterprise: true, responses: [fauxAssistantMessage('Public original task receipt.')], businessAgentOptions: {
    recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths({}), configuration: { providerId: model.provider, model: model.id, baseUrl: model.baseUrl }, syntheticResponses: [{ text: 'Public original OMP reply.' }] }),
    resolveBinding: async () => executable ? existingBinding() : null,
    resolveControlBinding: async () => existingBinding(),
  } });
  const session = await f.workspace('/api/session', { subject: 'member-a' }); assert.equal(session.status, 200);
  let requests = 0, subject = 'member-a';
  const handoff = createWorkspaceOmpHostRequest({ origin: 'https://workspace.example', session: session.json,
    request: async ({ method, path, body }) => { requests++; assert.equal(method, body === undefined ? 'GET' : 'POST');
      const response = await f.workspace(path, { subject, ...(body === undefined ? {} : { body }) }); return { status: response.status, body: response.json }; } });
  const transport = createWorkspaceOmpTerminalClient({ baseURL: 'https://workspace.example', requestImpl: handoff });
  const admitted = await api(f, '/api/agent/v1/pi/tasks', { title: 'Public original owned task', content: 'Explicit synthetic public question.', requestId: 'omp-session-original-task' });
  assert.equal(admitted.status, 201, admitted.text); const runId = admitted.json.runId;
  await until(() => f.app.store.read().runs.find(row => row.id === runId)?.status === 'succeeded');
  const status = await transport.control('status', { runId }); assert.equal(status.status, 'succeeded');
  const cid = transport.current().conversationId; assert.ok(cid);
  const route = `/api/conversations/${cid}/terminal-controls`;
  assert.equal((await f.workspace(route, { subject: 'member-b', body: { operation: 'status', runId } })).status, 404);
  assert.equal((await request(f.baseURL, route, { method: 'POST', token: TOKEN_A, body: { operation: 'status', runId }, headers: { Host: 'workspace.example', Origin: 'https://workspace.example' } })).status, 401);
  assert.equal((await f.workspace(route, { subject: 'member-a', body: { operation: 'cancel', runId, confirmed: true }, headers: { 'X-CSRF-Token': 'invalid-synthetic-csrf' } })).status, 403);
  await assert.rejects(transport.control('businessSubmit', { input: 'forbidden' }), /HTTP 400/);
  token = TOKEN_B;
  await assert.rejects(transport.control('status', { runId }), /BUSINESS_AGENT_IDENTITY_CHANGED/); token = TOKEN_A;
  executable = false;
  await assert.rejects(transport.control('resume', { runId, requestId: 'must-not-run', confirmed: true }), /BUSINESS_AGENT_UNCONFIGURED/);
  assert.equal((await transport.control('status', { runId })).status, 'succeeded');
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.faux.state.callCount, 1);
  const before = requests; await assert.rejects(handoff({ method: 'GET', path: '/api/settings' }), /OMP_HOST_ROUTE_FORBIDDEN/); assert.equal(requests, before);
  subject = 'member-b'; await assert.rejects(transport.control('status', { runId }), /OMP_SESSION_EXPIRED_OR_CHANGED/);
  assert.equal(f.app.store.read().runs.length, 1);
});
