/** Production React + application HTTP routes. No model or live Shopify calls.
 * Default uses the real store. Windows QA can explicitly preload a memory fixture;
 * that run must be reported as memory-backed, never as durability verification.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'goal-commerce-browser-'));
let app, browser;
const checks = [], errors = [];
const output = process.env.GOAL_CONTEXT_QA_OUTPUT || 'docs/screenshots/goal-commerce';
try {
  app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'fixture-unconfigured', configured: false } });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  const api = async (route, method, body) => {
    const response = await fetch(base + '/api' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  const { product } = await api('/library/products', 'POST', { requestId: randomUUID(), name: '本地验收 · 户外夹克', description: '企业内部介绍，不应出现在公开范围内' });
  const { project } = await api('/commerce-projects', 'POST', { requestId: randomUUID(), confirmed: true, productId: product.id, productRevision: product.revision,
    publicDescription: '本地验收：获准用于德国户外渠道研究的夹克介绍。', market: '德国', objective: '研究有来源依据的户外用品分销商', budget: { amount: '300', currency: 'EUR' }, durationDays: 30, validationOrderTarget: 3 });
  const staged = await api(`/commerce-projects/${project.id}/stage-research`, 'POST', { requestId: randomUUID(), confirmed: true });
  const goalId = staged.project.researchGoalId;
  const ordered = await api(`/commerce-projects/${project.id}/stage-worker-research`, 'POST', { requestId: randomUUID(), confirmed: true,
    serviceId: 'buyer-discovery', brief: '本地验收用的公开说明', budgetCredits: 10, deadlineAt: new Date(Date.now() + 86400000).toISOString() });
  const orderId = ordered.project.researchOrder.id;
  const { goal: unrelated } = await api('/goals', 'POST', { title: '本地验收 · 户外夹克 · 德国验证', description: '同名但未关联的目标' });
  await api(`/library/products/${product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, changes: { name: '改名后的产品 v2', description: '新的内部内容，不随旧托管共享' } });
  const before = app.store.read().meta.sequence;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  const context = page.getByRole('region', { name: '此目标的托管与渠道' });
  await page.goto(`${base}/goals/${goalId}`);
  await page.getByRole('button', { name: '查看目标渠道范围', exact: true }).click();
  await context.getByText('本地验收 · 户外夹克', { exact: true }).waitFor();
  assert.match(await context.innerText(), /产品修订 1 · 德国/);
  assert.match(await context.innerText(), /300 EUR/);
  assert.match(await context.innerText(), /等待审核与分配/);
  assert.match(await context.innerText(), /尚未读取实际订单/);
  await context.locator('.ys22-context-scope summary').click();
  assert.match(await context.innerText(), /获准用于德国户外渠道研究/);
  assert.doesNotMatch(await context.innerText(), /改名后的产品|新的内部内容|企业内部介绍/);
  checks.push('Goal displays the persisted hosting snapshot and linked draft order; later product edits do not change scope.');
  await page.getByRole('button', { name: '查看目标渠道范围', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, `/goals/${goalId}`);
  checks.push('Scope shortcut stays inside the original V22 goal conversation.');
  await context.getByRole('button', { name: '打开此托管任务' }).click();
  await page.waitForURL(`${base}/commerce/${project.id}`);
  await page.reload();
  await page.getByRole('heading', { name: '本地验收 · 户外夹克', exact: true }).waitFor();
  checks.push('Hosting action opens the exact project and survives page reload.');
  await page.goto(`${base}/goals/${goalId}`);
  await page.getByRole('button', { name: '查看目标渠道范围', exact: true }).click();
  await context.getByRole('button', { name: '查看关联研究任务单' }).click();
  await page.waitForURL(`${base}/services/${orderId}`);
  await page.locator('#worker-order-title').filter({ hasText: '海外经销商开发' }).waitFor();
  checks.push('Research action opens the actual WorkerDesk order without approving or dispatching it.');
  await page.goto(`${base}/goals/${unrelated.id}`);
  await page.getByRole('button', { name: '查看目标渠道范围', exact: true }).click();
  await context.getByText('此目标尚未关联产品托管。', { exact: true }).waitFor();
  assert.equal(await context.getByText('300 EUR', { exact: true }).count(), 0);
  checks.push('Same-title unrelated goals do not inherit another goal’s product or authority.');
  await page.route(`**/api/goals/${goalId}/commerce-context`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FIXTURE_UNAVAILABLE', message: '本地验收：读取暂不可用' } }) }));
  await page.goto(`${base}/goals/${goalId}`);
  await page.getByRole('button', { name: '查看目标渠道范围', exact: true }).click();
  await context.getByText('暂时无法确认此目标的托管范围。', { exact: true }).waitFor();
  assert.equal(await context.getByText('此目标尚未关联产品托管。', { exact: true }).count(), 0);
  await page.unroute(`**/api/goals/${goalId}/commerce-context`);
  await context.getByRole('button', { name: '重试读取托管范围', exact: true }).click();
  await context.getByText('本地验收 · 户外夹克', { exact: true }).waitFor();
  checks.push('Read failure is distinct from no relationship; retry restores the real scope.');
  assert.equal(app.store.read().meta.sequence, before, 'read-only UI navigation must not mutate business data');
  assert.equal(app.store.read().workerOrders.find(order => order.id === orderId).status, 'draft');
  assert.equal(app.store.read().runs.length, 0);
  checks.push('All context navigation is read-only: no duplicated goals, dispatch, model call or commerce write.');
  await app.store.update(state => { state.commerceProjects.find(row => row.id === project.id).orderEvidence = {
    complete: false, observedAt: new Date().toISOString(), orders: [
      { id: 'fixture-usd', salesEvidence: true, netReceived: '12.5', currency: 'USD' },
      { id: 'fixture-eur', salesEvidence: true, netReceived: '8.25', currency: 'EUR' },
    ],
  }; });
  await context.getByRole('button', { name: '刷新目标托管信息', exact: true }).click();
  await context.getByText(/仅有部分订单/).waitFor();
  assert.match(await context.innerText(), /12.5 USD \/ 8.25 EUR/);
  assert.match(await context.innerText(), /可结算金额待确认/);
  checks.push('Partial evidence remains partial, with separate currency totals and no invented settlement amount.');
  await mkdir(output, { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; });
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))) {
      await page.screenshot({ path: `${output}/overflow-${width}.png`, fullPage: true });
      console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1); }).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right })).slice(0, 20)));
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px must not overflow`);
    if (width === 390 || width === 1440) await page.screenshot({ path: `${output}/goal-context-${width}.png`, fullPage: true });
  }
  checks.push('V22 goal layout has no horizontal overflow at 320, 390, 768 and 1440 pixels.');
  assert.deepEqual(errors, []);
  const result = { result: 'passed', storage: app.store.diagnostics().durability, actualBrowser: browser.version(), checks, errors,
    modelCalls: false, liveShopifyCalls: false, productionChanged: false };
  await writeFile(`${output}/VERIFICATION.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
