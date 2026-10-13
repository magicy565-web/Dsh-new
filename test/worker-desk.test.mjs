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
      prospects: [{ name: 'Verified Fixture', country: 'US', website: 'https://buyer.example.org', fitReason: 'Relevant wholesale product categories', sourceUrl: 'https://buyer.example.org/about' }],
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


test('buyer research cannot pass human acceptance with a summary but no actual prospects', async t => {
  const adapter = readyAdapter({ async get(jobId) { return {
    jobId, status: 'completed', costCredits: 2,
    deliverables: [{ name: 'Claimed list', type: 'table', summary: '20 buyers found' }],
    evidence: [{ title: 'A website', url: 'https://example.org/buyers', detail: 'Public site' }],
    prospects: [],
  }; } });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request('missing-buyers'), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);
  assert.equal((await desk.refresh(order.id)).order.status, 'result_incomplete');
  await assert.rejects(desk.accept(order.id, 'admin', { confirmed: true }), { code: 'INVALID_STATE' });
});

test('a queued or completed remote response cannot revoke a pending cancellation', async t => {
  let remoteState='queued';
  const {desk}=await harness(t,{partner:readyAdapter({async get(jobId) {return {
    jobId,status:remoteState,
    deliverables:[{name:'Synthetic report',type:'table',summary:'Local fixture only'}],
    evidence:[{title:'Fixture source',url:'https://www.loc.gov/about/',detail:'No research was performed'}],
    prospects:[{name:'Synthetic candidate',country:'US',website:'https://www.loc.gov',
      sourceUrl:'https://www.loc.gov/about/',fitReason:'Local test row only'}],
  };}})});
  const {order}=await desk.create(request('cancel-late-result'),'operator');
  await desk.approve(order.id,'admin',{confirmed:true,workerId:'partner'});
  await desk.dispatch(order.id);
  await desk.cancel(order.id);
  for(const state of ['queued','completed','input_required']) {
    remoteState=state;
    assert.equal((await desk.refresh(order.id)).order.status,'cancel_requested');
    await assert.rejects(desk.accept(order.id,'admin',{confirmed:true}),{code:'INVALID_STATE'});
  }
  remoteState='cancelled';
  assert.equal((await desk.refresh(order.id)).order.status,'cancelled');
});

test('duplicated buyer company/domain is rejected instead of inflating lead counts', async t => {
  const first = { name: 'Wholesale Fixture', country: 'USA', website: 'https://buyer.example.org',
    fitReason: 'Relevant stock catalog', sourceUrl: 'https://buyer.example.org/about' };
  const adapter = readyAdapter({ async get(jobId) { return {
    jobId, status: 'completed', costCredits: 2,
    deliverables: [{ name: 'Shortlist', type: 'table', summary: 'Two candidate records' }],
    evidence: [{ title: 'Company profile', url: 'https://buyer.example.org/about', detail: 'Public' }],
    prospects: [first, { ...first, sourceUrl: 'https://buyer.example.org/contact' }],
  }; } });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request('duplicate-buyers'), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);
  await assert.rejects(desk.refresh(order.id), { code: 'INVALID_WORKER_RESULT' });
  assert.equal(desk.get(order.id).status, 'running');
});


test('parallel lost-ack reconciliation binds exactly one remote Worker job before applying evidence or cost', async t => {
  const pending = [];
  let submissions = 0;
  const adapter = readyAdapter({
    async submit() { submissions++; throw new Error('Acknowledgement was lost after remote submission'); },
    async reconcile(orderId) { return new Promise(resolve => pending.push({ orderId, resolve })); },
  });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request('concurrent-reconcile-job-scope'), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await assert.rejects(desk.dispatch(order.id), { code: 'DISPATCH_UNCERTAIN' });
  assert.equal(desk.get(order.id).remoteJobId, null);

  // Both status lookups read the same unacknowledged task before either
  // response returns. A different second result must never win the Store race.
  const first = desk.refresh(order.id);
  const second = desk.refresh(order.id);
  assert.equal(pending.length, 2);
  pending[0].resolve({ orderId: order.id, jobId: 'remote-job-one', status: 'working', costCredits: 2 });
  const bound = await first;
  assert.equal(bound.order.status, 'running');
  assert.equal(bound.order.remoteJobId, 'remote-job-one');

  pending[1].resolve({ orderId: order.id, jobId: 'remote-job-two', status: 'completed', costCredits: 12,
    deliverables: [{ name: 'Wrong job report', type: 'table', summary: 'Must not be accepted' }],
    evidence: [{ title: 'Wrong source', url: 'https://example.org', detail: 'Unrelated job' }],
    prospects: [{ name: 'Wrong company', country: 'US', website: 'https://example.org',
      fitReason: 'Different order', sourceUrl: 'https://example.org/about' }],
  });
  await assert.rejects(second, { code: 'WORKER_JOB_MISMATCH' });
  const saved = desk.get(order.id);
  assert.equal(saved.remoteJobId, 'remote-job-one');
  assert.equal(saved.reportedCostCredits, 2);
  assert.equal(saved.workerReport, null);
  assert.equal(saved.status, 'running');
  assert.equal(submissions, 1, 'A reconcile race must never resubmit the original external job.');
});

test('stale queued Worker observations cannot overwrite a confirmed running or input-required state', async t => {
  const pending = [];
  const adapter = readyAdapter({ async get(jobId) {
    return new Promise(resolve => pending.push({ jobId, resolve }));
  } });
  const { desk } = await harness(t, { partner: adapter });
  const { order } = await desk.create(request('queued-monotonic-observations'), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);

  const recent = desk.refresh(order.id);
  const oldQueue = desk.refresh(order.id);
  assert.equal(pending.length, 2);
  pending[0].resolve({ jobId: order.id, status: 'working' });
  await recent;
  pending[1].resolve({ jobId: order.id, status: 'queued' });
  assert.equal((await oldQueue).order.status, 'running');
  assert.equal(desk.get(order.id).status, 'running');

  const needsInput = desk.refresh(order.id);
  pending[2].resolve({ jobId: order.id, status: 'input_required' });
  assert.equal((await needsInput).order.status, 'input_required');
  const olderQueue = desk.refresh(order.id);
  pending[3].resolve({ jobId: order.id, status: 'queued' });
  assert.equal((await olderQueue).order.status, 'input_required');
  assert.equal(desk.get(order.id).remoteJobId, order.id);
});
