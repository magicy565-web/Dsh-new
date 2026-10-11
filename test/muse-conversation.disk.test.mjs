import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { museConversationFixture, hash } from './fixtures/muse-conversation.mjs';

async function fixture(t) {
  const root = path.resolve(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, 'workspace-muse-disk-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), root); assert.ok(path.basename(dir).startsWith('workspace-muse-disk-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { f: await museConversationFixture(t, { diskDirectory: dir }), dir };
}

test('original disk store reloads one delegation and task; exact receipt file survives reopening', async t => {
  const { f, dir } = await fixture(t), input = f.input('disk-stable-request');
  const drafts = await Promise.all([f.api().prepare(input), f.api().prepare(input)]);
  assert.equal(drafts[0].delegation.orderId, drafts[1].delegation.orderId);
  const item = await f.approveAndDispatch(input), orderId = item.orderId;
  await f.restart();
  assert.equal((await f.api().prepare(input)).delegation.orderId, orderId);
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().museTasks.length, 1);
  const claim = (await f.call(orderId, 'claim', { requestId: 'disk-claim' })).body;
  await f.restart();
  assert.equal(f.store.read().museTasks[0].attemptId, claim.attemptId); assert.equal(f.store.read().museTasks[0].fence, claim.fence);
  const file = await f.deliver(orderId, claim); await f.api().refresh(orderId);
  assert.equal((await f.api().get(orderId)).phase, 'result_ready');
  await f.relay.reconcile();
  const returned = await f.api().get(orderId), reference = { artifactId: file.artifactId, version: 1, sha256: hash(file.bytes) };
  assert.equal(returned.phase, 'result_returned'); assert.equal(returned.wake.observed, false);
  await f.restart();
  assert.deepEqual((await f.api().download(orderId, reference)).bytes, file.bytes);
  const blobNames = await fs.readdir(path.join(dir, 'artifacts'));
  assert.ok(blobNames.some(name => name.endsWith('.blob') && name.includes(hash(file.bytes))));
  await assert.rejects(f.api().download(orderId, { ...reference, version: 2 }), { code: 'MW_SESSION_FILE_NOT_FOUND' });
  await assert.rejects(f.api().download(orderId, { ...reference, sha256: '0'.repeat(64) }), { code: 'MW_SESSION_FILE_NOT_FOUND' });
  await f.api().accept(orderId, { confirmed: true, expectedReviewHash: returned.reviewHash, receiptHash: returned.receiptHash });
  await f.restart(); assert.equal((await f.api().get(orderId)).phase, 'enterprise_accepted');
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'));
  assert.equal(disk.workerOrders.length, 1); assert.equal(disk.museTasks.length, 1); assert.equal(disk.messages.length, 2);
  assert.equal(f.diskDiagnostics().durability, 'confirmed');
});

test('disk restart retains original uncertain dispatch ID, cancellation, expired lease and late-result rejection', async t => {
  const { f } = await fixture(t), input = f.input('disk-uncertain-request'), made = await f.api().prepare(input);
  const orderId = made.delegation.orderId, review = { confirmed: true, expectedReviewHash: made.delegation.reviewHash };
  await f.api().approve(orderId, review);
  f.failNext(state => state.workerOrders[0].status === 'queued');
  await assert.rejects(f.api().dispatch(orderId, review), { code: 'EPERM' });
  await f.restart(); await f.api().dispatch(orderId, review);
  assert.equal(f.store.read().museTasks.length, 1); assert.equal(f.store.read().museTasks[0].id, orderId);
  const claim = (await f.call(orderId, 'claim', { requestId: 'disk-original-claim' })).body;
  await f.change(state => { state.museTasks[0].leaseUntil = '2000-01-01T00:00:00.000Z'; });
  await f.restart(); assert.equal((await f.api().get(orderId)).phase, 'reconciliation_required');
  await f.api().refresh(orderId); assert.equal((await f.api().get(orderId)).phase, 'lease_expired');
  await f.api().cancel(orderId, review); await f.restart();
  await assert.rejects(f.call(orderId, 'submit-result', { attemptId: claim.attemptId, fence: claim.fence, requestId: 'disk-late-submit',
    summary: 'Synthetic late result', sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'No real Muse run.' }), { code: 'MW_LEASE_EXPIRED' });
  await f.call(orderId, 'confirm-stop', { attemptId: claim.attemptId, fence: claim.fence, requestId: 'disk-original-stop' });
  await f.api().refresh(orderId); await f.restart();
  const task = f.store.read().museTasks[0]; assert.equal(task.attemptId, claim.attemptId); assert.equal(task.fence, claim.fence);
  assert.equal((await f.api().get(orderId)).orderStatus, 'cancelled'); assert.equal(f.store.read().museTasks.length, 1);
});
