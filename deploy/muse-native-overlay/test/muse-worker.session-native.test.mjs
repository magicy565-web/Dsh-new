import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { startNativeDotHost } from '../deploy/native-dot-host.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

// Actual original Cordis/Agent/Session/Goal and durable business/file services.
// The Muse execution and ingress identities below are isolated test fixtures.
test('actual Harness returns original Muse files to original Session and signed UI, preserving Goal across restart', async t => {
  const harnessRoot = process.env.DSH_TEST_SOURCE_ROOT;
  assert(harnessRoot && path.isAbsolute(harnessRoot), 'Explicit original Harness source is required.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-muse-session-native-'));
  let host, cookie;
  const originalFetch = globalThis.fetch; let externalCalls = 0;
  globalThis.fetch = () => { externalCalls++; throw Error('No external model, research or paid calls allowed in this fixture.'); };
  t.after(async () => { await host?.close(); globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); });
  const actor = { subject: 'original-owner', nativeAgentId: 'original-muse-session' };
  const other = { subject: 'foreign-owner', nativeAgentId: 'foreign-session' };
  const viewer = { subject: 'viewer-owner', nativeAgentId: 'viewer-session' };
  const keys = generateKeyPairSync('ed25519'), hash = x => createHash('sha256').update(x).digest('hex');
  const members = path.join(directory, 'members.json'), publicKeyFile = path.join(directory, 'ingress.pem'), workerFile = path.join(directory, 'workers.json');
  await writeFile(members, JSON.stringify([{ subject: actor.subject, role: 'admin' }, { subject: other.subject, role: 'admin' }, { subject: viewer.subject, role: 'viewer' }]), { mode: 0o600 });
  await writeFile(publicKeyFile, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  await writeFile(workerFile, JSON.stringify({ enabled: true, admissions: [{ id: 'original-dot-grant', subject: actor.subject,
    provider: 'dot', agentId: 'original-dot-fixture', providerOwnerId: 'original-dot-owner', protocolFingerprint: hash('original-dot'),
    admission: 'invited', transport: 'workspace-pull', expiresAt: Date.now() + 86400_000 }] }), { mode: 0o600 });
  const staticDirectory = path.join(directory, 'static'); await mkdir(staticDirectory);
  const origin = 'https://workspace.session-fixture.test', issuer = 'isolated-session-ingress', keyId = 'fixture-key', workspaceId = 'isolated-session-workspace';
  const environment = { WORKSPACE_ACCESS_MODE: 'enterprise', WORKSPACE_PUBLIC_ORIGIN: origin, WORKSPACE_ID: workspaceId,
    WORKSPACE_INGRESS_ISSUER: issuer, WORKSPACE_INGRESS_KEY_ID: keyId, WORKSPACE_MEMBERS_FILE: members, WORKSPACE_INGRESS_PUBLIC_KEY_FILE: publicKeyFile };
  const configuration = { version: 1, harnessRoot, sessionDirectory: path.join(directory, 'sessions'), mountDirectory: path.join(directory, 'mount'),
    staticDirectory, port: 0, dotOwnerSubject: actor.subject, plugin: { enabled: true, version: 1, scopeId: 'session-fixture',
      dataDirectory: path.join(directory, 'business'), workerConfigFile: workerFile, operators: [actor, other, viewer] } };
  const dotConfiguration = { enabled: true, resource: 'https://dot.session-fixture.test/mcp', authorizationServer: 'https://auth.session-fixture.test',
    workspaceId, bindings: [], callbackURLs: [], encryptionKeys: [{ id: 'isolated-storage-key', base64: Buffer.alloc(32, 9).toString('base64') }],
    activeEncryptionKey: 'isolated-storage-key', keys: [{ kid: keyId, alg: 'EdDSA', jwk: keys.publicKey.export({ format: 'jwk' }) }] };
  const key = 'isolated-muse-key_012345678901234567890123456789';
  const worker = { workerId: 'dd8b66e5-adc6-4a1d-95bc-056f9bc1e7cf', ownerId: 'original-muse', tokenDigest: hash(key),
    enabled: true, scopeReviewed: true, externalBudgetVerified: true };
  const boot = () => startNativeDotHost({ configuration, dotConfiguration, museConfiguration: { version: 1, worker, actor }, environment });
  const request = (route, { body, subject = actor.subject, session, muse = false } = {}) => new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body), method = body === undefined ? 'GET' : 'POST';
    const headers = { Host: new URL(origin).host,
      ...(muse ? { Authorization: 'Bearer ' + key } : {
        'X-Workspace-Assertion': signWorkspaceRequest({ publicOrigin: origin, issuer, keyId, workspaceId, privateKey: keys.privateKey, subject, method, target: route, body: raw }),
        ...(session ? { Cookie: session } : {}), ...(route === '/api/session/login' ? { 'X-Workspace-Login': '1' } : {}) }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) };
    // Muse REST forbids browser Origin; the dedicated credential is never a UI cookie.
    if (muse) delete headers.Origin;
    const req = http.request({ host: '127.0.0.1', port: host.frontend.address().port, path: route, method, headers }, res => {
      const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, bytes,
          body: res.headers['content-type']?.includes('application/json') ? JSON.parse(bytes) : undefined });
      });
    }); req.on('error', reject); req.end(raw);
  });
  const login = async subject => { const response = await request('/api/session/login', { body: {}, subject }); assert.equal(response.status, 200); return response.headers['set-cookie'][0].split(';')[0]; };
  host = await boot();
  assert(host.ctx.workspaceMuseSessionHost);
  const originalAgent = host.ctx.agents.get(actor.nativeAgentId);
  const originalGoal = host.ctx.goals.create(originalAgent, { objective: 'Original public pending Goal; receipt delivery must not start or complete it.', maxGoalRounds: 1 });
  await host.ctx.sessions.flush(originalAgent.session);
  const goalBefore = structuredClone(host.ctx.goals.get(originalAgent));
  const desk = host.service.muse.bindDesk(actor);
  const { order } = await desk.create({ requestId: 'original-native-order', serviceId: 'channel-validation', product: 'Synthetic public fixture',
    market: 'US', objective: 'Isolated native regression; no real research.', budgetCredits: 5,
    deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true });
  await desk.approve(order.id, { confirmed: true }); await desk.dispatch(order.id);
  const base = '/api/muse-worker/v1/tasks/' + order.id;
  const claim = await request(base + '/claim', { muse: true, body: { requestId: 'original-native-claim' } }); assert.equal(claim.status, 200);
  const attempt = { attemptId: claim.body.attemptId, fence: claim.body.fence };
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId: order.id,
    deliverables: [{ name: 'Native fixture report', type: 'report', summary: 'Synthetic contract fixture.' }],
    evidence: [{ title: 'Fixture reference', url: 'https://www.loc.gov/about/', detail: 'No real research performed.' }] }));
  const upload = await request(base + '/upload-file', { muse: true, body: { ...attempt, uploadId: 'original-native-upload', filename: 'report.json', base64: bytes.toString('base64'), sha256: hash(bytes) } }); assert.equal(upload.status, 201);
  const submit = await request(base + '/submit-result', { muse: true, body: { ...attempt, requestId: 'original-native-submit', summary: 'Isolated native fixture.',
    sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Synthetic local fixture; no real Muse task was executed.' } }); assert.equal(submit.status, 200);
  await host.ctx.workspaceMuseSessionHost.reconcile();
  cookie = await login(actor.subject);
  const view = await request('/api/personal-worker', { session: cookie }); assert.equal(view.status, 200);
  assert.equal(view.body.museTasks.length, 1); assert.deepEqual(view.body.dotTasks, []);
  const task = view.body.museTasks[0], reference = task.receipt.files[0];
  assert.equal(task.orderId, order.id); assert.equal(task.taskRef, order.id); assert.equal(task.attemptId, attempt.attemptId);
  assert.equal(task.fence, attempt.fence); assert.equal(task.receiptHash, task.returnedHash); assert.equal(task.status, 'review_required'); assert.equal(task.acceptedAt, null);
  assert.deepEqual(host.ctx.goals.get(originalAgent), goalBefore);
  const fileRoute = '/api/muse-worker-files/' + reference.id + '?version=1&sha256=' + reference.sha256;
  const downloaded = await request(fileRoute, { session: cookie }); assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.bytes, bytes); assert.equal(downloaded.headers['x-content-sha256'], hash(bytes));
  assert.equal((await request(fileRoute.replace(reference.sha256, hash('wrong')), { session: cookie })).status, 404);
  const otherCookie = await login(other.subject), viewerCookie = await login(viewer.subject);
  assert.equal((await request('/api/personal-worker', { subject: other.subject, session: otherCookie })).body.museTasks, undefined);
  assert.equal((await request('/api/personal-worker', { subject: viewer.subject, session: viewerCookie })).body.museTasks, undefined);
  assert.equal((await request(fileRoute, { subject: other.subject, session: otherCookie })).status, 404);
  assert.equal((await request(fileRoute, { subject: viewer.subject, session: viewerCookie })).status, 403);
  const receiptId = host.service.muse.bindSession(actor).messageId(order.id);
  const noticeCount = agent => agent.session.ownEvents().flatMap(e => e.type === 'agent/inbox/spliced' ? e.data.inserted : []).filter(m => m.id === receiptId).length;
  assert.equal(noticeCount(originalAgent), 1);
  const persisted = JSON.parse(await readFile(path.join(configuration.plugin.dataDirectory, 'workspace.json'), 'utf8'));
  assert.equal(persisted.messages.filter(m => m.id === receiptId).length, 1);
  assert.equal(persisted.messages.find(m => m.id === receiptId).content, task.receipt.summary);
  assert.equal(hash(JSON.stringify(persisted.messages.find(m => m.id === receiptId).museReceipt)), task.receiptHash);
  assert.equal(persisted.workspaceMuseSessionReceipts.receipts.length, 1);
  await host.close(); host = undefined;
  host = await boot(); assert.equal(host.service.status().phase, 'paused');
  await host.ctx.workspaceMuseSessionHost.reconcile();
  const resumedAgent = host.ctx.agents.get(actor.nativeAgentId), resumedGoal = host.ctx.goals.get(resumedAgent);
  assert.equal(resumedGoal.id, originalGoal.id); assert.equal(resumedGoal.phase, 'active'); assert.equal(resumedGoal.roundsStarted, 0);
  assert.equal(noticeCount(resumedAgent), 1);
  const resumed = (await host.service.muse.bindSession(actor).view())[0];
  assert.equal(resumed.receiptHash, task.receiptHash); assert.equal(resumed.returnedHash, task.returnedHash);
  assert.equal(resumed.attemptId, attempt.attemptId); assert.equal(resumed.fence, attempt.fence);
  assert.equal((await host.ctx.sessionPersistence.list()).length, 3); assert.equal(externalCalls, 0);
  // Owner acceptance remains a distinct explicit business operation.
  await host.service.muse.bindDesk(actor).accept(order.id, { confirmed: true });
  assert.equal((await host.service.muse.bindSession(actor).view())[0].status, 'accepted');
  assert.equal(noticeCount(resumedAgent), 1); assert.equal(host.ctx.goals.get(resumedAgent).roundsStarted, 0);
});
