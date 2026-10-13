import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
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

test('actual Pi tool/HTTP: natural goal clarifies one durable draft, then separately prepares/approves/dispatches one original order', async t => {
  const f = await fixture(t), first = { requestId: 'goal-one', content: '请整理一个需要 Muse 完成的公开研究委托，我还没有决定产品、市场和预算。' };
  f.faux.setResponses([proposal(empty(), first.requestId, first.content)]);
  const created = await f.call(f.path, 'POST', first); assert.equal(created.status, 202, JSON.stringify(created.data));
  let draft = await f.settled(created.data.draftId); assert.equal(draft.phase, 'needs_information'); assert.equal(draft.missingFields.length, 6);
  assert.equal((f.app.store.read().workerOrders || []).length, 0); assert.equal((f.app.store.read().museTasks || []).length, 0);
  const repeated = await f.call(f.path, 'POST', first); assert.equal(repeated.data.run.id, created.data.run.id); assert.equal(f.faux.state.callCount, 1);
  const complete = readyInput('clarification-two'); f.faux.setResponses([proposal(complete.scope, complete.requestId, complete.content)]);
  const clarified = await f.call(`${f.path}/${draft.id}/messages`, 'POST', { requestId: complete.requestId, content: complete.content, expectedRevision: draft.revision });
  assert.equal(clarified.status, 202, JSON.stringify(clarified.data)); assert.equal(clarified.data.draftId, draft.id);
  draft = await f.settled(draft.id); assert.equal(draft.phase, 'ready_for_review'); assert.equal(draft.revision, 2); assert.deepEqual(draft.scope, { ...complete.scope, publicDataConfirmed: false });
  assert.equal((await f.call(`${f.path}/${draft.id}/prepare`, 'POST', { ...confirm(draft), budgetConfirmed: false })).status, 400);
  assert.equal((await f.call(`${f.path}/${draft.id}/prepare`, 'POST', { ...confirm(draft), deadlineConfirmed: false })).status, 400);
  assert.equal((await f.call(`${f.path}/${draft.id}/prepare`, 'POST', { ...confirm(draft), publicDataConfirmed: false })).status, 400);
  const prepared = await f.call(`${f.path}/${draft.id}/prepare`, 'POST', confirm(draft)); assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  assert.equal(prepared.data.delegation.phase, 'review_required'); assert.equal((f.app.store.read().workerOrders || []).length, 1); assert.equal((f.app.store.read().museTasks || []).length, 0);
  const { orderId, reviewHash } = prepared.data.delegation, orderPath = `/conversations/${actor.nativeAgentId}/muse-delegations/${orderId}`;
  const earlyDispatch = await f.call(orderPath + '/dispatch', 'POST', { confirmed: true, expectedReviewHash: reviewHash });
  assert.equal(earlyDispatch.status, 409); assert.equal(earlyDispatch.data.error.code, 'MW_CONVERSATION_APPROVAL_REQUIRED');
  assert.equal((await f.call(orderPath + '/approve', 'POST', { confirmed: true, expectedReviewHash: reviewHash })).status, 200);
  assert.equal((await f.call(orderPath + '/dispatch', 'POST', { confirmed: true, expectedReviewHash: reviewHash })).status, 200);
  assert.equal((f.app.store.read().workerOrders || []).length, 1); assert.equal((f.app.store.read().museTasks || []).length, 1);
  assert.equal((await f.call(orderPath)).data.delegation.wake.observed, false); // Offline protocol, no real Muse account.
  const calls = f.faux.state.callCount; await f.reopen();
  const replay = await f.call(`${f.path}/${draft.id}/prepare`, 'POST', confirm(draft)); assert.equal(replay.status, 200); assert.equal(replay.data.delegation.orderId, orderId); assert.equal(f.faux.state.callCount, calls);
});

test('unquoted model suggestions stay outside order scope and stale clarification cannot replace the current revision', async t => {
  const f = await fixture(t), input = readyInput();
  f.faux.setResponses([proposal(input.scope, input.requestId, 'A quote never provided by the user')]);
  const created = await f.call(f.path, 'POST', { requestId: input.requestId, content: '请研究一个产品，但还不知道这些字段。' });
  const draft = await f.settled(created.data.draftId); assert.equal(draft.phase, 'needs_information'); assert.equal(draft.missingFields.length, 6); assert.equal(draft.suggestions.length, 6);
  assert.equal((await f.call(`${f.path}/${draft.id}/prepare`, 'POST', confirm(draft))).data.error.code, 'MUSE_DRAFT_INCOMPLETE');
  assert.equal((await f.call(`${f.path}/${draft.id}/messages`, 'POST', { requestId: 'stale-clarification', content: input.content, expectedRevision: 0 })).data.error.code, 'MUSE_DRAFT_STALE_SCOPE');
  assert.equal((f.app.store.read().workerOrders || []).length, 0); assert.equal(f.faux.state.callCount, 1);
});

test('concurrent identical intake returns the same durable draft ID/run and changed scope rejects its old hash', async t => {
  const f = await fixture(t), input = readyInput(); f.faux.setResponses([proposal(input.scope, input.requestId, input.content)]);
  const body = { requestId: input.requestId, content: input.content };
  const results = await Promise.all([f.call(f.path, 'POST', body), f.call(f.path, 'POST', body)]);
  for (const result of results) assert.equal(result.status, 202, JSON.stringify(result.data));
  assert.equal(results[0].data.draftId, results[1].data.draftId); assert.equal(results[0].data.run.id, results[1].data.run.id);
  const old = await f.settled(results[0].data.draftId);
  assert.equal(f.app.store.read().workspaceMuseDrafts.drafts.length, 1); assert.equal(f.faux.state.callCount, 1);
  f.faux.setResponses([proposal(empty(), 'edit-original', 'Please change the scope')]);
  assert.equal((await f.call(`${f.path}/${old.id}/messages`, 'POST', { requestId: 'edit-original', content: 'Please change the scope', expectedRevision: old.revision })).status, 202);
  const revised = await f.settled(old.id); assert.equal(revised.revision, old.revision + 1);
  assert.equal((await f.call(`${f.path}/${old.id}/prepare`, 'POST', confirm(old))).data.error.code, 'MUSE_DRAFT_STALE_SCOPE');
  assert.equal((f.app.store.read().workerOrders || []).length, 0);
});

test('selected original product resolves locally for review, never enters Pi, and changed revision invalidates preparation', async t => {
  const f = await fixture(t), owner = { subject: actor.subject, role: 'admin' };
  const product = (await f.app.businessLibrary.createProduct({ requestId: randomUUID(), name: 'PRIVATE_REFERENCED_PRODUCT_MARKER' }, owner)).product;
  await f.app.businessLibrary.updateConversationReferences(actor.nativeAgentId, { requestId: randomUUID(), expectedRevision: 0, references: { products: [{ productId: product.id, productRevision: product.revision }], documents: [] } }, owner);
  const input = readyInput(), candidate = { ...input.scope, product: null }; let observed = '';
  const content = input.content.replace(input.scope.product, '使用已引用产品');
  f.faux.setResponses([ctx => { observed = JSON.stringify(ctx); return proposal(candidate, input.requestId, content); }]);
  const made = await f.call(f.path, 'POST', { requestId: input.requestId, content, productReference: { productId: product.id, productRevision: product.revision } });
  const draft = await f.settled(made.data.draftId); assert.equal(draft.scope.product, product.name); assert.equal(observed.includes(product.name), false);
  await f.app.businessLibrary.updateProduct(product.id, { requestId: randomUUID(), expectedRevision: product.revision, changes: { name: 'Changed original product' } }, owner);
  assert.equal((await f.call(`${f.path}/${draft.id}/prepare`, 'POST', confirm(draft))).data.error.code, 'MUSE_DRAFT_REFERENCE_CHANGED');
  assert.equal((f.app.store.read().workerOrders || []).length, 0);
});

test('selected exact input deleted after read checks blocks the original Muse preparation transaction', async t => {
  const f = await fixture(t), input = readyInput('artifact-source-intake');
  const { artifact } = await f.app.artifacts.create({ filename: 'public-intake.txt', content: input.content });
  const source = { kind: 'artifact', id: artifact.id, version: 1, sha256: artifact.sha256, quote: input.content };
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_muse_draft', {
    scope: input.scope, sources: Object.keys(input.scope).map(field => ({ field, ...source })),
  }), { stopReason: 'toolUse' })]);
  const made = await f.call(f.path, 'POST', {
    requestId: input.requestId, content: 'Prepare only from the reviewed exact public intake file.',
    inputContext: { artifacts: [{ id: artifact.id, version: 1 }] },
  });
  assert.equal(made.status, 202, JSON.stringify(made.data));
  const draft = await f.settled(made.data.draftId);
  assert.equal(draft.phase, 'ready_for_review');
  const originalRun = f.app.store.read().runs.find(run => run.id === made.data.run.id);
  const pinned = originalRun.inputContextSnapshot.artifacts[0];
  assert.equal(originalRun.conversationId, actor.nativeAgentId);
  assert.equal(pinned.content, input.content);
  assert.equal(pinned.sha256, artifact.sha256);
  // The ordinary delete wins writer admission after the asynchronous input
  // checks, immediately before the preparation intent can be committed.
  const originalUpdate = f.app.store.update.bind(f.app.store);
  let deleteBeforeIntent = true;
  f.app.store.update = async callback => {
    if (deleteBeforeIntent) {
      deleteBeforeIntent = false;
      await f.app.artifacts.delete(artifact.id);
    }
    return originalUpdate(callback);
  };
  try {
    await assert.rejects(f.app.museDrafts.prepare(actor.nativeAgentId, draft.id, confirm(draft, 'prepare-exact-file')),
      { status: 409, code: 'INPUT_ARTIFACT_CHANGED' });
    const after = f.app.store.read();
    assert.equal(after.artifacts.some(item => item.id === artifact.id), false);
    assert.equal((after.workerOrders || []).length, 0);
    assert.equal((after.museTasks || []).length, 0);
    assert.equal(after.workspaceMuseDrafts.drafts.find(item => item.id === draft.id).prepare, null);
    assert.deepEqual(after.runs.find(run => run.id === originalRun.id).inputContextSnapshot, originalRun.inputContextSnapshot,
      'The original input snapshot is retained unchanged after rejecting preparation.');
    assert.equal(f.faux.state.callCount, 1, 'Rejection cannot invoke Pi again.');
  } finally {
    f.app.store.update = originalUpdate;
  }
});

test('lost original prepare acknowledgment reopens the same receipt/order; explicit rejection blocks its old review', async t => {
  const f = await fixture(t), input = readyInput(); f.faux.setResponses([proposal(input.scope, input.requestId, input.content)]);
  const made = await f.call(f.path, 'POST', { requestId: input.requestId, content: input.content }), draft = await f.settled(made.data.draftId);
  const prepared = await f.call(`${f.path}/${draft.id}/prepare`, 'POST', confirm(draft)); assert.equal(prepared.status, 200);
  const orderId = prepared.data.delegation.orderId, reviewHash = prepared.data.delegation.reviewHash;
  // Actual original order exists; model a crash gap before draft receipt ack.
  await f.app.store.update(state => { const item = state.workspaceMuseDrafts.drafts.find(item => item.id === draft.id); item.prepare.orderId = null; item.prepare.reviewHash = null; });
  await f.reopen(); const replay = await f.call(`${f.path}/${draft.id}/prepare`, 'POST', confirm(draft)); assert.equal(replay.status, 200); assert.equal(replay.data.delegation.orderId, orderId);
  assert.equal((f.app.store.read().workerOrders || []).length, 1); assert.equal(f.faux.state.callCount, 1);
  const rejection = { requestId: 'reject-original', expectedRevision: draft.revision, expectedDraftHash: draft.draftHash, confirmed: true };
  assert.equal((await f.call(`${f.path}/${draft.id}/reject`, 'POST', rejection)).data.draft.phase, 'rejected');
  const orderPath = `/conversations/${actor.nativeAgentId}/muse-delegations/${orderId}`;
  assert.equal((await f.call(orderPath + '/approve', 'POST', { confirmed: true, expectedReviewHash: reviewHash })).data.error.code, 'MUSE_DRAFT_REJECTED');
  assert.equal((await f.call(orderPath + '/dispatch', 'POST', { confirmed: true, expectedReviewHash: reviewHash })).data.error.code, 'MUSE_DRAFT_REJECTED');
  assert.equal((f.app.store.read().museTasks || []).length, 0);
});
