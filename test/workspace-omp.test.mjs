import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { taskFixture, TOKEN_A, TOKEN_B, until, api } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { publicPdfBytes } from './fixtures/workspace-omp-public-pdf.mjs';
const paths = workspaceOmpPaths(process.env);
const configured = await fs.stat(paths.packageRoot + '/package.json').then(() => true).catch(() => false);
const model = { provider: 'workspace-omp-test', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const recipient = { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl };
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const repository = fileURLToPath(new URL('..', import.meta.url));
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
async function fixture(t, responses, backend = [], token = TOKEN_A, options = {}) {
  let f;
  f = await taskFixture(t, { ...options, enterprise: true, responses: backend, businessAgentOptions: { recipient,
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, publicTools: options.publicTools,
      syntheticResponses: responses, syntheticPublicSearchResponses: options.syntheticPublicSearchResponses, onWorkerLifecycle: options.onWorkerLifecycle }),
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
for (const format of ['md', 'pdf']) test(`actual OMP public ${format} and source receipts feed original factory documents with one original frontend Run`, { skip: !configured, timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/omp-public-factory-flow-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const material = 'Public synthetic cup\nSpecification: explicitly supplied synthetic cup.\nCapacity and price unknown.\n';
  const bytes = format === 'pdf' ? publicPdfBytes(material.replaceAll('\n', ' ')) : Buffer.from(material);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = directory + '/product.' + format; await fs.writeFile(file, bytes);
  const source = 'Public synthetic distributor catalog; https://example.com/synthetic-catalog; original public-search receipt, unverified candidate, not buyer demand or contact consent.';
  const draft = { title: 'Public synthetic factory source-to-draft', requestId: 'omp-public-source-task',
    input: { product: 'Public synthetic cup', spec: 'Explicitly supplied synthetic cup', target_market: 'Public synthetic overseas target market',
      factory_materials: material, customer_materials: source } };
  const f = await fixture(t, [
    { tool: 'workspace_public_document', arguments: { documentId: 'product' } },
    { tool: 'workspace_public_search', arguments: { query: 'public synthetic cup distributor catalog', limit: 1 }, expectedContextText: 'Capacity and price unknown.' },
    { tool: 'workspace_factory_task', arguments: draft, expectedContextText: 'https://example.com/synthetic-catalog' },
    { text: 'The original task received the public synthetic source; outreach remains a human-review draft, not sent.' },
  ], Array.from({ length: 4 }, completeStage), TOKEN_A, {
    publicTools: { files: [{ id: 'product', path: file, sha256 }], publicDocumentRoot: directory },
    syntheticPublicSearchResponses: [{ status: 200, body: '<div class="result"><a class="result__a" href="https://example.com/synthetic-catalog">Public synthetic distributor catalog</a><a class="result__snippet">Public synthetic candidate; not a real buyer.</a></div>' }],
  });
  const cid = await conversation(f, 'omp-public-source-conversation'), accepted = await send(f, cid, 'omp-public-source-run', true);
  const run = await finished(f, accepted.run.id); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const frontendReply = f.app.store.read().messages.find(row => row.id === run.assistantId);
  assert.equal(frontendReply.runtime.engine, 'omp'); assert.equal(frontendReply.runtime.modelCalls, 4);
  assert.equal(run.executionRefs.length, 1); const taskId = run.executionRefs[0].taskId;
  await until(() => f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId)?.status === 'done');
  const state = f.app.store.read(), task = state.workspaceAgentTasks.tasks.find(row => row.id === taskId);
  assert.equal(state.runs.length, 5); assert.equal(state.workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
  assert.equal(task.input.customer_materials, source); assert.equal(task.result.businessGoalAchieved, false);
  assert.equal(task.result.evidenceStatus, 'user_supplied_only', 'Backend document stages received public inputs; do not pretend these stages independently searched.');
  const mapping = state.conversations.find(row => row.id === cid).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const search = entries.find(row => row.message?.role === 'toolResult' && row.message.toolName === 'workspace_public_search');
  assert.equal(search.message.details.sources[0].url, 'https://example.com/synthetic-catalog'); assert.equal(search.message.details.verifiedBuyer, false);
  const selected = entries.find(row => row.message?.role === 'toolResult' && row.message.toolName === 'workspace_public_document');
  assert.equal(selected.message.details.documentId, 'product'); assert.equal(selected.message.details.sha256, sha256);
  if (format === 'pdf') { assert.equal(selected.message.details.format, 'pdf'); assert.equal(selected.message.details.status, 'document_read');
    assert.deepEqual(selected.message.details.pagesNeedingOcr, []); assert.equal(JSON.stringify(entries).includes(bytes.toString('base64')), false); }
  for (const name of ['workspace_public_document', 'workspace_public_search', 'workspace_factory_task'])
    assert.ok(run.events.some(row => row.type === 'pi.tool.finished' && row.toolName === name), name);
  const result = await workspace(f, `/api/conversations/${cid}/business-results`); assert.equal(result.status, 200);
  assert.equal(result.json.results[0].artifacts.length, 3);
  assert.ok(result.json.results[0].artifacts.some(row => row.content.includes('https://example.com/synthetic-catalog')));
  const letter = result.json.results[0].artifacts.find(row => row.name === 'outreach-review-draft.md');
  assert.match(letter.content, /未发送|没有发送或批准/); assert.match(letter.content, /recipient to confirm/);
  assert.equal(state.workspaceThreadHarness, undefined); assert.equal(state.artifacts.length, 0);
});
test('original OMP Run persists a real SDK search refusal and reports partial without fabricated candidates or replacement tasks', { skip: !configured, timeout: 90000 }, async t => {
  const f = await fixture(t, [{ tool: 'workspace_public_search', arguments: { query: 'public synthetic product catalog', limit: 1 } },
    { text: 'Public source retrieval refused; zero sources. Customer evidence and outreach remain incomplete; no candidate invented.', expectedContextText: 'Public search did not return admissible sources' }], [], TOKEN_A,
  { syntheticPublicSearchResponses: [{ status: 403, body: 'Synthetic public provider refusal.' }] });
  const cid = await conversation(f, 'omp-public-failure'), accepted = await send(f, cid, 'omp-public-failure-run', true), run = await finished(f, accepted.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(f.app.store.read().messages.find(row => row.id === run.assistantId).runtime.modelCalls, 2);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  assert.ok(run.events.some(row => row.type === 'pi.tool.failed' && row.toolName === 'workspace_public_search'));
  const mapping = f.app.store.read().conversations.find(row => row.id === cid).businessAgentSession;
  const transcript = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const receipt = transcript.find(row => row.message?.role === 'toolResult' && row.message.toolName === 'workspace_public_search').message;
  assert.equal(receipt.isError, true); assert.equal(receipt.details.status, 'unavailable'); assert.equal(receipt.details.sources.length, 0);
});
test('revoked selected public document rejects original OMP cached receipt before the next model call', { skip: !configured, timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/omp-public-file-revoke-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = directory + '/product.md', material = 'Public synthetic product; capacity unknown.'; await fs.writeFile(file, material);
  const publicTools = { publicDocumentRoot: directory, files: [{ id: 'product', path: file, sha256: createHash('sha256').update(material).digest('hex') }] };
  const f = await fixture(t, [{ tool: 'workspace_public_document', arguments: { documentId: 'product' } }, { text: 'Only selected public material read.' }], [], TOKEN_A, { publicTools });
  const cid = await conversation(f, 'omp-public-file-revoke'), first = await send(f, cid, 'omp-public-file-first');
  assert.equal((await finished(f, first.run.id)).status, 'succeeded');
  publicTools.files = [];
  const second = await send(f, cid, 'omp-public-file-after-revoke'), refused = await finished(f, second.run.id);
  assert.equal(refused.status, 'failed'); assert.equal(refused.events.filter(row => row.type === 'pi.agent-session.request').length, 0);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});
test('changed selection hash for the same public document ID rejects the old cached content before inference', { skip: !configured, timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/omp-public-file-repin-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = directory + '/product.md', material = 'Public synthetic initial product; capacity unknown.'; await fs.writeFile(file, material);
  const publicTools = { publicDocumentRoot: directory, files: [{ id: 'product', path: file, sha256: createHash('sha256').update(material).digest('hex') }] };
  const f = await fixture(t, [{ tool: 'workspace_public_document', arguments: { documentId: 'product' } }, { text: 'Initial public selection read.' }], [], TOKEN_A, { publicTools });
  const cid = await conversation(f, 'omp-public-file-repin'), first = await send(f, cid, 'omp-public-file-old-pin');
  assert.equal((await finished(f, first.run.id)).status, 'succeeded');
  await fs.writeFile(file, 'Public synthetic new product; changed exact selected bytes.');
  publicTools.files[0].sha256 = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const second = await send(f, cid, 'omp-public-file-new-pin'), refused = await finished(f, second.run.id);
  assert.equal(refused.status, 'failed'); assert.match(refused.error.message, /cached public document was revoked|selected bytes changed/);
  assert.equal(refused.events.filter(row => row.type === 'pi.agent-session.request').length, 0);
});
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
  const second = await send(f, id, 'omp-native-second'), secondRun = await finished(f, second.run.id); assert.equal(secondRun.status, 'succeeded', JSON.stringify(secondRun));
  assert.equal(f.app.store.read().conversations.find(row => row.id === id).businessAgentSession.agentSessionId, mapping.agentSessionId);
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
test('actual official OMP CLI loads the standard factory extension beside native tools', { skip: !configured, timeout: 45000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-cli-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(directory + '/agent');
  await fs.writeFile(directory + '/agent/config.yml', 'startup:\n  checkUpdate: false\n  setupWizard: false\ntelemetry:\n  otlpExportEnabled: false\nretry:\n  enabled: false\n  modelFallback: false\ncompaction:\n  enabled: false\n');
  await fs.writeFile(directory + '/public-product.md', 'Public synthetic factory cup; capacity unknown and needs human review.\n');
  const copiedPackage = directory + '/copied-factory-package';
  await fs.mkdir(copiedPackage);
  for (const item of ['package.json', 'src', 'skills']) await fs.cp(repository + '/packages/workspace-procurement/' + item, copiedPackage + '/' + item, { recursive: true });
  assert.equal(await fs.stat(copiedPackage + '/node_modules').then(() => true).catch(() => false), false);
  const env = { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: directory + '/agent',
    PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb', WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WORKSPACE_OMP_PUBLIC_FIXTURE: directory + '/public-product.md' };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(paths.bun, [paths.packageRoot + '/dist/cli.js', '--no-title', '--no-prewalk', '--no-lsp', '--no-extensions', '--no-skills', '--no-rules', '--no-session', '--print',
      '-e', copiedPackage, '-e', repository + '/test/fixtures/workspace-omp-cli-faux.mjs',
      '--model', 'workspace-omp-standalone/finite', '--tools', 'read,bash,workspace_factory_capabilities,workspace_business_tasks,workspace_business_result', 'Run the explicitly authorized public synthetic CLI fixture.'],
      { cwd: directory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} reject(new Error('Official CLI acceptance timed out')); }, 35000);
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  assert.equal(result.code, 0, result.output); assert.match(result.output, /OMP_STANDARD_FACTORY_ENTRY_AND_NATIVE_READ_VERIFIED/);
});

test('original stop-answer aborts the actual OMP provider and its worker, preserving separately admitted backend task cancellation', { skip: !configured, timeout: 90000 }, async t => {
  const lifecycle = []; let backendAborted = false;
  const backendWait = async (_context, options) => {
    await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true }));
    backendAborted = true; return fauxAssistantMessage('', { stopReason: 'aborted' });
  };
  const f = await fixture(t, [{ tool: 'workspace_factory_task', arguments: { title: 'Public cancel fixture', requestId: 'omp-cancel-business',
    input: { product: 'Public cup', spec: 'Public supplied spec', target_market: 'Public market' } } }, { wait: 60000, text: 'Must be cancelled before this response.' }],
  [backendWait], TOKEN_A, { onWorkerLifecycle: event => lifecycle.push(event) });
  const id = await conversation(f, 'omp-real-cancel'), admitted = await send(f, id, 'omp-real-cancel-send', true);
  await until(() => f.app.store.read().runs.find(row => row.id === admitted.run.id)?.events.filter(row => row.type === 'pi.agent-session.request').length === 2 && f.faux.state.callCount === 1);
  const taskId = f.app.store.read().runs.find(row => row.id === admitted.run.id).executionRefs[0].taskId;
  const stopped = await workspace(f, `/api/conversations/${id}/cancel`, {}); assert.equal(stopped.status, 200); assert.equal(stopped.json.backendTasksCancelled, false);
  assert.equal((await finished(f, admitted.run.id)).status, 'cancelled');
  await until(() => lifecycle.some(event => event.phase === 'exit'));
  assert.ok(lifecycle.some(event => event.phase === 'nativeModelAbort'), JSON.stringify(lifecycle));
  const worker = lifecycle.find(event => event.phase === 'spawn'); assert.throws(() => process.kill(worker.pid, 0), error => error.code === 'ESRCH');
  assert.equal(backendAborted, false); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId).status, 'running');
  assert.equal((await api(f, `/api/agent/v1/tasks/${taskId}/cancel`, {})).status, 200); await until(() => backendAborted);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.app.store.read().runs.length, 2);
  for (const method of ['recoverPiRun', 'retryRun']) await assert.rejects(f.app.runtime[method](admitted.run.id, { requestId: 'omp-no-double-replay' }), error => error.code === 'BUSINESS_AGENT_CHECKPOINT_UNAVAILABLE');
});

test('OMP-linked factory task confirmed recovery reuses the original durable stage and documents after actual application restart', { skip: !configured, timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-original-recovery-');
  const paused = async (_context, options) => { await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); };
  const draft = { title: 'Public factory recovery', requestId: 'omp-original-recovery-task', input: { product: 'Public cup', spec: 'Public specification', target_market: 'Public market' } };
  const f = await fixture(t, [{ tool: 'workspace_factory_task', arguments: draft }, { text: 'Original public factory task admitted.' }], [completeStage(), completeStage(), paused], TOKEN_A, { directory });
  const id = await conversation(f, 'omp-original-recovery'), admitted = await send(f, id, 'omp-recovery-send', true);
  assert.equal((await finished(f, admitted.run.id)).status, 'succeeded');
  const taskId = f.app.store.read().runs.find(row => row.id === admitted.run.id).executionRefs[0].taskId;
  await until(() => f.faux.state.callCount === 3 && f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId)?.steps[2].runId);
  const before = structuredClone(f.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId)); assert.equal(before.deliverables.length, 1);
  const savedSession = structuredClone(f.app.store.read().conversations.find(row => row.id === id).businessAgentSession);
  await f.app.close();
  const next = await fixture(t, [], [completeStage(), completeStage()], TOKEN_A, { directory, listenPort: Number(new URL(f.baseURL).port) });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await until(() => next.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId)?.status === 'interrupted');
  const route = `/api/conversations/${id}/business-tasks/${taskId}/resume`, body = { requestId: 'omp-human-confirmed-recovery', confirmed: true };
  assert.equal((await workspace(next, route, { requestId: body.requestId })).status, 400);
  assert.equal((await workspace(next, route, body, 'member-b')).status, 404);
  const resumed = await Promise.all([workspace(next, route, body), workspace(next, route, body)]); assert.ok(resumed.every(row => row.status === 200));
  await until(() => next.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId)?.status === 'done');
  const done = next.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === taskId);
  for (const key of ['runId', 'replyId', 'requestId', 'contextFingerprint']) assert.equal(done.steps[2][key], before.steps[2][key]);
  assert.deepEqual(done.budget, before.budget); assert.equal(done.deliverables[0].sha256, before.deliverables[0].sha256); assert.equal(done.resumeRequests.length, 1);
  assert.equal(next.faux.state.callCount, 2); assert.equal(next.app.store.read().runs.length, 5); assert.equal(next.app.store.read().workspaceAgentTasks.tasks.length, 1);
  assert.equal(next.app.store.read().conversations.find(row => row.id === id).businessAgentSession.agentSessionId, savedSession.agentSessionId);
  const results = await workspace(next, `/api/conversations/${id}/business-results`); assert.equal(results.status, 200); assert.equal(results.json.results[0].status, 'available');
  assert.equal(results.json.results[0].task.result.businessGoalAchieved, false);
});

test('OMP adapter preserves exact original human approval and separate continuation, with one synthetic local document receipt', { skip: !configured, timeout: 90000 }, async t => {
  const f = await fixture(t, [], []);
  const connector = (await f.app.capabilities.createConnector({ name: 'OMP original approval public fixture', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
  await f.app.capabilities.updateConnector(connector.id, { enabled: true });
  f.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: 'Review this exact public synthetic local document.', connectorId: connector.id,
      action: 'create_file', resource: 'library:new', payload: { filename: 'omp-original-human-approved.txt', content: 'Explicit public synthetic human-approved output.' } }), { stopReason: 'toolUse' }),
    context => { assert.match(JSON.stringify(context), /Verified application connector receipt/); return fauxAssistantMessage('Original exact local receipt acknowledged.'); },
  ]);
  const accepted = await api(f, '/api/agent/v1/pi/tasks', { title: 'Original approval under OMP host', content: 'Explicit public synthetic document', requestId: 'omp-original-approval', connectorActions: [{ connectorId: connector.id, action: 'create_file' }] });
  assert.equal(accepted.status, 201, accepted.text); const runId = accepted.json.runId;
  const waiting = await finished(f, runId); assert.equal(waiting.status, 'awaiting_approval'); assert.equal(waiting.proposals.length, 1);
  const proposalId = waiting.proposals[0].id; assert.equal(f.app.capabilities.listConnectorRuns().length, 0);
  const base = '/api/agent/v1/pi/tasks/' + runId;
  assert.equal((await api(f, base + '/continue', { proposalId, requestId: 'omp-not-approved' })).status, 403);
  assert.equal((await api(f, base + '/decision', { proposalId, decision: 'approved', confirmed: false })).status, 400);
  assert.equal((await api(f, base + '/decision', { proposalId, decision: 'approved', confirmed: true })).status, 200);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 0, 'Approval alone does not execute.');
  const body = { proposalId, requestId: 'omp-exact-approved-continuation' };
  assert.equal((await api(f, base + '/continue', body)).status, 200);
  assert.equal((await finished(f, runId)).status, 'succeeded'); assert.equal(f.app.capabilities.listConnectorRuns().length, 1);
  assert.equal(f.app.artifacts.list().artifacts.length, 1); assert.equal(f.faux.state.callCount, 2);
  assert.equal((await api(f, base + '/continue', body)).status, 200); assert.equal(f.app.capabilities.listConnectorRuns().length, 1);
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().runs[0].businessAgentContext, undefined);
});

test('legacy front conversation blocks own cross-engine input while foreign IDs remain 404 and original cancellation stays available', { skip: !configured, timeout: 90000 }, async t => {
  const f = await fixture(t, [], []);
  const legacy = await f.app.runtime.createConversation({ title: 'Own public historical conversation', requestId: 'omp-legacy-front' }, { subject: 'member-a', workspaceId: 'pi-enterprise-test' });
  const route = `/api/conversations/${legacy.conversation.id}/messages`, body = { content: 'Public new text', requestId: 'omp-no-hidden-pi' };
  const own = await workspace(f, route, body); assert.equal(own.status, 403); assert.equal(own.json.error.code, 'BUSINESS_AGENT_ENGINE_CHANGED');
  assert.equal((await workspace(f, route, body, 'member-b')).status, 404);
  assert.equal((await workspace(f, `/api/conversations/${legacy.conversation.id}/cancel`, {})).status, 200);
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.faux.state.callCount, 0);
});

test('reopening current OMP scope rejects a synthetic non-admitted cached tool receipt before a model call', { skip: !configured, timeout: 90000 }, async t => {
  const f = await fixture(t, [{ text: 'First public OMP turn.' }]);
  const id = await conversation(f, 'omp-cached-public-scope'), first = await send(f, id, 'omp-cache-first'); assert.equal((await finished(f, first.run.id)).status, 'succeeded');
  const mapping = f.app.store.read().conversations.find(row => row.id === id).businessAgentSession;
  const rows = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  await fs.appendFile(mapping.sessionFile, JSON.stringify({ type: 'message', id: 'synthetic-non-admitted-cache', parentId: rows.at(-1).id,
    timestamp: new Date().toISOString(), message: { role: 'toolResult', toolCallId: 'synthetic-only-cache', toolName: 'read',
      content: [{ type: 'text', text: 'SYNTHETIC_PRIVATE_CACHE_MUST_NOT_ENTER_MODEL' }], isError: false, timestamp: Date.now() } }) + '\n');
  const second = await send(f, id, 'omp-cache-second'), failed = await finished(f, second.run.id);
  assert.equal(failed.status, 'failed'); assert.match(failed.error.message, /cannot inherit private or non-admitted tool receipts/);
  assert.equal(failed.events.filter(event => event.type === 'pi.agent-session.request').length, 0); assert.equal(f.faux.state.callCount, 0);
});
