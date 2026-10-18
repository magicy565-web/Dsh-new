// Real original signed Host/Session/Store/Space and actual loopback HTTP.
// Medusa responses, users and business facts are finite synthetic fixtures;
// this is NOT a real Medusa/PostgreSQL, model or native SDK acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { createMedusaApprovedSource } from '../plugins/workspace-medusa-catalog/src/approved-source.mjs';
const command = row => ({ requestId: randomUUID(), ...row });
async function fixture(t) {
  const sourceId = randomUUID(), secret = 'synthetic-medusa-read-' + randomUUID();
  const state = { authorized: true, requests: [], status: 200, hook: null, echo: null, legacy: false,
    row: { context: { id: 'pctx_synthetic', product_id: 'prod_synthetic', status: 'approved', review_version: 2, source_hash: 'a'.repeat(64), commercial_policy: { private: 'PRIVATE_CONTEXT_POLICY' }, reviewed_by: 'PRIVATE_REVIEWER' },
      product: { id: 'prod_synthetic', title: 'SYNTHETIC Medusa 制冰机', description: 'PRIVATE_PRODUCT_DESCRIPTION', metadata: { private: true } } } };
  const remote = createServer(async (req, res) => {
    state.requests.push({ method: req.method, url: req.url });
    assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer ' + secret);
    if (state.hook) await state.hook(req.url);
    if (res.destroyed) return;
    const row = structuredClone(state.row); if (state.echo) row.product.title = state.echo;
    res.setHeader('content-type', 'application/json');
    if (state.status !== 200) { res.statusCode = state.status; res.end(JSON.stringify({ message: 'PRIVATE REMOTE ERROR ' + secret })); return; }
    if (req.url === '/agent/product-contexts?limit=100') return res.end(JSON.stringify({ schema_version: '1.0', review_policy: state.legacy ? undefined : 'medusa-product-context-current-source-v1', count: row.context.status === 'approved' ? 1 : 0, items: row.context.status === 'approved' ? [row] : [] }));
    if (req.url !== '/agent/product-contexts/prod_synthetic' || row.context.status !== 'approved') { res.statusCode = 404; return res.end('{}'); }
    res.end(JSON.stringify({ schema_version: '1.0', review_policy: state.legacy ? undefined : 'medusa-product-context-current-source-v1', ...row }));
  });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { remote.close(resolve); remote.closeAllConnections(); }));
  let app;
  const source = createMedusaApprovedSource({ connection: { reviewed: true, sourceId, workspaceId: 'pi-enterprise-test', baseURL: 'http://127.0.0.1:' + remote.address().port, readToken: secret, allowLoopbackHTTP: true },
    authorizeOriginal(actor) { const live = app?.access.nativeSessionById(actor.session?.id); return state.authorized && !!live && live.workspaceId === actor.workspaceId && live.subject === actor.subject && live.role === actor.role; } });
  const f = await taskFixture(t, { enterprise: true, appOptions: { spaceOptions: { enabled: true, medusaSource: source } } }); app = f.app;
  const call = (path, body, subject = 'member-a', headers) => f.workspace(path, { body, subject, headers });
  const added = await call('/api/library/spaces', command({ name: 'SYNTHETIC Medusa Space' }));
  assert.equal(added.status, 201, JSON.stringify(added.json));
  const sid = added.json.operation.receipt.spaceId, base = '/api/library/spaces/' + sid;
  const choices = await call(base + '/sources?kind=medusa-product');
  assert.equal(choices.status, 200, JSON.stringify(choices.json));
  const pin = choices.json.items[0].reference;
  return { ...f, state, secret, source, sid, base, pin, call, choices };
}
async function page(f) {
  const body = command({ kind: 'page', parentId: null, title: 'SYNTHETIC 原生产品试点', content: 'PAGE ONLY', sources: [f.pin] });
  const result = await f.call(f.base + '/nodes', body);
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return { body, id: result.json.operation.receipt.entityId, route: f.base + '/nodes/' + result.json.operation.receipt.entityId };
}

test('native Medusa IDs and approval fingerprints reach original Space without copying product authority or secrets', async t => {
  const f = await fixture(t), before = structuredClone(f.app.store.read().businessLibrary.products);
  assert.equal(f.pin.kind, 'medusa-product'); assert.equal(f.pin.id, 'prod_synthetic'); assert.equal(f.pin.revision, 2);
  assert.equal(f.choices.json.boundedRemoteItems, 100);
  for (const text of [f.secret, 'PRIVATE_REVIEWER', 'PRIVATE_CONTEXT_POLICY', 'PRIVATE_PRODUCT_DESCRIPTION']) assert.equal(JSON.stringify(f.choices.json).includes(text), false);
  const p = await page(f), result = await f.call(p.route);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.page.sourceResolution[0].status, 'current');
  assert.equal(result.json.page.sourceResolution[0].consistency, 'remote-point-in-time');
  assert.equal(typeof result.json.page.sourceResolution[0].checkedAt, 'string');
  assert.deepEqual(result.json.page.selected.sources, [f.pin]);
  assert.deepEqual(f.app.store.read().businessLibrary.products, before);
  assert.equal(JSON.stringify(f.app.store.read().workspaceSpaces).includes('SYNTHETIC Medusa 制冰机'), false, 'Only reference pins are persisted');
  assert.equal(f.app.spaceService.status().modelAccess, false);
  assert.equal(f.state.requests.every(row => row.method === 'GET'), true);
});

test('changed approval, withdrawal and saturated numeric version cannot reuse a stale pin or overwrite a page', async t => {
  const f = await fixture(t), p = await page(f);
  f.state.row.context.source_hash = 'b'.repeat(64); f.state.row.product.title = 'PRIVATE_CHANGED_TITLE';
  let result = await f.call(p.route);
  assert.equal(result.json.page.sourceResolution[0].status, 'updated');
  assert.equal(JSON.stringify(result.json).includes('PRIVATE_CHANGED_TITLE'), false);
  result = await f.call(p.route + '/save', command({ expectedRevision: 1, title: 'bad', content: 'bad', sources: [f.pin] }));
  assert.equal(result.status, 409); assert.equal(result.json.error.code, 'SPACE_SOURCE_CHANGED');
  assert.equal(f.app.store.read().workspaceSpaces.spaces[0].nodes[0].versions.length, 1);
  f.state.row.context.status = 'ready_for_review';
  assert.equal((await f.call(p.route)).json.page.sourceResolution[0].status, 'unavailable');
  assert.equal((await f.call(f.base + '/sources?kind=medusa-product')).json.items.length, 0);
  f.state.row.context.status = 'approved'; f.state.row.context.review_version = 2147483647;
  f.state.row.context.source_hash = 'rev:' + 'c'.repeat(32) + ':' + 'd'.repeat(64);
  const pin = (await f.call(f.base + '/sources?kind=medusa-product')).json.items[0].reference;
  assert.equal((await f.call(p.route + '/save', command({ expectedRevision: 1, title: 'new', content: 'new', sources: [pin] }))).status, 200);
  f.state.row.context.source_hash = 'rev:' + 'e'.repeat(32) + ':' + 'd'.repeat(64);
  assert.equal((await f.call(p.route)).json.page.sourceResolution[0].status, 'updated');
});

test('original Space membership, CSRF, source binding and current source authorization gate actual reads', async t => {
  const f = await fixture(t), p = await page(f); let n = f.state.requests.length;
  assert.equal((await f.call(f.base + '/sources?kind=medusa-product', undefined, 'member-b')).status, 404);
  assert.equal((await f.call(p.route + '/save', command({ expectedRevision: 1, title: 'bad', content: 'bad', sources: [f.pin] }), 'member-a', { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal(f.state.requests.length, n);
  assert.equal((await f.call(p.route + '/save', command({ expectedRevision: 1, title: 'bad', content: 'bad', sources: [{ ...f.pin, sourceId: randomUUID() }] }))).status, 409);
  assert.equal(f.state.requests.length, n);
  assert.equal((await f.call(f.base + '/sources?kind=medusa-product&offset=-1')).status, 400);
  assert.equal(f.state.requests.length, n);
  f.state.authorized = false;
  assert.equal((await f.call(p.route)).status, 403);
  assert.equal(f.state.requests.length, n);
});

test('source approval changed after durable commit returns unknown confirmation; same request and GET receipt never duplicate', async t => {
  const f = await fixture(t); let reads = 0;
  f.state.hook = async path => { if (path.endsWith('/prod_synthetic') && ++reads === 2) f.state.row.context.source_hash = 'e'.repeat(64); };
  const body = command({ kind: 'page', parentId: null, title: 'uncertain', content: '', sources: [f.pin] });
  const added = await f.call(f.base + '/nodes', body);
  assert.equal(added.status, 409); assert.equal(added.json.error.code, 'SPACE_RESPONSE_CHANGED');
  assert.equal(f.app.store.read().workspaceSpaces.spaces[0].nodes.length, 1);
  const replay = await f.call(f.base + '/nodes', body);
  assert.equal(replay.status, 200, JSON.stringify(replay.json)); assert.equal(replay.json.operation.replayed, true);
  assert.equal(f.app.store.read().workspaceSpaces.spaces[0].nodes.length, 1);
  const receipt = await f.call('/api/library/spaces/operations/' + body.requestId);
  assert.equal(receipt.status, 200); assert.equal(reads, 2, 'Receipt reconciliation does not reread or mutate remote products');
});

test('source authorization revoked during actual HTTP read withholds private response', async t => {
  const f = await fixture(t), p = await page(f);
  f.state.hook = async path => { if (path.endsWith('/prod_synthetic')) f.state.authorized = false; };
  const result = await f.call(p.route);
  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(result.json).includes('SYNTHETIC Medusa 制冰机'), false);
});

test('remote errors and raw/encoded credential echoes never become source titles, errors or browser data', async t => {
  const f = await fixture(t);
  for (const echo of [f.secret, encodeURIComponent(f.secret), Buffer.from(f.secret).toString('base64'), Buffer.from(f.secret).toString('hex')]) {
    f.state.echo = echo;
    const result = await f.call(f.base + '/sources?kind=medusa-product');
    assert.equal(result.status, 503); assert.equal(JSON.stringify(result.json).includes(echo), false);
  }
  f.state.echo = null; f.state.status = 503;
  const result = await f.call(f.base + '/sources?kind=medusa-product');
  assert.equal(result.status, 503); assert.equal(JSON.stringify(result.json).includes(f.secret), false);
});

test('reader installation is inert and refuses unreviewed or foreign enterprise authority', async () => {
  let calls = 0;
  const source = createMedusaApprovedSource({ fetchImpl: async () => { calls++; throw Error(); } });
  assert.equal(source.binding, null); assert.equal(calls, 0);
  await assert.rejects(source.read('prod_synthetic', { workspaceId: 'other' }), error => error.code === 'MEDUSA_APPROVED_SOURCE_UNCONFIGURED');
  assert.equal(calls, 0);
  assert.throws(() => createMedusaApprovedSource({ connection: { reviewed: false } }));
});

test('legacy Medusa endpoints without the current-source review policy marker are rejected', async t => {
 const f=await fixture(t);f.state.legacy=true;
 const result=await f.call(f.base+'/sources?kind=medusa-product');
 assert.equal(result.status,503);assert.equal(result.json.items,undefined);
});

test('an installed unconfigured reader leaves original Space usable and returns an honest Medusa setup state', async t => {
 const f=await taskFixture(t,{enterprise:true,appOptions:{spaceOptions:{enabled:true,medusaSource:createMedusaApprovedSource()}}});
 const added=await f.workspace('/api/library/spaces',{subject:'member-a',body:command({name:'Unconfigured source Space'})});
 assert.equal(added.status,201);
 const id=added.json.operation.receipt.spaceId;
 const result=await f.workspace('/api/library/spaces/'+id+'/sources?kind=medusa-product',{subject:'member-a'});
 assert.equal(result.status,503);assert.equal(result.json.error.code,'SPACE_MEDUSA_UNCONFIGURED');
});
