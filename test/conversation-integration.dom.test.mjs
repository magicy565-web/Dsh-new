import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/store.mjs';

// Production React, original local HTTP and temporary NTFS persistence. The
// provider and optional native transport DTO are explicit offline fixtures.
// No browser geometry, original Host, account or PersonalAgent acceptance.
async function fixture(t, { model = false, originalNative = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-conversation-ui-'));
  let modelCalls = 0;
  const provider = { configured: model, provider: 'offline-ui-fixture', kind: 'fixture', complete: async () => {
    modelCalls++; assert.ok(model, 'No model call allowed in read/reference test');
    return { content: JSON.stringify({ done: true, content: 'Fixture task returned.', artifact: { filename: 'conversation-result.md', content: 'OFFLINE_FIXTURE_RESULT' } }) };
  } };
  const actor = originalNative ? { subject: 'local-operator', nativeAgentId: randomUUID() } : null;
  const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';
  if (actor) {
    const store = await openStore(directory), at = new Date().toISOString();
    await store.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Native fixture', status: 'idle', activeRunId: null, createdAt: at, updatedAt: at }));
    await store.close();
  }
  const options = { dataDirectory: directory, provider, ...(actor ? {
    museWorkerConfig: { workerId, ownerId: 'fixture-owner', tokenDigest: createHash('sha256').update('fixture-only-not-live').digest('hex'), enabled: false, scopeReviewed: false, externalBudgetVerified: false },
    museOriginalBinding: { actor, operators: [actor], expectedHost: 'fixture.test' },
  } : {}) };
  let app = await createApp(options), address = await app.listen(0);
  const requests = [], windows = [];
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/.test(name))), 'utf8');
  const url = route => `http://127.0.0.1:${address.port}${route}`;
  async function request(route, method = 'GET', body) {
    const response = await fetch(url('/api' + route), { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  }
  async function render(route = '/', width = 1366, nativeView, beforeFirstBootstrap) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: url(route), runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom; windows.push(window);
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
    Object.defineProperty(window, 'crypto', { value: webcrypto });
    window.TextEncoder = TextEncoder; window.AbortController = AbortController; window.scrollTo = () => {}; window.confirm = () => true;
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.fetch = async (route, options = {}) => {
      requests.push({ path: String(route), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
      if (nativeView && route === '/api/personal-worker') return new Response(JSON.stringify(nativeView), { headers: { 'Content-Type': 'application/json' } });
      const response = await fetch(new URL(route, url('/')), options);
      if (route === '/api/bootstrap' && beforeFirstBootstrap) { const action = beforeFirstBootstrap; beforeFirstBootstrap = undefined; await action(window); }
      if (nativeView && route === '/api/bootstrap') { const data = await response.json(); return new Response(JSON.stringify({ ...data, runtime: { ...data.runtime, cloudDot: true, cloudWorkerReady: false }, dotIntegration: { enabled: true } }), { headers: { 'Content-Type': 'application/json' } }); }
      return response;
    };
    window.eval(script);
    await wait(() => window.document.querySelector('.app-shell'), 'original workspace mounted');
    await wait(() => !window.document.querySelector('.loading-state'), 'bootstrap loaded');
    return { window, document: window.document, errors };
  }
  t.after(async () => { for (const window of windows) window.close(); await app.close(); assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'workspace-conversation-ui-')))); await rm(directory, { recursive: true, force: true }); });
  return { actor, workerId, request, render, requests, get app() { return app; }, get modelCalls() { return modelCalls; }, async restart() { await app.close(); app = await createApp(options); address = await app.listen(0); } };
}
async function wait(check, message) { for (let i = 0; i < 240; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 25)); } throw Error('Timed out: ' + message); }
function button(ui, text, root = ui.document) { return [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text); }
async function click(ui, element) { assert.ok(element, 'Expected UI control'); assert.notEqual(element.disabled, true); element.click(); await new Promise(r => ui.window.setTimeout(r, 0)); }
const aria = (ui, name) => ui.document.querySelector(`button[aria-label="${name}"]`);
const conversation = async (f, title) => (await f.request('/conversations', 'POST', { title })).conversation;

test('conversation entry opens the actual latest conversation without creating or executing another one', async t => {
  const f = await fixture(t); await conversation(f, 'Earlier fixture'); const latest = await conversation(f, 'Current fixture'); const ui = await f.render();
  await wait(() => ui.window.location.pathname === `/chat/${latest.id}` && ui.document.querySelector('.chat-title-pill span')?.textContent === 'Current fixture', 'latest actual conversation selected and rendered');
  assert.equal(ui.document.querySelector('.chat-title-pill span').textContent, 'Current fixture');
  for (const label of ['工作', '产品托管', '云端专家', '业务任务']) assert.equal(aria(ui, label), null);
  assert.equal(ui.document.querySelector('.master-control'), null); assert.equal(ui.document.querySelector('.download-placeholder'), null);
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
  assert.equal(ui.document.querySelectorAll('.conversation-spirit .control-spirit-stage').length, 1, 'existing central companion appears by default');
});

test('encoded slash/colon conversation routes retain the opaque ID for messages and each business API read', async t => {
  const f = await fixture(t), id = 'original/session:alpha', now = new Date().toISOString();
  // Explicit native-shaped record fixture, not a new real owner or binding.
  await f.app.store.update(state => state.conversations.push({ id, title: 'Opaque ID fixture', status: 'idle', createdAt: now, updatedAt: now }));
  const ui = await f.render('/chat/' + encodeURIComponent(id));
  assert.equal(ui.document.querySelector('.chat-title-pill span').textContent, 'Opaque ID fixture');
  for (const suffix of ['library-references', 'muse-delegations', 'procurement']) assert.ok(f.requests.some(item => item.path === `/api/conversations/${encodeURIComponent(id)}/${suffix}`));
  assert.ok(!f.requests.some(item => item.path.includes('%252F'))); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0);
  const invalid = await f.render('/chat/%ZZ'); assert.ok(invalid.document.body.textContent.includes('会话地址无效'));
  invalid.document.querySelector('.composer').dispatchEvent(new invalid.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []); assert.deepEqual(invalid.errors, []);
});

test('retired commerce entry opens the original product Library without mounting the old supply panel', async t => {
  const f = await fixture(t), ui = await f.render('/commerce');
  await wait(() => ui.document.querySelector('.business-library .bl-tabs [aria-current="page"]'), 'legacy entry resolves to original Library');
  assert.equal(ui.document.querySelector('.business-library h1').textContent, '资料库');
  assert.equal(ui.document.querySelector('.bl-tabs [aria-current="page"]').textContent, '产品库');
  assert.equal(ui.document.querySelector('.supply-network'), null);
  assert.equal(aria(ui, '产品托管'), null);
  await click(ui, button(ui, '企业资料'));
  await wait(() => ui.window.location.pathname === '/library/company' && ui.document.querySelector('.bl-tabs [aria-current="page"]')?.textContent === '企业资料', 'current Library navigation remains reachable');
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
});

test('initial latest-conversation selection preserves an already opened original settings dialog', async t => {
  const f = await fixture(t); await conversation(f, 'Existing latest fixture');
  const ui = await f.render('/', 1366, undefined, async window => {
    await wait(() => window.document.querySelector('button[aria-label="设置"]'), 'settings available while bootstrap loads');
    window.document.querySelector('button[aria-label="设置"]').click();
    await wait(() => window.document.querySelector('.settings-modal'), 'original settings opened before bootstrap returns');
  });
  assert.ok(ui.document.querySelector('.settings-modal')); assert.equal(ui.window.location.pathname, '/');
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
});

test('initial latest-conversation selection preserves Goals clicked as the first bootstrap becomes visible', async t => {
  const f = await fixture(t), current = await conversation(f, 'Early Goals fixture');
  await conversation(f, 'Latest fixture');
  const goal = (await f.request('/goals', 'POST', { title: 'Early Fixture Goal', description: 'Read without starting work', conversationId: current.id, maxSteps: 3 })).goal;
  let clicked = false;
  const ui = await f.render('/', 1366, undefined, async window => {
    // Hold the first response until the initial UI is mounted, then click in
    // the first loaded DOM commit, before its passive auto-selection effect.
    await wait(() => window.document.querySelector('.loading-state'), 'first bootstrap still loading');
    const observer = new window.MutationObserver(() => {
      if (window.document.querySelector('.loading-state')) return;
      observer.disconnect(); clicked = true;
      window.document.querySelector('button[aria-label="目标"]').click();
    });
    observer.observe(window.document.getElementById('root'), { childList: true, subtree: true });
    t.after(() => observer.disconnect());
  });
  await wait(() => clicked && ui.document.querySelector('.goal-list-item') && ui.document.querySelector('.app-shell[aria-busy="false"]'), 'explicit Goals navigation survives bootstrap auto-selection');
  assert.equal(ui.window.location.pathname, '/goals');
  assert.equal(ui.document.querySelector('.goal-list-item strong').textContent, goal.title);
  assert.equal((await f.request('/bootstrap')).goals.find(item => item.id === goal.id).status, 'draft');
  assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
});

test('conversation references select exact original product/document versions, persist and reopen without sending', async t => {
  const f = await fixture(t), current = await conversation(f, 'Resource fixture');
  const product = (await f.request('/library/products', 'POST', { requestId: randomUUID(), name: 'Fixture Product' })).product;
  const artifact = (await f.request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'profile.txt', content: 'INTERNAL_FIXTURE_PROFILE' })).artifact;
  const document = (await f.request('/library/documents', 'POST', { requestId: randomUUID(), title: 'Fixture Profile', asset: { artifactId: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256 } })).document;
  const ui = await f.render(`/chat/${current.id}`);
  await click(ui, button(ui, '选择产品或资料')); await wait(() => ui.document.querySelector('.bl-picker .bl-row'), 'original picker list');
  const productRow = [...ui.document.querySelectorAll('.bl-picker .bl-row')].find(row => row.querySelector('strong').textContent === product.name);
  await click(ui, productRow); await wait(() => button(ui, '选择此产品修订 1'), 'original product detail'); await click(ui, button(ui, '选择此产品修订 1'));
  await click(ui, button(ui, '企业资料')); await wait(() => [...ui.document.querySelectorAll('.bl-picker .bl-row')].some(row => row.querySelector('strong').textContent === document.title), 'original document list');
  await click(ui, [...ui.document.querySelectorAll('.bl-picker .bl-row')].find(row => row.querySelector('strong').textContent === document.title));
  await wait(() => button(ui, '选择此资料版本 v1'), 'original document detail'); await click(ui, button(ui, '选择此资料版本 v1'));
  await click(ui, button(ui, '保存关联并返回会话')); await wait(() => !ui.document.querySelector('.bl-picker'), 'saved reference closes');
  const saved = (await f.request(`/conversations/${current.id}/library-references`)).libraryReferences;
  assert.deepEqual(saved.products, [{ productId: product.id, productRevision: 1 }]); assert.deepEqual(saved.documents, [{ documentId: document.id, documentVersion: 1 }]);
  assert.equal(f.requests.filter(item => item.method === 'PATCH' && item.path.endsWith('/library-references')).length, 1);
  assert.equal(f.requests.filter(item => item.path.endsWith('/messages') || /delegate|dispatch/.test(item.path)).length, 0); assert.equal(f.modelCalls, 0);
  ui.window.close(); await f.restart(); const reopened = await f.render(`/chat/${current.id}`);
  await wait(() => reopened.document.querySelectorAll('.chat-library-chip').length === 2, 'pinned resources restored');
  assert.deepEqual((await f.request(`/conversations/${current.id}/library-references`)).libraryReferences, saved); assert.deepEqual(reopened.errors, []);
});

test('original task progress and actual persisted output appear only in their corresponding conversation', async t => {
  const f = await fixture(t, { model: true }), own = await conversation(f, 'Task fixture'), other = await conversation(f, 'Unrelated fixture');
  await f.request(`/conversations/${own.id}/messages`, 'POST', { requestId: randomUUID(), content: 'Explicit offline task test', workspaceExecution: true });
  await wait(async () => (await f.request('/bootstrap')).runs?.some(run => run.conversationId === own.id && run.status === 'succeeded'), 'original fixture Run succeeded');
  const ui = await f.render(`/chat/${own.id}`); await wait(() => ui.document.querySelector('.conversation-run'), 'corresponding original Run card');
  await click(ui, ui.document.querySelector('.conversation-run summary'));
  const link = ui.document.querySelector('.run-output-link'); assert.ok(link); assert.ok(link.textContent.includes('conversation-result.md'));
  assert.equal(await (await fetch(new URL(link.getAttribute('href'), ui.window.location.href))).text(), 'OFFLINE_FIXTURE_RESULT');
  const unrelated = await f.render(`/chat/${other.id}`); assert.equal(unrelated.document.querySelector('.conversation-run'), null); assert.equal(unrelated.document.querySelector('.run-output-link'), null);
  assert.equal(f.modelCalls, 1, 'reading and navigation cannot execute the provider again'); assert.deepEqual(ui.errors, []); assert.deepEqual(unrelated.errors, []);
});

test('original Goals and grouped activity open the corresponding conversation without starting work', async t => {
  const f = await fixture(t), current = await conversation(f, 'Goal fixture'); await conversation(f, 'Latest fixture');
  const goal = (await f.request('/goals', 'POST', { title: 'Fixture Goal', description: 'Do not execute automatically', conversationId: current.id, maxSteps: 3 })).goal;
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  await f.app.store.update(state => state.activity.push({ id: randomUUID(), type: 'conversation', title: 'Fixture yesterday event', conversationId: current.id, createdAt: yesterday }));
  const ui = await f.render(); await click(ui, aria(ui, '目标')); await wait(() => ui.document.querySelector('.goal-list-item'), 'original simple goal list');
  assert.equal(ui.document.querySelector('.goal-categories'), null); await click(ui, ui.document.querySelector('.goal-list-item'));
  await wait(() => ui.window.location.pathname === `/chat/${current.id}`, 'goal opens its actual conversation');
  assert.equal((await f.request('/bootstrap')).goals.find(item => item.id === goal.id).status, 'draft');
  await wait(() => [...ui.document.querySelectorAll('.assistant-panel .activity-date')].some(item => item.textContent === '昨天'), 'stored yesterday event grouped');
  assert.ok([...ui.document.querySelectorAll('.assistant-panel .activity-date')].some(item => item.textContent === '今天'));
  assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []);
});

test('320 and 390 px entry has one conversation and mutually exclusive original side drawers', async t => {
  const f = await fixture(t); await conversation(f, 'Mobile fixture');
  for (const width of [320, 390]) {
    const ui = await f.render('/', width); assert.equal(ui.document.querySelector('.assistant-panel'), null); assert.equal(ui.document.querySelector('.conversation-sidebar'), null);
    await click(ui, ui.document.querySelector('.chat-title-pill')); assert.ok(ui.document.querySelector('.conversation-sidebar'));
    await click(ui, aria(ui, '显示助手面板')); assert.equal(ui.document.querySelector('.conversation-sidebar'), null); assert.ok(ui.document.querySelector('.assistant-panel'));
    await click(ui, ui.document.querySelector('.chat-title-pill')); assert.ok(ui.document.querySelector('.conversation-sidebar')); assert.equal(ui.document.querySelector('.assistant-panel'), null);
    ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(() => !ui.document.querySelector('.conversation-sidebar'), 'Escape closes mobile drawer');
    assert.equal(ui.document.querySelectorAll('textarea[aria-label="输入消息"]').length, 1); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0); assert.deepEqual(ui.errors, []);
  }
});

test('original native task DTO and checked receipt stay in their conversation with no automatic dispatch', async t => {
  // Receipt UI requires the actual reviewed owner binding, including for this
  // offline DTO. An unbound native receipt is now correctly private by default.
  const f = await fixture(t, { originalNative: true }), current = { id: f.actor.nativeAgentId }, other = await conversation(f, 'Other native fixture');
  const file = { id: 'fixture-file', version: 1, sha256: 'a'.repeat(64), filename: 'fixture-receipt.md' };
  const receipt = { schema: 'workspace.muse.session-receipt.v1', nativeAgentId: current.id, orderId: 'fixture-order', workerId: f.workerId, taskRef: 'fixture-task', attemptId: 'fixture-attempt', requestId: 'fixture-request', submitRequestId: 'fixture-submit', fence: 1, submitHash: 'b'.repeat(64), reportSha256: 'c'.repeat(64), independentlyVerified: false, files: [file] };
  const hash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), now = new Date().toISOString();
  await f.app.store.update(state => state.messages.push({ id: randomUUID(), conversationId: current.id, role: 'assistant', status: 'complete', content: 'Explicit native DTO fixture', createdAt: now, museOrderId: receipt.orderId, museReceiptHash: hash, museReceipt: receipt }));
  const task = { agentKind: 'muse', orderId: receipt.orderId, nativeAgentId: current.id, requestId: receipt.requestId, workerId: receipt.workerId, taskRef: receipt.taskRef, attemptId: receipt.attemptId, fence: 1, status: 'review_required', executionStatus: 'submitted', leaseUntil: null, createdAt: now, updatedAt: now, deadlineAt: new Date(Date.now() + 3600000).toISOString(), serviceId: 'fixture', product: 'Fixture product', market: 'Fixture market', objective: 'Fixture task objective', budgetCredits: 5, summary: 'Fixture receipt', receipt: { files: [file] }, receiptHash: hash, returnedHash: hash, acceptedAt: null, independentlyVerified: false };
  const view = { enabled: true, canDelegate: false, worker: null, delegations: [], dotTasks: [], museTasks: [task] };
  const ui = await f.render(`/chat/${current.id}`, 1366, view);
  await wait(() => ui.document.querySelector('.message-row .cloud-file'), 'original receipt hash and exact task linkage checked');
  const link = ui.document.querySelector('.message-row .cloud-file'); assert.equal(link.getAttribute('href'), `/api/muse-worker-files/${file.id}?version=1&sha256=${file.sha256}`);
  assert.equal(ui.document.querySelector('.master-control'), null); assert.ok(ui.document.querySelector('.conversation-task-controls .conversation-task-list').textContent.includes('Fixture task objective'));
  assert.equal(aria(ui, '准备云端委托').disabled, true); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0);
  const unrelated = await f.render(`/chat/${other.id}`, 1366, view); assert.equal(unrelated.document.querySelector('.message-row .cloud-file'), null); assert.ok(!unrelated.document.querySelector('.conversation-task-controls .conversation-task-list').textContent.includes('Fixture task objective'));
  assert.equal(f.modelCalls, 0); assert.deepEqual(ui.errors, []); assert.deepEqual(unrelated.errors, []);
});
