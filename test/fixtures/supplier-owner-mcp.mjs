// Disposable enterprise ingress and grant fixtures only. No real identity,
// credential, account authorization or external service is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync, createHash, randomUUID } from 'node:crypto';
import { createApp } from '../../server/index.mjs';
import { signWorkspaceRequest } from '../../server/auth-ingress.mjs';
import { supplierHash } from '../../server/supplier-profile.mjs';

export const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==';
export const publicFields = ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'];
export const retailFacts = { name: 'Owner MCP fixture shirt', description: 'Known owner-supplied facts', targetMarket: 'US', currency: 'USD', skuCode: 'MCP-OWNER', supplierUnit: 'piece', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30, retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', handlingDays: 3, shippingDays: 7 };
const keyPair = generateKeyPairSync('ed25519');

export async function supplierOwnerFixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/supplier-owner-mcp-');
  let time = Date.parse('2026-10-20T12:00:00Z'), app, port, resolverHook = null;
  const grants = new Map(), seen = [];
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'supplier-fixture', issuer: 'supplier-fixture-ingress', keyId: 'synthetic-fixture-key', publicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'owner', role: 'admin' }, { subject: 'other', role: 'operator' }, { subject: 'viewer', role: 'viewer' }] };
  const grantKey = ({ actor, conversationId, operation, serviceId, inputHash }) => supplierHash([actor.subject, actor.workspaceId, conversationId, operation, serviceId || null, inputHash]);
  const binding = { async readReviewedScope(request) { seen.push(structuredClone(request)); if (resolverHook) return resolverHook(request); return grants.get(grantKey(request)) || null; } };
  const workerToken = 'synthetic-owner-transport-worker-only';
  const config = { dataDirectory: directory, access, accessClock: () => time, capabilityEnvironment: {},
    provider: { kind: 'fixture', configured: false, complete() { assert.fail('No model executes in owner MCP fixtures'); } },
    supplierOwnerMcpBinding: binding, schedulerIntervalMs: 60000,
    dotWorkerConfig: { workerId: 'synthetic-dot-only', ownerId: 'synthetic-worker', enabled: true, scopeReviewed: true, externalBudgetVerified: true, tokenDigest: createHash('sha256').update(workerToken).digest('hex') }, ...options };
  const open = async () => { app = await createApp(config); port = (await app.listen(0)).port; };
  await open();
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const api = (route, { method = 'POST', body = {}, session, subject = session?.subject || 'owner', headers = {}, unsigned = false, browser = true, signedBody } = {}) => new Promise((resolve, reject) => {
    const bytes = method === 'GET' ? '' : JSON.stringify(body);
    const assertion = signWorkspaceRequest({ ...access, privateKey: keyPair.privateKey, subject, method, target: route, body: signedBody === undefined ? bytes : signedBody, now: time });
    const request = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { Host: 'workspace.example', ...(browser ? { Origin: access.publicOrigin } : {}), 'Content-Type': 'application/json', ...(!unsigned ? { 'X-Workspace-Assertion': assertion } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { const bytes = Buffer.concat(chunks), raw = bytes.toString(); let data; try { data = JSON.parse(raw); } catch { data = raw; } resolve({ status: response.statusCode, body: data, headers: response.headers, bytes }); });
    }); request.on('error', reject); request.end(bytes);
  });
  const login = async (subject = 'owner') => { const result = await api('/api/session/login', { subject, headers: { 'X-Workspace-Login': '1' } }); assert.equal(result.status, 200, JSON.stringify(result)); return { subject, cookie: result.headers['set-cookie'][0].split(';')[0], csrfToken: result.body.csrfToken }; };
  let session = await login();
  const created = await api('/api/conversations', { session, body: { title: 'Original owner MCP conversation', requestId: 'owner-fixture-conversation' } }); assert.equal(created.status, 201, JSON.stringify(created));
  const cid = created.body.conversation.id;
  const rpc = (method, params = {}, extra = {}) => api(`/api/conversations/${extra.cid || cid}/supplier-mcp`, { session, body: { jsonrpc: '2.0', id: 1, method, params }, ...extra });
  const args = (serviceId, input) => ({ ...(serviceId ? { serviceId } : {}), ...(input !== undefined ? { input } : {}) });
  const grant = (operation, serviceId, input = {}, extra = {}) => {
    const actor = { subject: extra.subject || 'owner', workspaceId: access.workspaceId };
    const request = { actor, conversationId: extra.cid || cid, operation, serviceId: serviceId || null, inputHash: supplierHash({ operation, serviceId: serviceId || null, input }) };
    const scope = { subject: actor.subject, workspaceId: actor.workspaceId, conversationId: request.conversationId, operations: [operation], serviceIds: serviceId ? [serviceId] : [], inputHash: request.inputHash, expiresAt: new Date(time + 60_000).toISOString(), ...extra.scope };
    grants.set(grantKey(request), scope); return scope;
  };
  const tool = async (operation, serviceId, input, extra = {}) => {
    const response = await rpc('tools/call', { name: `workspace_supplier_owner_${operation}`, arguments: args(serviceId, input) }, extra);
    return { ...response, value: response.body.result?.structuredContent, error: response.body.result?.isError ? JSON.parse(response.body.result.content[0].text) : response.body.error };
  };
  const reviewed = async (operation, serviceId, input, extra = {}) => { grant(operation, serviceId, input, extra); const response = await tool(operation, serviceId, input, extra); assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.error, undefined, JSON.stringify(response)); return response.value; };
  return { api, rpc, tool, grant, reviewed, cid, directory, login, workerToken, access, get session() { return session; }, get app() { return app; }, get seen() { return seen; }, clearGrants() { grants.clear(); }, hook(fn) { resolverHook = fn; }, advance(ms) { time += ms; }, async restart() { await app.close(); await open(); session = await login(); },
    async retail() {
      const uploaded = await reviewed('image_upload', null, { requestId: 'owner-fixture-image', filename: 'shirt.png', base64: png, sourceNote: 'Synthetic owner image' });
      const image = uploaded.artifact, facts = { ...retailFacts, images: [{ kind: 'artifact', asset: { artifactId: image.id, version: image.currentVersion, sha256: image.sha256 }, sourceNote: 'Synthetic owner image' }] };
      const saved = await reviewed('intake', null, { requestId: 'owner-fixture-facts', facts });
      const preview = await reviewed('preview', saved.serviceId, { requestId: 'owner-fixture-preview', expectedRevision: 1, confirmed: true, publicFields });
      return { image, facts, saved, preview, sid: saved.serviceId };
    },
    command: operation => ({ requestId: randomUUID(), operationId: operation.id, expectedScopeHash: operation.scopeHash, confirmed: true }),
  };
}
