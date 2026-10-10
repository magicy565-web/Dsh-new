import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { accessConfigFromEnvironment, validateAccessConfig } from '../server/access.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

function httpFetch(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
    request.on('error', reject); request.end(body);
  });
}
const pair = generateKeyPairSync('ed25519'); // Disposable, offline test fixture only.
const publicOrigin = 'https://workspace.example';
function config(overrides = {}) { return { mode: 'enterprise', publicOrigin, workspaceId: 'fixture-workspace', issuer: 'fixture-gateway', keyId: 'fixture-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'admin', role: 'admin' }, { subject: 'operator', role: 'operator' }, { subject: 'reader', role: 'viewer' }], ...overrides }; }
function token(route, method = 'GET', body = '', subject = 'admin', now = Date.now()) { return signWorkspaceRequest({ privateKey: pair.privateKey, ...config(), subject, method, target: route, body, now }); }
function alter(signed, { header = {}, claims = {} } = {}) {
  const parts = signed.split('.');
  const changed = [ { ...JSON.parse(Buffer.from(parts[0], 'base64url')), ...header }, { ...JSON.parse(Buffer.from(parts[1], 'base64url')), ...claims } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${changed}.${sign(null, Buffer.from(changed), pair.privateKey).toString('base64url')}`;
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-access-'));
  let clock = Date.now();
  const settings = { dataDirectory: directory, access: config(options.access), accessClock: () => clock };
  let app = await createApp(settings), address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, { method = 'GET', body, subject = 'admin', session, headers = {}, assertion, unsigned = false } = {}) {
    const bytes = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const response = await httpFetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: { Host: 'workspace.example', ...(['GET', 'HEAD'].includes(method) ? {} : { Origin: publicOrigin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...(unsigned ? {} : { 'X-Workspace-Assertion': assertion || token(route, method, bytes, subject, clock) }), ...headers }, ...(body === undefined ? {} : { body: bytes }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { response, status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function login(subject = 'admin') { const result = await api('/api/session/login', { method: 'POST', body: {}, subject, headers: { 'X-Workspace-Login': '1' } }); assert.equal(result.status, 200, JSON.stringify(result.data)); return { ...result.data, cookie: result.cookie, subject }; }
  return { get app() { return app; }, directory, api, login, get base() { return `http://127.0.0.1:${address.port}`; }, now: () => clock, advance: milliseconds => { clock += milliseconds; }, async restart() { await app.close(); app = await createApp(settings); address = await app.listen(0); } };
}

test('access: enterprise configuration is explicit, HTTPS only, Ed25519 and bounded membership', async () => {
  for (const patch of [{ publicOrigin: 'http://workspace.example' }, { publicOrigin: 'https://localhost' }, { publicOrigin: `${publicOrigin}/` }, { members: [{ subject: 'reader', role: 'viewer' }] }, { members: [{ subject: 'admin', role: 'admin' }, { subject: 'admin', role: 'viewer' }] }, { mode: 'public' }, { publicKey: 'not a key' }, { unknownSetting: true }, { idleTimeoutMs: 0 }]) assert.throws(() => validateAccessConfig(config(patch)), /configuration/);
  assert.throws(() => validateAccessConfig(config(), ['http://127.0.0.1:5173']), /development/);
  assert.throws(() => validateAccessConfig({ mode: 'local', publicOrigin }), /explicit enterprise/);
  await assert.rejects(accessConfigFromEnvironment({ NODE_ENV: 'production' }), /explicit WORKSPACE_ACCESS_MODE/);
  await assert.rejects(accessConfigFromEnvironment({ WORKSPACE_ACCESS_MODE: 'enterprise' }), /members file/);
});

test('access: default local mode remains usable and reports local session without creating cookies', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-local-access-'));
  const app = await createApp({ dataDirectory: directory }); const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const response = await httpFetch(`http://127.0.0.1:${address.port}/api/session`); const session = await response.json();
  assert.equal(session.mode, 'local'); assert.equal(session.authenticated, true); assert.equal(session.user.role, 'admin'); assert.equal(session.csrfToken, null); assert.equal(response.headers.get('set-cookie'), null);
});

test('access: static, API, SSE and downloads require ingress; forged identity headers never authenticate', async t => {
  const f = await fixture(t);
  for (const route of ['/', '/api/session', '/api/bootstrap', '/api/diagnostics', '/api/events', '/api/artifacts/a/download']) {
    const result = await f.api(route, { unsigned: true, headers: { 'X-User': 'admin', 'X-Forwarded-User': 'admin', 'X-Forwarded-Proto': 'https', 'X-Workspace-Role': 'admin' } });
    assert.equal(result.status, 401, route); assert.equal(result.data.error.code, 'AUTH_REQUIRED');
  }
  assert.equal((await f.api('/')).status, 200);
  const session = await f.api('/api/session'); assert.equal(session.status, 200); assert.equal(session.data.authenticated, false); assert.equal(session.data.user, null);
  assert.equal((await f.api('/api/bootstrap')).data.error.code, 'SESSION_REQUIRED');
  await assert.rejects(f.app.listen(0, '0.0.0.0'), /loopback/);
});

test('access: host, origin, same-site hostile origin and missing mutation origin fail closed', async t => {
  const f = await fixture(t); const session = await f.login();
  for (const headers of [{ Host: 'evil.example' }, { Host: 'workspace.example:443' }, { Origin: 'https://evil.example' }, { Origin: 'https://workspace.example.evil' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) assert.equal((await f.api('/api/bootstrap', { session, headers })).status, 403);
  assert.equal((await f.api('/api/conversations', { session, method: 'POST', body: {}, headers: { Origin: '' } })).data.error.code, 'ORIGIN_REQUIRED');
  assert.equal((await f.api('/api/conversations', { session, method: 'POST', body: {}, headers: { Origin: publicOrigin } })).status, 201);
});

test('access: bad signatures, unsupported JWT headers and wrong subject/workspace/audience fail closed', async t => {
  const f = await fixture(t); const good = token('/api/session', 'GET', '', 'admin', f.now());
  for (const assertion of [good.slice(0, -4) + 'AAAA', alter(good, { header: { alg: 'none' } }), alter(good, { header: { kid: 'other' } }), alter(good, { header: { jku: 'https://evil.example/keys' } }), alter(good, { claims: { workspace: 'other' } }), alter(good, { claims: { aud: 'https://evil.example' } }), alter(good, { claims: { iss: 'evil' } }), alter(good, { claims: { exp: Math.floor(f.now() / 1000) - 1 } }), alter(good, { claims: { exp: Math.floor(f.now() / 1000) + 3600 } }), alter(good, { claims: { iat: Math.floor(f.now() / 1000) + 10 } }), alter(good, { claims: { jti: 'short' } })]) assert.equal((await f.api('/api/session', { assertion })).data.error.code, 'ASSERTION_INVALID');
  assert.equal((await f.api('/api/session', { subject: 'unknown' })).data.error.code, 'MEMBERSHIP_REQUIRED');
});

test('access: assertions bind method, raw path, query and exact body before domain mutations', async t => {
  const f = await fixture(t); const session = await f.login();
  const post = token('/api/conversations', 'POST', '{"title":"approved"}', 'admin', f.now());
  const changed = await f.api('/api/conversations', { method: 'POST', body: { title: 'changed' }, session, assertion: post });
  assert.equal(changed.data.error.code, 'ASSERTION_BODY_MISMATCH'); assert.equal(f.app.runtime.bootstrap().conversations.length, 0);
  assert.equal((await f.api('/api/conversations', { session, assertion: post })).data.error.code, 'ASSERTION_INVALID');
  assert.equal((await f.api('/api/status', { session, assertion: token('/api/bootstrap', 'GET', '', 'admin', f.now()) })).data.error.code, 'ASSERTION_INVALID');
  assert.equal((await f.api('/api/search?q=changed', { session, assertion: token('/api/search?q=approved', 'GET', '', 'admin', f.now()) })).data.error.code, 'ASSERTION_INVALID');
});

test('access: one-time assertions reject concurrent replay and stay consumed after restart', async t => {
  const f = await fixture(t);
  const assertion = token('/api/session/login', 'POST', '{}', 'admin', f.now());
  const options = { method: 'POST', body: {}, assertion, headers: { 'X-Workspace-Login': '1' } };
  const responses = await Promise.all([f.api('/api/session/login', options), f.api('/api/session/login', options)]);
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 401]);
  assert.equal(responses.find(item => item.status === 401).data.error.code, 'ASSERTION_REPLAYED');
  await f.restart(); assert.equal((await f.api('/api/session/login', options)).data.error.code, 'ASSERTION_REPLAYED');
});

test('access: login intent, secure cookie, session fixation resistance and CSRF are enforced', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/api/session/login', { method: 'POST', body: {} })).data.error.code, 'LOGIN_INTENT_REQUIRED');
  const first = await f.api('/api/session/login', { method: 'POST', body: {}, headers: { 'X-Workspace-Login': '1', Cookie: '__Host-workspace_session=' + 'A'.repeat(43) } });
  assert.equal(first.status, 200); assert.notEqual(first.cookie, '__Host-workspace_session=' + 'A'.repeat(43));
  assert.match(first.response.headers.get('set-cookie'), /Path=\/; Secure; HttpOnly; SameSite=Strict/); assert.doesNotMatch(first.response.headers.get('set-cookie'), /Domain=/);
  const session = { ...first.data, cookie: first.cookie };
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: {}, session, headers: { 'X-CSRF-Token': '' } })).data.error.code, 'CSRF_REJECTED');
  const other = await f.login();
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: {}, session, headers: { 'X-CSRF-Token': other.csrfToken } })).data.error.code, 'CSRF_REJECTED');
  assert.equal((await f.api('/api/bootstrap', { session, subject: 'reader' })).data.error.code, 'SESSION_REQUIRED');
  assert.equal((await f.api('/api/bootstrap', { session, headers: { Cookie: `${session.cookie}; ${session.cookie}` } })).data.error.code, 'SESSION_REQUIRED');
});

test('access: viewer reads but cannot mutate; operator domain writes exclude administration and forged roles', async t => {
  const f = await fixture(t), reader = await f.login('reader'), operator = await f.login('operator');
  assert.equal((await f.api('/api/bootstrap', { session: reader, subject: 'reader' })).status, 200);
  assert.equal((await f.api('/api/diagnostics', { session: reader, subject: 'reader' })).data.readOnly, true);
  for (const route of ['/api/conversations', '/api/artifacts', '/api/approvals', '/api/library/products', '/api/commerce-projects', '/api/commerce-shopify/verify', '/api/session/unknown']) assert.equal((await f.api(route, { method: 'POST', body: {}, session: reader, subject: 'reader', headers: { 'X-Workspace-Role': 'admin' } })).data.error.code, 'ROLE_REQUIRED');
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: {}, session: operator, subject: 'operator' })).status, 201);
  for (const route of ['/api/skills', '/api/connectors', '/api/approvals', '/api/schedules', '/api/runs/any/action-decision', '/api/commerce-shopify/verify', '/api/commerce-projects/any/sync-orders']) assert.equal((await f.api(route, { method: 'POST', body: {}, session: operator, subject: 'operator' })).data.error.code, 'ROLE_REQUIRED');
  for (const route of ['/api/access/audit', '/api/access/sessions']) assert.equal((await f.api(route, { session: operator, subject: 'operator' })).data.error.code, 'ROLE_REQUIRED');
  assert.equal((await f.api('/api/settings', { method: 'PATCH', body: { name: 'deny' }, session: operator, subject: 'operator' })).data.error.code, 'ROLE_REQUIRED');
  assert.equal((await f.api('/api/session/logout', { method: 'POST', body: {}, session: reader, subject: 'reader' })).status, 200);
});

test('access: idle and absolute expiry are enforced; restart and logout revoke old cookies', async t => {
  const f = await fixture(t, { access: { idleTimeoutMs: 1000, absoluteTimeoutMs: 2000 } });
  let session = await f.login(); f.advance(1001);
  assert.equal((await f.api('/api/bootstrap', { session })).data.error.code, 'SESSION_REQUIRED');
  session = await f.login(); f.advance(800); assert.equal((await f.api('/api/bootstrap', { session })).status, 200);
  f.advance(800); assert.equal((await f.api('/api/bootstrap', { session })).status, 200);
  f.advance(401); assert.equal((await f.api('/api/bootstrap', { session })).data.error.code, 'SESSION_REQUIRED');
  session = await f.login(); assert.equal((await f.api('/api/session/logout', { method: 'POST', body: {}, session })).status, 200);
  assert.equal((await f.api('/api/bootstrap', { session })).data.error.code, 'SESSION_REQUIRED');
  session = await f.login(); await f.restart(); assert.equal((await f.api('/api/bootstrap', { session })).data.error.code, 'SESSION_REQUIRED');
});

test('access: admin revocation closes SSE and denies further API/download access', async t => {
  const f = await fixture(t), admin = await f.login(), reader = await f.login('reader');
  const response = await httpFetch(`${f.base}/api/events`, { headers: { Host: 'workspace.example', Cookie: reader.cookie, 'X-Workspace-Assertion': token('/api/events', 'GET', '', 'reader', f.now()) } });
  assert.equal(response.status, 200); const stream = response.body.getReader(); await stream.read();
  const sessions = await f.api('/api/access/sessions', { session: admin }); const target = sessions.data.sessions.find(item => item.subject === 'reader');
  assert.equal((await f.api(`/api/access/sessions/${target.id}/revoke`, { method: 'POST', body: {}, session: admin })).status, 200);
  assert.equal((await stream.read()).done, true);
  for (const route of ['/api/bootstrap', '/api/diagnostics', '/api/artifacts/unknown/download']) assert.equal((await f.api(route, { session: reader, subject: 'reader' })).data.error.code, 'SESSION_REQUIRED');
});

test('access: stream assertions expire and force ingress reauthentication', async t => {
  const f = await fixture(t), session = await f.login();
  const response = await httpFetch(`${f.base}/api/events`, { headers: { Host: 'workspace.example', Cookie: session.cookie, 'X-Workspace-Assertion': token('/api/events', 'GET', '', 'admin', f.now()) } });
  const stream = response.body.getReader(); await stream.read(); f.advance(31_000);
  // A commit already queued before advancing the fixture clock may be buffered.
  let ended = false; for (let attempt = 0; attempt < 10; attempt++) { if ((await stream.read()).done) { ended = true; break; } }
  assert.equal(ended, true);
});

test('access: audit identifies actor, admission and outcome without plaintext content or bearer material', async t => {
  const f = await fixture(t), session = await f.login();
  const title = 'PRIVATE_CONTENT_NEVER_IN_AUDIT';
  const assertion = token('/api/conversations', 'POST', JSON.stringify({ title }), 'admin', f.now());
  const result = await f.api('/api/conversations', { method: 'POST', body: { title }, session, assertion }); assert.equal(result.status, 201);
  const records = (await f.api('/api/access/audit?limit=200', { session })).data.records;
  const admitted = records.find(record => record.requestId === result.response.headers.get('x-request-id') && record.type === 'request.admitted');
  assert.equal(admitted.actor, 'admin'); assert.equal(admitted.role, 'admin'); assert.equal(admitted.bodyHash, createHash('sha256').update(JSON.stringify({ title })).digest('hex'));
  assert.equal(records.find(record => record.requestId === admitted.requestId && record.type === 'request.finished').status, 201);
  const raw = await fs.readFile(path.join(f.directory, 'security/audit.jsonl'), 'utf8');
  for (const secret of [title, assertion, session.cookie, session.csrfToken]) assert.equal(raw.includes(secret), false);
  assert.equal((await fs.stat(path.join(f.directory, 'security/audit.jsonl'))).mode & 0o777, 0o600);
  assert.equal((await f.api('/api/access/audit?after=-1', { session })).status, 400);
});

test('access: audit corruption blocks writes and corrupted startup never overwrites evidence', async t => {
  const f = await fixture(t), session = await f.login(); const filename = path.join(f.directory, 'security/audit.jsonl');
  await fs.appendFile(filename, 'tampered\n');
  const response = await f.api('/api/conversations', { method: 'POST', body: {}, session }); assert.ok(response.status >= 500);
  assert.equal(f.app.runtime.bootstrap().conversations.length, 0);
  assert.equal((await f.api('/api/bootstrap', { session })).data.error.code, 'ACCESS_UNAVAILABLE');
  await f.app.close(); const before = await fs.readFile(filename, 'utf8');
  await assert.rejects(createApp({ dataDirectory: f.directory, access: config() }), /audit/);
  assert.equal(await fs.readFile(filename, 'utf8'), before);
});

test('access: duplicate identity header rejects ambiguous proxy interpretations', async t => {
  const f = await fixture(t); const assertion = token('/api/session', 'GET', '', 'admin', f.now());
  const status = await new Promise((resolve, reject) => { const request = http.request(`${f.base}/api/session`, { headers: ['Host', 'workspace.example', 'X-Workspace-Assertion', assertion, 'X-Workspace-Assertion', assertion] }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(); });
  assert.equal(status, 400);
});

test('access: readiness is authenticated and explicitly separates config from online validation', async t => {
  const f = await fixture(t); assert.equal((await f.api('/api/health')).data.error.code, 'SESSION_REQUIRED');
  const result = await f.api('/api/health', { session: await f.login() }); assert.equal(result.status, 200);
  assert.equal(result.data.access.audit, 'healthy'); assert.equal(result.data.storage.liveWriteProbe, false); assert.equal(result.data.provider.onlineVerified, false); assert.equal(result.data.readiness, 'setup_required');
});

test('access: signed non-string replay IDs and digests cannot bypass replay identity', async t => {
  const f = await fixture(t), good = token('/api/session', 'GET', '', 'admin', f.now());
  for (const claims of [{ jti: ['fixture_jti_array_string_123456'] }, { jti: { value: 'fixture_jti_object_123456789' } }, { jti: null }, { bodySha256: [createHash('sha256').update('').digest('hex')] }]) {
    const assertion = alter(good, { claims });
    for (let repeat = 0; repeat < 2; repeat++) assert.equal((await f.api('/api/session', { assertion })).data.error.code, 'ASSERTION_INVALID');
  }
});

test('access: parallel logins cannot exceed per-subject session cap', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.api('/api/session/login', { method: 'POST', body: {}, headers: { 'X-Workspace-Login': '1' } })));
  assert.equal(results.filter(result => result.status === 200).length, 5);
  assert.equal(results.filter(result => result.data.error?.code === 'SESSION_LIMIT').length, 3);
  assert.equal(f.app.access.listSessions().sessions.length, 5);
});

async function delayedMutation(f, session) {
  const body = JSON.stringify({ title: 'MUST_NOT_COMMIT_AFTER_REVOCATION' });
  let request;
  const result = new Promise((resolve, reject) => {
    request = http.request(`${f.base}/api/conversations`, { method: 'POST', headers: { Host: 'workspace.example', Origin: publicOrigin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'X-Workspace-Assertion': token('/api/conversations', 'POST', body, session.subject, f.now()) } }, async response => { let text = ''; for await (const chunk of response) text += chunk; resolve({ status: response.statusCode, data: JSON.parse(text) }); });
    request.on('error', reject); request.write(body.slice(0, 4));
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (f.app.access.listAudit({ limit: 200 }).records.some(item => item.type === 'request.admitted' && item.actor === session.subject && item.route === '/api/conversations')) return { finish: () => { request.end(body.slice(4)); return result; } };
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  request.destroy(); throw new Error('Delayed request was never admitted.');
}

test('access: delayed mutation rechecks session revocation after reading its signed body', async t => {
  const f = await fixture(t), admin = await f.login(), operator = await f.login('operator');
  const delayed = await delayedMutation(f, operator);
  const target = f.app.access.listSessions().sessions.find(session => session.subject === 'operator');
  assert.equal((await f.api(`/api/access/sessions/${target.id}/revoke`, { method: 'POST', body: {}, session: admin })).status, 200);
  assert.equal((await delayed.finish()).data.error.code, 'SESSION_REQUIRED');
  assert.equal(f.app.runtime.bootstrap().conversations.length, 0);
});

test('access: delayed mutation rechecks assertion expiry after reading its signed body', async t => {
  const f = await fixture(t), operator = await f.login('operator');
  const delayed = await delayedMutation(f, operator); f.advance(31_000);
  assert.equal((await delayed.finish()).data.error.code, 'ASSERTION_EXPIRED');
  assert.equal(f.app.runtime.bootstrap().conversations.length, 0);
});


test('access: authenticated IdP return can load only the static shell, never cross-site APIs', async t => {
  const f = await fixture(t);
  const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  assert.equal((await f.api('/', { headers })).status, 200);
  assert.equal((await f.api('/', { headers, unsigned: true })).data.error.code, 'AUTH_REQUIRED');
  assert.equal((await f.api('/api/bootstrap', { headers, session: await f.login() })).data.error.code, 'ORIGIN_REJECTED');
});
