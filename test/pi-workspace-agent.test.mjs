// Real official Agent + real original HTTP; both model transports are explicitly faux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { taskFixture, until, TOKEN_A, TOKEN_B } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { BUSINESS_TOOL_NAMES, PUBLIC_PROCUREMENT, syntheticFrontend, callBusinessTool, actualToolReceipt } from './fixtures/pi-workspace-agent-faux.mjs';

const task = (f, id) => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === id);
async function finished(f, id) { await until(() => ['done', 'failed', 'interrupted'].includes(task(f, id)?.status)); }
async function directory(t) { const value = await fs.mkdtemp('/tmp/workspace-pi-agent-test-'); t.after(() => fs.rm(value, { recursive: true, force: true })); return value; }
const transcript = runtime => runtime.session.agent.state.messages;
const results = runtime => transcript(runtime).filter(row => row.role === 'toolResult');
const receipt = runtime => JSON.parse(results(runtime).at(-1).content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: 'Explicit synthetic backend: verify missing product evidence.', sources: ['input.product'] }],
  recommendations: [{ text: 'Confirm the original public materials.', sources: [] }], questions: [{ text: 'Any original evidence?', sources: [] }],
}), { stopReason: 'toolUse' });

test('natural input invokes only original business tools, persists four-stage documents and reopens the official session', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const isolated = await directory(t), calls = [];
  const client = createWorkspaceClient({ baseURL: f.baseURL, token: f.token, fetchImpl: (url, options) => {
    calls.push({ method: options.method, pathname: new URL(url).pathname, body: options.body }); return fetch(url, options);
  } });
  const frontend = await syntheticFrontend([callBusinessTool('workspace_business_task', PUBLIC_PROCUREMENT), actualToolReceipt]);
  const sessionManager = SessionManager.create(isolated, path.join(isolated, 'sessions'));
  let { runtime } = await createWorkspaceAgentRuntime({ client, isolationDirectory: isolated, ...frontend, sessionManager });
  t.after(async () => { await runtime.dispose(); });
  await runtime.session.bindExtensions({});
  assert.deepEqual(runtime.session.getActiveToolNames().sort(), [...BUSINESS_TOOL_NAMES].sort());
  await runtime.session.prompt('Please prepare procurement documents for the explicitly supplied public synthetic cup, specification and quantity 10.');
  assert.equal(frontend.faux.state.callCount, 2);
  const id = receipt(runtime).task.taskId; await finished(f, id);
  assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().runs.length, 4);
  assert.equal(task(f, id).steps.filter(row => row.status === 'succeeded').length, 4);
  assert.equal(task(f, id).result.businessGoalAchieved, false);
  frontend.faux.appendResponses([callBusinessTool('workspace_business_status', { taskId: id }), actualToolReceipt]);
  await runtime.session.prompt('Read the actual persisted procurement documents for the task just submitted.');
  const savedReceipt = receipt(runtime);
  assert.equal(savedReceipt.task.status, 'done'); assert.equal(savedReceipt.task.result.completion, 'documents_ready');
  assert.equal(savedReceipt.events.filter(row => row.kind === 'stage').length, 4);
  assert.deepEqual(savedReceipt.artifacts.map(row => row.name), ['inquiry-pack.md', 'comparison.md', 'procurement-brief.md']);
  for (const artifact of savedReceipt.artifacts) {
    assert.equal(artifact.status, 'available');
    assert.equal(createHash('sha256').update(artifact.content).digest('hex'), task(f, id).deliverables.find(row => row.name === artifact.name).sha256);
  }
  const sessionFile = runtime.session.sessionFile; assert.ok(sessionFile && sessionFile.startsWith(isolated));
  const jsonl = await fs.readFile(sessionFile, 'utf8'); assert.ok(jsonl.includes(id)); assert.ok(!jsonl.includes(f.token));
  await runtime.dispose();
  const reopened = SessionManager.open(sessionFile, path.join(isolated, 'sessions'), isolated);
  const nextFrontend = await syntheticFrontend([context => {
    assert.ok(JSON.stringify(context.messages).includes(id), 'Official reopened model context contains the original task receipt');
    return callBusinessTool('workspace_business_status', { taskId: id });
  }, actualToolReceipt]);
  ({ runtime } = await createWorkspaceAgentRuntime({ client, isolationDirectory: isolated, ...nextFrontend, sessionManager: reopened }));
  await runtime.session.bindExtensions({}); const before = calls.length;
  await runtime.session.prompt('Re-read that original task from the service after reopening this chat.');
  assert.deepEqual(receipt(runtime).artifacts, savedReceipt.artifacts);
  assert.ok(calls.slice(before).some(row => row.pathname === `/api/agent/v1/tasks/${id}`));
  assert.equal(calls.filter(row => row.method === 'POST').length, 1);
  assert.ok(calls.every(row => !row.pathname.includes('/pi/tasks') && !/owner|muse|dot|resume|decision|continue/.test(row.pathname)));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
  t.diagnostic('Official Agent/SessionManager and original HTTP/stages/documents verified with explicitly injected keyless faux frontend and backend; no live model or business achievement is proved.');
});

test('agent displays original missing-search failure and partial artifacts without claiming documents_ready', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const isolated = await directory(t);
  const frontend = await syntheticFrontend([callBusinessTool('workspace_business_task', { type: 'opportunity-discovery', title: 'Public synthetic research gap',
    input: { product: 'Public synthetic cup', market: 'Public synthetic market' }, requestId: 'agent-research-gap' }), actualToolReceipt]);
  const { runtime } = await createWorkspaceAgentRuntime({ client: createWorkspaceClient(f), isolationDirectory: isolated, ...frontend });
  t.after(() => runtime.dispose()); await runtime.session.bindExtensions({}); await runtime.session.prompt('Research the public synthetic cup market.');
  const id = receipt(runtime).task.taskId; await finished(f, id);
  frontend.faux.appendResponses([callBusinessTool('workspace_business_status', { taskId: id }), actualToolReceipt]);
  await runtime.session.prompt('Read the real research result and any partial documents.');
  const value = receipt(runtime); assert.equal(value.task.status, 'failed'); assert.equal(value.task.result.reason, 'AGENT_REQUIRED_CAPABILITY_MISSING');
  assert.equal(value.task.result.completion, 'incomplete'); assert.equal(value.task.result.businessGoalAchieved, false);
  assert.equal(value.events.at(-1).kind, 'error'); assert.ok(value.artifacts.some(row => row.status === 'available'));
  assert.match(JSON.stringify(transcript(runtime).at(-1)), /AGENT_REQUIRED_CAPABILITY_MISSING/); assert.equal(f.faux.state.callCount, 0);
});

test('agent tool dispatch retains original member ownership, submit scopes and forbids owner tool authority', async t => {
  const f = await taskFixture(t, { enterprise: true, responses: [complete(), complete(), complete(), complete()] });
  const clientFor = token => createWorkspaceClient({ baseURL: f.baseURL, token, fetchImpl: async (url, options) => {
    const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search,
      { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
  } });
  const a = clientFor(TOKEN_A); const submitted = await a.businessSubmit({ ...PUBLIC_PROCUREMENT, requestId: 'agent-enterprise-owned' });
  await finished(f, submitted.task.taskId);
  const isolated = await directory(t), frontend = await syntheticFrontend([callBusinessTool('workspace_business_status', { taskId: submitted.task.taskId }), actualToolReceipt,
    callBusinessTool('workspace_owner_approve', { taskId: submitted.task.taskId }), actualToolReceipt]);
  const { runtime } = await createWorkspaceAgentRuntime({ client: clientFor(TOKEN_B), isolationDirectory: isolated, ...frontend });
  t.after(() => runtime.dispose()); await runtime.session.bindExtensions({});
  await runtime.session.prompt('Read another member task.'); assert.equal(results(runtime).at(-1).isError, true);
  assert.match(JSON.stringify(transcript(runtime).at(-1)), /HTTP 404/);
  await runtime.session.prompt('Approve it with owner authority.'); assert.equal(results(runtime).at(-1).isError, true);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
  assert.deepEqual(runtime.session.getActiveToolNames().sort(), [...BUSINESS_TOOL_NAMES].sort());
  const ownedDirectory = await directory(t), ownedFrontend = await syntheticFrontend([callBusinessTool('workspace_business_status', { taskId: submitted.task.taskId }), actualToolReceipt]);
  const owned = await createWorkspaceAgentRuntime({ client: a, isolationDirectory: ownedDirectory, ...ownedFrontend,
    sessionManager: SessionManager.create(ownedDirectory, path.join(ownedDirectory, 'sessions')) });
  await owned.runtime.session.bindExtensions({}); await owned.runtime.session.prompt('Read my original task and persist its actual receipt.');
  const ownedFile = owned.runtime.session.sessionFile; await owned.runtime.dispose();
  const deniedFrontend = await syntheticFrontend([fauxAssistantMessage('This must never be called.')]);
  await assert.rejects(createWorkspaceAgentRuntime({ client: clientFor(TOKEN_B), isolationDirectory: ownedDirectory, ...deniedFrontend,
    sessionManager: SessionManager.open(ownedFile, path.join(ownedDirectory, 'sessions'), ownedDirectory) }), /HTTP 404/);
  assert.equal(deniedFrontend.faux.state.callCount, 0, 'Cached member A receipts never reach member B model context');
});

test('canceling the official frontend before tool dispatch admits no backend task or success receipt', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const isolated = await directory(t);
  let entered = false;
  const frontend = await syntheticFrontend([async (_context, options) => {
    entered = true; await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }]);
  const { runtime } = await createWorkspaceAgentRuntime({ client: createWorkspaceClient(f), isolationDirectory: isolated, ...frontend });
  t.after(() => runtime.dispose()); await runtime.session.bindExtensions({});
  const pending = runtime.session.prompt('Prepare public synthetic procurement documents, then cancel this turn.');
  await until(() => entered); await runtime.session.abort(); await pending;
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 0);
  assert.equal(f.faux.state.callCount, 0); assert.equal(results(runtime).length, 0);
  assert.equal(transcript(runtime).filter(row => row.role === 'assistant').at(-1).stopReason, 'aborted');
});

test('a read-only Workspace binding cannot gain submit authority through the frontend Agent', async t => {
  const f = await taskFixture(t, { principals: [{ subject: 'local-operator', workspaceId: 'local',
    tokenSha256: createHash('sha256').update(TOKEN_A).digest('hex'), scopes: ['agent:read'] }] });
  const isolated = await directory(t), frontend = await syntheticFrontend([callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'agent-read-only' }), actualToolReceipt]);
  const { runtime } = await createWorkspaceAgentRuntime({ client: createWorkspaceClient(f), isolationDirectory: isolated, ...frontend });
  t.after(() => runtime.dispose()); await runtime.session.bindExtensions({});
  await runtime.session.prompt('Prepare public synthetic procurement documents under this read-only identity.');
  assert.equal(results(runtime).at(-1).isError, true); assert.match(JSON.stringify(transcript(runtime).at(-1)), /HTTP 403/);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.faux.state.callCount, 0);
});

test('backend configuration alone does not enable a frontend Agent or synthetic fallback', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close()); const isolated = await directory(t);
  await assert.rejects(createWorkspaceAgentRuntime({ client: createWorkspaceClient(f), isolationDirectory: isolated }), /model|provider|configured/i);
  assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 0);
});
