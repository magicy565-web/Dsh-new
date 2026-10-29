import { createHash, randomUUID } from 'node:crypto';

export class CommerceWorkerError extends Error {
  constructor(message, { code, status = 0, requestId, outcomeUnknown = false } = {}) {
    super(message); this.name = 'CommerceWorkerError';
    Object.assign(this, { code, status, requestId, outcomeUnknown });
  }
}

/** A transport SDK for an independently owned worker. It has no model or agent loop. */
export function createWorkerClient({ baseUrl, token, allowLocalHttp = false, fetch: transport = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  const base = new URL(baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new TypeError('baseUrl must be an origin without credentials, paths, or query parameters.');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && allowLocalHttp && local)) throw new TypeError('Worker credentials require HTTPS. Only explicit localhost development may use HTTP.');
  if (typeof token !== 'string' || !/^cnw_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new TypeError('Provide the scoped worker credential issued by the authenticated canvas.');
  if (typeof transport !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new TypeError('timeoutMs must be between 100 and 60000.');
  const actions = new Set(['connect', 'claim', 'heartbeat', 'status', 'deliver', 'stopped', 'resources']);
  async function request(action, input = {}, { signal, requestId = `worker:${randomUUID()}` } = {}) {
    if (!actions.has(action)) throw new TypeError('Unsupported worker action.');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'requestId')) throw new TypeError('Use options.requestId for idempotency.');
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) throw new TypeError('Invalid requestId.');
    signal?.throwIfAborted();
    const body = JSON.stringify({ ...input, requestId });
    if (Buffer.byteLength(body) > 256 * 1024) throw new TypeError('Worker request exceeds 256 KiB.');
    const effectiveSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let response;
    try {
      response = await transport(new URL(`/commerce-worker-api/${action}`, base), {
        method: 'POST', redirect: 'error', signal: effectiveSignal,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body,
      });
    } catch {
      throw new CommerceWorkerError('Delivery outcome is unknown. Retain this requestId and reconcile status before retrying the identical request.', { code: 'OUTCOME_UNKNOWN', requestId, outcomeUnknown: true });
    }
    let value;
    try {
      if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('Expected JSON');
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
        chunks.push(part.value);
      }
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new CommerceWorkerError('The service response could not be verified. Reconcile the request before retrying.', { code: 'UNVERIFIED_RESPONSE', status: response.status, requestId, outcomeUnknown: true });
    }
    if (!response.ok || value?.ok !== true) {
      throw new CommerceWorkerError(value?.error?.message || 'Worker request was rejected.', { code: value?.error?.code || 'REJECTED', status: response.status, requestId });
    }
    return value.data;
  }
  const client = Object.fromEntries([...actions].map(action => [action, (input, options) => request(action, input, options)]));
  return Object.freeze({ ...client, origin: base.origin });
}

export function deliverySha256(content) {
  if (typeof content !== 'string') throw new TypeError('A delivery is UTF-8 text.');
  return createHash('sha256').update(content.trim()).digest('hex');
}
