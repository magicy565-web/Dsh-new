import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class WorkspaceTuiError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new WorkspaceTuiError(code); };
const segment = value => encodeURIComponent(value);
const same = (a, b) => a?.workspaceId === b?.workspaceId && a?.subject === b?.subject && a?.conversationId === b?.conversationId;

// This is a client adapter, not a credential provider or an ingress signer.
// A host adapter must use its ALREADY authorized owner session on each request.
export async function loadOwnerTransport(environment = process.env) {
  if (environment.WORKSPACE_PI_OWNER_TRANSPORT) {
    const filename = environment.WORKSPACE_PI_OWNER_TRANSPORT;
    if (!path.isAbsolute(filename)) fail('OWNER_TRANSPORT_ABSOLUTE_PATH_REQUIRED');
    const adapter = await import(pathToFileURL(filename).href);
    if (typeof adapter.request !== 'function') fail('OWNER_TRANSPORT_REQUEST_REQUIRED');
    return adapter.request;
  }
  const supplied = environment.WORKSPACE_PI_LOCAL_URL;
  if (!supplied) fail('EXISTING_OWNER_TRANSPORT_REQUIRED');
  const url = new URL(supplied);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('LOCAL_LOOPBACK_URL_REQUIRED');
  return async ({ method, path: target, body, signal }) => {
    const response = await fetch(new URL(target, url), {
      method, signal, redirect: 'error',
      headers: { Origin: url.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
}

export function createWorkspaceClient(request) {
  let pinned;
  async function api(method, target, body) {
    let response;
    try { response = await request({ method, path: target, body, signal: AbortSignal.timeout(15000) }); }
    catch { fail(method === 'GET' ? 'OWNER_TRANSPORT_UNAVAILABLE' : 'RESULT_UNKNOWN_READ_OR_RETRY_SAME_REQUEST'); }
    if (!response || response.status < 200 || response.status >= 300) {
      const code = response?.body?.error?.code;
      fail(typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'OWNER_REQUEST_REJECTED');
    }
    return response.body;
  }
  async function connect() {
    const session = await api('GET', '/api/session');
    if (session?.authenticated !== true || session.user?.role !== 'admin') fail('EXISTING_OWNER_SESSION_REQUIRED');
    const bootstrap = await api('GET', '/api/bootstrap');
    if (bootstrap?.museBinding?.originalBinding !== true || !bootstrap.museBinding.conversationId) fail('MW_ORIGINAL_BINDING_REQUIRED');
    const current = { workspaceId: session.workspaceId, subject: session.user.id, conversationId: bootstrap.museBinding.conversationId };
    if (pinned && !same(pinned, current)) fail('OWNER_SCOPE_CHANGED');
    pinned = Object.freeze(current);
    return { ...current, onlineVerified: false };
  }
  async function base(expected) {
    await connect();
    if (expected && !same(pinned, expected)) fail('OWNER_SCOPE_CHANGED');
    return `/api/conversations/${segment(pinned.conversationId)}/muse-delegations`;
  }
  return Object.freeze({
    connect,
    async list() { return api('GET', await base()); },
    async get(orderId) { return api('GET', `${await base()}/${segment(orderId)}`); },
    async prepare(pending) {
      const route = await base(pending.scope);
      if (pending.input?.provider !== 'muse' || pending.input.conversationId !== pinned.conversationId) fail('OWNER_SCOPE_CHANGED');
      return api('POST', route, pending.input);
    },
    async act(operation, orderId, review) {
      if (!['approve', 'dispatch', 'refresh', 'cancel', 'accept'].includes(operation)) fail('OPERATION_FORBIDDEN');
      return api('POST', `${await base()}/${segment(orderId)}/${operation}`, operation === 'refresh' ? {} : review);
    },
  });
}
