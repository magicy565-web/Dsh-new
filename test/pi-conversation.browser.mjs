import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createApp } from '../server/index.mjs';

const directory = await fs.mkdtemp('/tmp/workspace-pi-browser-');
const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
const conversation = (await app.runtime.createConversation({ title: '原主会话 · Pi 本地验收' })).conversation;
const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
const destination = 'docs/validation/cloud-pi/browser'; await fs.mkdir(destination, { recursive: true });
let browser;
const errors = [], checks = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/');
  await page.waitForFunction(() => document.querySelector('[aria-busy="false"]'));
  await page.getByRole('textbox', { name: '输入消息' }).waitFor();
  assert.equal(await page.locator('.control-spirit').count(), 1);
  assert.ok(page.url().includes(encodeURIComponent(conversation.id)));
  await page.screenshot({ path: `${destination}/desktop-conversation.png`, fullPage: true });
  await page.locator('.control-spirit').screenshot({ path: 'miniprogram/src/assets/spirit.png' });
  checks.push('Original conversation/one companion render in real Chromium without another UI design');
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Pi 本地浏览器验收已返回文件。此为 fixture，不是真实 Muse 或模型账号执行。', artifact: { filename: 'browser-result.md', content: '# Browser fixture\nExact persisted file bytes.' } }))]);
  await page.getByRole('checkbox', { name: '生成计划与文件草稿' }).check();
  await page.getByRole('textbox', { name: '输入消息' }).fill('创建本地验收文件，保留在当前会话。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '预览 browser-result.md', exact: true }).waitFor();
  assert.equal(faux.state.callCount, 1);
  await page.getByRole('button', { name: '预览 browser-result.md', exact: true }).click();
  await page.getByRole('dialog').getByText(/Exact persisted file bytes/).waitFor();
  await page.screenshot({ path: `${destination}/verified-file-preview.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  checks.push('Actual browser send → same API → real Pi package fixture → original Store/file → SHA-verified safe preview');
  await page.reload();
  await page.getByRole('button', { name: '预览 browser-result.md', exact: true }).waitFor();
  assert.equal(faux.state.callCount, 1);
  checks.push('Reload recovers saved conversation/result without a new provider request');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('.control-spirit').count(), 1);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(geometry.scroll <= geometry.viewport + 1, `Horizontal overflow at ${width}: ${JSON.stringify(geometry)}`);
    await page.screenshot({ path: `${destination}/mobile-${width}.png`, fullPage: true });
    checks.push(`Original conversation and file card fit real Chromium ${width}px viewport`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.control-spirit-stage')?.getAttribute('data-motion') === 'off');
  checks.push('Original reduced-motion preference honored');
  assert.deepEqual(errors, []);
  const evidence = { result: 'passed', evidenceKind: 'actual-chromium-local-pi-fixture', actualBrowser: true, chromium: browser.version(), checks, consoleErrors: errors, screenshots: ['desktop-conversation.png', 'verified-file-preview.png', 'mobile-390.png', 'mobile-320.png'], liveModel: false, liveMuse: false, wechatDevice: false, referencePixelAcceptance: false };
  await fs.writeFile(`${destination}/acceptance.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
