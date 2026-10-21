// Same-origin proxy from the Workspace app to the Product Library harness.
//
// The product library is a separate reviewed harness composition; this proxy
// exists so the app UI can call it without CORS and without exposing the
// loopback port. It is only mounted in local access mode: an enterprise host
// must route through its reviewed signed ingress instead.
import http from 'node:http';

const ALLOWED = new Set(['GET', 'POST', 'HEAD']);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

export function createProductLibraryProxy({ targetUrl = process.env.WORKSPACE_PRODUCT_LIBRARY_URL || 'http://127.0.0.1:8790', timeoutMs = 30000 } = {}) {
  let target;
  try { target = new URL(targetUrl); } catch { throw new TypeError('WORKSPACE_PRODUCT_LIBRARY_URL must be an absolute URL.'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/' || target.search || target.hash)
    throw new TypeError('WORKSPACE_PRODUCT_LIBRARY_URL must be an exact origin.');

  return function handle(req, res, url) {
    if (url.pathname !== '/api/product-library' && !url.pathname.startsWith('/api/product-library/')) return false;
    if (!ALLOWED.has(req.method ?? '')) {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST, HEAD' });
      res.end(JSON.stringify({ error: { code: 'PRODUCT_LIBRARY_METHOD', message: 'Use GET or POST.' } }));
      return true;
    }
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(key.toLowerCase()) && value !== undefined) headers[key] = value;
    }
    headers.host = target.host;
    const upstream = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: url.pathname + url.search,
      headers,
    }, response => {
      const responseHeaders = {};
      for (const [key, value] of Object.entries(response.headers)) {
        if (!HOP_BY_HOP.has(key.toLowerCase()) && value !== undefined) responseHeaders[key] = value;
      }
      res.writeHead(response.statusCode ?? 502, responseHeaders);
      response.pipe(res);
    });
    const timer = setTimeout(() => upstream.destroy(new Error('PRODUCT_LIBRARY_TIMEOUT')), timeoutMs);
    upstream.on('close', () => clearTimeout(timer));
    upstream.on('error', error => {
      clearTimeout(timer);
      if (res.headersSent) { res.destroy(); return; }
      const code = error?.message === 'PRODUCT_LIBRARY_TIMEOUT' ? 'PRODUCT_LIBRARY_TIMEOUT' : 'PRODUCT_LIBRARY_UNAVAILABLE';
      res.writeHead(code === 'PRODUCT_LIBRARY_TIMEOUT' ? 504 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: { code, message: 'The Product Library harness is unavailable.' } }));
    });
    req.pipe(upstream);
    return true;
  };
}
