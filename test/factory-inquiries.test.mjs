// Original Library signed HTTP/Store/artifacts, synthetic source bytes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { createWorkspaceFactoryMaterialsClient } from '../packages/workspace-procurement/src/workspace-factory-materials-client.mjs';
import { createFactoryInquiryClient } from '../server/factory-inquiries.mjs';
async function fixture(t) {
  const f = await materialsFixture(t), flags = { admitted: true, active: true };
  const c = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Synthetic original inquiry draft artifacts', requestId: randomUUID() } });
  assert.equal(c.status, 201, c.text);
  const materialsClient = createWorkspaceFactoryMaterialsClient({ recipient: RECIPIENT, request: async (route, options) => {
    const r = await f.workspace(route, { subject: 'member-a', headers: options.headers });
    return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
  } });
  const makeClient = (conversationId = c.json.conversation.id) => createFactoryInquiryClient({ materialsClient, artifacts: f.app.artifacts, store: f.app.store,
    identity: { subject: 'member-a', workspaceId: 'pi-enterprise-test', role: 'admin' }, conversationId,
    authorize: async () => { if (!flags.active) throw Object.assign(Error('Original synthetic authority refused'), { status: 403 }); }, canSave: () => flags.active && flags.admitted });
  let client = makeClient();
  return { f, get client() { return client; }, makeClient, flags, async restart() {
    await f.app.close(); const reopened = await taskFixture(t, { directory: f.directory, enterprise: true, libraryModelReadPolicy: f.policy });
    Object.assign(f, reopened); client = makeClient();
  } };
}
async function saveInput(f, documents = [{ name: 'reply.md', content: 'Thank you. Please confirm the quantity and destination before we assess an offer.' }]) {
  const doc = await f.workspace(`/api/library/model-read/factory/documents/${f.document.id}/1`, { subject: 'member-a', headers: { 'X-Workspace-Library-Recipient': (await import('../server/library-model-read-contract.mjs')).libraryReadHash(RECIPIENT) } });
  const product = await f.workspace(`/api/library/model-read/factory/materials?productId=${f.product.id}`, { subject: 'member-a', headers: { 'X-Workspace-Library-Recipient': (await import('../server/library-model-read-contract.mjs')).libraryReadHash(RECIPIENT) } });
  assert.equal(doc.status, 200, doc.text); assert.equal(product.status, 200, product.text);
  return { inquiryDocumentId: f.document.id, documentVersion: 1, productId: f.product.id, sources: [...doc.json.sources, ...product.json.sources], documents, requestId: 'original-model-reply' };
}
test('model-written one or several drafts preserve exact body and original sources without fixed templates', async t => {
  const { f, client, flags, makeClient } = await fixture(t), input = await saveInput(f);
  flags.admitted = false; await assert.rejects(client.save(input, undefined, MODEL), e => e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED'); flags.admitted = true;
  const first = await client.save(input, undefined, MODEL); assert.equal(first.status, 'saved-draft'); assert.equal(first.artifacts.length, 1); assert.equal(first.humanReviewed, false);
  const file = await f.app.artifacts.download(first.artifacts[0].artifactId, { version: 1 });
  assert.ok(file.bytes.toString().includes(input.documents[0].content)); assert.match(file.bytes.toString(), /NOT SENT/); assert.ok(file.bytes.toString().includes(f.asset.sha256));
  assert.ok(!file.bytes.toString().includes('Quotation review draft'));
  const replay = await client.save(input, undefined, MODEL); assert.equal(replay.artifacts[0].artifactId, first.artifacts[0].artifactId); assert.equal(replay.artifacts[0].duplicate, true);
  await client.revalidateReceipt(first, MODEL);
  await assert.rejects(client.revalidateReceipt({ ...first, humanReviewed: true }, MODEL), /approval/);
  await assert.rejects(makeClient(randomUUID()).revalidateReceipt(first, MODEL), /scope changed/);
  const two = await saveInput(f, [{ name: 'requirements.md', content: 'Missing quantity; destination must be confirmed.' }, { name: 'reply.md', content: 'Please clarify your requested product size.' }]);
  const second = await client.save({ ...two, requestId: 'two-needed-documents' }, undefined, MODEL); assert.equal(second.artifacts.length, 2);
});
test('model authority claims, forged citations, changed content and changed document sets cannot replace original drafts', async t => {
  const { f, client } = await fixture(t), input = await saveInput(f);
  for (const extra of [{ confirmed: true }, { humanReviewed: true }, { sent: true }]) await assert.rejects(client.save({ ...input, ...extra }, undefined, MODEL));
  const forged = structuredClone(input); forged.sources[0].sha256 = '0'.repeat(64);
  await assert.rejects(client.save(forged, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_SOURCE_CHANGED');
  await client.save(input, undefined, MODEL);
  await assert.rejects(client.save({ ...input, documents: [{ name: 'renamed.md', content: 'Changed body.' }] }, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_REQUEST_CHANGED');
  await assert.rejects(client.save({ ...input, documents: [{ ...input.documents[0], content: 'Different prose.' }] }, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_REQUEST_CHANGED');
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 1);
});
test('source revision changes and original revocation block save and cached disclosure', async t => {
  const { f, client, flags } = await fixture(t), input = await saveInput(f), receipt = await client.save(input, undefined, MODEL);
  flags.active = false; await assert.rejects(client.save(input, undefined, MODEL), /refused/); flags.active = true;
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'CHANGED_SOURCE' } }, f.actor);
  await assert.rejects(client.save(input, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_SOURCE_REFUSED' && e.status === 403);
  await assert.rejects(client.revalidateReceipt(receipt, MODEL), e => e.code === 'FACTORY_INQUIRY_SOURCE_REFUSED' && e.status === 403);
});
test('partial variable-document save survives original app reload and exact replay fills only missing artifacts', async t => {
  const state = await fixture(t), { f } = state;
  const input = await saveInput(f, [{ name: 'reply.md', content: 'Please confirm quantity.' }, { name: 'questions.md', content: 'Which destination and specification?' }]);
  const original = f.app.artifacts.create; let calls = 0;
  f.app.artifacts.create = (...args) => ++calls === 2 ? Promise.reject(Object.assign(Error('Synthetic original service outage'), { status: 503 })) : original(...args);
  const partial = await state.client.save(input, undefined, MODEL); assert.equal(partial.status, 'partial'); assert.equal(partial.artifacts.length, 1);
  f.app.artifacts.create = original; await state.restart();
  const recovered = await state.client.save(input, undefined, MODEL); assert.equal(recovered.status, 'saved-draft'); assert.equal(recovered.artifacts.length, 2);
  assert.equal(recovered.artifacts[0].artifactId, partial.artifacts[0].artifactId); assert.equal(recovered.artifacts[0].duplicate, true);
  await state.client.revalidateReceipt(recovered, MODEL);
});
test('source drift or cancellation at original artifact commit gate cannot persist draft bytes', async t => {
  const { f, client, flags } = await fixture(t), input = await saveInput(f), original = f.app.artifacts.create;
  f.app.artifacts.create = async (...args) => { flags.admitted = false; return original(...args); };
  await assert.rejects(client.save(input, undefined, MODEL), e => e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED');
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
});
