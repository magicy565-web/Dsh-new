// Client for the harness business-memory service.
//
// Topology B: the Harness owns business memory; this application is a client.
// The client never holds memory state, never composes a context block itself
// and never falls back to local facts when the service is unavailable — the
// caller decides whether to continue without memory, and the run records that
// decision as a warning.
import { open, constants as fsConstants } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const TOKEN = /^[A-Za-z0-9._~+/=-]{32,256}$/u;

export class BusinessMemoryClientError extends Error {
  constructor(code, message, { status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BusinessMemoryClientError';
    this.code = code;
    this.status = status;
  }
}

function parseOrigin(baseURL) {
  let url;
  try { url = new URL(baseURL); } catch { throw new TypeError('business memory baseURL must be a valid origin.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.origin + '/' !== url.href || url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)))
    throw new TypeError('business memory baseURL must be HTTPS, or plain HTTP on loopback only.');
  return url.origin;
}

async function readToken(filename) {
  if (typeof filename !== 'string' || !isAbsolute(filename))
    throw new BusinessMemoryClientError('BUSINESS_MEMORY_CLIENT_CONFIG', 'Use an absolute service token file.');
  let handle;
  try {
    handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 16 || stat.size > 4096)
      throw new BusinessMemoryClientError('BUSINESS_MEMORY_CLIENT_CONFIG', 'The service token file is invalid.');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || ![0, process.getuid()].includes(stat.uid)))
      throw new BusinessMemoryClientError('BUSINESS_MEMORY_CLIENT_CONFIG', 'The service token file must be private to its owner.');
    const token = new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile()).trim();
    if (!TOKEN.test(token))
      throw new BusinessMemoryClientError('BUSINESS_MEMORY_CLIENT_CONFIG', 'The service token file is invalid.');
    return token;
  } catch (error) {
    if (error instanceof BusinessMemoryClientError) throw error;
    throw new BusinessMemoryClientError('BUSINESS_MEMORY_UNAUTHORIZED', 'The service token file could not be read.', { cause: error });
  } finally {
    await handle?.close().catch(() => {});
  }
}

function statusCode(status) {
  if (status === 401) return 'BUSINESS_MEMORY_UNAUTHORIZED';
  if (status === 503) return 'BUSINESS_MEMORY_UNAVAILABLE';
  if (status === 400 || status === 409) return 'BUSINESS_MEMORY_INVALID';
  return 'BUSINESS_MEMORY_FAILED';
}

/**
 * @param {{baseURL:string, tokenFile:string, workspaceId?:string, timeoutMs?:number, fetchImpl?:Function}} options
 */
export function createBusinessMemoryClient({
  baseURL, tokenFile, workspaceId = 'local', timeoutMs = 2000, fetchImpl = globalThis.fetch,
} = {}) {
  const origin = parseOrigin(baseURL);
  if (typeof tokenFile !== 'string' || !isAbsolute(tokenFile))
    throw new TypeError('business memory requires an absolute token file.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000)
    throw new TypeError('business memory timeoutMs must be an integer between 50 and 30000.');
  if (typeof fetchImpl !== 'function') throw new TypeError('business memory requires fetch.');

  async function call(path, payload) {
    const token = await readToken(tokenFile);
    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new BusinessMemoryClientError(
        'BUSINESS_MEMORY_UNAVAILABLE',
        timedOut ? 'The business memory service timed out.' : 'The business memory service could not be reached.',
        { cause: error },
      );
    }
    let text;
    try { text = await response.text(); } catch (error) {
      throw new BusinessMemoryClientError('BUSINESS_MEMORY_UNAVAILABLE', 'The business memory response could not be read.', { cause: error });
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES)
      throw new BusinessMemoryClientError('BUSINESS_MEMORY_INVALID', 'The business memory service returned an oversized response.', { status: response.status });
    let payloadValue = null;
    try { payloadValue = text ? JSON.parse(text) : null; } catch {
      throw new BusinessMemoryClientError('BUSINESS_MEMORY_INVALID', 'The business memory service returned non-JSON data.', { status: response.status });
    }
    if (!response.ok) {
      const code = typeof payloadValue?.error?.code === 'string' ? payloadValue.error.code : statusCode(response.status);
      const message = typeof payloadValue?.error?.message === 'string' ? payloadValue.error.message : 'The business memory service refused the request.';
      throw new BusinessMemoryClientError(code, message, { status: response.status });
    }
    return payloadValue;
  }

  return Object.freeze({
    origin,
    workspaceId,

    /** Compile the bounded, cited memory block for one task run. */
    async compile({ taskId, sessionId = null, query = '', refs = [], budgetChars = 2400, maxItems = 24 } = {}) {
      if (typeof taskId !== 'string' || !taskId) throw new TypeError('compile requires a task id.');
      return call('/api/business-memory/service/context', {
        taskId, sessionId, query, refs, budgetChars, maxItems,
      });
    },

    /** Recheck the exact facts a run already saw, immediately before dispatch. */
    async verify({ ids } = {}) {
      if (!Array.isArray(ids)) throw new TypeError('verify requires an array of memory ids.');
      return call('/api/business-memory/service/verify', { ids });
    },
  });
}
