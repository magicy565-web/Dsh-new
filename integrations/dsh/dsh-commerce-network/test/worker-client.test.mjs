import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerClient, deliverySha256 } from '../worker-client.mjs';
const token = `cnw_${'a'.repeat(24)}.${'b'.repeat(43)}`;

test('worker SDK keeps secrets off URLs, prevents redirects and preserves exact retry identity', async () => {
  const requests = [];
  const client = createWorkerClient({ baseUrl: 'https://example.test', token,
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true, data: { order: null } }), { headers: { 'content-type': 'application/json' } }); } });
  await client.claim({}, { requestId: 'same-request' });
  await client.claim({}, { requestId: 'same-request' });
  assert.equal(requests[0].url, 'https://example.test/commerce-worker-api/claim');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(Object.values(client).includes(token), false);
  assert.throws(() => createWorkerClient({ baseUrl: 'http://external.test', token, allowLocalHttp: true }), /HTTPS/);
  assert.throws(() => createWorkerClient({ baseUrl: 'https://example.test/path', token }), /origin/);
});

test('unknown transport outcome never retries automatically and retains request identity', async () => {
  let calls = 0;
  const client = createWorkerClient({ baseUrl: 'https://example.test', token, fetch: async () => { calls++; throw new Error('private proxy detail'); } });
  await assert.rejects(client.deliver({ orderId: 'w', leaseId: 'l', title: 'Result', content: 'Recorded result' }, { requestId: 'delivery-attempt' }), e => e.code === 'OUTCOME_UNKNOWN' && e.requestId === 'delivery-attempt' && e.outcomeUnknown === true && !e.message.includes('private proxy detail'));
  assert.equal(calls, 1);
});

test('worker SDK exposes rejection and validates bounded JSON responses', async () => {
  const client = createWorkerClient({ baseUrl: 'http://127.0.0.1:3090', token, allowLocalHttp: true,
    fetch: async () => new Response(JSON.stringify({ ok: false, error: { code: 'LEASE_DENIED', message: 'Lease denied' } }), { status: 403, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(client.resources({ orderId: 'o', leaseId: 'foreign' }), e => e.code === 'LEASE_DENIED' && e.status === 403);
  assert.equal(deliverySha256(' result '), deliverySha256('result'));
});
