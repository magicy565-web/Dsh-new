// Original Page/Component/WXML/WXSS + real local signed HTTP business backend.
// Limited Chromium rendering; not a WeChat tool/device or live Muse account.
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { loadPage, until } from './support.mjs';
import { intakeFixture, readyScope, scopeText } from './intake-http-support.mjs';
import { installSourceRenderer } from './source-renderer.mjs';
const destination = new URL('../evidence/intake/browser/', import.meta.url); await fs.mkdir(destination, { recursive: true });
const f = await intakeFixture(), client = f.client(), { page } = loadPage(client, f.platform);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const ui = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); const errors = []; ui.on('pageerror', error => errors.push(error.message));
const file = new URL('../../release/miniprogram/components/muse-draft-review/index.js', import.meta.url); let definition;
vm.runInNewContext(readFileSync(file, 'utf8'), { exports: {}, require: createRequire(file), Component(value) { definition = value; }, WeakMap, Error, JSON });
const pending = []; let interactions = 0; const routes = { prepare: 'prepareDraft', edit: 'editDraft', reject: 'rejectDraft', close: 'closeDraft' };
const component = { data: { ...definition.data, busy: false, uncertain: false, serverError: '' }, setData(value) { Object.assign(this.data, structuredClone(value)); }, triggerEvent(name, detail) { const result = page[routes[name]]({ detail }); if (result?.then) pending.push(result); } }; Object.assign(component, definition.methods);
let paint = Promise.resolve();
function render() { definition.properties.draft.observer.call(component, page.data.selectedDraft); Object.assign(component.data, { busy: page.data.loading, uncertain: page.data.uncertain, serverError: page.data.error }); const state = { ...page.data, _draftReview: component.data }; paint = paint.then(() => ui.evaluate(value => window.renderSource(value), state)); return paint; }
const originalSet = page.setData; page.setData = function(value) { originalSet.call(this, value); void render(); };
await ui.exposeFunction('pageEvent', async (handler, dataset, value) => { const child = handler.startsWith('component.'); const name = child ? handler.slice(10) : handler; await (child ? component : page)[name]({ currentTarget: { dataset }, detail: { value } }); await Promise.all(pending.splice(0)); await render(); interactions++; });
await ui.setContent('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><header>浏览器运行模拟 · 本地 HTTP/faux · 非微信/Muse真机</header><main></main></body></html>');
const wxml = await fs.readFile(new URL('../src/pages/conversation/index.wxml', import.meta.url), 'utf8'), componentWxml = await fs.readFile(new URL('../src/components/muse-draft-review/index.wxml', import.meta.url), 'utf8');
const css = (await Promise.all(['../src/app.wxss', '../src/pages/conversation/index.wxss', '../src/components/muse-draft-review/index.wxss'].map(path => fs.readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
const spirit = 'data:image/png;base64,' + (await fs.readFile(new URL('../src/assets/spirit.png', import.meta.url))).toString('base64');
await installSourceRenderer(ui, { wxml, componentWxml, css, spirit });
async function shot(name) { await render(); await ui.screenshot({ path: new URL(name, destination).pathname }); }
async function click(name) { await render(); const before = interactions; await ui.getByRole('button', { name, exact: true }).click(); await until(() => interactions > before); await paint; }
async function check(value) { const before = interactions; await ui.locator(`input[value=${value}]`).check(); await until(() => interactions > before); await paint; }
try {
  page.onShow(); await until(() => page.data.readAt);
  const scope = readyScope(); f.respond({ ...scope, budgetCredits: null, deadlineAt: null });
  page.draft({ detail: { value: `请为${scope.product}做${scope.market}市场的海外销售渠道验证，目标是${scope.objective}；预算和期限我再补充。` } }); await click('发送'); await f.settle(client); await page.refresh(); await shot('necessary-questions-390.png'); assert.equal(page.data.draftCards.at(-1).questions.length, 2);
  f.respond(scope); page.draft({ detail: { value: scopeText(scope) } }); await click('发送'); await f.settle(client); await page.refresh(); await click('审阅草案'); await shot('exact-draft-review-390.png');
  assert.equal(await ui.locator('input[type=checkbox]').count(), 3); assert.equal(await ui.locator('input[type=checkbox]:checked').count(), 0);
  await check('budget'); await check('deadline'); assert.equal(await ui.getByRole('button', { name: '准备待审原单', exact: true }).isDisabled(), true);
  await check('public'); await click('准备待审原单'); await until(() => page.data.museDrafts.at(-1)?.phase === 'prepared'); await shot('original-order-pending-approval-390.png'); assert.equal((f.app.store.read().museTasks || []).length, 0);
  await click('审阅并决定'); await click('批准此项'); assert.equal((f.app.store.read().museTasks || []).length, 0); await click('派发原订单'); await click('派发原单'); assert.equal(f.app.store.read().museTasks.length, 1);
  const orderId = page.data.museDrafts.at(-1).orderId, delivered = await f.deliver(orderId); await page.refresh(); await click('核对原进度'); await click('核对进度'); await shot('original-receipt-390.png');
  await click('校验并打开'); await until(() => page.data.preview); assert.equal(page.data.preview.content, delivered.bytes.toString()); await shot('original-file-sha-preview-390.png'); await click('返回');
  await ui.setViewportSize({ width: 320, height: 740 }); await render(); assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await shot('compact-320.png');
  assert.deepEqual(errors, []); const result = { mode: 'Compiled Page/Component + source WXML/WXSS in limited Chromium renderer; real signed local HTTP/Pi faux/Store/original Worker protocol; not WeChat engine/device/live Muse', backendSource: '96231bbff32c0bbb03329dd2b218e58a98f557d8', browserVersion: browser.version(), checks: ['Two actual missing questions only', 'Three independent unchecked confirmations', 'Prepare creates one unapproved original order', 'Approve does not dispatch; separate dispatch creates one original task', 'Actual Worker receipt artifact ID and bytes verified by SHA', '390/320px source rendering, no horizontal overflow'], modelCalls: f.faux.state.callCount, originalOrders: f.app.store.read().workerOrders.length, originalTasks: f.app.store.read().museTasks.length, artifactId: delivered.artifactId, pageErrors: errors, generatedAt: new Date().toISOString() }; await fs.writeFile(new URL('acceptance.json', destination), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { page.onUnload(); await browser.close(); await f.close(); }
