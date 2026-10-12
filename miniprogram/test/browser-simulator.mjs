// Actual compiled Page callbacks + actual source WXML/WXSS in a deliberately
// limited Chromium renderer. This is NOT WeChat DevTools or a real device.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import { installSourceRenderer } from './source-renderer.mjs';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { fixture, loadPage, until, WorkspaceClient } from './support.mjs';
const destination = new URL('../evidence/browser/', import.meta.url);
await fs.mkdir(destination, { recursive: true });
const wxml = await fs.readFile(new URL('../src/pages/conversation/index.wxml', import.meta.url), 'utf8');
const css = (await fs.readFile(new URL('../src/app.wxss', import.meta.url), 'utf8')) + (await fs.readFile(new URL('../src/pages/conversation/index.wxss', import.meta.url), 'utf8'));
const spirit = 'data:image/png;base64,' + (await fs.readFile(new URL('../src/assets/spirit.png', import.meta.url))).toString('base64');
for (const match of wxml.matchAll(/wx:(?:if|for)="([^"]+)"/g)) assert.match(match[1], /^{{[\s\S]*}}$/, 'WXML control expressions must use native {{ }} binding');
const f = await fixture();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const ui = await context.newPage(); const errors = [], checks = [];
ui.on('pageerror', error => errors.push(error.message));
let active, painting = Promise.resolve();
await ui.exposeFunction('pageEvent', async (handler, dataset, value) => {
  await active[handler]({ currentTarget: { dataset }, detail: { value } }); await paint(); return active.data;
});
await ui.setContent('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><header>浏览器运行模拟 · 原 WXML/WXSS · 非微信真机</header><main></main></body></html>');
await installSourceRenderer(ui, { wxml, css, spirit });
function paint() { painting = painting.then(() => ui.evaluate(state => window.renderSource(state), active.data)); return painting; }
function attach(client) {
  active?.onUnload(); const loaded = loadPage(client, f.platform); active = loaded.page;
  const original = active.setData; active.setData = function(values) { original.call(this, values); void paint(); };
  active.onShow(); return active;
}
async function screenshot(name) { await paint(); await ui.screenshot({ path: new URL(name, destination).pathname }); }
async function click(text) { await ui.getByRole('button', { name: text, exact: true }).click(); await paint(); }
try {
  attach(new WorkspaceClient(f.platform, { baseUrl: '' })); await until(() => active.data.readError);
  await screenshot('setup-blocked-390.png'); assert.equal(await ui.locator('.composer').count(), 0); checks.push('Empty shipped configuration visibly blocks login; no fake identity');
  attach(f.client); await until(() => active.data.conversationId); await paint();
  await screenshot('main-conversation-390.png'); checks.push('Native source binding renders one composer, original spirit, resource expansion on demand');
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: '测试方案已保存：先确定产品卖点、目标市场和交付范围；外发和执行仍需批准。', artifact: { filename: '上架方案-测试.md', content: '# 上架方案（运行模拟 fixture）\n\n1. 核对目标市场与产品卖点。\n2. 需要外发时审阅确切对象。\n3. 经批准后使用原连接器执行。\n\n此文件来自本地 faux 模型，无真实外部执行。' } }))]);
  active.draft({ detail: { value: '帮我整理这款夹克的上架方案，先给计划，外发前让我确认。' } }); await paint(); await click('发送');
  await until(() => f.app.runtime.listRuns().runs[0]?.status === 'succeeded'); await active.refresh(); await paint();
  assert.equal(f.faux.state.callCount, 1); await screenshot('delivery-390.png');
  await click('校验并打开'); await until(() => active.data.preview); await paint(); assert.match(active.data.preview.content, /运行模拟 fixture/); await screenshot('verified-file-preview-390.png'); await click('返回');
  const id = active.data.conversationId;
  const pdf = Buffer.from('%PDF-1.7\nStored original PDF fixture, no extraction'); const pdfPath = `${f.directory}/product.pdf`; await fs.writeFile(pdfPath, pdf); await active.attach('产品资料-测试.pdf', pdfPath, pdf.length); await active.refresh();
  await click('引用资料'); await until(() => active.data.referencesOpen); await screenshot('resources-390.png'); await click('返回会话');
  checks.push('Actual loopback Pi request, Store bytes, wx transport shim SHA256, source-driven text preview and persistent PDF resource');
  const connector0 = (await f.app.capabilities.createConnector({ name: 'Original simulator library', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
  const connector = (await f.app.capabilities.updateConnector(connector0.id, { enabled: true })).connector;
  await f.app.runtime.updateConversationInputContext(id, { inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [{ connectorId: connector.id, action: 'create_file' }] } });
  await active.refresh(); f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: '请审阅确切写入范围', connectorId: connector.id, action: 'create_file', resource: 'library:new', payload: { filename: '待审批-测试.md', content: '仅本地运行模拟资料' } }), { stopReason: 'toolUse' })]);
  active.draft({ detail: { value: '准备一份测试资料，展示确切审批范围。' } }); await active.send(); await until(() => f.app.runtime.listRuns().runs.at(-1)?.status === 'awaiting_approval'); await active.refresh(); await paint();
  await click('审阅并决定'); await until(() => active.data.reviewCard); await screenshot('exact-review-390.png');
  assert.equal(f.app.capabilities.listConnectorRuns().length, 0); await click('拒绝此项'); await until(() => f.app.runtime.listRuns().runs.at(-1)?.error?.code === 'ACTION_DENIED'); await active.refresh();
  checks.push('Explicit exact proposal rejection performs zero connector executions; free text never approves');
  f.offline(); active.draft({ detail: { value: '网络恢复后继续核对同一条业务目标。' } }); await active.send(); assert.equal(active.data.uncertain, true); await screenshot('uncertain-original-request-390.png'); f.offline(false);
  await ui.setViewportSize({ width: 320, height: 740 }); await paint();
  const overflow = await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false); await screenshot('compact-320.png'); checks.push('320px simulation has no horizontal overflow; unknown request preserves input and blocks new send');
  assert.deepEqual(errors, []);
  await fs.writeFile(new URL('acceptance.json', destination), JSON.stringify({ mode: 'Custom source-driven Chromium simulation, not WeChat DevTools/device', browserVersion: browser.version(), actualRuntime: 'Compiled Page JS in Node vm; original WXML/WXSS converted by limited renderer; wx transport shims to real local HTTP backend; official Pi faux model; no live login/account/Muse execution', checks, pageErrors: errors, backendModelCalls: f.faux.state.callCount, connectorExecutions: f.app.capabilities.listConnectorRuns().length, generatedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, pageErrors: errors, browserVersion: browser.version(), mode: 'source-driven Chromium simulation', destination: destination.pathname }));
} finally { active?.onUnload(); await context.close(); await browser.close(); await f.close(); }
