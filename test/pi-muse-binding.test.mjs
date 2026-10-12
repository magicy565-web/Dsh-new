import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const actor = { subject: 'local-operator', nativeAgentId: 'original:conversation/fixture' };
const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';
const bearer = 'local-protocol-fixture-only-not-a-real-credential';

test('DSH-free HTTP fixture: original Muse order/attempt/file/return protocol with explicit owner and no model/wake', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-muse-');
  const store = await openStore(directory);
  await store.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Original reviewed fixture', status: 'idle', activeRunId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  await store.close();
  const options = { dataDirectory: directory, museWorkerConfig: { workerId, ownerId: 'original-muse', tokenDigest: hash(bearer), enabled: true, scopeReviewed: true, externalBudgetVerified: true },
    museOriginalBinding: { actor, operators: [actor], expectedHost: 'fixture.test' } };
  let app = await createApp(options), address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function call(path, method = 'GET', body, worker = false) {
    const response = await httpFetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(worker ? { Host: 'fixture.test', Authorization: `Bearer ${bearer}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { response, data: await response.json() };
  }
  const path = `/conversations/${encodeURIComponent(actor.nativeAgentId)}/muse-delegations`;
  const input = { provider: 'muse', conversationId: actor.nativeAgentId, requestId: 'original-fixture-scope', content: 'Fixture public research; no real execution',
    order: { serviceId: 'channel-validation', product: 'Public fixture product', market: 'US', objective: 'Local protocol fixture only', budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString(), publicDataConfirmed: true } };
  const made = await call(path, 'POST', input);
  assert.equal(made.response.status, 201, JSON.stringify(made.data));
  const { orderId, reviewHash } = made.data.delegation;
  assert.equal((await call(path, 'POST', input)).data.delegation.orderId, orderId);
  assert.equal(app.runtime.listRuns().runs.length, 0);
  const review = { confirmed: true, expectedReviewHash: reviewHash };
  assert.equal((await call(`${path}/${orderId}/dispatch`, 'POST', review)).data.error.code, 'MW_CONVERSATION_APPROVAL_REQUIRED');
  assert.equal((await call(`${path}/${orderId}/approve`, 'POST', { ...review, confirmed: false })).response.status, 400);
  assert.equal((await call(`${path}/${orderId}/approve`, 'POST', review)).response.status, 200);
  assert.equal((await call(`${path}/${orderId}/dispatch`, 'POST', review)).response.status, 200);
  const claim = await call(`/muse-worker/v1/tasks/${orderId}/claim`, 'POST', { requestId: 'fixture-original-claim' }, true);
  assert.equal(claim.response.status, 200, JSON.stringify(claim.data));
  const attempt = { attemptId: claim.data.attemptId, fence: claim.data.fence };
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId, deliverables: [{ name: 'Fixture report', type: 'report', summary: 'Local fixture, no Muse execution' }], evidence: [{ title: 'Fixture source', url: 'https://www.loc.gov/about/', detail: 'Protocol only' }] }));
  const upload = await call(`/muse-worker/v1/tasks/${orderId}/upload-file`, 'POST', { ...attempt, uploadId: 'fixture-original-upload', filename: 'result.json', base64: bytes.toString('base64'), sha256: hash(bytes) }, true);
  assert.equal(upload.response.status, 201, JSON.stringify(upload.data));
  const submitted = await call(`/muse-worker/v1/tasks/${orderId}/submit-result`, 'POST', { ...attempt, requestId: 'fixture-original-submit', summary: 'Local protocol fixture', sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Fixture is not live Muse or wake evidence.' }, true);
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.data));
  const refreshed = await call(`${path}/${orderId}/refresh`, 'POST', {});
  assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.data));
  assert.equal(refreshed.data.delegation.phase, 'result_returned');
  assert.equal(refreshed.data.delegation.wake.observed, false);
  const filePath = `/muse-worker-files/${upload.data.artifactId}?version=1&sha256=${hash(bytes)}`;
  const response = await fetch(`http://127.0.0.1:${address.port}/api${filePath}`);
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('x-content-sha256'), hash(bytes));
  assert.equal((await call(`/artifacts/${upload.data.artifactId}/download?version=1`)).response.status, 404);
  assert.equal((await call(`/artifacts/${upload.data.artifactId}`, 'DELETE')).response.status, 404);
  assert.equal((await call('/bootstrap')).data.artifacts.some(item => item.id === upload.data.artifactId), false);
  assert.equal((await call(`/muse-worker-files/${upload.data.artifactId}?version=2&sha256=${hash(bytes)}`)).response.status, 404);
  await app.close(); app = await createApp(options); address = await app.listen(0);
  assert.equal((await call(`${path}/${orderId}`)).data.delegation.receiptHash, refreshed.data.delegation.receiptHash);
  assert.equal(app.store.read().museTasks.length, 1);
  assert.equal(app.runtime.listRuns().runs.length, 0);
});

test('DSH-free binding refuses missing original conversation instead of inventing another identity', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-muse-missing-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(createApp({ dataDirectory: directory, museWorkerConfig: { workerId, ownerId: 'original-muse', tokenDigest: hash(bearer), enabled: false, scopeReviewed: false, externalBudgetVerified: false }, museOriginalBinding: { actor, operators: [actor], expectedHost: 'fixture.test' } }), { code: 'MW_ORIGINAL_BINDING_REQUIRED' });
  const app = await createApp({ dataDirectory: directory }); await app.close();
});

function httpFetch(url, { method = 'GET', headers = {}, body } = {}) { return new Promise((resolve, reject) => { const request = http.request(url, { method, headers }, response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers }))); request.on('error', reject); request.end(body); }); }
