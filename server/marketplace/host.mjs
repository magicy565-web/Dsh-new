import {createMarketplaceModelHost} from './model-host.mjs';
import { createMarketplace } from './service.mjs';
import { MarketplaceError, authorize, object, requireThat as check } from './contracts.mjs';

export const MARKETPLACE_BUYER_PATH = '/api/worker-orders/marketplace';
export const MARKETPLACE_PROVIDER_PATH = '/api/marketplace-provider/v1';
const WEBHOOK = '/api/marketplace-payments/stripe';
const installed = new WeakSet();
const isUnder = (path, base) => path === base || path.startsWith(base + '/');
const empty = input => object(input, []);
async function rawBody(req, limit = 64_000) {
  check(Number(req.headers['content-length'] || 0) <= limit, 'BODY_TOO_LARGE', 'Request body is too large.', 413);
  const chunks = []; let size = 0;
  for await (const part of req) { size += part.length; check(size <= limit, 'BODY_TOO_LARGE', 'Request body is too large.', 413); chunks.push(part); }
  return Buffer.concat(chunks);
}
function json(bytes) {
  try { const body = JSON.parse(bytes.toString('utf8')); object(body, Object.keys(body)); return body; }
  catch { throw new MarketplaceError(400, 'INVALID_JSON', 'Send a JSON object.'); }
}
async function respond(res, status, value) {
  await res.accessFinish?.(status);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(value));
}

/**
 * Attach to the ORIGINAL createApp() HTTP server before listen(). No second
 * listener port, Runtime, timer, identity provider or Workspace Store.
 * Providers require a separately reviewed EXISTING identity resolver. Its
 * contract includes authentication, exact method/target/body binding, CSRF for
 * cookie transports, revocation and rate limiting. Absence means unavailable.
 */
export async function mountMarketplace(app, options = {}) {
  if (options.enabled !== true) return null;
  const { workspaceId, bindings, payments = null, verifyMeter = null, feeBps = 0,
    authenticateProvider = null, reviewers = [], allowLocalPilot = false, clock, readReviewedScope = null } = options;
  if(readReviewedScope!==null&&typeof readReviewedScope!=='function')throw TypeError('Use a trusted original Host scope callback.');
  check(app?.server && app?.access?.begin && app?.access?.verifyBody && !app.server.listening && !installed.has(app.server), 'HOST_REQUIRED', 'Mount once on the original Host before listen().');
  const originalListeners = app.server.listeners('request');
  check(originalListeners.length === 1, 'HOST_REQUIRED', 'Expected one original Workspace request listener.');
  check(app.access.mode === 'enterprise' || allowLocalPilot && payments?.live !== true, 'ENTERPRISE_REQUIRED', 'Live Marketplace requires original enterprise access.');
  check(Array.isArray(reviewers) && reviewers.every(x => typeof x === 'string'), 'HOST_REQUIRED', 'Use reviewed administrator subjects.');
  const api = await createMarketplace({ store: app.store, workerDesk: app.workerDesk, workspaceId, bindings, payments, verifyMeter, feeBps, ...(clock ? { clock } : {}) });
  const reviewerSet = new Set(reviewers);
  async function handle(req, res, pathname, url) {
    let context = null;
    try {
      if (pathname === WEBHOOK) {
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST.', 405);
        const result = await api.webhook(await rawBody(req, 1_000_000), req.headers['stripe-signature']);
        return await respond(res, 200, result);
      }
      const provider = isUnder(pathname, MARKETPLACE_PROVIDER_PATH);
      const base = provider ? MARKETPLACE_PROVIDER_PATH : MARKETPLACE_BUYER_PATH;
      const relative = pathname.slice(base.length) || '/';
      check(['GET', 'POST'].includes(req.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.', 405);
      if (!provider) context = await app.access.begin(req, res, pathname); // EXACT signed path, never an alias
      else check(typeof authenticateProvider === 'function', 'PROVIDER_AUTH_UNCONFIGURED', 'Provider sign-in is not configured on this Host.', 503);
      let bytes = Buffer.alloc(0), body = {};
      if (req.method === 'POST') {
        check(req.headers['content-type']?.split(';')[0].toLowerCase() === 'application/json', 'JSON_REQUIRED', 'Send application/json.', 415);
        bytes = await rawBody(req);
      } else check(!req.headers['transfer-encoding'] && Number(req.headers['content-length'] || 0) === 0, 'BODY_NOT_ALLOWED', 'GET cannot carry a request body.', 400);
      let actor;
      if (provider) {
        actor = await authenticateProvider({ req, res, pathname, method: req.method, rawBody: bytes });
        authorize(actor, workspaceId, ['provider'], req.method === 'POST');
      } else {
        app.access.verifyBody(context, bytes);
        check(context.workspaceId === workspaceId && !context.credentialBinding && (app.access.mode !== 'enterprise' || context.session), 'SESSION_REQUIRED', 'Use the original enterprise browser session.', 401);
        const reviewer = relative.startsWith('/review');
        check(!reviewer || context.role === 'admin' && reviewerSet.has(context.subject), 'REVIEWER_REQUIRED', 'Marketplace review requires a configured reviewer.', 403);
        actor = { subject: context.subject, workspaceId, role: context.role, kind: reviewer ? 'reviewer' : 'buyer', human: true };
      }
      if (req.method === 'POST') body = json(bytes);
      const get = req.method === 'GET'; let value;
      if (provider) {
        if (relative === '/bindings' && get) value = api.providerConnections(actor);
        else if (relative === '/profile' && !get) value = await api.registerProvider(actor, body);
        else if (relative === '/listings') value = get ? api.providerListings(actor) : await api.saveListing(actor, body);
        else if (relative === '/unpublish' && !get) value = await api.unpublish(actor, body);
        else if (relative === '/orders' && get) value = api.orders(actor);
        else if (relative.startsWith('/orders/') && get) value = api.getOrder(actor, decodeURIComponent(relative.slice('/orders/'.length)));
        else throw new MarketplaceError(404, 'NOT_FOUND', 'Provider route not found.');
      } else if (relative === '/status' && get) value = api.status();
      else if (relative === '/catalog' && get) value = api.catalog(actor, url.searchParams.get('q') || '');
      else if (relative === '/orders') value = get ? api.orders(actor) : await api.createOrder(actor, body);
      else if (relative === '/review/orders' && get) value = api.orders(actor);
      else if (relative === '/review/queue' && get) value = api.reviewQueue(actor);
      else if (relative === '/review/listing' && !get) value = await api.reviewListing(actor, body);
      else if (relative === '/review/provider' && !get) value = await api.suspendProvider(actor, body);
      else {
        const match = relative.match(/^\/(review\/)?orders\/([^/]+)(?:\/(confirm|checkout|reconcile-checkout|sync-payment|start|refresh|cancel|accept|dispute|settle|refund|reconcile-movement|receipt))?$/);
        check(match, 'NOT_FOUND', 'Marketplace route not found.', 404);
        const orderId = decodeURIComponent(match[2]), action = match[3];
        api.getOrder(actor, orderId); // scope check BEFORE processor/read side effects
        if (get && !action) value = api.getOrder(actor, orderId);
        else if (get && action === 'receipt') {
          const order = api.getOrder(actor, orderId);
          check(order.status === 'accepted' && order.deliveryArtifactId && app.artifacts?.download, 'RECEIPT_UNAVAILABLE', 'An accepted original artifact receipt is required.', 409);
          const result = await app.artifacts.download(order.deliveryArtifactId, { version: 1 });
          if (context) app.access.verifyBody(context, bytes);
          check(api.getOrder(actor, orderId).deliveryArtifactId === result.artifact.id && result.artifact.metadata?.workerOrderId === orderId && result.bytes.length <= 4_000_000, 'RECEIPT_MISMATCH', 'Original artifact association changed.', 409);
          await res.accessFinish?.(200);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="worker-delivery.json"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(result.bytes);
        } else {
          check(!get && action && action !== 'receipt', 'METHOD_NOT_ALLOWED', 'This action requires POST.', 405);
          if (['confirm', 'accept', 'dispute'].includes(action)) value = await api[action](actor, orderId, body);
          else if (action === 'reconcile-movement') value = await api.reconcileMovement(actor, orderId, body);
          else {
            empty(body);
            if (action === 'sync-payment') { await api.syncPayment(orderId, { autoStart: true }); value = api.getOrder(actor, orderId); }
            else if (action === 'reconcile-checkout') value = await api.reconcileCheckout(actor, orderId);
            else value = await api[action](actor, orderId);
          }
        }
      }
      await respond(res, 200, value);
    } catch (error) {
      // Original AccessError/WorkerDeskError expose reviewed, finite status/code.
      const safe = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 && typeof error.code === 'string';
      try { if (!res.headersSent) await respond(res, safe ? error.status : 500, { error: { code: safe ? error.code : 'MARKETPLACE_INTERNAL', message: safe ? error.message : 'Marketplace could not complete the operation.' } }); else res.end(); }
      catch { res.destroy(); }
    }
  }
  const original = originalListeners[0];
  const listener = (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return original(req, res); }
    if (!isUnder(url.pathname, MARKETPLACE_BUYER_PATH) && !isUnder(url.pathname, MARKETPLACE_PROVIDER_PATH) && url.pathname !== WEBHOOK) return original(req, res);
    void handle(req, res, url.pathname, url);
  };
  app.server.removeListener('request', original); app.server.on('request', listener);
  installed.add(app.server); app.marketplace = api;
  app.marketplaceModelHost=readReviewedScope?createMarketplaceModelHost({marketplace:api,store:app.store,access:app.access,readReviewedScope,...(clock?{clock}:{})}):null;
  if(app.marketplaceModelHost)app.businessAgent?.attachMarketplace(app.marketplaceModelHost);
  return api;
}
