import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';

const prospect = {
  name: 'Fixture Textile Distributor', country: 'USA',
  website: 'https://textile-distributor.example.org',
  fitReason: 'Publishes wholesale fabric and textile assortment',
  sourceUrl: 'https://textile-distributor.example.org/about',
};

test('real HTTP business loop: approved Worker -> receipt -> explicit opportunity import -> manual qualification', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'worker-opportunity-http-'));
  const worker = {
    services: ['buyer-discovery'], displayName: 'Isolated fixture Agent',
    ready: true, budgetEnforced: true,
    async submit(task) { return { jobId: 'fixture-' + task.orderId }; },
    async get(jobId) { return {
      jobId, status: 'completed', costCredits: 3,
      deliverables: [{ name: 'Sourced buyers', type: 'table', summary: 'One candidate supported by a source URL' }],
      evidence: [{ title: 'Public catalog', url: prospect.sourceUrl, detail: 'Catalog fixture' }],
      prospects: [prospect],
    }; },
    async cancel() { return { status: 'cancel_requested' }; },
  };
  const app = await createApp({ dataDirectory: directory, workerAdapters: { fixture: worker } });
  const address = await app.listen(0);
  const base = 'http://127.0.0.1:' + address.port;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const send = async (url, payload = {}) => {
    const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  const read = async url => {
    const response = await fetch(base + url);
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await read('/api/worker-opportunities')).body.opportunities.length, 0);
  const create = await send('/api/worker-orders', {
    requestId: 'http-opportunity-001', serviceId: 'buyer-discovery', product: 'Printed rayon fabric',
    market: 'USA', objective: 'Identify public textile distributors with sourced evidence',
    budgetCredits: 12, deadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    publicDataConfirmed: true,
  });
  assert.equal(create.status, 201);
  const id = create.body.order.id;
  const before = await send('/api/worker-orders/' + id + '/promote', {
    indices: [0], requestId: 'promote-http-first', confirmed: true,
  });
  assert.equal(before.status, 409);
  assert.equal(before.body.error.code, 'DELIVERY_NOT_ACCEPTED');
  assert.equal((await send('/api/worker-orders/' + id + '/approve', { confirmed: true, workerId: 'fixture' })).status, 200);
  assert.equal((await send('/api/worker-orders/' + id + '/dispatch')).body.order.status, 'running');
  assert.equal((await send('/api/worker-orders/' + id + '/refresh')).body.order.status, 'review_required');
  const accepted = await send('/api/worker-orders/' + id + '/accept', { confirmed: true });
  assert.equal(accepted.body.order.status, 'accepted');
  assert.ok(accepted.body.order.deliveryArtifactId);
  const imported = await send('/api/worker-orders/' + id + '/promote', {
    indices: [0], requestId: 'promote-http-first', confirmed: true,
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.createdCount, 1);
  const opportunityId = imported.body.importedIds[0];
  const listed = await read('/api/worker-opportunities');
  assert.equal(listed.body.opportunities.length, 1);
  assert.equal(listed.body.opportunities[0].verification, 'external_unverified');
  assert.equal(listed.body.opportunities[0].sourceOrderId, id);
  assert.equal((await send('/api/worker-opportunities/' + opportunityId + '/review', {
    decision: 'qualified', notes: 'Manually checked the product fit', confirmed: true,
  })).body.opportunity.status, 'qualified');
  const checked = await read('/api/worker-opportunities/' + opportunityId);
  assert.equal(checked.body.opportunity.verification, 'human_reviewed_external_claim');
  assert.equal(checked.body.opportunity.outreachApproved, undefined);
  const replay = await send('/api/worker-orders/' + id + '/promote', {
    indices: [0], requestId: 'promote-http-first', confirmed: true,
  });
  assert.equal(replay.body.duplicate, true);
  assert.equal((await read('/api/worker-opportunities')).body.opportunities.length, 1);
});
