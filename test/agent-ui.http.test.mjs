import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
import { request } from './agent-service.helpers.mjs';

const API = '/api/agent-ui/v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const code = response => response.json.code || response.json.error?.code;
async function until(check) { for (let i = 0; i < 700; i++) { if (await check()) return; await pause(5); } throw new Error('Original Agent state did not settle.'); }
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', { analysis: [{ text: '公开规格需按同一口径核对，报价仍待回收。', sources: ['input.product'] }], recommendations: [{ text: '请人工核对询价文书。', sources: [] }], questions: [{ text: '币种及贸易口径是什么？', sources: [] }] }), { stopReason: 'toolUse' });
const interrupted = () => async (_request, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); };

async function fixture(t, { enabled = true, configured = true, demo = false, responses = [complete(), complete(), complete(), complete()] } = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-agent-ui-http-');
  const keys = generateKeyPairSync('ed25519'), faux = fauxProvider();
  faux.models[0].baseUrl = 'https://fixture-model.example/v1'; faux.setResponses(responses);
  let clock = Date.now(), destination = 'https://fixture-model.example/v1', currentConfigured = configured;
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'ui-fixture', issuer: 'ui-fixture-ingress', keyId: 'ui-fixture-key', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    members: [{ subject: 'admin', role: 'admin' }, { subject: 'operator', role: 'operator' }, { subject: 'other', role: 'operator' }, { subject: 'viewer', role: 'viewer' }, { subject: 'unbound', role: 'operator' }, { subject: 'readonly', role: 'operator' }, { subject: 'expiring', role: 'operator' }] };
  const bindings = ['admin', 'operator', 'other', 'viewer', 'readonly', 'expiring'].map(subject => ({ subject, workspaceId: access.workspaceId, tokenSha256: sha('isolated-fixture-credential-' + subject), scopes: subject === 'readonly' ? ['agent:read'] : ['agent:read', 'agent:submit'], ...(subject === 'expiring' ? { expiresAt: new Date(clock + 20_000).toISOString() } : {}) }));
  let app, base, provider;
  async function open() {
    faux.models[0].baseUrl = destination; const models = createModels(); models.setProvider(faux.provider);
    provider = currentConfigured ? createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) : createPiProvider();
    app = await createApp({ dataDirectory: directory, access, accessClock: () => clock, capabilityEnvironment: {}, provider, agentConfig: { env: { ...(enabled ? { WS_AGENT_UI_ENABLED: '1' } : {}), ...(demo ? { WS_AGENT_DEMO: '1' } : {}) }, principals: bindings } });
    const address = await app.listen(0); base = 'http://127.0.0.1:' + address.port;
  }
  await open(); t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const f = { faux, bindings, access, keys, directory, get app() { return app; }, get provider() { return provider; }, get base() { return base; }, get clock() { return clock; }, advance(ms) { clock += ms; },
    async api(route, { method = 'GET', body, subject = 'operator', session, headers = {}, signedBody } = {}) {
      const bytes = body === undefined ? '' : JSON.stringify(body);
      return request(base, route, { method, ...(body === undefined ? {} : { body }), headers: { Host: 'workspace.example', ...(!['GET', 'HEAD'].includes(method) ? { Origin: access.publicOrigin } : {}),
        'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: keys.privateKey, ...access, subject, method, target: route, body: signedBody ?? bytes, now: clock }),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...headers } });
    },
    async login(subject = 'operator') { const r = await this.api('/api/session/login', { method: 'POST', body: {}, subject, headers: { 'X-Workspace-Login': '1' } }); assert.equal(r.status, 200, r.text); return { cookie: r.headers['set-cookie'][0].split(';')[0], csrfToken: r.json.csrfToken }; },
    async source(session, options = {}) { const r = await this.api('/api/artifacts', { method: 'POST', session, body: { filename: 'public-spec.txt', content: 'Public bottle specification: 500 ml, stainless steel. Source facts only; no verified quotes.', requestId: randomUUID(), ...options } }); assert.equal(r.status, 201, r.text); return r.json.artifact; },
    draft(artifact, requestKey = randomUUID()) { return { type: 'procurement', title: '公开瓶规格询价文书', input: { product: 'Public bottle', spec: '500 ml stainless steel', quantity: '100 pieces' }, source: { artifactId: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256, url: 'https://public-spec.example/bottle', date: '2026-10-13' }, requestKey }; },
    async preview(draft, session, options = {}) { return this.api(API + '/preview', { method: 'POST', body: draft, session, ...options }); },
    async submit(draft, preview, session, options = {}) { return this.api(API + '/tasks', { method: 'POST', body: { ...draft, confirmed: true, expectedPreviewHash: preview.previewHash }, session, headers: { 'Idempotency-Key': draft.requestKey }, ...options }); },
    task(id) { return app.store.read().workspaceAgentTasks.tasks.find(task => task.id === id); },
    async terminal(id) { await until(() => ['done', 'failed', 'interrupted'].includes(this.task(id)?.status)); },
    async restart({ nextDestination = destination, nextConfigured = currentConfigured } = {}) { await app.close(); destination = nextDestination; currentConfigured = nextConfigured; await open(); },
  };
  return f;
}

test('enterprise UI previews exact disclosure with zero Pi calls, confirms original task, persists document review and checks downloadable SHA', async t => {
  const f = await fixture(t), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact, 'original-ui-key');
  const status = await f.api(API + '/status', { session }); assert.equal(status.json.readiness, 'configured_unverified'); assert.deepEqual(status.json.permissions, { read: true, submit: true }); assert.equal(status.json.budget.monetaryLimit, false);
  const p = await f.preview(draft, session); assert.equal(p.status, 200, p.text); assert.equal(p.json.recipient.destination, 'https://fixture-model.example/v1'); assert.equal(p.json.source.content, (await f.app.artifacts.read(artifact.id)).content); assert.equal(sha(p.json.source.content), artifact.sha256); assert.match(p.json.executionInput.requirements, /public-spec.example/); assert.equal(p.json.futureAccess, false);
  assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  const [a, b] = await Promise.all([f.submit(draft, p.json, session), f.submit(draft, p.json, session)]); assert.equal(a.status, 201, a.text); assert.equal(b.status, 201, b.text); assert.equal(a.json.taskId, b.json.taskId); const id = a.json.taskId;
  await f.terminal(id); assert.equal(f.faux.state.callCount, 4); assert.equal(f.app.store.read().runs.length, 4); assert.equal(f.task(id).uiApproval.previewHash, p.json.previewHash); assert.equal(f.task(id).uiApproval.oneTime, true);
  const detail = await f.api(API + '/tasks/' + id, { session }); assert.equal(detail.json.result.completion, 'documents_ready'); assert.equal(detail.json.result.businessGoalAchieved, false); assert.deepEqual(detail.json.artifacts.map(x => x.name), ['inquiry-pack.md', 'comparison.md', 'procurement-brief.md']);
  for (const file of detail.json.artifacts) { assert.ok(file.url.startsWith(API)); const download = await f.api(file.url + '?sha256=' + file.sha256, { session }); assert.equal(download.status, 200, download.text); assert.equal(sha(download.bytes), file.sha256); assert.equal(download.headers['x-artifact-sha256'], file.sha256); assert.equal((await f.api(file.url + '?sha256=' + '0'.repeat(64), { session })).status, 409); }
  const history = await f.api(API + '/tasks/' + id + '/events?format=json', { session }); assert.ok(Array.isArray(history.json)); assert.equal(history.json.at(-1).kind, 'done');
  assert.equal(detail.json.toolObservations.source, 'original-run-events'); assert.ok(detail.json.toolObservations.events.some(event => event.type === 'pi.tool.finished' && event.toolName === 'workspace_complete_preset_stage')); assert.ok(detail.json.toolObservations.events.every(event => Object.keys(event).sort().join(',') === 'createdAt,runId,sequence,stageKey,toolCallId,toolName,type'));
  const review = await f.api(API + '/tasks/' + id + '/review', { method: 'POST', session, body: { decision: 'accepted', note: '人工已核对规格与待回收报价。' } }); assert.equal(review.status, 200, review.text); assert.equal(review.json.humanReview.externalActionAuthorized, false); assert.equal(review.json.humanReview.artifactHashes.length, 3);
  await f.restart(); const newSession = await f.login(); const replay = await f.submit(draft, p.json, newSession); assert.equal(replay.json.taskId, id); assert.equal(replay.headers['idempotency-replayed'], 'true'); assert.equal(f.faux.state.callCount, 4);
  const restored = await f.api(API + '/tasks/by-request/' + draft.requestKey, { session: newSession }); assert.equal(restored.json.humanReview.decision, 'accepted'); assert.equal(restored.json.disclosure.source.sha256, artifact.sha256);
});

test('original signed Session, CSRF, owner isolation, viewer and existing scopes remain mandatory', async t => {
  const f = await fixture(t), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact);
  assert.equal((await f.api(API + '/status')).status, 401);
  const csrf = await f.preview(draft, session, { headers: { 'X-CSRF-Token': '' } }); assert.equal(csrf.status, 403); assert.equal(code(csrf), 'CSRF_REJECTED');
  const mismatch = await f.preview(draft, session, { signedBody: '{}' }); assert.equal(mismatch.status, 401); assert.equal(code(mismatch), 'ASSERTION_BODY_MISMATCH');
  const bearer = await f.api(API + '/status', { session, headers: { Authorization: 'Bearer isolated-fixture-credential-operator' } }); assert.equal(bearer.status, 400); assert.equal(code(bearer), 'AGENT_UI_BEARER_REJECTED');
  for (const [subject, expected] of [['unbound', 'AGENT_PRINCIPAL_REQUIRED'], ['readonly', 'AGENT_SUBMIT_SCOPE_REQUIRED']]) { const s = await f.login(subject), status = await f.api(API + '/status', { subject, session: s }); assert.ok(status.json.blockers.some(x => x.code === expected)); const denied = await f.preview(draft, s, { subject }); assert.equal(denied.status, 403); assert.equal(code(denied), expected); }
  const viewer = await f.login('viewer'), v = await f.preview(draft, viewer, { subject: 'viewer' }); assert.equal(v.status, 403); assert.equal(code(v), 'ROLE_REQUIRED');
  const p = await f.preview(draft, session), created = await f.submit(draft, p.json, session); assert.equal(created.status, 201, created.text); await f.terminal(created.json.taskId);
  const other = await f.login('other'); for (const route of ['/tasks/' + created.json.taskId, '/tasks/by-request/' + draft.requestKey, '/tasks/' + created.json.taskId + '/events?format=json', '/tasks/' + created.json.taskId + '/artifacts/inquiry-pack.md']) { const denied = await f.api(API + route, { subject: 'other', session: other }); assert.equal(denied.status, 404, denied.text); }
  assert.deepEqual((await f.api(API + '/tasks', { subject: 'other', session: other })).json.tasks, []);
});

test('disabled UI and unconfigured original model report distinct blockers without calls', async t => {
  const off = await fixture(t, { enabled: false }), offSession = await off.login(); const state = await off.api(API + '/status', { session: offSession }); assert.equal(state.json.enabled, false); assert.ok(state.json.blockers.some(x => x.code === 'AGENT_UI_DISABLED'));
  const absent = await fixture(t, { configured: false }), session = await absent.login(), artifact = await absent.source(session), draft = absent.draft(artifact); const p = await absent.preview(draft, session); assert.equal(p.status, 409); assert.equal(code(p), 'PI_MODEL_UNCONFIGURED'); assert.equal(absent.faux.state.callCount, 0);
});

test('private library, Muse-linked receipts, exact private copies, binary, raw credentials and stale source versions are never relabeled', async t => {
  const f = await fixture(t), session = await f.login();
  const internal = await f.source(session, { filename: 'internal.txt', content: 'Confidential private enterprise composition and prices.', metadata: { businessLibrary: { visibility: 'internal' } } });
  const copied = await f.source(session, { filename: 'public-copy.txt', content: 'Confidential private enterprise composition and prices.' });
  const muse = (await f.app.artifacts.create({ filename: 'private-muse.txt', content: 'Original private Muse receipt content.', metadata: { museNativeAgentId: 'private-native-fixture' } })).artifact;
  const secret = await f.source(session, { filename: 'credential.txt', content: 'api_key=isolated_fake_secret_never_used' });
  const image = await f.source(session, { filename: 'image.png', content: undefined, base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') });
  for (const [artifact, expected] of [[internal, 'AGENT_PRIVATE_SOURCE_REJECTED'], [muse, 'AGENT_PRIVATE_SOURCE_REJECTED'], [copied, 'AGENT_PRIVATE_COPY_REJECTED'], [secret, 'RAW_CREDENTIAL_REJECTED'], [image, 'AGENT_SOURCE_TYPE_UNSUPPORTED']]) { const p = await f.preview(f.draft(artifact), session); assert.ok([400, 403].includes(p.status), p.text); assert.equal(code(p), expected); }
  const source = await f.source(session), draft = f.draft(source), p = await f.preview(draft, session); assert.equal(p.status, 200);
  await f.app.artifacts.update(source.id, { content: 'Changed public specification v2.', expectedRevision: 1 });
  const selectedV1 = await f.preview(draft, session); assert.equal(selectedV1.status, 200); assert.equal(selectedV1.json.source.version, 1); assert.equal(selectedV1.json.previewHash, p.json.previewHash); assert.equal(selectedV1.json.source.sha256, source.sha256);
  const wrongSha = await f.preview({ ...draft, source: { ...draft.source, sha256: '0'.repeat(64) } }, session); assert.equal(wrongSha.status, 409); assert.equal(code(wrongSha), 'AGENT_SOURCE_STALE');
  await f.app.artifacts.update(source.id, { metadata: { businessLibrary: { visibility: 'internal' } }, expectedRevision: 2 });
  const stale = await f.submit(draft, p.json, session); assert.equal(stale.status, 403); assert.equal(code(stale), 'AGENT_PRIVATE_SOURCE_REJECTED'); assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});

test('preview binds payload, HTTPS source, destination, preset and principal fingerprints before submission', async t => {
  const f = await fixture(t), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session); assert.equal(p.status, 200, p.text);
  for (const changed of [{ ...draft, input: { ...draft.input, quantity: 101 } }, { ...draft, source: { ...draft.source, date: '2026-10-12' } }, { ...draft, source: { ...draft.source, url: 'https://public-spec.example/other' } }]) { const rejected = await f.submit(changed, p.json, session); assert.equal(rejected.status, 409); assert.equal(code(rejected), 'AGENT_PREVIEW_CHANGED'); }
  const unconfirmed = await f.api(API + '/tasks', { method: 'POST', session, body: { ...draft, confirmed: false, expectedPreviewHash: p.json.previewHash }, headers: { 'Idempotency-Key': draft.requestKey } }); assert.equal(unconfirmed.status, 400);
  await f.restart({ nextDestination: 'https://different-fixture-model.example/v1' }); const newSession = await f.login(); const changed = await f.submit(draft, p.json, newSession); assert.equal(changed.status, 409); assert.equal(code(changed), 'AGENT_PREVIEW_CHANGED'); assert.equal(f.faux.state.callCount, 0);
});

test('original task restart pauses Pi and explicit Session resume retains task, checkpoint and partial files', async t => {
  const f = await fixture(t, { responses: [complete(), complete(), interrupted()] }), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session), submitted = await f.submit(draft, p.json, session); assert.equal(submitted.status, 201, submitted.text); const id = submitted.json.taskId;
  await until(() => f.task(id)?.steps[2].runId && f.faux.state.callCount === 3 && f.app.runtime.getRun(f.task(id).steps[2].runId).run.piSubmissionId); const run = f.app.runtime.getRun(f.task(id).steps[2].runId).run; const file = await f.api(API + '/tasks/' + id + '/artifacts/inquiry-pack.md', { session }); assert.equal(file.status, 200);
  f.faux.setResponses([complete(), complete()]); await f.restart(); await until(() => f.task(id)?.status === 'interrupted'); const fresh = await f.login(); await pause(40); assert.equal(f.faux.state.callCount, 3);
  const bypass = await request(f.base, '/api/agent/v1/tasks/' + id + '/resume', { method: 'POST', body: {}, token: 'isolated-fixture-credential-operator', headers: { Host: 'workspace.example' } }); assert.equal(bypass.status, 409, bypass.text); assert.equal(code(bypass), 'AGENT_UI_TASK_ROUTE_REQUIRED'); assert.equal(f.faux.state.callCount, 3);
  const resumed = await f.api(API + '/tasks/' + id + '/resume', { method: 'POST', session: fresh, body: {} }); assert.equal(resumed.status, 200, resumed.text); await f.terminal(id); assert.equal(f.task(id).status, 'done'); assert.equal(f.app.runtime.getRun(run.id).run.piSubmissionId, run.piSubmissionId); assert.equal(f.app.store.read().runs.length, 4); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(sha((await f.api(API + '/tasks/' + id + '/artifacts/inquiry-pack.md', { session: fresh })).bytes), sha(file.bytes));
});

test('partial Pi failure preserves truthful incomplete result and original artifacts', async t => {
  const f = await fixture(t, { responses: [complete(), complete(), fauxAssistantMessage('Unstructured response has no valid document receipt.')] }), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session), s = await f.submit(draft, p.json, session); assert.equal(s.status, 201, s.text); await f.terminal(s.json.taskId);
  const detail = await f.api(API + '/tasks/' + s.json.taskId, { session }); assert.equal(detail.json.status, 'failed'); assert.equal(detail.json.result.state, 'partial'); assert.equal(detail.json.result.businessGoalAchieved, false); assert.ok(detail.json.artifacts.some(file => file.name === 'inquiry-pack.md')); assert.ok(detail.json.artifacts.some(file => file.name.startsWith('partial-')));
  const review = await f.api(API + '/tasks/' + s.json.taskId + '/review', { method: 'POST', session, body: { decision: 'accepted', note: '' } }); assert.equal(review.status, 409); assert.equal(code(review), 'AGENT_DOCUMENTS_NOT_READY');
});

test('SSE watches the exact original Session and expiring Agent scope, never a Bearer token watcher', async t => {
  const f = await fixture(t, { responses: [interrupted()] }), session = await f.login('expiring'), artifact = await f.source(await f.login()), draft = f.draft(artifact), p = await f.preview(draft, session, { subject: 'expiring' }), s = await f.submit(draft, p.json, session, { subject: 'expiring' }); assert.equal(s.status, 201, s.text);
  const route = API + '/tasks/' + s.json.taskId + '/events'; let received = '';
  const ended = new Promise((resolve, reject) => { const req = http.request(f.base + route, { headers: { Host: 'workspace.example', Cookie: session.cookie, 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: f.keys.privateKey, ...f.access, subject: 'expiring', method: 'GET', target: route, now: f.clock }) } }, res => { assert.equal(res.statusCode, 200); res.on('data', chunk => { received += chunk; }); res.on('end', resolve); res.on('error', reject); }); req.on('error', reject); req.end(); });
  await until(() => received.includes('accepted')); f.advance(21_000); await Promise.race([ended, pause(2000).then(() => { throw new Error('SSE did not close after original scope expiry.'); })]);
  const denied = await f.api(API + '/tasks/' + s.json.taskId, { subject: 'expiring', session }); assert.equal(denied.status, 403); assert.equal(code(denied), 'AGENT_BINDING_REVOKED');
});

test('original Store admission rejects a public-to-internal source race before admitting any Pi run', async t => {
  const f = await fixture(t), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session);
  const original = f.app.runtime.sendMessage.bind(f.app.runtime); let changed = false;
  f.app.runtime.sendMessage = async (...args) => { if (!changed) { changed = true; await f.app.store.update(state => { state.artifacts.find(item => item.id === artifact.id).metadata = { businessLibrary: { visibility: 'internal' } }; }); } return original(...args); };
  const s = await f.submit(draft, p.json, session); assert.equal(s.status, 201, s.text); await f.terminal(s.json.taskId);
  assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.task(s.json.taskId).result.reason, 'AGENT_PRIVATE_SOURCE_REJECTED');
});

test('Pi dispatch checks the original Store again after Runtime has admitted the run', async t => {
  const f = await fixture(t), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session);
  const original = f.provider.complete.bind(f.provider);
  f.provider.complete = async options => { await f.app.store.update(state => { state.artifacts.find(item => item.id === artifact.id).metadata = { businessLibrary: { visibility: 'internal' } }; }); return original(options); };
  const s = await f.submit(draft, p.json, session); assert.equal(s.status, 201, s.text); await f.terminal(s.json.taskId);
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.faux.state.callCount, 0); assert.equal(f.task(s.json.taskId).result.businessGoalAchieved, false); assert.notEqual(f.task(s.json.taskId).result.completion, 'documents_ready');
});

test('tool and result checks block sources revoked while an already dispatched Pi response is in flight', async t => {
  let release, entered = false; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { responses: [async () => { entered = true; await gate; return complete(); }] }); t.after(() => release());
  const session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session), s = await f.submit(draft, p.json, session); assert.equal(s.status, 201, s.text); await until(() => entered);
  await f.app.store.update(state => { state.artifacts.find(item => item.id === artifact.id).metadata = { businessLibrary: { visibility: 'internal' } }; }); release(); await f.terminal(s.json.taskId);
  assert.equal(f.faux.state.callCount, 1, 'A dispatched call cannot be retroactively un-sent; no next model call is allowed.'); assert.notEqual(f.task(s.json.taskId).result.completion, 'documents_ready'); assert.equal(f.task(s.json.taskId).steps[0].output, null);
});

test('non-UI Bearer tasks keep original scopes, tools and permission fingerprints with no disclosure fallback', async t => {
  const f = await fixture(t), before = f.provider.permissionFingerprint;
  assert.throws(() => f.provider.bindAgentUiAuthorization(() => {}), /binds once/);
  const r = await request(f.base, '/api/agent/v1/tasks', { method: 'POST', token: 'isolated-fixture-credential-operator', headers: { Host: 'workspace.example', 'Idempotency-Key': 'original-bearer-contract' }, body: { type: 'procurement', title: 'Existing bearer task', input: { product: 'Original bottle', spec: '500 ml', quantity: 100 } } }); assert.equal(r.status, 201, r.text); await f.terminal(r.json.taskId);
  assert.equal(f.task(r.json.taskId).uiApproval, undefined); assert.equal(f.provider.permissionFingerprint, before); assert.equal(f.faux.state.callCount, 4); assert.ok(f.app.store.read().runs.every(run => run.agentPresetContext.researchCapabilities.length === 0 && run.connectorGrants.length === 0));
});

test('public UTF-8 BOM source preserves exact bytes, preview SHA and original Pi admission', async t => {
  const f = await fixture(t), session = await f.login(), content = '\ufeffPublic product specification with exact UTF-8 BOM: 500 ml bottle.', artifact = await f.source(session, { filename: 'bom-spec.txt', content }), draft = f.draft(artifact), p = await f.preview(draft, session);
  assert.equal(p.status, 200, p.text); assert.equal(p.json.source.content, content); assert.equal(p.json.source.content.charCodeAt(0), 0xfeff); assert.equal(sha(Buffer.from(p.json.source.content, 'utf8')), artifact.sha256); assert.equal(f.faux.state.callCount, 0);
  const s = await f.submit(draft, p.json, session); assert.equal(s.status, 201, s.text); await f.terminal(s.json.taskId); assert.equal(f.task(s.json.taskId).result.completion, 'documents_ready'); assert.equal(f.task(s.json.taskId).uiApproval.source.content, content);
});

test('SSE closes for revocation of its current original Session even when another Session for the same principal remains valid', async t => {
  const f = await fixture(t, { responses: [interrupted()] }), session = await f.login(), survivor = await f.login(), admin = await f.login('admin'), artifact = await f.source(session), draft = f.draft(artifact), p = await f.preview(draft, session), s = await f.submit(draft, p.json, session); assert.equal(s.status, 201, s.text);
  const route = API + '/tasks/' + s.json.taskId + '/events'; let received = '';
  const ended = new Promise((resolve, reject) => { const req = http.request(f.base + route, { headers: { Host: 'workspace.example', Cookie: session.cookie, 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: f.keys.privateKey, ...f.access, subject: 'operator', method: 'GET', target: route, now: f.clock }) } }, res => { assert.equal(res.statusCode, 200); res.on('data', chunk => { received += chunk; }); res.on('end', resolve); res.on('error', reject); }); req.on('error', reject); req.end(); });
  await until(() => received.includes('accepted'));
  const listed = await f.api('/api/access/sessions', { subject: 'admin', session: admin }); assert.equal(listed.status, 200, listed.text); const id = listed.json.sessions.filter(x => x.subject === 'operator')[0].id;
  const revoke = await f.api('/api/access/sessions/' + id + '/revoke', { method: 'POST', subject: 'admin', session: admin, body: {} }); assert.equal(revoke.status, 200, revoke.text);
  await Promise.race([ended, pause(2000).then(() => { throw new Error('SSE did not close for its revoked current Session.'); })]);
  assert.equal((await f.api(API + '/tasks/' + s.json.taskId, { session })).status, 401); assert.equal((await f.api(API + '/tasks/' + s.json.taskId, { session: survivor })).status, 200);
});

test('explicit original demo stays blocked in real procurement UI while the established Bearer demo remains truthful', async t => {
  const f = await fixture(t, { demo: true }), session = await f.login(), artifact = await f.source(session), draft = f.draft(artifact);
  const status = await f.api(API + '/status', { session }); assert.equal(status.json.readiness, 'demo_not_executable'); assert.ok(status.json.blockers.some(item => item.code === 'AGENT_UI_DEMO_NOT_EXECUTABLE'));
  const p = await f.preview(draft, session); assert.equal(p.status, 409); assert.equal(code(p), 'AGENT_UI_DEMO_NOT_EXECUTABLE'); assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  const r = await request(f.base, '/api/agent/v1/tasks', { method: 'POST', token: 'isolated-fixture-credential-operator', headers: { Host: 'workspace.example', 'Idempotency-Key': 'original-bearer-demo-contract' }, body: { type: 'procurement', title: 'Existing explicit demo', input: draft.input } }); assert.equal(r.status, 201, r.text); await f.terminal(r.json.taskId); assert.equal(f.task(r.json.taskId).result.completion, 'demonstration_only'); assert.equal(f.task(r.json.taskId).result.businessGoalAchieved, false); assert.equal(f.faux.state.callCount, 0);
});
