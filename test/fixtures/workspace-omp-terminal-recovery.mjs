import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { taskFixture, TOKEN_A, api } from './pi-task-helpers.mjs';
import { request } from '../agent-service.helpers.mjs';
import { createWorkspaceClient } from '../../packages/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../../server/workspace-omp-bridge.mjs';
import { launchWorkspaceOmpWithExistingSession } from '../../server/workspace-omp-terminal-host.mjs';

const mode = process.env.WORKSPACE_OMP_RECOVERY_MODE, root = process.cwd(), directory = path.join(root, 'data'), callbacks = [];
const model = { provider: 'workspace-omp-terminal-recovery-fixture', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const paths = workspaceOmpPaths({}), configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const until = async (check, label) => { for (let i = 0; i < 1200; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(label); };
const pause = async (_context, options) => { await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); };
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '仅按提供的公开合成产品资料整理，产能和未覆盖信息仍待核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议人工核对原始材料与供货条件。', sources: [] }], questions: [{ text: '是否补充明确的产能与交期信息？', sources: [] }],
}), { stopReason: 'toolUse' });
let current, child, conversationId, expected, connector, before;
const controls = [];
async function open(responses, ompResponses = [], listenPort = 0) {
  let f;
  f = await taskFixture({ after: callback => callbacks.push(callback) }, { directory, enterprise: true, responses, listenPort,
    businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
      engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: ompResponses, publicTools: { searchProvider: 'disabled' } }),
      resolveBinding: async () => ({ model, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
        const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search,
          { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
        return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
      } }) }),
    } }); current = f; return f;
}
const run = id => current.app.store.read().runs.find(row => row.id === id);
const task = id => current.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === id);
async function frontConversation() {
  const result = await current.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Public enterprise recovery terminal', requestId: 'terminal-recovery-front' } });
  assert.equal(result.status, 201, result.text); return result.json.conversation.id;
}
async function piTask(key, connectorActions = []) {
  const accepted = await api(current, '/api/agent/v1/pi/tasks', { title: 'Public synthetic original checkpoint', content: 'Public synthetic test only.', requestId: key, connectorActions });
  assert.equal(accepted.status, 201, accepted.text); return accepted.json.runId;
}
async function setup() {
  if (mode === 'approval') {
    await open([]); conversationId = await frontConversation();
    connector = (await current.app.capabilities.createConnector({ name: 'Public local recovery fixture', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
    await current.app.capabilities.updateConnector(connector.id, { enabled: true });
    current.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: 'Review this exact public synthetic local file.', connectorId: connector.id,
        action: 'create_file', resource: 'library:new', payload: { filename: 'public-terminal-reviewed.txt', content: 'PUBLIC SYNTHETIC LOCAL FILE; no external action.' } }), { stopReason: 'toolUse' }),
      pause, fauxAssistantMessage('ORIGINAL_APPROVED_CONTINUATION_COMPLETE'),
    ]);
    const proposalRunId = await piTask('terminal-original-proposal', [{ connectorId: connector.id, action: 'create_file' }]);
    await until(() => run(proposalRunId)?.status === 'awaiting_approval', 'Original proposal did not await approval.');
    const proposalId = run(proposalRunId).proposals[0].id, cancelRunId = await piTask('terminal-original-cancel');
    await until(() => current.faux.state.callCount === 2, 'Original cancellation model did not wait.');
    before = structuredClone({ proposalBudget: run(proposalRunId).budget, cancelBudget: run(cancelRunId).budget });
    expected = { proposalRunId, proposalId, cancelRunId };
  } else if (mode === 'checkpoint') {
    await open([pause]); conversationId = await frontConversation();
    const recoverRunId = await piTask('terminal-original-checkpoint'); await until(() => run(recoverRunId)?.piNativeTaskId && current.faux.state.callCount === 1, 'Original Pi checkpoint did not start.');
    before = structuredClone(run(recoverRunId)); const port = Number(new URL(current.baseURL).port); await current.app.close();
    await open([fauxAssistantMessage('ORIGINAL_CHECKPOINT_RECOVERED')], [], port);
    assert.equal(run(recoverRunId).status, 'interrupted'); expected = { recoverRunId };
  } else if (mode === 'business') {
    const draft = { title: 'Public factory terminal recovery', requestId: 'terminal-original-business', input: { product: 'Public synthetic cup', spec: 'Explicit public synthetic specification', target_market: 'Public synthetic target market' } };
    await open([complete(), complete(), pause], [{ tool: 'workspace_factory_task', arguments: draft }, { text: 'Original public factory task admitted.' }]);
    conversationId = await frontConversation();
    const accepted = await current.workspace(`/api/conversations/${conversationId}/messages`, { subject: 'member-a', body: { content: 'Prepare documents only from this public synthetic factory material.', requestId: 'terminal-business-admit', workspaceExecution: true } });
    assert.equal(accepted.status, 202, accepted.text);
    await until(() => run(accepted.json.run.id)?.status === 'succeeded' && current.faux.state.callCount === 3, 'Original business stages did not reach their checkpoint.');
    const businessTaskId = run(accepted.json.run.id).executionRefs[0].taskId;
    try { await until(() => task(businessTaskId)?.steps[2]?.runId, 'Original business stage identity was not saved.'); }
    catch (error) { console.log('OMP_RECOVERY_SETUP_DIAGNOSTIC ' + JSON.stringify({ calls: current.faux.state.callCount,
      status: task(businessTaskId)?.status, steps: task(businessTaskId)?.steps.map(step => ({ key: step.key, status: step.status, runId: step.runId })),
      runs: current.app.store.read().runs.map(value => ({ status: value.status, error: value.error?.code })) })); throw error; }
    before = structuredClone(task(businessTaskId));
    const port = Number(new URL(current.baseURL).port); await current.app.close(); await open([complete(), complete()], [], port);
    await until(() => task(businessTaskId)?.status === 'interrupted', 'Original business task was not restored as interrupted.');
    before.partialDocuments = task(businessTaskId).deliverables.filter(file => file.partial).map(({ name, sha256 }) => ({ name, sha256 }));
    expected = { businessTaskId, existingDocumentSha: before.deliverables[0].sha256, originalStageRunId: before.steps[2].runId };
  } else throw new Error('Choose one finite recovery fixture mode.');
}
async function verify() {
  if (mode === 'approval') {
    await until(() => run(expected.proposalRunId)?.status === 'succeeded' && run(expected.cancelRunId)?.status === 'cancelled', 'Original approval/continue/cancel did not settle.');
    assert.equal(current.app.capabilities.listConnectorRuns().length, 1); assert.equal(current.app.artifacts.list().artifacts.length, 1);
    assert.equal((await current.app.artifacts.read(current.app.artifacts.list().artifacts[0].id)).content, 'PUBLIC SYNTHETIC LOCAL FILE; no external action.');
    assert.deepEqual(run(expected.proposalRunId).budget, before.proposalBudget); assert.deepEqual(run(expected.cancelRunId).budget, before.cancelBudget);
    assert.equal(controls.filter(row => row.operation === 'decision').length, 1);
    assert.equal(controls.filter(row => row.operation === 'continue').length, 1); assert.equal(controls.filter(row => row.operation === 'cancel').length, 1);
    assert.equal(current.app.store.read().runs.length, 2); assert.equal(current.faux.state.callCount, 3);
  } else if (mode === 'checkpoint') {
    await until(() => run(expected.recoverRunId)?.status === 'succeeded', 'Original Pi recovery did not finish.');
    const recovered = run(expected.recoverRunId); assert.equal(recovered.piNativeTaskId, before.piNativeTaskId); assert.deepEqual(recovered.budget, before.budget);
    assert.equal(current.app.store.read().runs.length, 1); assert.equal(current.faux.state.callCount, 1); assert.equal(controls.filter(row => row.operation === 'resume').length, 1);
  } else {
    await until(() => task(expected.businessTaskId)?.status === 'done', 'Original business recovery did not finish.');
    const done = task(expected.businessTaskId); assert.equal(done.steps[2].runId, before.steps[2].runId); assert.deepEqual(done.budget, before.budget);
    assert.equal(done.deliverables[0].sha256, before.deliverables[0].sha256); assert.equal(done.deliverables.filter(file => !file.partial).length, 3);
    assert.ok(before.partialDocuments.length > 0);
    for (const file of before.partialDocuments) assert.equal(done.deliverables.find(item => item.name === file.name)?.sha256, file.sha256);
    assert.equal(current.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(current.app.store.read().runs.length, 5);
    assert.equal(current.faux.state.callCount, 2); assert.equal(controls.filter(row => row.operation === 'businessResume').length, 1);
  }
  return { mode, actualOfficialInteractiveMode: true, originalEnterpriseSessionHandoff: true, childReceivedSessionToken: false,
    originalStateVerified: true, originalRunAndBudgetPreserved: true, mutationOperations: controls.filter(row => !['status', 'businessStatus'].includes(row.operation)).map(row => row.operation),
    ...(mode === 'business' ? { finalDocuments: 3, partialHistoryDocumentsRetained: before.partialDocuments.length, exactTaskStageAndDocumentShaVisibleInConfirmation: true } : {}),
    paidModelCalls: 0, productionExternalActions: false };
}
process.once('SIGTERM', () => void (async () => { child?.kill('SIGTERM'); await current?.app.close(); process.exit(1); })());
try {
  await setup();
  const sessionResponse = await current.workspace('/api/session', { subject: 'member-a' }); assert.equal(sessionResponse.status, 200);
  console.log('OMP_RECOVERY_READY ' + JSON.stringify({ mode, conversationId, ...expected }));
  child = await launchWorkspaceOmpWithExistingSession({ origin: 'https://workspace.example', session: sessionResponse.json, conversationId,
    environment: { LANG: 'C.UTF-8', TERM: 'xterm-256color' },
    request: async ({ method, path: target, body, signal }) => {
      signal?.throwIfAborted();
      const response = await current.workspace(target, { subject: 'member-a', ...(body === undefined ? {} : { body }) });
      if (response.status >= 400) console.log('OMP_RECOVERY_REFUSAL ' + JSON.stringify({ status: response.status, code: response.json?.error?.code, operation: body?.operation }));
      if (method === 'POST' && target.endsWith('/terminal-controls')) {
        controls.push({ operation: body.operation, status: response.status });
        if (body.operation === 'decision' && response.status === 200) assert.equal(current.app.capabilities.listConnectorRuns().length, 0, 'Approval alone must not execute the connector.');
      } else if (method === 'POST' && /\/business-tasks\/[^/]+\/resume$/.test(target)) controls.push({ operation: 'businessResume', status: response.status });
      return { status: response.status, body: response.json };
    } });
  const exit = once(child, 'close');
  const completed = verify().then(value => { console.log('OMP_RECOVERY_VERIFIED ' + JSON.stringify(value)); return value; });
  const [code] = await exit; assert.equal(code, 0); const facts = await completed;
  await fs.writeFile(process.env.WORKSPACE_OMP_RECOVERY_EVIDENCE, JSON.stringify(facts, null, 2) + '\n');
} finally { for (const callback of callbacks) await callback(); }
