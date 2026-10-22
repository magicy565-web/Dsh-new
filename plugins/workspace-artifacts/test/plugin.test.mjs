import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, ROUTES } from '../src/index.mjs';

function fakeArtifacts() {
  const items = new Map();
  const record = body => {
    const id = crypto.randomUUID();
    const sha256 = 'a'.repeat(64);
    const bytes = body.base64 === undefined ? Buffer.from(body.content ?? '', 'utf8') : Buffer.from(body.base64, 'base64');
    const artifact = {
      id,
      filename: body.filename,
      title: body.title ?? body.filename,
      mimeType: body.mimeType ?? 'text/plain',
      size: bytes.length,
      sha256,
      currentVersion: 1,
      versions: [{ version: 1, filename: body.filename, mimeType: body.mimeType ?? 'text/plain', sha256, size: bytes.length }],
      createdAt: new Date().toISOString(),
    };
    items.set(id, { artifact, content: body.content, bytes });
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
    download: async id => {
      const item = items.get(id);
      if (!item) throw notFound();
      return { artifact: item.artifact, version: item.artifact.versions[0], bytes: item.bytes, filename: item.artifact.filename, mimeType: item.artifact.mimeType };
    },
  };
}

function fakeContext() {
  const routes = new Map();
  const health = new Map();
  const tools = new Map();
  const ctx = {
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
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
  return { ctx, routes, health, tools, call };
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

test('the writer tool is approval-gated and stores a text document', async () => {
  const harness = await mounted();
  const tool = harness.tools.get('artifact_write');
  assert.ok(tool, 'artifact_write must be registered');
  assert.equal(tool.approval, 'always');
  assert.equal(tool.readOnly, false);

  const result = await tool.handler(
    { filename: '报价单.md', content: '# 报价\nMOQ 500', mimeType: 'text/markdown' },
    { actor: { subject: 'service:runner', role: 'operator' } },
  );
  assert.equal(result.artifact.filename, '报价单.md');
  assert.equal(result.artifact.mimeType, 'text/markdown');

  const listed = await harness.call('GET /api/artifacts');
  assert.equal(listed.body.items.length, 1);
});

test('the writer tool refuses invalid documents', async () => {
  const harness = await mounted();
  const tool = harness.tools.get('artifact_write');
  await assert.rejects(tool.handler({ filename: '', content: 'x' }, {}), error => error.code === 'ARTIFACT_INVALID');
  await assert.rejects(tool.handler({ filename: 'x.txt', content: 'x'.repeat(512 * 1024 + 1) }, {}), error => error.code === 'ARTIFACT_INVALID');
  await assert.rejects(tool.handler({ filename: 'x.pdf', content: 'x', mimeType: 'application/pdf' }, {}), error => error.code === 'ARTIFACT_INVALID');
});
test('a text file can be downloaded as an attachment', async () => {
  const harness = await mounted();
  const uploaded = await harness.call('POST /api/artifacts', { body: { filename: '报价单.md', content: '# 报价', mimeType: 'text/markdown' } });
  const response = await harness.call('GET /api/artifacts/:id/download', { params: { id: uploaded.body.artifact.id } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment; filename\*=UTF-8''/u);
  assert.equal(await response.text(), '# 报价');
});
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a binary file is stored and downloaded byte for byte', async () => {
  const harness = await mounted();
  const created = await harness.call('POST /api/artifacts', {
    body: { filename: '像素.png', mimeType: 'image/png', base64: PNG_BASE64 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.artifact.mimeType, 'image/png');
  assert.equal(created.body.artifact.size, Buffer.from(PNG_BASE64, 'base64').length);

  const response = await harness.call('GET /api/artifacts/:id/download', { params: { id: created.body.artifact.id } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, Buffer.from(PNG_BASE64, 'base64'));
});

test('a binary upload needs a supported type and exactly one payload', async () => {
  const harness = await mounted();
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'x.png', mimeType: 'image/png', base64: PNG_BASE64, content: 'x' } }),
    error => error.status === 400,
  );
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'x.png', base64: PNG_BASE64 } }),
    error => error.status === 400,
  );
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'x.png', mimeType: 'image/png', base64: '' } }),
    error => error.status === 400,
  );
  await assert.rejects(
    harness.call('POST /api/artifacts', { body: { filename: 'x.bin', mimeType: 'application/x-msdownload', base64: PNG_BASE64 } }),
    error => error.status === 400,
  );
});