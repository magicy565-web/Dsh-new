// Production React bundle against the original local HTTP server and Store.
// JSDOM has no layout: width values only choose responsive branches, not geometry.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';
import { localHttpTransport } from './fixtures/local-http.mjs';
import { installBrowserPlatform } from './fixtures/browser-platform.mjs';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-aiworks-ui-dom-'));
  const options = { dataDirectory: directory, provider: { kind: 'fixture', configured: false, complete: async () => { throw Error('Model must not be called'); } }, capabilityEnvironment: {}, ...overrides };
  let app = await createApp(options);
  let address = await app.listen(0);
  let transport = localHttpTransport(`http://127.0.0.1:${address.port}`);
  const base = () => `http://127.0.0.1:${address.port}`;
  const requests = [], windows = [];
  const fetch = async (path, options = {}) => {
    requests.push({ path: String(path), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    return transport.fetch(String(path), options);
  };
  t.after(async () => {
    for (const window of windows) window.close();
    await transport.close();
    await app.close();
    assert.equal(resolve(directory, '..'), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'workspace-aiworks-ui-dom-')));
    await rm(directory, { recursive: true, force: true });
  });
  const assets = await readdir(resolve('dist/assets'));
  const script = await readFile(resolve('dist/assets', assets.find(name => /^index-.*\.js$/u.test(name))), 'utf8');
  function render(path = '/aiworks', { width = 390 } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${base()}${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom; windows.push(window); installBrowserPlatform(window);
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
    window.fetch = fetch; window.scrollTo = () => {};
    const errors = []; window.addEventListener('error', event => errors.push(event.error?.message || event.message));
    window.eval(script);
    return { window, document: window.document, errors };
  }
  async function request(path, method = 'GET', body) {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  const restart = async () => { await transport.close(); await app.close(); app = await createApp(options); address = await app.listen(0); transport = localHttpTransport(`http://127.0.0.1:${address.port}`); };
  return { base, fetch, request, render, restart, requests, get app() { return app; } };
}

async function wait(check, message) { for (let index = 0; index < 320; index++) { if (await check()) return; await new Promise(done => setTimeout(done, 25)); } throw Error(`Timed out: ${message}`); }
const button = (ui, text, root = ui.document) => [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text);
async function click(ui, element) { assert.ok(element, 'Expected UI control'); assert.notEqual(element.disabled, true); element.click(); await new Promise(done => setTimeout(done, 0)); }
async function input(ui, element, value) { assert.ok(element, 'Expected editable element'); const prototype = element.tagName === 'TEXTAREA' ? ui.window.HTMLTextAreaElement.prototype : ui.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new ui.window.Event('input', { bubbles: true })); await new Promise(done => setTimeout(done, 0)); }
async function choose(ui, element, value) { assert.ok(element, 'Expected select element'); Object.getOwnPropertyDescriptor(ui.window.HTMLSelectElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new ui.window.Event('change', { bubbles: true })); await new Promise(done => setTimeout(done, 0)); }
const field = (ui, label) => ui.document.querySelector(`[aria-label="${label}"]`);

function libraryProductBody() {
  return {
    requestId: randomUUID(),
    name: '不锈钢保温杯',
    description: '500ml 双层真空保温杯，OEM 定制，适合品牌商与分销商。',
    category: '饮具',
    skus: [{ id: randomUUID(), code: 'VB-500', unit: 'pcs', moq: 1000, specs: [{ key: '容量', value: '500ml' }, { key: '材质', value: '304 不锈钢' }] }],
    supply: { packaging: '彩盒', samplePolicy: '付费样品', paymentTerms: 'T/T 30% 定金', shippingTerms: 'FOB 宁波', capacityNote: '月产能 20 万只' },
  };
}

test('production DOM: product library -> development plan delegation -> approval, all from real HTTP', async t => {
  const f = await fixture(t);
  const seeded = await f.request('/api/library/products', 'POST', libraryProductBody());
  assert.equal(seeded.status, 201, JSON.stringify(seeded.body));
  const productId = seeded.body.product.id;
  const writesBeforeRender = f.requests.filter(row => row.method === 'POST').length;

  const ui = f.render('/aiworks', { width: 390 });
  await wait(() => ui.document.querySelector('.app-shell[aria-busy="false"]'), 'workspace shell loaded');
  await wait(() => ui.document.querySelector('[data-testid="ai-works"]'), 'AI-work page mounted');
  await wait(() => ui.document.querySelector('h1')?.textContent?.includes('客户线索挖掘'), 'page title');
  await wait(() => ui.document.querySelector('.aiw-dashboard')?.textContent.includes('外发运营概览'), 'outreach dashboard visible');
  await wait(() => ui.document.querySelectorAll('select[aria-label="产品库产品"] option').length === 1, 'product library option loaded');
  assert.equal(f.requests.filter(row => row.method === 'POST').length, writesBeforeRender, 'page load performs no mutation');
  assert.ok(ui.document.querySelector('.aiw-meta').textContent.includes('已接入'));

  await choose(ui, field(ui, '产品库产品'), productId);
  await input(ui, field(ui, '目标国家'), '德国');
  await choose(ui, field(ui, '采购客户类型'), '分销商');
  await input(ui, field(ui, '目标候选线索数'), '40');
  await input(ui, field(ui, '交付周期'), '21');
  await input(ui, field(ui, '补充说明'), '首批优先有进口记录的分销商。');
  await click(ui, button(ui, '生成开发计划并建立委托'));
  await wait(() => ui.document.querySelector('.aiw-detail'), 'development plan delegation detail rendered');
  await wait(() => !!ui.document.querySelector('.aiw-badge-draft'), 'draft badge rendered');

  const detail = ui.document.querySelector('.aiw-detail').textContent;
  for (const needle of ['不锈钢保温杯', 'revision 1', '德国', '分销商', '待执行', 'UWG']) assert.ok(detail.includes(needle), `plan detail mentions ${needle}`);
  assert.ok(detail.includes('SHA-256'));
  assert.equal(ui.document.querySelectorAll('.aiw-query').length, 7, 'the real plan carries the discovery queries');
  assert.ok(ui.document.querySelector('.aiw-policy-consent_required'), 'Germany requires prior consent, not a generic policy');
  assert.ok(ui.document.querySelector('.aiw-completeness-complete'), 'product-library facts are complete');
  await wait(() => ui.document.querySelector('.aiw-readiness'), 'product-library readiness shown in the delegation');

  const create = f.requests.find(row => row.method === 'POST' && row.path === '/api/ai-works/lead-discovery/delegations');
  assert.ok(create, 'delegation create call captured');
  assert.deepEqual(Object.keys(create.body).sort(), ['buyerType', 'deadlineDays', 'notes', 'productId', 'requestId', 'targetCount', 'targetCountry']);
  assert.equal(create.body.productId, productId);
  assert.equal(create.body.targetCountry, '德国');
  assert.equal(create.body.buyerType, '分销商');
  assert.equal(create.body.targetCount, 40);
  assert.equal(create.body.deadlineDays, 21);

  await click(ui, button(ui, '审批开发计划'));
  await wait(() => ui.document.querySelector('.aiw-badge-approved'), 'approved badge after human approval');
  const listed = await f.request('/api/ai-work-delegations');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.delegations.length, 1);
  assert.equal(listed.body.delegations[0].status, 'approved');
  assert.equal(listed.body.delegations[0].plan.productFacts.productId, productId);
  assert.match(listed.body.delegations[0].planHash, /^[0-9a-f]{64}$/u);
  assert.ok(listed.body.delegations[0].artifactId, 'development plan artifact exists');

  // Execution: authorized import -> rule scoring -> human review, from the same page.
  await wait(() => ui.document.querySelector('.aiw-execution-panel'), 'execution panel after approval');
  await click(ui, button(ui, '导入客户授权线索'));
  await wait(() => field(ui, '导入内容'), 'import textarea opens');
  await input(ui, field(ui, '导入内容'), [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Best Tools GmbH","https://best-tools.example.com","德国","分销商","Anna Weber","Purchasing Manager","anna@best-tools.example.com","https://best-tools.example.com/about","We distribute hand tools and garden hardware across Germany.","2026-10-15","首批优先"',
  ].join('\n'));
  await click(ui, button(ui, '导入并逐行校验'));
  await wait(() => ui.document.querySelector('.aiw-candidate'), 'real imported candidate rendered');
  const candidate = ui.document.querySelector('.aiw-candidate');
  assert.ok(candidate.textContent.includes('Best Tools GmbH'));
  assert.ok(candidate.textContent.includes('best-tools.example.com'));
  assert.ok(/匹配分 \d+/u.test(candidate.textContent));
  assert.ok(candidate.textContent.includes('来源') && candidate.textContent.includes('10月15日'));
  await click(ui, button(ui, '导出候选 CSV'));
  await wait(() => ui.document.querySelector('.aiw-live')?.textContent.includes('已导出'), 'candidate CSV export notice');
  assert.ok(f.requests.some(row => row.method === 'GET' && row.path.endsWith('/export/candidates')), 'candidate CSV requested from the server');
  await click(ui, button(ui, '导出审计事件 CSV'));
  await wait(() => f.requests.some(row => row.method === 'GET' && row.path.endsWith('/export/events')), 'audit CSV requested from the server');
  await click(ui, button(ui, '合格', candidate));
  await wait(() => field(ui, '审核理由 Best Tools GmbH'), 'review reason input');
  await input(ui, field(ui, '审核理由 Best Tools GmbH'), '产品/国家/买家类型与来源证据齐全');
  await click(ui, button(ui, '确认合格'));
  await wait(() => ui.document.querySelector('.aiw-candidate-review'), 'candidate reviewed as qualified');

  // Qualified lead -> UNSENT outreach draft -> human approval (still never sent).
  await wait(() => button(ui, '生成开发信草稿'), 'draft action appears for qualified lead');
  await click(ui, button(ui, '生成开发信草稿'));
  await wait(() => ui.document.querySelector('.aiw-draft'), 'outreach draft rendered');
  const draftText = ui.document.querySelector('.aiw-draft').textContent;
  assert.ok(draftText.includes('Best Tools GmbH'));
  assert.ok(draftText.includes('未发送'));
  assert.ok(draftText.includes('Abmelden: [Abmelde-Link]'), 'German market uses the German draft template');
  assert.ok(draftText.includes('best-tools.example.com/about'));
  await click(ui, button(ui, '审批草稿', ui.document.querySelector('.aiw-draft')));
  await wait(() => ui.document.querySelector('.aiw-draft')?.textContent.includes('已批准'), 'draft approved by admin');
  const draftsResponse = await f.request(`/api/ai-work-delegations/${listed.body.delegations[0].id}/drafts`);
  assert.equal(draftsResponse.body.drafts.length, 1);
  assert.equal(draftsResponse.body.drafts[0].status, 'approved');
  assert.equal(draftsResponse.body.drafts[0].sent, false);

  await click(ui, button(ui, '开始执行（自动搜索 + 已导入线索）'));
  await wait(() => ui.document.querySelector('.aiw-exec-status-completed'), 'execution completed');
  const executed = await f.request(`/api/ai-work-delegations/${listed.body.delegations[0].id}`);
  assert.equal(executed.body.delegation.execution.status, 'completed');
  assert.equal(executed.body.delegation.execution.counts.qualified, 1);

  const patched = await f.request(`/api/library/products/${productId}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, changes: { name: '不锈钢保温杯（二代）' } });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.product.revision, 2);

  ui.window.close();
  const reloaded = f.render('/aiworks', { width: 390 });
  await wait(() => reloaded.document.querySelector('.aiw-badge-approved'), 'approved delegation persists after reload');
  assert.ok(reloaded.document.querySelector('.aiw-detail').textContent.includes('不锈钢保温杯'));
  await wait(() => reloaded.document.querySelector('.aiw-newer-version'), 'newer product-library revision is surfaced');
  assert.ok(reloaded.document.querySelector('.aiw-newer-version').textContent.includes('v2'));
  await wait(() => reloaded.document.querySelector('.aiw-candidate'), 'reviewed candidate persists after reload');
  assert.ok(reloaded.document.querySelector('.aiw-candidate').textContent.includes('已合格'));
  await wait(() => reloaded.document.querySelector('.aiw-draft')?.textContent.includes('已批准'), 'approved unsent draft persists after reload');
  assert.ok(reloaded.document.querySelector('.aiw-draft').textContent.includes('未发送'));
  await wait(() => reloaded.document.querySelector('.aiw-events')?.textContent.includes('draft_approved'), 'audit event history visible');
  await click(reloaded, button(reloaded, '审批'));
  await wait(() => reloaded.document.querySelector('.aiw-events')?.textContent.includes('draft_approved') && !reloaded.document.querySelector('.aiw-events')?.textContent.includes('execution_completed'), 'audit filter review');
  await click(reloaded, button(reloaded, '执行'));
  await wait(() => reloaded.document.querySelector('.aiw-events')?.textContent.includes('execution_completed'), 'audit filter execution');
  await click(reloaded, button(reloaded, '草稿与发送'));
  await wait(() => reloaded.document.querySelector('.aiw-events')?.textContent.includes('draft_created'), 'audit filter drafts');
  await click(reloaded, button(reloaded, '全部'));
  await click(reloaded, button(reloaded, '用新版本新建委托'));
  await wait(() => reloaded.document.querySelector('.aiw-badge-draft'), 'new delegation created from the newer product version');
  const afterNewer = await f.request('/api/ai-work-delegations');
  assert.equal(afterNewer.body.delegations.length, 2);
  const newer = afterNewer.body.delegations.find(item => item.plan.productFacts.revision === 2);
  assert.ok(newer, 'new delegation pins the newer product revision');
  assert.equal(newer.status, 'draft');
  assert.equal(afterNewer.body.delegations.find(item => item.plan.productFacts.revision === 1).status, 'approved');
  const search = field(reloaded, '搜索委托');
  await input(reloaded, search, '不存在-xyz');
  await wait(() => reloaded.document.querySelectorAll('.aiw-delegation').length === 0, 'delegation search filters out all rows');
  assert.ok(reloaded.document.body.textContent.includes('没有匹配的委托'));
  await input(reloaded, search, '');
  await wait(() => reloaded.document.querySelectorAll('.aiw-delegation').length === 2, 'clearing delegation search restores rows');
  await choose(reloaded, field(reloaded, '委托状态'), 'approved');
  await wait(() => reloaded.document.querySelectorAll('.aiw-delegation').length === 1, 'status filter shows only approved delegations');
  await choose(reloaded, field(reloaded, '委托状态'), 'all');
  await wait(() => reloaded.document.querySelectorAll('.aiw-delegation').length === 2, 'status filter reset restores all delegations');
  assert.deepEqual(reloaded.errors, []);
  reloaded.window.close();
});

test('production DOM: an empty product library is explicit and never fabricated', async t => {
  const f = await fixture(t);
  const ui = f.render('/aiworks', { width: 390 });
  await wait(() => ui.document.querySelector('[data-testid="ai-works"]'), 'AI-work page mounted');
  await wait(() => ui.document.querySelector('.aiw-inline-empty'), 'product-library empty state');
  const text = ui.document.body.textContent;
  assert.ok(text.includes('产品库还没有可用产品'));
  assert.ok(text.includes('请先创建产品'));
  assert.equal(ui.document.querySelectorAll('select[aria-label="产品库产品"] option').length, 0);
  assert.equal(ui.document.querySelectorAll('.aiw-detail').length, 0, 'no demo delegation is invented');
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 0, 'empty page performs no mutation');
  assert.deepEqual(ui.errors, []);
  ui.window.close();
});

test('production DOM: a configured auto source produces source-backed candidates without CSV import', async t => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ organic: [
      { title: 'Auto Tools GmbH', link: 'https://auto-tools.example.com/about', snippet: 'We distribute hand tools and garden hardware across Germany.' },
      { title: 'No snippet', link: 'https://no-snippet.example.com', snippet: '' },
    ] }),
  });
  const f = await fixture(t, { capabilityEnvironment: { SERPER_API_KEY: 'test-serper-key' }, aiWorkSourceFetch: fetchImpl });
  const seeded = await f.request('/api/library/products', 'POST', libraryProductBody());
  assert.equal(seeded.status, 201, JSON.stringify(seeded.body));
  const productId = seeded.body.product.id;

  const ui = f.render('/aiworks', { width: 390 });
  await wait(() => ui.document.querySelector('[data-testid="ai-works"]'), 'AI-work page mounted');
  await wait(() => ui.document.querySelectorAll('select[aria-label="产品库产品"] option').length === 1, 'product option loaded');
  await choose(ui, field(ui, '产品库产品'), productId);
  await input(ui, field(ui, '目标国家'), '德国');
  await choose(ui, field(ui, '采购客户类型'), '分销商');
  await click(ui, button(ui, '生成开发计划并建立委托'));
  await wait(() => ui.document.querySelector('.aiw-badge-draft'), 'delegation created');
  await click(ui, button(ui, '审批开发计划'));
  await wait(() => ui.document.querySelector('.aiw-execution-panel'), 'execution panel after approval');
  await wait(() => ui.document.body.textContent.includes('Serper 搜索 API · 可用'), 'configured source shown as available');
  await click(ui, button(ui, '开始执行（自动搜索 + 已导入线索）'));
  await wait(() => ui.document.querySelector('.aiw-candidate'), 'auto-search candidate rendered');
  const candidate = ui.document.querySelector('.aiw-candidate').textContent;
  assert.ok(candidate.includes('Auto Tools GmbH'));
  assert.ok(candidate.includes('auto-tools.example.com'));
  assert.ok(/匹配分 \d+/u.test(candidate));
  assert.equal(f.requests.filter(row => row.method === 'POST' && row.path.endsWith('/candidates')).length, 0, 'no CSV import was used');
  const listed = await f.request('/api/ai-work-delegations');
  const delegation = listed.body.delegations[0];
  assert.equal(delegation.execution.status, 'completed');
  assert.deepEqual(delegation.execution.sources, ['serper']);
  assert.equal(delegation.execution.counts.candidates, 1);
  assert.deepEqual(ui.errors, []);
  ui.window.close();
});

test('production DOM: an administrator publishes a new AI-work product version into the platform registry', async t => {
  const f = await fixture(t);
  const seeded = await f.request('/api/library/products', 'POST', libraryProductBody());
  assert.equal(seeded.status, 201, JSON.stringify(seeded.body));
  const libraryProductId = seeded.body.product.id;
  const ui = f.render('/aiworks', { width: 390 });
  await wait(() => ui.document.querySelector('[data-testid="ai-works"]'), 'AI-work page mounted');
  await wait(() => ui.document.querySelector('.aiw-publish'), 'publish panel visible for admin');
  await click(ui, button(ui, '复制当前产品为新 ID'));
  await wait(() => field(ui, '产品 ID'), 'publish editor opens with the current product');
  assert.equal(field(ui, '产品 ID').value, 'lead-discovery-copy');
  await input(ui, field(ui, '产品 ID'), 'lead-discovery-copy');
  await input(ui, field(ui, '产品名称'), '线索挖掘副本');
  await input(ui, field(ui, '产品简介'), '管理员通过 UI 发布的产品副本，用于验证产品数据库写入。');
  await click(ui, button(ui, '发布产品'));
  await wait(() => ui.document.querySelector('.aiw-live')?.textContent.includes('已发布'), 'publish success notice');
  const catalog = await f.request('/api/ai-works');
  assert.equal(catalog.body.products.length, 2);
  assert.ok(catalog.body.products.some(item => item.id === 'lead-discovery-copy' && item.revision === 1));

  await wait(() => ui.document.querySelectorAll('select[aria-label="AI-work 产品"] option').length === 2, 'new AI-work product selectable');
  await choose(ui, field(ui, 'AI-work 产品'), 'lead-discovery-copy');
  await choose(ui, field(ui, '产品库产品'), libraryProductId);
  await input(ui, field(ui, '目标国家'), '德国');
  await choose(ui, field(ui, '采购客户类型'), '分销商');
  await click(ui, button(ui, '生成开发计划并建立委托'));
  await wait(() => ui.document.querySelector('.aiw-detail'), 'delegation created for the published AI-work product');
  assert.ok(f.requests.some(row => row.method === 'POST' && row.path === '/api/ai-works/lead-discovery-copy/delegations'), 'delegation uses the selected AI-work product');
  const listed = await f.request('/api/ai-work-delegations');
  assert.ok(listed.body.delegations.some(item => item.plan.productFacts.productId === libraryProductId));

  await f.restart();
  const reloaded = f.render('/aiworks', { width: 390 });
  await wait(() => reloaded.document.querySelector('.aiw-meta')?.textContent.includes('AI-work 产品 2 个'), 'published product persists after restart');
  const afterRestart = await f.request('/api/ai-works');
  assert.ok(afterRestart.body.products.some(item => item.id === 'lead-discovery-copy' && item.revision === 1));
  assert.deepEqual(reloaded.errors, []);
  reloaded.window.close();
});

test('production DOM: an admin completes and sends an approved draft through the configured provider', async t => {
  const calls = [];
  const outreachFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ id: 'msg_dom_1' }) };
  };
  const f = await fixture(t, {
    capabilityEnvironment: { OUTREACH_PROVIDER: 'resend', RESEND_API_KEY: 'test-dom-key', OUTREACH_FROM_EMAIL: 'sales@acme.example.com' },
    aiWorkOutreachFetch: outreachFetch,
  });
  const seeded = await f.request('/api/library/products', 'POST', libraryProductBody());
  assert.equal(seeded.status, 201, JSON.stringify(seeded.body));
  const productId = seeded.body.product.id;

  const ui = f.render('/aiworks', { width: 390 });
  await wait(() => ui.document.querySelector('[data-testid="ai-works"]'), 'AI-work page mounted');
  await wait(() => ui.document.querySelectorAll('select[aria-label="产品库产品"] option').length === 1, 'product option loaded');
  await choose(ui, field(ui, '产品库产品'), productId);
  await input(ui, field(ui, '目标国家'), '德国');
  await choose(ui, field(ui, '采购客户类型'), '分销商');
  await click(ui, button(ui, '生成开发计划并建立委托'));
  await wait(() => ui.document.querySelector('.aiw-badge-draft'), 'delegation created');
  await click(ui, button(ui, '审批开发计划'));
  await wait(() => ui.document.querySelector('.aiw-execution-panel'), 'execution panel after approval');
  await click(ui, button(ui, '导入客户授权线索'));
  await wait(() => field(ui, '导入内容'), 'import textarea opens');
  await input(ui, field(ui, '导入内容'), [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Best Tools GmbH","https://best-tools.example.com","德国","分销商","Anna Weber","Purchasing Manager","anna@best-tools.example.com","https://best-tools.example.com/about","We distribute hand tools and garden hardware across Germany.","2026-10-15","首批优先"',
  ].join('\n'));
  await click(ui, button(ui, '导入并逐行校验'));
  await wait(() => ui.document.querySelector('.aiw-candidate'), 'imported candidate rendered');
  await click(ui, button(ui, '合格', ui.document.querySelector('.aiw-candidate')));
  await wait(() => field(ui, '审核理由 Best Tools GmbH'), 'review reason input');
  await input(ui, field(ui, '审核理由 Best Tools GmbH'), '产品/国家/买家类型与来源证据齐全');
  await click(ui, button(ui, '确认合格'));
  await wait(() => ui.document.querySelector('.aiw-candidate-review'), 'candidate qualified');
  await click(ui, button(ui, '生成开发信草稿'));
  await wait(() => ui.document.querySelector('.aiw-draft'), 'draft rendered');
  await click(ui, button(ui, '编辑草稿'));
  await wait(() => field(ui, '草稿正文 Best Tools GmbH'), 'draft editor opens');
  await input(ui, field(ui, '草稿主题 Best Tools GmbH'), 'Hand tools supply for Best Tools GmbH');
  await input(ui, field(ui, '草稿正文 Best Tools GmbH'), 'Hello Anna Weber,\n\nI am Alice from Acme Tools. We manufacture hand tool sets and would like to discuss supply for Best Tools GmbH.\n\nUnsubscribe: https://acme.example.com/unsubscribe\n');
  await click(ui, button(ui, '保存草稿修订'));
  await wait(() => !field(ui, '草稿正文 Best Tools GmbH'), 'draft saved and editor closed');
  await wait(() => button(ui, '审批草稿') && button(ui, '审批草稿').disabled === false, 'draft approve control is enabled');
  await click(ui, button(ui, '审批草稿'));
  await wait(() => button(ui, '发送开发信'), 'approved draft offers send action');
  await click(ui, button(ui, '发送开发信'));
  await wait(() => field(ui, '同意依据 Best Tools GmbH'), 'send confirmation with consent basis');
  const consent = ui.document.querySelector('.aiw-review-box input[type="checkbox"]');
  assert.ok(consent, 'consent checkbox shown for Germany');
  await click(ui, consent);
  await input(ui, field(ui, '同意依据 Best Tools GmbH'), '客户 2026-10-20 邮件明确同意接收报价');
  await click(ui, button(ui, '确认发送（Resend）'));
  await wait(() => ui.document.querySelector('.aiw-draft')?.textContent.includes('已发送'), 'draft sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.to[0], 'anna@best-tools.example.com');
  assert.ok(payload.text.includes('Unsubscribe: https://acme.example.com/unsubscribe'));
  const delegationId = (await f.request('/api/ai-work-delegations')).body.delegations[0].id;
  const drafts = await f.request(`/api/ai-work-delegations/${delegationId}/drafts`);
  assert.equal(drafts.body.drafts[0].sent, true);
  assert.equal(drafts.body.drafts[0].sendReceipt.messageId, 'msg_dom_1');
  assert.deepEqual(ui.errors, []);
  ui.window.close();
});
