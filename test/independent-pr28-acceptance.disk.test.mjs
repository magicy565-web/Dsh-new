import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { museConversationFixture, actor, hash } from './fixtures/muse-conversation.mjs';

// Actual original Store/Artifact bytes and binding code; synthetic Session and
// Muse sender. No original account login, Harness boot, wake or model execution.
async function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir()), directory = await mkdtemp(path.join(temporaryRoot, 'tt041-pr28-disk-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith('tt041-pr28-disk-'));
    await rm(directory, { recursive: true, force: true });
  });
  return museConversationFixture(t, { diskDirectory: directory });
}

test('one original conversation request retains scope and one task after concurrent retries and real Store restart', async t => {
  const f = await fixture(t), input = f.input('tt041-independent-same-conversation');
  const [a, b] = await Promise.all([f.api().prepare(input), f.api().prepare(input)]);
  assert.equal(a.delegation.orderId, b.delegation.orderId);
  await assert.rejects(f.api().prepare({ ...input, order: { ...input.order, budgetCredits: 6 } }), { code: 'MW_CONVERSATION_IDEMPOTENCY' });
  assert.throws(() => f.binding().bindConversation({ ...actor, nativeAgentId: 'foreign-conversation' }), { code: 'MUSE_OWNER_REQUIRED' });
  const original = await f.approveAndDispatch(input); await f.restart();
  assert.equal((await f.api().prepare(input)).delegation.orderId, original.orderId);
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().museTasks.length, 1);
  assert.equal(f.diskDiagnostics().durability, 'confirmed');
  const before = f.store.read(), reader = f.binding().bindControl(actor, { workspaceId: 'tt041-enterprise', policyVersion: 'source-policy-1' });
  const snapshot = await reader.read(); assert.ok(snapshot.records.some(row => row.id === original.orderId));
  assert.deepEqual(f.store.read(), before, 'Control query must not dispatch, renew or write');
  assert.throws(() => f.binding().bindControl({ ...actor, subject: 'foreign-owner' }, { workspaceId: 'tt041-enterprise', policyVersion: 'source-policy-1' }), { code: 'MUSE_OWNER_REQUIRED' });
});

test('returned exact file persists in the same conversation but does not become business acceptance or genuine execution', async t => {
  const f = await fixture(t), original = await f.approveAndDispatch(f.input('tt041-independent-return'));
  const claim = (await f.call(original.orderId, 'claim', { requestId: 'tt041-synthetic-claim' })).body;
  const file = await f.deliver(original.orderId, claim); await f.api().refresh(original.orderId);
  let result = await f.api().get(original.orderId);
  const review = { confirmed: true, expectedReviewHash: result.reviewHash, receiptHash: result.receiptHash };
  await assert.rejects(f.api().accept(original.orderId, review), { code: 'MW_CONVERSATION_RESULT_REQUIRED' });
  await f.relay.reconcile(); await f.restart(); result = await f.api().get(original.orderId);
  assert.equal(result.phase, 'result_returned'); assert.equal(result.acceptedAt, null); assert.equal(result.executionStartedAt, null);
  assert.equal(result.wake.observed, false);
  const reference = { artifactId: file.artifactId, version: 1, sha256: hash(file.bytes) };
  assert.deepEqual((await f.api().download(original.orderId, reference)).bytes, file.bytes);
  await assert.rejects(f.api().download(original.orderId, { ...reference, sha256: '0'.repeat(64) }), { code: 'MW_SESSION_FILE_NOT_FOUND' });
  await f.api().accept(original.orderId, review); await f.restart();
  assert.equal((await f.api().get(original.orderId)).phase, 'enterprise_accepted');
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().museTasks.length, 1);
});

test('cancellation, exact attempt/fence and late-return rejection survive real disk restart without replacement work', async t => {
  const f = await fixture(t), original = await f.approveAndDispatch(f.input('tt041-independent-cancel'));
  const claim = (await f.call(original.orderId, 'claim', { requestId: 'tt041-synthetic-cancel-claim' })).body;
  await f.api().cancel(original.orderId, { confirmed: true, expectedReviewHash: original.reviewHash });
  await f.restart(); assert.equal((await f.api().get(original.orderId)).orderStatus, 'cancel_requested');
  await f.call(original.orderId, 'confirm-stop', { attemptId: claim.attemptId, fence: claim.fence, requestId: 'tt041-synthetic-stop' });
  await f.api().refresh(original.orderId); await f.restart();
  await assert.rejects(f.call(original.orderId, 'submit-result', { attemptId: claim.attemptId, fence: claim.fence,
    requestId: 'tt041-synthetic-late-return', summary: 'Late synthetic result', sources: ['https://www.loc.gov/about/'],
    toolEvidence: [], evidenceNote: 'No genuine Muse execution.' }), { code: 'MW_LEASE_EXPIRED' });
  const task = f.store.read().museTasks[0]; assert.equal(task.attemptId, claim.attemptId); assert.equal(task.fence, claim.fence);
  assert.equal((await f.api().get(original.orderId)).orderStatus, 'cancelled');
  assert.equal(f.store.read().museTasks.length, 1); assert.equal(f.store.read().messages.length, 1);
});
