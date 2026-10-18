import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSpaceService, validateSpaceLibrary } from '../server/space-core.mjs';
import { spaceHttp, handleSpaceHttp } from '../server/space-http.mjs';
import { bindSpaceSafeBootstrap } from '../server/space-bootstrap.mjs';
import { spaceStartupOptions } from '../server/space-startup-config.mjs';

// EXPLICIT UNIT FIXTURES: not the original Store, signed ingress or real users.
// Production code still requires original Store/AccessControl injection.
function fixture() {
  let state = { businessLibrary: { version: 1 } }, queue = Promise.resolve(), now = Date.parse('2026-10-17T00:00:00Z');
  const members = new Map([['owner', 'admin'], ['editor', 'operator'], ['viewer', 'viewer'], ['other', 'operator']]);
  const sessions = new Map([...members].map(([subject, role]) => [subject, { id: subject, subject, role, workspaceId: 'enterprise-a', expiresAt: now + 3600000 }]));
  const access = { nativeSessionById: id => { const row = sessions.get(id); return row && row.expiresAt > now && members.get(row.subject) === row.role ? { ...row } : null; } };
  const store = { read: () => structuredClone(state), update: callback => { const task = queue.then(() => { const next = structuredClone(state), result = callback(next); if (result?.then) throw Error('sync only'); state = structuredClone(next); return structuredClone(result); }); queue = task.catch(() => {}); return task; } };
  const options = { store, access, members, workspaceId: 'enterprise-a', enabled: true, clock: () => now };
  const service = createSpaceService(options);
  const contexts = Object.fromEntries([...members].map(([subject, role]) => [subject, { subject, role, session: { id: subject } }]));
  return { ...contexts, service, store, members, sessions, access, options, now: () => now, tick: ms => { now += ms; }, corrupt: callback => callback(state) };
}
const command = extra => ({ requestId: randomUUID(), ...extra });
const code = wanted => error => error.code === wanted;
async function setup() {
  const f = fixture(); const created = await f.service.create(f.owner, command({ name: '客户开发' }));
  const sid = created.body.operation.receipt.spaceId;
  const made = await f.service.createNode(f.owner, sid, command({ kind: 'page', parentId: null, title: '客户计划', content: '版本一：先做研究。' }));
  return { ...f, sid, pid: made.body.operation.receipt.entityId };
}
async function grant(f, member = 'editor', role = 'editor', expiresAt = null) {
  return f.service.share(f.owner, f.sid, command({ expectedRevision: f.service.read(f.owner, f.sid).body.space.revision, subject: member, role, expiresAt }));
}

test('disabled by default and rejects fake identity/tenant', async () => {
  const f = fixture(); const disabled = createSpaceService({ store: f.store });
  assert.equal(disabled.status().configured, false);
  assert.throws(() => disabled.list(f.owner), code('SPACE_UNCONFIGURED'));
  assert.throws(() => f.service.list({ subject: 'owner', role: 'admin', session: { id: 'other' } }), code('SPACE_SESSION_REQUIRED'));
  f.sessions.get('owner').workspaceId = 'enterprise-b';
  assert.throws(() => f.service.list(f.owner), code('SPACE_SESSION_REQUIRED'));
});

test('create, page history, exact digest and restore-as-new-version', async () => {
  const f = await setup();
  await f.service.savePage(f.owner, f.sid, f.pid, command({ expectedRevision: 1, title: '客户计划', content: '版本二' }));
  await f.service.restorePage(f.owner, f.sid, f.pid, command({ expectedRevision: 2, version: 1 }));
  const view = f.service.page(f.owner, f.sid, f.pid).body.page;
  assert.equal(view.selected.content, '版本一：先做研究。'); assert.equal(view.history.length, 3); assert.equal(view.selected.restoredFrom, 1);
  assert.equal(view.history[0].sha256, view.history[2].sha256); assert.equal(f.service.page(f.owner, f.sid, f.pid, 2).body.page.selected.content, '版本二');
  assert.equal(validateSpaceLibrary(f.store.read()), true);
});

test('concurrent editors use CAS; a losing draft is not applied', async () => {
  const f = await setup(); await grant(f);
  const results = await Promise.allSettled(['a', 'b'].map(content => f.service.savePage(f.editor, f.sid, f.pid, command({ expectedRevision: 1, title: '计划', content }))));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(results.find(row => row.status === 'rejected').reason.code, 'SPACE_REVISION_CONFLICT');
  assert.equal(f.service.page(f.owner, f.sid, f.pid).body.page.history.length, 2);
});

test('idempotent create and save, no content in operation receipts', async () => {
  const f = fixture(), body = command({ name: 'same' });
  const first = await f.service.create(f.owner, body), again = await f.service.create(f.owner, body);
  assert.equal(first.body.operation.receipt.entityId, again.body.operation.receipt.entityId); assert.equal(again.body.operation.replayed, true);
  assert.equal(f.service.list(f.owner).body.spaces.length, 1);
  await assert.rejects(f.service.create(f.owner, { ...body, name: 'different' }), code('SPACE_IDEMPOTENCY_CONFLICT'));
  assert.equal(JSON.stringify(f.store.read().workspaceSpaces.receipts).includes('same'), false);
});

test('duplicate save cannot disclose content after revocation', async () => {
  const f = await setup(); await grant(f);
  const body = command({ expectedRevision: 1, title: '计划', content: '编辑员草稿' });
  await f.service.savePage(f.editor, f.sid, f.pid, body);
  await f.service.revoke(f.owner, f.sid, command({ expectedRevision: f.service.read(f.owner, f.sid).body.space.revision, subject: 'editor' }));
  await assert.rejects(f.service.savePage(f.editor, f.sid, f.pid, body), code('SPACE_NOT_FOUND'));
  assert.throws(() => f.service.page(f.editor, f.sid, f.pid, 1), code('SPACE_NOT_FOUND'));
});

test('revocation invalidates previously prepared response and listing', async () => {
  const f = await setup(); await grant(f);
  const prepared = f.service.page(f.editor, f.sid, f.pid), listing = f.service.list(f.editor);
  await f.service.revoke(f.owner, f.sid, command({ expectedRevision: f.service.read(f.owner, f.sid).body.space.revision, subject: 'editor' }));
  assert.throws(prepared.assertCurrent, code('SPACE_NOT_FOUND')); assert.throws(listing.assertCurrent, code('SPACE_REVISION_CONFLICT'));
  assert.deepEqual(f.service.list(f.editor).body.spaces, []);
});

test('expiry invalidates shared reads and pending mutation', async () => {
  const f = await setup(); await grant(f, 'editor', 'editor', new Date(f.now() + 1).toISOString());
  const prepared = f.service.page(f.editor, f.sid, f.pid); f.tick(2);
  assert.throws(prepared.assertCurrent, code('SPACE_NOT_FOUND'));
  await assert.rejects(f.service.savePage(f.editor, f.sid, f.pid, command({ expectedRevision: 1, title: 'x', content: 'x' })), code('SPACE_NOT_FOUND'));
});

test('viewer cannot edit or be elevated beyond original membership', async () => {
  const f = await setup(); await grant(f, 'viewer', 'viewer');
  assert.equal(f.service.read(f.viewer, f.sid).body.space.canEdit, false);
  await assert.rejects(f.service.create(f.viewer, command({ name: 'bad' })), code('SPACE_NOT_FOUND'));
  await assert.rejects(f.service.savePage(f.viewer, f.sid, f.pid, command({ expectedRevision: 1, title: 'x', content: 'x' })), code('SPACE_NOT_FOUND'));
  await assert.rejects(grant(f, 'viewer', 'editor'), code('SPACE_SHARE_INVALID'));
});

test('editor cannot share; absent recipients and self sharing are refused', async () => {
  const f = await setup(); await grant(f);
  const payload = command({ expectedRevision: f.service.read(f.owner, f.sid).body.space.revision, subject: 'other', role: 'viewer', expiresAt: null });
  await assert.rejects(f.service.share(f.editor, f.sid, payload), code('SPACE_NOT_FOUND'));
  await assert.rejects(grant(f, 'missing', 'viewer'), code('SPACE_SHARE_INVALID'));
  await assert.rejects(grant(f, 'owner', 'viewer'), code('SPACE_SHARE_INVALID'));
});

test('cross-Space node lookup and hierarchy injection refused', async () => {
  const f = await setup(); const other = await f.service.create(f.other, command({ name: 'Other' }));
  const otherId = other.body.operation.receipt.spaceId;
  assert.throws(() => f.service.page(f.owner, otherId, f.pid), code('SPACE_NOT_FOUND'));
  await assert.rejects(f.service.createNode(f.other, otherId, command({ kind: 'page', parentId: f.pid, title: 'bad' })), code('SPACE_NOT_FOUND'));
});

test('a second enterprise in the same test Store cannot read first enterprise', async () => {
  const f = await setup(); f.sessions.set('foreign', { id: 'foreign', subject: 'foreign', role: 'admin', workspaceId: 'enterprise-b', expiresAt: f.now() + 100000 });
  const members = new Map([['foreign', 'admin']]); const service = createSpaceService({ ...f.options, workspaceId: 'enterprise-b', members });
  const foreign = { subject: 'foreign', role: 'admin', session: { id: 'foreign' } };
  f.members.set('foreign', 'admin');
  assert.deepEqual(service.list(foreign).body.spaces, []);
  assert.throws(() => service.page(foreign, f.sid, f.pid), code('SPACE_NOT_FOUND'));
});

test('tree moves refuse cycles; folder archive is not destructive cascade', async () => {
  const f = await setup(); const folder = await f.service.createNode(f.owner, f.sid, command({ kind: 'folder', parentId: null, title: '项目' }));
  const id = folder.body.operation.receipt.entityId;
  await f.service.moveNode(f.owner, f.sid, f.pid, command({ expectedRevision: 1, parentId: id }));
  await assert.rejects(f.service.moveNode(f.owner, f.sid, id, command({ expectedRevision: 1, parentId: f.pid })), code('SPACE_PARENT_NOT_FOLDER'));
  await assert.rejects(f.service.archiveNode(f.owner, f.sid, id, command({ expectedRevision: 1, archived: true })), code('SPACE_CHILDREN_ACTIVE'));
  await f.service.archiveNode(f.owner, f.sid, f.pid, command({ expectedRevision: 2, archived: true }));
  await f.service.archiveNode(f.owner, f.sid, id, command({ expectedRevision: 1, archived: true }));
  await assert.rejects(f.service.archiveNode(f.owner, f.sid, f.pid, command({ expectedRevision: 3, archived: false })), code('SPACE_PARENT_ARCHIVED'));
});

test('ancestor folder cannot be moved under a descendant folder', async () => {
  const f = await setup();
  const parent = await f.service.createNode(f.owner, f.sid, command({ kind: 'folder', parentId: null, title: 'ancestor' }));
  const child = await f.service.createNode(f.owner, f.sid, command({ kind: 'folder', parentId: parent.body.operation.receipt.entityId, title: 'descendant' }));
  await assert.rejects(f.service.moveNode(f.owner, f.sid, parent.body.operation.receipt.entityId,
    command({ expectedRevision: 1, parentId: child.body.operation.receipt.entityId })), code('SPACE_PARENT_CONFLICT'));
});

test('page is never a parent for a newly created page or folder', async () => {
  const f = await setup();
  for (const kind of ['page', 'folder']) {
    await assert.rejects(f.service.createNode(f.owner, f.sid, command({ kind, parentId: f.pid, title: 'invalid nested item' })), code('SPACE_PARENT_NOT_FOLDER'));
  }
  assert.equal(f.service.read(f.owner, f.sid).body.space.nodes.length, 1);
});

test('moving an existing node underneath a page is rejected without a write', async () => {
  const f = await setup();
  const folder = await f.service.createNode(f.owner, f.sid, command({ kind: 'folder', parentId: null, title: 'source folder' }));
  const id = folder.body.operation.receipt.entityId;
  await assert.rejects(f.service.moveNode(f.owner, f.sid, id, command({ expectedRevision: 1, parentId: f.pid })), code('SPACE_PARENT_NOT_FOLDER'));
  assert.equal(f.service.read(f.owner, f.sid).body.space.nodes.find(node => node.id === id).parentId, null);
});

test('persisted hierarchy with a page parent fails closed on restart/read', async () => {
  const f = await setup();
  await f.service.createNode(f.owner, f.sid, command({ kind: 'folder', parentId: null, title: 'source folder' }));
  f.corrupt(state => { state.workspaceSpaces.spaces[0].nodes[1].parentId = f.pid; });
  assert.throws(() => validateSpaceLibrary(f.store.read()), code('SPACE_STORAGE_INVALID'));
  assert.throws(() => f.service.read(f.owner, f.sid), code('SPACE_STORAGE_INVALID'));
  assert.throws(() => createSpaceService(f.options), code('SPACE_STORAGE_INVALID'));
});

test('archived page refuses edits and restores explicitly', async () => {
  const f = await setup(); await f.service.archiveNode(f.owner, f.sid, f.pid, command({ expectedRevision: 1, archived: true }));
  await assert.rejects(f.service.savePage(f.owner, f.sid, f.pid, command({ expectedRevision: 2, title: 'x', content: 'x' })), code('SPACE_ARCHIVED'));
  await f.service.archiveNode(f.owner, f.sid, f.pid, command({ expectedRevision: 2, archived: false }));
  assert.equal(f.service.page(f.owner, f.sid, f.pid).body.page.archived, false);
});

test('comments refer to exact saved versions and cannot forge actor', async () => {
  const f = await setup(); await grant(f);
  await f.service.comment(f.editor, f.sid, f.pid, command({ expectedRevision: 1, version: 1, body: '核对这个来源' }));
  const comment = f.service.page(f.owner, f.sid, f.pid).body.page.comments[0]; assert.equal(comment.createdBy, 'editor'); assert.equal(comment.version, 1);
  await assert.rejects(f.service.comment(f.editor, f.sid, f.pid, command({ expectedRevision: 2, version: 1, body: 'x', createdBy: 'owner' })), code('SPACE_INPUT'));
});

for (const [label, extra] of [['tenant', { workspaceId: 'b' }], ['role', { role: 'admin' }], ['permission', { approved: true }], ['receiver', { receiver: 'third-party' }], ['source', { references: [{ id: 'private-file' }] }]]) {
  test(`unknown ${label} input never expands scope`, async () => {
    const f = await setup(); await assert.rejects(f.service.savePage(f.owner, f.sid, f.pid, command({ expectedRevision: 1, title: 'x', content: 'x', ...extra })), code('SPACE_INPUT'));
  });
}

test('prototype, accessor, sparse array and oversized multibyte inputs refused', async () => {
  const f = fixture();
  await assert.rejects(f.service.create(f.owner, JSON.parse('{"requestId":"'+randomUUID()+'","name":"x","__proto__":{}}')), code('SPACE_INPUT'));
  const getter = command({}); Object.defineProperty(getter, 'name', { enumerable: true, get() { throw Error('must not execute getter'); } });
  await assert.rejects(f.service.create(f.owner, getter), code('SPACE_INPUT'));
  await assert.rejects(f.service.create(f.owner, command({ name: '中'.repeat(201) })), code('SPACE_INPUT'));
  await assert.rejects(f.service.create(f.owner, command({ name: new Array(1) })), code('SPACE_INPUT'));
  assert.equal(f.service.list(f.owner).body.spaces.length, 0);
});

test('caller mutation after enqueue does not alter admitted body or Session', async () => {
  const f = await setup(); const body = command({ expectedRevision: 1, title: '计划', content: 'approved' }), context = structuredClone(f.owner);
  const pending = f.service.savePage(context, f.sid, f.pid, body); body.content = 'injected'; context.session.id = 'other'; context.subject = 'other'; context.role = 'operator';
  await pending; assert.equal(f.service.page(f.owner, f.sid, f.pid).body.page.selected.content, 'approved');
});

test('original Session revocation and role changes deny queued writes', async () => {
  const f = await setup(); const pending = f.service.savePage(f.owner, f.sid, f.pid, command({ expectedRevision: 1, title: 'x', content: 'x' })); f.sessions.delete('owner');
  await assert.rejects(pending, code('SPACE_SESSION_REQUIRED'));
  assert.equal(f.store.read().workspaceSpaces.spaces[0].nodes[0].versions.length, 1);
});

test('recreating service reads existing Library state without a startup write', async () => {
  const f = await setup(), before = JSON.stringify(f.store.read());
  const reloaded = createSpaceService(f.options);
  assert.equal(reloaded.page(f.owner, f.sid, f.pid).body.page.selected.content, '版本一：先做研究。');
  assert.equal(JSON.stringify(f.store.read()), before);
});

test('stored version tampering fails before exposing body', async () => {
  const f = await setup(); f.corrupt(state => { state.workspaceSpaces.spaces[0].nodes[0].versions[0].content = 'tampered'; });
  assert.throws(() => f.service.page(f.owner, f.sid, f.pid), code('SPACE_STORAGE_INVALID'));
});

test('HTTP dispatcher rejects unknown verbs, paths, query and prototype actions', async () => {
  const f = await setup(); const args = { service: f.service, context: f.owner, pathname: `/api/library/spaces/${f.sid}/nodes/${f.pid}`, method: 'GET' };
  assert.equal((await spaceHttp(args)).body.page.id, f.pid);
  await assert.rejects(spaceHttp({ ...args, method: 'PUT' }), code('SPACE_METHOD'));
  await assert.rejects(spaceHttp({ ...args, query: { version: '01' } }), code('SPACE_QUERY'));
  await assert.rejects(spaceHttp({ ...args, pathname: args.pathname+'/constructor', method: 'POST' }), code('SPACE_ROUTE'));
  assert.equal(await spaceHttp({ ...args, pathname: '/api/library/company' }), null);
});

test('final HTTP output rechecks revocation after async original audit', async () => {
  const f = await setup(); await grant(f);
  let writes = 0;
  const req = { method: 'GET', url: `/api/library/spaces/${f.sid}/nodes/${f.pid}` };
  const res = { accessFinish: async () => { await f.service.revoke(f.owner, f.sid, command({ expectedRevision: f.service.read(f.owner, f.sid).body.space.revision, subject: 'editor' })); }, writeHead() { writes++; }, end() { writes++; } };
  await assert.rejects(handleSpaceHttp({ service: f.service, req, res, pathname: req.url, context: f.editor, access: { verifyBody() {} }, readBody: async () => ({}) }), code('SPACE_NOT_FOUND'));
  assert.equal(writes, 0);
});

test('original body proof and privacy filter cannot be skipped', async () => {
  const f = await setup(); const pathname = `/api/library/spaces/${f.sid}/nodes`;
  const args = { service: f.service, req: { method: 'POST', url: pathname }, res: { writeHead() { assert.fail('no response'); }, end() { assert.fail('no response'); } }, pathname, context: f.owner, access: { verifyBody() { assert.fail('no byte proof'); } }, readBody: async () => command({ kind: 'page', parentId: null, title: 'x' }) };
  await assert.rejects(handleSpaceHttp(args), code('SPACE_BODY_PROOF_REQUIRED'));
  const read = { ...args, req: { method: 'GET', url: `/api/library/spaces/${f.sid}` }, pathname: `/api/library/spaces/${f.sid}`, res: { ...args.res, filterWorkspaceResponse: () => undefined } };
  await assert.rejects(handleSpaceHttp(read), code('SPACE_NOT_FOUND'));
});

test('content extension never adds fields to the strict original Library', async () => {
  const f = fixture(), before = structuredClone(f.store.read().businessLibrary);
  await f.service.create(f.owner, command({ name: 'Separate content namespace' }));
  assert.deepEqual(f.store.read().businessLibrary, before);
  assert.equal(f.store.read().workspaceSpaces.version, 1);
});

test('detached list method still provides a valid final guard', async () => {
  const f = await setup(); const list = f.service.list; list(f.owner).assertCurrent();
});

test('original member role downgrade invalidates read and pending envelope', async () => {
  const f = await setup(); await grant(f); const prepared = f.service.page(f.editor, f.sid, f.pid);
  f.members.set('editor', 'viewer');
  assert.throws(prepared.assertCurrent, code('SPACE_SESSION_REQUIRED'));
});

test('committed POST with changed final response keeps an explicit reconcile outcome', async () => {
  const f = await setup(), pathname = `/api/library/spaces/${f.sid}/nodes`;
  const body = command({ kind: 'page', parentId: null, title: 'Original request', content: 'Only once' });
  const req = { method: 'POST', url: pathname, bodyBytes: Buffer.from(JSON.stringify(body)) };
  let writes = 0;
  const res = {
    async accessFinish() { await f.service.createNode(f.owner, f.sid, command({ kind: 'page', parentId: null, title: 'Concurrent change', content: '' })); },
    writeHead() { writes++; }, end() { writes++; },
  };
  await assert.rejects(handleSpaceHttp({ service: f.service, req, res, pathname, context: f.owner,
    access: { verifyBody(_context, bytes) { assert.deepEqual(bytes, req.bodyBytes); } },
    readBody: async () => body }), code('SPACE_RESPONSE_CHANGED'));
  assert.equal(writes, 0);
  const replay = await f.service.createNode(f.owner, f.sid, body);
  assert.equal(replay.body.operation.replayed, true);
  assert.equal(f.service.read(f.owner, f.sid).body.space.nodes.filter(node => node.title === 'Original request').length, 1);
  assert.equal(f.store.read().workspaceSpaces.receipts.filter(receipt => receipt.requestId === body.requestId).length, 1);
});


test('same Runtime bootstrap removes private pages even when Space is disabled', async () => {
  const f = await setup(), originalState = f.store.read();
  // The exact upstream projection spreads previously unknown Store fields.
  const original = { marker: 'original', bootstrap() { assert.equal(this.marker, 'original'); return { ...f.store.read(), runtime: { original: true } }; } };
  assert.ok(Object.hasOwn(original.bootstrap(), 'workspaceSpaces'));
  const runtime = bindSpaceSafeBootstrap(original);
  assert.equal(runtime, original);
  const view = runtime.bootstrap();
  assert.equal(Object.hasOwn(view, 'workspaceSpaces'), false);
  assert.deepEqual(view.businessLibrary, originalState.businessLibrary);
  assert.deepEqual(view.runtime, { original: true });
  assert.deepEqual(f.store.read(), originalState);
});

test('bootstrap adapter refuses a changed asynchronous output contract', () => {
  const runtime = bindSpaceSafeBootstrap({ bootstrap: () => Promise.resolve({ workspaceSpaces: 'private' }) });
  assert.throws(() => runtime.bootstrap(), /synchronous bootstrap/);
});

test('server operator explicitly enables Space only on signed enterprise Host', () => {
  assert.deepEqual(spaceStartupOptions({}, { mode: 'enterprise' }), { enabled: false });
  assert.deepEqual(spaceStartupOptions({ WORKSPACE_SPACE_ENABLED: '0' }, { mode: 'enterprise' }), { enabled: false });
  assert.deepEqual(spaceStartupOptions({ WORKSPACE_SPACE_ENABLED: '1' }, { mode: 'enterprise' }), { enabled: true });
  assert.throws(() => spaceStartupOptions({ WORKSPACE_SPACE_ENABLED: '1' }, { mode: 'local' }), /signed enterprise Host/);
  assert.throws(() => spaceStartupOptions({ WORKSPACE_SPACE_ENABLED: 'yes' }, { mode: 'enterprise' }), /exactly 0 or 1/);
});
