import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';

async function harness(t, adapters = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-desk-'));
  const store = await openStore(dir);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, desk: createWorkerServiceDesk({ store, adapters }) };
}
const request = (requestId = 'req-one', overrides = {}) => ({
  requestId, serviceId: 'buyer-discovery', product: 'Woven fabric', market: 'US',
  objective: 'Find public wholesale distributor candidates', budgetCredits: 20,
  deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString(), publicDataConfirmed: true, ...overrides,
});
const readyAdapter = (overrides = {}) => ({
  services: ['buyer-discovery'], ready: true, budgetEnforced: true, displayName: 'Reviewed Partner',
  async submit(task) { return { jobId: task.orderId }; },
  async get(jobId) { return { status: 'working', jobId }; },
  async cancel() { return { status: 'cancel_requested' }; },
  ...overrides,
});

test('worker service catalog is honest when no external executor is enrolled', async t => {
  const { desk } = await harness(t);
  const offers = desk.catalog();
  assert.equal(offers.length, 4);
  assert(offers.every(offer => !offer.executable));
  assert.equal(offers.find(offer => offer.id === 'rfq-recovery').dataMode, 'private-review-required');
  await assert.rejects(desk.create(request('private', { serviceId: 'rfq-recovery' }), 'operator'), { code: 'PRIVATE_GATEWAY_REQUIRED' });
  const { order } = await desk.create(request(), 'operator');
  assert.equal(order.status, 'draft');
  assert.equal(order.workerId, null);
  assert.equal(desk.list().length, 1);
  await assert.rejects(desk.approve(order.id, 'admin', { confirmed: true }), { code: 'WORKER_UNAVAILABLE' });
  await assert.rejects(desk.dispatch(order.id), { code: 'INVALID_STATE' });
});

test('durable idempotency and strict external data scope', async t => {
  const { desk, store } = await harness(t);
  const taskInput = request();
  const first = await desk.create(taskInput, 'operator');
  const again = await desk.create(taskInput, 'operator');
  assert.equal(again.duplicate, true);
  assert.equal(first.order.id, again.order.id);
  assert.equal(store.read().workerOrders.length, 1);
  await assert.rejects(desk.create(request('req-one', { budgetCredits: 100 }), 'operator'), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(desk.create(request('no-consent', { publicDataConfirmed: false }), 'operator'), { code: 'DATA_SCOPE_REQUIRED' });
  await assert.rejects(desk.create(request('extra', { credentials: 'secret' }), 'operator'), { code: 'INVALID_INPUT' });
});

test('reviewed worker accepts exact approved task and yields a human-reviewed outcome', async t => {
  let sent;
  const adapter = readyAdapter({
    async submit(task) { sent = task; return { jobId: 'job-one' }; },
    async get(jobId) { return {
      jobId, status: 'completed', costCredits: 4,
      deliverables: [{ name: 'Distributor shortlist', type: 'table', summary: 'Five sourced business records' }],
      evidence: [{ title: 'Example public source', url: 'https://example.com/company', detail: 'Public information only' }],
    }; },
  });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request(), 'operator');
  const approve = await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  assert.equal(approve.order.status, 'approved');
  assert.equal(approve.order.workerId, 'partner');
  const submission = await desk.dispatch(order.id);
  assert.equal(submission.order.remoteJobId, 'job-one');
  assert.equal(sent.idempotencyKey, order.id);
  assert.equal(sent.dataScope, 'public');
  assert.equal(sent.maxCredits, 20);
  assert.deepEqual(Object.keys(sent.inputs).sort(), ['market', 'objective', 'product']);
  await assert.rejects(desk.dispatch(order.id), { code: 'INVALID_STATE' });
  const review = await desk.refresh(order.id);
  assert.equal(review.order.status, 'review_required');
  assert.equal(review.order.workerReport.independentlyVerified, false);
  const accepted = await desk.accept(order.id, 'admin', { confirmed: true });
  assert.equal(accepted.order.status, 'accepted');
  await assert.rejects(desk.accept(order.id, 'admin', { confirmed: true }), { code: 'INVALID_STATE' });
});

test('dispatch network uncertainty never re-submits work automatically', async t => {
  let calls = 0;
  const adapter = readyAdapter({
    async submit() { calls++; throw new Error('Lost acknowledgement'); },
  });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request(), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await assert.rejects(desk.dispatch(order.id), { code: 'DISPATCH_UNCERTAIN' });
  assert.equal(desk.get(order.id).status, 'dispatch_uncertain');
  await assert.rejects(desk.dispatch(order.id), { code: 'INVALID_STATE' });
  await assert.rejects(desk.refresh(order.id), { code: 'MANUAL_RECONCILIATION' });
  assert.equal(calls, 1);
});

test('worker cost over approved cap blocks acceptance regardless of delivery claims', async t => {
  const adapter = readyAdapter({ async get(jobId) {
    return { jobId, status: 'completed', costCredits: 999, deliverables: [{ name: 'Report', type: 'report', summary: 'Published' }],
      evidence: [{ title: 'Source', url: 'https://example.com', detail: 'Fixture' }] };
  } });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request(), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);
  const result = await desk.refresh(order.id);
  assert.equal(result.order.status, 'budget_dispute');
  await assert.rejects(desk.accept(order.id, 'admin', { confirmed: true }), { code: 'INVALID_STATE' });
});

test('requesting cancellation never claims external stop without acknowledgement', async t => {
  const adapter = readyAdapter({ async cancel() { return { status: 'cancel_requested' }; } });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request(), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);
  const result = await desk.cancel(order.id);
  assert.equal(result.order.status, 'cancel_requested');
  const later = await desk.refresh(order.id);
  assert.equal(later.order.status, 'cancel_requested');
  assert.notEqual(later.order.status, 'cancelled');
});
