export class OwnerSessionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new OwnerSessionError(code); };
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));

export function validateOwnerHandoff(input) {
  if (!keys(input, ['origin', 'token', 'scope']) || !keys(input.scope, ['workspaceId', 'subject', 'conversationId']) ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.token || '') ||
      !['workspaceId', 'subject', 'conversationId'].every(key => typeof input.scope[key] === 'string' && input.scope[key].length > 0 && input.scope[key].length <= 128)) fail('OWNER_SESSION_HANDOFF_INVALID');
  let url;
  try { url = new URL(input.origin); } catch { fail('OWNER_HTTPS_ORIGIN_REQUIRED'); }
  if (url.protocol !== 'https:' || url.origin !== input.origin || url.username || url.password || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('OWNER_HTTPS_ORIGIN_REQUIRED');
  return { origin: url.origin, token: input.token, scope: { ...input.scope } };
}

async function jsonResponse(response) {
  if (!response || !Number.isInteger(response.status) || response.redirected || response.status >= 300 && response.status < 400) fail('OWNER_INGRESS_REDIRECT_REJECTED');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail('OWNER_INGRESS_JSON_REQUIRED');
  if (response.status === 202) return { status: 202, body: null }; // MCP initialized notification has no body.
  const chunks = []; let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > 16_777_216) fail('OWNER_RESPONSE_TOO_LARGE');
    chunks.push(bytes);
  }
  try { return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
  catch { fail('OWNER_INGRESS_JSON_REQUIRED'); }
}

export function createNativeOwnerTransport(input, { fetchImpl = fetch } = {}) {
  const handoff = validateOwnerHandoff(input);
  const base = `/api/conversations/${encodeURIComponent(handoff.scope.conversationId)}/muse-delegations`;
  const supplierMcp = `/api/conversations/${encodeURIComponent(handoff.scope.conversationId)}/supplier-session-mcp`;
  const orderPath = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}');
  async function send(method, target, body, signal, csrf) {
    const response = await fetchImpl(handoff.origin + target, {
      method, signal: signal || AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit',
      headers: { Accept: 'application/json', Origin: handoff.origin, 'X-Workspace-Session': handoff.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return jsonResponse(response);
  }
  async function session(signal) {
    const response = await send('GET', '/api/session', undefined, signal);
    if (response.status === 401) fail('OWNER_SESSION_EXPIRED');
    if (response.status !== 200) return response;
    const value = response.body;
    if (value?.authenticated !== true) fail('OWNER_SESSION_EXPIRED');
    if (value.mode !== 'enterprise' || value.workspaceId !== handoff.scope.workspaceId || value.user?.id !== handoff.scope.subject || value.user?.role !== 'admin') fail('OWNER_SESSION_IDENTITY_MISMATCH');
    return response;
  }
  return async ({ method, path: target, body, signal }) => {
    const match = target?.match(orderPath)?.[0];
    const read = method === 'GET' && body === undefined && (['/api/session', '/api/bootstrap', '/api/muse-workers', base].includes(target) || match === target);
    const write = method === 'POST' && (target === supplierMcp || target === base || match && ['approve', 'dispatch', 'refresh', 'cancel', 'accept'].some(op => target === match + '/' + op));
    if (!read && !write) fail('OWNER_ROUTE_FORBIDDEN');
    const actual = await session(signal);
    if (actual.status !== 200 || target === '/api/session') return actual;
    if (write && !/^[A-Za-z0-9_-]{43}$/.test(actual.body.csrfToken || '')) fail('OWNER_CSRF_REQUIRED');
    const result = await send(method, target, body, signal, actual.body.csrfToken);
    if (target === '/api/bootstrap' && result.status === 200 && (result.body.museBinding?.originalBinding !== true || result.body.museBinding.conversationId !== handoff.scope.conversationId)) fail('OWNER_ORIGINAL_CONVERSATION_MISMATCH');
    return result;
  };
}
