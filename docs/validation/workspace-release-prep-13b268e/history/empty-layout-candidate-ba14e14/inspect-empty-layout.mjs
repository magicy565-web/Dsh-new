import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '/workspace/workspace-release-20261013/node_modules/playwright/index.mjs';
import { createApp } from '/workspace/workspace-release-20261013/server/index.mjs';
const output = '/tmp/workspace-launch-20261013/followup-ba14e14/frontend';
const directory = await mkdtemp(join(tmpdir(), 'workspace-empty-layout-'));
let app, browser, modelCalls = 0;
const measurements = [];
try {
  app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { configured: false, complete: async () => { modelCalls++; throw Error('No model calls'); } } });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Frozen empty conversation layout fixture' }) });
  assert.equal(response.status, 201); const { conversation } = await response.json();
  browser = await chromium.launch({ headless: true, chromiumSandbox: false, executablePath: '/usr/bin/chromium' });
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ status: 204, body: '' }));
    await page.goto(`${base}/chat/${conversation.id}`); await page.locator('.app-shell[aria-busy="false"]').waitFor();
    await page.locator('.conversation-native .conversation-task-list > summary').waitFor();
    const measurement = await page.evaluate(() => {
      const scroll = document.querySelector('.message-scroll.is-empty'), welcome = scroll.querySelector('.welcome-conversation'), native = scroll.querySelector('.conversation-native'), summary = native.querySelector('.conversation-task-list > summary');
      const range = document.createRange(); range.selectNodeContents(summary);
      const box = element => element.getBoundingClientRect().toJSON();
      return { viewport: innerWidth, path: location.pathname, sourceCSS: { display: getComputedStyle(scroll).display, flexDirection: getComputedStyle(scroll).flexDirection, alignItems: getComputedStyle(scroll).alignItems }, scroll: { box: box(scroll), scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight }, welcome: box(welcome), native: box(native), summary: { text: summary.textContent, box: box(summary), lineHeight: getComputedStyle(summary).lineHeight, lineRects: [...range.getClientRects()].map(rect => rect.toJSON()) }, documentWidth: document.documentElement.scrollWidth };
    });
    measurements.push(measurement); await page.screenshot({ path: join(output, `before-empty-native-${width}.png`) }); await page.close();
  }
  const evidence = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(), actualBrowser: true, browserVersion: browser.version(), measurements, modelCalls, productionCSSChanged: false };
  await writeFile(join(output, 'BEFORE-EMPTY-LAYOUT.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
