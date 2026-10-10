#!/usr/bin/env node
/** GET-only deployment boundary check. Uses no valid credential or task mutation. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MuseProbeError, validateMuseBaseUrl } from './check-muse-readonly-connection.mjs';

export class MuseIngressError extends Error {
  constructor(code, check) { super(code); this.code = code; this.check = check; }
}
const fail = (code, check) => { throw new MuseIngressError(code, check); };
const privatePaths = Object.freeze([
  '/', '/mcp', '/mcp/dot', '/api/dot-worker/v1/identity',
  '/api/worker-orders', '/api/artifacts', '/api/health', '/api/bootstrap',
]);

export async function probeMuseIngress({ baseUrl, fetcher = globalThis.fetch } = {}) {
  const base = validateMuseBaseUrl(baseUrl);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('MUSE_TLS_REQUIRED');
  if (typeof fetcher !== 'function') fail('MUSE_FETCH_UNAVAILABLE');
  const origin = new URL(base).origin;
  const checks = [
    ...['identity', 'inbox'].flatMap(op => [
      { path: '/api/muse-worker/v1/' + op, auth: 'missing', expected: 401 },
      { path: '/api/muse-worker/v1/' + op, auth: 'invalid', expected: 401 },
    ]),
    ...privatePaths.map(pathname => ({ path: pathname, auth: 'missing', expected: 404 })),
  ];
  const signal = AbortSignal.timeout(10_000);
  const results = await Promise.allSettled(checks.map(async check => {
    const url = origin + check.path;
    let response;
    try {
      response = await fetcher(url, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal,
        headers: { Accept: 'application/json',
          // Deliberately too short to be a valid issued Muse credential.
          ...(check.auth === 'invalid' ? { Authorization: 'Bearer invalid' } : {}),
        },
      });
    } catch { fail('MUSE_INGRESS_REQUEST_FAILED', check); }
    try {
      if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599)
        fail('MUSE_INGRESS_RESPONSE_INVALID', check);
      if (response.redirected || response.url !== url || response.status >= 300 && response.status < 400)
        fail('MUSE_INGRESS_REDIRECTED', check);
      if (response.status !== check.expected)
        fail('MUSE_INGRESS_ROUTE_STATUS', { ...check, received: response.status });
      if (check.expected === 401 && !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || ''))
        fail('MUSE_INGRESS_AUTH_RESPONSE_INVALID', check);
      return Object.freeze({ ...check, received: response.status });
    } finally {
      // Status-only check: cancel each body immediately, including failure bodies.
      // No enterprise page, task, credential or response body is consumed/printed.
      try { await response?.body?.cancel(); } catch { /* Preserve safe diagnostics. */ }
    }
  }));
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  return Object.freeze({
    connection: 'unauthenticated-ingress-boundary-verified', origin,
    checks: results.map(result => result.value),
    authenticatedMuseVerified: false, liveExecutionVerified: false,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.stdout.write(JSON.stringify(await probeMuseIngress({ baseUrl: process.env.WORKSPACE_MUSE_PROBE_URL })) + '\n');
  } catch (error) {
    // Never forward network exceptions, response bodies, environment or credentials.
    process.stderr.write(JSON.stringify({ error: error instanceof MuseIngressError || error instanceof MuseProbeError ? error.code : 'UNKNOWN_ERROR',
      ...(error instanceof MuseIngressError && error.check ? { check: error.check } : {}),
    }) + '\n');
    process.exitCode = 1;
  }
}
