import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
import { request, stream, credentials, INPUTS, ARTIFACTS, API, EVENT_KINDS } from './agent-service.helpers.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label = 'original business state') { for (let i = 0; i < 600; i++) { if (await check()) return; await delay(5); } throw new Error('Timed out waiting for ' + label); }
const output = sources => ({ analysis: [{ text: '已提供产品资料，报价、供货条件与未覆盖信息需逐项核对。', sources: sources || ['input.product'] }], recommendations: [{ text: '建议先核对原始材料并确认下一步。', sources: [] }], questions: [{ text: '是否可以补充原始报价与证据来源？', sources: [] }] });
const complete = sources => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', output(sources)), { stopReason: 'toolUse' });
function interruptedResponse() { return async (_request, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }; }

async function fixture(t, { enterprise = false, configured = true, env = {}, responses = [], researchAdapter } = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-unified-agent-http-');
  const creds = credentials(), faux = fauxProvider(); faux.setResponses(responses);
  const keys = enterprise ? generateKeyPairSync('ed25519') : null;
  const access = enterprise ? { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'enterprise-fixture', issuer: 'original-fixture-ingress', keyId: 'original-fixture-key',
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'member-a', role: 'admin' }, { subject: 'member-b', role: 'operator' }] } : {};
  const principals = enterprise ? [
    { subject: 'member-a', workspaceId: access.workspaceId, tokenSha256: sha(creds.tokenA), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-b', workspaceId: access.workspaceId, tokenSha256: sha(creds.tokenB), scopes: ['agent:read', 'agent:submit'] },
  ] : [{ subject: 'local-operator', workspaceId: 'local', tokenSha256: sha(creds.tokenA), scopes: ['agent:read', 'agent:submit'] }];
  let app, base, currentConfigured = configured, currentEnv = { ...env };
  async function open() {
    const models = createModels(); models.setProvider(faux.provider);
    const provider = currentConfigured ? createPiProvider({ models, providerId: 'faux', model: 'faux-1', researchAdapter }) : createPiProvider();
    app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, access, provider, agentConfig: { env: currentEnv, principals } });
    const address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  }
  await open();
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, faux, creds, access, get app() { return app; }, get base() { return base; },
    api(route, options = {}) { return request(base, route, { token: creds.tokenA, ...options, headers: { ...(enterprise ? { Host: 'workspace.example' } : {}), ...(options.headers || {}) } }); },
    async submit(type = 'procurement', key = randomUUID(), options = {}) {
      const { body: override, ...rest } = options;
      return this.api(API + '/tasks', { method: 'POST', body: override || { type, title: '原任务：' + type, input: INPUTS[type] }, ...rest, headers: { 'Idempotency-Key': key, ...(rest.headers || {}) } });
    },
    task(id) { return app.store.read().workspaceAgentTasks.tasks.find(row => row.id === id); },
    async terminal(id, options = {}) { await until(() => ['done', 'failed', 'interrupted'].includes(this.task(id)?.status), 'terminal Agent task'); const response = await this.api(API + '/tasks/' + id, options); assert.equal(response.status, 200, response.text); return response; },
    async restart({ configured: nextConfigured = currentConfigured, env: nextEnv = currentEnv } = {}) { await app.close(); currentConfigured = nextConfigured; currentEnv = nextEnv; await open(); },
    async workspace(route, { method = 'GET', body, subject = 'member-a', session, headers = {} } = {}) {
      const bytes = body === undefined ? '' : JSON.stringify(body);
      return request(base, route, { method, ...(body === undefined ? {} : { body }), headers: { Host: 'workspace.example', ...(!['GET', 'HEAD'].includes(method) ? { Origin: access.publicOrigin } : {}),
        'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: keys.privateKey, ...access, subject, method, target: route, body: bytes }),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...headers } });
    },
    async login(subject) {
      const response = await this.workspace('/api/session/login', { method: 'POST', body: {}, subject, headers: { 'X-Workspace-Login': '1' } });
      assert.equal(response.status, 200);
      return { cookie: response.headers['set-cookie'][0].split(';')[0], csrfToken: response.json.csrfToken };
    },
  };
}

test('unified Agent HTTP preserves the seven-event protocol, real Pi stage execution, three files and identical concurrent SSE/history', async t => {
  let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { responses: [async (_request, options) => { entered = true; await Promise.race([gate, new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }))]); return complete(); }, complete(), complete(), complete()] });
  t.after(() => release());
  const submitted = await f.submit('procurement', 'same-original-task');
  assert.equal(submitted.status, 201, submitted.text); const id = submitted.json.taskId;
  await until(() => entered);
  let first = 0, second = 0;
  const streams = [stream(f.base, submitted.json.events_url, f.creds.tokenA, { onEvent: () => first++ }), stream(f.base, submitted.json.events_url, f.creds.tokenA, { onEvent: () => second++ })];
  await until(() => first > 0 && second > 0, 'both independent SSE subscribers'); release();
  const [one, two] = await Promise.all(streams);
  assert.equal(one.closedByServer, true); assert.equal(two.closedByServer, true); assert.deepEqual(one.events, two.events);
  assert.equal(one.events[0].kind, 'accepted'); assert.equal(one.events.at(-1).kind, 'done');
  assert.deepEqual(one.events[0].payload.plan, ['需求确认', '生成询价包', '比价表', '风险与建议']);
  assert.equal(one.events.filter(item => item.kind === 'artifact').length, 3);
  assert.ok(one.events.every((item, index) => EVENT_KINDS.includes(item.kind) && item.seq === index + 1));
  for (const stage of ['requirements', 'inquiry_pack', 'comparison', 'risk']) assert.ok(one.events.filter(item => item.kind === 'thinking' && item.payload.stage === stage).length >= 2);
  const replay = await f.api(API + '/tasks/' + id + '/events?format=json'); assert.deepEqual(replay.json, one.events);
  const cursor = Math.floor(one.events.length / 2), resumed = await stream(f.base, submitted.json.events_url + '?from=' + cursor, f.creds.tokenA);
  assert.deepEqual(resumed.events, one.events.filter(item => item.seq > cursor));
  const detail = await f.api(API + '/tasks/' + id);
  assert.equal(detail.json.status, 'done'); assert.equal(detail.json.result.version, 1); assert.equal(detail.json.result.businessGoalAchieved, false);
  assert.deepEqual(detail.json.artifacts.map(item => item.name), ARTIFACTS.procurement);
  assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().runs.length, 4);
  assert.ok(f.app.store.read().runs.every(run => run.execution.kind === 'pi-durable' && run.piSubmissionId && run.agentTaskId === id));
  for (const file of detail.json.artifacts) { const download = await f.api(file.url); assert.equal(download.status, 200); assert.equal(download.bytes.length, file.bytes); assert.match(download.text, /不锈钢保温杯/); assert.match(download.text, /500ml/); assert.doesNotMatch(download.text, /演示模式/); }
});

test('stable submit key deduplicates concurrent/lost responses and conflicting contents return 409', async t => {
  const f = await fixture(t, { responses: [complete(), complete(), complete(), complete()] }), key = 'response-loss-original-key';
  const [a, b] = await Promise.all([f.submit('procurement', key), f.submit('procurement', key)]);
  assert.equal(a.status, 201, a.text); assert.equal(b.status, 201, b.text); assert.equal(a.json.taskId, b.json.taskId);
  assert.equal([a.headers['idempotency-replayed'], b.headers['idempotency-replayed']].filter(value => value === 'true').length, 1);
  const found = await f.api(API + '/tasks/by-request/' + key); assert.equal(found.status, 200); assert.equal(found.json.taskId, a.json.taskId);
  const conflict = await f.submit('procurement', key, { body: { type: 'procurement', title: '不同内容', input: INPUTS.procurement } });
  assert.equal(conflict.status, 409); assert.equal(conflict.json.code, 'IDEMPOTENCY_CONFLICT');
  await f.terminal(a.json.taskId); await f.restart();
  const repeated = await f.submit('procurement', key); assert.equal(repeated.json.taskId, a.json.taskId); assert.equal(repeated.headers['idempotency-replayed'], 'true');
  assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1);
});

test('completed business outbox rebuilds its SQLite read projection and downloadable files after restart', async t => {
  const f = await fixture(t, { responses: [complete(), complete(), complete(), complete()] });
  const submitted = await f.submit(), id = submitted.json.taskId; await f.terminal(id);
  const before = await f.api(API + '/tasks/' + id + '/events?format=json');
  const files = await f.api(API + '/tasks/' + id + '/artifacts');
  const hashes = await Promise.all(files.json.map(async file => [file.name, sha((await f.api(file.url)).bytes)]));
  await f.app.close();
  await fs.rm(path.join(f.directory, 'agent'), { recursive: true, force: true });
  await f.restart();
  const after = await f.api(API + '/tasks/' + id + '/events?format=json'); assert.deepEqual(after.json, before.json);
  for (const [name, expected] of hashes) assert.equal(sha((await f.api(API + '/tasks/' + id + '/artifacts/' + name)).bytes), expected);
  assert.equal((await f.api(API + '/tasks/' + id)).json.status, 'done'); assert.equal(f.faux.state.callCount, 4);
});

test('restart pauses without model replay until explicit resume reattaches the original Pi run and inquiry file', async t => {
  const f = await fixture(t, { responses: [complete(), complete(), interruptedResponse()] });
  const submitted = await f.submit(), id = submitted.json.taskId;
  await until(() => f.task(id)?.steps[2].runId && f.faux.state.callCount === 3 && f.app.runtime.getRun(f.task(id).steps[2].runId).run.piSubmissionId);
  const beforeRun = f.app.runtime.getRun(f.task(id).steps[2].runId).run;
  const inquiry = await f.api(API + '/tasks/' + id + '/artifacts/inquiry-pack.md'); assert.equal(inquiry.status, 200);
  const history = (await f.api(API + '/tasks/' + id + '/events?format=json')).json;
  f.faux.setResponses([complete(), complete()]);
  await f.restart();
  await until(() => f.task(id)?.status === 'interrupted', 'explicitly paused Agent task');
  const paused = await f.api(API + '/tasks/' + id);
  assert.equal(paused.status, 200);
  assert.equal(paused.json.result.resumable, true);
  assert.equal(f.app.runtime.getRun(beforeRun.id).run.status, 'interrupted');
  assert.equal(f.app.runtime.getRun(beforeRun.id).run.piSubmissionId, beforeRun.piSubmissionId);
  await delay(60);
  assert.equal(f.faux.state.callCount, 3, 'A Host restart may not silently re-call the model.');
  assert.equal(f.app.store.read().runs.length, 3, 'No substitute run may be created by restart.');
  // Original Workspace endpoints are intentionally readable to the task owner,
  // but MUST NOT bypass the business Agent coordinator's explicit resume gate.
  const messageCount = f.app.store.read().messages.length;
  const legacyRetry = await f.api('/api/runs/' + beforeRun.id + '/retry', { method: 'POST', body: {} });
  assert.equal(legacyRetry.status, 409, legacyRetry.text);
  assert.equal(legacyRetry.json.error.code, 'AGENT_RECOVERY_REQUIRED');
  const ordinaryMessage = await f.api('/api/conversations/' + beforeRun.conversationId + '/messages', {
    method: 'POST', body: { content: 'Bypass original Agent task', requestId: 'forbidden-legacy-agent-chat' },
  });
  assert.equal(ordinaryMessage.status, 409, ordinaryMessage.text);
  assert.equal(ordinaryMessage.json.error.code, 'AGENT_TASK_ROUTE_REQUIRED');
  const goal = await f.api('/api/goals', { method: 'POST', body: {
    title: 'Forbidden parallel Goal', description: '', maxSteps: 1, maxOutputTokens: 1600, conversationId: beforeRun.conversationId,
  } });
  assert.equal(goal.status, 409, goal.text);
  assert.equal(goal.json.error.code, 'AGENT_TASK_ROUTE_REQUIRED');
  const reset = await f.api('/api/conversations/' + beforeRun.conversationId + '/reset-session', { method: 'POST', body: {} });
  assert.equal(reset.status, 409, reset.text);
  assert.equal(reset.json.error.code, 'AGENT_TASK_ROUTE_REQUIRED');
  const deleted = await f.api('/api/conversations/' + beforeRun.conversationId, { method: 'DELETE' });
  assert.equal(deleted.status, 409, deleted.text);
  assert.equal(deleted.json.error.code, 'AGENT_TASK_ROUTE_REQUIRED');
  assert.equal(f.app.store.read().messages.length, messageCount, 'Blocked legacy routes cannot add model work.');
  assert.equal(f.app.store.read().runs.length, 3);
  assert.equal(f.faux.state.callCount, 3);
  assert.equal(f.app.runtime.getRun(beforeRun.id).run.piSubmissionId, beforeRun.piSubmissionId);
  const [authorized, sameRequest] = await Promise.all([
    f.api(API + '/tasks/' + id + '/resume', { method: 'POST', body: {} }),
    f.api(API + '/tasks/' + id + '/resume', { method: 'POST', body: {} }),
  ]);
  for (const response of [authorized, sameRequest]) {
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.taskId, id, 'Concurrent recovery must retain one business task.');
  }
  const done = await f.terminal(id); assert.equal(done.json.status, 'done', JSON.stringify(done.json));
  const afterRun = f.app.runtime.getRun(beforeRun.id).run;
  assert.equal(afterRun.id, beforeRun.id); assert.equal(afterRun.piSubmissionId, beforeRun.piSubmissionId); assert.equal(afterRun.assistantId, beforeRun.assistantId);
  assert.equal(f.task(id).attempt, 2, 'Two simultaneous resume requests must admit just one business attempt.');
  assert.equal(f.app.store.read().runs.length, 4); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1);
  assert.equal(sha((await f.api(API + '/tasks/' + id + '/artifacts/inquiry-pack.md')).bytes), sha(inquiry.bytes));
  const events = (await f.api(API + '/tasks/' + id + '/events?format=json')).json;
  assert.deepEqual(events.slice(0, history.length), history); assert.equal(events.at(-1).kind, 'done');
  assert.ok(events.some(item => item.kind === 'thinking' && /检查点/.test(item.payload.text)));
  assert.ok(events.some(item => item.kind === 'error' && item.payload.result?.reason === 'AGENT_EXPLICIT_RESUME_REQUIRED'),
    'The original historical stream must show why automatic recovery was withheld.');
});

test('missing production model stays unconfigured, explicit demo stays visibly separate, same task can resume after configuration', async t => {
  const f = await fixture(t, { configured: false });
  const health = await f.api(API + '/health', { token: undefined }); assert.equal(health.json.mode, 'model'); assert.equal(health.json.readiness, 'unconfigured');
  const submitted = await f.submit(), id = submitted.json.taskId, stopped = await f.terminal(id);
  assert.equal(stopped.json.status, 'failed'); assert.equal(stopped.json.result.state, 'unconfigured'); assert.equal(stopped.json.result.businessGoalAchieved, false);
  assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().runs.length, 0);
  const history = (await f.api(API + '/tasks/' + id + '/events?format=json')).json; assert.equal(history.at(-1).kind, 'error');
  f.faux.setResponses([complete(), complete(), complete(), complete()]); await f.restart({ configured: true });
  const resumed = await f.api(API + '/tasks/' + id + '/resume', { method: 'POST', body: {} }); assert.equal(resumed.status, 200, resumed.text); assert.equal(resumed.json.taskId, id);
  const done = await f.terminal(id); assert.equal(done.json.status, 'done'); assert.equal(done.json.result.attempt, 2);
  assert.ok((await f.api(API + '/tasks/' + id + '/events?format=json')).json.some(item => item.kind === 'error'));
  assert.ok(done.json.artifacts.some(file => file.name.startsWith('partial-')));
  await f.restart({ configured: false, env: { WS_AGENT_DEMO: '1' } });
  const demo = await f.submit('procurement', 'explicit-demo-original'); const demoDone = await f.terminal(demo.json.taskId);
  assert.equal(demoDone.json.result.state, 'demo'); assert.equal(demoDone.json.result.completion, 'demonstration_only'); assert.match(demoDone.json.summary, /演示模式/);
  for (const file of demoDone.json.artifacts) assert.match((await f.api(file.url)).text, /演示模式：未接模型与真实数据源，内容为结构模板，数字为待确认/);
  assert.equal(f.faux.state.callCount, 4);
});

test('same enterprise member bindings isolate Agent and original Workspace APIs without separate accounts', async t => {
  const f = await fixture(t, { enterprise: true, responses: Array.from({ length: 8 }, () => complete()) });
  const a = await f.submit('procurement', 'shared-key'); assert.equal(a.status, 201, a.text); await f.terminal(a.json.taskId);
  const b = await f.submit('procurement', 'shared-key', { token: f.creds.tokenB }); assert.equal(b.status, 201, b.text); assert.notEqual(b.json.taskId, a.json.taskId); await f.terminal(b.json.taskId, { token: f.creds.tokenB });
  const id = a.json.taskId;
  for (const route of ['/tasks/' + id, '/tasks/' + id + '/events?format=json', '/tasks/' + id + '/artifacts', '/tasks/' + id + '/artifacts/inquiry-pack.md']) assert.equal((await f.api(API + route, { token: f.creds.tokenB })).status, 404, route);
  assert.equal((await f.api(API + '/tasks/by-request/shared-key', { token: f.creds.tokenB })).json.taskId, b.json.taskId);
  const original = f.task(id), session = await f.login('member-b');
  assert.equal((await f.workspace('/api/runs/' + original.steps[0].runId, { subject: 'member-b', session })).status, 404);
  const bootstrap = await f.workspace('/api/bootstrap', { subject: 'member-b', session }); assert.equal(bootstrap.status, 200);
  assert.ok(!JSON.stringify(bootstrap.json).includes(id)); assert.ok(!JSON.stringify(bootstrap.json).includes(original.conversationId));
  assert.equal((await f.api(API + '/presets', { token: undefined })).status, 401);
  assert.equal((await f.api(API + '/presets', { token: 'fixture-wrong-credential' })).status, 401);
  const unknown = await f.submit('unknown', 'unknown-preset', { body: { type: 'unknown', title: 'unknown', input: {} } }); assert.equal(unknown.status, 400); assert.equal(unknown.json.presets.length, 3);
});

test('missing search capability blocks sourcing and opportunity; prior model document output remains saved', async t => {
  const f = await fixture(t, { responses: [complete()] });
  const source = await f.submit('supplier-sourcing', 'source-without-search'); const stopped = await f.terminal(source.json.taskId);
  assert.equal(stopped.json.status, 'failed'); assert.equal(stopped.json.result.state, 'blocked'); assert.equal(stopped.json.result.reason, 'AGENT_REQUIRED_CAPABILITY_MISSING');
  assert.ok(f.task(source.json.taskId).steps[0].output); assert.equal(f.task(source.json.taskId).steps[0].status, 'succeeded');
  assert.ok(stopped.json.artifacts.some(file => file.name.startsWith('partial-channel_search-')));
  const opportunity = await f.submit('opportunity-discovery', 'opportunity-without-search'); const missing = await f.terminal(opportunity.json.taskId);
  assert.equal(missing.json.result.state, 'blocked'); assert.equal(missing.json.result.businessGoalAchieved, false);
  assert.equal(f.faux.state.callCount, 1); assert.equal(f.app.store.read().runs.length, 1);
});

test('supplier sourcing and opportunity run through the same Pi service and cite their actual admitted read-tool receipts', async t => {
  const reads = [];
  const researchAdapter = { id: 'http-business-evidence-fixture', revision: 1, replay: 'safe', configured: true, capabilities: ['web_search'], async search(value) {
    reads.push(value);
    return { observedAt: '2026-10-12T10:00:00Z', sources: [{ url: 'https://example.com/received-product-source', title: '保温杯资料', excerpt: '材料描述了保温杯的使用场景。', type: 'general' }] };
  } };
  const searchThenCite = () => [fauxAssistantMessage(fauxToolCall('workspace_research', { query: '保温杯使用场景与待核对材料', limit: 1 }), { stopReason: 'toolUse' }), request => {
    const tool = request.messages.at(-1); assert.notEqual(tool.isError, true, JSON.stringify(tool));
    const receipt = JSON.parse(tool.content.find(item => item.type === 'text').text);
    return fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', { ...output(), analysis: [{ text: '材料描述了保温杯的使用场景。', sources: [receipt.evidence[0].id] }] }), { stopReason: 'toolUse' });
  }];
  const f = await fixture(t, { researchAdapter, responses: [complete(), ...searchThenCite(), ...searchThenCite(), ...searchThenCite(), ...searchThenCite(), ...searchThenCite()] });
  for (const type of ['supplier-sourcing', 'opportunity-discovery']) {
    const submitted = await f.submit(type, 'same-pi-' + type); assert.equal(submitted.status, 201, submitted.text);
    const completed = await f.terminal(submitted.json.taskId); assert.equal(completed.json.status, 'done', completed.text);
    assert.equal(completed.json.result.businessGoalAchieved, false); assert.deepEqual(completed.json.artifacts.map(item => item.name), ARTIFACTS[type]);
    const events = (await f.api(submitted.json.events_url + '?format=json')).json;
    assert.equal(events[0].kind, 'accepted'); assert.equal(events.at(-1).kind, 'done');
    assert.equal(events.filter(item => item.kind === 'progress').length, 3);
    for (const artifact of completed.json.artifacts) {
      const downloaded = await f.api(artifact.url); assert.equal(downloaded.status, 200);
      assert.match(downloaded.text, /https:\/\/example.com\/received-product-source/); assert.match(downloaded.text, /待确认/); assert.doesNotMatch(downloaded.text, /演示模式/);
    }
  }
  assert.equal(f.app.store.read().runs.length, 6); assert.equal(f.faux.state.callCount, 11); assert.equal(reads.length, 5);
  assert.equal(new Set(reads.map(item => item.requestId)).size, 5);
  assert.ok(reads.every(item => item.actor.subject === 'local-operator' && item.actor.workspaceId === 'local'));
  assert.ok(f.app.store.read().workspaceAgentTasks.tasks.flatMap(task => task.steps).filter(step => step.result?.externalSearchPerformed).every(step => step.result.researchReceipts.length === 1));
});
