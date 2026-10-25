import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { createRecoveryService, createStorageAdapter } from '../service.js';
import { createHttpHandler } from '../index.js';
import { row, toCsv } from './fixture.mjs';

const alpha = randomUUID(), beta = randomUUID(), blobs = new Map(); let saved = {};
const workspaces = [{ id: alpha, title: 'Synthetic Alpha', sessionIds: ['session-fixture'] }, { id: beta, title: 'Synthetic Beta', sessionIds: [] }];
const attachments = {
  async saveFile({ data, name }) { const attachmentId = 'sha256:' + createHash('sha256').update(data).digest('hex'); blobs.set(attachmentId, Buffer.from(data)); return { attachmentId, name, bytes: data.length }; },
  async *readFileStream(ref) { yield blobs.get(ref.attachmentId); },
};
const service = createRecoveryService({ storage: createStorageAdapter({ get: () => saved, async set(value) { saved = value; } }), attachments,
  registry: { list: () => workspaces, get: id => workspaces.find(row => row.id === id) } });
const server = createServer(createHttpHandler(service, { authorize: req => req.headers.cookie === 'fixture=yes' ? undefined : 401 }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, dom = new JSDOM('<div id="root"></div>', { url: origin, pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default, { act } = React;
const { createRoot } = await import('react-dom/client'), { Simulate } = await import('react-dom/test-utils');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (path, options = {}) => nativeFetch(origin + path, { ...options, headers: { cookie: 'fixture=yes', origin, ...options.headers } });
let module; window.__ModuleLoader__ = { load({ factory }) { module = factory(() => React); } };
await import('../client.js');
const panels = new Map(), disposers = [], t = key => module.dictionaries.zh[key] ?? key;
module.apply({ locale: { register: () => () => {}, bind: () => t }, effect: fn => disposers.push(fn()), slots: {
  inject: (_name, fn) => fn(), register(options, component) { panels.set(options.name, component); return () => {}; },
} });
const root = createRoot(document.getElementById('root'));
async function wait(predicate) {
  for (let n = 0; n < 150; n++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (predicate()) return; }
  throw new Error('DOM did not settle: ' + document.body.textContent);
}
async function click(label) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label);
  assert.ok(button, 'Button exists: ' + label); await act(async () => button.click());
}
async function change(node, value) { assert.ok(node); await act(async () => { node.value = value; Simulate.change(node, { target: { value } }); }); }
try {
  await act(async () => root.render(React.createElement(panels.get('main'), { t })));
  await wait(() => document.body.textContent.includes(t('empty')));
  const bytes = Buffer.from(toCsv([row()])), file = { name: 'synthetic-inquiries.csv', size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
  await act(async () => Simulate.change(document.querySelector('input[type=file]'), { target: { files: [file] } }));
  await act(async () => document.querySelector('input[type=checkbox]').click());
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === t('import')).disabled, false);
  await act(async () => document.querySelector('input[type=file]').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await wait(() => document.querySelector('.ir .row'));
  assert.equal(service.status(alpha).counts.leads, 1);
  await act(async () => document.querySelector('.ir .row').click());
  await wait(() => document.body.textContent.includes(t('sourceVerified')));
  assert.ok(document.body.textContent.includes('500 pieces of linen'));
  await change(document.querySelector(`select[aria-label="${t('identity')}"]`), 'confirmed');
  await change(document.querySelector(`textarea[aria-label="${t('basis')}"]`), 'Synthetic operator identity confirmation');
  await act(async () => document.querySelector('textarea').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await wait(() => document.body.textContent.includes(t('saved')) && document.body.textContent.includes(t('follow_up')));
  const context = await service.read(alpha, 'linen-buyer');
  const draft = await service.proposeDraft({ requestId: randomUUID(), leadId: 'linen-buyer', expectedRevision: 1, sourceHash: context.card.sourceHash, content: 'Sam, is your linen evaluation still active? Unsent DOM fixture.' }, { agent: { session: { id: 'session-fixture' } }, callId: 'fixture-call' });
  await click(t('back')); await click(t('refresh'));
  await wait(() => document.querySelector('.ir .draft'));
  assert.ok(document.body.textContent.includes(t('unreviewed')));
  assert.ok(document.querySelector(`a[href$="/drafts/${draft.id}/file"]`));
  await change(document.querySelector(`select[aria-label="${t('workspace')}"]`), beta);
  await wait(() => document.body.textContent.includes(t('empty')));
  assert.equal(document.body.textContent.includes('Unsent DOM fixture'), false);
  assert.equal(document.body.textContent.includes('Synthetic Buyer'), false);
  await change(document.querySelector(`select[aria-label="${t('workspace')}"]`), alpha);
  await wait(() => document.querySelector('.ir .draft'));
  await service.import(alpha, { requestId: randomUUID(), sourceName: 'new-revision.csv', format: 'csv', authorized: true, dataBase64: Buffer.from(toCsv([row({ revision: 2, status: 'opted_out' })])).toString('base64') });
  await click(t('refresh')); await wait(() => document.body.textContent.includes(t('sourceChanged')));
  await act(async () => document.querySelector('.ir .row').click());
  await wait(() => document.body.textContent.includes(t('hold')) && document.querySelector('textarea'));
  assert.equal(document.querySelector(`select[aria-label="${t('identity')}"]`).value, 'unknown');
  console.log('OK: inquiry panel via local HTTP; file import, operator identity review, native draft display, workspace isolation and source-update warning. Synthetic registry/storage/Agent; no model.');
} finally {
  await act(async () => root.unmount()); disposers.reverse().forEach(fn => fn?.()); globalThis.fetch = nativeFetch;
  await service.close(); await new Promise(resolve => server.close(resolve)); dom.window.close();
}
