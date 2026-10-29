import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { CommerceStore } from '../store.js';
import { createCommerceService } from '../service.js';
import { createHttpHandler, createWorkerHandler } from '../http.js';

test('actual HTTP routes enforce DSH owner auth, exact origin, model dispatch separation and worker Bearer scope', async () => {
  const workspaceId = randomUUID(), sessionId = `session-${randomUUID()}`;
  const record = { id: workspaceId, sessionIds: [sessionId] };
  const service = createCommerceService({ store: new CommerceStore(':memory:'), registry: { list: () => [record], get: id => id === workspaceId ? record : null } });
  const owner = createHttpHandler(service, { authorize: ({ headers }) => headers.cookie === 'owner=fixture' ? null : 401 });
  const worker = createWorkerHandler(service);
  const server = createServer((req, res) => req.url.startsWith('/commerce-worker-api/') ? worker(req, res) : owner(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const read = `/commerce-network-api/workspace?sessionId=${sessionId}`;
    assert.equal((await fetch(base + read)).status, 401);
    const actual = await fetch(base + read, { headers: { cookie: 'owner=fixture' } });
    assert.equal(actual.status, 200); assert.deepEqual((await actual.json()).data.projects, []);
    const body = { sessionId, command: 'create_project', expectedRevision: 0, requestId: randomUUID(), payload: { title: 'HTTP fixture' } };
    const post = headers => fetch(base + '/commerce-network-api/command', { method: 'POST', headers: { cookie: 'owner=fixture', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ origin: 'https://attacker.example' })).status, 403);
    assert.equal((await post({})).status, 403);
    const created = await post({ origin: base }); assert.equal(created.status, 200);
    const state = (await created.json()).data;
    const dispatch = await fetch(base + '/commerce-network-api/command', { method: 'POST', headers: { cookie: 'owner=fixture', origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, command: 'dispatch_order', projectId: state.projectId, expectedRevision: state.revision, requestId: randomUUID(), payload: { orderId: 'unapproved' } }) });
    assert.equal(dispatch.status, 403);
    assert.equal((await fetch(base + '/commerce-worker-api/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID() }) })).status, 401);
    assert.equal((await fetch(base + '/commerce-worker-api/connect', { method: 'POST', headers: { 'content-type': 'application/json', origin: base, authorization: 'Bearer no' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/commerce-worker-api/connect?token=no', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer no' }, body: '{}' })).status, 404);
  } finally { server.close(); await once(server, 'close'); service.close(); }
});
