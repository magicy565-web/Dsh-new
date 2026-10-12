/** The same service/API contract on the existing app and original native Host. */
import { ApiError } from './runtime.mjs';

export async function supplyHttp({ supply, method, pathname, body = {}, query = {}, actor }) {
  if (method === 'GET') {
    const read = { '/api/supply/status': 'status', '/api/supply/suppliers': 'suppliers', '/api/supply/listings': 'listings', '/api/supply/inquiries': 'inquiries', '/api/supply/events': 'events', '/api/supply/shopify/observation': 'shopifyObservation' }[pathname];
    if (read) return { status: 200, body: await supply[read](actor) };
    if (pathname === '/api/supply/public') return { status: 200, body: await supply.searchPublic({ query: query.q || '' }) };
    const inquiry = pathname.match(/^\/api\/supply\/inquiries\/([^/]+)(?:\/(review))?$/);
    if (inquiry) return { status: 200, body: await supply[inquiry[2] ? 'reviewInquiry' : 'inquiry'](inquiry[1], actor) };
    const conversation = pathname.match(/^\/api\/conversations\/([^/]+)\/procurement$/);
    if (conversation) {
      let conversationId;
      try { conversationId = decodeURIComponent(conversation[1]); }
      catch { throw new ApiError(400, 'INVALID_PATH', 'Invalid API identifier encoding.'); }
      return { status: 200, body: await supply.conversationInquiries(conversationId, actor) };
    }
  }
  if (method === 'POST') {
    const create = { '/api/supply/suppliers': 'createSupplier', '/api/supply/listings': 'createListing', '/api/supply/inquiries': 'createInquiry' }[pathname];
    if (create) return { status: 201, body: await supply[create](body, actor) };
    const inquiry = pathname.match(/^\/api\/supply\/inquiries\/([^/]+)\/(share|revoke|reply|conversation)$/);
    if (inquiry) return { status: 200, body: await supply[({ share: 'shareInquiry', revoke: 'revokeInquiry', reply: 'replyInquiry', conversation: 'attachInquiry' })[inquiry[2]]](inquiry[1], body, actor) };
    const binding = pathname.match(/^\/api\/supply\/(suppliers|listings)\/([^/]+)\/(merchant|product|publish|unpublish)$/);
    if (binding) {
      const name = binding[3] === 'merchant' && binding[1] === 'suppliers' ? 'bindMerchant' : binding[3] === 'product' && binding[1] === 'listings' ? 'linkProduct' : ['publish', 'unpublish'].includes(binding[3]) ? binding[3] + (binding[1] === 'suppliers' ? 'Supplier' : 'Listing') : null;
      if (name) return { status: 200, body: await supply[name](binding[2], body, actor) };
    }
  }
  const listing = pathname.match(/^\/api\/supply\/listings\/([^/]+)$/);
  if (method === 'PATCH' && listing) return { status: 200, body: await supply.updateListing(listing[1], body, actor) };
  return null;
}
