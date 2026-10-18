import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createSpaceService, SpaceError } from '../server/space-core.mjs';
import { handleSpaceHttp } from '../server/space-http.mjs';

// Actual HTTP socket and bytes; users, credential proof and Store are
// explicit LOCAL FIXTURES, NOT the original enterprise ingress/Store.
test('loopback HTTP: create, comment, share, edit, revoke and replay', async () => {
  let state = { businessLibrary: { version: 1 } }, queue = Promise.resolve();
  const members = new Map([['owner', 'admin'], ['editor', 'operator']]);
  const session = Object.fromEntries([...members].map(([subject, role]) => [subject, {
    id: subject, subject, role, workspaceId: 'test-company', expiresAt: Date.now() + 100000,
  }]));
  const access = {
    nativeSessionById: id => session[id] || null,
    verifyBody: (context, bytes) => {
      if (context.hash !== createHash('sha256').update(bytes).digest('hex'))
        throw new SpaceError(403, 'TEST_BODY_MISMATCH', 'Fixture body digest mismatch');
    },
  };
  const store = {
    read: () => structuredClone(state),
    update: callback => {
      const run = queue.then(() => { const next = structuredClone(state); const result = callback(next); state = next; return structuredClone(result); });
      queue = run.catch(() => {}); return run;
    },
  };
  const service = createSpaceService({ store, access, members, workspaceId: 'test-company', enabled: true });
  const server = http.createServer(async (req, res) => {
    const subject = req.headers['x-fixture-user'];
    if (!members.has(subject)) { res.writeHead(401); return res.end(); }
    const context = { subject, role: members.get(subject), session: { id: subject }, hash: req.headers['x-fixture-hash'] };
    res.accessFinish = async () => {};
    try {
      await handleSpaceHttp({ service, req, res, pathname: new URL(req.url, 'http://localhost').pathname,
        context, access, readBody: async request => {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          request.bodyBytes = Buffer.concat(chunks); return JSON.parse(request.bodyBytes.toString('utf8'));
        },
      });
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: error.code || 'ERROR' } }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const command = extra => ({ requestId: randomUUID(), ...extra });
  const call = async (user, method, path, body, tampered = false) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const response = await fetch(base + path, { method, headers: {
      'x-fixture-user': user,
      ...(json ? { 'Content-Type': 'application/json', 'x-fixture-hash': tampered ? 'wrong' : createHash('sha256').update(json).digest('hex') } : {}),
    }, body: json });
    return { status: response.status, body: await response.json() };
  };
  try {
    const added = await call('owner', 'POST', '/api/library/spaces', command({ name: '客户' }));
    assert.equal(added.status, 201);
    const path = '/api/library/spaces/' + added.body.operation.receipt.spaceId;
    const nodeCommand = command({ kind: 'page', parentId: null, title: '计划', content: 'HTTP正文' });
    assert.equal((await call('owner', 'POST', path + '/nodes', nodeCommand, true)).status, 403);
    const saved = await call('owner', 'POST', path + '/nodes', nodeCommand);
    assert.equal(saved.status, 201);
    assert.equal((await call('owner', 'POST', path + '/nodes', nodeCommand)).body.operation.replayed, true);
    const node = saved.body.operation.receipt.entityId;
    const invalidParent = await call('owner', 'POST', path + '/nodes', command({ kind: 'folder', parentId: node, title: '非法' }));
    assert.equal(invalidParent.status, 409); assert.equal(invalidParent.body.error.code, 'SPACE_PARENT_NOT_FOLDER');
    const pagePath = path + '/nodes/' + node;
    assert.equal((await call('owner', 'GET', pagePath)).body.page.selected.content, 'HTTP正文');
    assert.equal((await call('owner', 'POST', pagePath + '/comments', command({ expectedRevision: 1, version: 1, body: '审核中' }))).status, 201);
    const revision = (await call('owner', 'GET', path)).body.space.revision;
    assert.equal((await call('owner', 'POST', path + '/share', command({ expectedRevision: revision, subject: 'editor', role: 'editor', expiresAt: null }))).status, 200);
    assert.equal((await call('editor', 'GET', pagePath)).body.page.comments.length, 1);
    assert.equal((await call('editor', 'POST', pagePath + '/save', command({ expectedRevision: 2, title: '计划', content: '第二人编辑' }))).status, 200);
    const after = (await call('owner', 'GET', path)).body.space.revision;
    assert.equal((await call('owner', 'POST', path + '/revoke', command({ expectedRevision: after, subject: 'editor' }))).status, 200);
    assert.equal((await call('editor', 'GET', pagePath)).status, 404);
    const final = (await call('owner', 'GET', pagePath)).body.page;
    assert.equal(final.selected.content, '第二人编辑'); assert.equal(final.history.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
