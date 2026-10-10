import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { createArtifactService } from '../server/artifacts.mjs';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';
import { createWorkerOpportunityService } from '../server/worker-opportunities.mjs';

const prospects = [
  { name: 'Fabric Wholesaler One', country: 'USA', website: 'https://wholesaler-one.example.org',
    fitReason: 'Textile importer with regional wholesale distribution',
    sourceUrl: 'https://wholesaler-one.example.org/about' },
  { name: 'Fabric Distributor Two', country: 'USA', website: 'https://distributor-two.example.org',
    fitReason: 'Publishes wholesale material catalog',
    sourceUrl: 'https://distributor-two.example.org/products' },
];
const evidence = [{ title: 'Distributor public catalog', url: 'https://distributor-two.example.org/products', detail: 'Public website' }];
const adapter = {
  services: ['buyer-discovery'], displayName: 'Reviewed fixture', ready: true, budgetEnforced: true,
  async submit(task) { return { jobId: 'job-' + task.orderId }; },
  async get(jobId) { return { jobId, status: 'completed', costCredits: 2,
    deliverables: [{ name: 'Distributor shortlist', type: 'table', summary: 'Two sourced records' }],
    evidence, prospects,
  }; },
  async cancel() { return { status: 'cancel_requested' }; },
};

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-opportunities-'));
  const store = await openStore(dir);
  const artifacts = await createArtifactService({ store, directory: path.join(dir, 'artifacts') });
  t.after(async () => { await artifacts.close(); await store.close(); await rm(dir, { recursive: true, force: true }); });
  return {
    store,
    desk: createWorkerServiceDesk({ store, adapters: { partner: adapter }, artifacts }),
    opportunities: createWorkerOpportunityService({ store }),
  };
}
async function acceptOrder(desk, requestId) {
  const { order } = await desk.create({
    requestId, serviceId: 'buyer-discovery', product: 'Rayon fabric', market: 'USA',
    objective: 'Discover potential wholesale buyers with source evidence',
    deadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    budgetCredits: 10, publicDataConfirmed: true,
  }, 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);
  assert.equal((await desk.refresh(order.id)).order.status, 'review_required');
  return (await desk.accept(order.id, 'admin', { confirmed: true })).order;
}

test('accepted sourced prospects become durable enterprise opportunities only on explicit admin import', async t => {
  const { desk, opportunities, store } = await setup(t);
  const order = await acceptOrder(desk, 'research-001');
  assert.equal(opportunities.list().length, 0, 'Worker completion alone creates no CRM data');
  const input = { indices: [1, 0], requestId: 'promote-001', confirmed: true };
  const result = await opportunities.importFromOrder(order.id, input, 'admin');
  assert.equal(result.createdCount, 2);
  assert.equal(result.importedIds.length, 2);
  const rows = opportunities.list();
  assert.equal(rows.length, 2);
  assert(rows.every(row => row.status === 'candidate' && row.verification === 'external_unverified'));
  assert(rows.every(row => row.sourceOrderId === order.id && row.sourceArtifactId === order.deliveryArtifactId));
  assert.deepEqual(new Set(rows.map(row => row.name)), new Set(prospects.map(row => row.name)));
  const replay = await opportunities.importFromOrder(order.id, input, 'admin');
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.importedIds, result.importedIds);
  assert.equal(opportunities.list().length, 2);
  await assert.rejects(async () => opportunities.importFromOrder(order.id, { ...input, indices: [1] }, 'admin'), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(async () => opportunities.importFromOrder(order.id, { ...input, requestId: 'invalid-index', indices: [5] }, 'admin'), { code: 'INVALID_IMPORT' });
  await assert.rejects(async () => opportunities.importFromOrder(order.id, { ...input, requestId: 'repeated-indices', indices: [0, 0] }, 'admin'), { code: 'INVALID_IMPORT' });
  assert.equal(store.read().workerOrders[0].opportunityImports.length, 1);
});

test('manual lead qualification never implies outbound permission or independent verification', async t => {
  const { desk, opportunities } = await setup(t);
  const order = await acceptOrder(desk, 'research-002');
  const imported = await opportunities.importFromOrder(order.id, { indices: [0], requestId: 'promote-002', confirmed: true }, 'admin');
  const id = imported.importedIds[0];
  await assert.rejects(async () => opportunities.review(id, { decision: 'qualified', confirmed: true }, 'admin'), { code: 'INVALID_REVIEW' });
  const { opportunity } = await opportunities.review(id, { decision: 'qualified', notes: 'Catalog matches product; need independent verification', confirmed: true }, 'admin');
  assert.equal(opportunity.status, 'qualified');
  assert.equal(opportunity.verification, 'human_reviewed_external_claim');
  assert.equal(opportunity.reviewedBy, 'admin');
  assert.equal(opportunity.reviewNotes, 'Catalog matches product; need independent verification');
  assert.equal(opportunity.outreachApproved, undefined);
  await assert.rejects(async () => opportunities.review(id, { decision: 'rejected', confirmed: true }, 'admin'), { code: 'OPPORTUNITY_ALREADY_REVIEWED' });
  await assert.rejects(async () => opportunities.review(id, { decision: 'qualified', notes: 'ok', confirmed: false }, 'admin'), { code: 'INVALID_REVIEW' });
});

test('duplicate company/domain from a second accepted Worker order reuses one business record', async t => {
  const { desk, opportunities } = await setup(t);
  const first = await acceptOrder(desk, 'research-first');
  const second = await acceptOrder(desk, 'research-second');
  const a = await opportunities.importFromOrder(first.id, { indices: [0, 1], requestId: 'import-first', confirmed: true }, 'admin');
  const b = await opportunities.importFromOrder(second.id, { indices: [0, 1], requestId: 'import-second', confirmed: true }, 'admin');
  assert.equal(a.createdCount, 2);
  assert.equal(b.createdCount, 0);
  assert.deepEqual(b.importedIds, a.importedIds);
  assert.equal(opportunities.list().length, 2);
});

test('unaccepted, unpersisted and out-of-scope orders cannot publish customer opportunities', async t => {
  const { store, opportunities } = await setup(t);
  const draftId = 'nonaccepted-order';
  await store.update(state => {
    state.workerOrders = [{
      id: draftId, serviceId: 'buyer-discovery', status: 'draft',
      workerReport: { prospects }, deliveryArtifactId: 'not-a-real-artifact',
    }];
  });
  await assert.rejects(async () => opportunities.importFromOrder(draftId,
    { indices: [0], requestId: 'cannot-import', confirmed: true }, 'admin'), { code: 'DELIVERY_NOT_ACCEPTED' });
  assert.equal(opportunities.list().length, 0);
});


test('an accepted buyer task supports multiple independently approved partial imports', async t => {
  const { desk, opportunities, store } = await setup(t);
  const order = await acceptOrder(desk, 'partial-import-source');
  const first = await opportunities.importFromOrder(order.id, { indices: [0], requestId: 'partial-batch-a', confirmed: true }, 'admin');
  assert.equal(first.createdCount, 1);
  assert.equal(opportunities.list().length, 1);
  const second = await opportunities.importFromOrder(order.id, { indices: [1], requestId: 'partial-batch-b', confirmed: true }, 'admin');
  assert.equal(second.createdCount, 1);
  assert.equal(opportunities.list().length, 2);
  const batches = store.read().workerOrders.find(item => item.id === order.id).opportunityImports;
  assert.deepEqual(batches.map(batch => batch.indices), [[0], [1]]);
  const replay = await opportunities.importFromOrder(order.id, { indices: [0], requestId: 'partial-batch-a', confirmed: true }, 'admin');
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.importedIds, first.importedIds);
});
