// Development-only DOM smoke test for the Space panel.
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modules = resolve(process.env.DSH_CLIENT_TEST_MODULES || join(here, '..', '..', '..', '..', 'node_modules'));
const load = async specifier => import(pathToFileURL(join(modules, specifier)).href);

const ReactModule = await load('react/index.js');
const React = ReactModule.default ?? ReactModule;
const ReactDomClient = await load('react-dom/client.js');
const { createRoot } = ReactDomClient.default ?? ReactDomClient;
const ReactDomTestUtils = await load('react-dom/test-utils.js');
const { act, Simulate } = ReactDomTestUtils.default ?? ReactDomTestUtils;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const JsdomModule = await load('jsdom/lib/api.js');
const { JSDOM } = JsdomModule.default ?? JsdomModule;

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:59430/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
globalThis.location = dom.window.location;

const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const item = (id, kind, title, minutes, extra = {}) => ({
  id,
  kind,
  title,
  starred: false,
  shared: false,
  owned: true,
  parentId: null,
  meta: {},
  comments: [],
  messages: [],
  members: [],
  pinned: false,
  deletedAt: null,
  createdAt: at(minutes + 30),
  updatedAt: at(minutes),
  ...extra,
});
const item1 = item('item_1', 'page', '无标题页面', 10);
const item2 = item('item_2', 'page', '示例待办清单', 20, { starred: true, shared: true });
const item3 = item('item_3', 'page', '示例页面', 30, { starred: true, shared: true });
const file = item('item_4', 'file', '示例数据.json', 40, { meta: { ext: 'json', size: '12 KB' } });
const site = item('item_site', 'site', '示例站点 A', 70, { meta: { visibility: '仅自己可见' } });
const items = [item1, item2, item3, file, site];
const tasks = [];
const pageBody = '在页面中，你可以写作、创作，并与 ChatGPT 和团队成员协作。';
const calls = [];

let sequence = 0;
function nextId(prefix) {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

globalThis.fetch = async (url, init = {}) => {
  const parsedUrl = new URL(String(url), 'http://127.0.0.1:59430');
  const path = parsedUrl.pathname;
  const search = parsedUrl.search;
  const method = init.method || 'GET';
  calls.push({ path, method });
  const body = init.body ? JSON.parse(init.body) : {};
  const json = data => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  const created = data => new Response(JSON.stringify({ ok: true, data }), { status: 201, headers: { 'content-type': 'application/json' } });

  if (path === '/space-api/state') {
    const counts = { page: 3, file: 1, site: 1, image: 0, folder: 0, drive: 0 };
    const visible = search.includes('trash=1') ? items.filter(entry => entry.deletedAt) : items.filter(entry => !entry.deletedAt);
    return json({ items: visible, counts, tasks, sequence: 2, seeded: true });
  }
  if (path.startsWith('/space-api/items/') && path.endsWith('/trash') && method === 'POST') {
    const target = items.find(entry => entry.id === path.split('/')[3]);
    if (target) target.deletedAt = new Date().toISOString();
    return json(target || {});
  }
  if (path.startsWith('/space-api/items/') && path.endsWith('/restore') && method === 'POST') {
    const target = items.find(entry => entry.id === path.split('/')[3]);
    if (target) target.deletedAt = null;
    return json(target || {});
  }
  if (path.startsWith('/space-api/items/') && path.endsWith('/members') && method === 'POST') {
    const target = items.find(entry => entry.id === path.split('/')[3]);
    target.members.push({ id: nextId('member'), name: body.name, role: 'member' });
    target.shared = true;
    return created(target);
  }
  if (path === '/space-api/items/item_3' && method === 'GET') return json({ ...item3, body: pageBody });
  if (path.startsWith('/space-api/items/') && path.endsWith('/comments') && method === 'POST') {
    const id = path.split('/')[3];
    const target = items.find(entry => entry.id === id) || item3;
    target.comments.push({ id: nextId('c'), text: body.text, author: 'local', at: new Date().toISOString() });
    return created({ ...target, body: target.id === 'item_3' ? pageBody : '' });
  }
  if (path.startsWith('/space-api/items/') && path.endsWith('/messages') && method === 'POST') {
    const id = path.split('/')[3];
    const target = items.find(entry => entry.id === id) || item3;
    target.messages.push({ id: nextId('m'), role: 'user', text: body.text, at: new Date().toISOString() });
    return created({ ...target, body: target.id === 'item_3' ? pageBody : '' });
  }
  if (path.startsWith('/space-api/items/') && method === 'GET') {
    const id = path.split('/').pop();
    const found = items.find(entry => entry.id === id);
    if (!found) return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'missing' } }), { status: 404 });
    return json({ ...found, body: found.id === 'item_3' ? pageBody : '' });
  }
  if (path === '/space-api/pages' && method === 'POST') {
    const page = item(nextId('item'), 'page', body.title || '无标题页面', 0, { body: body.body || '' });
    items.unshift(page);
    return created(page);
  }
  if (path === '/space-api/items' && method === 'POST') {
    const createdItem = item(nextId('item'), body.kind || 'file', body.title || '新条目', 0, { meta: body.meta || {} });
    items.unshift(createdItem);
    return created(createdItem);
  }
  if (path.startsWith('/space-api/items/') && method === 'DELETE') {
    const index = items.findIndex(entry => entry.id === path.split('/').pop());
    if (index >= 0) items.splice(index, 1);
    return json({ id: path.split('/').pop() });
  }
  if (path.startsWith('/space-api/items/') && method === 'PATCH') {
    const id = path.split('/').pop();
    const target = items.find(entry => entry.id === id) || item3;
    Object.assign(target, body);
    return json({ ...target, body: target.id === 'item_3' ? pageBody : target.body || '' });
  }
  if (path === '/space-api/tasks' && method === 'POST') {
    const task = { id: nextId('task'), title: body.title, goal: body.goal || '', frequency: body.frequency || 'daily', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    tasks.unshift(task);
    return created(task);
  }
  if (path.startsWith('/space-api/tasks/') && method === 'PATCH') {
    const id = path.split('/').pop();
    const task = tasks.find(entry => entry.id === id) || tasks[0];
    task.status = body.status;
    return json(task);
  }
  return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: `unmocked ${path}` } }), { status: 404 });
};

let exportsModule = null;
globalThis.window.__ModuleLoader__ = {
  load({ factory }) {
    exportsModule = factory(name => {
      if (name === 'react') return React;
      throw new Error(`unexpected require: ${name}`);
    });
  },
};

await import(pathToFileURL(join(here, '..', 'client.js')).href);
if (!exportsModule) throw new Error('client module did not register');

const registrations = new Map();
const ctx = {
  effect(callback) {
    return callback();
  },
  locale: {
    register() {
      return () => {};
    },
    bind() {
      return key => key;
    },
  },
  slots: {
    inject(_owner, callback) {
      callback();
      return () => {};
    },
    register(options, component) {
      registrations.set(options.name === 'main' ? `main:${options.key}` : `${options.name}:${options.id}`, component);
      return () => {};
    },
  },
};
exportsModule.apply(ctx);
if (!registrations.has('main:space') || !registrations.has('sidebar.panellist:space')) {
  throw new Error(`missing registrations: ${[...registrations.keys()].join(', ')}`);
}

const Panel = registrations.get('main:space');
const container = document.getElementById('root');
const root = createRoot(container);
const stableT = key => key;
const settle = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};
const fail = message => {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('style').forEach(element => element.remove());
  console.error(clone.textContent.slice(0, 2000));
  console.error(calls);
  throw new Error(message);
};
const click = element => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const findByText = (selector, text) => [...container.querySelectorAll(selector)].find(element => element.textContent.includes(text));
const setValue = (element, value) => {
  Simulate.change(element, { target: { value } });
};
const blur = element => Simulate.blur(element);

root.render(React.createElement(Panel, { t: stableT }));
await settle();

if (!container.querySelector('.sp-rail')) fail('rail missing');
if (!container.querySelector('.sp-sidebar')) fail('sidebar missing');
if (!container.textContent.includes('nav.all')) fail('all section title missing');
if (!container.textContent.includes('示例页面')) fail('page rows missing');
if (!container.textContent.includes('start')) fail('get-started block missing');
if (!container.textContent.includes('页面使用入门')) fail('template cards missing');

click(findByText('button.sp-tr', '示例页面'));
await settle();
const bodyInput = container.querySelector('.sp-block-input');
if (!bodyInput || !bodyInput.value.includes('在页面中')) fail('page body editor missing');
const titleInput = container.querySelector('input.sp-doc-title-input');
if (!titleInput || titleInput.value !== '示例页面') fail('page title editor missing');

setValue(titleInput, '示例页面（改）');
await settle();
blur(titleInput);
await settle();
if (!calls.some(call => call.method === 'PATCH' && call.path === '/space-api/items/item_3')) fail('title save missing');

const star = container.querySelector('button[title="page.unstar"], button[title="page.star"]');
if (!star) fail('star action missing');
click(star);
await settle();
const unstar = container.querySelector('button[title="page.unstar"], button[title="page.star"]');
click(unstar);
await settle();

const share = container.querySelector('button[title="page.share"]');
if (!share) fail('share action missing');
click(share);
await settle();
if (!container.querySelector('.sp-share')) fail('share popover missing');
click(findByText('.sp-share button', 'share.done'));
await settle();

const commentButton = container.querySelector('button[title="comment.title"]');
if (!commentButton) fail('comment action missing');
click(commentButton);
await settle();
if (!container.querySelector('.sp-comments')) fail('comments drawer missing');
const commentInput = container.querySelector('.sp-comment-form input');
setValue(commentInput, '这是一条评论');
await settle();
Simulate.submit(container.querySelector('.sp-comment-form'));
await settle();
if (!container.textContent.includes('这是一条评论')) fail('comment not rendered');

const workInput = container.querySelector('.sp-workform input');
if (!workInput) fail('work input missing');
setValue(workInput, '整理一下这页');
await settle();
Simulate.submit(container.querySelector('.sp-workform'));
await settle();
if (!container.textContent.includes('整理一下这页')) fail('message not rendered');

click(container.querySelector('.sp-doc-title-btn'));
await settle();
if (!container.querySelector('.sp-filemenu')) fail('file menu missing');
click(findByText('.sp-filemenu button', 'menu.editors'));
await settle();
if (!container.querySelector('.sp-info')) fail('editor info missing');
click(findByText('.sp-info button', 'share.done'));
await settle();

click(container.querySelector('button[title="menu.insert"]'));
await settle();
if (!container.querySelector('.sp-insert')) fail('insert menu missing');
click(findByText('.sp-insert button', 'insert.h1'));
await settle();
if (!container.querySelector('.sp-block-input-h1')) fail('insert heading missing');

click(container.querySelector('button[title="page.close"]'));
await settle();
if (!container.textContent.includes('nav.all')) fail('did not return to list');

click(findByText('button.sp-tab', 'tabs.starred'));
await settle();
const tableText = container.querySelector('.sp-table')?.textContent || '';
if (tableText.includes('无标题页面')) fail('starred filter did not apply');
if (!tableText.includes('示例页面')) fail('starred filter lost the starred page');
click(findByText('button.sp-tab', 'tabs.recommended'));
await settle();

click(container.querySelector('button[title="view.grid"]'));
await settle();
if (!container.querySelector('.sp-grid')) fail('grid view missing');
click(container.querySelector('button[title="view.list"]'));
await settle();

click(container.querySelector('button[title="view.filter"]'));
await settle();
if (!container.querySelector('.sp-filter')) fail('filter menu missing');
click(findByText('.sp-filter button', 'filter.page'));
await settle();
if ((container.querySelector('.sp-table')?.textContent || '').includes('示例数据.json')) fail('type filter did not apply');
click(container.querySelector('button[title="view.filter"]'));
await settle();
click(findByText('.sp-filter button', 'filter.all'));
await settle();

click(findByText('button.sp-nav-item', 'nav.sites'));
await settle();
if (!container.querySelector('.sp-site-table')) fail('site table missing');
click(container.querySelector('.sp-site-row button[title="rail.more"]'));
await settle();
if (!container.querySelector('.sp-sitemenu')) fail('site menu missing');
click(findByText('.sp-sitemenu button', 'site.analytics'));
await settle();
if (!container.querySelector('.sp-modal')) fail('site analytics modal missing');
click(findByText('.sp-modal button', 'share.done'));
await settle();
click(findByText('button.sp-nav-item', 'nav.all'));
await settle();

click(container.querySelector('.sp-new-btn'));
await settle();
if (!container.querySelector('.sp-menu')) fail('new menu missing');
click(findByText('.sp-menu button', 'menu.page'));
await settle();
const createdTitle = container.querySelector('input.sp-doc-title-input');
if (!createdTitle || createdTitle.value !== '无标题页面') fail('created page did not open');
click(container.querySelector('button[title="page.close"]'));
await settle();

click(container.querySelector('.sp-new-btn'));
await settle();
click(findByText('.sp-menu button', 'menu.site'));
await settle();
if (!container.querySelector('.sp-meta-list')) fail('site detail missing');
if (!container.querySelector('.sp-terms')) fail('site terms missing');
click(container.querySelector('button[title="page.close"]'));
await settle();
click(findByText('button.sp-nav-item', 'nav.all'));
await settle();

click(findByText('button.sp-tr', '示例页面'));
await settle();
click(container.querySelector('.sp-doc-title-btn'));
await settle();
click(findByText('.sp-filemenu button', 'menu.delete'));
await settle();
click(findByText('button.sp-nav-item', 'nav.trash'));
await settle();
if (!container.querySelector('.sp-trash')) fail('trash view missing');
click(findByText('button.sp-tab', 'trash.pages'));
await settle();
if (!container.textContent.includes('示例页面（改）')) fail('trashed page missing');
click(findByText('.sp-tr button', 'trash.restore'));
await settle();
click(findByText('button.sp-nav-item', 'nav.all'));
await settle();

click(container.querySelector('button[title="rail.scheduled"]'));
await settle();
if (!container.textContent.includes('scheduled.cta')) fail('scheduled section missing');
const newTask = findByText('button.sp-btn', 'task.new');
if (!newTask) fail('new task button missing');
click(newTask);
await settle();
if (!container.querySelector('.sp-task-panel')) fail('task panel missing');
const taskTitle = container.querySelector('.sp-task-panel input');
setValue(taskTitle, '每周更新财务');
await settle();
Simulate.submit(container.querySelector('.sp-task-panel'));
await settle();
if (!container.textContent.includes('每周更新财务')) fail('task not created');

root.unmount();
dom.window.close();
console.log(`OK: Space workspace shell, editor, share, comments, chat, tasks; ${calls.length} mocked requests`);
