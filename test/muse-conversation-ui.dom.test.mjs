import assert from 'node:assert/strict';
import test from 'node:test';
import { museConversationFixture, actor, hash } from './fixtures/muse-conversation.mjs';
import { originalHttp, temporaryDirectory, removeTemporaryDirectory, bundleRenderer, wait, button, click, field, input, json } from './fixtures/conversation-ui.mjs';

// Production bundle + unchanged original Native binding/Desk/Store/artifacts.
// Bootstrap/session transport, configured actor and Muse sender remain explicit
// offline fixtures. This is not booting an original Host or testing an account.
async function fixture(t) {
  const directory = await temporaryDirectory(t, 'workspace-native-conversation-ui-');
  const native = await museConversationFixture(t, { diskDirectory: directory }), http = await originalHttp(t);
  t.after(() => removeTemporaryDirectory(directory, 'workspace-native-conversation-ui-'));
  const now = new Date().toISOString();
  await native.change(state => { state.conversations = [{ ...actor, id: actor.nativeAgentId, title: 'Original native fixture', createdAt: now, updatedAt: now, status: 'idle' }]; state.messages = []; });
  let losePrepare = false, readOverride, viewer = false, fileFault;
  const prefix = `/api/conversations/${actor.nativeAgentId}/muse-delegations`;
  const renderer = await bundleRenderer(t, async (path, options) => {
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : undefined;
    if (path === '/api/session' && viewer) { const session = await http.request(path); return json({ ...session, user: { ...session.user, role: 'viewer' } }); }
    if (path === '/api/bootstrap') {
      const base = await http.request(path), state = native.store.read();
      return json({ ...base, conversations: state.conversations, messages: state.messages, activity: state.activity, meta: state.meta });
    }
    if (path === prefix && method === 'GET') return json(readOverride || { delegations: await native.api().list() });
    if (path === prefix && method === 'POST') {
      let result;
      try { result = await native.api().prepare(body); } catch (error) { return json({ code: error.code, error: error.message }, error.status || 409); }
      if (losePrepare) { losePrepare = false; throw Error('Synthetic loss after original disk commit'); }
      return json(result, 201);
    }
    if (path.startsWith(prefix + '/') && method === 'POST') {
      const [id, operation] = path.slice(prefix.length + 1).split('/');
      try { return json(await native.api()[operation](id, body)); } catch (error) { return json({ code: error.code, error: error.message }, error.status || 409); }
    }
    if (path.startsWith('/api/muse-worker-files/')) {
      if (fileFault === 'denied') return json({ error: 'Explicit client transport denial fixture' }, 403);
      const url = new URL(path, 'http://fixture.test'), id = url.pathname.split('/').at(-1);
      const item = (await native.api().list()).find(item => item.receipt?.files.some(file => file.id === id));
      try { const result = await native.api().download(item?.orderId, { artifactId: id, version: Number(url.searchParams.get('version')), sha256: url.searchParams.get('sha256') }); return new Response(fileFault === 'tampered' ? Buffer.from('CORRUPTED_TRANSPORT_FIXTURE') : result.bytes); }
      catch (error) { return json({ code: error.code }, 404); }
    }
    return http.transport(path, options);
  });
  return { native, http, ...renderer, prefix, loseNextPrepare() { losePrepare = true; }, setRead(value) { readOverride = value; }, viewer() { viewer = true; }, fileFault(value) { fileFault = value; } };
}
async function preparedUi(f) {
  const ui = await f.render(`/chat/${actor.nativeAgentId}`);
  await wait(() => button(ui, '准备 Muse 委托') && !button(ui, '准备 Muse 委托').disabled, 'native read loaded');
  await click(ui, button(ui, '准备 Muse 委托'));
  for (const [label, value] of [['公开请求正文', 'Public UI fixture request'], ['公开产品说明', 'Public UI fixture product'], ['市场', 'US'], ['范围与验收要求', 'Offline protocol validation only.'], ['明确截止时间', new Date(Date.now() + 86400000).toISOString().slice(0, 16)]]) await input(ui, field(ui, label), value);
  await click(ui, ui.document.querySelector('[role="dialog"] input[type="checkbox"]'));
  return ui;
}
async function authorize(ui, openLabel, commitLabel) {
  await wait(() => button(ui, openLabel) && !button(ui, openLabel).disabled, openLabel);
  await click(ui, button(ui, openLabel)); const modal = ui.document.querySelector('[role="dialog"]');
  await wait(() => !modal.querySelector('input[type="checkbox"]').disabled, 'current review read loaded');
  await click(ui, modal.querySelector('input[type="checkbox"]')); await wait(() => !button(ui, commitLabel, modal).disabled, 'confirmed action ready'); await click(ui, button(ui, commitLabel, modal));
  await wait(() => !ui.document.querySelector('[role="dialog"]'), 'confirmed action committed');
}
test('conversation UI prepares, separately approves/dispatches, reconciles one original task and accepts only its returned receipt', async t => {
  const f = await fixture(t), ui = await preparedUi(f);
  assert.equal((f.native.store.read().workerOrders || []).length, 0); assert.equal((f.native.store.read().museTasks || []).length, 0);
  await click(ui, button(ui, '准备待审原订单')); await wait(() => !ui.document.querySelector('[role="dialog"]'), 'draft prepared');
  let item = (await f.native.api().list())[0]; assert.equal(item.phase, 'review_required'); assert.equal((f.native.store.read().museTasks || []).length, 0);
  const id = item.orderId;
  await authorize(ui, '审阅并批准范围', '批准此范围'); assert.equal((await f.native.api().get(id)).phase, 'approved'); assert.equal((f.native.store.read().museTasks || []).length, 0);
  await authorize(ui, '确认派发原订单', '派发此原订单'); assert.equal((await f.native.api().get(id)).phase, 'queued'); assert.equal(f.native.store.read().museTasks.length, 1);
  const claim = (await f.native.call(id, 'claim', { requestId: 'synthetic-ui-worker-claim' })).body;
  await wait(() => !button(ui, '核对原任务状态').disabled, 'state read loaded'); await click(ui, button(ui, '核对原任务状态'));
  await wait(() => ui.document.querySelector(`[data-order-id="${id}"]`)?.textContent.includes('已领取，模型启动未证实'), 'claimed is not model startup');
  const file = await f.native.deliver(id, claim); await click(ui, button(ui, '核对原任务状态'));
  await wait(() => ui.document.querySelector('.conversation-native .cloud-file'), 'exact recorded file shown');
  assert.equal(button(ui, '审阅并人工验收'), undefined, 'recorded file cannot be accepted before original Session delivery');
  await f.native.relay.reconcile(); await click(ui, button(ui, '核对原任务状态'));
  await wait(() => button(ui, '审阅并人工验收'), 'durable original Session receipt');
  const link = ui.document.querySelector('.conversation-native .cloud-file');
  assert.equal(link.getAttribute('href'), `/api/muse-worker-files/${file.artifactId}?version=1&sha256=${hash(file.bytes)}`);
  assert.deepEqual(Buffer.from(await (await ui.window.fetch(link.getAttribute('href'))).arrayBuffer()), file.bytes);
  const wrong = await ui.window.fetch(link.getAttribute('href').replace('version=1', 'version=2')); assert.equal(wrong.status, 404);
  await authorize(ui, '审阅并人工验收', '人工验收此回执'); await f.native.restart();
  item = await f.native.api().get(id); assert.equal(item.phase, 'enterprise_accepted'); assert.equal(item.wake.observed, false); assert.equal(item.executionStartedAt, null);
  assert.equal(item.attemptId, claim.attemptId); assert.equal(item.fence, claim.fence); assert.equal(f.native.store.read().museTasks.length, 1); assert.equal(f.native.store.read().workerOrders.length, 1);
  const writes = f.requests.filter(item => item.method === 'POST');
  assert.deepEqual(writes.map(item => item.path.split('/').at(-1)), ['muse-delegations', 'approve', 'dispatch', 'refresh', 'refresh', 'refresh', 'accept']);
  for (const request of writes.filter(item => /\/(approve|dispatch|accept)$/.test(item.path))) assert.deepEqual(Object.keys(request.body).sort(), request.path.endsWith('/accept') ? ['confirmed', 'expectedReviewHash', 'receiptHash'] : ['confirmed', 'expectedReviewHash']);
  assert.equal(f.http.modelCalls, 0); assert.deepEqual(ui.errors, []);
});
test('lost prepare response survives disk restart/browser reopen and explicit retry preserves exact original request', async t => {
  const f = await fixture(t), ui = await preparedUi(f); f.loseNextPrepare();
  await click(ui, button(ui, '准备待审原订单')); await wait(() => button(ui, '核对原操作结果', ui.document.querySelector('[role="dialog"]')), 'reachable retry inside frozen dialog');
  assert.equal(field(ui, '公开产品说明').matches(':disabled'), true);
  assert.equal(f.native.store.read().workerOrders.length, 1); assert.equal((f.native.store.read().museTasks || []).length, 0);
  const storage = ui.storage(); ui.window.close(); await f.native.restart();
  const reopened = await f.render(`/chat/${actor.nativeAgentId}`, { storage });
  await wait(() => button(reopened, '核对原操作结果'), 'pending exact request restored');
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 1, 'reload must not replay');
  await click(reopened, button(reopened, '核对原操作结果'));
  try { await wait(() => !button(reopened, '核对原操作结果'), 'original commit reconciled'); }
  catch (error) { error.message += ': ' + reopened.document.querySelector('.conversation-native').textContent; throw error; }
  const writes = f.requests.filter(item => item.method === 'POST'); assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]);
  assert.equal(f.native.store.read().workerOrders.length, 1); assert.equal((f.native.store.read().museTasks || []).length, 0); assert.equal(reopened.storage().filter(([key]) => key.startsWith('workspace.muse-conversation.pending')).length, 0);
  assert.equal(f.http.modelCalls, 0); assert.deepEqual(reopened.errors, []);
});
test('viewer and mismatched original conversation DTO fail closed without dispatch or fallback', async t => {
  const f = await fixture(t); f.viewer(); const viewer = await f.render(`/chat/${actor.nativeAgentId}`);
  await wait(() => button(viewer, '准备 Muse 委托'), 'viewer read loaded'); assert.equal(button(viewer, '准备 Muse 委托').disabled, true);
  f.setRead({ delegations: [{ provider: 'muse', conversationId: 'other-session', orderId: 'untrusted-order' }] });
  const bad = await f.render(`/chat/${actor.nativeAgentId}`); await wait(() => bad.document.querySelector('.conversation-native').textContent.includes('格式不可核对'), 'mismatched DTO rejected');
  assert.equal(button(bad, '准备 Muse 委托'), undefined); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.http.modelCalls, 0);
  assert.deepEqual(viewer.errors, []); assert.deepEqual(bad.errors, []);
});

test('same-conversation attachment preview verifies exact original bytes, refuses corrupted/denied reads and preserves viewer guard', async t => {
  const f = await fixture(t), item = await f.native.approveAndDispatch(f.native.input('preview-disk-request'));
  const claim = (await f.native.call(item.orderId, 'claim', { requestId: 'preview-fixture-claim' })).body;
  const file = await f.native.deliver(item.orderId, claim); await f.native.api().refresh(item.orderId); await f.native.relay.reconcile();
  const ui = await f.render(`/chat/${actor.nativeAgentId}`);
  const control = () => ui.document.querySelector('.conversation-native button[aria-label="预览 result.json"]');
  await wait(() => control() && !control().disabled, 'original receipt preview control');
  assert.equal(ui.document.querySelectorAll('.conversation-spirit .control-spirit-stage').length, 1);
  f.fileFault('tampered'); await click(ui, control()); await wait(() => ui.document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('校验失败'), 'corrupted transport bytes rejected');
  assert.equal(ui.document.querySelector('[role="dialog"] pre'), null);
  await click(ui, ui.document.querySelector('[role="dialog"] button[aria-label="关闭弹窗"]'));
  f.fileFault('denied'); await click(ui, control()); await wait(() => ui.document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('无权'), 'denied client transport rejected');
  assert.equal(ui.document.querySelector('[role="dialog"] pre'), null);
  await click(ui, ui.document.querySelector('[role="dialog"] button[aria-label="关闭弹窗"]'));
  f.fileFault(undefined); await click(ui, control()); await wait(() => ui.document.querySelector('[role="dialog"] pre'), 'exact original content safely previewed');
  assert.equal(ui.document.querySelector('[role="dialog"] pre').textContent, file.bytes.toString('utf8'));
  assert.equal(ui.window.location.pathname, `/chat/${actor.nativeAgentId}`); assert.equal(ui.document.querySelector('[role="dialog"] script'), null);
  assert.ok(f.requests.filter(item => item.path.startsWith('/api/muse-worker-files/')).every(item => item.path === `/api/muse-worker-files/${file.artifactId}?version=1&sha256=${hash(file.bytes)}`));
  f.viewer(); const viewer = await f.render(`/chat/${actor.nativeAgentId}`); await wait(() => viewer.document.querySelector('.conversation-native [data-order-id]'), 'viewer can read order status');
  assert.equal(viewer.document.querySelector('button[aria-label="预览 result.json"]'), null); assert.equal(f.http.modelCalls, 0); assert.deepEqual(ui.errors, []); assert.deepEqual(viewer.errors, []);
});
