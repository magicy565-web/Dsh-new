import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { openWorkspacePluginService } from '../server/workspace-plugin-service.mjs';
import { createWorkspacePluginFrontend } from '../server/workspace-plugin-frontend.mjs';
import { readBody, respond } from '../server/index.mjs';
import { canReadWorkerArtifact, workerArtifactOwner } from '../server/worker-artifact-access.mjs';
import { validateNativeMuseReconciliationReview } from '../server/muse-worker-native.mjs';

const actor = { subject: 'admin-fixture', nativeAgentId: 'original-admin-fixture' };
const viewer = { subject: 'viewer-fixture', nativeAgentId: 'original-viewer-fixture' };
const key = 'native-production-fixture-key_01234567890123456789';
const digest = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://workspace.native-fixture.test';
const host = new URL(origin).host;
const base = '/api/muse-worker/v1';

// Real deployed service/frontend/storage code; all identities and results below
// are isolated fixtures. No Cordis boot, HTTPS, real Vault or external model call.
test('Linux native service and employee ingress preserve owner, approval, files and restart fences', async t => {
  assert.equal(process.platform, 'linux', 'Run this deployment regression on Linux; do not skip durability checks.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-muse-native-regression-'));
  let service, frontend;
  t.after(async () => { await frontend?.close(); await service?.close(); await rm(directory, { recursive: true, force: true }); });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const access = { mode: 'enterprise', publicOrigin: origin, workspaceId: 'native-regression-fixture',
    issuer: 'native-fixture-ingress', keyId: 'ephemeral-fixture-key',
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    members: [{ subject: actor.subject, role: 'admin' }, { subject: viewer.subject, role: 'viewer' }] };
  const pluginConfig = { enabled: true, version: 1, scopeId: 'native-regression-fixture',
    dataDirectory: directory, workerConfigFile: path.join(directory, 'unused-worker-fixture.json'), operators: [actor, viewer] };
  const workerConfiguration = { enabled: true, admissions: [{ id: 'original-native-fixture-grant',
    subject: actor.subject, provider: 'muse', agentId: 'original-native-fixture-worker', providerOwnerId: 'original-native-fixture-owner',
    protocolFingerprint: digest('native-protocol-fixture'), admission: 'invited', transport: 'muse-native', expiresAt: Date.now() + 86400_000 }] };
  const museConfig = { workerId: 'df28413e-de75-4b18-93dc-c72e2a44d6bc', ownerId: 'personal-fixture-owner', tokenDigest: digest(key),
    enabled: false, scopeReviewed: false, externalBudgetVerified: false };
  async function mount(config) {
    service = await openWorkspacePluginService({ config: pluginConfig, workerConfiguration });
    if (service.status().phase === 'paused') {
      const status = service.status();
      await service.resume({ expectedEpoch: status.epoch, configurationHash: status.configurationHash, requestId: 'explicit-empty-fixture-resume' });
    }
    const binding = service.attachMuseRest({ config, actor, expectedHost: host, readBody, respond });
    await binding.initialize();
    frontend = await createWorkspacePluginFrontend({ service, operators: pluginConfig.operators,
      dataDirectory: directory, access });
    await frontend.listen();
  }
  async function request(route, method = 'GET', body, { subject, cookie, csrf, museBearer } = {}) {
    const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const headers = { Host: host, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    if (subject) {
      const seconds = Math.floor(Date.now() / 1000);
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = encode({ alg: 'EdDSA', typ: 'workspace-ingress+jwt', kid: access.keyId }) + '.' + encode({
        iss: access.issuer, aud: origin, workspace: access.workspaceId, sub: subject, method, target: route,
        iat: seconds, exp: seconds + 20, jti: randomUUID(), bodySha256: digest(bytes) });
      headers['x-workspace-assertion'] = input + '.' + sign(null, Buffer.from(input), privateKey).toString('base64url');
      if (method !== 'GET') headers.Origin = origin;
      if (route === '/api/session/login') headers['x-workspace-login'] = '1';
      if (cookie) headers.Cookie = cookie;
      if (csrf) headers['x-csrf-token'] = csrf;
    }
    if (museBearer) headers.Authorization = 'Bearer ' + museBearer;
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: frontend.address().port, path: route, method, headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => { try { resolve({ status: res.statusCode, headers: res.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
      });
      req.on('error', reject); req.end(bytes.length ? bytes : undefined);
    });
  }
  async function login(subject) {
    const response = await request('/api/session/login', 'POST', {}, { subject });
    assert.equal(response.status, 200);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    const session = await request('/api/session', 'GET', undefined, { subject, cookie });
    assert.equal(session.status, 200);
    return { subject, cookie, csrf: session.body.csrfToken };
  }
  await mount(museConfig);
  assert.equal((await request(base + '/identity')).status, 401);
  assert.equal((await request(base + '/identity')).body.error.code, 'MW_AUTH_REQUIRED');
  assert.equal((await request(base + '/identity', 'GET', undefined, { museBearer: key })).body.approved, false);
  assert.deepEqual((await request(base + '/inbox', 'GET', undefined, { museBearer: key })).body.tasks, []);
  assert.equal((await request('/api/worker-orders', 'GET', undefined, { museBearer: key })).status, 401);
  const admin = await login(actor.subject), readOnly = await login(viewer.subject);
  assert.equal((await request('/api/worker-services', 'GET', undefined, readOnly)).status, 403);
  const catalog = await request('/api/worker-services', 'GET', undefined, admin);
  assert.equal(catalog.status, 200); assert(catalog.body.services.every(item => !item.executable));
  await frontend.close(); frontend = undefined; await service.close(); service = undefined;

  await mount({ ...museConfig, enabled: true, scopeReviewed: true, externalBudgetVerified: true });
  const approvedAdmin = await login(actor.subject);
  const create = await request('/api/worker-orders', 'POST', { serviceId: 'buyer-discovery', product: 'Synthetic fixture',
    market: 'US', objective: 'Local Linux protocol fixture; no real research.', requestId: 'native-disk-order',
    budgetCredits: 10, deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true }, approvedAdmin);
  assert.equal(create.status, 201); const id = create.body.order.id;
  assert.equal((await request('/api/worker-orders/' + id + '/dispatch', 'POST', {}, approvedAdmin)).status, 409);
  assert.equal((await request('/api/worker-orders/' + id + '/approve', 'POST', { confirmed: true }, approvedAdmin)).status, 200);
  assert.equal((await request('/api/worker-orders/' + id + '/dispatch', 'POST', {}, approvedAdmin)).status, 200);
  const claim = await request(base + '/tasks/' + id + '/claim', 'POST', { requestId: 'native-disk-original-claim' }, { museBearer: key });
  assert.equal(claim.status, 200);
  const attempt = { attemptId: claim.body.attemptId, fence: claim.body.fence };
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId: id,
    deliverables: [{ name: 'Linux fixture table', type: 'table', summary: 'Synthetic local fixture; no Muse execution.' }],
    evidence: [{ title: 'Fixture source', url: 'https://www.loc.gov/about/', detail: 'Protocol fixture only.' }],
    prospects: [{ name: 'Synthetic Linux Company', country: 'US', website: 'https://www.loc.gov',
      sourceUrl: 'https://www.loc.gov/about/', fitReason: 'Synthetic fixture; no research result.' }] }));
  const uploaded = await request(base + '/tasks/' + id + '/upload-file', 'POST', { ...attempt, uploadId: 'disk-file',
    filename: 'fixture.json', base64: bytes.toString('base64'), sha256: digest(bytes) }, { museBearer: key });
  assert.equal(uploaded.status, 201);
  const saved = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
  const artifact = saved.artifacts.find(item => item.id === uploaded.body.artifactId);
  assert.equal(workerArtifactOwner(saved, artifact), actor.subject);
  assert.equal(canReadWorkerArtifact(saved, artifact, viewer.subject), false);
  assert.equal((await request('/api/artifacts/' + artifact.id, 'PATCH', { expectedRevision: artifact.revision, title: 'Edited fixture' }, approvedAdmin)).status, 403);
  assert.equal((await request('/api/artifacts/' + artifact.id, 'DELETE', undefined, approvedAdmin)).status, 403);
  assert.equal((await request(base + '/tasks/' + id + '/submit-result', 'POST', { ...attempt,
    requestId: 'disk-submit-original', summary: 'Synthetic Linux fixture.', sources: ['https://www.loc.gov/about/'],
    toolEvidence: [], evidenceNote: 'No real Muse execution; isolated production regression fixture.' }, { museBearer: key })).status, 200);
  const refreshed = await request('/api/worker-orders/' + id + '/refresh', 'POST', {}, approvedAdmin);
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.order.status, 'review_required');
  assert.equal((await request('/api/worker-orders/' + id + '/accept', 'POST', { confirmed: true }, approvedAdmin)).status, 200);
  const promoted = await request('/api/worker-orders/' + id + '/promote', 'POST',
    { confirmed: true, requestId: 'disk-import-original', indices: [0] }, approvedAdmin);
  assert.equal(promoted.status, 200); assert.equal(promoted.body.createdCount, 1);
  const importedState = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
  assert.equal(importedState.workerOpportunities[0].sourceOrderId, id);

  async function startFixtureOrder(requestId) {
    const created = await request('/api/worker-orders', 'POST', { serviceId: 'buyer-discovery', product: 'Synthetic fixture',
      market: 'US', objective: 'Isolated lifecycle fixture; no real work.', requestId, budgetCredits: 10,
      deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true }, approvedAdmin);
    assert.equal(created.status, 201); const ref = created.body.order.id;
    assert.equal((await request('/api/worker-orders/' + ref + '/approve', 'POST', { confirmed: true }, approvedAdmin)).status, 200);
    assert.equal((await request('/api/worker-orders/' + ref + '/dispatch', 'POST', {}, approvedAdmin)).status, 200);
    const claimed = await request(base + '/tasks/' + ref + '/claim', 'POST', { requestId: requestId + '-claim' }, { museBearer: key });
    assert.equal(claimed.status, 200);
    return { id: ref, attempt: { attemptId: claimed.body.attemptId, fence: claimed.body.fence } };
  }
  const pausedOrder = await startFixtureOrder('disk-pause-order');
  assert.equal((await request(base + '/tasks/' + pausedOrder.id + '/heartbeat', 'POST',
    { ...pausedOrder.attempt, requestId: 'disk-original-heartbeat' }, { museBearer: key })).status, 200);
  let lifecycle = service.status();
  await service.pause({ expectedEpoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash, requestId: 'explicit-disk-pause' });
  const revoked = await request(base + '/identity', 'GET', undefined, { museBearer: key });
  assert.equal(revoked.body.error.code, 'WORKSPACE_PLUGIN_STALE');
  lifecycle = service.status();
  await assert.rejects(service.resume({ expectedEpoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash,
    requestId: 'denied-unfinished-resume' }), { code: 'WORKSPACE_PLUGIN_RECONCILE' });
  const reconciliation = validateNativeMuseReconciliationReview({ version: 1, action: 'muse-reconcile',
    requestId: 'exact-operator-reviewed-stop', expectedEpoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash,
    callbackCandidateIds: [] }, lifecycle);
  await service.refreshMuseRest(reconciliation);
  assert.equal(service.status().phase, 'paused');
  assert.equal((await request(base + '/tasks/' + pausedOrder.id + '/heartbeat', 'POST',
    { ...pausedOrder.attempt, requestId: 'paused-no-renewal' }, { museBearer: key })).body.error.code, 'WORKSPACE_PLUGIN_PAUSED');
  assert.equal((await request('/api/worker-orders/' + pausedOrder.id + '/cancel', 'POST', {}, approvedAdmin)).status, 200);
  assert.equal((await request(base + '/tasks/' + pausedOrder.id + '/confirm-stop', 'POST',
    { ...pausedOrder.attempt, requestId: 'disk-original-stop' }, { museBearer: key })).status, 200);
  lifecycle = service.status();
  await service.resume({ expectedEpoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash, requestId: 'explicit-reconciled-resume' });
  lifecycle = service.status(); await service.refreshMuseRest({ expectedEpoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash });
  const live = await startFixtureOrder('disk-restart-order');
  await frontend.close(); frontend = undefined; await service.close(); service = undefined;
  const stopped = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
  const original = stopped.museTasks.find(item => item.id === live.id);
  assert.equal(original.attemptId, live.attempt.attemptId); assert.equal(original.fence, live.attempt.fence);
  assert.equal(original.leaseUntil, null); assert.equal(original.status, 'blocked');
  assert.equal(stopped.workerOrders.find(item => item.id === live.id).remoteJobId, live.id);
  assert.equal(stopped.workspacePlugin.phase, 'detached');
});
