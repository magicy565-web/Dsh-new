// Original file safety, Store, AccessControl Session and Space; finite local Medusa.
// Login context and product data are synthetic. This is not signed index/SDK or live Medusa proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { loadSpaceStartupOptions } from '../server/space-startup-config.mjs';
import { createSpaceService } from '../server/space-core.mjs';
import { openStore } from '../server/store.mjs';
import { createAccessControl, validateAccessConfig } from '../server/access.mjs';
const generic = error => /Space Medusa requires/.test(error.message);
const command = value => ({ requestId: randomUUID(), ...value });
async function files(t) {
  const directory = await fs.mkdtemp('/tmp/space-medusa-startup-');
  const cleanup = [];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); await fs.rm(directory, { recursive: true, force: true }); });
  const filename = path.join(directory, 'review.json'), tokenFile = path.join(directory, 'read-token');
  const secret = 'synthetic-dedicated-context-reader-only';
  const review = { version: 1, reviewed: true, sourceId: randomUUID(), workspaceId: 'synthetic-workspace', subject: 'owner', role: 'admin', baseURL: 'https://medusa.example' };
  const accessConfig = { mode: 'enterprise', workspaceId: review.workspaceId, members: [{ subject: 'owner', role: 'admin' }, { subject: 'other', role: 'operator' }] };
  const environment = { WORKSPACE_SPACE_ENABLED: '1', WORKSPACE_SPACE_MEDUSA_REVIEW_FILE: filename, WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE: tokenFile };
  const write = value => fs.writeFile(filename, JSON.stringify(value), { mode: 0o600 });
  await write(review); await fs.writeFile(tokenFile, secret, { mode: 0o600 });
  return { directory, cleanup, filename, tokenFile, secret, review, accessConfig, environment, write, load: () => loadSpaceStartupOptions(environment, accessConfig) };
}
async function bound(t) {
  const f = await files(t);
  const state = { requests: [], hook: null, revision: 2, sourceHash: 'a'.repeat(64), title: 'Synthetic approved product' };
  const server = createServer(async (req, res) => {
    state.requests.push({ method: req.method, url: req.url });
    assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer ' + f.secret);
    if (state.hook) await state.hook();
    const row = { context: { product_id: 'prod_synthetic', status: 'approved', review_version: state.revision, source_hash: state.sourceHash, reviewed_by: 'PRIVATE_REVIEWER' }, product: { id: 'prod_synthetic', title: state.title, metadata: { private: 'PRIVATE_METADATA' } } };
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/agent/product-contexts?limit=100') res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', items: [row], count: 1 }));
    else if (req.url === '/agent/product-contexts/prod_synthetic') res.end(JSON.stringify({ schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', ...row }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  f.cleanup.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await f.write({ ...f.review, baseURL: 'http://127.0.0.1:' + server.address().port, allowLoopbackHTTP: true });
  const options = await f.load(), pair = generateKeyPairSync('ed25519');
  const config = validateAccessConfig({ ...f.accessConfig, publicOrigin: 'https://workspace.example', issuer: 'synthetic', keyId: 'synthetic', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) });
  const store = await openStore(path.join(f.directory, 'data')); f.cleanup.push(() => store.close());
  const access = await createAccessControl({ config, dataDirectory: store.directory }); f.cleanup.push(() => access.close());
  const actors = {};
  for (const [subject, role] of config.members) {
    const context = { subject, role, requestId: randomUUID(), claims: { exp: Math.floor(Date.now() / 1000) + 60 } };
    await access.login(context, { setHeader() {} });
    actors[subject] = { subject, role, session: { id: context.session.id } };
  }
  const service = createSpaceService({ store, access, workspaceId: config.workspaceId, members: config.members, ...options });
  const created = await service.create(actors.owner, command({ name: 'Synthetic reviewed source' }));
  const spaceId = created.body.operation.receipt.spaceId;
  return { ...f, state, store, access, config, actors, service, spaceId, options };
}

test('default startup does not load a source; partial or disabled selections fail closed', async () => {
  assert.deepEqual(await loadSpaceStartupOptions({}, { mode: 'local' }), { enabled: false });
  assert.deepEqual(await loadSpaceStartupOptions({ WORKSPACE_SPACE_ENABLED: '1' }, { mode: 'enterprise' }), { enabled: true });
  for (const environment of [
    { WORKSPACE_SPACE_MEDUSA_REVIEW_FILE: '/not-read' },
    { WORKSPACE_SPACE_ENABLED: '1', WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE: '/not-read' },
    { WORKSPACE_SPACE_ENABLED: '0', WORKSPACE_SPACE_MEDUSA_REVIEW_FILE: '/not-read', WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE: '/not-read-token' },
  ]) await assert.rejects(loadSpaceStartupOptions(environment, { mode: 'enterprise' }), generic);
});

test('private review fixes the exact source and member without serializing its token', async t => {
  const f = await files(t), options = await f.load();
  assert.equal(typeof options.medusaSourceFactory, 'function');
  assert.equal(JSON.stringify(options), '{"enabled":true}');
  assert.throws(() => options.medusaSourceFactory({}), generic);
  const source = options.medusaSourceFactory(() => true);
  assert.deepEqual(source.binding, { sourceId: f.review.sourceId, workspaceId: f.review.workspaceId });
  assert.equal(JSON.stringify(source).includes(f.secret), false);
  for (const actor of [ { workspaceId: 'wrong', subject: 'owner', role: 'admin' }, { workspaceId: f.review.workspaceId, subject: 'other', role: 'admin' }, { workspaceId: f.review.workspaceId, subject: 'owner', role: 'viewer' } ]) assert.throws(() => source.assertCurrent(actor), { code: 'MEDUSA_APPROVED_SOURCE_REVOKED' });
});

test('review rejects unknown fields, broadened identity and non-exact origins', async t => {
  const f = await files(t);
  for (const changes of [ { extra: true }, { reviewed: false }, { workspaceId: 'another' }, { subject: 'other' }, { role: 'viewer' }, { sourceId: 'not-a-uuid' }, { baseURL: 'https://medusa.example/path' }, { baseURL: 'https://user:password@medusa.example' }, { baseURL: 'https://medusa.example?token=bad' }, { baseURL: 'http://medusa.example' }, { baseURL: 'http://127.0.0.1:9000' }, { allowLoopbackHTTP: 'true' }, { timeoutMs: 10001 } ]) {
    await f.write({ ...f.review, ...changes }); await assert.rejects(f.load(), generic);
  }
});

test('review and dedicated token files retain private regular-file and size requirements', async t => {
  const f = await files(t);
  for (const [key, value] of [ ['WORKSPACE_SPACE_MEDUSA_REVIEW_FILE', 'relative.json'], ['WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE', 42], ['WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE', f.filename] ]) await assert.rejects(loadSpaceStartupOptions({ ...f.environment, [key]: value }, f.accessConfig), generic);
  await fs.chmod(f.tokenFile, 0o644); await assert.rejects(f.load(), generic); await fs.chmod(f.tokenFile, 0o600);
  await fs.chmod(f.filename, 0o644); await assert.rejects(f.load(), generic); await fs.chmod(f.filename, 0o600);
  const symlink = path.join(f.directory, 'token-link'); await fs.symlink(f.tokenFile, symlink);
  await assert.rejects(loadSpaceStartupOptions({ ...f.environment, WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE: symlink }, f.accessConfig), generic);
  const hardlink = path.join(f.directory, 'token-hardlink'); await fs.link(f.tokenFile, hardlink); await assert.rejects(f.load(), generic); await fs.unlink(hardlink);
  for (const token of ['', 'short', 'synthetic-token-with-newline\n', 'x'.repeat(4097)]) { await fs.writeFile(f.tokenFile, token); await assert.rejects(f.load(), generic); }
  await fs.writeFile(f.tokenFile, f.secret);
  await assert.rejects(loadSpaceStartupOptions({ ...f.environment, WORKSPACE_MEDUSA_SECRET_API_KEY: f.secret }, f.accessConfig), generic);
  await fs.writeFile(f.filename, '{bad json'); await assert.rejects(f.load(), generic);
  await fs.writeFile(f.filename, ' '.repeat(16001)); await assert.rejects(f.load(), generic);
});

test('original Space reads approved references and keeps source revisions and model boundary', async t => {
  const f = await bound(t), before = structuredClone(f.store.read().businessLibrary.products);
  const listed = await f.service.sources(f.actors.owner, f.spaceId, { kind: 'medusa-product' }); listed.assertCurrent();
  assert.equal(listed.body.modelAccess, false); const pin = listed.body.items[0].reference;
  assert.equal(pin.sourceId, f.review.sourceId); assert.equal(pin.id, 'prod_synthetic');
  for (const value of [f.secret, 'PRIVATE_REVIEWER', 'PRIVATE_METADATA']) assert.equal(JSON.stringify(listed.body).includes(value), false);
  const created = await f.service.createNode(f.actors.owner, f.spaceId, command({ kind: 'page', parentId: null, title: 'Synthetic page', content: 'Reference only', sources: [pin] })); created.assertCurrent();
  const pageId = created.body.operation.receipt.entityId;
  f.state.sourceHash = 'b'.repeat(64); f.state.title = 'PRIVATE_NEW_TITLE';
  const stale = await f.service.page(f.actors.owner, f.spaceId, pageId); stale.assertCurrent();
  assert.equal(stale.body.page.sourceResolution[0].status, 'updated'); assert.equal(JSON.stringify(stale.body).includes(f.state.title), false);
  await assert.rejects(f.service.savePage(f.actors.owner, f.spaceId, pageId, command({ expectedRevision: 1, title: 'bad', content: 'bad', sources: [pin] })), { code: 'SPACE_SOURCE_CHANGED' });
  assert.deepEqual(f.store.read().businessLibrary.products, before); assert.equal(f.store.read().runs.length, 0);
});

test('Space factory receives only the original live-current function and rejects mixed bindings', async t => {
  const f = await bound(t); let argumentCount;
  const options = { store: f.store, access: f.access, workspaceId: f.config.workspaceId, members: f.config.members, enabled: true };
  const service = createSpaceService({ ...options, medusaSourceFactory(...args) { argumentCount = args.length; assert.equal(typeof args[0], 'function'); return f.options.medusaSourceFactory(args[0]); } });
  assert.equal(argumentCount, 1); (await service.sources(f.actors.owner, f.spaceId, { kind: 'medusa-product' })).assertCurrent();
  assert.throws(() => createSpaceService({ ...options, medusaSource: {}, medusaSourceFactory: f.options.medusaSourceFactory }), /Select one/);
  assert.throws(() => createSpaceService({ ...options, enabled: false, medusaSourceFactory: f.options.medusaSourceFactory }), /Select one/);
});

test('initial member pin does not authorize another shared member or a revoked original Session', async t => {
  const f = await bound(t);
  await f.service.share(f.actors.owner, f.spaceId, command({ expectedRevision: 1, subject: 'other', role: 'viewer', expiresAt: null }));
  const before = f.state.requests.length;
  await assert.rejects(f.service.sources(f.actors.other, f.spaceId, { kind: 'medusa-product' }), { code: 'SPACE_MEDUSA_UNAVAILABLE' });
  assert.equal(f.state.requests.length, before);
  const prepared = await f.service.sources(f.actors.owner, f.spaceId, { kind: 'medusa-product' });
  await f.access.revokeSession({ subject: 'owner', requestId: randomUUID() }, f.actors.owner.session.id);
  assert.throws(prepared.assertCurrent, { code: 'SPACE_SESSION_REQUIRED' });
  assert.throws(() => f.service.sources(f.actors.owner, f.spaceId, { kind: 'medusa-product' }), { code: 'SPACE_SESSION_REQUIRED' });
  assert.equal(f.state.requests.length, before + 1);
});

test('original current member change during finite HTTP read withholds the returned title', async t => {
  const f = await bound(t);
  f.state.hook = () => { f.config.members.set('owner', 'viewer'); };
  await assert.rejects(f.service.sources(f.actors.owner, f.spaceId, { kind: 'medusa-product' }), error => {
    assert.equal(error.message.includes(f.state.title), false); assert.equal(error.message.includes(f.secret), false);
    return error.code === 'SPACE_SESSION_REQUIRED' || error.code === 'SPACE_MEDUSA_UNAVAILABLE';
  });
  assert.equal(f.state.requests.length, 1); assert.equal(f.store.read().runs.length, 0);
});

test('same opened review and token inode refuses a lexical path alias before any outbound request', async t => {
  const f = await files(t), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = () => { requests++; throw Error('UNEXPECTED_OUTBOUND_REQUEST'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const alias = f.directory + '/./review.json';
  assert.notEqual(alias, f.filename);
  await assert.rejects(loadSpaceStartupOptions({ ...f.environment, WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE: alias }, f.accessConfig), generic);
  assert.equal(requests, 0);
});
