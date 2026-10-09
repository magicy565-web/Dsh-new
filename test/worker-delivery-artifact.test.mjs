import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createArtifactService } from '../server/artifacts.mjs';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';

test('approved third-party business work is stored as real Workspace artifact, never fictional sales results', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-delivery-artifact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openStore(dir);
  const artifacts = await createArtifactService({ store, directory: path.join(dir, 'artifacts') });
  const adapter = {
    ready: true, budgetEnforced: true, displayName: 'Fixture partner',
    services: ['buyer-discovery'],
    async submit(task) { return { jobId: 'real-reference-' + task.orderId }; },
    async get(jobId) {
      return { jobId, status: 'completed', costCredits: 6,
        deliverables: [{ name: 'Candidate shortlist', type: 'table', summary: '20 public buyer candidates requiring human review' }],
        prospects: [{ name: 'Distributor A', country: 'USA', website: 'https://distributor.example.com', fitReason: 'Carries fabric and textile lines', sourceUrl: 'https://distributor.example.com/about' }],
        evidence: [{ title: 'Public buyer page', url: 'https://example.org/buyers', detail: 'Externally supplied reference, not independently verified' }],
      };
    },
    async cancel() { return { status: 'cancel_requested' }; },
  };
  const desk = createWorkerServiceDesk({ store, adapters: { partner: adapter }, artifacts });
  const { order } = await desk.create({
    requestId: 'worker-artifact-fixture-001', serviceId: 'buyer-discovery',
    product: 'Printed rayon fabric', market: 'United States',
    objective: 'Identify 20 potential wholesale distributors backed by public sources',
    budgetCredits: 20, deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    publicDataConfirmed: true,
  }, 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'partner' });
  await desk.dispatch(order.id);
  assert.equal((await desk.refresh(order.id)).order.status, 'review_required');
  const accepted = await desk.accept(order.id, 'admin', { confirmed: true });
  assert.equal(accepted.order.status, 'accepted');
  assert.ok(accepted.order.deliveryArtifactId);
  const records = artifacts.list().artifacts;
  assert.equal(records.length, 1);
  assert.equal(records[0].id, accepted.order.deliveryArtifactId);
  const downloaded = await artifacts.download(accepted.order.deliveryArtifactId);
  const receipt = JSON.parse(downloaded.bytes.toString('utf8'));
  assert.equal(receipt.schema, 'workspace.worker.accepted-receipt.v1');
  assert.equal(receipt.orderId, order.id);
  assert.equal(receipt.workerReportedCredits, 6);
  assert.equal(receipt.externalClaimsIndependentlyVerified, false);
  assert.equal(receipt.workerReport.evidence.length, 1);
  assert.equal(receipt.workerReport.prospects.length, 1);
  assert.equal(receipt.workerReport.prospects[0].name, 'Distributor A');
  assert.equal(receipt.workerReport.prospects[0].independentlyVerified, false);
  await assert.rejects(desk.accept(order.id, 'admin', { confirmed: true }), { code: 'INVALID_STATE' });
  assert.equal(artifacts.list().artifacts.length, 1);
  await artifacts.close();
  await store.close();
  const reopened = await openStore(dir);
  assert.equal(reopened.read().workerOrders[0].deliveryArtifactId, records[0].id);
  await reopened.close();
});
