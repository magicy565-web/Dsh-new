import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMemoryService, createStorageAdapter } from '../service.js';
import { createHttpHandler } from '../index.js';

const alpha = randomUUID(), beta = randomUUID();
let saved = {};
const workspaces = [{ id: alpha, title: '演示工作区', sessionIds: [] }, { id: beta, title: '另一个工作区', sessionIds: [] }];
const service = createMemoryService({ storage: createStorageAdapter({ get: () => saved, async set(next) { saved = next; } }), registry: { list: () => workspaces, get: id => workspaces.find(item => item.id === id) } });
const server = createServer(createHttpHandler(service, { authorize: req => req.headers.cookie === 'native=fixture' ? undefined : 401 }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const dom = new JSDOM('<div id="root"></div>', { url: origin, pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = React;
const { Simulate } = await import('react-dom/test-utils');
const fetchNative = globalThis.fetch;
globalThis.fetch = (path, options = {}) => fetchNative(origin + path, { ...options, headers: { cookie: 'native=fixture', origin, ...options.headers } });
let module;
window.__ModuleLoader__ = { load({ factory }) { module = factory(() => React); } };
await import('../client.js');
const panels = new Map(), disposers = [];
const t = key => module.dictionaries.zh[key] ?? key;
module.apply({ locale: { register: () => () => {}, bind: () => t }, effect(fn) { disposers.push(fn()); }, slots: {
  inject: (_slot, fn) => fn(), register(options, component) { panels.set(options.name, component); return () => {}; },
} });
const root = createRoot(document.getElementById('root'));
const wait = async predicate => {
  for (let n = 0; n < 100; n++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (predicate()) return; }
  throw new Error('DOM state did not settle: ' + document.body.textContent);
};
const click = async label => {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label);
  assert.ok(button, 'Button exists: ' + label);
  await act(async () => { button.click(); });
};
const change = async (node, value) => { assert.ok(node); await act(async () => { node.value = value; Simulate.change(node, { target: { value } }); }); };
const byLabel = label => [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent === label)?.querySelector('input,select,textarea');
try {
  await act(async () => { root.render(React.createElement(panels.get('main'), { t })); });
  await wait(() => document.querySelector('.bm .list'));
  await click(t('new'));
  await wait(() => document.querySelector('.bm .grid'));
  await change(byLabel(t('subjectLabel')), '演示企业');
  await change(byLabel(t('factKey')), 'moq');
  await change(byLabel(t('statement')), '起订量 300 件。');
  await change(byLabel(t('basis')), '负责人确认，界面测试用数据。');
  await act(async () => { document.querySelector('.bm .grid').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await wait(() => document.querySelector('.bm .row')?.textContent.includes('起订量 300'));
  assert.equal((await service.state(alpha)).active, 0);
  await act(async () => { document.querySelector('.bm .row').click(); });
  await wait(() => document.body.textContent.includes(t('approve')));
  assert.ok(document.body.textContent.includes('界面测试用数据'));
  await click(t('approve'));
  await wait(() => !document.body.textContent.includes(t('approve')) && document.querySelector('.bm .list'));
  assert.equal((await service.state(alpha)).active, 1);
  await change(document.querySelector('select[aria-label="全部记录"]'), 'active');
  await wait(() => document.querySelector('.bm .row'));
  // A new proposal created while viewing active facts must land in the pending filter,
  // even when the previous filter's asynchronous refresh settles later.
  await click(t('new'));
  await wait(() => document.querySelector('.bm .grid'));
  await change(byLabel(t('factKey')), 'second');
  await change(byLabel(t('statement')), '第二条待审核候选。');
  await change(byLabel(t('basis')), '另一次人工确认');
  await act(async () => { document.querySelector('.bm .grid').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await wait(() => document.querySelector('.bm .row')?.textContent.includes('第二条'));
  assert.equal(document.querySelector('select[aria-label="全部记录"]').value, 'proposed');
  await act(async () => { document.querySelector('.bm .row').click(); });
  await wait(() => document.body.textContent.includes(t('reject')));
  await click(t('reject'));
  await wait(() => document.querySelector('.bm .list') && !document.querySelector('.bm .row'));
  assert.equal((await service.state(alpha)).rejected, 1);
  await change(document.querySelector('select[aria-label="全部记录"]'), 'active');
  await wait(() => document.querySelector('.bm .row'));
  await act(async () => { document.querySelector('.bm .row').click(); });
  await wait(() => document.body.textContent.includes(t('revoke')));
  await click(t('revoke'));
  await wait(() => document.querySelector('.bm .list') && !document.querySelector('.bm .row'));
  assert.equal((await service.state(alpha)).revoked, 1);
  await service.propose(beta, { requestId: randomUUID(), subjectType: 'customer', subjectId: 'beta', factKey: 'reorder', statement: 'Beta 工作区的待审核记忆', source: { kind: 'operator', basis: '测试来源' } });
  await change(document.querySelector('select[aria-label="工作区"]'), beta);
  await change(document.querySelector('select[aria-label="全部记录"]'), 'proposed');
  await wait(() => document.body.textContent.includes('Beta 工作区的待审核记忆'));
  assert.equal(document.body.textContent.includes('起订量 300'), false);
  console.log('OK: memory panel through real local HTTP; human proposal, review, revocation and workspace switching. Synthetic storage/registry, no model.');
} finally {
  await act(async () => root.unmount()); disposers.reverse().forEach(dispose => dispose?.());
  globalThis.fetch = fetchNative; dom.window.close(); await service.close(); await new Promise(resolve => server.close(resolve));
}
