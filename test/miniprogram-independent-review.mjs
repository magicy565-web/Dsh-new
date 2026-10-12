// Independent requirements checks against e67596d. All identities/providers are
// disposable offline fixtures. No live credentials, accounts or paid requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { createModels, createProvider } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { openStore } from '../server/store.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
const { WorkspaceClient, conversationView } = createRequire(import.meta.url)('../release/miniprogram/shared/client.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await pause(10); } throw Error('Fixture timeout'); }
function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => { const req = http.request(url, { method, headers }, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }))); req.on('error', reject); req.end(body); });
}
async function originalMuse(t) {
  const directory = await fs.mkdtemp('/tmp/independent-original-muse-');
  const actor = { subject: 'fixture-owner', nativeAgentId: 'd68e1a48-96f2-4522-a88d-4066323c26b9' };
  const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';
  const marker = 'PRIVATE_OWNER_RECEIPT_FIXTURE_ONLY';
  const bearer = 'disposable-local-fixture-not-a-live-credential';
  const pair = generateKeyPairSync('ed25519'); // In-memory fixture; never saved.
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'fixture-workspace', issuer: 'fixture-ingress', keyId: 'fixture-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: actor.subject, role: 'admin' }, { subject: 'fixture-other', role: 'operator' }, { subject: 'fixture-viewer', role: 'viewer' }] };
  const store = await openStore(directory);
  await store.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Original owner fixture', status: 'idle', activeRunId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  await store.close();
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  let observed = '';
  faux.setResponses([ctx => { observed = JSON.stringify(ctx); return fauxAssistantMessage('Fixture received selected input'); }]);
  const app = await createApp({ dataDirectory: directory, access, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }), museWorkerConfig: { workerId, ownerId: 'original-fixture', tokenDigest: hash(bearer), enabled: true, scopeReviewed: true, externalBudgetVerified: true }, museOriginalBinding: { actor, operators: [actor], expectedHost: 'workspace.example' } });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { port } = await app.listen(0), base = `http://127.0.0.1:${port}`;
  const sessions = new Map();
  async function api(path, method = 'GET', data, subject = actor.subject, worker = false) {
    const body = data === undefined ? '' : JSON.stringify(data), session = sessions.get(subject);
    const headers = { Host: 'workspace.example', ...(!worker && !['GET', 'HEAD'].includes(method) ? { Origin: access.publicOrigin } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(worker ? { Authorization: `Bearer ${bearer}` } : { 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, subject, method, target: '/api' + path, body }), ...(path === '/session/login' ? { 'X-Workspace-Login': '1' } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}) }) };
    const response = await request(base + '/api' + path, { method, headers, body });
    const bytes = Buffer.from(await response.arrayBuffer());
    let result; try { result = JSON.parse(bytes); } catch { result = bytes.toString(); }
    if (path === '/session/login') sessions.set(subject, { ...result, cookie: response.headers.get('set-cookie')?.split(';')[0] });
    return { status: response.status, data: result, bytes };
  }
  for (const member of access.members) assert.equal((await api('/session/login', 'POST', {}, member.subject)).status, 200);
  const prefix = `/conversations/${actor.nativeAgentId}/muse-delegations`;
  const prepared = await api(prefix, 'POST', { provider: 'muse', conversationId: actor.nativeAgentId, requestId: 'independent-owner-request', content: marker, order: { serviceId: 'channel-validation', product: 'Fixture product', market: 'US', objective: marker, budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString(), publicDataConfirmed: true } });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const { orderId, reviewHash } = prepared.data.delegation, review = { confirmed: true, expectedReviewHash: reviewHash };
  assert.equal((await api(`${prefix}/${orderId}/approve`, 'POST', review)).status, 200);
  assert.equal((await api(`${prefix}/${orderId}/dispatch`, 'POST', review)).status, 200);
  const claim = await api(`/muse-worker/v1/tasks/${orderId}/claim`, 'POST', { requestId: 'independent-claim' }, actor.subject, true);
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  const attempt = { attemptId: claim.data.attemptId, fence: claim.data.fence };
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId, deliverables: [{ name: 'Fixture report', type: 'report', summary: marker }], evidence: [{ title: 'Fixture source', url: 'https://www.loc.gov/about/', detail: 'No external fetch' }] }));
  const upload = await api(`/muse-worker/v1/tasks/${orderId}/upload-file`, 'POST', { ...attempt, uploadId: 'independent-upload', filename: 'private-result.json', base64: bytes.toString('base64'), sha256: hash(bytes) }, actor.subject, true);
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const submitted = await api(`/muse-worker/v1/tasks/${orderId}/submit-result`, 'POST', { ...attempt, requestId: 'independent-submit', summary: marker, sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Offline fixture; no real Muse execution.' }, actor.subject, true);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  const returned = await api(`${prefix}/${orderId}/refresh`, 'POST', {});
  assert.equal(returned.data.delegation.phase, 'result_returned');
  return { app, api, actor, marker, orderId, artifactId: upload.data.artifactId, bytes, prefix, observed: () => observed, faux };
}

test('requirement: non-owner cannot enumerate original Muse private orders through generic Worker routes', async t => {
  const f = await originalMuse(t);
  const bootstrap = await f.api('/bootstrap', 'GET', undefined, 'fixture-viewer');
  assert.equal(bootstrap.data.conversations.some(c => c.id === f.actor.nativeAgentId), false);
  const specialized = await f.api(`${f.prefix}/${f.orderId}`, 'GET', undefined, 'fixture-viewer');
  const list = await f.api('/worker-orders', 'GET', undefined, 'fixture-viewer');
  const direct = await f.api(`/worker-orders/${f.orderId}`, 'GET', undefined, 'fixture-viewer');
  console.log(JSON.stringify({ probe: 'owner-private-order', specializedStatus: specialized.status, listStatus: list.status, directStatus: direct.status, markerDisclosed: JSON.stringify(list.data).includes(f.marker), directMarkerDisclosed: JSON.stringify(direct.data).includes(f.marker) }));
  assert.equal(specialized.status, 403);
  assert.equal(JSON.stringify(list.data).includes(f.marker), false, 'Generic list must preserve original Muse owner confidentiality');
  assert.ok([403, 404].includes(direct.status));
});

test('requirement: a non-owner cannot send protected Muse receipt bytes to Pi by selecting its artifact ID', async t => {
  const f = await originalMuse(t);
  const denied = await f.api(`/artifacts/${f.artifactId}/download?version=1&sha256=${hash(f.bytes)}`, 'GET', undefined, 'fixture-other');
  assert.equal(denied.status, 404);
  const own = await f.api('/conversations', 'POST', { title: 'Ordinary other-user fixture' }, 'fixture-other');
  const sent = await f.api(`/conversations/${own.data.conversation.id}/messages`, 'POST', { content: 'Use selected fixture file', requestId: 'independent-exfiltration-fixture', provider: 'pi', inputContext: { artifacts: [{ id: f.artifactId, version: 1 }], skills: [], memoryIds: [], connectorActions: [] } }, 'fixture-other');
  if (sent.status === 202) await until(() => f.app.runtime.getRun(sent.data.run.id).run.status !== 'running');
  console.log(JSON.stringify({ probe: 'protected-file-to-model', directDownloadStatus: denied.status, sendStatus: sent.status, providerCalls: f.faux.state.callCount, privateBytesReachedFauxModel: f.observed().includes(f.marker) }));
  assert.ok([403, 404].includes(sent.status), 'Denied Muse files must also be denied as model input');
  assert.equal(f.faux.state.callCount, 0);
});

test('requirement: non-owner cannot inject messages into the original Muse conversation through provider pi', async t => {
  const f = await originalMuse(t);
  const sent = await f.api(`/conversations/${f.actor.nativeAgentId}/messages`, 'POST', { content: 'Other user fixture injection', requestId: 'independent-other-user-inject', provider: 'pi' }, 'fixture-other');
  if (sent.status === 202) await until(() => f.app.runtime.getRun(sent.data.run.id).run.status !== 'running');
  console.log(JSON.stringify({ probe: 'original-conversation-injection', sendStatus: sent.status, providerCalls: f.faux.state.callCount, ownerReceiptReachedFauxModel: f.observed().includes(f.marker) }));
  assert.equal(sent.status, 403, 'Original Muse owner guard must apply to generic conversation messages');
  assert.equal(f.faux.state.callCount, 0);
});

test('requirement: mini program shows the original returned Muse receipt file in the same conversation', async t => {
  const f = await originalMuse(t), snapshot = (await f.api('/bootstrap')).data;
  const receiptMessage = snapshot.messages.find(m => m.role === 'assistant' && m.museOrderId === f.orderId);
  assert.ok(receiptMessage?.museReceipt?.files?.length);
  const view = conversationView(snapshot, f.actor.nativeAgentId);
  console.log(JSON.stringify({ probe: 'mini-original-receipt', receiptFiles: receiptMessage.museReceipt.files.length, miniFileCards: view.cards.filter(c => c.file).length, messages: view.messages.length }));
  assert.ok(view.cards.some(c => c.file?.id === f.artifactId), 'Original Muse returned file must remain available in mini conversation');
});

test('requirement: definite mini send rejection releases composer for corrected input', async () => {
  const client = new WorkspaceClient({ request(options) { options.success({ statusCode: 409, data: { error: { code: 'INPUT_ARTIFACT_MISSING', message: 'Selected file no longer exists' } } }); } }, { baseUrl: 'https://workspace.example' });
  await assert.rejects(client.send('fixture-conversation', 'Correctable request'), { code: 'INPUT_ARTIFACT_MISSING' });
  console.log(JSON.stringify({ probe: 'mini-definite-rejection', uncertainAfterDefinite409: client.uncertain }));
  assert.equal(client.uncertain, false, 'A definite rejected admission is not an uncertain committed send');
});

test('requirement: upload-only PDF remains visible after sending and reloading the mini conversation', async () => {
  const snapshot = { conversations: [{ id: 'fixture-conversation' }], messages: [{ id: 'fixture-user-message', conversationId: 'fixture-conversation', role: 'user', content: 'See my PDF', status: 'complete' }], runs: [], artifacts: [{ id: 'fixture-uploaded-pdf', filename: 'input.pdf', mimeType: 'application/pdf', currentVersion: 1, sha256: 'a'.repeat(64), sourceConversationId: 'fixture-conversation', versions: [{ version: 1, filename: 'input.pdf', mimeType: 'application/pdf', sha256: 'a'.repeat(64) }] }] };
  const view = conversationView(snapshot, 'fixture-conversation');
  console.log(JSON.stringify({ probe: 'mini-input-pdf', savedArtifacts: snapshot.artifacts.length, persistentFileCards: view.cards.filter(c => c.file).length }));
  assert.ok(view.cards.some(c => c.file?.id === 'fixture-uploaded-pdf'), 'Stored input attachment should be accessible after refresh');
});

test('requirement: compiled mini page restores login UI after the server rejects an expired session', async t => {
  const require = createRequire(import.meta.url), file = require.resolve('../release/miniprogram/pages/conversation/index.js');
  const previousPage = globalThis.Page, previousGetApp = globalThis.getApp;
  let page;
  const client = new WorkspaceClient({ request(options) {
    options.success(options.url.endsWith('/session') ? { statusCode: 200, data: { authenticated: true, csrfToken: 'fixture-csrf', user: { id: 'fixture-owner', role: 'operator' }, expiresAt: null, mode: 'enterprise' } } : { statusCode: 401, data: { error: { code: 'SESSION_REQUIRED', message: 'Fixture expired session' } } });
  } }, { baseUrl: 'https://workspace.example' });
  globalThis.Page = value => { page = value; page.data = structuredClone(value.data); page.setData = patch => Object.assign(page.data, patch); };
  globalThis.getApp = () => ({ globalData: { client } });
  delete require.cache[file]; require(file);
  t.after(() => { page.onHide(); globalThis.Page = previousPage; globalThis.getApp = previousGetApp; delete require.cache[file]; });
  page.onShow(); await until(() => page.data.error.includes('expired'));
  console.log(JSON.stringify({ probe: 'compiled-mini-auth-expiry', clientSession: client.session, pageAuthenticated: page.data.authenticated, loginButtonHidden: page.data.authenticated }));
  assert.equal(page.data.authenticated, false, 'Compiled page must expose login again when session expires');
});

test('positive independent check: missing mini service fails before obtaining any login code', async () => {
  let calls = 0;
  const client = new WorkspaceClient({ login() { calls++; assert.fail('No WeChat code allowed'); }, request() { calls++; assert.fail('No unconfigured request allowed'); } }, { baseUrl: '', loginBroker: async () => assert.fail('No broker invocation allowed') });
  await assert.rejects(client.login(), { code: 'SERVICE_SETUP_REQUIRED' });
  await assert.rejects(client.initialize(), { code: 'SERVICE_SETUP_REQUIRED' });
  assert.equal(calls, 0);
});

test('positive independent check: mini binary attachments store and download byte-exact PDF/PNG with SHA while not parsing them', async t => {
  const directory = await fs.mkdtemp('/tmp/independent-mini-binary-');
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  let observed = '';
  faux.setResponses([ctx => { observed = JSON.stringify(ctx); return fauxAssistantMessage(JSON.stringify({ done: true, content: 'Text-only binary policy fixture' })); }]);
  const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { port } = await app.listen(0), references = [];
  const platform = {
    request(options) { void fetch(options.url, { method: options.method, headers: options.header, body: options.data ? JSON.stringify(options.data) : undefined }).then(async response => options.success({ statusCode: response.status, data: await response.json() })).catch(options.fail); },
    downloadFile(options) { void fetch(options.url, { headers: options.header }).then(async response => { const tempFilePath = directory + '/download.bin'; await fs.writeFile(tempFilePath, Buffer.from(await response.arrayBuffer())); options.success({ statusCode: response.status, tempFilePath }); }).catch(options.fail); },
    getFileSystemManager() { return { readFile(options) { void fs.readFile(options.filePath).then(bytes => options.success({ data: bytes.toString(options.encoding) })).catch(options.fail); }, getFileInfo(options) { assert.equal(options.digestAlgorithm, 'sha256'); void fs.readFile(options.filePath).then(bytes => options.success({ digest: hash(bytes) })).catch(options.fail); } }; },
  };
  const client = new WorkspaceClient(platform, { baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
  const conversation = (await app.runtime.createConversation({})).conversation;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z0kAAAAASUVORK5CYII=', 'base64');
  for (const [name, bytes] of [['input.pdf', pdf], ['input.png', png]]) {
    const filename = directory + '/' + name; await fs.writeFile(filename, bytes);
    const reference = await client.upload(conversation.id, name, filename, bytes.length); references.push(reference);
    assert.equal(reference.sha256, hash(bytes));
    assert.deepEqual(await fs.readFile(await client.download(reference)), bytes);
  }
  const sent = await client.send(conversation.id, 'Text-only request with saved binaries', references);
  await until(() => app.runtime.getRun(sent.run.id).run.status !== 'running');
  assert.equal(app.runtime.getRun(sent.run.id).run.status, 'succeeded');
  assert.deepEqual(app.runtime.getRun(sent.run.id).run.inputContextSnapshot.artifacts, []);
  assert.equal(observed.includes(pdf.toString()), false);
  console.log(JSON.stringify({ probe: 'real-mini-binary-transport', uploadedArtifacts: references.length, exactDownloadSHA: true, binaryInputsParsed: false, providerCalls: faux.state.callCount, wechatDevice: false }));
});

for (const mode of ['missing', 'cached', 'missing-rounds']) test(`requirement: official OpenAI-compatible Pi usage preserves ${mode} usage semantics`, async t => {
  const directory = await fs.mkdtemp('/tmp/independent-pi-usage-');
  const requestLimits = [];
  let artifactId;
  const server = http.createServer(async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    const body = JSON.parse(bytes); requestLimits.push(body.max_tokens ?? body.max_completion_tokens);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const common = { id: 'fixture-completion', object: 'chat.completion.chunk', created: 1, model: 'fixture-model' };
    const tool = mode === 'missing-rounds' && requestLimits.length < 4;
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call-' + requestLimits.length, type: 'function', function: { name: 'workspace_input', arguments: JSON.stringify({ kind: 'artifact', id: artifactId }) } }] } : { role: 'assistant', content: mode === 'missing-rounds' ? JSON.stringify({ done: true, content: 'Offline bounded goal fixture' }) : 'Offline usage fixture answer' };
    const chunk = { ...common, choices: [{ index: 0, delta, finish_reason: null }] };
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\n');
    if (mode === 'cached') res.write('data: ' + JSON.stringify({ ...common, choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 80 } } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const models = createModels();
  models.setProvider(createProvider({ id: 'fixture-loopback', name: 'Offline OpenAI SSE fixture', baseUrl, auth: { apiKey: { name: 'In-memory fixture', resolve: async () => ({ auth: { apiKey: 'fixture-not-real' } }) } }, models: [{ id: 'fixture-model', name: 'fixture-model', api: 'openai-completions', provider: 'fixture-loopback', baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1600 }], api: openAICompletionsApi() }));
  const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'fixture-loopback', model: 'fixture-model' }) });
  t.after(async () => { await app.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  let runId;
  if (mode === 'missing-rounds') {
    const artifact = (await app.artifacts.create({ filename: 'usage-fixture.txt', content: 'Selected fixture input' })).artifact; artifactId = artifact.id;
    const goal = (await app.runtime.createGoal({ title: 'Bounded usage fixture', maxSteps: 1, maxOutputTokens: 1600, inputContext: { artifacts: [{ id: artifactId, version: 1 }], skills: [], memoryIds: [], connectorActions: [] } })).goal;
    runId = (await app.runtime.updateGoal(goal.id, { action: 'start' })).goal.runId;
  } else {
    const conversation = (await app.runtime.createConversation({})).conversation;
    runId = (await app.runtime.sendMessage(conversation.id, { content: 'Offline usage test', requestId: 'independent-usage-' + mode })).run.id;
  }
  await until(() => app.runtime.getRun(runId).run.status !== 'running');
  const run = app.runtime.getRun(runId).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  console.log(JSON.stringify({ probe: 'pi-usage-' + mode, usage: run.usage, usageStatus: run.usageStatus, expected: mode.startsWith('missing') ? 'unknown, not measured zero; preserve reserved allowance' : { promptTokens: 100, completionTokens: 5, totalTokens: 105 } }));
  if (mode === 'missing-rounds') {
    console.log(JSON.stringify({ probe: 'pi-reservation-with-missing-usage', admittedOutputAllowance: run.budget.maxOutputTokens, perModelRequestOutputCaps: requestLimits, totalGrantedCeilings: requestLimits.reduce((a, b) => a + b, 0), reportedUsage: run.usage }));
    assert.ok(requestLimits.reduce((a, b) => a + b, 0) <= run.budget.maxOutputTokens, 'Unknown-usage rounds must conservatively consume original reserved allowance');
  } else if (mode === 'missing') assert.equal(run.usageStatus, 'unknown', 'Absent provider usage must not become complete measured zeros');
  else assert.equal(run.usage.promptTokens, 100, 'Cached input remains part of total prompt tokens');
});
