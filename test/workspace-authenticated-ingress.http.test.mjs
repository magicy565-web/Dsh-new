import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/index.mjs';
import { createAuthenticatedIngress } from '../server/workspace-authenticated-ingress.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

// Full original createApp/Store/Access/Artifact stack; the provider is explicitly
// disabled and throws if execution is ever attempted. No SDK or storage mocks.
const pair = generateKeyPairSync('ed25519');
const identity = { publicOrigin: 'https://workspace.example', workspaceId: 'fixture-workspace', issuer: 'fixture-caddy', keyId: 'fixture-key' };
const members = [{ subject: 'fixture-owner', role: 'admin' }, { subject: 'fixture-reader', role: 'viewer' }];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-ingress-http-'));
  const staticDirectory = path.join(directory, 'static'); await fs.mkdir(staticDirectory);
  await fs.writeFile(path.join(staticDirectory, 'index.html'), '<!doctype html><title>original HTTP fixture</title>');
  const app = await createApp({
    dataDirectory: path.join(directory, 'data'), staticDirectory, capabilityEnvironment: {},
    provider: { kind: 'fixture-disabled', configured: false, async run() { throw Error('Model execution is outside this test.'); } },
    access: { mode: 'enterprise', ...identity, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members },
  });
  const address = await app.listen(0);
  const socketPath = path.join(directory, 'ingress.sock');
  const ingress = createAuthenticatedIngress({
    settings: { ...identity, socketPath, upstream: 'http://127.0.0.1:' + address.port,
      usernameSubjects: [{ username: 'CaddyOwner', subject: 'fixture-owner' }, { username: 'CaddyReader', subject: 'fixture-reader' }] },
    privateKey: pair.privateKey, members,
  });
  await ingress.listen();
  t.after(async () => { await ingress.close(); await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  function send(target, { method = 'GET', body, username = 'CaddyOwner', headers = {}, stream = false, chunked = false, direct = false } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request({ ...(direct ? { hostname: '127.0.0.1', port: address.port } : { socketPath }), path: target, method, agent: false, headers: {
        Host: 'workspace.example', ...(username === null ? {} : { 'X-Workspace-Authenticated-User': username }),
        ...(!['GET', 'HEAD'].includes(method) ? { Origin: identity.publicOrigin } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(body) }) }),
        ...headers,
        ...(direct ? { 'X-Workspace-Assertion': signWorkspaceRequest({ ...identity, privateKey: pair.privateKey,
          subject: username === 'CaddyReader' ? 'fixture-reader' : 'fixture-owner', method, target, body: body ?? '' }) } : {}),
      } }, response => {
        if (stream) { resolve({ response, outgoing }); return; }
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject); response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          let data; try { data = JSON.parse(bytes.toString()); } catch { data = null; }
          resolve({ status: response.statusCode, headers: response.headers, bytes, data });
        });
      });
      outgoing.on('error', reject);
      if (chunked && body) { const bytes = Buffer.from(body); outgoing.write(bytes.subarray(0, 17)); outgoing.end(bytes.subarray(17)); }
      else outgoing.end(body);
    });
  }
  async function login(username = 'CaddyOwner') {
    const result = await send('/api/session/login', { method: 'POST', body: ' { }\n', username, headers: { 'X-Workspace-Login': '1' } });
    assert.equal(result.status, 200, result.bytes.toString());
    return { Cookie: result.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token': result.data.csrfToken };
  }
  return { app, ingress, send, login };
}

test('original HTTP backend: static/HEAD, explicit login, JSON writes, Session/CSRF, membership role and logout', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('/', { username: null })).status, 401);
  const shell = await f.send('/'); assert.equal(shell.status, 200); assert.match(shell.bytes.toString(), /original HTTP fixture/);
  const head = await f.send('/', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
  assert.equal((await f.send('/api/bootstrap')).data.error.code, 'SESSION_REQUIRED');
  assert.equal((await f.send('/api/session/login', { method: 'POST', body: '{}' })).data.error.code, 'LOGIN_INTENT_REQUIRED');
  const headers = await f.login();
  const created = await f.send('/api/conversations', { method: 'POST', body: ' {\n "title" : "精确 raw bytes" \n}\n', headers });
  assert.equal(created.status, 201, created.bytes.toString());
  assert.equal((await f.send('/api/bootstrap', { headers })).status, 200);
  assert.equal((await f.send('/api/conversations', { method: 'POST', body: '{}', headers: { Cookie: headers.Cookie } })).data.error.code, 'CSRF_REJECTED');
  assert.equal((await f.send('/api/conversations', { method: 'POST', body: '{}', headers: { ...headers, Origin: '' } })).data.error.code, 'ORIGIN_REQUIRED');
  assert.equal((await f.send('/api/bootstrap', { username: 'CaddyReader', headers })).data.error.code, 'SESSION_REQUIRED');
  const reader = await f.login('CaddyReader');
  assert.equal((await f.send('/api/conversations', { method: 'POST', body: '{}', username: 'CaddyReader', headers: { ...reader, 'X-Workspace-Role': 'admin' } })).data.error.code, 'ROLE_REQUIRED');
  assert.equal((await f.send('/api/session/logout', { method: 'POST', body: '{}', headers })).status, 200);
  assert.equal((await f.send('/api/bootstrap', { headers })).data.error.code, 'SESSION_REQUIRED');
});

test('original HTTP backend: binary upload/download preserves bytes through chunked JSON', async t => {
  const f = await fixture(t), headers = await f.login();
  const bytes = Buffer.alloc(32 * 1024, 255);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const body = JSON.stringify({ filename: 'fixture.png', base64: bytes.toString('base64') });
  const uploaded = await f.send('/api/artifacts', { method: 'POST', body, headers, chunked: true });
  assert.equal(uploaded.status, 201, uploaded.bytes.toString());
  assert.equal(uploaded.data.artifact.size, bytes.length);
  assert.equal(uploaded.data.artifact.sha256, sha256(bytes));
  const downloaded = await f.send('/api/artifacts/' + uploaded.data.artifact.id + '/download', { headers });
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.bytes, bytes);
});

test('original HTTP backend: exact 5 MiB text upload and original/ingress size limits', async t => {
  const f = await fixture(t), headers = await f.login();
  const body = JSON.stringify({ filename: 'fixture.txt', content: 'x'.repeat(5 * 1024 * 1024) });
  const uploaded = await f.send('/api/artifacts', { method: 'POST', body, headers });
  assert.equal(uploaded.status, 201, uploaded.bytes.toString());
  const downloaded = await f.send('/api/artifacts/' + uploaded.data.artifact.id + '/download', { headers });
  assert.equal(downloaded.status, 200); assert.equal(downloaded.bytes.length, 5 * 1024 * 1024);
  assert.equal(sha256(downloaded.bytes), sha256(Buffer.alloc(5 * 1024 * 1024, 'x')));
  const tooLarge = JSON.stringify({ filename: 'fixture.txt', content: 'x'.repeat(5 * 1024 * 1024 + 1) });
  const originalLimit = await f.send('/api/artifacts', { method: 'POST', body: tooLarge, headers });
  assert.equal(originalLimit.status, 413); assert.equal(originalLimit.data.error.code, 'ARTIFACT_TOO_LARGE');
  const jsonLimit = await f.send('/api/conversations', { method: 'POST', body: '{}' + ' '.repeat(100_000), headers });
  assert.equal(jsonLimit.status, 413); assert.equal(jsonLimit.data.error.code, 'BODY_TOO_LARGE');
  const proxyLimit = await f.send('/api/artifacts', { method: 'POST', body: Buffer.alloc(7_100_001), headers });
  assert.equal(proxyLimit.status, 413); assert.equal(proxyLimit.data.error.code, 'INGRESS_BODY_TOO_LARGE');
});

test('original HTTP backend baseline regression: advertised 5 MiB binary limit must work directly and through ingress', async t => {
  const f = await fixture(t), headers = await f.login();
  const bytes = Buffer.alloc(5 * 1024 * 1024, 255);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const body = JSON.stringify({ filename: 'maximum.png', base64: bytes.toString('base64') });
  const proxied = await f.send('/api/artifacts', { method: 'POST', body, headers });
  const direct = await f.send('/api/artifacts', { method: 'POST', body, headers, direct: true });
  assert.equal(proxied.status, direct.status, 'same exact synthetic request and original backend; ingress adds no size restriction here');
  // Retain a failing regression if the unchanged artifact validator overflows its
  // stack on maximum-sized base64 input. Do not hide it with a skip/SDK mock.
  assert.equal(proxied.status, 201, 'original binary validator failure: direct=' + direct.status + ', ingress=' + proxied.status + ', body=' + proxied.bytes.toString());
});

test('original HTTP backend: SSE begins before completion and original logout revokes its live session stream', async t => {
  const f = await fixture(t), headers = await f.login();
  const { response } = await f.send('/api/events', { headers, stream: true });
  assert.equal(response.statusCode, 200); assert.match(response.headers['content-type'], /text\/event-stream/);
  const [first] = await once(response, 'data'); assert.ok(first.length > 0);
  const ended = once(response, 'end'); response.resume();
  assert.equal((await f.send('/api/session/logout', { method: 'POST', body: '{}', headers })).status, 200);
  await ended;
});
