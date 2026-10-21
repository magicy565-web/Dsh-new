// Reviewed Medusa source for the Product Library.
//
// The only remote read is the existing Product Context Agent surface:
//   GET /agent/product-contexts?limit=100
//   GET /agent/product-contexts/:productId
// It returns *approved* contexts only; the released projection is the fact
// boundary. This module owns no store, no model access and no write path.
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { ProductLibraryError } from './library.mjs';

const TOKEN = /^[\x21-\x7e]{16,4096}$/u;
const HASH = /^(?:[a-f0-9]{64}|rev:[a-f0-9]{32}:[a-f0-9]{64})$/u;
const PRODUCT_ID = /^prod_[A-Za-z0-9_-]{1,123}$/u;
const SOURCE_SCHEMA = '1.0';
const REVIEW_POLICY = 'medusa-product-context-current-source-v1';

function fail(status, code, message) { throw new ProductLibraryError(status, code, message); }

export function unconfiguredSource() {
  const denied = () => fail(503, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED', 'No reviewed Medusa product source is configured.');
  return Object.freeze({
    configured: false,
    kind: 'unconfigured',
    status: () => ({ configured: false, kind: 'unconfigured' }),
    list: denied,
    read: denied,
  });
}

export function validateSourceConfig(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.getPrototypeOf(source) !== Object.prototype)
    throw new TypeError('config.source must be one reviewed source object.');
  const allowed = ['kind', 'baseURL', 'readTokenFile', 'allowLoopbackHTTP', 'timeoutMs'];
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new TypeError('config.source has an unsupported field.');
  if (source.kind !== 'medusa-approved-context') throw new TypeError('config.source.kind must be medusa-approved-context.');
  if (typeof source.baseURL !== 'string' || typeof source.readTokenFile !== 'string'
    || !path.isAbsolute(source.readTokenFile)) throw new TypeError('config.source requires baseURL and an absolute readTokenFile.');
  if (source.allowLoopbackHTTP !== undefined && typeof source.allowLoopbackHTTP !== 'boolean')
    throw new TypeError('config.source.allowLoopbackHTTP must be a boolean.');
  if (source.timeoutMs !== undefined && (!Number.isInteger(source.timeoutMs) || source.timeoutMs < 50 || source.timeoutMs > 10000))
    throw new TypeError('config.source.timeoutMs must be an integer between 50 and 10000.');
  return Object.freeze({ ...source });
}

/** Read the dedicated token from a private operator file; never log its value. */
export async function readPrivateToken(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail(500, 'PRODUCT_LIBRARY_CONFIG', 'Use an absolute private token file.');
  let handle;
  try {
    handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 16 || stat.size > 4096) fail(500, 'PRODUCT_LIBRARY_CONFIG', 'The product read token file is invalid.');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || ![0, process.getuid()].includes(stat.uid)))
      fail(500, 'PRODUCT_LIBRARY_CONFIG', 'The product read token file must be private to its owner.');
    const bytes = await handle.readFile();
    const token = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!TOKEN.test(token)) fail(500, 'PRODUCT_LIBRARY_CONFIG', 'The product read token file is invalid.');
    return token;
  } catch (error) {
    if (error instanceof ProductLibraryError) throw error;
    fail(500, 'PRODUCT_LIBRARY_CONFIG', 'The product read token file could not be read.');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseOrigin(baseURL, allowLoopbackHTTP) {
  let url;
  try { url = new URL(baseURL); } catch { throw new TypeError('config.source.baseURL must be a valid origin.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.origin + '/' !== url.href || url.username || url.password
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && allowLoopbackHTTP === true))
    throw new TypeError('Use an exact HTTPS Medusa origin, or an explicitly allowed loopback HTTP origin.');
  return url.origin;
}

function assertRow(row) {
  const context = row?.context, product = row?.product;
  if (!context || typeof context !== 'object' || context.status !== 'approved'
    || !Number.isSafeInteger(context.review_version) || context.review_version < 1 || context.review_version > 2147483647
    || !HASH.test(context.source_hash ?? '') || !product || !PRODUCT_ID.test(product.id ?? '')
    || context.product_id !== product.id || typeof product.title !== 'string' || !product.title.trim())
    fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa source returned an invalid product context.');
  return row;
}

/**
 * @param {object} options
 * @param {string} options.baseURL exact Medusa origin
 * @param {string} options.readToken dedicated AGENT_CONTEXT_READ_TOKEN
 * @param {boolean} [options.allowLoopbackHTTP]
 * @param {number} [options.timeoutMs]
 * @param {(actor: object) => boolean} options.authorizeActor
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createMedusaProductContextSource({
  baseURL, readToken, allowLoopbackHTTP = false, timeoutMs = 5000, authorizeActor, fetchImpl = globalThis.fetch,
} = {}) {
  const origin = parseOrigin(baseURL, allowLoopbackHTTP);
  if (typeof readToken !== 'string' || !TOKEN.test(readToken)) throw new TypeError('A dedicated product read token is required.');
  if (typeof authorizeActor !== 'function') throw new TypeError('The reviewed source requires an actor authorization function.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw new TypeError('Use a bounded read timeout.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');

  function check(actor) {
    if (authorizeActor(actor) !== true) fail(403, 'PRODUCT_LIBRARY_SOURCE_UNAUTHORIZED', 'This harness actor cannot read the reviewed Medusa source.');
  }

  async function request(pathname, actor) {
    check(actor);
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(origin + pathname, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${readToken}` },
      });
    } catch {
      check(actor);
      fail(503, 'PRODUCT_LIBRARY_SOURCE_UNAVAILABLE', 'The reviewed Medusa source is unreachable.');
    }
    check(actor);
    if (response.status === 404) { await response.body?.cancel().catch(() => {}); return null; }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      fail(403, 'PRODUCT_LIBRARY_SOURCE_UNAUTHORIZED', 'The reviewed Medusa source rejected the dedicated read token.');
    }
    if (response.status === 503) {
      await response.body?.cancel().catch(() => {});
      fail(503, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED', 'The Product Context agent read surface is not configured on Medusa.');
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); fail(503, 'PRODUCT_LIBRARY_SOURCE_UNAVAILABLE', 'The reviewed Medusa source failed.'); }
    const reader = response.body?.getReader();
    if (!reader) fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa source returned no body.');
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024 * 1024) fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa response exceeds the 1 MiB bound.');
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof ProductLibraryError) throw error;
      fail(503, 'PRODUCT_LIBRARY_SOURCE_UNAVAILABLE', 'The reviewed Medusa response was interrupted.');
    } finally {
      await reader.cancel().catch(() => {});
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa response is not JSON.'); }
    const wire = JSON.stringify(payload);
    if (wire.includes(JSON.stringify(readToken).slice(1, -1))) fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa response echoed the read token.');
    if (payload?.schema_version !== SOURCE_SCHEMA || payload?.review_policy !== REVIEW_POLICY)
      fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa response does not match the reviewed contract.');
    check(actor);
    return payload;
  }

  return Object.freeze({
    configured: true,
    kind: 'medusa-approved-context',
    status: () => ({ configured: true, kind: 'medusa-approved-context', origin, timeoutMs }),
    async list(query = {}, actor) {
      const q = typeof query.q === 'string' ? query.q.slice(0, 200) : '';
      const payload = await request('/agent/product-contexts?limit=100', actor);
      if (!Array.isArray(payload.items) || payload.items.length > 100 || payload.count !== payload.items.length)
        fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa list is invalid.');
      const items = payload.items.map(assertRow).filter(row => !q || row.product.title.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
      return { items, source: 'medusa-approved-context', boundedRemoteItems: 100 };
    },
    async read(productId, actor) {
      if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use an exact Medusa product id.');
      const payload = await request(`/agent/product-contexts/${encodeURIComponent(productId)}`, actor);
      if (!payload) return null;
      const row = assertRow(payload);
      if (row.product.id !== productId) fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa detail does not match the requested product.');
      return { product: row.product, context: row.context };
    },
  });
}

/** Build one source from a validated config row; unconfigured stays explicit. */
export async function createSourceFromConfig(sourceConfig, { authorizeActor }) {
  if (sourceConfig === undefined || sourceConfig === null) return unconfiguredSource();
  const config = validateSourceConfig(sourceConfig);
  const readToken = await readPrivateToken(config.readTokenFile);
  return createMedusaProductContextSource({
    baseURL: config.baseURL,
    readToken,
    allowLoopbackHTTP: config.allowLoopbackHTTP === true,
    timeoutMs: config.timeoutMs ?? 5000,
    authorizeActor,
  });
}
