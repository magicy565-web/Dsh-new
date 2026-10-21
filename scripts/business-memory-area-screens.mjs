// Capture the Business Memory area for local evidence.
//
// Requires a running local harness (node scripts/harness-serve.mjs) with at
// least one memory record, and the Playwright Chromium browser.
// Usage: node scripts/business-memory-area-screens.mjs
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BUSINESS_MEMORY_BASE_URL || 'http://127.0.0.1:8790';
const OUT = 'docs/validation/business-memory-harness-20261022';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = process.env.BROWSER_PATH || (existsSync(EDGE) ? EDGE : undefined);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.goto(`${BASE}/business-memory`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.record');
  await page.screenshot({ path: `${OUT}/area-overview.png`, fullPage: true });

  await page.locator('.record').first().click();
  await page.waitForSelector('#sheet-wrap.open');
  await page.screenshot({ path: `${OUT}/area-record-detail.png`, fullPage: false });

  await page.locator('.sheet-close').click();
  await page.locator('#open-compose').click();
  await page.waitForSelector('#compose[open]');
  await page.screenshot({ path: `${OUT}/area-compose.png`, fullPage: false });

  await page.locator('#cancel-compose').click();
  await page.locator('#toggle-pending').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/area-pending.png`, fullPage: true });

  console.log(JSON.stringify({ base: BASE, out: OUT, consoleErrors, ok: consoleErrors.length === 0 }, null, 2));
  if (consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
