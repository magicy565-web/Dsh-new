import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
import { MuseWorkerError } from '../server/muse-worker-api.mjs';
import { createWorkspaceClient } from '../tui/workspace-client.mjs';

// Execute the actual overlay route/binding bytes. The snapshot lacks the original
// Harness modules: reuse the identical server dependency APIs and explicitly stub
// its error/field and unused legacy Worker/file-gate helpers. The HTTP response/body helpers are extracted unchanged from server/index; static and file routes are forbidden by the fixture. This is not original Harness boot or live Muse.
const helper = `export class WorkspacePluginError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 409; }
}
export const pluginFail = (code, message) => { throw new WorkspacePluginError(code, message); };
export const pluginFields = (body, fields) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key)))
    pluginFail('WORKSPACE_PLUGIN_INPUT', 'Unexpected fixture request fields');
};`;
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function overlayModule(name, replacements = {}) {
  const location = new URL('../deploy/muse-native-overlay/server/' + name, import.meta.url);
  let source = fs.readFileSync(location, 'utf8');
  source = source.replace(/from '([^']+)'/g, (text, specifier) => {
    if (!specifier.startsWith('.')) return text;
    const filename = specifier.split('/').at(-1);
    return `from '${replacements[filename] ?? new URL('../server/' + filename, import.meta.url).href}'`;
  });
  // Preserve the original default path value when evaluating source as a data URL.
  source = source.replace("fileURLToPath(new URL('../dist', import.meta.url))", JSON.stringify(new URL('../deploy/muse-native-overlay/dist', import.meta.url).pathname));
  return data(source);
}
const indexSource = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const httpHelpers = indexSource.slice(indexSource.indexOf('async function respond('), indexSource.indexOf('async function staticResponse('));
assert.ok(httpHelpers.includes('async function readBody('));
const httpModule = `import { ApiError } from '${new URL('../server/runtime.mjs', import.meta.url).href}';
${httpHelpers}
export { respond, readBody };
export function staticResponse() { throw new Error('No static serving in this fixture'); }`;
const bindingModule = overlayModule('muse-worker-native.mjs');
const { createNativeMuseBinding } = await import(bindingModule);
const { createWorkspacePluginFrontend } = await import(overlayModule('workspace-plugin-frontend.mjs', {
  'workspace-plugin-config.mjs': data(helper), 'muse-worker-native.mjs': bindingModule,
  'personal-worker.mjs': data('export class WorkerGatewayError extends Error {}; export const WORKER_BODY_LIMIT = 30000;'),
  'index.mjs': data(httpModule),
  'file-limits.mjs': data(`export const FILE_BODY_MAX_BYTES = 30000;
    export const DEFAULT_FILE_LIMITS = { maxConcurrentFileRequests: 1 };
    export const validateFileLimits = value => value;
    export const createFileRequestGate = () => ({ status: () => ({}), admit() { throw new Error('No file requests in bootstrap fixture'); } });`),
}));
const { WorkspacePluginError } = await import(data(helper));

// Exercise the actual service forwarding method without pretending the missing
// original Harness service dependencies were booted or a new owner was granted.
const serviceSource = fs.readFileSync(new URL('../deploy/muse-native-overlay/server/workspace-plugin-service.mjs', import.meta.url), 'utf8');
const forwarding = serviceSource.match(/      readBinding\(actor\) \{[\s\S]*?\n      \},\n(?=      bindConversation\(actor\))/)?.[0];
assert.ok(forwarding, 'Original service readBinding forwarding method must exist');
const bindService = binding => new Function('MuseWorkerError', 'museRest', 'return ({' + forwarding + '});')(MuseWorkerError, binding);
const actor = { subject: 'offline-owner', nativeAgentId: 'original-session' };
const other = { subject: 'offline-other', nativeAgentId: 'other-session' };
const viewer = { subject: 'offline-viewer', nativeAgentId: 'viewer-session' };
const original = { id: actor.nativeAgentId, ...actor };
const origin = 'https://native-bootstrap.test';

async function fixture(t, { conversations = [original], nativeEnabled = true, subject = actor.subject, boundActor = actor } = {}) {
  const actor = boundActor;
  const directory = await mkdtemp('/tmp/workspace-native-bootstrap-');
  const context = new AsyncLocalStorage();
  let epoch = 1, paused = false, businessWrites = 0;
  const state = { conversations: structuredClone(conversations), workerOrders: [], artifacts: [], activity: [], messages: [] };
  const check = () => {
    const token = context.getStore();
    if (token?.epoch !== epoch) throw new WorkspacePluginError('WORKSPACE_PLUGIN_STALE', 'Original epoch changed');
    if (token.active && paused) throw new WorkspacePluginError('WORKSPACE_PLUGIN_PAUSED', 'Original scope paused');
  };
  const store = { read: () => structuredClone(state), update() { businessWrites++; assert.fail('Binding discovery must not write business state'); } };
  const binding = createNativeMuseBinding({ store, artifacts: { create() { assert.fail('No artifact creation'); }, download() { assert.fail('No file read'); } },
    actor, operators: [actor, other, viewer], expectedHost: 'native-bootstrap.test',
    config: { workerId: 'a867e591-e244-4eb1-b095-f6f29d9787b4', ownerId: 'offline-muse',
      tokenDigest: createHash('sha256').update('synthetic-offline-worker-fixture').digest('hex'), enabled: nativeEnabled, scopeReviewed: true, externalBudgetVerified: true },
    run: (callback, { active }) => context.run({ epoch: 1, active }, async () => { check(); const result = await callback(); check(); return result; }),
    readBody() { assert.fail('Discovery must not read Worker bodies'); }, respond() { assert.fail('Discovery must not use Worker transport'); } });
  const pair = generateKeyPairSync('ed25519'); // Disposable loopback assertion fixture only.
  const access = { mode: 'enterprise', workspaceId: 'offline-workspace', publicOrigin: origin, issuer: 'offline-ingress', keyId: 'offline-key',
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [
      { subject: actor.subject, role: 'admin' }, { subject: other.subject, role: 'admin' }, { subject: viewer.subject, role: 'viewer' }] };
  const projection = { ...state, runtime: {}, diagnostics: { blockers: [] }, capabilities: {} };
  const muse = { enabled: true, ...bindService(binding), bindConversation: binding.bindConversation };
  const service = { muse, bindActor: () => ({}), bindNativeResults() {
    throw Object.assign(Error('Explicit absent Harness result fixture'), { code: 'WORKSPACE_NATIVE_RESULT_BINDING_REQUIRED' });
  }, bindFrontend: () => ({ snapshot: async () => structuredClone(projection) }) };
  const frontend = await createWorkspacePluginFrontend({ service, operators: [actor, other, viewer], dataDirectory: directory, access });
  const address = await frontend.listen(0);
  t.after(async () => { await frontend.close(); await binding.close(); await rm(directory, { recursive: true, force: true }); });
  const sessions = new Map();
  async function api(target, { method = 'GET', body, as = subject, authenticated = true, signed = true } = {}) {
    const bytes = body === undefined ? '' : JSON.stringify(body), session = sessions.get(as);
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: address.port, path: target, method, headers: {
        Host: 'native-bootstrap.test', Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(authenticated && session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
        ...(signed ? { 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, subject: as, method, target, body: bytes }) } : {}),
        ...(target === '/api/session/login' ? { 'X-Workspace-Login': '1' } : {}),
      } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)), cookie: response.headers['set-cookie']?.[0]?.split(';')[0] }));
      });
      request.on('error', reject); request.end(bytes || undefined);
    });
  }
  for (const member of [actor, other, viewer]) {
    const result = await api('/api/session/login', { method: 'POST', body: {}, as: member.subject, authenticated: false });
    assert.equal(result.status, 200); sessions.set(member.subject, { cookie: result.cookie, csrf: result.body.csrfToken });
  }
  const client = createWorkspaceClient(({ method, path, body }) => api(path, { method, body }));
  return { binding, api, client, muse, state, store, projection, writes: () => businessWrites, revoke() { epoch++; }, pause() { paused = true; } };
}

test('Pi client accepts actual old overlay bootstrap only for existing original owned binding (offline)', async t => {
  const f = await fixture(t), before = f.store.read();
  assert.deepEqual(await f.client.connect(), { workspaceId: 'offline-workspace', subject: actor.subject, conversationId: actor.nativeAgentId, onlineVerified: false });
  assert.deepEqual((await f.api('/api/bootstrap')).body.museBinding, { originalBinding: true, conversationId: actor.nativeAgentId, onlineVerified: false });
  assert.equal(f.writes(), 0); assert.deepEqual(f.store.read(), before);
  f.pause(); assert.equal((await f.client.connect()).conversationId, actor.nativeAgentId);
  f.revoke(); await assert.rejects(f.client.connect(), { code: 'WORKSPACE_PLUGIN_STALE' });
  assert.equal(f.writes(), 0);
});

test('old overlay does not infer original binding from enabled gates or invalid stored rows (offline)', async t => {
  const f = await fixture(t);
  // A business snapshot must never substitute for the original guarded proof.
  f.projection.museBinding = { originalBinding: true, conversationId: 'unverified-business-snapshot' };
  for (const rows of [undefined, null, {}, [], [{ ...original, id: 'different' }], [{ ...original, subject: other.subject }],
    [{ ...original, nativeAgentId: other.nativeAgentId }], [original, original], [original, { ...original, subject: other.subject }]]) {
    f.state.conversations = rows;
    assert.deepEqual((await f.api('/api/bootstrap')).body.museBinding, { originalBinding: false });
    await assert.rejects(f.client.connect(), { code: 'MW_ORIGINAL_BINDING_REQUIRED' });
  }
  assert.equal(f.writes(), 0);
});

test('old overlay bootstrap does not expose native binding to viewer, foreign admin or unsigned session (offline)', async t => {
  const f = await fixture(t);
  for (const as of [viewer.subject, other.subject])
    assert.deepEqual((await f.api('/api/bootstrap', { as })).body.museBinding, { originalBinding: false });
  for (const options of [{ authenticated: false }, { signed: false }]) {
    const denied = await f.api('/api/bootstrap', options);
    assert.ok(denied.status >= 400); assert.equal(JSON.stringify(denied.body).includes(actor.nativeAgentId), false);
  }
  assert.equal(f.writes(), 0);
});

test('old overlay bootstrap fails closed across missing forwarding and binding closure (offline)', async t => {
  const f = await fixture(t);
  f.muse.enabled = false;
  assert.deepEqual((await f.api('/api/bootstrap')).body.museBinding, { originalBinding: false });
  f.muse.enabled = true;
  const read = f.muse.readBinding; delete f.muse.readBinding;
  assert.deepEqual((await f.api('/api/bootstrap')).body.museBinding, { originalBinding: false });
  f.muse.readBinding = read;
  await f.binding.close();
  const closed = await f.api('/api/bootstrap');
  assert.equal(closed.status, 503); assert.equal(closed.body.error.code, 'MW_GATEWAY_CLOSED');
  assert.throws(() => bindService(null).readBinding(actor), { code: 'MW_GATEWAY_UNAVAILABLE' });
  assert.equal(f.writes(), 0);
});


test('Pi list keeps encoded original native conversation identifiers through old overlay routes (offline)', async t => {
  for (const nativeAgentId of ['original:tui/conversation', 'original@session']) {
    const boundActor = { ...actor, nativeAgentId };
    const f = await fixture(t, { boundActor, conversations: [{ id: nativeAgentId, ...boundActor }] });
    assert.equal((await f.client.connect()).conversationId, nativeAgentId);
    assert.deepEqual(await f.client.list(), { delegations: [] });
    assert.equal(f.writes(), 0);
  }
});


test('old overlay decodes conversation segments once and retains original ownership denials (offline)', async t => {
  const boundActor = { ...actor, nativeAgentId: 'original:tui/conversation' };
  const f = await fixture(t, { boundActor, conversations: [{ id: boundActor.nativeAgentId, ...boundActor }] });
  const encoded = encodeURIComponent(boundActor.nativeAgentId);
  for (const segment of ['%GG', '%E0%A4%A']) {
    const response = await f.api(`/api/conversations/${segment}/muse-delegations`);
    assert.equal(response.status, 400); assert.equal(response.body.error.code, 'INVALID_PATH');
    const message = await f.api(`/api/conversations/${segment}/messages`, { method: 'POST', body: { provider: 'muse' } });
    assert.equal(message.status, 400); assert.equal(message.body.error.code, 'INVALID_PATH');
  }
  for (const segment of [encodeURIComponent(encoded), encodeURIComponent(other.nativeAgentId)]) {
    const response = await f.api(`/api/conversations/${segment}/muse-delegations`);
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'WORKSPACE_PLUGIN_OWNER');
  }
  for (const as of [viewer.subject, other.subject]) {
    const response = await f.api(`/api/conversations/${encoded}/muse-delegations`, { as });
    assert.ok(response.status >= 400); assert.equal(response.body.delegations, undefined);
  }
  // Route-only mutation probe: reach the original owned binding, then stop
  // before preparation. This does not claim actual queue or model execution.
  let prepareCalls = 0;
  f.muse.bindConversation = owner => {
    assert.deepEqual(owner, boundActor);
    return { prepare() { prepareCalls++; throw new MuseWorkerError(409, 'OFFLINE_PREPARE_REACHED', 'Offline route probe; no execution'); } };
  };
  const message = await f.api(`/api/conversations/${encoded}/messages`, { method: 'POST', body: { provider: 'muse' } });
  assert.equal(message.status, 409); assert.equal(message.body.error.code, 'OFFLINE_PREPARE_REACHED');
  assert.equal(prepareCalls, 1); assert.equal(f.writes(), 0);
});
