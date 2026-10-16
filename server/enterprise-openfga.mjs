import { createHash } from 'node:crypto';

export const DISCLOSURE_LEVELS = Object.freeze({ public: 10, qualified: 20, commercial: 30, channel: 40, confidential: 50 });
export const DISCLOSURE_LEVEL_NAMES = Object.freeze(Object.keys(DISCLOSURE_LEVELS));
export const DISCLOSURE_MODEL = `model
  schema 1.1

  type customer

  type product
    relations
      define public_reader: [customer]
      define qualified_reader: [customer]
      define commercial_reader: [customer]
      define channel_reader: [customer]
      define confidential_reader: [customer]
      define can_read_public: public_reader or qualified_reader or commercial_reader or channel_reader or confidential_reader
      define can_read_qualified: qualified_reader or commercial_reader or channel_reader or confidential_reader
      define can_read_commercial: commercial_reader or channel_reader or confidential_reader
      define can_read_channel: channel_reader or confidential_reader
      define can_read_confidential: confidential_reader

  type memory
    relations
      define public_reader: [customer]
      define qualified_reader: [customer]
      define commercial_reader: [customer]
      define channel_reader: [customer]
      define confidential_reader: [customer]
      define can_read_public: public_reader or qualified_reader or commercial_reader or channel_reader or confidential_reader
      define can_read_qualified: qualified_reader or commercial_reader or channel_reader or confidential_reader
      define can_read_commercial: commercial_reader or channel_reader or confidential_reader
      define can_read_channel: channel_reader or confidential_reader
      define can_read_confidential: confidential_reader

  type document
    relations
      define public_reader: [customer]
      define qualified_reader: [customer]
      define commercial_reader: [customer]
      define channel_reader: [customer]
      define confidential_reader: [customer]
      define can_read_public: public_reader or qualified_reader or commercial_reader or channel_reader or confidential_reader
      define can_read_qualified: qualified_reader or commercial_reader or channel_reader or confidential_reader
      define can_read_commercial: commercial_reader or channel_reader or confidential_reader
      define can_read_channel: channel_reader or confidential_reader
      define can_read_confidential: confidential_reader
`;

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9._@:+|/-]{1,191}$/u.test(value);
const opaque = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function safeOrigin(value) {
  if (typeof value !== 'string' || !value) fail('FGA_URL_REQUIRED');
  let parsed;
  try { parsed = new URL(value); } catch { fail('FGA_URL_INVALID'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' && parsed.pathname !== ''
    || !(parsed.protocol === 'https:' || parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname))) fail('FGA_URL_UNSAFE');
  return parsed.origin;
}

export function customerPrincipal(workspaceId, customerId) {
  if (!safeId(workspaceId) || !safeId(customerId)) fail('FGA_PRINCIPAL_INVALID');
  return `customer:${opaque([workspaceId, customerId])}`;
}
export function resourceObject(resourceType, workspaceId, resourceId) {
  if (!['product', 'document', 'memory'].includes(resourceType) || !safeId(workspaceId) || !safeId(resourceId)) fail('FGA_RESOURCE_INVALID');
  return `${resourceType}:${opaque([workspaceId, resourceId])}`;
}
export function relationForLevel(level) {
  if (!Object.hasOwn(DISCLOSURE_LEVELS, level)) fail('FGA_LEVEL_INVALID');
  return `${level}_reader`;
}
export function readRelationForLevel(level) {
  if (!Object.hasOwn(DISCLOSURE_LEVELS, level)) fail('FGA_LEVEL_INVALID');
  return `can_read_${level}`;
}

async function readJson(response, max = 2 * 1024 * 1024) {
  const text = await response.text();
  if (text.length > max) fail('FGA_RESPONSE_TOO_LARGE');
  try { return text ? JSON.parse(text) : {}; } catch { fail('FGA_RESPONSE_INVALID'); }
}

export function createOpenFgaClient({ baseURL, storeId, authorizationModelId, apiToken, fetchImpl = globalThis.fetch } = {}) {
  const base = safeOrigin(baseURL);
  if (!safeId(storeId) || !safeId(authorizationModelId) || typeof fetchImpl !== 'function') fail('FGA_CONFIGURATION_REQUIRED');
  if (typeof apiToken !== 'string' || !apiToken || /[\r\n]/u.test(apiToken)) fail('FGA_TOKEN_REQUIRED');

  async function request(pathname, body, signal) {
    const timeout = AbortSignal.timeout(30000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify(body), redirect: 'error', signal: combined,
      });
    } catch { combined.throwIfAborted(); fail('FGA_UNAVAILABLE'); }
    if (!response.ok || response.redirected) fail('FGA_UPSTREAM_REFUSED');
    return readJson(response);
  }

  return Object.freeze({
    async check({ user, relation, object: resource, context = undefined }, signal) {
      if (!safeId(user) || !safeId(relation) || !safeId(resource)) fail('FGA_CHECK_INVALID');
      const result = await request(`/stores/${encodeURIComponent(storeId)}/check`, {
        tuple_key: { user, relation, object: resource }, authorization_model_id: authorizationModelId,
        ...(context === undefined ? {} : { context }), consistency: 'HIGHER_CONSISTENCY',
      }, signal);
      if (typeof result.allowed !== 'boolean') fail('FGA_CHECK_RESPONSE_INVALID');
      return result.allowed;
    },
    async write({ writes = [], deletes = [] }, signal) {
      if (!Array.isArray(writes) || !Array.isArray(deletes) || writes.length > 100 || deletes.length > 100) fail('FGA_WRITE_INVALID');
      const normalize = row => row && typeof row === 'object' && safeId(row.user) && safeId(row.relation) && safeId(row.object)
        ? { user: row.user, relation: row.relation, object: row.object } : null;
      const ws = writes.map(normalize), ds = deletes.map(normalize);
      if (ws.some(v => !v) || ds.some(v => !v)) fail('FGA_WRITE_INVALID');
      return request(`/stores/${encodeURIComponent(storeId)}/write`, {
        authorization_model_id: authorizationModelId,
        ...(ws.length ? { writes: { tuple_keys: ws, on_duplicate: 'ignore' } } : {}),
        ...(ds.length ? { deletes: { tuple_keys: ds, on_missing: 'ignore' } } : {}),
      }, signal);
    },
    status: () => ({ provider: 'OpenFGA', enabled: true, storeId, authorizationModelId, modelSha256: sha256(DISCLOSURE_MODEL) }),
  });
}
