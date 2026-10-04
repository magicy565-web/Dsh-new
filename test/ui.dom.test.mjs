import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import http from 'node:http';
import { Readable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

// DOM/HTTP integration: production React bundle + real persisted local server.
// Rendering is jsdom (not a visual browser); only the model provider is injected.
// AbortController matches Node fetch in this cross-realm harness, not a browser polyfill.
async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-ui-dom-'));
  const requests = [];
  const provider = { configured: false, complete: async () => ({ content: JSON.stringify({ done: true, content: '测试提供方生成的学习计划：每天阅读一章。' }) }) };
  const app = await createApp({ dataDirectory: directory, provider, ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  return {
    get state() { return app.runtime.bootstrap(); },
    requests, provider, base, app,
    async fetch(path, options = {}) {
      requests.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : {} });
      return fetch(new URL(path, base), options);
    },
    async close() { await app.close(); await rm(directory, { recursive: true, force: true }); }
  };
}
async function waitFor(check, description) { for (let i = 0; i < 180; i++) { if (check()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error(`Timed out: ${description}`); }
function controls(window) {
  const document = window.document;
  const button = (text, root = document) => Array.from(root.querySelectorAll('button')).find(el => el.textContent.trim() === text);
  const aria = label => document.querySelector(`button[aria-label="${label}"], input[aria-label="${label}"], textarea[aria-label="${label}"], select[aria-label="${label}"]`);
  const click = element => { assert.ok(element, 'Expected element to click'); element.click(); return new Promise(resolve => window.setTimeout(resolve, 0)); };
  const input = (element, value) => { assert.ok(element, 'Expected editable element'); const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return new Promise(resolve => window.setTimeout(resolve, 0)); };
  const escape = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { document, button, aria, click, input, escape };
}

// This single sequential scenario deliberately covers interrupted/repeated flows
// against the same rendered React tree and persisted server, not snapshot assertions.
test('production UI: navigation, interrupted goal intake, guarded chat, search, settings, notes and review', async () => {
  const assets = await readdir(resolve('dist/assets')); const script = await readFile(resolve('dist/assets', assets.find(file => /^index-.*\.js$/.test(file))), 'utf8');
  const api = await fixture(); const errors = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${api.base}/chat`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom; window.fetch = api.fetch; window.AbortController = AbortController; window.scrollTo = () => {}; window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} }); window.addEventListener('error', event => errors.push(event.error?.message || event.message));
  window.eval(script); const { document, button, aria, click, input, escape } = controls(window);
  try {
    await waitFor(() => document.querySelector('.intro-bubble'), 'empty conversation');
    assert.ok(document.querySelector('.starter-bubble'));
    assert.equal(document.querySelector('.welcome-heading'), null, 'No landing-page hero');
    assert.ok(document.body.textContent.includes('助手介绍'));
    assert.equal(api.state.messages.length, 0, 'No fabricated seed conversation');
    assert.equal(document.querySelector('.nav-rail .brand-button'), null, 'Reference chat rail has no top logo');
    assert.equal(document.querySelector('.composer-caption'), null, 'Composer has no extra baseline-shifting caption');
    assert.equal(document.querySelector('.chat-header .workspace-wordmark'), null, 'No generic dashboard wordmark');
    assert.ok(aria('邀请（此版本暂未提供）').disabled, 'Unimplemented invite is not advertised as working');
    assert.ok(aria('语音输入（暂未提供）').disabled, 'Unimplemented voice never requests microphone permission');
    assert.ok(aria('下载客户端（暂未提供）').disabled, 'No invented app download');
    assert.equal(document.querySelectorAll('.starter-prompts button').length, 3);
    click(aria('收起助手面板')); await waitFor(() => document.querySelector('.floating-assistant'), 'expanded chat shows centered assistant');
    assert.equal(document.querySelector('.assistant-panel'), null);
    click(aria('显示助手面板')); await waitFor(() => document.querySelector('.assistant-panel'), 'assistant avatar reopens panel');
    click(document.querySelector('.chat-title-pill')); await waitFor(() => document.querySelector('.side-chat-empty'), 'centered empty side-chat drawer');
    assert.equal(document.querySelector('.new-chat'), null, 'Empty drawer has no extra top action');
    assert.ok(button('新旁聊'));
    assert.ok(document.querySelector('.app-shell.with-sidebar'));
    click(aria('收起聊天列表')); await waitFor(() => !document.querySelector('.conversation-sidebar'), 'drawer closes');
    assert.equal(api.state.conversations.length, 0, 'Opening and closing shell controls does not create conversations');
    input(aria('输入消息'), '只输入草稿'); await waitFor(() => aria('发送消息'), 'typing changes microphone to send');
    input(aria('输入消息'), ''); await waitFor(() => aria('语音输入（暂未提供）'), 'clearing draft restores unavailable voice affordance');
    click(aria('目标')); await waitFor(() => document.querySelectorAll('.category-row').length === 7, 'seven goal categories');
    click(button('效率提升')); await waitFor(() => document.querySelector('[role="dialog"]'), 'goal category dialog');
    escape(); await waitFor(() => !document.querySelector('.modal-backdrop'), 'Escape closes category dialog'); assert.equal(window.location.pathname, '/goals');
    click(button('效率提升')); await waitFor(() => button('开始吧'), 'reopened goal dialog'); click(button('开始吧'));
    await waitFor(() => api.state.goals.length === 1 && !document.querySelector('.modal-backdrop') && document.querySelector('.chat-goal-strip'), 'goal intake persists and opens conversation');
    assert.equal(api.state.goals[0].status, 'draft'); assert.equal(api.requests.filter(r => r.path.endsWith('/messages')).length, 0, 'Starting intake does not execute model');
    const form = document.querySelector('.composer'); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('.message-blocked'), 'honest blocked response');
    assert.equal(api.requests.filter(r => r.path.endsWith('/messages')).length, 1, 'Double submit is guarded');
    assert.ok(api.requests.find(r => r.path.endsWith('/messages')).body.requestId);
    assert.equal(aria('输入消息').value, '');
    click(document.querySelector('.chat-title-pill')); await waitFor(() => document.querySelector('.conversation-sidebar'), 'conversation drawer');
    click(aria('重命名 我的效率目标')); await waitFor(() => document.querySelector('.modal input'), 'rename dialog'); input(document.querySelector('.modal input'), '专注学习'); click(button('保存'));
    await waitFor(() => api.state.conversations[0].title === '专注学习' && !document.querySelector('.modal-backdrop'), 'rename persists');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); await waitFor(() => aria('搜索整个空间'), 'keyboard search');
    input(aria('搜索整个空间'), '专注'); await waitFor(() => document.querySelector('.search-result strong')?.textContent === '专注学习', 'search filtered result'); escape(); await waitFor(() => !document.querySelector('.search-modal'), 'search dismissal');
    click(aria('设置')); await waitFor(() => document.querySelector('.settings-modal'), 'settings modal'); const settingsInput = document.querySelector('.settings-modal input'); input(settingsInput, '小伴'); click(button('保存设置'));
    await waitFor(() => api.state.settings.name === '小伴' && !document.querySelector('.modal-backdrop'), 'settings persists');
    assert.equal(document.querySelector('input[type="password"]'), null, 'No credential entry');
    click(aria('资料库')); await waitFor(() => button('新建笔记'), 'library'); click(button('新建笔记')); await waitFor(() => aria('笔记内容'), 'note editor'); input(aria('笔记内容'), '一个值得留下的想法'); click(button('保存'));
    await waitFor(() => api.state.memories.length === 1 && document.querySelector('.library-item'), 'saved note');
    click(button('查看与编辑')); await waitFor(() => aria('笔记内容'), 'edit saved note'); input(aria('笔记内容'), '一个更新后的想法'); click(button('保存'));
    await waitFor(() => api.state.memories[0].content === '一个更新后的想法' && !document.querySelector('.modal-backdrop'), 'note update');
    click(aria('删除笔记')); await waitFor(() => button('确认删除'), 'note delete confirmation'); click(button('保留')); await waitFor(() => !document.querySelector('.modal-backdrop'), 'cancel delete'); assert.equal(api.state.memories.length, 1);
    click(aria('删除笔记')); await waitFor(() => button('确认删除'), 'delete reopened'); click(button('确认删除')); await waitFor(() => api.state.memories.length === 0 && !document.querySelector('.library-item'), 'note delete');
    click(aria('目标')); await waitFor(() => document.querySelector('.goal-list-item'), 'saved goal list'); window.history.back(); await waitFor(() => document.querySelector('.page-library'), 'browser history back'); window.history.forward(); await waitFor(() => document.querySelector('.goal-list-item'), 'browser history forward'); click(document.querySelector('.goal-list-item')); await waitFor(() => document.querySelector('.goal-detail'), 'goal detail');
    click(aria('编辑目标')); await waitFor(() => document.querySelector('.goal-edit-form'), 'goal edit'); input(document.querySelector('.goal-edit-form input'), '每天专注学习'); input(document.querySelector('.goal-edit-form textarea'), '把计划拆成每天三十分钟的学习任务。'); click(button('保存目标'));
    await waitFor(() => api.state.goals[0].title === '每天专注学习' && !document.querySelector('.goal-edit-form'), 'goal edit persists');
    click(button('开始推进')); await waitFor(() => api.state.goals[0].status === 'blocked', 'unconfigured goal is blocked');
    escape(); await waitFor(() => !document.querySelector('.goal-detail'), 'goal Escape dismissal'); assert.equal(window.location.pathname, '/goals');
    // Enable the explicitly injected test provider and run the real goal lifecycle.
    api.provider.configured = true;
    await api.fetch(`/api/goals/${api.state.goals[0].id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) });
    await waitFor(() => document.querySelector('.status-review_required'), 'review state polling'); click(document.querySelector('.goal-list-item')); await waitFor(() => button('标记已审核'), 'explicit review action'); click(button('标记已审核'));
    await waitFor(() => api.state.goals[0].status === 'completed' && document.querySelector('.goal-output')?.textContent.includes('已审核'), 'reviewed goal');
    assert.equal(errors.length, 0, `React/DOM errors: ${errors.join('; ')}`);
    const reloaded = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${api.base}/goals/${api.state.goals[0].id}`, runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      reloaded.window.fetch = api.fetch; reloaded.window.AbortController = AbortController; reloaded.window.eval(script);
      await waitFor(() => reloaded.window.document.querySelector('.goal-detail'), 'full reload restores goal route');
      assert.equal(reloaded.window.document.querySelector('.goal-detail h1').textContent, '每天专注学习');
      assert.ok(reloaded.window.document.querySelector('.goal-output').textContent.includes('已审核'));
      assert.equal(api.state.settings.name, '小伴');
      assert.equal(api.state.conversations[0].title, '专注学习');
    } finally { reloaded.window.close(); }
  } finally { window.close(); await api.close(); }
});

test('production UI: real pending approvals are visible and approve/deny never execute an action', async () => {
  const assets = await readdir(resolve('dist/assets')); const script = await readFile(resolve('dist/assets', assets.find(file => /^index-.*\.js$/.test(file))), 'utf8');
  const api = await fixture();
  async function post(path, body) { return (await api.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
  const { connector } = await post('/api/connectors', { name: 'UI fixture', adapter: 'uninstalled-fixture', capabilities: ['read'] });
  const first = (await post(`/api/connectors/${connector.id}/approval`, { action: 'read', resource: 'document:fixture-one', payload: { query: 'VISIBLE_APPROVAL_PAYLOAD' } })).approval;
  const second = (await post(`/api/connectors/${connector.id}/approval`, { action: 'read', resource: 'document:fixture-two', payload: {} })).approval;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${api.base}/chat`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom; window.fetch = api.fetch; window.AbortController = AbortController; window.scrollTo = () => {};
  window.eval(script); const { document, button, aria, click } = controls(window);
  try {
    await waitFor(() => aria('待确认'), 'approval panel tab'); click(aria('待确认'));
    await waitFor(() => document.querySelector(`[data-approval-id="${first.id}"]`), 'actual pending approval');
    assert.ok(document.body.textContent.includes('VISIBLE_APPROVAL_PAYLOAD'));
    assert.equal(document.body.textContent.includes('现在没有待确认事项'), false);
    click(button('批准此请求', document.querySelector(`[data-approval-id="${first.id}"]`)));
    await waitFor(() => api.state.capabilities.approvals.find(item => item.id === first.id).status === 'approved' && !document.querySelector(`[data-approval-id="${first.id}"]`), 'approval decision persisted');
    click(button('拒绝', document.querySelector(`[data-approval-id="${second.id}"]`)));
    await waitFor(() => api.state.capabilities.approvals.find(item => item.id === second.id).status === 'denied' && document.body.textContent.includes('现在没有待确认事项'), 'denial persisted');
    assert.equal(api.state.capabilities.connectorRuns.length, 0, 'Decisions do not execute connectors');
  } finally { window.close(); await api.close(); }
});

async function renderWorkspace(api, path = '/chat', configureWindow) {
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(file => /^index-.*\.js$/.test(file))), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${api.base}${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const errors = [];
  dom.window.fetch = api.fetch; dom.window.AbortController = AbortController; dom.window.scrollTo = () => {}; dom.window.TextEncoder = TextEncoder;
  dom.window.addEventListener('error', event => errors.push(event.error?.message || event.message));
  configureWindow?.(dom.window);
  dom.window.eval(script);
  return { dom, window: dom.window, errors, ...controls(dom.window) };
}
async function post(api, path, body) { const response = await api.fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result; }
async function managementTab(ui, title) { await ui.click(ui.button(title, ui.document.querySelector('.management-nav'))); }
async function openManagement(ui, title) { await ui.click(ui.aria('设置')); await waitFor(() => ui.document.querySelector('.settings-management-links'), 'settings'); await ui.click(ui.button(title, ui.document.querySelector('.settings-management-links'))); await waitFor(() => ui.document.querySelector('.management-modal'), 'management panel'); }

test('management UI: instruction registry, connector configuration, exact approvals and schedule gates use real HTTP', async () => {
  let executions = 0;
  const api = await fixture({ connectorAdapters: { 'ui-fixture': { capabilities: ['read'], execute: async ({ resource, payload }) => { executions++; return { fixture: true, resource, value: payload.query }; } } } });
  const { goal } = await post(api, '/goals', { title: 'Offline UI goal', description: 'Fixture only; never dispatch a live provider.', maxSteps: 2, maxOutputTokens: 3200 });
  const ui = await renderWorkspace(api); const { window, document, button, aria, click, input, escape } = ui;
  try {
    await waitFor(() => aria('设置'), 'workspace authenticated locally');
    await openManagement(ui, '技能');
    await click(button('新建技能')); await input(aria('技能名称'), '取消的技能'); await click(button('取消'));
    assert.equal(api.state.capabilities.skills.length, 0);
    await click(button('新建技能')); await input(aria('技能名称'), '准确写作'); await input(aria('技能描述'), 'Offline fixture'); await input(aria('技能指令'), 'Use concise language. Do not claim unverified actions.');
    const form = document.querySelector('.management-form'); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => api.state.capabilities.skills.length === 1 && !document.querySelector('.management-form'), 'skill saved once');
    assert.equal(api.requests.filter(r => r.path === '/api/skills' && r.method === 'POST').length, 1); assert.equal(api.state.capabilities.skills[0].enabled, false);
    await click(button('启用技能')); await waitFor(() => api.state.capabilities.skills[0].enabled && button('停用技能'), 'skill enabled');
    await click(button('查看与编辑')); await input(aria('技能描述'), 'Updated description'); await click(button('保存'));
    await waitFor(() => api.state.capabilities.skills[0].description === 'Updated description' && !document.querySelector('.management-form'), 'skill updated');
    await managementTab(ui, '连接器'); await click(button('新增连接器')); await input(aria('连接器名称'), 'Offline documents'); await input(aria('适配器标识'), 'ui-fixture'); await input(aria('连接器允许动作'), 'read'); await click(button('保存'));
    await waitFor(() => api.state.capabilities.connectors.length === 1 && button('启用配置'), 'disabled connector saved');
    assert.equal(api.state.capabilities.connectors[0].enabled, false); assert.ok(button('准备执行请求').disabled);
    assert.equal(document.querySelector('input[type=password]'), null);
    await click(button('启用配置')); await waitFor(() => !button('准备执行请求').disabled, 'adapter prerequisites ready');
    assert.match(document.body.textContent, /未验证连接/); assert.equal(executions, 0);
    await click(button('准备执行请求')); await input(aria('执行目标'), 'document:offline-fixture'); await input(aria('执行载荷'), '{invalid'); await click(button('创建精确审批'));
    await waitFor(() => document.querySelector('.management-form [role=alert]'), 'invalid JSON stays in form'); assert.equal(api.state.capabilities.approvals.length, 0);
    await input(aria('执行载荷'), '{"query":"exactly reviewed"}'); const executionForm = document.querySelector('.management-form'); executionForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); executionForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => api.state.capabilities.approvals.length === 1 && button('批准此请求'), 'one exact approval');
    assert.match(document.body.textContent, /document:offline-fixture/); assert.match(document.body.textContent, /exactly reviewed/); assert.match(document.body.textContent, /SHA-256/);
    const approve = button('批准此请求'); await click(approve); await click(approve);
    await waitFor(() => button('执行已批准动作'), 'approved action remains explicit'); assert.equal(executions, 0);
    const execute = button('执行已批准动作'); await click(execute); await click(execute);
    await waitFor(() => executions === 1 && api.state.capabilities.connectorRuns[0]?.status === 'succeeded', 'one offline adapter execution');
    await waitFor(() => !button('执行已批准动作'), 'consumed approval disappears');
    assert.equal(api.requests.filter(r => r.path.endsWith('/execute')).length, 1);
    await managementTab(ui, '运行记录'); await waitFor(() => button('查看运行详情'), 'connector result visible'); await click(button('查看运行详情')); assert.match(document.body.textContent, /exactly reviewed/);
    await managementTab(ui, '定时任务'); await click(button('新建定时任务')); await input(aria('定时任务名称'), 'Far-future fixture schedule'); await input(aria('定时方式'), 'every'); await input(aria('间隔秒数'), '30'); assert.ok(button('保存为停用').disabled);
    await input(aria('间隔秒数'), '3600'); await input(aria('首次执行时间'), '2099-01-01T10:00'); await click(button('保存为停用'));
    await waitFor(() => api.state.capabilities.schedules.length === 1 && button('审阅启用范围'), 'schedule saved disabled'); assert.equal(api.state.capabilities.schedules[0].enabled, false);
    assert.equal(api.state.capabilities.schedules[0].goalId, goal.id);
    await click(button('审阅启用范围')); await waitFor(() => button('批准此请求'), 'schedule approval review');
    assert.match(document.body.textContent, /3200 tokens/); assert.match(document.body.textContent, /Offline UI goal/); assert.equal(api.state.capabilities.schedules[0].enabled, false);
    await click(button('批准此请求')); await waitFor(() => button('启用已批准定时'), 'approval alone does not enable'); assert.equal(api.state.capabilities.schedules[0].enabled, false);
    await click(button('启用已批准定时')); await waitFor(() => api.state.capabilities.schedules[0].enabled && !button('启用已批准定时'), 'explicit enable persisted');
    await managementTab(ui, '定时任务'); await click(button('停用定时')); await waitFor(() => !api.state.capabilities.schedules[0].enabled && button('审阅启用范围'), 'far-future fixture disabled');
    assert.equal(api.state.capabilities.scheduleRuns.length, 0, 'No live dispatch, external call or due schedule');
    await click(button('编辑计划')); await input(aria('定时任务名称'), 'Revised schedule'); await click(button('保存为停用'));
    await waitFor(() => api.state.capabilities.schedules[0].title === 'Revised schedule' && !document.querySelector('.management-form'), 'schedule edit'); assert.equal(api.state.capabilities.schedules[0].consent, null);
    await click(button('删除')); await click(button('保留')); assert.equal(api.state.capabilities.schedules.length, 1);
    await click(button('删除')); await click(button('确认删除')); await waitFor(() => api.state.capabilities.schedules.length === 0 && !document.querySelector('.management-confirm'), 'schedule removed');
    escape(); await waitFor(() => !document.querySelector('.management-modal'), 'management Escape closes'); assert.equal(window.location.pathname, '/chat');
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('management UI: file bytes, versions, safe preview, optimistic conflict and memory scope controls', async () => {
  const api = await fixture(); const { conversation } = await post(api, '/conversations', { title: 'Scoped discussion' });
  const ui = await renderWorkspace(api, '/library'); const { window, document, button, aria, click, input, escape } = ui;
  try {
    await waitFor(() => button('新建笔记'), 'library loaded'); await click(button('新建笔记')); await click(button('助手记忆')); await input(aria('笔记内容'), 'Only this discussion uses this preference.'); await input(aria('记忆范围'), conversation.id); await click(aria('启用此记忆')); await click(button('保存'));
    await waitFor(() => api.state.memories.length === 1 && document.querySelector('.library-item'), 'scoped memory saved');
    assert.equal(api.state.memories[0].enabled, false); assert.equal(api.state.memories[0].conversationId, conversation.id); assert.match(document.querySelector('.memory-scope-label').textContent, /已停用 · 仅聊天：Scoped discussion/);
    await click(button('查看与编辑')); assert.equal(aria('记忆范围').value, conversation.id); assert.equal(aria('启用此记忆').checked, false); await input(aria('记忆范围'), ''); await click(aria('启用此记忆')); await click(button('保存'));
    await waitFor(() => api.state.memories[0].enabled && api.state.memories[0].conversationId === null && !document.querySelector('.note-modal'), 'global enabled memory saved');
    await openManagement(ui, '文件产物'); await click(button('创建文件')); await input(aria('文件名称'), 'proof.md'); await input(aria('文件标题'), 'A real file'); await input(aria('文件内容'), '# proof\n<script>window.BAD = true</script>');
    const form = document.querySelector('.management-form'); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => api.state.artifacts.length === 1 && button('查看文件与版本'), 'real artifact saved once'); assert.equal(api.requests.filter(r => r.path === '/api/artifacts' && r.method === 'POST').length, 1);
    let artifact = api.state.artifacts[0]; const file = await api.fetch(`/api/artifacts/${artifact.id}/download`); assert.equal(await file.text(), '# proof\n<script>window.BAD = true</script>');
    await click(button('查看文件与版本')); await waitFor(() => document.querySelector('.artifact-preview'), 'safe preview'); assert.equal(window.BAD, undefined); assert.match(document.querySelector('.artifact-preview').textContent, /<script>/);
    await click(button('编辑当前文件')); await input(aria('文件标题'), 'Revised title'); await click(document.querySelector('.management-checkbox input')); await input(aria('文件内容'), 'version two'); await click(button('保存'));
    await waitFor(() => api.state.artifacts[0].currentVersion === 2 && button('查看文件与版本'), 'replacement creates version two');
    await click(button('查看文件与版本')); await waitFor(() => document.querySelector('.artifact-preview')?.textContent === 'version two', 'current version preview'); await input(aria('文件版本'), '1'); await waitFor(() => document.querySelector('.artifact-preview')?.textContent.includes('# proof'), 'old version preview');
    assert.match(document.querySelector('.artifact-detail a').href, /version=1$/);
    await input(aria('文件版本'), '2'); await waitFor(() => document.querySelector('.artifact-preview')?.textContent === 'version two', 'current version reread'); await click(button('编辑当前文件')); await input(aria('文件标题'), 'Keep this draft on conflict');
    await api.fetch(`/api/artifacts/${artifact.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Concurrent revision' }) });
    await click(button('保存')); await waitFor(() => document.querySelector('.management-body > [role=alert]'), 'concurrent edit error visible'); assert.equal(aria('文件标题').value, 'Keep this draft on conflict'); assert.equal(api.state.artifacts[0].title, 'Concurrent revision');
    await click(button('取消')); await waitFor(() => !document.querySelector('.management-form'), 'cancel conflict');
    // An unsupported upload is rejected locally and never sent.
    await click(button('创建文件')); const upload = aria('上传文件'); Object.defineProperty(upload, 'files', { configurable: true, value: [new window.File(['alert(1)'], 'unsafe.html', { type: 'text/html' })] }); upload.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('.management-form [role=alert]')?.textContent.includes('不支持'), 'unsupported upload rejected'); assert.equal(api.state.artifacts.length, 1);
    await click(button('取消')); await click(button('删除')); await click(button('保留')); assert.equal(api.state.artifacts.length, 1);
    await click(button('删除')); await click(button('确认删除')); await waitFor(() => api.state.artifacts.length === 0 && !document.querySelector('.management-confirm'), 'artifact removed');
    escape(); await waitFor(() => !document.querySelector('.management-modal'), 'close files'); assert.equal(window.location.pathname, '/library');
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

// The tiny signed gateway below is an offline test transport, not a production IdP.
async function enterpriseUiFixture(subject = 'admin') {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-enterprise-ui-'));
  const pair = generateKeyPairSync('ed25519');
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'dom-fixture', issuer: 'offline-gateway', keyId: 'ephemeral', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'admin', role: 'admin' }, { subject: 'reader', role: 'viewer' }] };
  const app = await createApp({ dataDirectory: directory, access, provider: { configured: false, complete: async () => { throw new Error('Never call live model'); } } });
  const address = await app.listen(0); let cookie = ''; const requests = [];
  return {
    base: access.publicOrigin, requests, app, get state() { return app.runtime.bootstrap(); },
    forgetCookie() { cookie = ''; },
    async fetch(path, options = {}) {
      const target = new URL(path, access.publicOrigin).pathname + new URL(path, access.publicOrigin).search;
      const method = options.method || 'GET', body = options.body || '';
      requests.push({ path: target, method, headers: { ...options.headers }, body: body ? JSON.parse(body) : {} });
      const response = await new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${address.port}${target}`, { method, headers: { Host: 'workspace.example', Origin: access.publicOrigin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers, 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, subject, method, target, body }) } }, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers })));
        req.on('error', reject); req.end(body);
      });
      const saved = response.headers.get('set-cookie'); if (saved) cookie = saved.split(';')[0];
      return response;
    },
    async close() { await app.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

test('enterprise UI: explicit identity login, CSRF mutation, expiry erases workspace and logout revokes session', async () => {
  const api = await enterpriseUiFixture(); const ui = await renderWorkspace(api); const { window, document, button, aria, click, input } = ui;
  try {
    await waitFor(() => button('使用企业身份继续'), 'unauthenticated gate'); assert.equal(document.querySelector('.app-shell'), null); assert.equal(api.requests.some(r => r.path === '/api/bootstrap'), false);
    const login = button('使用企业身份继续'); login.click(); login.click();
    await waitFor(() => document.querySelector('.app-shell'), 'enterprise session mounts workspace');
    assert.equal(api.requests.filter(r => r.path === '/api/session/login').length, 1); assert.equal(api.requests.find(r => r.path === '/api/session/login').headers['X-Workspace-Login'], '1');
    await click(aria('设置')); await waitFor(() => document.querySelector('.settings-modal'), 'enterprise settings');
    await input(document.querySelector('.settings-modal input'), 'Shared fixture'); await click(button('保存设置'));
    await waitFor(() => api.state.settings.name === 'Shared fixture' && !document.querySelector('.settings-modal'), 'authenticated mutation succeeded');
    assert.ok(api.requests.find(r => r.path === '/api/settings' && r.method === 'PATCH').headers['X-CSRF-Token']);
    await input(aria('输入消息'), 'Never send this draft'); api.forgetCookie();
    await waitFor(() => document.body.textContent.includes('会话已失效') && !document.querySelector('.app-shell'), 'lost session clears rendered workspace');
    assert.equal(document.querySelector('textarea'), null); assert.equal(api.state.messages.length, 0);
    await click(button('使用企业身份继续')); await waitFor(() => document.querySelector('.app-shell'), 'new session');
    await click(aria('设置')); await waitFor(() => button('退出共享空间'), 'logout action'); await click(button('退出共享空间'));
    await waitFor(() => !document.querySelector('.app-shell') && button('使用企业身份继续'), 'logout returns gate');
    assert.equal(api.requests.filter(r => r.path === '/api/session/logout').length, 1); assert.ok(api.requests.find(r => r.path === '/api/session/logout').headers['X-CSRF-Token']);
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('enterprise UI: viewer cannot submit chat, settings, skill or artifact mutations', async () => {
  const api = await enterpriseUiFixture('reader'); const ui = await renderWorkspace(api); const { window, document, button, aria, click, input } = ui;
  try {
    await waitFor(() => button('使用企业身份继续'), 'viewer gate'); await click(button('使用企业身份继续')); await waitFor(() => aria('输入消息'), 'viewer workspace');
    await input(aria('输入消息'), 'Read only'); assert.ok(aria('发送消息').disabled);
    document.querySelector('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await click(aria('设置')); await waitFor(() => button('保存设置'), 'viewer settings'); assert.ok(button('保存设置').disabled);
    await click(button('技能', document.querySelector('.settings-management-links'))); await waitFor(() => button('新建技能'), 'viewer registry'); assert.ok(button('新建技能').disabled); assert.match(document.body.textContent, /仅有读取权限/);
    await managementTab(ui, '文件产物'); assert.ok(button('创建文件').disabled); assert.equal(api.requests.filter(r => !['GET', 'HEAD'].includes(r.method) && r.path !== '/api/session/login').length, 0);
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('management UI: transport failure preserves editor, late mutation cannot undo navigation, blocked runs can explicitly retry', async () => {
  const api = await fixture(); const originalFetch = api.fetch; let fail = false; let delay = false; let release;
  api.fetch = async (path, options = {}) => {
    if (path === '/api/skills' && options.method === 'POST' && fail) { fail = false; throw new Error('Offline fixture transport'); }
    const response = await originalFetch(path, options);
    if (path === '/api/skills' && options.method === 'POST' && delay) { delay = false; await new Promise(resolve => { release = resolve; }); }
    return response;
  };
  const { conversation } = await post(api, '/conversations', { title: 'Blocked run fixture' });
  await post(api, `/conversations/${conversation.id}/messages`, { content: 'No provider configured', requestId: 'blocked-dom-fixture' });
  const ui = await renderWorkspace(api); const { window, document, button, aria, click, input, escape } = ui;
  try {
    await waitFor(() => aria('设置'), 'workspace'); await openManagement(ui, '技能'); await click(button('新建技能')); await input(aria('技能名称'), 'Preserved draft'); await input(aria('技能指令'), 'Offline fixture instruction');
    fail = true; await click(button('保存')); await waitFor(() => document.querySelector('.management-body > [role=alert]'), 'transport error'); assert.equal(aria('技能名称').value, 'Preserved draft'); assert.equal(api.state.capabilities.skills.length, 0);
    delay = true; await click(button('保存')); await waitFor(() => !!release, 'request committed, response held'); await managementTab(ui, '文件产物'); release();
    await waitFor(() => !document.querySelector('.management-progress'), 'late mutation settled'); assert.equal(document.querySelector('.management-heading h2').textContent, '文件产物'); assert.equal(document.querySelector('.management-form'), null); assert.equal(api.state.capabilities.skills.length, 1);
    await managementTab(ui, '运行记录'); await waitFor(() => button('明确重试'), 'blocked run rendered'); const retry = button('明确重试'); retry.click(); retry.click();
    await waitFor(() => api.state.runs.length === 2 && !document.querySelector('.management-progress'), 'single explicit blocked retry');
    assert.equal(api.requests.filter(r => r.path.endsWith('/retry')).length, 1); assert.ok(api.requests.find(r => r.path.endsWith('/retry')).body.requestId);
    escape(); await waitFor(() => !document.querySelector('.management-modal'), 'close runs'); await click(aria('目标')); await waitFor(() => document.querySelector('.page-goals'), 'navigate goals');
    window.history.back(); await waitFor(() => document.querySelector('.chat-route'), 'history restores chat'); assert.equal(document.querySelector('.management-modal'), null);
    assert.deepEqual(ui.errors, []);
  } finally { release?.(); window.close(); await api.close(); }
});

test('management UI: lost create response retries the same idempotency key without duplicate registry entries', async () => {
  const api = await fixture(); const originalFetch = api.fetch; let lose = true;
  api.fetch = async (path, options = {}) => { const response = await originalFetch(path, options); if (path === '/api/skills' && options.method === 'POST' && lose) { lose = false; throw new Error('Committed response lost (offline fixture)'); } return response; };
  const ui = await renderWorkspace(api); const { window, document, button, aria, click, input } = ui;
  try {
    await waitFor(() => aria('设置'), 'local session'); await openManagement(ui, '技能'); await click(button('新建技能')); await input(aria('技能名称'), 'Durable create fixture'); await input(aria('技能指令'), 'No live execution.'); await click(button('保存'));
    await waitFor(() => api.state.capabilities.skills.length === 1 && document.querySelector('.management-body > [role=alert]'), 'server committed, client reports lost reply');
    await click(button('保存')); await waitFor(() => !document.querySelector('.management-form'), 'explicit repeat recovers existing result');
    const posts = api.requests.filter(r => r.path === '/api/skills' && r.method === 'POST'); assert.equal(posts.length, 2); assert.ok(posts[0].body.requestId); assert.equal(posts[0].body.requestId, posts[1].body.requestId); assert.equal(api.state.capabilities.skills.length, 1);
    await click(button('查看与编辑')); await input(aria('技能描述'), 'PATCH must not contain requestId'); await click(button('保存')); await waitFor(() => !document.querySelector('.management-form'), 'update saved');
    assert.equal('requestId' in api.requests.find(r => r.path.startsWith('/api/skills/') && r.method === 'PATCH').body, false);
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('relay UI: only the server-approved gpt-6-sol model is offered, no configuration fallback or live request', async () => {
  const api = await fixture({ provider: { provider: 'fastaitoken', kind: 'fastaitoken-api', models: ['gpt-6-sol'], model: 'gpt-6-sol', configured: false, complete: async () => { throw new Error('Live relay calls forbidden in UI test'); } } });
  const ui = await renderWorkspace(api); const { window, document, button, aria, click, input } = ui;
  try {
    await waitFor(() => aria('设置'), 'relay workspace'); await click(aria('设置')); await waitFor(() => document.querySelector('.settings-modal .field-grid select'), 'relay settings');
    const model = document.querySelector('.settings-modal .field-grid select'); assert.deepEqual([...model.options].map(o => o.value), ['gpt-6-sol']); assert.equal(model.value, 'gpt-6-sol'); assert.ok(model.disabled); assert.match(document.body.textContent, /fastaitoken/);
    assert.equal(document.body.textContent.includes('DEEPSEEK_API_KEY'), false); assert.equal(document.querySelector('input[type=password]'), null);
    await input(document.querySelector('.settings-modal input'), 'Shared relay workspace'); await click(button('保存设置')); await waitFor(() => api.state.settings.name === 'Shared relay workspace' && !document.querySelector('.settings-modal'), 'provider-compatible settings saved');
    assert.equal(api.state.settings.model, 'gpt-6-sol'); assert.equal(api.state.runs.length, 0);
  } finally { window.close(); await api.close(); }
});

test('diagnostics UI: GET-only contract distinguishes configured, packaged fixture evidence and live acceptance', async () => {
  let calls = 0, executions = 0;
  const api = await fixture({ provider: { provider: 'offline-ui-fixture', kind: 'fixture', model: 'fixture-model', configured: true, complete: async () => { calls++; throw new Error('Diagnostic reads must never call provider'); } }, connectorAdapters: { 'no-probe': { capabilities: ['read'], execute: async () => { executions++; } } } });
  const { connector } = await post(api, '/connectors', { name: 'Unavailable diagnostic connector', adapter: 'not-installed', capabilities: ['read'] });
  await api.fetch(`/api/connectors/${connector.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
  const response = await api.fetch('/api/diagnostics'); const actual = await response.json();
  assert.equal(response.status, 200); assert.equal(actual.schemaVersion, 1); assert.equal(actual.readOnly, true); assert.equal(actual.externalCalls, false);
  assert.equal(actual.provider.configured, true); assert.equal(actual.provider.onlineVerified, false); assert.equal(actual.provider.liveValidation.status, 'not_validated');
  assert.equal(actual.connectors.blocked, 1); assert.equal(actual.storage.liveWriteProbe, false);
  const bootstrap = await (await api.fetch('/api/bootstrap')).json(); assert.equal(bootstrap.diagnostics.instanceId, actual.instanceId);
  const before = structuredClone(api.state); const offset = api.requests.length;
  const ui = await renderWorkspace(api); const { window, document, button, aria, click } = ui;
  try {
    await waitFor(() => aria('设置'), 'diagnostics workspace'); await openManagement(ui, '运行能力');
    await waitFor(() => document.querySelector('[aria-label="运行诊断"]'), 'complete diagnostics');
    assert.match(document.body.textContent, /模型已配置/); assert.match(document.body.textContent, /当前部署未验证/);
    assert.match(document.body.textContent, /包内夹具只验证本地实现/); assert.match(document.body.textContent, /不产生模型调用费用/);
    assert.match(document.querySelector('[data-diagnostic=connectors]').textContent, /Unavailable diagnostic connector.*缺少服务端适配器/);
    assert.match(document.querySelector('[data-diagnostic=scheduler]').textContent, /自动计时器/);
    assert.match(document.querySelector('[data-diagnostic=storage]').textContent, /未执行/);
    assert.match(document.querySelector('.diagnostics-blockers').textContent, /服务端凭据绑定/);
    await click(aria('刷新运行诊断')); await waitFor(() => api.requests.slice(offset).some(r => r.path === '/api/diagnostics') && !aria('刷新运行诊断').disabled, 'diagnostics GET completed');
    assert.equal(calls, 0); assert.equal(executions, 0); assert.equal(api.state.meta.sequence, before.meta.sequence);
    assert.equal(api.state.runs.length, 0); assert.equal(api.state.capabilities.connectorRuns.length, 0); assert.equal(api.state.capabilities.scheduleRuns.length, 0);
    assert.equal(api.requests.slice(offset).every(r => r.method === 'GET'), true, 'Opening and refreshing diagnostics never mutates or probes');
    assert.equal(document.querySelector('input[type=password]'), null); assert.equal(document.querySelector('.toast'), null);
    await click(button('查看连接器')); assert.equal(document.querySelector('.management-heading h2').textContent, '连接器');
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('diagnostics UI: outages, stale snapshots, reconnect, duplicate refresh and interrupted navigation are honest', async () => {
  const api = await fixture(); const originalFetch = api.fetch;
  let mode = 'fresh', hold = false, release;
  api.fetch = async (path, options = {}) => {
    if (mode === 'offline' && ['/api/bootstrap', '/api/diagnostics'].includes(path)) { api.requests.push({ path, method: options.method || 'GET', body: {} }); throw new Error('Explicit offline transport fixture'); }
    const response = await originalFetch(path, options);
    if (!['/api/bootstrap', '/api/diagnostics'].includes(path) || !response.ok) return response;
    const body = await response.json(); const diagnostic = path === '/api/bootstrap' ? body.diagnostics : body;
    if (mode === 'stale') diagnostic.observedAt = new Date(Date.now() - diagnostic.staleAfterMs - 5000).toISOString();
    if (path === '/api/diagnostics' && hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  };
  const ui = await renderWorkspace(api); const { window, document, aria, button, click, escape } = ui;
  const state = () => document.querySelector('[aria-label="运行诊断"]')?.getAttribute('data-connection-state');
  try {
    await waitFor(() => aria('设置'), 'workspace'); await click(aria('设置')); await waitFor(() => state() === 'connected', 'fresh backend snapshot');
    assert.match(document.body.textContent, /模型尚未配置/); assert.equal(document.querySelector('.settings-modal .status-idle'), null);
    const offset = api.requests.filter(r => r.path === '/api/diagnostics').length;
    hold = true; const refresh = aria('刷新运行诊断'); refresh.click(); refresh.click(); await waitFor(() => release && refresh.disabled, 'single held diagnostic read');
    assert.equal(api.requests.filter(r => r.path === '/api/diagnostics').length, offset + 1);
    assert.equal(document.querySelector('.toast'), null, 'No success before the request completes');
    escape(); await waitFor(() => !document.querySelector('.settings-modal'), 'close during refresh'); await click(aria('目标')); release(); release = undefined;
    await waitFor(() => document.querySelector('.page-goals'), 'new navigation remains'); assert.equal(document.querySelector('.modal-backdrop'), null); assert.equal(document.querySelector('.toast'), null);
    await click(aria('设置')); await waitFor(() => state(), 'diagnostic settings reopened');
    mode = 'offline'; await click(aria('刷新运行诊断')); await waitFor(() => state() === 'disconnected', 'failed GET becomes disconnected');
    assert.match(document.querySelector('.runtime-diagnostics').textContent, /上次快照，不能代表当前可用/); assert.match(document.querySelector('.runtime-diagnostics').textContent, /最后成功读取/); assert.match(document.body.textContent, /请检查网络后重试/);
    mode = 'fresh'; await click(aria('刷新运行诊断')); await waitFor(() => state() === 'reconnected', 'recovered GET proves backend reconnection');
    assert.match(document.querySelector('.runtime-diagnostics').textContent, /当前部署未验证/); assert.equal(document.querySelector('.runtime-diagnostics [role=alert]'), null);
    mode = 'stale'; await click(aria('刷新运行诊断')); await waitFor(() => state() === 'stale', 'server timestamp stale even after successful HTTP');
    assert.match(document.querySelector('.runtime-diagnostics').textContent, /状态已过期/);
    mode = 'fresh'; await click(aria('刷新运行诊断')); await waitFor(() => state() === 'reconnected', 'new snapshot replaces stale evidence');
    await click(button('查看完整运行诊断')); await waitFor(() => document.querySelector('.management-modal'), 'complete diagnostics from settings');
    assert.equal(api.requests.every(r => r.method === 'GET'), true); assert.equal(api.state.runs.length, 0); assert.deepEqual(ui.errors, []);
  } finally { release?.(); window.close(); await api.close(); }
});

test('diagnostics UI: instance restart accepts lower store sequence and late old process responses cannot roll back state', async () => {
  const api = await fixture(); const originalFetch = api.fetch;
  let currentInstance, restart = false, holdNextBootstrap = false, release, retiredResponse = false;
  api.fetch = async (path, options = {}) => {
    const response = await originalFetch(path, options);
    if (!['/api/bootstrap', '/api/diagnostics'].includes(path) || !response.ok) return response;
    const body = await response.json(), diagnostic = path === '/api/bootstrap' ? body.diagnostics : body;
    currentInstance ||= diagnostic.instanceId;
    diagnostic.instanceId = restart && !retiredResponse ? 'synthetic-restarted-ui-instance' : currentInstance;
    if (path === '/api/bootstrap') { body.meta.sequence = restart ? 1 : 100; body.settings.name = restart ? 'After restart fixture' : 'Before restart fixture'; }
    if (path === '/api/bootstrap' && holdNextBootstrap) { holdNextBootstrap = false; await new Promise(resolve => { release = resolve; }); }
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  };
  const ui = await renderWorkspace(api); const { window, document, aria, click } = ui;
  const state = () => document.querySelector('[aria-label="运行诊断"]')?.getAttribute('data-connection-state');
  try {
    await waitFor(() => document.querySelector('.assistant-profile h2')?.textContent === 'Before restart fixture', 'old process snapshot');
    await click(aria('设置')); await waitFor(() => state() === 'connected', 'old process connected');
    holdNextBootstrap = true; await waitFor(() => release, 'poll started on old process and response held');
    restart = true; await click(aria('刷新运行诊断')); await waitFor(() => state() === 'restarted', 'new process diagnosed');
    assert.match(document.querySelector('.runtime-diagnostics').textContent, /不会重放中断运行/);
    release(); release = undefined;
    await waitFor(() => document.querySelector('.assistant-profile h2')?.textContent === 'After restart fixture', 'lower store sequence accepted for new instance');
    assert.equal(state(), 'restarted');
    retiredResponse = true; await click(aria('刷新运行诊断')); await waitFor(() => !aria('刷新运行诊断').disabled, 'late retired process response settled');
    assert.equal(state(), 'restarted', 'A retired instance cannot become current again'); assert.equal(document.querySelector('.assistant-profile h2').textContent, 'After restart fixture');
    assert.equal(api.requests.every(r => r.method === 'GET'), true); assert.equal(api.state.runs.length, 0); assert.deepEqual(ui.errors, []);
  } finally { release?.(); window.close(); await api.close(); }
});

test('diagnostics UI: hung GET reads have bounded deadlines, recoverable controls and one bootstrap in flight', async () => {
  const api = await fixture(); const originalFetch = api.fetch;
  let hang = false, hangBody = false, active = 0, maximum = 0, aborted = 0;
  api.fetch = async (path, options = {}) => {
    if (hang && ['/api/bootstrap', '/api/diagnostics'].includes(path)) {
      api.requests.push({ path, method: options.method || 'GET', body: {} });
      if (path === '/api/bootstrap') { active++; maximum = Math.max(maximum, active); }
      assert.ok(options.signal, 'Only bounded status GETs carry an AbortSignal');
      options.signal.addEventListener('abort', () => { aborted++; if (path === '/api/bootstrap') active--; }, { once: true });
      return new Promise(() => {}); // Explicitly non-responsive transport fixture.
    }
    const response = await originalFetch(path, options);
    if (hangBody && path === '/api/diagnostics') response.json = () => new Promise(() => {});
    return response;
  };
  const ui = await renderWorkspace(api, '/chat', window => {
    // Accelerate only known status deadlines/poll ticks; no model or adapter runs.
    const timeout = window.setTimeout.bind(window), interval = window.setInterval.bind(window);
    window.setTimeout = (callback, ms, ...args) => timeout(callback, ms === 10000 ? 200 : ms, ...args);
    window.setInterval = (callback, ms, ...args) => interval(callback, ms === 2000 ? 40 : ms, ...args);
  });
  const { window, document, aria, click } = ui;
  const state = () => document.querySelector('[aria-label="运行诊断"]')?.getAttribute('data-connection-state');
  try {
    await waitFor(() => aria('设置'), 'workspace'); await click(aria('设置')); await waitFor(() => state() === 'connected', 'initial status');
    hang = true; const refresh = aria('刷新运行诊断'); refresh.click(); refresh.click();
    await waitFor(() => state() === 'disconnected' && !aria('刷新运行诊断').disabled && aborted >= 2, 'status deadlines release controls and cancel transport');
    assert.match(document.querySelector('.runtime-diagnostics').textContent, /读取服务状态超时/);
    assert.equal(maximum, 1, 'Polling never accumulates concurrent bootstrap reads');
    assert.equal(api.requests.filter(r => r.path === '/api/diagnostics').length, 1, 'Repeated clicks cannot start duplicate hung reads');
    hang = false; await click(aria('刷新运行诊断')); await waitFor(() => state() === 'reconnected', 'retry can recover after timeout');
    hangBody = true; await click(aria('刷新运行诊断')); await waitFor(() => !aria('刷新运行诊断').disabled, 'deadline also bounds a hung JSON response body');
    hangBody = false; await click(aria('刷新运行诊断')); await waitFor(() => !aria('刷新运行诊断').disabled, 'refresh works after body timeout');
    assert.equal(api.requests.every(r => r.method === 'GET'), true); assert.equal(api.state.runs.length, 0); assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('diagnostics UI: passed fixtures and successful provider return still do not claim current-deployment live verification', async () => {
  const api = await fixture(); const originalFetch = api.fetch; let fixtureStatus = 'passed';
  api.fetch = async (path, options = {}) => {
    const response = await originalFetch(path, options);
    if (!['/api/bootstrap', '/api/diagnostics'].includes(path) || !response.ok) return response;
    const body = await response.json(), diagnostic = path === '/api/bootstrap' ? body.diagnostics : body;
    // Synthetic rendering cases only; actual endpoint evidence is asserted in the GET contract test.
    diagnostic.provider.localVerification = { status: fixtureStatus, evidenceKind: 'local-fixtures', checkedAt: new Date().toISOString() };
    diagnostic.provider.lastObservation = { status: 'succeeded', observedAt: new Date().toISOString(), code: null, scope: 'current-process-provider-return' };
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  };
  const ui = await renderWorkspace(api); const { window, document, aria, click } = ui;
  try {
    await waitFor(() => aria('设置'), 'fixture evidence workspace'); await openManagement(ui, '运行能力');
    assert.match(document.body.textContent, /包内本地夹具验证通过/); assert.match(document.body.textContent, /本进程收到成功返回/); assert.match(document.body.textContent, /当前部署未验证/);
    assert.equal(document.body.textContent.includes('在线验证通过'), false);
    for (const [status, label] of [['stale', '包内验证证据已过期或不匹配'], ['invalid', '包内验证证据无效'], ['missing', '未提供包内验证证据']]) {
      fixtureStatus = status; await click(aria('刷新运行诊断')); await waitFor(() => document.body.textContent.includes(label), `evidence label ${status}`);
      assert.match(document.body.textContent, /当前部署未验证/);
    }
    assert.equal(api.requests.every(r => r.method === 'GET'), true); assert.equal(api.state.runs.length, 0); assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});

test('conversation task input UI: explicit versions, reviewed skills and scoped notes are durable and reach only the selected run', async () => {
  const calls = [];
  const provider = { configured: true, complete: async options => { calls.push(options); return { content: 'Selected task input reviewed.' }; } };
  const api = await fixture({ provider });
  const file = (await post(api, '/artifacts', { filename: 'input.md', title: 'Project brief', content: 'ORIGINAL_PINNED_INPUT' })).artifact;
  await api.app.artifacts.update(file.id, { content: 'NEWER_UNSELECTED_INPUT' });
  await post(api, '/artifacts', { filename: 'unselected.txt', title: 'Private unrelated input', content: 'UNSELECTED_FILE_CONTENT' });
  const selectedSkill = (await post(api, '/skills', { name: 'Reviewed writing', instructions: 'SELECTED_SKILL_GUIDANCE', enabled: true })).skill;
  await post(api, '/skills', { name: 'Unselected skill', instructions: 'UNSELECTED_SKILL_GUIDANCE', enabled: true });
  const note = (await post(api, '/memories', { content: 'SELECTED_SAVED_NOTE', category: 'saved' })).memory;
  await post(api, '/memories', { content: 'UNSELECTED_GLOBAL_MEMORY', category: 'preference' });
  const ui = await renderWorkspace(api); const { document, aria, button, click, input, escape } = ui;
  try {
    await waitFor(() => aria('选择任务输入') && !aria('选择任务输入').disabled, 'task context entry');
    await click(aria('选择任务输入'));
    assert.equal(aria('使用文件 Project brief').checked, false); assert.equal(aria('采用技能 Reviewed writing r1').checked, false);
    await click(aria('使用文件 Project brief')); await input(aria('Project brief 输入版本'), '1'); await click(aria('采用技能 Reviewed writing r1')); await click(aria('使用笔记 SELECTED_SAVED_NOTE'));
    escape(); await waitFor(() => !document.querySelector('.task-context-modal'), 'cancel context with Escape');
    assert.equal(api.state.conversations.length, 0, 'Reviewing context never creates a conversation or invokes a model'); assert.equal(calls.length, 0);
    await click(aria('选择任务输入')); assert.equal(aria('使用文件 Project brief').checked, false, 'Cancelled selections are discarded');
    await click(aria('使用文件 Project brief')); await input(aria('Project brief 输入版本'), '1'); await click(aria('采用技能 Reviewed writing r1')); await click(aria('使用笔记 SELECTED_SAVED_NOTE')); await click(button('保存任务输入'));
    await waitFor(() => !document.querySelector('.task-context-modal'), 'new chat inputs saved locally');
    await input(aria('输入消息'), 'Review my selected brief'); await click(aria('发送消息'));
    await waitFor(() => calls.length === 1 && api.state.runs[0]?.status === 'succeeded', 'one run with selected context');
    const conversation = api.state.conversations[0];
    assert.deepEqual(conversation.inputContext.artifacts, [{ id: file.id, version: 1 }]); assert.deepEqual(conversation.inputContext.skills, [{ id: selectedSkill.id, revision: 1 }]); assert.deepEqual(conversation.inputContext.memoryIds, [note.id]);
    const sent = JSON.stringify(calls[0].messages); assert.match(sent, /ORIGINAL_PINNED_INPUT/); assert.match(sent, /SELECTED_SKILL_GUIDANCE/); assert.match(sent, /SELECTED_SAVED_NOTE/); assert.doesNotMatch(sent, /NEWER_UNSELECTED_INPUT|UNSELECTED_FILE_CONTENT|UNSELECTED_SKILL_GUIDANCE|UNSELECTED_GLOBAL_MEMORY/);
    await waitFor(() => document.querySelector('.run-inputs'), 'frozen input snapshot visible'); assert.match(document.querySelector('.run-inputs').textContent, /v1/);
    await waitFor(() => aria('保存回复到资料库'), 'completed reply save control'); await click(aria('保存回复到资料库')); await waitFor(() => api.state.artifacts.some(item => item.sourceRunId === api.state.runs[0].id), 'response saved as an actual file');
    const resultFile = api.state.artifacts.find(item => item.sourceRunId === api.state.runs[0].id); assert.match(resultFile.filename, /\.md$/); assert.equal((await api.app.artifacts.read(resultFile.id)).content, 'Selected task input reviewed.');
    await click(aria('保存回复到资料库')); await waitFor(() => !aria('选择任务输入').disabled, 'repeat save settled'); assert.equal(api.state.artifacts.filter(item => item.sourceRunId === api.state.runs[0].id).length, 1, 'saving twice is idempotent');
    await click(aria('选择任务输入')); await click(button('清空选择')); await click(button('保存任务输入'));
    await waitFor(() => api.state.conversations[0].inputContext.artifacts.length === 0 && !document.querySelector('.task-context-modal'), 'conversation selection cleared durably');
    assert.equal(api.state.runs[0].inputContextSnapshot.artifacts[0].version, 1, 'earlier run keeps its snapshot');
    await click(aria('新建聊天')); await click(aria('选择任务输入')); assert.equal(aria('使用文件 Project brief').checked, false, 'unrelated conversation receives no prior choice');
    assert.equal(ui.errors.length, 0, ui.errors.join('; '));
  } finally { ui.window.close(); await api.close(); }
});

test('conversation context UI: stale reviewed skill fails closed and remains editable without sending a model request', async () => {
  const api = await fixture();
  const { conversation } = await post(api, '/conversations', { title: 'Context edits' });
  const { skill } = await post(api, '/skills', { name: 'Revision review', instructions: 'Original reviewed instruction', enabled: true });
  const ui = await renderWorkspace(api, `/chat/${conversation.id}`); const { aria, button, click, document } = ui;
  try {
    await waitFor(() => aria('选择任务输入') && !aria('选择任务输入').disabled, 'context edit entry'); await click(aria('选择任务输入')); await click(aria('采用技能 Revision review r1'));
    await api.app.capabilities.updateSkill(skill.id, { instructions: 'Different instruction requires review' });
    await click(button('保存任务输入')); await waitFor(() => document.querySelector('.toast-error'), 'stale revision rejected');
    assert.ok(document.querySelector('.task-context-modal'), 'failed save retains the context editor'); assert.equal(api.state.conversations[0].inputContext.skills.length, 0); assert.equal(api.state.runs.length, 0);
    await click(button('清空选择')); await click(button('保存任务输入')); await waitFor(() => !document.querySelector('.task-context-modal'), 'recovery with explicit empty input');
  } finally { ui.window.close(); await api.close(); }
});

test('conversation execution UI: inline exact approval, duplicate-click guard, receipt and real output artifact', async () => {
  let executions = 0, connectorId; const calls = [];
  const provider = { configured: true, complete: async options => { calls.push(options); return { content: JSON.stringify(calls.length === 1 ? { done: false, content: 'I propose reading the selected local fixture.', plan: [{ id: 'read', title: 'Read the reviewed fixture', status: 'in_progress' }], action: { connectorId, action: 'read', resource: 'document:ui-task', payload: { query: 'EXACT_UI_APPROVAL' } } } : { done: true, content: 'The reviewed fixture is ready.', plan: [{ id: 'read', title: 'Read the reviewed fixture', status: 'completed' }], artifact: { filename: 'ui-task-result.md', content: 'VERIFIED_LOCAL_RECEIPT_RESULT' } }) }; } };
  const api = await fixture({ provider, connectorAdapters: { 'conversation-fixture': { capabilities: ['read'], execute: async () => { executions++; return { content: 'VERIFIED_LOCAL_RECEIPT_RESULT' }; } } } });
  const connector = (await post(api, '/connectors', { name: 'Conversation fixture', adapter: 'conversation-fixture', capabilities: ['read'] })).connector; connectorId = connector.id; await api.app.capabilities.updateConnector(connector.id, { enabled: true });
  const ui = await renderWorkspace(api); const { document, button, aria, click, input } = ui;
  try {
    await waitFor(() => aria('选择任务输入') && !aria('选择任务输入').disabled, 'context entry'); await click(aria('选择任务输入')); await click(aria('允许提议 Conversation fixture read')); await click(button('保存任务输入'));
    await input(aria('输入消息'), 'Read the fixture and create a draft file'); await click(aria('发送消息'));
    await waitFor(() => button('批准此动作'), 'inline proposal'); assert.equal(executions, 0); assert.equal(calls.length, 1);
    assert.match(document.querySelector('.run-proposal').textContent, /EXACT_UI_APPROVAL/); assert.match(document.querySelector('.run-plan').textContent, /Read the reviewed fixture/);
    await click(aria('待确认')); await waitFor(() => button('在原聊天审阅动作'), 'bound approval routes back to original task'); assert.equal(button('批准此请求', document.querySelector('.panel-body')), undefined);
    const approve = button('批准此动作'); await click(approve); await click(approve); await waitFor(() => api.state.runs[0].proposals[0].status === 'approved', 'approval persisted once'); assert.equal(executions, 0, 'approval alone does not execute');
    const resume = button('按已批准范围继续'); await click(resume); await click(resume);
    await waitFor(() => api.state.runs[0].status === 'succeeded' && document.querySelector('.run-output-link'), 'resume records receipt and writes downloadable result');
    assert.equal(executions, 1); assert.equal(calls.length, 2); assert.equal(api.requests.filter(item => item.path.endsWith('/action-decision')).length, 1); assert.equal(api.requests.filter(item => item.path.endsWith('/resume')).length, 1);
    assert.match(document.querySelector('.run-proposal').textContent, /VERIFIED_LOCAL_RECEIPT_RESULT/);
    const link = document.querySelector('.run-output-link'); const download = await api.fetch(link.getAttribute('href')); assert.equal(await download.text(), 'VERIFIED_LOCAL_RECEIPT_RESULT');
    assert.equal(ui.errors.length, 0, ui.errors.join('; '));
  } finally { ui.window.close(); await api.close(); }
});

test('draft goal UI follows its conversation file selection when started after intake', async () => {
  const calls = [];
  const provider = { configured: true, complete: async options => { calls.push(options); return { content: JSON.stringify({ done: true, content: 'Draft based on the selected goal reference.' }) }; } };
  const api = await fixture({ provider });
  const file = (await post(api, '/artifacts', { filename: 'goal-source.txt', title: 'Goal source', content: 'GOAL_CONTEXT_SELECTED_AFTER_INTAKE' })).artifact;
  const ui = await renderWorkspace(api); const { document, aria, button, click } = ui;
  try {
    await waitFor(() => document.querySelector('.intro-bubble'), 'initial ready state'); await click(aria('目标')); await click(button('职业')); await waitFor(() => button('开始吧'), 'goal category'); await click(button('开始吧'));
    await waitFor(() => api.state.goals.length === 1 && document.querySelector('.chat-goal-strip'), 'draft goal intake'); assert.equal(calls.length, 0);
    await click(aria('选择任务输入')); await click(aria('使用文件 Goal source')); await click(button('保存任务输入')); await waitFor(() => !document.querySelector('.task-context-modal'), 'goal conversation context saved');
    await click(document.querySelector('.chat-goal-strip button')); await waitFor(() => button('开始推进'), 'draft goal ready'); await click(button('开始推进'));
    await waitFor(() => api.state.goals[0].status === 'review_required', 'goal finishes based on selected file');
    assert.match(JSON.stringify(calls[0].messages), /GOAL_CONTEXT_SELECTED_AFTER_INTAKE/); assert.equal(api.state.runs[0].inputContextSnapshot.artifacts[0].id, file.id);
    assert.equal(ui.errors.length, 0, ui.errors.join('; '));
  } finally { ui.window.close(); await api.close(); }
});

test('template schedule UI makes fresh goal mode explicit, bounds standing approval and never auto-enables', async () => {
  const api = await fixture(); await post(api, '/goals', { title: 'Recurring report source', maxSteps: 2, maxOutputTokens: 3200 });
  const ui = await renderWorkspace(api); const { window, document, button, aria, click, input } = ui;
  try {
    await waitFor(() => aria('设置'), 'workspace'); await openManagement(ui, '定时任务'); await click(button('新建定时任务'));
    await input(aria('定时任务名称'), 'Fresh bounded reports'); await input(aria('定时方式'), 'every');
    assert.equal(aria('定时目标模式').value, 'resume'); assert.equal(aria('最多执行次数'), null);
    await input(aria('定时目标模式'), 'template'); await input(aria('最多执行次数'), '0'); assert.equal(button('保存为停用').disabled, true);
    await input(aria('最多执行次数'), '2'); await input(aria('首次执行时间'), '2099-01-01T10:00');
    assert.match(document.body.textContent, /每次独立预算/); assert.match(document.body.textContent, /tokens 额度不是金额上限/);
    const form = document.querySelector('.management-form'); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => api.state.capabilities.schedules.length === 1 && button('审阅启用范围'), 'disabled template persisted');
    assert.equal(api.state.capabilities.schedules[0].goalMode, 'template'); assert.equal(api.state.capabilities.schedules[0].maxOccurrences, 2); assert.equal(api.state.capabilities.schedules[0].enabled, false);
    assert.equal(api.requests.filter(request => request.path === '/api/schedules' && request.method === 'POST').length, 1);
    await click(button('审阅启用范围')); await waitFor(() => button('批准此请求'), 'standing scope visible');
    assert.match(document.body.textContent, /累计最多 2 次/); assert.match(document.body.textContent, /每次使用独立预算/); assert.match(document.body.textContent, /连接器动作逐次批准/);
    await click(button('批准此请求')); await waitFor(() => button('启用已批准定时'), 'approved remains unexecuted');
    assert.equal(api.state.capabilities.schedules[0].enabled, false); assert.equal(api.state.capabilities.scheduleRuns.length, 0); assert.equal(api.state.runs.length, 0);
    await managementTab(ui, '定时任务'); await click(button('编辑计划')); await input(aria('定时方式'), 'at'); assert.equal(aria('最多执行次数'), null);
    await click(button('取消')); await click(button('编辑计划')); assert.equal(aria('定时目标模式').value, 'template'); assert.equal(aria('最多执行次数').value, '2');
    assert.deepEqual(ui.errors, []);
  } finally { window.close(); await api.close(); }
});
