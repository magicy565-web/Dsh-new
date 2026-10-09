import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';
import { createA2AWorkerAdapter } from '../server/worker-a2a-adapter.mjs';

const offer = 'buyer-discovery';
const taskInput = () => ({
  requestId: 'order-a2a-v1', serviceId: offer, product: 'Fabrics', market: 'United States',
  objective: 'Find publicly verifiable B2B buyers', budgetCredits: 20,
  deadlineAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
  publicDataConfirmed: true,
});

test('A2A adapter cannot advertise executability before reviewed identity and hard budget', () => {
  const client = { sendMessage() {}, getTask() {}, cancelTask() {} };
  const adapter = createA2AWorkerAdapter({ client, displayName: 'Candidate', services: [offer], verifiedPartner: true });
  assert.equal(adapter.ready, false);
  assert.equal(adapter.budgetEnforced, false);
  assert.throws(() => createA2AWorkerAdapter({ client: {}, displayName: 'Unverified', services: [offer] }));
});

test('official A2A Task client is bridged into a durable, evidence-reviewed business order', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'a2a-business-contract-'));
  const store = await openStore(dir);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  let captured;
  let expectedOrderId = null;
  const client = {
    async sendMessage(req) {
      captured = req;
      const received = JSON.parse(req.message.parts[0].text);
      expectedOrderId = received.orderId;
      return { task: { id: 'partner-job-1', status: { state: 'TASK_STATE_WORKING' } } };
    },
    async getTask({ id }) {
      assert.equal(id, 'partner-job-1');
      return {
        id, status: { state: 'TASK_STATE_COMPLETED' },
        artifacts: [{ parts: [{ data: {
          schema: 'workspace.worker.delivery.v1', orderId: expectedOrderId,
          costCredits: 4,
          deliverables: [{ name: 'Distributor shortlist', type: 'table', summary: 'Four sourced leads' }],
          evidence: [{ title: 'Business website', url: 'https://example.com/buyer', detail: 'Sourced from public company site' }],
        } }] }],
      };
    },
    async cancelTask({ id }) { return { id, status: { state: 'TASK_STATE_CANCELED' } }; },
  };
  const adapter = createA2AWorkerAdapter({
    client, displayName: 'Reviewed A2A Partner', services: [offer],
    verifiedPartner: true, verifiedHardBudget: true,
  });
  const desk = createWorkerServiceDesk({ store, adapters: { a2a: adapter } });
  assert.equal(desk.catalog().find(s => s.id === offer).executable, true);
  const { order } = await desk.create(taskInput(), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'a2a' });
  const result = await desk.dispatch(order.id);
  assert.equal(result.order.status, 'running');
  assert.equal(result.order.remoteJobId, 'partner-job-1');
  assert.equal(captured.message.role, 'ROLE_USER');
  assert.equal(captured.message.messageId, order.id);
  const submitted = JSON.parse(captured.message.parts[0].text);
  assert.equal(submitted.orderId, order.id);
  assert.equal(submitted.contract, 'workspace.worker.order.v1');
  assert.equal(submitted.maxCredits, 20);
  assert.equal(submitted.dataScope, 'public');
  assert.deepEqual(Object.keys(submitted.inputs).sort(), ['market', 'objective', 'product']);
  const reviewed = await desk.refresh(order.id);
  assert.equal(reviewed.order.status, 'review_required');
  assert.equal(reviewed.order.reportedCostCredits, 4);
  assert.equal(reviewed.order.workerReport.independentlyVerified, false);
  assert.equal((await desk.accept(order.id, 'admin', { confirmed: true })).order.status, 'accepted');
});

test('A2A text-only or wrong-order output is not deliverable acceptance evidence', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'a2a-unverified-delivery-'));
  const store = await openStore(dir);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const client = {
    async sendMessage() { return { id: 'partner-job-two', status: { state: 'TASK_STATE_WORKING' } }; },
    async getTask({ id }) { return {
      id, status: { state: 'TASK_STATE_COMPLETED' },
      artifacts: [{ parts: [
        { text: 'I found lots of promising leads without citations' },
        { data: { schema: 'workspace.worker.delivery.v1', orderId: 'other-company-task',
          deliverables: [{ name: 'No consent', type: 'report', summary: 'wrong order' }],
          evidence: [{ title: 'Unrelated source', url: 'https://example.com' }] } },
      ] }],
    }; },
    async cancelTask({ id }) { return { id, status: { state: 'TASK_STATE_WORKING' } }; },
  };
  const desk = createWorkerServiceDesk({ store, adapters: {
    a2a: createA2AWorkerAdapter({ client, services: [offer], displayName: 'Fixture', verifiedPartner: true, verifiedHardBudget: true }),
  } });
  const { order } = await desk.create(taskInput(), 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'a2a' });
  await desk.dispatch(order.id);
  const checked = await desk.refresh(order.id);
  assert.equal(checked.order.status, 'result_incomplete');
  await assert.rejects(desk.accept(order.id, 'admin', { confirmed: true }), { code: 'INVALID_STATE' });
});
