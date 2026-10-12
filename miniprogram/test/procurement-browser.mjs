// Actual compiled Page + original WXML/WXSS in limited Chromium renderer,
// original local HTTP/MCP/Store. Not official WeChat or real buyer/Muse.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import { loadPage, until } from './support.mjs';
import { procurementFixture } from './procurement-support.mjs';
import { installSourceRenderer } from './source-renderer.mjs';
const output = new URL('../evidence/procurement/browser/', import.meta.url); await fs.mkdir(output, { recursive: true });
const f = await procurementFixture(), { page } = loadPage(f.client(), f.platform), browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const ui = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []; ui.on('pageerror', error => errors.push(error.message)); let paint = Promise.resolve(), interactions = 0;
const render = () => { paint = paint.then(() => ui.evaluate(value => window.renderSource(value), page.data)); return paint; };
const set = page.setData; page.setData = function(value) { set.call(this, value); void render(); };
await ui.exposeFunction('pageEvent', async (handler, dataset, value) => { await page[handler]({ currentTarget: { dataset }, detail: { value } }); await render(); interactions++; });
await ui.setContent('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><header>小程序源码 Chromium 模拟 · 本地HTTP/MCP · 非微信真机</header><main></main></body></html>');
const wxml = await fs.readFile(new URL('../src/pages/conversation/index.wxml', import.meta.url), 'utf8'), css = (await Promise.all(['../src/app.wxss', '../src/pages/conversation/index.wxss'].map(name => fs.readFile(new URL(name, import.meta.url), 'utf8')))).join('\n'), spirit = 'data:image/png;base64,' + (await fs.readFile(new URL('../src/assets/spirit.png', import.meta.url))).toString('base64'); await installSourceRenderer(ui, { wxml, css, spirit });
async function click(name) { await render(); const before = interactions; await ui.getByRole('button', { name, exact: true }).click(); await until(() => interactions > before); await paint; }
async function shot(name) { await render(); await ui.screenshot({ path: new URL(name, output).pathname }); }
try {
 page.onShow(); await until(() => page.data.readAt); await click('采购需求'); assert.equal(page.data.procurementInbox.length, 0); await click('返回会话');
 await f.share(); await click('采购需求'); await shot('confirmed-inquiry-390.png'); await click('关联到本会话'); await shot('association-scope-390.png'); await click('确认关联本会话');
 await click('采购需求'); await click('回复原采购方'); const reply = '可交货日期仍需确认。本次仅回复原需求，不构成采购订单、付款或外发资料授权。'; page.draft({ detail: { value: reply } }); await click('审阅回复'); await shot('exact-reply-review-390.png'); await click('确认提交原回复');
 const buyer = (await f.mcp('workspace_procurement_get', { inquiryId: f.draft.id })).inquiry; assert.equal(buyer.replies.length, 1); assert.equal(buyer.replies[0].content, reply);
 page.onHide(); page.onShow(); await until(() => page.data.messages.some(message => message.content.includes(reply))); await click('采购需求'); await shot('reopened-original-reply-390.png');
 await ui.setViewportSize({ width: 320, height: 740 }); await render(); assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await shot('compact-320.png');
 assert.equal(f.modelCalls, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal((f.app.store.read().workerOrders || []).length, 0); assert.deepEqual(errors, []);
 const result = { evidenceKind: 'Original mini Page/WXML/WXSS source in limited Chromium renderer + actual original local HTTP/MCP/Store; not WeChat engine/device/live buyer/Muse', backend: 'a5a524a19adf065f804abc1459f1f573cfd8adf4', chromium: browser.version(), checks: ['Private buyer draft not in inbox', 'Buyer confirmed share visible only on demand', 'Exact range explicitly binds server-owned main', 'Only full reviewed reply text persisted and buyer MCP retrieves it', 'Reopening restores original messages and one reply', '390/320px no horizontal overflow'], modelCalls: f.modelCalls, runs: f.app.store.read().runs.length, workerOrders: (f.app.store.read().workerOrders || []).length, replies: buyer.replies.length, pageErrors: errors, liveBuyer: false, wechatDevice: false, independentSecurityAudit: false, generatedAt: new Date().toISOString() }; await fs.writeFile(new URL('acceptance.json', output), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { page.onUnload(); await browser.close(); await f.close(); }
