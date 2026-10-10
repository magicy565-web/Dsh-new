/** Real browser + real local HTTP + real saved data. No model or live Shopify calls. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'muse-commerce-browser-'));
const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'deepseek-api', configured: false } });
const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
const output = 'docs/screenshots/muse-commerce';
const checks = [], errors = [];
let browser;
async function capture(page, name) { await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); }
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'viewport must not overflow horizontally'); }
async function optionalFonts(page) {
  const fonts = process.env.QA_FONT_DIR;
  if (!fonts) return;
  // Optional local CJK fallback on Linux runners that have no system CJK font.
  // Fonts are test resources only, not an external service or bundled app dependency.
  await page.route('**/__qa_fonts/*', async route => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!/^[a-z0-9._-]+\.woff2$/u.test(filename)) return route.abort();
    await route.fulfill({ contentType: 'font/woff2', body: await readFile(path.join(fonts, 'files', filename)) });
  });
  let css = '';
  for (const weight of ['400', '600']) css += (await readFile(path.join(fonts, `${weight}.css`), 'utf8')).replace(/\.\/files\//gu, '/__qa_fonts/');
  await page.addStyleTag({ content: `${css}\nhtml,body,#root,button,input,textarea,select { font-family: "Noto Sans SC",sans-serif!important; }` });
  await page.evaluate(async () => { document.body.getBoundingClientRect(); await document.fonts.ready; });
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    chromiumSandbox: process.env.CHROMIUM_NO_SANDBOX !== '1',
    ...(process.env.CHROMIUM_NO_SANDBOX === '1' ? { args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(output, { recursive: true });
  await page.goto(base); await page.getByRole('heading', { name: /想把生意.*做到哪里？/ }).waitFor({ state: 'attached' });
  await optionalFonts(page); await page.getByRole('heading', { name: /想把生意.*做到哪里？/ }).waitFor(); await noOverflow(page); await capture(page, '01-home-mobile');
  assert.match(await page.locator('body').innerText(), /Harness 未启用/);
  assert.equal(app.store.read().goals.length, 0);
  checks.push('Mobile Muse home uses actual runtime readiness and has no fabricated goals.');

  await page.getByRole('button', { name: '资料库', exact: true }).click();
  await page.getByRole('button', { name: '企业资料', exact: true }).click();
  await page.getByLabel('企业名称', { exact: true }).fill('浏览器验收企业');
  await page.getByLabel('企业简介', { exact: true }).fill('仅用于本地 UI 验收的企业档案。');
  await page.getByRole('button', { name: '保存企业资料', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.bl-company .bl-help')?.textContent?.includes('已保存'));
  await page.locator('.bl-company summary').click();
  await noOverflow(page); await capture(page, '02-company-mobile');
  assert.equal(app.store.read().businessLibrary.company.legalName, '浏览器验收企业');
  checks.push('Company profile is saved through the real versioned library API.');

  await page.getByRole('button', { name: '产品库', exact: true }).click();
  await page.getByRole('button', { name: '新建产品', exact: true }).click();
  await page.getByLabel('产品名称', { exact: true }).fill('轻量户外夹克');
  await page.getByLabel('产品简介', { exact: true }).fill('轻量、防风，适合户外活动；产品资料来自企业提供。');
  await page.getByLabel('产品分类', { exact: true }).fill('户外服饰');
  await page.getByRole('button', { name: '保存产品', exact: true }).click();
  await page.getByRole('heading', { name: '轻量户外夹克', exact: true }).waitFor();
  assert.equal(app.store.read().businessLibrary.products.length, 1);
  await noOverflow(page); await capture(page, '03-product-mobile');
  checks.push('Product editor saves a real enterprise draft and fixed product revision.');

  await page.getByRole('button', { name: '产品托管', exact: true }).click();
  await page.getByRole('button', { name: '托管产品', exact: true }).click();
  await page.getByLabel('企业产品').selectOption(app.store.read().businessLibrary.products[0].id);
  await page.getByLabel('目标市场', { exact: true }).fill('美国');
  await page.getByLabel('本次验证目标', { exact: true }).fill('寻找可核验的户外用品分销商，并验证首批非测试订单。');
  await page.getByLabel('经营预算上限').fill('300');
  await page.getByRole('button', { name: '工作', exact: true }).click();
  await page.getByRole('dialog', { name: '离开未保存的内容' }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await page.getByLabel('经营预算上限').inputValue(), '300');
  checks.push('Navigation preserves unsaved product hosting scope and can return to editing.');
  await page.locator('.commerce-form input[type=checkbox]').check();
  await page.getByRole('button', { name: '保存托管任务', exact: true }).click();
  await page.getByRole('heading', { name: '轻量户外夹克', exact: true }).waitFor();
  assert.equal(app.store.read().commerceProjects.length, 1);
  assert.equal(app.store.read().runs.length, 0);
  assert.match(await page.locator('body').innerText(), /尚未读取实际订单/);
  assert.equal(await page.getByRole('button', { name: '刷新订单证据', exact: true }).isDisabled(), true);
  await noOverflow(page); await capture(page, '04-hosting-mobile');
  await page.getByRole('heading', { name: '经营结果', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, '07-hosting-results-mobile');
  checks.push('Hosting confirms public facts, budget and target while unconfigured Shopify has no fake results.');

  await page.getByRole('button', { name: '准备研究委托', exact: true }).click();
  await page.getByLabel('可公开共享的委托说明', { exact: true }).fill('轻量防风夹克；寻找美国户外用品分销商，并提供公开原始来源。');
  await page.getByRole('button', { name: '工作', exact: true }).click();
  await page.getByRole('dialog', { name: '离开未保存的内容' }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.match(await page.getByLabel('可公开共享的委托说明').inputValue(), /公开原始来源/);
  await noOverflow(page); await capture(page, '08-research-scope-mobile');
  await page.locator('.commerce-research-order input[type=checkbox]').check();
  await page.getByRole('button', { name: '保存研究任务单', exact: true }).click();
  await page.getByRole('button', { name: '查看与审核任务单', exact: true }).waitFor();
  assert.equal(app.store.read().workerOrders.length, 1);
  const orderId = app.store.read().workerOrders[0].id;
  assert.equal(app.store.read().workerOrders[0].status, 'draft');
  assert.equal(app.store.read().workerOrders[0].workerId, null);
  await noOverflow(page); await capture(page, '09-research-linked-mobile');
  checks.push('Hosting prepares one public research order and protects the unsaved scope before navigation; no automatic dispatch occurs.');
  await page.getByRole('button', { name: '查看与审核任务单', exact: true }).click();
  await page.getByRole('dialog', { name: '海外经销商开发' }).waitFor();
  assert.ok(page.url().includes(orderId));
  assert.match(await page.getByRole('dialog', { name: '海外经销商开发' }).innerText(), /尚未提交/);
  await noOverflow(page); await capture(page, '10-worker-order-mobile');
  await page.reload(); await optionalFonts(page);
  await page.getByRole('dialog', { name: '海外经销商开发' }).waitFor();
  assert.equal(app.store.read().workerOrders.length, 1);
  await page.getByRole('dialog', { name: '海外经销商开发' }).getByRole('button', { name: '关闭', exact: true }).click();
  assert.ok(!page.url().includes(orderId));
  checks.push('The exact Worker order opens from hosting and survives a deep-link reload; closing clears its route.');
  await page.getByRole('button', { name: '产品托管', exact: true }).click();
  await page.getByRole('button', { name: /轻量户外夹克.*美国/ }).click();

  await page.getByRole('button', { name: '创建研究目标', exact: true }).click();
  await page.getByRole('heading', { name: '轻量户外夹克 · 美国验证', exact: true }).waitFor();
  assert.equal(app.store.read().goals.length, 1);
  assert.equal(app.store.read().goals[0].status, 'draft');
  assert.equal(app.store.read().runs.length, 0);
  await page.getByRole('button', { name: '配置原生 Harness', exact: true }).waitFor();
  const currentBackground = await page.locator('.ys21-current').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.equal(currentBackground, 'rgb(20, 27, 41)', 'goal decision card has its actual dark theme, with visible light text');
  await noOverflow(page); await capture(page, '05-goal-mobile');
  checks.push('One hosted product produces one actual draft goal; native Harness is required to start from Muse.');
  await page.reload(); await optionalFonts(page);
  await page.getByRole('heading', { name: '轻量户外夹克 · 美国验证', exact: true }).waitFor();
  assert.equal(app.store.read().goals.length, 1);
  checks.push('Reload retains the real goal route and does not duplicate research or run a model.');

  await page.getByRole('button', { name: '云端专家', exact: true }).click();
  await page.getByRole('heading', { name: /你的 AI 专家团队/ }).waitFor();
  assert.equal(await page.locator('.ce-expert-card').count(), 8);
  await noOverflow(page);
  checks.push('Existing eight-role expert marketplace remains available on the real /workers route.');
  for (const width of [320, 375, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '工作', exact: true }).click();
    await page.getByRole('heading', { name: /想把生意.*做到哪里？/ }).waitFor();
    await noOverflow(page);
  }
  await capture(page, '06-home-desktop');
  checks.push('Muse home has no horizontal overflow at 320, 375, 430 and 1440 pixels.');
  assert.deepEqual(errors, []);
  const evidence = { result: 'passed', actualBrowser: true, browserVersion: browser.version(), checks, errors,
    noModelCalls: true, noLiveShopifyCalls: true, noSpendOrExternalWrites: true };
  await writeFile(`${output}/VERIFICATION.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true });
}
