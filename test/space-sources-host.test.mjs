// Original Node24 Host, AccessControl/Ed25519 ingress, CSRF, Library,
// Artifacts and on-disk Store. Users/data and the UNUSED faux model are fixtures.
// No remote Medusa, Docling, actual model, external Worker or paid request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { createSpaceService, validateSpaceLibrary } from '../server/space-core.mjs';
import { openStore } from '../server/store.mjs';
const command = extra => ({ requestId: randomUUID(), ...extra });
const code = value => error => error.code === value;
async function fixture(t) {
  const f = await taskFixture(t, { enterprise: true, appOptions: { spaceOptions: { enabled: true } } });
  const actor = { subject: 'member-a', role: 'admin' };
  const product = (await f.app.businessLibrary.createProduct(command({ name: '验收制冰机', description: 'SYNTHETIC', category: 'appliance' }), actor)).product;
  const file = await f.app.artifacts.create(command({ filename: 'synthetic-specification.txt', content: 'SYNTHETIC FILE BODY MUST NOT ENTER PAGE REFERENCES' }));
  const document = (await f.app.businessLibrary.createDocument(command({ title: '验收规格书', slotKey: 'specification', asset: { artifactId: file.artifact.id, version: 1, sha256: file.artifact.sha256 } }), actor)).document;
  const response = await f.workspace('/api/library/spaces', { subject: 'member-a', body: command({ name: '合成验收项目' }) });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const sid = response.json.operation.receipt.spaceId, base = '/api/library/spaces/' + sid;
  const call = (suffix = '', body, subject = 'member-a', headers) => f.workspace(base + suffix, { body, subject, headers });
  const products = await call('/sources?kind=product'), documents = await call('/sources?kind=document');
  assert.equal(products.status, 200); assert.equal(documents.status, 200);
  const pins = [products.json.items[0].reference, documents.json.items[0].reference];
  const made = await call('/nodes', command({ kind: 'page', parentId: null, title: '试点计划', content: 'SYNTHETIC PAGE', sources: pins }));
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const pid = made.json.operation.receipt.entityId;
  return { ...f, actor, product, document, sid, pid, base, call, pins };
}

test('signed enterprise HTTP: sources, page versions, CSRF, sharing and revocation', async t => {
  const f = await fixture(t);
  const denied = await f.call('/nodes/' + f.pid, undefined, 'member-b');
  assert.equal(denied.status, 404);
  assert.equal((await f.call('/sources?kind=document', undefined, 'member-b')).status, 404);
  const csrf = await f.call('/nodes/' + f.pid + '/save', command({ expectedRevision: 1, title: 'bad', content: 'bad', sources: [] }), 'member-a', { 'X-CSRF-Token': 'incorrect' });
  assert.equal(csrf.status, 403);
  assert.equal(f.app.spaceService.status().modelAccess, false);
  const page = await f.call('/nodes/' + f.pid);
  assert.equal(page.json.page.sourceResolution.every(row => row.status === 'current'), true);
  assert.equal(JSON.stringify(page.json).includes('FILE BODY MUST NOT'), false);
  assert.equal(JSON.stringify(page.json).includes('SYNTHETIC FILE'), false);
  assert.deepEqual(page.json.page.selected.sources, f.pins);
  const revision = (await f.call()).json.space.revision;
  assert.equal((await f.call('/share', command({ expectedRevision: revision, subject: 'member-b', role: 'editor', expiresAt: null }))).status, 200);
  assert.equal((await f.call('/nodes/' + f.pid, undefined, 'member-b')).status, 200);
  const save = command({ expectedRevision: 1, title: '新计划', content: 'new', sources: f.pins });
  assert.equal((await f.call('/nodes/' + f.pid + '/save', save, 'member-b')).status, 200);
  assert.equal((await f.call('/nodes/' + f.pid + '/save', save, 'member-b')).json.operation.replayed, true);
  assert.equal((await f.call('/revoke', command({ expectedRevision: (await f.call()).json.space.revision, subject: 'member-b' }))).status, 200);
  assert.equal((await f.call('/nodes/' + f.pid + '?version=1', undefined, 'member-b')).status, 404);
  assert.equal((await f.call('/nodes/' + f.pid + '/save', save, 'member-b')).status, 404);
  assert.equal((await f.call('/sources?kind=product', undefined, 'member-b')).status, 404);
});

test('source changes fail admission; history and restore preserve old pins without treating them as current', async t => {
  const f = await fixture(t);
  await f.app.businessLibrary.updateProduct(f.product.id, command({ expectedRevision: 1, changes: { name: 'NEW PRIVATE TITLE' } }), f.actor);
  const stale = await f.call('/nodes/' + f.pid + '/save', command({ expectedRevision: 1, title: 'bad', content: 'bad', sources: f.pins }));
  assert.equal(stale.status, 409); assert.equal(stale.json.error.code, 'SPACE_SOURCE_CHANGED');
  const view = (await f.call('/nodes/' + f.pid)).json.page;
  assert.equal(view.revision, 1); assert.equal(view.sourceResolution[0].status, 'updated');
  assert.equal(JSON.stringify(view).includes('NEW PRIVATE TITLE'), false);
  // A text-only edit preserves the exact old pins, rather than silently upgrading.
  assert.equal((await f.call('/nodes/' + f.pid + '/save', command({ expectedRevision: 1, title: '正文修改', content: 'new' }))).status, 200);
  assert.deepEqual((await f.call('/nodes/' + f.pid)).json.page.selected.sources, f.pins);
  assert.equal((await f.call('/nodes/' + f.pid + '/save', command({ expectedRevision: 2, title: '移除', content: 'new', sources: [] }))).status, 200);
  assert.equal((await f.call('/nodes/' + f.pid + '/restore', command({ expectedRevision: 3, version: 1 }))).status, 200);
  const restored = (await f.call('/nodes/' + f.pid)).json.page;
  assert.deepEqual(restored.selected.sources, f.pins); assert.equal(restored.sourceResolution[0].status, 'updated');
  assert.equal(restored.selected.sha256, (await f.call('/nodes/' + f.pid + '?version=1')).json.page.selected.sha256);
  await f.app.businessLibrary.updateDocument(f.document.id, command({ expectedRevision: 1, changes: { status: 'archived' } }), f.actor);
  assert.equal((await f.call('/nodes/' + f.pid)).json.page.sourceResolution[1].status, 'archived');
  assert.equal((await f.call('/sources?kind=document')).json.items.length, 0);
});

test('source schemas, cross-Space enumeration, bounded pagination and exact Artifact pin', async t => {
  const f = await fixture(t);
  for (const query of ['kind=remote', 'kind=product&offset=-1', 'kind=product&workspaceId=foreign', 'kind=product&kind=document']) assert.equal((await f.call('/sources?' + query)).status, 400);
  const invalid = [
    [f.pins[0], f.pins[0]],
    [{ ...f.pins[0], workspaceId: 'foreign' }],
    [{ ...f.pins[1], asset: { ...f.pins[1].asset, sha256: 'f'.repeat(64) } }],
    [{ ...f.pins[1], documentVersion: 2 }],
    [{ ...f.pins[0], id: randomUUID() }],
  ];
  for (const sources of invalid) {
    const rejected = await f.call('/nodes/' + f.pid + '/save', command({ expectedRevision: 1, title: 'bad', content: 'bad', sources }));
    assert.ok([400, 409].includes(rejected.status), JSON.stringify(rejected.json));
  }
  const rows = await Promise.all(Array.from({ length: 22 }, (_, i) => f.app.businessLibrary.createProduct(command({ name: '分页 ' + i }), f.actor)));
  assert.equal(rows.length, 22);
  const first = (await f.call('/sources?kind=product')).json;
  assert.equal(first.items.length, 20); assert.equal(first.nextOffset, '20');
  const second = (await f.call('/sources?kind=product&offset=20')).json;
  assert.equal(second.items.length, 3); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.reference.id)).size, 23);
  assert.equal((await f.call('/nodes/' + f.pid)).json.page.revision, 1);
});

test('original Session source envelopes fail when source or Session changes before final delivery', async t => {
  const f = await fixture(t);
  const session = f.app.access.listSessions().sessions.find(row => row.subject === 'member-a');
  const actor = { ...f.actor, session: { id: session.id } };
  const before = f.app.spaceService.page(actor, f.sid, f.pid), choices = f.app.spaceService.sources(actor, f.sid, { kind: 'product' });
  await f.app.businessLibrary.updateProduct(f.product.id, command({ expectedRevision: 1, changes: { description: 'new' } }), f.actor);
  assert.throws(before.assertCurrent, code('SPACE_SOURCE_CHANGED'));
  // Selection does not expose descriptions; its revision still changes.
  assert.throws(choices.assertCurrent, code('SPACE_SOURCE_CHANGED'));
  const pending = f.app.spaceService.page(actor, f.sid, f.pid);
  await f.app.access.revokeSession({ subject: f.actor.subject, requestId: randomUUID() }, session.id);
  assert.throws(pending.assertCurrent, code('SPACE_SESSION_REQUIRED'));
});

test('exact source pins survive original Store cold reopen; hash covers source substitution', async t => {
  const f = await fixture(t);
  const state = f.app.store.read(); assert.equal(validateSpaceLibrary(state), true);
  const forged = structuredClone(state);
  forged.workspaceSpaces.spaces[0].nodes[0].versions[0].sources[0].revision++;
  assert.throws(() => validateSpaceLibrary(forged), code('SPACE_STORAGE_INVALID'));
  await f.app.close();
  const reopened = await openStore(f.directory);
  try {
    assert.equal(validateSpaceLibrary(reopened.read()), true);
    const source = reopened.read().workspaceSpaces.spaces[0].nodes[0].versions[0].sources;
    assert.deepEqual(source, f.pins);
    assert.equal(reopened.diagnostics().durability, 'confirmed');
    // Restart invalidates old AccessControl Sessions; no automatic identity migration.
    const service = createSpaceService({ store: reopened });
    assert.throws(() => service.list(f.actor), code('SPACE_UNCONFIGURED'));
  } finally { await reopened.close(); }
});

test('read-only operation recovery is bound to the original writer and current Space access', async t => {
  const f = await fixture(t);
  const save = command({ expectedRevision: 1, title: '已提交', content: 'PRIVATE RECOVERY BODY' });
  assert.equal((await f.call('/nodes/' + f.pid + '/save', save)).status, 200);
  const route = '/api/library/spaces/operations/' + save.requestId;
  const receipt = await f.workspace(route, { subject: 'member-a' });
  assert.equal(receipt.status, 200); assert.equal(receipt.json.operation.receipt.entityId, f.pid);
  assert.equal(JSON.stringify(receipt.json).includes('PRIVATE RECOVERY BODY'), false);
  assert.equal((await f.workspace(route, { subject: 'member-b' })).status, 404);
  assert.equal((await f.workspace('/api/library/spaces/operations/' + randomUUID(), { subject: 'member-a' })).json.error.code, 'SPACE_OPERATION_PENDING');
  assert.equal((await f.workspace(route + '?subject=member-a', { subject: 'member-a' })).status, 400);
  assert.equal((await f.call('/share', command({ expectedRevision: (await f.call()).json.space.revision, subject: 'member-b', role: 'editor', expiresAt: null }))).status, 200);
  const otherSave = command({ expectedRevision: 2, title: 'operator', content: 'operator' });
  assert.equal((await f.call('/nodes/' + f.pid + '/save', otherSave, 'member-b')).status, 200);
  assert.equal((await f.workspace('/api/library/spaces/operations/' + otherSave.requestId, { subject: 'member-b' })).status, 200);
  assert.equal((await f.call('/revoke', command({ expectedRevision: (await f.call()).json.space.revision, subject: 'member-b' }))).status, 200);
  assert.equal((await f.workspace('/api/library/spaces/operations/' + otherSave.requestId, { subject: 'member-b' })).status, 404);
});
