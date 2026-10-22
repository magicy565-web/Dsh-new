import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createBusinessMemoryClient, BusinessMemoryClientError } from '../server/business-memory-client.mjs';

async function tokenFile() {
  const dir = await mkdtemp(join(tmpdir(), 'bm-client-'));
  const path = join(dir, 'service.token');
  const token = randomBytes(32).toString('base64url');
  await writeFile(path, token, { mode: 0o600 });
  return { dir, path, token };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { return await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

test('compile sends the exact task request with the service token', async () => {
  const file = await tokenFile();
  try {
    let seen = null;
    await withServer(async (request, response) => {
      seen = { url: request.url, auth: request.headers.authorization, body: JSON.parse(await readBody(request)) };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ revision: 7, text: '【企业经营记忆】\n- [mem:1] …', items: [{ id: '1' }], counts: { injected: 1 } }));
    }, async baseURL => {
      const client = createBusinessMemoryClient({ baseURL, tokenFile: file.path });
      const result = await client.compile({ taskId: 'run-1', query: '海祺 补货', refs: [{ subjectType: 'customer', subjectId: 'customer-haiqi' }] });
      assert.equal(result.revision, 7);
      assert.equal(result.items[0].id, '1');
    });
    assert.equal(seen.url, '/api/business-memory/service/context');
    assert.equal(seen.auth, `Bearer ${file.token}`);
    assert.deepEqual(seen.body, {
      taskId: 'run-1', sessionId: null, query: '海祺 补货',
      refs: [{ subjectType: 'customer', subjectId: 'customer-haiqi' }],
      budgetChars: 2400, maxItems: 24,
    });
  } finally { await rm(file.dir, { recursive: true, force: true }); }
});

test('a refused service token surfaces as an authorization error', async () => {
  const file = await tokenFile();
  try {
    await withServer((request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'BUSINESS_MEMORY_SERVICE_UNAUTHORIZED', message: 'no' } }));
    }, async baseURL => {
      const client = createBusinessMemoryClient({ baseURL, tokenFile: file.path });
      await assert.rejects(client.compile({ taskId: 'run-1' }), error => {
        assert.ok(error instanceof BusinessMemoryClientError);
        assert.equal(error.code, 'BUSINESS_MEMORY_SERVICE_UNAUTHORIZED');
        assert.equal(error.status, 401);
        return true;
      });
    });
  } finally { await rm(file.dir, { recursive: true, force: true }); }
});

test('a slow service fails closed as unavailable instead of hanging the run', async () => {
  const file = await tokenFile();
  try {
    await withServer(async (request, response) => {
      await new Promise(resolve => setTimeout(resolve, 400));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    }, async baseURL => {
      const client = createBusinessMemoryClient({ baseURL, tokenFile: file.path, timeoutMs: 80 });
      await assert.rejects(client.verify({ ids: [] }), error => error.code === 'BUSINESS_MEMORY_UNAVAILABLE');
    });
  } finally { await rm(file.dir, { recursive: true, force: true }); }
});

test('the client refuses a plain-HTTP origin that is not loopback', async () => {
  const file = await tokenFile();
  try {
    assert.throws(
      () => createBusinessMemoryClient({ baseURL: 'http://10.0.0.5:8790', tokenFile: file.path }),
      /loopback/,
    );
    assert.throws(
      () => createBusinessMemoryClient({ baseURL: 'http://127.0.0.1:8790/api', tokenFile: file.path }),
      /HTTPS, or plain HTTP on loopback only/,
    );
  } finally { await rm(file.dir, { recursive: true, force: true }); }
});

test('a redirect is never followed', async () => {
  const file = await tokenFile();
  try {
    await withServer((request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/other' });
      response.end();
    }, async baseURL => {
      const client = createBusinessMemoryClient({ baseURL, tokenFile: file.path });
      await assert.rejects(client.compile({ taskId: 'run-1' }), error => error.code === 'BUSINESS_MEMORY_UNAVAILABLE');
    });
  } finally { await rm(file.dir, { recursive: true, force: true }); }
});
