import { ApiError } from './runtime.mjs';

/** Existing library transport shared by the original native conversation Host. */
export async function libraryHttp({ library, method, pathname, query = {}, body = {}, actor }) {
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
