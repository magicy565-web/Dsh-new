import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'goal-commerce-'));
  let externalCalls = 0;
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {},
    provider: { kind: 'fixture-unconfigured', configured: false, complete: async () => { externalCalls++; throw Error('No model calls permitted.'); } },
    shopifyFetch: async () => { externalCalls++; throw Error('No Shopify calls permitted.'); } });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const api = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${route}`, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const product = (await api('/library/products', 'POST', { requestId: randomUUID(), name: 'Original product', description: 'PRIVATE original catalog' })).body.product;
  assert.ok(product);
  const project = (await api('/commerce-projects', 'POST', {
    requestId: randomUUID(), confirmed: true, productId: product.id, productRevision: product.revision,
    publicDescription: 'Explicit public summary', market: 'Germany', objective: 'Research distributors',
    budget: { amount: '250', currency: 'EUR' }, durationDays: 30, validationOrderTarget: 3,
  })).body.project;
  const staged = await api(`/commerce-projects/${project.id}/stage-research`, 'POST', { requestId: randomUUID(), confirmed: true });
  assert.equal(staged.status, 200);
  return { app, api, product, project, goalId: staged.body.project.researchGoalId, calls: () => externalCalls };
}

test('goal context follows exact stored links and exposes only the approved product snapshot', async t => {
  const f = await fixture(t);
  const unrelated = (await f.api('/goals', 'POST', { title: f.app.store.read().goals[0].title, description: 'Same title, unrelated task' })).body.goal;
  await f.api(`/library/products/${f.product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: f.product.revision, changes: { name: 'Changed product name', description: 'PRIVATE new catalog' } });
  const before = f.app.store.read();
  const result = await f.api(`/goals/${f.goalId}/commerce-context`);
  assert.equal(result.status, 200);
  assert.equal(result.body.goalId, f.goalId);
  assert.equal(result.body.projects.length, 1);
  const project = result.body.projects[0];
  assert.equal(project.id, f.project.id);
  assert.equal(project.productName, 'Original product');
  assert.equal(project.productRevision, 1);
  assert.equal(project.publicDescription, 'Explicit public summary');
  for (const key of ['requestId', 'fingerprint', 'createdBy', 'researchRequestId', 'researchOrderIntent', 'shopifyConfigFingerprint', 'orderSyncRequests']) assert.equal(Object.hasOwn(project, key), false, key);
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE|Changed product/);
  assert.deepEqual((await f.api(`/goals/${unrelated.id}/commerce-context`)).body, { goalId: unrelated.id, projects: [] });
  assert.deepEqual(f.app.store.read(), before, 'context reads must not mutate saved state');
  assert.equal(f.calls(), 0);
});

test('missing goals fail explicitly and are never interpreted as an empty valid scope', async t => {
  const f = await fixture(t);
  const result = await f.api(`/goals/${randomUUID()}/commerce-context`);
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'GOAL_NOT_FOUND');
  assert.equal(f.calls(), 0);
});

test('goal context retains the normal origin gate and exposes no write action', async t => {
  const f = await fixture(t), route = `/goals/${f.goalId}/commerce-context`;
  const denied = await f.api(route, 'GET', undefined, { Origin: 'https://outside.example' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'ORIGIN_REJECTED');
  const before = f.app.store.read();
  assert.equal((await f.api(route, 'POST', { confirmed: true })).status, 404);
  assert.deepEqual(f.app.store.read(), before);
});

test('linked Worker order remains draft and is read afresh without dispatch or invented delivery', async t => {
  const f = await fixture(t);
  const staged = await f.api(`/commerce-projects/${f.project.id}/stage-worker-research`, 'POST', {
    requestId: randomUUID(), confirmed: true, serviceId: 'buyer-discovery', brief: 'Explicit public research scope',
    budgetCredits: 10, deadlineAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(staged.status, 200, JSON.stringify(staged.body));
  const orderId = staged.body.project.researchOrder.id;
  let linked = (await f.api(`/goals/${f.goalId}/commerce-context`)).body.projects[0];
  assert.equal(linked.researchOrder.id, orderId);
  assert.equal(linked.researchOrder.status, 'draft');
  assert.equal(linked.researchOrder.deliverableCount, 0);
  assert.equal(linked.researchOrder.independentlyVerified, false);
  // Synthetic persisted delivery evidence; not a real external Worker claim.
  await f.app.store.update(state => {
    const order = state.workerOrders.find(row => row.id === orderId);
    order.status = 'review_required';
    order.workerReport = { deliverables: [{ title: 'Fixture report' }], evidence: [{ url: 'https://example.com' }], prospects: [{ company: 'Fixture company' }] };
  });
  linked = (await f.api(`/goals/${f.goalId}/commerce-context`)).body.projects[0];
  assert.equal(linked.researchOrder.status, 'review_required');
  assert.equal(linked.researchOrder.deliverableCount, 1);
  assert.equal(linked.researchOrder.prospectCount, 1);
  assert.equal(linked.results.observedAt, null);
  assert.equal(linked.results.billableAmount, null);
  assert.equal(f.calls(), 0);
  assert.equal(f.app.store.read().runs.length, 0);
});

test('partial order evidence keeps currency totals separate and never creates billable revenue', async t => {
  const f = await fixture(t);
  await f.app.store.update(state => {
    state.commerceProjects.find(row => row.id === f.project.id).orderEvidence = {
      complete: false, observedAt: '2026-10-11T01:00:00Z', orders: [
        { id: 'order-fixture-1', salesEvidence: true, netReceived: '12.50', currency: 'USD' },
        { id: 'order-fixture-2', salesEvidence: true, netReceived: '8.25', currency: 'EUR' },
        { id: 'order-fixture-3', test: true, salesEvidence: false, netReceived: '999', currency: 'USD' },
      ],
    };
  });
  const result = (await f.api(`/goals/${f.goalId}/commerce-context`)).body.projects[0].results;
  assert.equal(result.complete, false);
  assert.equal(result.paidFulfilledOrders, 2);
  assert.deepEqual(result.netReceipts, [{ currency: 'USD', amount: '12.5' }, { currency: 'EUR', amount: '8.25' }]);
  assert.equal(result.billableAmount, null);
  assert.equal(f.calls(), 0);
});
