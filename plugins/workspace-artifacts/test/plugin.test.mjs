import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, ROUTES } from '../src/index.mjs';

function fakeArtifacts() {
  const items = new Map();
  const record = body => {
    const id = crypto.randomUUID();
    const sha256 = 'a'.repeat(64);
    const artifact = {
      id,
      filename: body.filename,
      title: body.title ?? body.filename,
      mimeType: body.mimeType ?? 'text/plain',
      size: Buffer.byteLength(body.content, 'utf8'),
      sha256,
      currentVersion: 1,
      versions: [{ version: 1, filename: body.filename, mimeType: body.mimeType ?? 'text/plain', sha256, size: Buffer.byteLength(body.content, 'utf8') }],
      createdAt: new Date().toISOString(),
    };
    items.set(id, { artifact, content: body.content });
    return artifact;
  };
  const notFound = () => Object.assign(new Error('not found'), { code: 'ARTIFACT_NOT_FOUND', status: 404 });
  return {
    items,
    create: async body => ({ artifact: record(body) }),
    list: ({ q } = {}) => ({ artifacts: [...items.values()].map(item => item.artifact).filter(item => !q || item.filename.includes(q)) }),
    get: id => { const item = items.get(id); if (!item) throw notFound(); return { artifact: item.artifact }; },
    read: async id => {
      const item = items.get(id);
      if (!item) throw notFound();
      const binary = item.artifact.mimeType === 'application/octet-stream';
      return { artifact: item.artifact, version: item.artifact.versions[0], encoding: binary ? 'base64' : 'utf8', content: binary ? 'AAAA' : item.content };
    },
  };
}

function fakeContext() {
  const routes = new Map();
  const health = new Map();
  const ctx = {
    artifacts: fakeArtifacts(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: (name, fn) => health.set(name, fn) },
  };
  const call = async (key, { params = {}, body = {}, query = {}, actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' } } = {}) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, pathname] = key.split(' ');
    return definition.handler({}, {}, { method, pathname, params, body, query, actor });
  };
  return { ctx, routes, health, call };
}

async function mounted() {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  return harness;
}

test('the plugin registers every declared route', async () => {
  const harness = await mounted();
  assert.equal(harness.routes.size, ROUTES.length);
  for (const [method, path] of ROUTES) assert.ok(harness.routes.has(`${method} ${path}`), `${method} ${path}`);
  assert.equal(harness.health.get('artifacts-api')().status, 'ok');
});

test('a text file can be uploaded, listed, read and previewed', async () => {
  const harness = await mounted();
  const uploaded = await harness.call('POST /api/artifacts', {
    body: { filename: '客户需求.md', content: '# 需求\nMOQ 500', mimeType: 'text/markdown' },
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.artifact.filename, '客户需求.md');
  const id = uploaded.body.artifact.id;

  const listed = await harness.call('GET /api/artifacts');
  assert.equal(listed.body.items.length, 1);

  const one = await harness.call('GET /api/artifacts/:id', { params: { id } });
  assert.equal(one.body.artifact.id, id);

  const content = await harness.call('GET /api/artifacts/:id/content', { params: { id } });
  assert.equal(content.body.content, '# 需求\nMOQ 500');
  assert.equal(content.body.version.version, 1);
});

test('a viewer cannot upload but can read', async () => {
  const harness = await mounted();
  await assert.rejects(
    harness.call('POST /api/artifacts', {
      body: { filename: 'x.txt', content: 'x' },
      actor: { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' },
    }),
    error => error.status === 403,
  );
  const uploaded = await harness.call('POST /api/artifacts', { body: { filename: 'x.txt', content: 'x' } });
  const content = await harness.call('GET /api/artifacts/:id/content', {
    params: { id: uploaded.body.artifact.id },
    actor: { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' },
  });
  assert.equal(content.body.content, 'x');
});

test('bad uploads are refused instead of stored', async () => {
  const harness = await mounted();
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'big.txt', content: 'x'.repeat(512 * 1024 + 1) } }),
    error => error.code === 'ARTIFACT_INVALID' && error.status === 400,
  );
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'x.pdf', content: 'x', mimeType: 'application/pdf' } }),
    error => error.code === 'ARTIFACT_INVALID',
  );
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'x.txt', content: 'x', base64: 'AAAA' } }),
    error => error.code === 'ARTIFACT_INVALID',
  );
});

test('a binary file cannot be previewed as text', async () => {
  const harness = await mounted();
  const binary = await harness.ctx.artifacts.create({ filename: 'scan.bin', content: 'x', mimeType: 'application/octet-stream' });
  await assert.rejects(
    harness.call('GET /api/artifacts/:id/content', { params: { id: binary.artifact.id } }),
    error => error.code === 'ARTIFACT_NOT_TEXT' && error.status === 415,
  );
});
