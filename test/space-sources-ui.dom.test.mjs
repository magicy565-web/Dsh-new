// Production React bundle against original signed enterprise HTTP/Store.
// JSDOM has no layout. Width values exercise responsive branches, NOT geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMedusaApprovedSource } from '../plugins/workspace-medusa-catalog/src/approved-source.mjs';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { bundleRenderer, wait, button, click, field, input, json } from './fixtures/conversation-ui.mjs';
const command = value => ({ requestId: randomUUID(), ...value });
async function fixture(t, { medusa = false } = {}) {
  let currentApp;
  const sourceId = randomUUID();
  const remoteRow = { context: { product_id: 'prod_ui_native', status: 'approved', review_version: 4, source_hash: 'd'.repeat(64) }, product: { id: 'prod_ui_native', title: 'UI原生Medusa产品' } };
  // Only this UI transport is an in-process Medusa response double. The separate
  // space-medusa-source suite tests actual HTTP with the same production reader.
  const medusaSource = medusa ? createMedusaApprovedSource({ connection: { reviewed: true, sourceId, workspaceId: 'pi-enterprise-test', baseURL: 'https://synthetic.invalid', readToken: 'synthetic-ui-only-read-token' },
    authorizeOriginal(actor) { return currentApp?.access.nativeSessionById(actor.session?.id)?.subject === actor.subject; },
    fetchImpl: async url => json(url.endsWith('?limit=100') ? { schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', count: 1, items: [remoteRow] } : { schema_version: '1.0', review_policy: 'medusa-product-context-current-source-v1', ...remoteRow }),
  }) : null;
  const f = await taskFixture(t, { enterprise: true, appOptions: { spaceOptions: { enabled: true, medusaSource } } }); currentApp = f.app;
  const actor = { subject: 'member-a', role: 'admin' };
  const product = (await f.app.businessLibrary.createProduct(command({ name: 'DOM合成产品' }), actor)).product;
  const added = await f.workspace('/api/library/spaces', { subject: actor.subject, body: command({ name: 'DOM验收Space' }) });
  const sid = added.json.operation.receipt.spaceId;
  const made = await f.workspace('/api/library/spaces/' + sid + '/nodes', { subject: actor.subject, body: command({ kind: 'page', parentId: null, title: 'DOM验收计划', content: 'PRIVATE_DOM_PLAN' }) });
  let lost = false;
  const renderer = await bundleRenderer(t, async (path, options = {}) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    const response = await f.workspace(path, { subject: actor.subject, body });
    if (lost && path.endsWith('/save')) { lost = false; throw Error('Synthetic response loss AFTER original disk commit'); }
    return json(response.json, response.status);
  });
  return { ...f, ...renderer, product, sid, pid: made.json.operation.receipt.entityId, loseNextSave() { lost = true; } };
}
async function openPanel(f, width, storage = []) {
  const ui = await f.render('/chat', { width, storage });
  ui.window.history.pushState({}, '', '/library/spaces');
  ui.window.dispatchEvent(new ui.window.PopStateEvent('popstate'));
  await wait(() => ui.document.querySelector('.space-panel select option[value="' + f.sid + '"]'), 'Space loaded');
  return ui;
}
async function openPage(f, width) {
  const ui = await openPanel(f, width);
  const select = ui.document.querySelector('.space-panel select');
  select.value = f.sid; select.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
  await wait(() => [...ui.document.querySelectorAll('.space-node-row button')].find(row => row.textContent.includes('DOM验收计划')), 'original page listed');
  await click(ui, [...ui.document.querySelectorAll('.space-node-row button')].find(row => row.textContent.includes('DOM验收计划')));
  await wait(() => field(ui, '正文')?.value === 'PRIVATE_DOM_PLAN', 'original private page read');
  return ui;
}
for (const width of [320, 390, 430]) test(`production DOM ${width}: select exact product, save, re-read, preserve on response loss and clear on session invalidation`, async t => {
  const f = await fixture(t), ui = await openPage(f, width);
  const summary = [...ui.document.querySelectorAll('summary')].find(row => row.textContent === '选择来源'); summary.click();
  await click(ui, button(ui, '查找来源'));
  await wait(() => button(ui, '引用'), 'source choices');
  await click(ui, button(ui, '引用'));
  assert.equal(button(ui, '保存修改').disabled, false);
  f.loseNextSave(); await click(ui, button(ui, '保存修改'));
  await wait(() => button(ui, '核对同一请求'), 'unknown original response remains explicit');
  const saved = f.app.spaceService;
  assert.equal(saved.status().configured, true);
  const before = f.app.store.read().workspaceSpaces.spaces[0].nodes[0].versions.length;
  await click(ui, button(ui, '核对同一请求'));
  await wait(() => ui.document.querySelector('.space-editor')?.textContent.includes('版本一致') && !button(ui, '核对同一请求'), 'same request reconciliation');
  assert.equal(f.app.store.read().workspaceSpaces.spaces[0].nodes[0].versions.length, before);
  const writes = f.requests.filter(row => row.path.endsWith('/save'));
  assert.equal(writes.length, 2); assert.equal(writes[0].body.requestId, writes[1].body.requestId);
  assert.deepEqual(writes[0].body.sources, [{ kind: 'product', id: f.product.id, revision: 1 }]);
  const browserStorage = JSON.stringify(ui.storage()) + JSON.stringify(Object.entries(ui.window.localStorage));
  assert.equal(browserStorage.includes('PRIVATE_DOM_PLAN'), false);
  assert.equal(browserStorage.includes('DOM合成产品'), false);
  await input(ui, field(ui, '正文'), 'UNSAVED_PRIVATE_DOM');
  ui.window.dispatchEvent(new ui.window.CustomEvent('workspace-session-required'));
  await wait(() => !ui.document.querySelector('.space-editor'), 'session invalidation clears private content');
  assert.equal(ui.document.body.textContent.includes('UNSAVED_PRIVATE_DOM'), false);
  assert.deepEqual(ui.errors, []);
});

test('production DOM refresh recovers a committed unknown save by requestId without storing or resending its body', async t => {
  const f = await fixture(t), ui = await openPage(f, 390);
  await input(ui, field(ui, '正文'), 'PRIVATE_REFRESH_COMMITTED');
  f.loseNextSave(); await click(ui, button(ui, '保存修改'));
  await wait(() => button(ui, '核对同一请求'), 'unknown save');
  const storage = ui.storage();
  assert.equal(JSON.stringify(storage).includes('PRIVATE_REFRESH_COMMITTED'), false);
  assert.equal(storage.filter(([key]) => key.startsWith('workspace-space-pending-v1:')).length, 1);
  const before = f.requests.filter(row => row.path.endsWith('/save')).length;
  const refreshed = await openPanel(f, 390, storage);
  await wait(() => button(refreshed, '核对同一请求') && !button(refreshed, '核对同一请求').disabled, 'refresh recovery control');
  await click(refreshed, button(refreshed, '核对同一请求'));
  await wait(() => field(refreshed, '正文')?.value === 'PRIVATE_REFRESH_COMMITTED', 'confirmed saved body re-read from original Host');
  assert.equal(f.requests.filter(row => row.path.endsWith('/save')).length, before);
  assert.equal(f.requests.some(row => row.path.startsWith('/api/library/spaces/operations/') && row.method === 'GET'), true);
  assert.equal(refreshed.storage().some(([key]) => key.startsWith('workspace-space-pending-v1:')), false);
  assert.equal(f.app.store.read().workspaceSpaces.spaces[0].nodes[0].versions.length, 2);
  assert.deepEqual(refreshed.errors, []);
});

test('production DOM selects a native Medusa approval reference and shows point-in-time verification', async t => {
  const f=await fixture(t,{medusa:true}),ui=await openPage(f,390);
  [...ui.document.querySelectorAll('summary')].find(row=>row.textContent==='选择来源').click();
  const kind=field(ui,'来源类型');kind.value='medusa-product';kind.dispatchEvent(new ui.window.Event('change',{bubbles:true}));
  await new Promise(resolve=>ui.window.setTimeout(resolve,0));
  await click(ui,button(ui,'查找来源'));await wait(()=>button(ui,'引用'),'native source listed');
  await click(ui,button(ui,'引用'));await click(ui,button(ui,'保存修改'));
  await wait(()=>ui.document.querySelector('.space-sources')?.textContent.includes('不代表持续锁定'),'point-in-time source metadata');
  const saved=f.app.store.read().workspaceSpaces.spaces[0].nodes[0].versions.at(-1).sources[0];
  assert.equal(saved.kind,'medusa-product');assert.equal(saved.id,'prod_ui_native');assert.equal(saved.revision,4);
  assert.equal(f.app.store.read().businessLibrary.products.length,1,'No native product copied into original Library');
  assert.equal(JSON.stringify(f.requests).includes('synthetic-ui-only-read-token'),false);assert.deepEqual(ui.errors,[]);
});
