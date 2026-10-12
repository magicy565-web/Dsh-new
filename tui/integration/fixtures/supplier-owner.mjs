// Synthetic enterprise only. Original backend services and native ingress;
// no production URL, real login/code exchange, grant resolver or model execution.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { generateKeyPairSync, createHash } from 'node:crypto';
import http from 'node:http';
import { openStore } from '../../../server/store.mjs';
import { createApp } from '../../../server/index.mjs';
import { signWorkspaceRequest } from '../../../server/auth-ingress.mjs';
import { createWechatIngress } from '../../../server/wechat-ingress.mjs';
import { wechatIdentityDigest } from '../../../server/wechat-code-exchange.mjs';
import { createNativeOwnerTransport } from '../../owner-session-transport.mjs';

export const actor = { subject: 'synthetic-supplier-tui-owner', nativeAgentId: 'original:supplier/tui' };
export const origin = 'https://supplier-tui.test';
export const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==';
export const facts = { name: 'Pi supplier fixture shirt', description: 'Explicit fixture product', targetMarket: 'US', currency: 'USD', skuCode: 'PI-FIXTURE', supplierUnit: 'piece', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30, retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', handlingDays: 3, shippingDays: 7 };
export const publicFields = ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'];

export async function supplierFixture({ directory, snapshotFile } = {}) {
  const ownDirectory = !directory;
  directory ||= await mkdtemp('/tmp/pi-supplier-owner-');
  const store = await openStore(directory);
  if (!store.read().conversations.some(item => item.id === actor.nativeAgentId)) await store.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Synthetic original supplier owner', status: 'idle', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  await store.close();
  const pair = generateKeyPairSync('ed25519');
  const access = { mode: 'enterprise', workspaceId: 'synthetic-pi-supplier', publicOrigin: origin, issuer: 'synthetic-ingress', keyId: 'synthetic-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    members: [{ subject: actor.subject, role: 'admin' }, { subject: 'synthetic-other', role: 'admin' }, { subject: 'synthetic-viewer', role: 'viewer' }] };
  const workerToken = 'synthetic-pi-supplier-worker-only';
  const options = { dataDirectory: directory, access, capabilityEnvironment: {}, supplierOwnerMcpBinding: null,
    provider: { kind: 'fixture', configured: false, complete() { assert.fail('Model/network execution forbidden'); } },
    museWorkerConfig: { workerId: 'dfaa5ddc-6a48-4238-98a1-18e125466081', ownerId: 'synthetic-muse-owner', tokenDigest: createHash('sha256').update(workerToken).digest('hex'), enabled: true, scopeReviewed: true, externalBudgetVerified: true },
    museOriginalBinding: { actor, operators: [actor], expectedHost: 'supplier-tui.test' } };
  let app, port, ingress, session, token;
  const trace = [];
  const snapshot = () => {
    const state = app.store.read();
    return { services: state.workspaceSupplierServices?.services || [], artifacts: (state.artifacts || []).map(item => ({ id: item.id, filename: item.filename })), modelRuns: state.runs.length, orders: state.workerOrders || [], trace, realShopifyVerified: false };
  };
  async function saveSnapshot() {
    if (!snapshotFile) return;
    await writeFile(snapshotFile + '.tmp', JSON.stringify(snapshot()), { mode: 0o600 });
    await rename(snapshotFile + '.tmp', snapshotFile);
  }
  const httpCall = (target, { method = 'GET', body, subject = actor.subject, workspaceId = access.workspaceId, cookie = session?.cookie, csrf = session?.csrfToken, unsigned = false, headers = {} } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? '' : JSON.stringify(body);
    const request = http.request({ hostname: '127.0.0.1', port, path: target, method, headers: { Host: 'supplier-tui.test', Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      ...(unsigned ? {} : { 'X-Workspace-Assertion': signWorkspaceRequest({ ...access, privateKey: pair.privateKey, subject, workspaceId, method, target, body: bytes }) }),
      ...(target === '/api/session/login' ? { 'X-Workspace-Login': '1' } : {}), ...headers } }, response => {
      const chunks = []; response.on('data', bytes => chunks.push(bytes)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null }));
    });
    request.on('error', reject); request.end(bytes);
  });
  async function login(subject = actor.subject) {
    const result = await httpCall('/api/session/login', { method: 'POST', body: {}, subject, cookie: null });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return { cookie: result.headers['set-cookie'][0].split(';')[0], csrfToken: result.body.csrfToken };
  }
  async function start() {
    app = await createApp(options); port = (await app.listen(0)).port;
    session = await login(); token = session.cookie.split('=')[1];
    const appId = 'wx0123456789abcdef', appSecret = 'synthetic-original-ingress';
    ingress = createWechatIngress({ app, access, privateKey: pair.privateKey, appId, appSecret,
      profile: { version: 1, appId, workspaceId: access.workspaceId,
        review: { id: 'synthetic-original-review', reviewedBy: actor.subject, reviewedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() },
        bindings: [{ openidDigest: wechatIdentityDigest({ appId, appSecret, openid: 'synthetic-owner' }), subject: actor.subject }] },
      fetchImpl() { assert.fail('No real wx login/code exchange'); } });
    await saveSnapshot();
  }
  await start();
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, origin);
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    if (new URL(url).pathname.endsWith('/supplier-session-mcp')) trace.push({ method: body.method, tool: body.params?.name });
    const response = await ingress.handle({ method: options.method, target: new URL(url).pathname,
      headers: { host: 'supplier-tui.test', ...Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])) }, bytes: options.body === undefined ? Buffer.alloc(0) : Buffer.from(options.body) });
    await saveSnapshot();
    return new Response(response.status === 202 ? null : response.bytes, { status: response.status, headers: response.headers });
  };
  const transport = () => createNativeOwnerTransport({ origin, token, scope: { workspaceId: access.workspaceId, subject: actor.subject, conversationId: actor.nativeAgentId } }, { fetchImpl });
  return { directory, access, http: httpCall, login, transport, fetchImpl, snapshot, trace, workerToken,
    get app() { return app; }, get token() { return token; }, get session() { return session; },
    async restart() { ingress.close(); await app.close(); await start(); },
    async close() { ingress.close(); await app.close(); if (ownDirectory) await rm(directory, { recursive: true, force: true }); },
  };
}
