export const API_PREFIX = '/mini-erp-api';
export function createHttpHandler(service, { authorize = () => 401 } = {}) {
  return async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      const rejected = authorize({ headers: req.headers });
      if (rejected) return send(rejected, { ok: false, error: { message: 'Use an authenticated DSH page' } });
      const url = new URL(req.url, 'http://localhost'), route = url.pathname.slice(API_PREFIX.length);
      if (!url.pathname.startsWith(API_PREFIX + '/')) return send(404, { ok: false });
      let result;
      if (req.method === 'GET' && route === '/workspaces') result = { items: service.workspaces() };
      else if (req.method === 'GET' && route === '/catalog') result = await service.catalog();
      else {
        const match = /^\/workspaces\/([^/]+)\/(read|command)$/.exec(route);
        if (!match) return send(404, { ok: false });
        const workspace = decodeURIComponent(match[1]);
        if (req.method === 'GET' && match[2] === 'read') {
          const input = Object.fromEntries(url.searchParams);
          for (const key of ['quantity', 'limit']) if (input[key] !== undefined) input[key] = Number(input[key]);
          result = await service.read(workspace, input);
        } else if (req.method === 'POST' && match[2] === 'command') {
          let origin; try { origin = new URL(req.headers.origin); } catch { return send(403, { ok: false }); }
          if (req.headers['sec-fetch-site'] === 'cross-site' || !['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) return send(403, { ok: false });
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return send(415, { ok: false });
          let bytes = 0; const chunks = [];
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 16000) return send(413, { ok: false }); chunks.push(chunk); }
          let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { ok: false }); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { ok: false });
          if (!['link_sku', 'update_stock', 'add_buyer', 'add_offer', 'reserve', 'confirm', 'cancel'].includes(input.action)) return send(400, { ok: false });
          result = await service.write(workspace, input, 'dsh-browser-admin');
        } else return send(405, { ok: false });
      }
      send(200, { ok: true, data: result });
    } catch (error) {
      const known = error.code && error.code !== 'ERR_SQLITE_ERROR';
      send(known ? 409 : 500, { ok: false, error: { code: error.code ?? 'INTERNAL', message: known ? error.message : 'Operation failed; inspect the latest records before retrying' } });
    }
  };
}
