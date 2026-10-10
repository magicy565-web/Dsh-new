#!/usr/bin/env node
/**
 * Read-only acceptance probe for a deployed personal Muse Custom Connector.
 * No registration, no paid model calls, no task claims, no writes.
 * HTTPS-only, no redirects, bounded responses; never prints credentials.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
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
      /(^|\.)(localhost|local|invalid|example|test)$/.test(url.hostname) ||
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
  if (Number(response.headers?.get?.('content-length') || 0) > 65_536) fail('MUSE_RESPONSE_TOO_LARGE');
  let raw, parsed;
  try { raw = await response.text(); if (raw.length > 65_536) fail('MUSE_RESPONSE_TOO_LARGE'); parsed = JSON.parse(raw); }
  catch (error) { if (error instanceof MuseProbeError) throw error; fail('MUSE_RESPONSE_INVALID'); }
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
