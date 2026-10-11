import test from 'node:test';
import assert from 'node:assert/strict';
import { museConversationFixture, actor, hash } from './fixtures/muse-conversation.mjs';

test('explicit Muse draft maps once to original conversation, then explicit approval queues one original order', async t => {
  const f = await museConversationFixture(t), input = f.input('stable-request');
  const [a, b] = await Promise.all([f.api().prepare(input), f.api().prepare(input)]);
  assert.equal(a.delegation.orderId, b.delegation.orderId);
  assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true]);
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().messages.length, 1);
  assert.equal(f.store.read().museTasks?.length ?? 0, 0);
  const id = a.delegation.orderId, review = { confirmed: true, expectedReviewHash: a.delegation.reviewHash };
  await assert.rejects(f.api().dispatch(id, review), { code: 'MW_CONVERSATION_APPROVAL_REQUIRED' });
  await assert.rejects(f.desk().approve(id, { confirmed: true }), { code: 'MW_CONVERSATION_STALE_REVIEW' });
  await f.desk().approve(id, review);
  const results = await Promise.all([f.desk().dispatch(id), f.desk().dispatch(id)]);
  assert.equal(results[0].order.id, id); assert.equal(f.store.read().museTasks.length, 1);
  assert.equal((await f.api().get(id)).phase, 'queued');
  assert.deepEqual((await f.api().get(id)).wake, { supported: false, observed: false, reason: 'original_muse_wakeup_not_verified' });
  await f.api().dispatch(id, review); assert.equal(f.store.read().museTasks.length, 1);
});

test('natural text, private scope, arbitrary Worker, foreign Session and stale review cannot dispatch', async t => {
  const f = await museConversationFixture(t), input = f.input('scope-request');
  await assert.rejects(f.api().prepare({ content: input.content }), { code: 'MW_CONVERSATION_INPUT' });
  await assert.rejects(f.api().prepare({ ...input, conversationId: 'foreign-session' }), { code: 'MW_CONVERSATION_INPUT' });
  await assert.rejects(f.api().prepare({ ...input, order: { ...input.order, workerId: 'foreign-worker' } }), { code: 'MW_CONVERSATION_INPUT' });
  await assert.rejects(f.api().prepare({ ...input, order: { ...input.order, publicDataConfirmed: false } }), { code: 'DATA_SCOPE_REQUIRED' });
  await assert.rejects(f.api().prepare({ ...input, order: { ...input.order, serviceId: 'rfq-recovery' } }), { code: 'PRIVATE_GATEWAY_REQUIRED' });
  const made = await f.api().prepare(input);
  await assert.rejects(f.api().approve(made.delegation.orderId, { confirmed: true, expectedReviewHash: '0'.repeat(64) }), { code: 'MW_CONVERSATION_STALE_REVIEW' });
  assert.throws(() => f.binding().bindConversation({ subject: actor.subject, nativeAgentId: 'foreign-session' }), { code: 'MUSE_OWNER_REQUIRED' });
  assert.equal(f.store.read().museTasks?.length ?? 0, 0);
});

test('requestId conflicts and one unfinished original delegation are enforced transactionally', async t => {
  const f = await museConversationFixture(t), input = f.input('same-request');
  const made = await f.api().prepare(input);
  await assert.rejects(f.api().prepare({ ...input, content: 'Changed original message' }), { code: 'MW_CONVERSATION_IDEMPOTENCY' });
  await assert.rejects(f.api().prepare({ ...input, order: { ...input.order, budgetCredits: 6 } }), { code: 'MW_CONVERSATION_IDEMPOTENCY' });
  await assert.rejects(f.api().prepare(f.input('second-request')), { code: 'MW_CONVERSATION_UNFINISHED' });
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().messages.length, 1);
  await f.api().cancel(made.delegation.orderId, { confirmed: true, expectedReviewHash: made.delegation.reviewHash });
  const next = await f.api().prepare(f.input('second-request'));
  assert.notEqual(next.delegation.orderId, made.delegation.orderId);
});

test('copy-on-write failure publishes neither an order nor a message and is not converted to success', async t => {
  const f = await museConversationFixture(t), error = Object.assign(Error('Synthetic original writer fsync/ACL failure'), { code: 'EPERM' });
  f.failNext(state => state.workerOrders.length > 0, error);
  await assert.rejects(f.api().prepare(f.input('failed-write')), actual => actual === error);
  assert.equal(f.store.read().workerOrders.length, 0); assert.equal(f.store.read().messages.length, 0);
});

test('lost dispatch persistence reconciles the same original order, without a replacement task or job ID', async t => {
  const f = await museConversationFixture(t), input = f.input('uncertain-request'), made = await f.api().prepare(input);
  const id = made.delegation.orderId, body = { confirmed: true, expectedReviewHash: made.delegation.reviewHash };
  await f.api().approve(id, body);
  f.failNext(state => state.workerOrders[0].status === 'queued');
  await assert.rejects(f.api().dispatch(id, body), { code: 'EPERM' });
  assert.equal(f.store.read().workerOrders[0].status, 'dispatching');
  assert.equal(f.store.read().museTasks.length, 1); assert.equal(f.store.read().museTasks[0].id, id);
  await f.restart();
  await f.api().dispatch(id, body); assert.equal(f.store.read().museTasks.length, 1);
  const result = await f.api().refresh(id);
  assert.equal(result.delegation.taskRef, id); assert.equal(result.delegation.phase, 'queued');
  assert.equal((await f.api().prepare(input)).delegation.orderId, id);
});

test('claimed, expired lease, cancellation and late submit retain attempt and fence', async t => {
  const f = await museConversationFixture(t), item = await f.approveAndDispatch(f.input('leased-request'));
  const claim = (await f.call(item.orderId, 'claim', { requestId: 'original-claim' })).body;
  assert.equal((await f.api().get(item.orderId)).phase, 'claimed');
  assert.equal((await f.api().get(item.orderId)).executionStartedAt, null);
  const bytes = Buffer.from('Synthetic pre-cancellation artifact');
  await f.call(item.orderId, 'upload-file', { attemptId: claim.attemptId, fence: claim.fence, uploadId: 'original-late-upload',
    filename: 'late.txt', base64: bytes.toString('base64'), sha256: hash(bytes) });
  f.change(state => { state.museTasks[0].leaseUntil = '2000-01-01T00:00:00.000Z'; });
  assert.equal((await f.api().get(item.orderId)).phase, 'lease_expired');
  await assert.rejects(f.call(item.orderId, 'heartbeat', { attemptId: claim.attemptId, fence: claim.fence, requestId: 'late-heartbeat' }), { code: 'MW_LEASE_EXPIRED' });
  await assert.rejects(f.call(item.orderId, 'claim', { requestId: 'replacement-claim' }), { code: 'MW_TASK_UNAVAILABLE' });
  await f.api().cancel(item.orderId, { confirmed: true, expectedReviewHash: item.reviewHash });
  assert.equal((await f.api().get(item.orderId)).orderStatus, 'cancel_requested');
  await assert.rejects(f.call(item.orderId, 'submit-result', { attemptId: claim.attemptId, fence: claim.fence, requestId: 'late-submit',
    summary: 'Late synthetic result', sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Synthetic contract attempt only; no real Muse execution.' }), { code: 'MW_LEASE_EXPIRED' });
  await f.call(item.orderId, 'confirm-stop', { attemptId: claim.attemptId, fence: claim.fence, requestId: 'original-stop' });
  await f.api().refresh(item.orderId);
  const task = f.store.read().museTasks[0]; assert.equal(task.attemptId, claim.attemptId); assert.equal(task.fence, claim.fence);
  assert.equal((await f.api().get(item.orderId)).orderStatus, 'cancelled');
});

test('result ready, native durable return and enterprise acceptance are distinct; exact file bytes survive JSON remount', async t => {
  const f = await museConversationFixture(t), item = await f.approveAndDispatch(f.input('result-request'));
  const claim = (await f.call(item.orderId, 'claim', { requestId: 'original-claim' })).body;
  const file = await f.deliver(item.orderId, claim);
  await f.api().refresh(item.orderId);
  let result = await f.api().get(item.orderId); assert.equal(result.phase, 'result_ready');
  const body = { confirmed: true, expectedReviewHash: item.reviewHash, receiptHash: result.receiptHash };
  await assert.rejects(f.api().accept(item.orderId, body), { code: 'MW_CONVERSATION_RESULT_REQUIRED' });
  f.failFlush(true);
  await assert.rejects(f.relay.reconcile(), { code: 'WORKSPACE_MUSE_PERSISTENCE' });
  assert.equal((await f.api().get(item.orderId)).returnedHash, null);
  assert.equal(f.events.length, 1);
  f.failFlush(false); await f.relay.reconcile(); await f.relay.reconcile();
  result = await f.api().get(item.orderId);
  assert.equal(result.phase, 'result_returned'); assert.equal(f.events.length, 1); assert.equal(result.acceptedAt, null);
  const reference = { artifactId: file.artifactId, version: 1, sha256: hash(file.bytes) };
  assert.deepEqual((await f.api().download(item.orderId, reference)).bytes, file.bytes);
  await assert.rejects(f.api().download(item.orderId, { ...reference, version: 2 }), { code: 'MW_SESSION_FILE_NOT_FOUND' });
  await assert.rejects(f.api().download(item.orderId, { ...reference, sha256: '0'.repeat(64) }), { code: 'MW_SESSION_FILE_NOT_FOUND' });
  const stale = f.api(); await f.restart(); await assert.rejects(async () => stale.get(item.orderId), { code: 'MW_GATEWAY_CLOSED' });
  await f.relay.reconcile(); assert.equal(f.events.length, 1);
  assert.deepEqual((await f.api().download(item.orderId, reference)).bytes, file.bytes);
  await f.desk().accept(item.orderId, body);
  assert.equal((await f.api().get(item.orderId)).phase, 'enterprise_accepted');
  assert.equal(f.store.read().messages.length, 2);
});

test('order scope or original conversation corruption invalidates old approvals without repair or replay', async t => {
  const f = await museConversationFixture(t), made = await f.api().prepare(f.input('immutable-review'));
  const id = made.delegation.orderId;
  f.change(state => { state.workerOrders[0].budgetCredits++; });
  const previous = f.store.read();
  await assert.rejects(f.api().approve(id, { confirmed: true, expectedReviewHash: made.delegation.reviewHash }), { code: 'MW_CONVERSATION_CHANGED' });
  assert.deepEqual(f.store.read(), previous);
});

test('a cached bound conversation cannot prepare work after native pause or detach', async t => {
  const f = await museConversationFixture(t), cached = f.api(); f.pause();
  await assert.rejects(cached.prepare(f.input('paused')), { code: 'WORKSPACE_PLUGIN_PAUSED' });
  assert.equal(f.store.read().workerOrders.length, 0);
});

test('an exact retry after the deadline returns its original queued order and cannot restart expired work', async t => {
  const f = await museConversationFixture(t), input = f.input('expired-request');
  const item = await f.approveAndDispatch(input), original = Date.now();
  t.mock.method(Date, 'now', () => original + 2 * 86400_000);
  assert.equal((await f.api().prepare(input)).delegation.orderId, item.orderId);
  assert.equal((await f.api().get(item.orderId)).phase, 'deadline_expired');
  await assert.rejects(f.call(item.orderId, 'claim', { requestId: 'expired-claim' }), { code: 'MW_DEADLINE_EXPIRED' });
  assert.equal(f.store.read().museTasks.length, 1); assert.equal(f.store.read().museTasks[0].attemptId, null);
});
