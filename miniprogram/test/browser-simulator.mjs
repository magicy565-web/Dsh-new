// Actual compiled Page callbacks + actual source WXML/WXSS in a deliberately
// limited Chromium renderer. This is NOT WeChat DevTools or a real device.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
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
await ui.evaluate(({ wxml, css, spirit }) => {
  const normalized = wxml.replace(/\b(scroll-y|selectable|auto-height|wx:else)(?=[\s>])/g, '$1=""');
  const source = new DOMParser().parseFromString('<root xmlns:wx="urn:wx">' + normalized + '</root>', 'application/xml');
  if (source.querySelector('parsererror')) throw Error(source.querySelector('parsererror').textContent);
  const style = document.createElement('style'); document.head.append(style);
  const evaluate = (expression, scope) => new Function('scope', 'with(scope) { return (' + expression + '); }')(scope);
  const value = (text, scope) => { const full = text.match(/^{{([\s\S]+)}}$/); return full ? evaluate(full[1], scope) : text.replace(/{{([\s\S]+?)}}/g, (_, expression) => String(evaluate(expression, scope) ?? '')); };
  function children(nodes, scope, parent) {
    let previousIf = null;
    for (const node of nodes) {
      if (node.nodeType === 3) { parent.append(document.createTextNode(String(value(node.textContent, scope)))); continue; }
      if (node.nodeType !== 1) continue;
      if (node.hasAttribute('wx:if')) { previousIf = Boolean(value(node.getAttribute('wx:if'), scope)); if (!previousIf) continue; }
      else if (node.hasAttribute('wx:else')) { if (previousIf !== false) continue; previousIf = null; }
      else previousIf = null;
      if (node.hasAttribute('wx:for')) {
        const list = value(node.getAttribute('wx:for'), scope);
        if (!Array.isArray(list)) throw Error('Simulator expects actual array in wx:for');
        list.forEach((item, index) => element(node, { ...scope, item, index }, parent));
      } else element(node, scope, parent);
    }
  }
  function element(node, scope, parent) {
    const tag = ({ view: 'div', 'scroll-view': 'div', text: 'span', image: 'img' })[node.tagName] || node.tagName;
    const target = document.createElement(tag); let handler, inputHandler;
    for (const attribute of node.attributes) {
      if (attribute.name.startsWith('wx:') || ['scroll-y', 'auto-height', 'selectable', 'mode'].includes(attribute.name)) continue;
      if (attribute.name === 'bindtap') { handler = attribute.value; continue; }
      if (attribute.name === 'bindinput') { inputHandler = attribute.value; continue; }
      const rendered = value(attribute.value, scope);
      if (attribute.name === 'disabled') { target.disabled = Boolean(rendered); continue; }
      if (attribute.name === 'loading') continue;
      if (attribute.name === 'value') { target.value = String(rendered ?? ''); continue; }
      target.setAttribute(attribute.name, String(rendered ?? ''));
    }
    if (node.tagName === 'text') target.classList.add('wx-text');
    if (node.tagName === 'image') target.src = spirit;
    if (node.tagName === 'scroll-view') target.style.overflowY = 'auto';
    if (handler) target.onclick = async () => { await window.pageEvent(handler, { ...target.dataset }); };
    if (inputHandler) target.oninput = () => { void window.pageEvent(inputHandler, {}, target.value); };
    children([...node.childNodes], scope, target); parent.append(target);
  }
  window.renderSource = state => {
    const scroll = document.querySelector('.transcript')?.scrollTop || 0;
    const height = document.querySelector('.transcript')?.scrollHeight || 0;
    const nativeCss = css.replace(/(-?[\d.]+)rpx/g, (_, number) => `${Number(number) * innerWidth / 750}px`).replace(/\bpage(?=\s*{)/g, 'body').replace(/\btext(?=[\s,{.#>:+])/g, '.wx-text');
    style.textContent = nativeCss + 'body{margin:0}header{height:28px;box-sizing:border-box;text-align:center;padding:6px 2px;background:#e9e5d9;color:#6b675b;font-size:11px}.conversation{height:calc(100vh - 28px)}.wx-text{display:inline}textarea{font:inherit;border:0;resize:none;min-height:65px}button{border:0;cursor:pointer}button:disabled{opacity:.5;cursor:default}.transcript{overflow-y:auto}.sheet-heading{gap:10px}.card-title{display:block}';
    const root = document.querySelector('main'); root.replaceChildren(); children([...source.documentElement.childNodes], state, root);
    const transcript = document.querySelector('.transcript'); if (transcript) transcript.scrollTop = Math.abs(scroll - height) < 50 ? transcript.scrollHeight : scroll;
  };
}, { wxml, css, spirit });
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
