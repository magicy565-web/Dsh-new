import { CommerceError, assertKeys, fail } from './service.js';

export const API_PREFIX = '/commerce-network-api';
export const WORKER_PREFIX = '/commerce-worker-api';
const OWNER_COMMANDS = new Set(['create_project', 'upsert_party', 'register_agent', 'upsert_product', 'upsert_route', 'propose_order', 'propose_mandate', 'approve_mandate', 'revoke_mandate', 'approve_order', 'accept_delivery', 'reject_delivery', 'cancel_order', 'revoke_agent', 'issue_agent_credential', 'set_budget', 'revoke_grant', 'resolve_failed_order']);
const WORKER_ACTIONS = new Set(['connect', 'claim', 'heartbeat', 'status', 'deliver', 'stopped', 'resources']);

async function readJson(req, maximum = 256 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) fail('CONTENT_TYPE', 'Use application/json.', 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) fail('BODY_TOO_LARGE', 'Request exceeds the maximum JSON body size.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INPUT', 'Invalid JSON body.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INPUT', 'Expected a JSON object.');
  return value;
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) fail('ORIGIN_DENIED', 'Use the authenticated DSH page.', 403);
  let origin;
  try { origin = new URL(req.headers.origin); } catch { fail('ORIGIN_DENIED', 'A same-origin request is required.', 403); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) fail('ORIGIN_DENIED', 'Use the authenticated DSH page.', 403);
}
function send(res, status, value) {
  if (res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(value));
}
function report(res, error) {
  const known = error instanceof CommerceError || (error?.name === 'Error' && typeof error.code === 'string' && error.code.startsWith('RESOURCE_') && Number.isInteger(error.status));
  // Never log the request/body/Bearer credential or unknown exception details.
  send(res, known ? error.status : 500, { ok: false, error: { code: known ? error.code : 'INTERNAL', message: known ? error.message : 'Operation failed. Refresh the current records before retrying.' } });
}

export function createHttpHandler(service, { authorize } = {}) {
  return async (req, res) => {
    try {
      let rejection = 401;
      try { if (authorize) rejection = await authorize({ headers: req.headers }); } catch { /* fail closed */ }
      if (!authorize || rejection) fail('UNAUTHORIZED', 'Use an authenticated native DSH browser session.', rejection === 403 ? 403 : 401);
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.slice(API_PREFIX.length);
      if (!url.pathname.startsWith(`${API_PREFIX}/`)) fail('NOT_FOUND', 'Unknown commerce route.', 404);
      let data;
      if (req.method === 'GET' && path === '/workspace') {
        if ([...url.searchParams.keys()].some(k => !['sessionId', 'projectId'].includes(k))) fail('INPUT', 'Unsupported query fields.');
        data = await service.state(url.searchParams.get('sessionId'), url.searchParams.get('projectId') || undefined);
      } else if (req.method === 'GET' && path === '/review') {
        if ([...url.searchParams.keys()].some(k => !['sessionId', 'projectId', 'orderId'].includes(k))) fail('INPUT', 'Unsupported query fields.');
        data = await service.review(url.searchParams.get('sessionId'), url.searchParams.get('projectId'), url.searchParams.get('orderId'));
      } else if (req.method === 'GET' && path === '/delivery') {
        if ([...url.searchParams.keys()].some(k => !['sessionId', 'projectId', 'deliveryId'].includes(k))) fail('INPUT', 'Unsupported query fields.');
        data = await service.delivery(url.searchParams.get('sessionId'), url.searchParams.get('projectId'), url.searchParams.get('deliveryId'));
      } else if (req.method === 'POST' && path === '/command') {
        sameOrigin(req); const body = await readJson(req);
        assertKeys(body, ['sessionId', 'projectId', 'expectedRevision', 'requestId', 'command', 'payload']);
        if (!OWNER_COMMANDS.has(body.command)) fail('COMMAND_DENIED', 'This command is not available to the browser.', 403);
        const { sessionId, ...input } = body; data = await service.command(sessionId, input);
      } else if (req.method === 'POST' && path === '/layout') {
        sameOrigin(req); const body = await readJson(req);
        assertKeys(body, ['sessionId', 'projectId', 'expectedLayoutRevision', 'requestId', 'nodes', 'viewport']);
        const { sessionId, ...input } = body; data = await service.layout(sessionId, input);
      } else fail('NOT_FOUND', 'Unknown commerce route.', 404);
      send(res, 200, { ok: true, data });
    } catch (error) { report(res, error); }
  };
}

export function createWorkerHandler(service, { allowRemoteWorkerHttp = false } = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(`${WORKER_PREFIX}/`) || url.search) fail('NOT_FOUND', 'Unknown worker route.', 404);
      const action = url.pathname.slice(WORKER_PREFIX.length + 1);
      if (req.method !== 'POST' || !WORKER_ACTIONS.has(action)) fail('NOT_FOUND', 'Unknown worker action.', 404);
      // DSH's web server is normally loopback HTTP. Public deployments terminate
      // TLS before the host and must explicitly enable this trusted ingress.
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
      if (!loopback && !req.socket?.encrypted && !allowRemoteWorkerHttp) fail('TLS_REQUIRED', 'External worker ingress requires trusted TLS configuration.', 403);
      if (req.headers.origin || req.headers['sec-fetch-site']) fail('WORKER_BROWSER_DENIED', 'Worker credentials are for service clients, not browser pages.', 403);
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) fail('WORKER_UNAUTHORIZED', 'A scoped worker credential is required.', 401);
      const body = await readJson(req);
      const data = await service.worker(authorization.slice(7), action, body);
      send(res, 200, { ok: true, data });
    } catch (error) { report(res, error); }
  };
}
