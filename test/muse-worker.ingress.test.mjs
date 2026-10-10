import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseIngressError, probeMuseIngress } from '../scripts/check-muse-ingress.mjs';

const baseUrl = 'https://muse.acme-business.io/api/muse-worker/v1';
function fixture({ override = () => ({}) } = {}) {
  const calls = [], cancelled = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
    const api = ['/api/muse-worker/v1/identity', '/api/muse-worker/v1/inbox'].includes(pathname);
    const changes = override(pathname, options);
    const stream = new ReadableStream({ cancel() { cancelled.push(pathname); } });
    const response = new Response(stream, { status: changes.status || (api ? 401 : 404),
      headers: { 'content-type': changes.contentType || (api ? 'application/json' : 'text/html') } });
    Object.defineProperty(response, 'url', { value: changes.url || url });
    Object.defineProperty(response, 'redirected', { value: changes.redirected || false });
    return response;
  };
  return { fetcher, calls, cancelled };
}

test('all public-boundary checks use GET without a valid credential and cancel unread bodies', async () => {
  const f = fixture();
  const result = await probeMuseIngress({ baseUrl, fetcher: f.fetcher });
  assert.equal(result.connection, 'unauthenticated-ingress-boundary-verified');
  assert.equal(result.authenticatedMuseVerified, false);
  assert.equal(result.liveExecutionVerified, false);
  assert.equal(result.checks.length, 12);
  assert.equal(f.cancelled.length, 12);
  for (const { options } of f.calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!options.headers.Authorization || options.headers.Authorization === 'Bearer invalid');
    assert.equal(options.body, undefined);
  }
});

test('an undeployed REST path cannot pass merely because HTTPS responds', async () => {
  const f = fixture({ override: p => p.startsWith('/api/muse-worker/') ? { status: 404 } : {} });
  await assert.rejects(probeMuseIngress({ baseUrl, fetcher: f.fetcher }), error =>
    error instanceof MuseIngressError && error.code === 'MUSE_INGRESS_ROUTE_STATUS' && error.check.received === 404);
  assert.equal(f.cancelled.length, 12);
});

test('administration and Dot paths must be unroutable, even when protected by authentication', async () => {
  for (const pathname of ['/api/worker-orders', '/api/artifacts', '/api/health', '/api/bootstrap', '/mcp/dot']) {
    for (const status of [200, 401, 403]) {
      const f = fixture({ override: p => p === pathname ? { status } : {} });
      await assert.rejects(probeMuseIngress({ baseUrl, fetcher: f.fetcher }), error =>
        error.code === 'MUSE_INGRESS_ROUTE_STATUS' && error.check.path === pathname && error.check.received === status);
      assert.equal(f.cancelled.length, 12);
    }
  }
});

test('redirect status, followed redirects and unexpected final URLs fail closed', async () => {
  for (const changed of [{ status: 302 }, { redirected: true }, { url: 'https://login.acme-business.io/' }]) {
    const f = fixture({ override: p => p.endsWith('/identity') ? changed : {} });
    await assert.rejects(probeMuseIngress({ baseUrl, fetcher: f.fetcher }), { code: 'MUSE_INGRESS_REDIRECTED' });
    assert.equal(f.cancelled.length, 12);
  }
});

test('a generic HTML login challenge is not mistaken for the Muse API', async () => {
  const f = fixture({ override: p => p.endsWith('/identity') ? { contentType: 'text/html' } : {} });
  await assert.rejects(probeMuseIngress({ baseUrl, fetcher: f.fetcher }), { code: 'MUSE_INGRESS_AUTH_RESPONSE_INVALID' });
  assert.equal(f.cancelled.length, 12);
});

test('network exceptions cannot escape into public diagnostics', async () => {
  await assert.rejects(probeMuseIngress({ baseUrl, fetcher: async () => { throw new Error('private upstream detail'); } }), error =>
    error.code === 'MUSE_INGRESS_REQUEST_FAILED' && !JSON.stringify(error).includes('private upstream detail'));
});

test('HTTP, placeholders, IPs and credential-bearing URLs are rejected before requests', async () => {
  let calls = 0;
  for (const value of [
    'http://muse.acme-business.io/api/muse-worker/v1',
    'https://UNCONFIGURED-HOST.invalid/api/muse-worker/v1',
    'https://159.138.90.22/api/muse-worker/v1',
    'https://name:password@muse.acme-business.io/api/muse-worker/v1',
    baseUrl + '?token=secret',
  ]) await assert.rejects(probeMuseIngress({ baseUrl: value, fetcher: () => { calls++; } }));
  assert.equal(calls, 0);
});

test('disabled TLS validation is rejected before any request', async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let calls = 0;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    await assert.rejects(probeMuseIngress({ baseUrl, fetcher: () => { calls++; } }), { code: 'MUSE_TLS_REQUIRED' });
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
});
