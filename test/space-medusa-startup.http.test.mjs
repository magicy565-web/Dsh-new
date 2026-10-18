// Actual original startup, signed HTTP, Session/CSRF and Store. Medusa is a
// finite loopback responder. No model/SDK request or real enterprise credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { startWorkspaceServer } from '../server/index.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
import { request } from './agent-service.helpers.mjs';
const command = values => ({ requestId: randomUUID(), ...values });
async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/space-medusa-http-'), pair = generateKeyPairSync('ed25519');
  let app; const calls = [], sessions = new Map(), readToken = 'synthetic-HTTP-dedicated-agent-context-token';
  t.after(async () => { await app?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const remote = createServer((req, res) => {
    calls.push({ method: req.method, url: req.url });
    assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer ' + readToken);
    const row = { context: { product_id: 'prod_http', status: 'approved', review_version: 3, source_hash: 'c'.repeat(64) }, product: { id: 'prod_http', title: 'Synthetic approved HTTP product' } };
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/agent/product-contexts?limit=100') res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', items: [row], count: 1 }));
    else if (req.url === '/agent/product-contexts/prod_http') res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', ...row }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  t.after(() => new Promise(resolve => { remote.close(resolve); remote.closeAllConnections(); }));
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  const remoteOrigin = 'http://127.0.0.1:' + remote.address().port;
  const originalFetch = globalThis.fetch; let externalAttempts = 0;
  globalThis.fetch = (input, options) => { if (new URL(typeof input === 'string' ? input : input.url).origin !== remoteOrigin) { externalAttempts++; throw Error('SYNTHETIC_STARTUP_EXTERNAL_NETWORK_FORBIDDEN'); } return originalFetch(input, options); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const portProbe = createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const workspaceId = 'synthetic-startup-http', origin = 'https://workspace.example', issuer = 'synthetic', keyId = 'synthetic';
  const review = { version: 1, reviewed: true, sourceId: randomUUID(), workspaceId, subject: 'owner', role: 'admin', baseURL: remoteOrigin, allowLoopbackHTTP: true };
  const environment = { NODE_ENV: 'production', PORT: String(port), WORKSPACE_RUNTIME: 'omp', WORKSPACE_OMP_PROFILE: 'business', WORKSPACE_OMP_BROWSER_BIN: 'disabled', WORKSPACE_DATA_DIR: directory + '/data', WORKSPACE_ACCESS_MODE: 'enterprise', WORKSPACE_PUBLIC_ORIGIN: origin, WORKSPACE_ID: workspaceId, WORKSPACE_INGRESS_ISSUER: issuer, WORKSPACE_INGRESS_KEY_ID: keyId, WORKSPACE_INGRESS_PUBLIC_KEY_FILE: directory + '/public.pem', WORKSPACE_MEMBERS_FILE: directory + '/members.json', WORKSPACE_SPACE_ENABLED: '1', WORKSPACE_SPACE_MEDUSA_REVIEW_FILE: directory + '/review.json', WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE: directory + '/read-token' };
  for (const [name, value] of [ ['public.pem', pair.publicKey.export({ type: 'spki', format: 'pem' })], ['members.json', JSON.stringify([{ subject: 'owner', role: 'admin' }, { subject: 'other', role: 'operator' }])], ['review.json', JSON.stringify(review)], ['read-token', readToken] ]) await fs.writeFile(directory + '/' + name, value, { mode: 0o600 });
  const base = 'http://127.0.0.1:' + port;
  const headers = (subject, method, target, body, session = true) => ({ Host: 'workspace.example', ...(method === 'GET' ? {} : { Origin: origin }), ...(session ? sessions.get(subject) : {}), 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, workspaceId, issuer, keyId, subject, method, target, body: body === undefined ? '' : JSON.stringify(body) }) });
  const login = async subject => {
    const target = '/api/session/login', result = await request(base, target, { method: 'POST', body: {}, headers: { ...headers(subject, 'POST', target, {}, false), 'X-Workspace-Login': '1' } });
    assert.equal(result.status, 200, result.text); sessions.set(subject, { Cookie: result.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token': result.json.csrfToken });
  };
  const api = async (target, body, subject = 'owner') => {
    if (!sessions.has(subject)) await login(subject);
    const method = body === undefined ? 'GET' : 'POST'; return request(base, target, { method, body, headers: headers(subject, method, target, body) });
  };
  return { calls, review, environment, api, base, externalAttempts: () => externalAttempts, get app() { return app; }, async start(env = environment) { app = await startWorkspaceServer({ environment: env }); return app; } };
}

test('CLI reviewed source reaches original signed Space HTTP without model disclosure or copied product records', { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.start();
  const created = await f.api('/api/library/spaces', command({ name: 'Synthetic CLI source' })); assert.equal(created.status, 201, created.text);
  const base = '/api/library/spaces/' + created.json.operation.receipt.spaceId;
  const listed = await f.api(base + '/sources?kind=medusa-product'); assert.equal(listed.status, 200, listed.text); assert.equal(listed.json.modelAccess, false);
  const pin = listed.json.items[0].reference; assert.equal(pin.sourceId, f.review.sourceId); assert.equal(pin.id, 'prod_http');
  const page = await f.api(base + '/nodes', command({ kind: 'page', parentId: null, title: 'Reference page', content: 'Synthetic text', sources: [pin] })); assert.equal(page.status, 201, page.text);
  const view = await f.api(base + '/nodes/' + page.json.operation.receipt.entityId); assert.equal(view.status, 200, view.text); assert.deepEqual(view.json.page.selected.sources, [pin]);
  assert.equal(view.json.page.sourceResolution[0].status, 'current');
  const before = f.calls.length; const denied = await f.api(base + '/sources?kind=medusa-product', undefined, 'other'); assert.equal(denied.status, 404, denied.text); assert.equal(f.calls.length, before);
  assert.equal(f.app.store.read().businessLibrary.products.length, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.externalAttempts(), 0);
});

test('CLI refuses a disabled Medusa backend before any remote read', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(f.start({ ...f.environment, WORKSPACE_BACKEND_DISABLED_PLUGINS_JSON: '["workspace-medusa-catalog"]' }), /original backend plugin/);
  assert.equal(f.calls.length, 0); assert.equal(f.externalAttempts(), 0);
});
