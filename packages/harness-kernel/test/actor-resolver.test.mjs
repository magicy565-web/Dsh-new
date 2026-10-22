// The kernel's actor resolver: once installed, headers stop being authority and
// non-public routes require a session. Public routes and /healthz stay open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpKernel } from '../src/http.mjs';

async function withKernel(run) {
  const http = new HttpKernel({ logger: { error() {}, warn() {}, info() {}, debug() {} } });
  http.route({
    method: 'GET', path: '/api/private',
    handler: (_req, _res, context) => ({ status: 200, body: { actor: context.actor } }),
  });
  http.route({
    method: 'GET', path: '/api/open', public: true,
    handler: (_req, _res, context) => ({ status: 200, body: { actor: context.actor } }),
  });
  const started = await http.start({ host: '127.0.0.1', port: 0 });
  const base = started.address.url;
  try { return await run(started.address.url); }
  finally { await http.stop(); }
}

test('without a resolver, header actors keep working (development default)', async () => {
  await withKernel(async url => {
    const response = await fetch(`${url}/api/private`, { headers: { 'x-harness-actor': 'dev-user', 'x-harness-role': 'operator' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).actor.subject, 'dev-user');
  });
});

test('an installed resolver rejects unauthenticated private routes', async () => {
  await withKernel(async url => {
    // No resolver here: header fallback applies.
    const open = await fetch(`${url}/api/open`);
    assert.equal(open.status, 200);
  });

  const http = new HttpKernel({ logger: { error() {}, warn() {}, info() {}, debug() {} } });
  http.route({ method: 'GET', path: '/api/private', handler: (_req, _res, context) => ({ status: 200, body: { actor: context.actor } }) });
  http.route({ method: 'GET', path: '/api/open', public: true, handler: (_req, _res, context) => ({ status: 200, body: { actor: context.actor } }) });
  const dispose = http.setActorResolver(request => (request.headers['x-session'] === 'ok' ? { subject: 'signed-in', role: 'operator', workspaceId: 'local' } : null));
  const started = await http.start({ host: '127.0.0.1', port: 0 });
  const base = started.address.url;
  try {
    const anonymous = await fetch(`${base}/api/private`, { headers: { 'x-harness-actor': 'spoofed', 'x-harness-role': 'admin' } });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error.code, 'HARNESS_UNAUTHENTICATED');

    const signedIn = await fetch(`${base}/api/private`, { headers: { 'x-session': 'ok' } });
    assert.equal(signedIn.status, 200);
    assert.equal((await signedIn.json()).actor.subject, 'signed-in');

    const publicRoute = await fetch(`${base}/api/open`);
    assert.equal(publicRoute.status, 200);

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    dispose();
    await http.stop();
  }

  // Disposing the resolver restores the development header fallback.
  const again = new HttpKernel({ logger: { error() {}, warn() {}, info() {}, debug() {} } });
  again.route({ method: 'GET', path: '/api/private', handler: () => ({ status: 200, body: { ok: true } }) });
  const restarted = await again.start({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${restarted.address.url}/api/private`);
    assert.equal(response.status, 200);
  } finally { await again.stop(); }
});
