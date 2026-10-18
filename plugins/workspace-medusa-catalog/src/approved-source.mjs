// Separate from the Library-to-Medusa draft adapter. Medusa remains authority
// for native products. This reader owns no storage, grants, model or environment.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const HASH = /^(?:[a-f0-9]{64}|rev:[a-f0-9]{32}:[a-f0-9]{64})$/u;
export class MedusaApprovedSourceError extends Error {
  constructor(code) { super('The reviewed Medusa source is unavailable; no fallback or mutation was attempted.'); this.code = code; }
}
const fail = code => { throw new MedusaApprovedSourceError(code); };
const tokenSafe = token => typeof token === 'string' && token.length >= 16 && token.length <= 4096 && /^[\x21-\x7e]+$/u.test(token);
function configuration(connection, authorizeOriginal, fetchImpl) {
  if (connection == null) return null;
  if (!connection || Object.getPrototypeOf(connection) !== Object.prototype || Object.keys(connection).some(k => !['reviewed', 'sourceId', 'workspaceId', 'baseURL', 'readToken', 'allowLoopbackHTTP', 'timeoutMs'].includes(k)) || connection.reviewed !== true || !UUID.test(connection.sourceId) || !(typeof connection.workspaceId === 'string' && /^[A-Za-z0-9._@:+|/-]{1,128}$/u.test(connection.workspaceId)) || !tokenSafe(connection.readToken) || typeof authorizeOriginal !== 'function' || typeof fetchImpl !== 'function') throw TypeError('Use a reviewed, enterprise-bound original Host connection.');
  let url; try { url = new URL(connection.baseURL); } catch { throw TypeError('Use a valid reviewed Medusa origin.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.origin + '/' !== url.href || url.username || url.password || url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && connection.allowLoopbackHTTP === true)) throw TypeError('Use an exact HTTPS Medusa origin or explicit loopback test origin.');
  const timeoutMs = connection.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw TypeError('Use a bounded Medusa read timeout.');
  return Object.freeze({ ...connection, baseURL: url.origin, timeoutMs });
}
function projection(row, binding) {
  const context = row?.context, product = row?.product;
  if (!context || context.status !== 'approved' || !Number.isInteger(context.review_version) || context.review_version < 1 || context.review_version > 2147483647 || !HASH.test(context.source_hash) || !product || !ID.test(product.id) || context.product_id !== product.id || typeof product.title !== 'string' || !product.title.trim() || Buffer.byteLength(product.title) > 2000) fail('MEDUSA_APPROVED_SOURCE_INVALID');
  return { reference: { kind: 'medusa-product', id: product.id, revision: context.review_version, sourceId: binding.sourceId, sourceHash: context.source_hash }, title: product.title, referenceOnly: false };
}
export function createMedusaApprovedSource({ connection = null, authorizeOriginal, fetchImpl = globalThis.fetch } = {}) {
  const config = configuration(connection, authorizeOriginal, fetchImpl);
  const binding = config ? Object.freeze({ sourceId: config.sourceId, workspaceId: config.workspaceId }) : null;
  function check(actor) {
    if (!config) fail('MEDUSA_APPROVED_SOURCE_UNCONFIGURED');
    if (actor?.workspaceId !== config.workspaceId || authorizeOriginal(actor) !== true) fail('MEDUSA_APPROVED_SOURCE_REVOKED');
    return true;
  }
  async function request(path, actor, signal) {
    check(actor); signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await fetchImpl(config.baseURL + path, { method: 'GET', redirect: 'error', cache: 'no-store', signal: bounded,
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + config.readToken } }); }
    catch { check(actor); fail('MEDUSA_APPROVED_SOURCE_UNAVAILABLE'); }
    check(actor); signal?.throwIfAborted();
    if (response.status === 404) { await response.body?.cancel().catch(() => {}); check(actor); return null; }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); check(actor); fail('MEDUSA_APPROVED_SOURCE_UNAVAILABLE'); }
    const reader = response.body?.getReader(); if (!reader) fail('MEDUSA_APPROVED_SOURCE_INVALID');
    const chunks = []; let bytes = 0;
    try {
      for (;;) { const row = await reader.read(); if (row.done) break; bytes += row.value.byteLength;
        if (bytes > 1024 * 1024) fail('MEDUSA_APPROVED_SOURCE_LIMIT'); chunks.push(row.value); }
    } catch (error) { if (error instanceof MedusaApprovedSourceError) throw error; fail('MEDUSA_APPROVED_SOURCE_UNAVAILABLE'); }
    finally { await reader.cancel().catch(() => {}); }
    check(actor); signal?.throwIfAborted();
    let json; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('MEDUSA_APPROVED_SOURCE_INVALID'); }
    const wire = JSON.stringify(json), secret = config.readToken;
    const recognized = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url'), Buffer.from(secret).toString('hex'), Buffer.from(secret).toString('hex').toUpperCase()];
    if (recognized.some(value => wire.includes(JSON.stringify(value).slice(1, -1)))) fail('MEDUSA_APPROVED_SOURCE_INVALID');
    if (json?.schema_version !== '1.0' || json.review_policy !== 'medusa-product-context-current-source-v1') fail('MEDUSA_APPROVED_SOURCE_INVALID');
    return json;
  }
  return Object.freeze({ binding, assertCurrent: check,
    async list(query, actor, signal) {
      const { q = '', offset = '0' } = query;
      if (typeof q !== 'string' || Buffer.byteLength(q) > 200 || typeof offset !== 'string' || !/^(0|[1-9][0-9]{0,3})$/u.test(offset)) fail('MEDUSA_APPROVED_SOURCE_INPUT');
      const payload = await request('/agent/product-contexts?limit=100', actor, signal);
      if (!payload || !Array.isArray(payload.items) || payload.items.length > 100 || payload.count !== payload.items.length) fail('MEDUSA_APPROVED_SOURCE_INVALID');
      const admitted = payload.items.map(row => projection(row, binding));
      if (new Set(admitted.map(row => row.reference.id)).size !== admitted.length) fail('MEDUSA_APPROVED_SOURCE_INVALID');
      const all = admitted.filter(row => row.title.toLocaleLowerCase().includes(q.toLocaleLowerCase())), start = Number(offset), end = start + 20;
      check(actor);
      return { items: all.slice(start, end), nextOffset: end < all.length ? String(end) : null,
        source: 'medusa-approved-context-v1', boundedRemoteItems: 100, checkedAt: new Date().toISOString(), modelAccess: false };
    },
    async read(id, actor, signal) {
      if (typeof id !== 'string' || !ID.test(id)) fail('MEDUSA_APPROVED_SOURCE_INPUT');
      const payload = await request('/agent/product-contexts/' + encodeURIComponent(id), actor, signal);
      if (!payload) return null;
      const result = projection(payload, binding);
      if (result.reference.id !== id) fail('MEDUSA_APPROVED_SOURCE_INVALID');
      check(actor); return result;
    },
  });
}
