import { ApiError } from './runtime.mjs';

/** Existing library transport shared by the original native conversation Host. */
export async function libraryHttp({ library, disclosure = null, memory = null, method, pathname, query = {}, body = {}, actor }) {
  const adminOnly = () => { if (actor?.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'An administrator role is required for customer disclosure policy management.'); };
  if (memory) {
    const memoryMatch = pathname.match(/^\/api\/library\/memory\/([a-f0-9-]{36})(?:\/(history|revoke))?$/u);
    if (method === 'GET' && pathname === '/api/library/memory/status') { adminOnly(); return { status: 200, body: memory.status() }; }
    if (method === 'GET' && pathname === '/api/library/memory') { adminOnly(); return { status: 200, body: memory.list({ customerId: query.customerId ?? null, audience: query.audience }, actor) }; }
    if (method === 'GET' && memoryMatch && !memoryMatch[2]) { if (actor?.role !== 'admin' && actor?.role !== 'operator') throw new ApiError(403, 'ROLE_REQUIRED', 'A workspace member role is required to read enterprise memory.'); return { status: 200, body: await memory.read(memoryMatch[1], { actor, customerId: query.customerId ?? null }) }; }
    if (method === 'GET' && memoryMatch?.[2] === 'history') { adminOnly(); return { status: 200, body: memory.history(memoryMatch[1], actor) }; }
    if (method === 'POST' && pathname === '/api/library/memory') { return { status: 201, body: await memory.remember(body, actor) }; }
    if (method === 'POST' && memoryMatch?.[2] === 'revoke') { return { status: 200, body: await memory.revoke(memoryMatch[1], body, actor) }; }
  }
  if (disclosure) {
    const grantMatch = pathname.match(/^\/api\/library\/disclosure\/grants\/([a-f0-9-]{36})\/revoke$/u);
    const explainMatch = pathname.match(/^\/api\/library\/disclosure\/resources\/(products|documents)\/([^/]+)$/u);
    if (method === 'GET' && pathname === '/api/library/disclosure/status') { adminOnly(); return { status: 200, body: disclosure.status() }; }
    if (method === 'GET' && pathname === '/api/library/disclosure/grants') { adminOnly(); return { status: 200, body: disclosure.list({ customerId: query.customerId, resourceType: query.resourceType, status: query.status }) }; }
    if (method === 'GET' && explainMatch) { adminOnly(); return { status: 200, body: disclosure.explain({ customerId: query.customerId, resourceType: explainMatch[1] === 'products' ? 'product' : 'document', resourceId: explainMatch[2] }) }; }
    if (method === 'POST' && pathname === '/api/library/disclosure/grants') { return { status: 201, body: await disclosure.grant(body, actor) }; }
    if (method === 'POST' && grantMatch) { return { status: 200, body: await disclosure.revoke(grantMatch[1], body, actor) }; }
  }
  const reference = pathname.match(/^\/api\/conversations\/([^/]+)\/library-references$/);
  if (reference) { try { reference[1] = decodeURIComponent(reference[1]); } catch { throw new ApiError(400, 'INVALID_PATH', 'Invalid conversation identifier.'); } }
  if (reference && actor.nativeAgentId && reference[1] !== actor.nativeAgentId) throw new ApiError(404, 'NOT_FOUND', 'Use the original owned conversation.');
  if (method === 'GET') {
    if (reference) return { status: 200, body: await library.getConversationReferences(reference[1]) };
    if (pathname === '/api/library/company') return { status: 200, body: await library.getCompany() };
    if (['/api/library/products', '/api/library/documents'].includes(pathname)) return { status: 200, body: await library[pathname.endsWith('/products') ? 'listProducts' : 'listDocuments'](query) };
    const resource = pathname.match(/^\/api\/library\/(products|documents|operations)\/([^/]+)(?:\/(readiness))?$/);
    if (resource && (!resource[3] || resource[1] === 'products')) return { status: 200, body: await library[resource[3] ? 'readiness' : { products: 'getProduct', documents: 'getDocument', operations: 'getOperation' }[resource[1]]](resource[2]) };
  }
  if (['PATCH', 'POST'].includes(method) && reference) return { status: 200, body: await library.updateConversationReferences(reference[1], body, actor) };
  if (method === 'PATCH' && pathname === '/api/library/company') return { status: 200, body: await library.updateCompany(body, actor) };
  if (method === 'POST' && ['/api/library/products', '/api/library/documents'].includes(pathname)) return { status: 201, body: await library[pathname.endsWith('/products') ? 'createProduct' : 'createDocument'](body, actor) };
  const resource = pathname.match(/^\/api\/library\/(products|documents)\/([^/]+)(?:\/(versions)(?:\/([1-9][0-9]*)\/(reviews))?)?$/);
  if (resource) {
    if (method === 'PATCH' && !resource[3]) return { status: 200, body: await library[resource[1] === 'products' ? 'updateProduct' : 'updateDocument'](resource[2], body, actor) };
    if (method === 'POST' && resource[1] === 'documents' && resource[3]) return { status: 201, body: resource[5] ? await library.reviewDocument(resource[2], Number(resource[4]), body, actor) : await library.appendDocumentVersion(resource[2], body, actor) };
  }
  return null;
}
