import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createAccessControl, validateAccessConfig } from '../server/access.mjs';
import { createAuthenticatedIngress } from '../server/workspace-authenticated-ingress.mjs';

// Optional real Caddy test. A missing binary is reported as a skip, never called
// authenticated end-to-end evidence. Test only: synthetic HTTP loopback listener;
// production template retains HTTPS. Caddy authenticates real disposable Basic
// credentials, then actual signWorkspaceRequest/access.mjs verify every request.
const binary = process.env.WORKSPACE_INGRESS_TEST_CADDY || 'caddy';
const version = spawnSync(binary, ['version'], { encoding: 'utf8' });
test('Caddy 2.11.7: real basic_auth, protected Unix transport, overwritten subject, removed Authorization, exact bytes and SSE cancellation', {
  skip: version.error?.code === 'ENOENT' ? 'Set WORKSPACE_INGRESS_TEST_CADDY to the reviewed Caddy binary.' : false,
}, async t => {
  assert.equal(version.status, 0); assert.match(version.stdout, /^v2\.11\.7(?:\s|$)/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-ingress-caddy-'));
  const pair = generateKeyPairSync('ed25519');
  const identity = { publicOrigin: 'https://workspace.example', workspaceId: 'fixture-workspace', issuer: 'fixture-caddy', keyId: 'fixture-key' };
  const members = [{ subject: 'fixture-owner', role: 'admin' }, { subject: 'fixture-reader', role: 'viewer' }];
  const access = await createAccessControl({
    config: validateAccessConfig({ mode: 'enterprise', ...identity, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members }),
    dataDirectory: directory,
  });
  const seen = []; let streamClosed = false;
  const upstream = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, identity.publicOrigin).pathname;
      const context = await access.begin(req, res, pathname);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (!['GET', 'HEAD'].includes(req.method)) access.verifyBody(context, body);
      seen.push({ headers: req.headers, claims: context.claims, body });
      if (pathname === '/api/events') {
        const watch = access.watchStream(context, () => res.end());
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: ready\n\n');
        res.once('close', () => { streamClosed = true; watch.stop(); });
        return;
      }
      const data = pathname === '/api/session/login' ? await access.login(context, res) : { subject: context.subject };
      await res.accessFinish?.(200); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
    } catch (error) { res.writeHead(error.status || 500); res.end(JSON.stringify({ error: error.code })); }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const socketPath = path.join(directory, 'ingress.sock');
  const ingress = createAuthenticatedIngress({
    settings: { ...identity, socketPath, upstream: 'http://127.0.0.1:' + upstream.address().port,
      usernameSubjects: [{ username: 'FixtureOwner', subject: 'fixture-owner' }, { username: 'FixtureReader', subject: 'fixture-reader' }] },
    privateKey: pair.privateKey, members,
  });
  await ingress.listen();
  const password = randomBytes(32).toString('base64url'); // Short-lived synthetic fixture only.
  const hashed = spawnSync(binary, ['hash-password', '--algorithm', 'bcrypt', '--plaintext', password], { encoding: 'utf8' });
  assert.equal(hashed.status, 0);
  const privateInclude = path.join(directory, 'credentials.caddy');
  const credentialTemplate = await fs.readFile(new URL('../deploy/workspace-authenticated-ingress.credentials.caddy.example', import.meta.url), 'utf8');
  await fs.writeFile(privateInclude, credentialTemplate.replace('REPLACE_WITH_APPROVED_CADDY_USERNAME', 'FixtureOwner').replace('REPLACE_WITH_PRIVATELY_PROVISIONED_PASSWORD_HASH', hashed.stdout.trim()).replace('\n}', '\n\tFixtureReader ' + hashed.stdout.trim() + '\n}'), { mode: 0o600 });
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const template = await fs.readFile(new URL('../deploy/workspace-authenticated-ingress.Caddyfile.example', import.meta.url), 'utf8');
  const caddyfile = '{\n admin off\n persist_config off\n auto_https off\n log default {\n output discard\n }\n}\n' + template
    .replace('https://workbench.cnsubscribe.xyz {', 'http://:' + port + ' {\n bind 127.0.0.1')
    .replace('/etc/caddy/workspace-authenticated-ingress.credentials.caddy', privateInclude)
    .replace('/run/workspace-authenticated-ingress/ingress.sock', socketPath);
  const configFile = path.join(directory, 'Caddyfile'); await fs.writeFile(configFile, caddyfile, { mode: 0o600 });
  const validated = spawnSync(binary, ['validate', '--config', configFile, '--adapter', 'caddyfile'], {
    env: { PATH: process.env.PATH, HOME: directory, XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory }, encoding: 'utf8',
  });
  assert.equal(validated.status, 0, 'temporary Caddy template configuration validates');
  const child = spawn(binary, ['run', '--config', configFile, '--adapter', 'caddyfile'], {
    env: { PATH: process.env.PATH, HOME: directory, XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory }, stdio: ['ignore', 'ignore', 'ignore'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill('SIGTERM'); await exited; await ingress.close();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    await access.close(); await fs.rm(directory, { recursive: true, force: true });
  });
  function send(target, { method = 'GET', body, authorization, headers = {}, stream = false } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request({ host: '127.0.0.1', port, path: target, method, agent: false, headers: {
        Host: 'workspace.example', ...(authorization ? { Authorization: authorization } : {}),
        ...(body === undefined ? {} : { Origin: identity.publicOrigin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }), ...headers,
      } }, response => {
        if (stream) { resolve({ response, outgoing }); return; }
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      });
      outgoing.on('error', reject); outgoing.end(body);
    });
  }
  const deadline = Date.now() + 5000;
  while (true) {
    try { await send('/'); break; }
    catch (error) { if (Date.now() >= deadline || child.exitCode !== null) throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  for (const authorization of [undefined, 'Basic ' + Buffer.from('FixtureOwner:wrong').toString('base64')]) {
    const denied = await send('/api/session', { authorization, headers: { 'X-Workspace-Authenticated-User': 'FixtureOwner', 'X-Workspace-Assertion': 'forged' } });
    assert.equal(denied.status, 401); assert.match(denied.headers['www-authenticate'], /Basic/);
  }
  assert.equal(seen.length, 0);
  const authorization = 'Basic ' + Buffer.from('FixtureOwner:' + password).toString('base64');
  const forged = await send('/api/session', { authorization, headers: {
    'X-Workspace-Authenticated-User': 'FixtureReader', 'X-Workspace-Subject': 'fixture-reader', 'X-Workspace-Assertion': 'forged',
  } });
  assert.equal(forged.status, 200); assert.equal(JSON.parse(forged.bytes).subject, 'fixture-owner');
  assert.equal(seen.at(-1).claims.sub, 'fixture-owner'); assert.equal(seen.at(-1).headers.authorization, undefined);
  assert.equal(seen.at(-1).headers['x-workspace-authenticated-user'], undefined);
  const login = await send('/api/session/login?exact=%2f&exact=%2F', { authorization, method: 'POST', body: ' { }\n', headers: { 'X-Workspace-Login': '1' } });
  assert.equal(login.status, 200, login.bytes.toString());
  assert.deepEqual(seen.at(-1).body, Buffer.from(' { }\n'));
  assert.equal(seen.at(-1).claims.target, '/api/session/login?exact=%2f&exact=%2F');
  const session = JSON.parse(login.bytes), cookie = login.headers['set-cookie'][0].split(';')[0];
  const { outgoing, response } = await send('/api/events', { authorization, headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken }, stream: true });
  assert.equal(response.statusCode, 200);
  const [chunk] = await once(response, 'data'); assert.match(chunk.toString(), /data: ready/);
  response.destroy(); outgoing.destroy();
  const cancelDeadline = Date.now() + 2000;
  while (!streamClosed && Date.now() < cancelDeadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(streamClosed, true, 'browser disconnect propagated through actual Caddy and ingress to upstream');
});
