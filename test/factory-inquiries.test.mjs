// Original Library signed HTTP/Store/artifacts, synthetic source bytes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { createWorkspaceFactoryMaterialsClient } from '../packages/workspace-procurement/src/workspace-factory-materials-client.mjs';
import { createFactoryInquiryClient } from '../server/factory-inquiries.mjs';
const input = f => ({ inquiryDocumentId: f.document.id, documentVersion: 1, productId: f.product.id,
  requirements: { product: 'original uploaded specification', quantity: null } });
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
test('inquiry preparation preserves original exact sources and literal demand; unsubstantiated prices and commitments stay pending', async t => {
  const { f, client } = await fixture(t), prepared = await client.prepare(input(f), undefined, MODEL);
  assert.equal(prepared.plugin, 'workspace-factory-inquiries'); assert.equal(prepared.status, 'partial');
  assert.equal(prepared.match.accepted, false); assert.equal(prepared.match.factorySupplyCommitment, false);
  assert.equal(prepared.requirements.quantity, null); assert.equal(prepared.drafts.length, 3);
  for (const draft of prepared.drafts) { assert.match(draft.content, /NOT SENT/); assert.ok(draft.content.includes(f.asset.sha256)); assert.ok(!draft.content.includes('UNAPPROVED_PRIVATE_PRICE_NOTE')); }
  assert.match(prepared.drafts[0].content, /Unit price: pending/); assert.match(prepared.drafts[1].content, /Dispatch date: pending/);
  assert.match(prepared.drafts[2].content, /Prior outbound message: not evidenced/);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
  await assert.rejects(client.prepare({ ...input(f), requirements: { quantity: 'UNSUPPLIED_5000' } }, undefined, MODEL), /literal|inquiry/);
  await client.revalidateReceipt(prepared, MODEL);
});
test('exact unreviewed draft saves three original private artifacts and identical request replays without duplicates', async t => {
  const { f, client, makeClient, flags } = await fixture(t), prepared = await client.prepare(input(f), undefined, MODEL);
  const save = { ...input(f), requestId: 'original-inquiry-save', expectedDraftHash: prepared.draftHash };
  flags.admitted = false; await assert.rejects(client.save(save, undefined, MODEL), e => e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED');
  flags.admitted = true;
  const first = await client.save(save, undefined, MODEL); assert.equal(first.status, 'saved-draft'); assert.equal(first.artifacts.length, 3);
  assert.equal(first.humanReviewed, false); assert.equal(first.humanReviewRequired, true);
  await assert.rejects(client.revalidateReceipt({ ...first, humanReviewed: true }, MODEL), /human approval/);
  await assert.rejects(makeClient(randomUUID()).revalidateReceipt(first, MODEL), /scope changed/);
  const replay = await client.save(save, undefined, MODEL); assert.equal(replay.status, 'saved-draft'); assert.ok(replay.artifacts.every(a => a.duplicate));
  assert.deepEqual(first.artifacts.map(a => a.artifactId), replay.artifacts.map(a => a.artifactId));
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 3);
  for (const ref of first.artifacts) {
    const file = await f.app.artifacts.download(ref.artifactId, { version: ref.version }); assert.equal(file.version.sha256, ref.sha256);
    assert.match(file.bytes.toString(), /Human review required/);
    const a = f.app.artifacts.get(ref.artifactId).artifact; assert.equal(a.metadata.businessLibrary.visibility, 'internal'); assert.equal(a.metadata.factoryInquiry.sent, false);
    assert.equal(a.metadata.factoryInquiry.humanReviewed, false); assert.equal(a.metadata.factoryInquiry.humanReviewRequired, true);
  }
  await client.revalidateReceipt(first, MODEL);
});
test('partial original artifact failure retains committed receipt and only identical explicit replay finishes missing drafts', async t => {
  const { f, client } = await fixture(t), prepared = await client.prepare(input(f), undefined, MODEL);
  const original = f.app.artifacts.create; let calls = 0;
  f.app.artifacts.create = (...args) => ++calls === 2 ? Promise.reject(Object.assign(Error('Synthetic original artifact unavailable'), { status: 503 })) : original(...args);
  const save = { ...input(f), requestId: 'original-partial-inquiry', expectedDraftHash: prepared.draftHash };
  const partial = await client.save(save, undefined, MODEL); assert.equal(partial.status, 'partial'); assert.equal(partial.artifacts.length, 1);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 1);
  await client.revalidateReceipt(partial, MODEL);
  f.app.artifacts.create = original;
  const resumed = await client.save(save, undefined, MODEL); assert.equal(resumed.status, 'saved-draft'); assert.equal(resumed.artifacts[0].artifactId, partial.artifacts[0].artifactId);
  assert.equal(resumed.artifacts[0].duplicate, true); assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 3);
});
test('draft edits, source revision drift, original refusal and model approval claims cannot authorize saves or cached disclosure', async t => {
  const { f, client, flags } = await fixture(t), prepared = await client.prepare(input(f), undefined, MODEL);
  const save = { ...input(f), requestId: 'original-unchanged-draft', expectedDraftHash: prepared.draftHash };
  await assert.rejects(client.save({ ...save, confirmed: true }, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_INPUT_INVALID');
  await assert.rejects(client.save({ ...save, expectedDraftHash: '0'.repeat(64) }, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_DRAFT_CHANGED');
  const tampered = structuredClone(prepared); tampered.drafts[0].content += '\nUNREVIEWED_EDIT';
  await assert.rejects(client.revalidateReceipt(tampered, MODEL), /modified/);
  flags.active = false; await assert.rejects(client.prepare(input(f), undefined, MODEL), /refused/); flags.active = true;
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'UNREVIEWED_NEW_SOURCE' } }, f.actor);
  await assert.rejects(client.save(save, undefined, MODEL), e => e.code === 'FACTORY_INQUIRY_DRAFT_CHANGED');
  await assert.rejects(client.revalidateReceipt(prepared, MODEL), /changed/);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 0);
});

test('partial original draft receipts survive application reload and exact replay finishes without replacing committed artifacts', async t => {
  const fixtureState = await fixture(t), { f } = fixtureState;
  const prepared = await fixtureState.client.prepare(input(f), undefined, MODEL);
  const original = f.app.artifacts.create; let calls = 0;
  f.app.artifacts.create = (...args) => ++calls === 2 ? Promise.reject(Object.assign(Error('Synthetic before-restart failure'), { status: 503 })) : original(...args);
  const save = { ...input(f), requestId: 'durable-inquiry-reload', expectedDraftHash: prepared.draftHash };
  const partial = await fixtureState.client.save(save, undefined, MODEL); assert.equal(partial.status, 'partial'); assert.equal(partial.artifacts.length, 1);
  f.app.artifacts.create = original;
  await fixtureState.restart();
  const resumed = await fixtureState.client.save(save, undefined, MODEL); assert.equal(resumed.status, 'saved-draft');
  assert.equal(resumed.artifacts[0].artifactId, partial.artifacts[0].artifactId); assert.equal(resumed.artifacts[0].duplicate, true);
  assert.equal(f.app.store.read().artifacts.filter(a => a.metadata.factoryInquiry).length, 3);
  await fixtureState.client.revalidateReceipt(resumed, MODEL);
});
