// Ordinary client business integration. Real local HTTP/Store/Pi faux/native
// Worker protocol, disposable memory-only identities; no live account/execution.
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { openStore } from '../../server/store.mjs';
import { createApp } from '../../server/index.mjs';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { signWorkspaceRequest } from '../../server/auth-ingress.mjs';
import { WorkspaceClient, memoryJournal, digest, until } from './support.mjs';
export const actor = { subject: 'client-business-fixture-owner', nativeAgentId: 'd68e1a48-96f2-4522-a88d-4066323c26b9' };
const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';
export const blankScope = () => ({ serviceId: null, product: null, market: null, objective: null, budgetCredits: null, deadlineAt: null });
export const propose = (scope, requestId, quote) => fauxAssistantMessage(fauxToolCall('workspace_propose_muse_draft', { scope, sources: Object.keys(scope).filter(field => scope[field] !== null).map(field => ({ field, kind: 'message', requestId, quote })) }), { stopReason: 'toolUse' });
export const readyScope = () => ({ serviceId: 'channel-validation', product: '公开夹克', market: '美国', objective: '研究公开销售渠道并提供证据', budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString() });
export const scopeText = scope => `请为${scope.product}研究${scope.market}市场的海外销售渠道验证，目标是${scope.objective}；额度上限${scope.budgetCredits} credits，截止${scope.deadlineAt}。`;
export async function intakeFixture(t) {
  const directory = await fs.mkdtemp('/tmp/wechat-muse-business-'), pair = generateKeyPairSync('ed25519');
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'client-business-fixture', issuer: 'fixture-ingress', keyId: 'fixture-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: actor.subject, role: 'admin' }] };
  const saved = await openStore(directory); await saved.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Original business fixture', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'idle', activeRunId: null })); await saved.close();
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const token = 'offline-client-worker-protocol-fixture';
  const options = { dataDirectory: directory, access, museWorkerConfig: { workerId, ownerId: 'offline-fixture-only', tokenDigest: digest(Buffer.from(token)), enabled: true, scopeReviewed: true, externalBudgetVerified: true }, museOriginalBinding: { actor, operators: [actor], expectedHost: 'workspace.example' } };
  const provider = () => createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
  let app = await createApp({ ...options, provider: provider() }), address = await app.listen(0), session;
  const port = address.port, baseUrl = `http://127.0.0.1:${port}`, requests = [], previews = [], journal = memoryJournal();
  let lost = false, corrupt = false;
  async function raw(path, method = 'GET', data, worker = false) {
    const target = '/api' + path, body = data === undefined ? '' : JSON.stringify(data);
    const headers = { Host: 'workspace.example', ...(worker ? { Authorization: `Bearer ${token}` } : { 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, subject: actor.subject, method, target, body }), ...(method !== 'GET' ? { Origin: access.publicOrigin } : {}), ...(path === '/session/login' ? { 'X-Workspace-Login': '1' } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}) }), ...(body ? { 'content-type': 'application/json' } : {}) };
    const response = await new Promise((resolve, reject) => { const req = http.request(baseUrl + target, { method, headers }, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }))); req.on('error', reject); req.end(body); });
    const bytes = Buffer.from(await response.arrayBuffer()); let result; try { result = JSON.parse(bytes); } catch { result = null; }
    if (path === '/session/login') session = { ...result, cookie: response.headers.get('set-cookie').split(';')[0] };
    return { status: response.status, data: result, bytes };
  }
  assert.equal((await raw('/session/login', 'POST', {})).status, 200);
  const platform = {
    request(options) { const path = new URL(options.url).pathname.slice(4); requests.push({ path, method: options.method, body: structuredClone(options.data) }); void raw(path, options.method, options.data).then(result => { if (lost && options.method === 'POST') { lost = false; options.fail({ errMsg: 'Actual committed reply lost in transport fixture' }); } else options.success({ statusCode: result.status, data: result.data }); }).catch(options.fail); return { abort() {} }; },
    downloadFile(options) { void raw(new URL(options.url).pathname.slice(4) + new URL(options.url).search).then(async result => { const tempFilePath = directory + '/actual-download-' + randomUUID(); await fs.writeFile(tempFilePath, result.bytes); options.success({ statusCode: result.status, tempFilePath }); }).catch(options.fail); },
    getFileSystemManager() { return { readFile(options) { void fs.readFile(options.filePath).then(bytes => options.success({ data: bytes.toString(options.encoding) })).catch(options.fail); }, getFileInfo(options) { assert.equal(options.digestAlgorithm, 'sha256'); void fs.readFile(options.filePath).then(bytes => options.success({ digest: corrupt ? '0'.repeat(64) : digest(bytes), size: bytes.length })).catch(options.fail); } }; },
    showModal(options) { options.success({ confirm: true, cancel: false }); },
    previewImage(options) { previews.push({ type: 'image', path: options.urls[0] }); options.success?.({}); },
    openDocument(options) { previews.push({ type: 'pdf', path: options.filePath }); options.success?.({}); },
    login() { assert.fail('No real wx.login/account in local business fixture'); },
  };
  const client = () => new WorkspaceClient(platform, { baseUrl, allowLoopback: true, goalMode: 'muse', journal });
  const close = async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); };
  t?.after?.(close);
  return { directory, platform, journal, requests, previews, client, faux, raw, get app() { return app; }, close,
    loseNext() { lost = true; }, corrupt(value = true) { corrupt = value; },
    respond(scope, quoteOverride) { faux.setResponses([() => { const request = requests.filter(item => item.method === 'POST' && (item.path.endsWith('/muse-drafts') || item.path.endsWith('/messages'))).at(-1); return propose(scope, request.body.requestId, quoteOverride || request.body.content); }]); },
    async settle(client) { await until(async () => { const result = await client.museDrafts(actor.nativeAgentId); return Boolean(result.drafts.length && result.drafts.at(-1).phase !== 'pending'); }); return (await client.museDrafts(actor.nativeAgentId)).drafts.at(-1); },
    async reopen() { await app.close(); app = await createApp({ ...options, provider: provider() }); await app.listen(port); session = null; assert.equal((await raw('/session/login', 'POST', {})).status, 200); },
    async deliver(orderId) {
      const claim = await raw(`/muse-worker/v1/tasks/${orderId}/claim`, 'POST', { requestId: randomUUID() }, true); assert.equal(claim.status, 200, JSON.stringify(claim.data));
      const attempt = { attemptId: claim.data.attemptId, fence: claim.data.fence };
      const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId, deliverables: [{ name: 'Client protocol fixture report', type: 'report', summary: '仅本地原 Worker 协议 fixture，无真实 Muse 执行。' }], evidence: [{ title: 'Fixture citation', url: 'https://www.loc.gov/about/', detail: 'No external fetch' }] }));
      const uploaded = await raw(`/muse-worker/v1/tasks/${orderId}/upload-file`, 'POST', { ...attempt, uploadId: randomUUID(), filename: '原-Muse-协议测试回执.json', base64: bytes.toString('base64'), sha256: digest(bytes) }, true); assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
      const result = await raw(`/muse-worker/v1/tasks/${orderId}/submit-result`, 'POST', { ...attempt, requestId: randomUUID(), summary: '原协议测试文件已保存；无真实账号执行或唤醒证据。', sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Local client business fixture only' }, true); assert.equal(result.status, 200, JSON.stringify(result.data));
      return { bytes, artifactId: uploaded.data.artifactId };
    },
  };
}
