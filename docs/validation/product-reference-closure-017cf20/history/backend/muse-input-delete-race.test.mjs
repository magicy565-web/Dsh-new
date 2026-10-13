import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { openStore } from '/workspace/workspace-release-20261013/server/store.mjs';
import { createApp } from '/workspace/workspace-release-20261013/server/index.mjs';
import { createPiProvider } from '/workspace/workspace-release-20261013/server/pi-provider.mjs';
import { signWorkspaceRequest } from '/workspace/workspace-release-20261013/server/auth-ingress.mjs';
const actor = { subject: 'fixture-owner', nativeAgentId: 'd68e1a48-96f2-4522-a88d-4066323c26b9' };
const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';
const empty = () => ({ serviceId: null, product: null, market: null, objective: null, budgetCredits: null, deadlineAt: null });
const proposal = (scope, requestId, quote) => fauxAssistantMessage(fauxToolCall('workspace_propose_muse_draft', {
  scope, sources: Object.keys(scope).filter(field => scope[field] !== null).map(field => ({ field, kind: 'message', requestId, quote })),
}), { stopReason: 'toolUse' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/workspace-muse-draft-'), pair = generateKeyPairSync('ed25519'); // Offline in-memory identity.
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'fixture-workspace', issuer: 'fixture-ingress', keyId: 'fixture-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: actor.subject, role: 'admin' }] };
  const saved = await openStore(directory); await saved.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Original fixture conversation', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'idle', activeRunId: null })); await saved.close();
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const options = { dataDirectory: directory, access, museWorkerConfig: { workerId, ownerId: 'offline-fixture-only', tokenDigest: createHash('sha256').update('offline-protocol-fixture-only').digest('hex'), enabled: true, scopeReviewed: true, externalBudgetVerified: true }, museOriginalBinding: { actor, operators: [actor], expectedHost: 'workspace.example' } };
  let app = await createApp({ ...options, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) }), address = await app.listen(0), session;
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function call(path, method = 'GET', data) {
    const target = '/api' + path, body = data ? JSON.stringify(data) : '', headers = { Host: 'workspace.example', 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, subject: actor.subject, method, target, body }), ...(method !== 'GET' ? { Origin: access.publicOrigin } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(path === '/session/login' ? { 'X-Workspace-Login': '1' } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}) };
    const response = await new Promise((resolve, reject) => { const req = http.request(`http://127.0.0.1:${address.port}${target}`, { method, headers }, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }))); req.on('error', reject); req.end(body); });
    const result = { status: response.status, data: await response.json() };
    if (path === '/session/login') session = { ...result.data, cookie: response.headers.get('set-cookie').split(';')[0] };
    return result;
  }
  assert.equal((await call('/session/login', 'POST', {})).status, 200);
  const path = `/conversations/${actor.nativeAgentId}/muse-drafts`;
  const settled = async id => { for (let i = 0; i < 500; i++) { const item = (await call(path + '/' + id)).data.draft; if (item.phase !== 'pending') return item; await pause(10); } throw Error('Draft fixture timeout'); };
  return { directory, faux, call, path, settled, get app() { return app; }, async reopen() { await app.close(); app = await createApp({ ...options, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) }); address = await app.listen(0); session = null; await call('/session/login', 'POST', {}); } };
}
function readyInput(requestId = 'ready-request') {
  const scope = { serviceId: 'channel-validation', product: 'Fixture public product', market: 'US', objective: 'Compare public channels', budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString() };
  const content = `${scope.serviceId}; ${scope.product}; ${scope.market}; ${scope.objective}; 5 credits; ${scope.deadlineAt}`;
  return { scope, content, requestId };
}
const confirm = (draft, requestId = 'prepare-original') => ({ requestId, expectedRevision: draft.revision, expectedDraftHash: draft.draftHash, confirmed: true, budgetConfirmed: true, deadlineConfirmed: true, publicDataConfirmed: true });


test('selected exact input deleted after read checks must block original Muse prepare intent', async t => {
  const f = await fixture(t), input = readyInput('artifact-source-intake');
  const { artifact } = await f.app.artifacts.create({ filename: 'public-intake.txt', content: input.content });
  const exactSource = { kind: 'artifact', id: artifact.id, version: 1, sha256: artifact.sha256, quote: input.content };
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_muse_draft', {
    scope: input.scope,
    sources: Object.keys(input.scope).map(field => ({ field, ...exactSource })),
  }), { stopReason: 'toolUse' })]);
  const made = await f.call(f.path, 'POST', {
    requestId: input.requestId, content: 'Prepare only from the reviewed exact public intake file.',
    inputContext: { artifacts: [{ id: artifact.id, version: 1 }] },
  });
  assert.equal(made.status, 202);
  const draft = await f.settled(made.data.draftId);
  assert.equal(draft.phase, 'ready_for_review');
  const pinned = f.app.store.read().runs.find(run => run.id === made.data.run.id).inputContextSnapshot.artifacts[0];
  assert.equal(pinned.content, input.content);
  assert.equal(pinned.sha256, artifact.sha256);
  // Commit the ordinary delete immediately before the preparation writer
  // executes, modeling a concurrent HTTP delete winning writer admission.
  const originalUpdate = f.app.store.update.bind(f.app.store);
  let deleteBeforeIntent = true;
  f.app.store.update = async callback => {
    if (deleteBeforeIntent) {
      deleteBeforeIntent = false;
      await f.app.artifacts.delete(artifact.id);
      assert.equal(f.app.store.read().artifacts.some(item => item.id === artifact.id), false);
    }
    return originalUpdate(callback);
  };
  try {
    await assert.rejects(f.app.museDrafts.prepare(actor.nativeAgentId, draft.id, confirm(draft, 'prepare-exact-file')), { code: 'INPUT_ARTIFACT_CHANGED' });
    assert.equal((f.app.store.read().workerOrders || []).length, 0);
    assert.equal(f.app.store.read().workspaceMuseDrafts.drafts[0].prepare, null);
  } finally {
    f.app.store.update = originalUpdate;
  }
});
