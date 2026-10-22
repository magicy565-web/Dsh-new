import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProductLibraryProxy } from '../server/product-library-proxy.mjs';

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}
const close = server => new Promise(resolve => server.close(resolve));

test('the proxy forwards the product library API and nothing else', async () => {
  const upstream = await listen((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null }));
    });
  });
  const proxy = createProductLibraryProxy({ targetUrl: `http://127.0.0.1:${upstream.port}` });
  const front = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!proxy(req, res, url)) { res.writeHead(404); res.end('no'); }
  });
  try {
    const status = await fetch(`http://127.0.0.1:${front.port}/api/product-library/status`).then(response => response.json());
    assert.deepEqual(status, { method: 'GET', url: '/api/product-library/status', body: null });

    const created = await fetch(`http://127.0.0.1:${front.port}/api/product-library/products/prod_x/pages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r1' }),
    }).then(response => response.json());
    assert.equal(created.method, 'POST');
    assert.deepEqual(created.body, { requestId: 'r1' });

    const outside = await fetch(`http://127.0.0.1:${front.port}/api/other`);
    assert.equal(outside.status, 404);

    const refused = await fetch(`http://127.0.0.1:${front.port}/api/product-library/status`, { method: 'PUT' });
    assert.equal(refused.status, 405);
  } finally {
    await close(front.server);
    await close(upstream.server);
  }
});

test('the proxy fails closed when the product library is down', async () => {
  const upstream = await listen((_req, res) => { res.writeHead(200); res.end('{}'); });
  const port = upstream.port;
  await close(upstream.server);
  const proxy = createProductLibraryProxy({ targetUrl: `http://127.0.0.1:${port}` });
  const front = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!proxy(req, res, url)) { res.writeHead(404); res.end('no'); }
  });
  try {
    const response = await fetch(`http://127.0.0.1:${front.port}/api/product-library/status`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'PRODUCT_LIBRARY_UNAVAILABLE');
  } finally {
    await close(front.server);
  }
});
