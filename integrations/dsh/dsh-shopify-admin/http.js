import { API_PREFIX, ShopifyBindingError, reject, verifyUninstall } from './core.js';

function json(res, code, value) {
  if (res.destroyed) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(value));
}
function html(res, code, text) {
  if (res.destroyed) return;
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
  res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>Shopify 商店绑定</title><body><p>' + text + '</p></body></html>');
}
async function bounded(req, maximum = 256 * 1024) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) reject('BODY_TOO_LARGE', 'Request body too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function ownerOrigin(req) {
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) reject('ORIGIN_DENIED', 'Use the authenticated DSH origin.', 403);
  let origin;
  try { origin = new URL(req.headers.origin); } catch { reject('ORIGIN_DENIED', 'An authenticated same-origin browser request is required.', 403); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) reject('ORIGIN_DENIED', 'The DSH browser origin differs from the current Host.', 403);
}
async function owner(req, authorize) {
  let rejection = 401;
  try { if (authorize) rejection = await authorize({ headers: req.headers }); } catch { /* fail closed */ }
  if (!authorize || rejection) reject('DSH_AUTH_REQUIRED', 'Authenticate to the DSH enterprise workspace.', rejection === 403 ? 403 : 401);
}
function assertQuery(url, allowed) {
  if ([...url.searchParams.keys()].some(k => !allowed.includes(k))) reject('QUERY_DENIED', 'Unsupported query parameter.');
}
function responseError(res, error) {
  const known = error instanceof ShopifyBindingError;
  json(res, known ? error.status : 500, { ok: false, error: { code: known ? error.code : 'INTERNAL', message: known ? error.message : 'Shopify operation failed.' } });
}
export function createShopifyBindingHandler(service, { authorize, clientSecret } = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(API_PREFIX + '/')) reject('NOT_FOUND', 'Unknown Shopify binding route.', 404);
      const path = url.pathname.slice(API_PREFIX.length);
      if (path === '/oauth/callback' && req.method === 'GET') {
        const result = await service.finish(url.searchParams);
        html(res, 200, '商店 ' + result.shop + ' 已连接。请返回原企业 Workspace，并通过 Shopify Admin 管理商品、客户和订单。');
        return;
      }
      if (path === '/webhooks/app-uninstalled' && req.method === 'POST') {
        if (!service.configured || !clientSecret) reject('SETUP_REQUIRED', 'Shopify webhook configuration is missing.', 503);
        const bytes = await bounded(req);
        const shop = verifyUninstall(bytes, req.headers['x-shopify-hmac-sha256'], clientSecret);
        if (req.headers['x-shopify-topic'] !== 'app/uninstalled' || req.headers['x-shopify-shop-domain'] !== shop) reject('WEBHOOK_INVALID', 'Signed webhook shop or topic mismatch.', 403);
        const eventId = req.headers['x-shopify-webhook-id'];
        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(eventId)) reject('WEBHOOK_INVALID', 'Missing Shopify webhook identity.', 403);
        service.uninstall(shop, eventId);
        json(res, 200, { ok: true }); return;
      }
      await owner(req, authorize);
      if (path === '/status' && req.method === 'GET') {
        assertQuery(url, ['sessionId']);
        json(res, 200, { ok: true, data: service.status(url.searchParams.get('sessionId')) }); return;
      }
      if (path === '/read' && req.method === 'GET') {
        assertQuery(url, ['sessionId', 'resource']);
        const result = await service.read(url.searchParams.get('sessionId'), url.searchParams.get('resource') || 'shop');
        json(res, 200, { ok: true, data: result }); return;
      }
      if (path === '/authorize' && req.method === 'POST') {
        ownerOrigin(req);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) reject('CONTENT_TYPE', 'Use JSON.', 415);
        let data;
        try { data = JSON.parse((await bounded(req, 16 * 1024)).toString('utf8')); } catch { reject('INPUT', 'Invalid Shopify binding JSON.', 400); }
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['sessionId', 'shop'].includes(k))) reject('INPUT', 'Unexpected Shopify binding request fields.', 400);
        json(res, 200, { ok: true, data: service.begin(data.sessionId, data.shop) }); return;
      }
      reject('NOT_FOUND', 'Unknown Shopify binding route.', 404);
    } catch (error) { responseError(res, error); }
  };
}
