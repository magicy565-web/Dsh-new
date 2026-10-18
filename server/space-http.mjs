import { SpaceError } from './space-core.mjs';
const base = '/api/library/spaces';
const methods = new Set(['GET', 'POST']);
const reject = (status, code, message) => { throw new SpaceError(status, code, message); };

/** Inert dispatcher; context MUST come from the original access.begin request. */
export async function spaceHttp({ service, context, pathname, method, query = {}, body = {} }) {
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  if (!service) reject(503, 'SPACE_UNCONFIGURED', 'Space is not configured on this Host.');
  if (!methods.has(method)) reject(405, 'SPACE_METHOD', 'Use the documented GET or POST operation.');
  if (method !== 'GET' && Object.keys(query).length) reject(400, 'SPACE_QUERY', 'Mutation query parameters are not supported.');
  const parts = pathname.slice(base.length).split('/').filter(Boolean);
  if (parts.length === 0) {
    if (Object.keys(query).length) reject(400, 'SPACE_QUERY', 'Unknown list query.');
    return method === 'GET' ? service.list(context) : service.create(context, body);
  }
  if (parts.length === 2 && parts[0] === 'operations' && method === 'GET') {
    if (Object.keys(query).length) reject(400, 'SPACE_QUERY', 'Unknown operation query.');
    return service.operation(context, parts[1]);
  }
  const [spaceId, collection, nodeId, action] = parts;
  if (parts.length === 1 && method === 'GET') {
    if (Object.keys(query).length) reject(400, 'SPACE_QUERY', 'Unknown Space query.');
    return service.read(context, spaceId);
  }
  if (parts.length === 2 && collection === 'sources' && method === 'GET') return service.sources(context, spaceId, query);
  if (parts.length === 2 && method === 'POST') {
    if (collection === 'nodes') return service.createNode(context, spaceId, body);
    if (collection === 'share') return service.share(context, spaceId, body);
    if (collection === 'revoke') return service.revoke(context, spaceId, body);
  }
  if (parts.length === 3 && collection === 'nodes' && method === 'GET') {
    if (Object.keys(query).some(key => key !== 'version') || query.version !== undefined && !/^[1-9][0-9]{0,2}$/u.test(query.version)) reject(400, 'SPACE_QUERY', 'Use a bounded page version.');
    return service.page(context, spaceId, nodeId, query.version === undefined ? null : Number(query.version));
  }
  if (parts.length === 4 && collection === 'nodes' && method === 'POST') {
    const handlers = { save: 'savePage', restore: 'restorePage', move: 'moveNode', archive: 'archiveNode', comments: 'comment' };
    if (Object.hasOwn(handlers, action)) return service[handlers[action]](context, spaceId, nodeId, body);
  }
  reject(404, 'SPACE_ROUTE', 'No such Space operation.');
}

/**
 * Original Host adapter, not a separate listener or authentication service.
 * Run after access.begin AND the original Muse/Agent privacy guards. The
 * original JSON reader retains body limits; access verifies signed bytes/CSRF.
 * Failures are passed to the Host's error response callback, never swallowed.
 */
export async function handleSpaceHttp({ service, req, res, pathname, context, access, readBody, guardBody = null }) {
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
  if (!access || typeof access.verifyBody !== 'function' || typeof readBody !== 'function' || !context?.session?.id) reject(503, 'SPACE_ORIGINAL_HOST_REQUIRED', 'Use the original signed enterprise Host.');
  const url = new URL(req.url, 'http://localhost'), query = Object.fromEntries(url.searchParams);
  if ([...url.searchParams.keys()].length !== Object.keys(query).length) reject(400, 'SPACE_QUERY', 'Duplicate query parameters are not accepted.');
  let body = {};
  if (req.method === 'POST') {
    body = await readBody(req, 100000);
    if (!Buffer.isBuffer(req.bodyBytes)) reject(400, 'SPACE_BODY_PROOF_REQUIRED', 'The original bounded JSON reader must preserve exact request bytes.');
    access.verifyBody(context, req.bodyBytes);
    guardBody?.(body);
  }
  const result = await spaceHttp({ service, context, pathname, method: req.method, query, body });
  // Existing privacy projections run first; undefined is a refusal, not null.
  const filtered = res.filterWorkspaceResponse ? res.filterWorkspaceResponse(result.body) : result.body;
  if (filtered === undefined) reject(404, 'SPACE_NOT_FOUND', 'The response is outside this original binding.');
  const wire = JSON.stringify(filtered);
  await res.accessFinish?.(result.status);
  // No await, callback, model serializer or file read between this current
  // authorization/revision check and the final response writes.
  try { result.assertCurrent(); }
  catch (error) {
    const refusal = req.method === 'POST' && error instanceof SpaceError && error.code === 'SPACE_REVISION_CONFLICT'
      ? new SpaceError(409, 'SPACE_RESPONSE_CHANGED', 'The write may already be committed. Reconcile by reusing the same requestId before editing.') : error;
    // The original append-only request.finished may precede this refusal. Record
    // its correction before the error response; never leave only a success row.
    await access.recordDeliveryRefusal?.(context, refusal);
    throw refusal;
  }
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(wire);
  return true;
}
