#!/usr/bin/env node
/**
 * Read-only acceptance probe for a deployed personal Muse Custom Connector.
 * No registration, paid model calls, claims, or task mutations. GET identity/inbox may persist handshake audit timestamps.
 * HTTPS-only, no redirects, bounded responses; never prints credentials.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const MAX_RESPONSE_BYTES = 65_536;
export class MuseProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new MuseProbeError(code); };

export function validateMuseBaseUrl(value) {
  if (typeof value !== 'string') fail('MUSE_URL_REQUIRED');
  let url;
  try { url = new URL(value); } catch { fail('MUSE_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/api/muse-worker/v1' ||
      !url.hostname.includes('.') || url.port ||
      /(^|\.)(localhost|local|invalid|test|example|example\.com|example\.org|example\.net)$/.test(url.hostname) ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) ||
      url.hostname.startsWith('[') || url.hostname.endsWith(']'))
    fail('MUSE_URL_UNVERIFIED');
  return url.origin + url.pathname;
}

async function requestJson(fetcher, url, token, signal) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', redirect: 'error', signal,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });
  } catch { fail('MUSE_READ_FAILED'); }
  if (!response || typeof response.status !== 'number') fail('MUSE_RESPONSE_INVALID');
  if (response.status !== 200) fail(response.status === 401 ? 'MUSE_UNAUTHORIZED' : 'MUSE_READ_FAILED');
  if (Number(response.headers?.get?.('content-length') || 0) > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch { /* Preserve the safe error code. */ }
    fail('MUSE_RESPONSE_TOO_LARGE');
  }
  // Count decoded transport bytes while downloading. Content-Length may be
  // absent or refer to compressed bytes, and JS string length is not UTF-8 size.
  if (typeof response.body?.getReader !== 'function') fail('MUSE_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0, parsed;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) fail('MUSE_RESPONSE_TOO_LARGE');
      if (value.byteLength) chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    try { await reader.cancel(); } catch { /* Never expose response or credential details. */ }
    if (error instanceof MuseProbeError) throw error;
    fail('MUSE_RESPONSE_INVALID');
  } finally {
    reader.releaseLock();
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('MUSE_RESPONSE_INVALID');
  return parsed;
}

export async function probeMuseReadOnly({ baseUrl, token, expectedWorkerId,
  fetcher = globalThis.fetch, allowApproved = false } = {}) {
  const base = validateMuseBaseUrl(baseUrl);
  if (!TOKEN.test(token || '')) fail('MUSE_CREDENTIAL_REQUIRED');
  if (!ID.test(expectedWorkerId || '')) fail('MUSE_EXPECTED_ID_REQUIRED');
  if (typeof fetcher !== 'function') fail('MUSE_FETCH_UNAVAILABLE');

  const identity = await requestJson(fetcher, base + '/identity', token, AbortSignal.timeout(10_000));
  if (identity.workerId !== expectedWorkerId || identity.contract !== 'workspace.muse.pull.v1' ||
      typeof identity.muse !== 'string' || typeof identity.approved !== 'boolean' ||
      typeof identity.connected !== 'boolean')
    fail('MUSE_IDENTITY_MISMATCH');
  if (identity.approved && !allowApproved) fail('MUSE_UNEXPECTED_APPROVAL');

  const inbox = await requestJson(fetcher, base + '/inbox', token, AbortSignal.timeout(10_000));
  if (inbox.workerId !== expectedWorkerId || !Array.isArray(inbox.tasks) || inbox.tasks.length > 200)
    fail('MUSE_INBOX_INVALID');
  if (!allowApproved && inbox.tasks.length > 0) fail('MUSE_UNEXPECTED_TASKS');
  return Object.freeze({
    connection: 'authenticated-read-only',
    workerId: identity.workerId,
    contract: identity.contract,
    approved: identity.approved,
    inboxCount: inbox.tasks.length,
    liveExecutionVerified: false,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await probeMuseReadOnly({
      baseUrl: process.env.WORKSPACE_MUSE_PROBE_URL,
      token: process.env.WORKSPACE_MUSE_PROBE_TOKEN,
      expectedWorkerId: process.env.WORKSPACE_MUSE_PROBE_WORKER_ID,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('Muse probe failed: ' + (error instanceof MuseProbeError ? error.code : 'UNKNOWN_ERROR') + '\n');
    process.exitCode = 1;
  }
}
