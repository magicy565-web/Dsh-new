import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createApp } from '../server/index.mjs';

const directory = await fs.mkdtemp('/tmp/workspace-supplier-browser-'), destination = process.env.SUPPLIER_BROWSER_EVIDENCE_DIRECTORY || 'docs/validation/supplier-service/browser';
const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
const { port } = await app.listen(0), base = `http://127.0.0.1:${port}`;
let browser;
const errors = [], checks = [];
try {
  await fs.mkdir(destination, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', error => errors.push(error.message));
  async function post(route, body) { const response = await page.request.post(base + route, { data: body }); const result = await response.json(); assert.ok(response.ok(), JSON.stringify(result)); return result; }
  // Technical, clearly labelled fixture image; no product photo or live image
  // rights are represented. Actual PNG bytes traverse the original file API.
  const picture = await browser.newPage({ viewport: { width: 440, height: 260 } });
  await picture.setContent('<html><body style="margin:0;background:#e7edf5;display:grid;place-items:center;height:100vh;font:24px system-ui;color:#364865"><div style="text-align:center"><div style="font-size:54px">▧</div><b>PRODUCT FIXTURE</b><p style="font-size:16px">Local file-chain acceptance image</p></div></body></html>');
  const png = await picture.screenshot(); await picture.close();
  const image = (await post('/api/artifacts', { requestId: 'supplier-browser-image', filename: 'supplier-browser-fixture.png', base64: png.toString('base64'), metadata: { businessLibrary: { visibility: 'internal' } } })).artifact;
  const main = (await post('/api/conversations', { requestId: 'supplier-browser-main', title: '原主会话 · 供应商 Listing 本地验收' })).conversation;
  const route = '/api/conversations/' + encodeURIComponent(main.id) + '/supplier-services';
  const content = '名称: 原产品 · 本地 fixture; MOQ: 500; 批发价: 2.50; 批发货币: CNY; 生产交期: 30 天';
  faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_supplier_profile', { facts: { name: '原产品 · 本地 fixture', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30 }, sources: ['name', 'supplierMoq', 'wholesaleUnitPrice', 'wholesaleCurrency', 'productionDays'].map(field => ({ field, kind: 'message', requestId: 'supplier-browser-intake', quote: content })) }), { stopReason: 'toolUse' })]);
  const intake = await post(route, { requestId: 'supplier-browser-intake', content });
  for (let n = 0; n < 300 && app.runtime.getRun(intake.run.id).run.status === 'running'; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.runtime.getRun(intake.run.id).run.status, 'succeeded');
  const serviceRoute = route + '/' + intake.serviceId;
  const facts = await post(serviceRoute + '/profile', { requestId: 'supplier-browser-retail-facts', expectedRevision: 1, facts: { description: '已确认的产品描述。此为本地业务验收 fixture，未连接真实店铺。', targetMarket: 'US', currency: 'USD', skuCode: 'FIXTURE-01', retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', handlingDays: 3, shippingDays: 7, images: [{ kind: 'artifact', asset: { artifactId: image.id, version: 1, sha256: image.sha256 }, sourceNote: '本地合成验收图，仅验证原文件/SHA链' }] } });
  assert.equal(facts.service.profile.supplierMoq, 500); assert.equal(facts.service.preview, null);
  const preview = await post(serviceRoute + '/preview', { requestId: 'supplier-browser-confirm-preview', expectedRevision: 2, confirmed: true, publicFields: ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'] });
  assert.equal(preview.preview.phase, 'preview_ready'); assert.equal(preview.preview.externalStatus, 'preview');
  await page.goto(base + serviceRoute + '/preview-page'); await page.locator('h1').waitFor();
  assert.equal(await page.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  const text = await page.locator('body').innerText(); assert.ok(text.includes('USD 9.50')); assert.ok(text.includes('2 piece')); assert.ok(!text.includes('500')); assert.ok(!text.includes('2.50')); assert.ok(!text.includes('30 天'));
  await page.screenshot({ path: `${destination}/listing-preview-390.png`, fullPage: true });
  checks.push('Actual Chromium request → original HTTP → real Pi SDK fixture tool → private Store → explicit retail facts/public fields → server-rendered Listing and exact original PNG bytes');
  await page.setViewportSize({ width: 320, height: 844 }); const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.ok(geometry.scrollWidth <= geometry.width + 1); await page.screenshot({ path: `${destination}/listing-preview-320.png`, fullPage: true });
  checks.push('320px and 390px readable retail preview; supplier MOQ/wholesale/production not rendered as consumer fields');
  const draft = await post(serviceRoute + '/shopify-draft', { requestId: 'supplier-browser-blocked-draft', expectedRevision: 3, expectedPreviewHash: preview.preview.previewHash, confirmed: true }); assert.equal(draft.status, 'blocked'); assert.equal(draft.error.code, 'SHOPIFY_SETUP_REQUIRED');
  const monitor = await post(serviceRoute + '/monitors', { requestId: 'supplier-browser-monitor-config', expectedRevision: 3, shopifyProductId: 'gid://shopify/Product/123', startAt: new Date(Date.now() - 3600000).toISOString(), confirmed: true }); assert.equal(monitor.status, 'blocked'); assert.equal(monitor.monitor.scheduleEnabled, false);
  checks.push('Unconfigured Shopify draft and monitoring are explicitly blocked; monitor is an original disabled task, no real store request or notification');
  await page.goto(base + '/chat/' + encodeURIComponent(main.id)); await page.waitForFunction(() => document.querySelector('[aria-busy="false"]')); assert.equal(await page.locator('.control-spirit').count(), 1); await page.screenshot({ path: `${destination}/original-main-conversation-320.png`, fullPage: true });
  assert.equal(faux.state.callCount, 1); assert.deepEqual(errors, []);
  const evidence = { result: 'passed', evidenceKind: 'actual-local-chromium-original-http-pi-sdk-fixture-and-ssr-preview', actualBrowser: true, chromium: browser.version(), checks, consoleErrors: errors, screenshots: ['listing-preview-390.png', 'listing-preview-320.png', 'original-main-conversation-320.png'], modelCalls: 1, realStoreConfigured: false, liveShopify: false, liveMuse: false, externalNotification: false, wechatDevice: false, independentSecurityAudit: false, note: 'Backend-owned standalone Listing preview. The separate mini client/main conversation wiring is not represented as integrated here.' };
  await fs.writeFile(`${destination}/acceptance.json`, JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
