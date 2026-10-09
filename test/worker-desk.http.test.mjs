import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

test('real local HTTP service desk creates durable drafts and cannot dispatch without reviewed worker', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-desk-http-'));
  t.after(async () => { await rm(dir, { force: true, recursive: true }); });
  let app = await createApp({ dataDirectory: dir });
  let addr = await app.listen(0);
  let base = 'http://127.0.0.1:' + addr.port;
  const get = async pathname => {
    const res = await fetch(base + pathname); return { status: res.status, data: await res.json() };
  };
  try {
    const catalog = await get('/api/worker-services');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.services.length, 4);
    assert.equal(catalog.data.services.filter(offer => offer.executable).length, 0);
    const request = {
      requestId: 'persistent-order', serviceId: 'buyer-discovery', product: 'Textiles', market: 'US',
      objective: 'Find and verify 20 B2B distributors using public sources',
      deadlineAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
      budgetCredits: 20, publicDataConfirmed: true,
    };
    const send = (pathname, body) => fetch(base + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const res = await send('/api/worker-orders', request);
    assert.equal(res.status, 201);
    const { order } = await res.json();
    assert.equal(order.status, 'draft');
    assert.equal(order.workerId, null);
    assert.ok(order.id);
    const duplicate = await send('/api/worker-orders', request);
    assert.equal(duplicate.status, 201);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal((await get('/api/worker-orders')).data.orders.length, 1);
    const refused = await send('/api/worker-orders/' + order.id + '/approve', { confirmed: true });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error.code, 'WORKER_UNAVAILABLE');
    await app.close();
    app = await createApp({ dataDirectory: dir });
    addr = await app.listen(0);
    base = 'http://127.0.0.1:' + addr.port;
    const stored = await get('/api/worker-orders/' + order.id);
    assert.equal(stored.status, 200);
    assert.equal(stored.data.order.id, order.id);
    assert.equal(stored.data.order.status, 'draft');
  } finally { await app.close(); }
});


test('restart fences unacknowledged external dispatch instead of replaying partner calls', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-desk-restart-'));
  t.after(async () => { await rm(dir, { force: true, recursive: true }); });
  let app = await createApp({ dataDirectory: dir });
  let address = await app.listen(0);
  try {
    const base = 'http://127.0.0.1:' + address.port;
    const response = await fetch(base + '/api/worker-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'restart-task-1', serviceId: 'buyer-discovery',
        product: 'Machine parts', market: 'USA', objective: 'Identify public distributors',
        budgetCredits: 10,
        deadlineAt: new Date(Date.now() + 4 * 86400_000).toISOString(),
        publicDataConfirmed: true,
      }),
    });
    assert.equal(response.status, 201);
    const { order } = await response.json();
    await app.store.update(state => {
      const current = state.workerOrders.find(item => item.id === order.id);
      current.status = 'dispatching'; // simulate process dying after sending partner request
    });
    await app.close();
    app = await createApp({ dataDirectory: dir });
    address = await app.listen(0);
    const restarted = await (await fetch('http://127.0.0.1:' + address.port + '/api/worker-orders/' + order.id)).json();
    assert.equal(restarted.order.status, 'dispatch_uncertain');
    assert.equal(restarted.order.remoteJobId, null);
    assert.equal(restarted.order.error.code, 'DISPATCH_UNCERTAIN');
    const noReplay = await fetch('http://127.0.0.1:' + address.port + '/api/worker-orders/' + order.id + '/dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(noReplay.status, 409);
    assert.equal((await noReplay.json()).error.code, 'INVALID_STATE');
  } finally { await app.close(); }
});
