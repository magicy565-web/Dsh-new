import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createAccessControl, validateAccessConfig } from '../server/access.mjs';
import { createAuthenticatedIngress, validateAuthenticatedIngressConfig, loadAuthenticatedIngressConfig } from '../server/workspace-authenticated-ingress.mjs';

// Synthetic usernames/subjects and disposable signing key only. HTTP routing
// below is a transport fixture; signature, membership, sessions, CSRF and audit
// are the real unchanged access.mjs implementation, with real temporary disk.
const pair = generateKeyPairSync('ed25519');
const publicOrigin = 'https://workspace.example';
const members = [{ subject: 'fixture-owner', role: 'admin' }, { subject: 'fixture-reader', role: 'viewer' }];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const privateKey = pair.privateKey;
const identity = { publicOrigin, workspaceId: 'fixture-workspace', issuer: 'fixture-caddy', keyId: 'fixture-key' };
function settings(directory, port = 8787, extra = {}) {
  return {
    ...identity, socketPath: path.join(directory, 'ingress.sock'),
    upstream: 'http://127.0.0.1:' + port,
    usernameSubjects: [{ username: 'CaddyOwner', subject: 'fixture-owner' }, { username: 'CaddyReader', subject: 'fixture-reader' }],
    ...extra,
  };
}
function request(socketPath, target = '/api/session', { method = 'GET', body, username = 'CaddyOwner', headers = {}, rawHeaders } = {}) {
  return new Promise((resolve, reject) => {
    const options = { socketPath, path: target, method, agent: false, headers: rawHeaders || {
      Host: 'workspace.example',
      ...(username === null ? {} : { 'X-Workspace-Authenticated-User': username }),
      ...(!['GET', 'HEAD'].includes(method) ? { Origin: publicOrigin } : {}),
      ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body), 'Content-Type': 'application/json' }),
      ...headers,
    } };
    const outgoing = http.request(options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let data; try { data = JSON.parse(bytes.toString()); } catch { data = null; }
        resolve({ status: response.statusCode, headers: response.headers, bytes, data });
      });
    });
    outgoing.on('error', reject); outgoing.end(body);
  });
}
function streamRequest(socketPath, target, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ socketPath, path: target, agent: false, headers: {
      Host: 'workspace.example', 'X-Workspace-Authenticated-User': 'CaddyOwner', ...headers,
    } }, response => resolve({ outgoing, response }));
    outgoing.on('error', reject); outgoing.end();
  });
}
async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-ingress-'));
  const seen = [], streamClosures = [];
  let clock = Date.now();
  const access = await createAccessControl({
    config: validateAccessConfig({ mode: 'enterprise', ...identity, publicKey, members }),
    dataDirectory: directory, now: () => clock,
  });
  const upstream = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, publicOrigin).pathname;
      const context = await access.begin(req, res, pathname);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (!['GET', 'HEAD'].includes(req.method)) access.verifyBody(context, body);
      seen.push({ method: req.method, target: req.url, headers: req.headers, body, claims: context.claims });
      if (pathname === '/api/slow') return;
      if (pathname === '/api/truncated') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '100' });
        res.write('partial');
        setTimeout(() => res.destroy(), 10);
        return;
      }
      if (pathname === '/api/events') {
        const watch = access.watchStream(context, () => res.end());
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        res.write('event: ready\ndata: fixture\n\n');
        res.on('close', () => { watch.stop(); streamClosures.push(true); });
        return;
      }
      if (pathname === '/static.bin') {
        const bytes = Buffer.from([0, 255, 1, 10, 13]);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Set-Cookie': ['fixture-a=1; Secure', 'fixture-b=2; Secure'],
          'X-Workspace-Assertion': 'internal-must-not-leak', 'X-Workspace-Authenticated-User': 'internal-user' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
      }
      const data = pathname === '/api/session/login' ? await access.login(context, res)
        : pathname === '/api/session/logout' ? await access.logout(context, res)
        : pathname === '/api/session' ? access.sessionView(context)
        : { subject: context.subject, role: context.role, size: body.length, sha256: hash(body) };
      await res.accessFinish?.(200);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
    } catch (error) {
      await access.recordDenial(error);
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: error.code || 'FIXTURE_FAILURE' } }));
    }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const config = settings(directory, upstream.address().port, extra);
  const ingress = createAuthenticatedIngress({ settings: config, privateKey, members });
  await ingress.listen();
  t.after(async () => {
    await ingress.close();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    await access.close(); await fs.rm(directory, { recursive: true, force: true });
  });
  const api = (target, options) => request(config.socketPath, target, options);
  async function login(username = 'CaddyOwner') {
    const result = await api('/api/session/login', { method: 'POST', body: '{}', username, headers: { 'X-Workspace-Login': '1' } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { cookie: result.headers['set-cookie'][0].split(';')[0], csrf: result.data.csrfToken, result };
  }
  return { directory, config, ingress, upstream, api, login, seen, streamClosures, advance: value => { clock += value; } };
}
const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), 'condition reached within 2 seconds');
};

test('configuration requires exact HTTPS origin, fixed numeric loopback, explicit member mapping and Ed25519', () => {
  const good = settings('/tmp/fixture');
  const validate = patch => validateAuthenticatedIngressConfig({ ...good, ...patch }, { privateKey, members });
  assert.equal(validate({}).subjects.get('CaddyOwner'), 'fixture-owner');
  for (const patch of [
    { publicOrigin: 'http://workspace.example' }, { publicOrigin: 'https://localhost' }, { publicOrigin: publicOrigin + '/' },
    { upstream: 'http://example.com:8787' }, { upstream: 'http://localhost:8787' }, { upstream: 'http://127.0.0.1:8787/path' },
    { upstream: 'http://user:password@127.0.0.1:8787' }, { upstream: 'http://127.0.0.1' },
    { socketPath: 'relative.sock' }, { socketMode: '0666' }, { unknown: 'ignored?' },
    { maxBodyBytes: 7_100_001 }, { maxInFlight: 33 }, { bodyTimeoutMs: 0 }, { upstreamHeadersTimeoutMs: 30_001 },
    { usernameSubjects: [] }, { usernameSubjects: [{ username: 'CaddyOwner', subject: 'not-a-member' }] },
    { usernameSubjects: [{ username: 'CaddyOwner', subject: 'fixture-owner' }, { username: 'CaddyOwner', subject: 'fixture-reader' }] },
    { usernameSubjects: [{ username: 'CaddyOwner', subject: 'fixture-owner', role: 'admin' }] },
  ]) assert.throws(() => validate(patch), { code: 'INGRESS_CONFIGURATION_INVALID' }, JSON.stringify(patch));
  assert.throws(() => validateAuthenticatedIngressConfig(good, { privateKey: 'not-a-key', members }));
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => validateAuthenticatedIngressConfig(good, { privateKey: rsa.privateKey, members }));
});

test('CLI loads only explicit safe files; refuses symlinks, writable config and exposed key; errors are redacted', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-ingress-files-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyFile = path.join(directory, 'key.pem'), membersFile = path.join(directory, 'members.json'), configFile = path.join(directory, 'config.json');
  const input = { ...settings(directory), privateKeyFile: keyFile, membersFile };
  await fs.writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await fs.writeFile(membersFile, JSON.stringify(members), { mode: 0o600 });
  await fs.writeFile(configFile, JSON.stringify(input), { mode: 0o600 });
  assert.equal((await loadAuthenticatedIngressConfig(configFile)).settings.publicOrigin, publicOrigin);
  await fs.chmod(keyFile, 0o644);
  await assert.rejects(loadAuthenticatedIngressConfig(configFile), { code: 'INGRESS_CONFIGURATION_INVALID' });
  await fs.chmod(keyFile, 0o600); await fs.chmod(configFile, 0o620);
  await assert.rejects(loadAuthenticatedIngressConfig(configFile));
  await fs.chmod(configFile, 0o600);
  const link = path.join(directory, 'link.json'); await fs.symlink(configFile, link);
  await assert.rejects(loadAuthenticatedIngressConfig(link));
  const child = spawnSync(process.execPath, ['server/workspace-authenticated-ingress.mjs', link], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'Workspace authenticated ingress startup failed (INGRESS_CONFIGURATION_INVALID).\n');
});

test('socket ownership boundary fails closed and never unlinks an existing file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-ingress-bind-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = settings(directory);
  await fs.writeFile(config.socketPath, 'retain-this-file');
  let ingress = createAuthenticatedIngress({ settings: config, privateKey, members });
  await assert.rejects(ingress.listen()); await ingress.close();
  assert.equal(await fs.readFile(config.socketPath, 'utf8'), 'retain-this-file');
  await fs.unlink(config.socketPath); await fs.chmod(directory, 0o777);
  ingress = createAuthenticatedIngress({ settings: config, privateKey, members });
  await assert.rejects(ingress.listen()); await ingress.close();
  await fs.chmod(directory, 0o700);
  ingress = createAuthenticatedIngress({ settings: config, privateKey, members });
  assert.deepEqual(await ingress.listen(), { socketPath: config.socketPath });
  assert.equal((await fs.stat(config.socketPath)).mode & 0o777, 0o600);
  await ingress.close(); await ingress.close();
  await assert.rejects(fs.stat(config.socketPath), { code: 'ENOENT' });
});

test('no identity default; exact Caddy username maps to an existing subject; forged headers/Authorization are stripped', async t => {
  const f = await fixture(t);
  for (const target of ['/', '/api/session', '/api/events', '/static.bin']) {
    assert.equal((await f.api(target, { username: null, headers: {
      Authorization: 'Basic fixture-only', 'X-Workspace-Subject': 'fixture-owner',
      'X-Workspace-Assertion': 'forged', 'X-Forwarded-User': 'CaddyOwner',
    } })).status, 401);
  }
  assert.equal((await f.api('/api/session', { username: 'caddyowner' })).status, 403);
  assert.equal((await f.api('/api/session', { username: 'fixture-owner' })).status, 403);
  const result = await f.api('/api/session', { headers: {
    Authorization: 'Basic do-not-forward', 'Proxy-Authorization': 'secret',
    'X-Workspace-Assertion': 'forged', 'X-Workspace-Subject': 'evil', 'X-Workspace-Role': 'admin',
    'X-Forwarded-User': 'evil', 'X-Remote-User': 'evil', 'X-Forwarded-Proto': 'http', Forwarded: 'for=evil',
  } });
  assert.equal(result.status, 200); assert.equal(result.data.authenticated, false);
  assert.equal(f.seen.at(-1).claims.sub, 'fixture-owner');
  for (const name of ['authorization', 'proxy-authorization', 'x-workspace-subject', 'x-workspace-role', 'x-forwarded-user', 'x-remote-user', 'x-forwarded-proto', 'forwarded', 'x-workspace-authenticated-user']) assert.equal(f.seen.at(-1).headers[name], undefined, name);
  assert.notEqual(f.seen.at(-1).headers['x-workspace-assertion'], 'forged');
  assert.equal(result.headers['x-workspace-assertion'], undefined);
});

test('real backend access control retains login intent, cookie, Session, Origin, CSRF, subject binding and viewer permissions', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/api/conversations')).data.error.code, 'SESSION_REQUIRED');
  assert.equal((await f.api('/api/session/login', { method: 'POST', body: '{}' })).data.error.code, 'LOGIN_INTENT_REQUIRED');
  const session = await f.login();
  assert.match(session.result.headers['set-cookie'][0], /Path=\/; Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: '{}', headers: { Cookie: session.cookie } })).data.error.code, 'CSRF_REJECTED');
  const headers = { Cookie: session.cookie, 'X-CSRF-Token': session.csrf };
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: '{}', headers })).status, 200);
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: '{}', headers: { ...headers, Origin: '' } })).data.error.code, 'ORIGIN_REQUIRED');
  assert.equal((await f.api('/api/conversations', { method: 'POST', body: '{}', headers: { ...headers, Origin: 'https://evil.example' } })).data.error.code, 'ORIGIN_REJECTED');
  assert.equal((await f.api('/api/conversations', { headers: { Cookie: session.cookie, 'Sec-Fetch-Site': 'same-site' } })).data.error.code, 'ORIGIN_REJECTED');
  assert.equal((await f.api('/api/session', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await f.api('/api/conversations', { username: 'CaddyReader', headers })).data.error.code, 'SESSION_REQUIRED');
  const reader = await f.login('CaddyReader');
  assert.equal(reader.result.data.user.role, 'viewer');
  assert.equal((await f.api('/api/conversations', { username: 'CaddyReader', method: 'POST', body: '{}', headers: { Cookie: reader.cookie, 'X-CSRF-Token': reader.csrf, 'X-Workspace-Role': 'admin' } })).data.error.code, 'ROLE_REQUIRED');
  assert.equal((await f.api('/api/session/logout', { method: 'POST', body: '{}', headers })).status, 200);
  assert.equal((await f.api('/api/conversations', { headers })).data.error.code, 'SESSION_REQUIRED');
});

test('signatures preserve raw target, method and arbitrary upload bytes; every request has a fresh assertion', async t => {
  const f = await fixture(t), session = await f.login();
  const target = '/api/artifacts?name=%2f&name=%2F&space=+&space=%20';
  const body = Buffer.from([0, 255, 13, 10, 192, 128, 123, 125]);
  const options = { method: 'POST', body, headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/octet-stream', 'Idempotency-Key': 'fixture-operation' } };
  assert.equal((await f.api(target, options)).status, 200);
  const first = f.seen.at(-1);
  assert.equal(first.target, target); assert.equal(first.claims.target, target); assert.equal(first.claims.method, 'POST');
  assert.deepEqual(first.body, body); assert.equal(first.claims.bodySha256, hash(body));
  assert.equal(first.headers['idempotency-key'], 'fixture-operation');
  assert.equal((await f.api(target, options)).status, 200);
  assert.notEqual(first.claims.jti, f.seen.at(-1).claims.jti);
  assert.notEqual(first.headers['x-workspace-assertion'], f.seen.at(-1).headers['x-workspace-assertion']);
  const binary = await f.api('/static.bin');
  assert.deepEqual(binary.bytes, Buffer.from([0, 255, 1, 10, 13]));
  assert.equal(binary.headers['set-cookie'].length, 2);
  assert.equal(binary.headers['x-workspace-assertion'], undefined);
  assert.equal(binary.headers['x-workspace-authenticated-user'], undefined);
  const head = await f.api('/static.bin', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], '5');
});

test('duplicate security headers and unsupported hop headers, methods and bodyless-method uploads fail before signing', async t => {
  const f = await fixture(t);
  for (const name of ['Host', 'Origin', 'Authorization', 'Cookie', 'X-CSRF-Token', 'X-Workspace-Authenticated-User', 'X-Workspace-Session', 'X-Workspace-Assertion', 'Idempotency-Key']) {
    const rawHeaders = ['Host', 'workspace.example', 'X-Workspace-Authenticated-User', 'CaddyOwner'];
    if (name.toLowerCase() === 'host') rawHeaders.push('Host', 'workspace.example');
    else if (name.toLowerCase() === 'x-workspace-authenticated-user') rawHeaders.push(name, 'CaddyOwner');
    else rawHeaders.push(name, 'fixture', name.toLowerCase(), 'fixture');
    assert.equal((await f.api('/api/session', { rawHeaders })).status, 400, name);
  }
  for (const method of ['GET', 'HEAD', 'DELETE']) assert.equal((await f.api('/api/session', { method, body: 'x' })).status, 400, method);
  assert.equal((await f.api('/api/session', { method: 'PUT' })).status, 405);
  assert.equal((await f.api('//evil.example/api/session')).status, 400);
  assert.equal((await f.api('/bad\\target')).status, 400);
  assert.equal((await f.api('/api/session', { headers: { Connection: 'X-CSRF-Token' } })).status, 400);
  assert.equal((await f.api('/api/session', { headers: { Expect: '100-continue' } })).status, 417);
  const manyHeaders = Object.fromEntries(Array.from({ length: 80 }, (_, index) => ['X-Fixture-' + index, '1']));
  assert.equal((await f.api('/api/session', { headers: manyHeaders })).status, 431);
  assert.equal(f.seen.length, 0);
});

test('declared and chunked uploads have the same strict byte limit; no oversized request reaches upstream', async t => {
  const f = await fixture(t, { maxBodyBytes: 32 }), session = await f.login();
  const headers = { Cookie: session.cookie, 'X-CSRF-Token': session.csrf };
  assert.equal((await f.api('/api/artifacts', { method: 'POST', body: Buffer.alloc(32), headers })).status, 200);
  const count = f.seen.length;
  assert.equal((await f.api('/api/artifacts', { method: 'POST', body: Buffer.alloc(33), headers })).status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const outgoing = http.request({ socketPath: f.config.socketPath, path: '/api/artifacts', method: 'POST', headers: {
      Host: 'workspace.example', Origin: publicOrigin, 'X-Workspace-Authenticated-User': 'CaddyOwner', ...headers,
      'Transfer-Encoding': 'chunked',
    } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    outgoing.on('error', reject); outgoing.write(Buffer.alloc(20)); outgoing.end(Buffer.alloc(13));
  });
  assert.equal(chunked, 413); assert.equal(f.seen.length, count);
});

test('SSE streams immediately, preserves event cursor, and client cancellation closes upstream', async t => {
  const f = await fixture(t), session = await f.login();
  const { outgoing, response } = await streamRequest(f.config.socketPath, '/api/events', { Cookie: session.cookie, 'Last-Event-ID': 'fixture-cursor' });
  assert.equal(response.statusCode, 200);
  const [chunk] = await once(response, 'data'); assert.match(chunk.toString(), /event: ready/);
  assert.equal(f.seen.at(-1).headers['last-event-id'], 'fixture-cursor');
  response.destroy(); outgoing.destroy();
  await waitFor(() => f.streamClosures.length === 1);
});

test('original access stream expiry still ends proxied SSE; cancellation is not bypassed', async t => {
  const f = await fixture(t), session = await f.login();
  const { response } = await streamRequest(f.config.socketPath, '/api/events', { Cookie: session.cookie });
  await once(response, 'data'); const ended = once(response, 'end');
  f.advance(31_000); response.resume();
  await ended; assert.equal(f.streamClosures.length, 1);
});

test('bounded concurrent streams reject excess requests and release the slot after cancellation', async t => {
  const f = await fixture(t, { maxInFlight: 1 }), session = await f.login();
  const { outgoing, response } = await streamRequest(f.config.socketPath, '/api/events', { Cookie: session.cookie });
  await once(response, 'data');
  assert.equal((await f.api('/api/session')).status, 503);
  response.destroy(); outgoing.destroy(); await waitFor(() => f.streamClosures.length === 1);
  assert.equal((await f.api('/api/session')).status, 200);
});

test('upstream connection failure and header timeout have bounded, redacted errors; no retry', async t => {
  const f = await fixture(t, { upstreamHeadersTimeoutMs: 100 }), session = await f.login();
  const result = await f.api('/api/slow?secret=not-for-errors', { headers: { Cookie: session.cookie } });
  assert.equal(result.status, 504); assert.equal(result.data.error.code, 'INGRESS_UPSTREAM_TIMEOUT');
  assert.doesNotMatch(result.bytes.toString(), /secret|127\.0\.0\.1|BEGIN PRIVATE|fixture-owner/);
  const count = f.seen.length; assert.equal(f.seen.filter(item => item.target.startsWith('/api/slow')).length, 1);
  f.upstream.closeAllConnections(); await new Promise(resolve => f.upstream.close(resolve));
  const failed = await f.api('/api/session?password=do-not-log');
  assert.equal(failed.status, 502); assert.equal(failed.data.error.code, 'INGRESS_UPSTREAM_FAILED');
  assert.doesNotMatch(failed.bytes.toString(), /password|do-not-log|ECONNREFUSED|127\.0\.0\.1|fixture/);
  assert.equal(f.seen.length, count);
});

test('partial upload deadline returns a redacted 408 before any signing/upstream request', async t => {
  const f = await fixture(t, { bodyTimeoutMs: 1000 });
  const result = await new Promise((resolve, reject) => {
    const outgoing = http.request({ socketPath: f.config.socketPath, path: '/api/artifacts?private=fixture', method: 'POST', headers: {
      Host: 'workspace.example', 'X-Workspace-Authenticated-User': 'CaddyOwner', 'Content-Length': '50',
    } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    outgoing.on('error', reject); outgoing.write('partial');
  });
  assert.equal(result.status, 408); assert.match(result.text, /INGRESS_BODY_TIMEOUT/);
  assert.doesNotMatch(result.text, /private|fixture/); assert.equal(f.seen.length, 0);
});

test('upstream failure after response headers terminates the stream rather than appending an error body', async t => {
  const f = await fixture(t), session = await f.login();
  const { response } = await streamRequest(f.config.socketPath, '/api/truncated', { Cookie: session.cookie });
  assert.equal(response.statusCode, 200);
  let bytes = ''; response.on('data', chunk => { bytes += chunk.toString(); });
  response.on('error', () => {});
  await new Promise(resolve => response.once('close', resolve));
  assert.equal(response.complete, false); assert.equal(bytes, 'partial');
});

test('aborted partial upload never reaches upstream; shutdown closes live streams and removes own socket', async t => {
  const f = await fixture(t), session = await f.login();
  const count = f.seen.length;
  const socket = net.connect(f.config.socketPath);
  await once(socket, 'connect');
  socket.write('POST /api/artifacts HTTP/1.1\r\nHost: workspace.example\r\nX-Workspace-Authenticated-User: CaddyOwner\r\nContent-Length: 30\r\n\r\npartial');
  await new Promise(resolve => setTimeout(resolve, 30)); socket.destroy();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.seen.length, count);
  const { response } = await streamRequest(f.config.socketPath, '/api/events', { Cookie: session.cookie });
  await once(response, 'data'); response.on('error', () => {});
  const closed = new Promise(resolve => response.once('close', resolve)); await f.ingress.close(); await closed;
  await waitFor(() => f.streamClosures.length === 1);
  await assert.rejects(fs.stat(f.config.socketPath), { code: 'ENOENT' });
});
