import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedA2AFetch } from '../server/worker-a2a-host.mjs';

const ENDPOINT = 'https://partner.example.org/a2a';
const request = { method: 'POST', body: '{"jsonrpc":"2.0","method":"SendMessage"}',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' } };

test('pinned A2A fetch permits only the authorized JSONRPC endpoint and strips redirect authority', async () => {
  let observed;
  const handler = createPinnedA2AFetch({
    endpoint: ENDPOINT,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await handler(ENDPOINT, request);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).jsonrpc, '2.0');
  assert.equal(observed.url, ENDPOINT);
  assert.equal(observed.options.redirect, 'manual');
  assert.equal(observed.options.credentials, 'omit');
  assert.equal(observed.options.headers.Authorization, 'Bearer fixture');
  await assert.rejects(handler('https://other.example.org/a2a', request), { code: 'WORKER_A2A_SETUP' });
  await assert.rejects(handler(ENDPOINT + '/redirected', request), { code: 'WORKER_A2A_SETUP' });
  await assert.rejects(handler(ENDPOINT, { method: 'GET' }), { code: 'WORKER_A2A_SETUP' });
  await assert.rejects(handler(ENDPOINT, { ...request, body: 'a'.repeat(128 * 1024 + 1) }), { code: 'WORKER_A2A_SETUP' });
});

test('a partner redirect is rejected before the SDK can forward authorization to another URL', async () => {
  const handler = createPinnedA2AFetch({
    endpoint: ENDPOINT,
    fetchImpl: async () => new Response(null, {
      status: 302, headers: { Location: 'http://127.0.0.1/admin' },
    }),
  });
  await assert.rejects(handler(ENDPOINT, request), { code: 'WORKER_A2A_SETUP' });
});

test('bounded response rejects oversized remote data even with no content-length', async () => {
  const handler = createPinnedA2AFetch({
    endpoint: ENDPOINT, maxResponseBytes: 1024,
    fetchImpl: async () => new Response('x'.repeat(2000), { status: 200 }),
  });
  await assert.rejects(handler(ENDPOINT, request), { code: 'WORKER_A2A_SETUP' });
});

test('forbidden target URLs never perform any fetch', async () => {
  let fetched = false;
  for (const endpoint of ['http://example.org/a2a', 'https://localhost/a2a', 'https://127.0.0.1/a2a']) {
    assert.throws(() => createPinnedA2AFetch({
      endpoint, fetchImpl: async () => { fetched = true; return new Response('{}'); },
    }), { code: 'WORKER_A2A_SETUP' });
  }
  assert.equal(fetched, false);
});
