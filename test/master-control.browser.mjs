/** Real production UI + HTTP/runtime; scripted provider never calls a model.
 * Windows may explicitly preload the test-only memory/artifact fixture.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'master-control-'));
const output = process.env.CONTROL_QA_OUTPUT || 'docs/screenshots/master-control';
const checks = [], errors = [], calls = [];
const provider = {
  kind: 'deepseek-harness', provider: 'scripted-browser-fixture', configured: true, model: 'scripted-test',
  complete(options) {
    return new Promise((resolve, reject) => {
      const call = { options, resolve: content => resolve({ content: JSON.stringify({ done: true, content }), usage: { completionTokens: 12 } }), resolveValue: value => resolve({ content: JSON.stringify(value), usage: { completionTokens: 12 } }) };
      calls.push(call);
      options.signal.addEventListener('abort', () => reject(new Error('Scripted fixture aborted')), { once: true });
    });
  },
};
let app, browser;
const until = async (condition, label) => {
  const end = Date.now() + 10000;
  while (!condition()) { if (Date.now() > end) throw Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 30)); }
};
try {
  app = await createApp({ ...(process.env.CONTROL_STATIC_DIRECTORY ? { staticDirectory: process.env.CONTROL_STATIC_DIRECTORY } : {}), dataDirectory: directory, capabilityEnvironment: {}, provider });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  const api = async (route, method, body) => {
    const response = await fetch(base + '/api' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  const findGoal = id => app.store.read().goals.find(goal => goal.id === id);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const home = page.getByTestId('v22-master-control');
  const sheet = () => page.getByRole('dialog');
  await mkdir(output, { recursive: true });
  await page.goto(base);
  await page.getByRole('heading', { name: '我在这里', exact: true }).waitFor();
  assert.equal(await page.locator('.nav-rail').isVisible(), false);
  assert.equal(await page.locator('.spirit-body').count(), 1);

  const motionSamples = await page.evaluate(async () => {
    const values = { body: [], eye: [], hand: [] };
    const selectors = { body: '.control-spirit-float', eye: '.spirit-eye', hand: '.spirit-hand-right' };
    const start = performance.now();
    while (performance.now() - start < 5600) {
      for (const key of Object.keys(values)) values[key].push(getComputedStyle(document.querySelector(selectors[key])).transform);
      await new Promise(requestAnimationFrame);
    }
    return Object.fromEntries(Object.entries(values).map(([key, samples]) => [key, new Set(samples).size]));
  });
  for (const [part, count] of Object.entries(motionSamples)) assert.ok(count > 3, part + ' actually changes over time');
  assert.equal(calls.length, 0, 'animation never dispatches a task');
  await writeFile(output + '/MOTION-SAMPLES.json', JSON.stringify(motionSamples, null, 2));
  checks.push('Real animation frames change body, eyes and hand independently without backend execution.');
  await page.screenshot({ path: output + '/mobile-empty.png' });
  checks.push('Empty home has one centered animated sprite, no navigation wall, and no invented tasks.');

  await page.getByRole('textbox', { name: '主控指令' }).fill('研究美国市场');
  await page.getByRole('button', { name: '创建新目标', exact: true }).click();
  await sheet().getByRole('button', { name: '保存目标', exact: true }).click();
  await sheet().getByRole('button', { name: '启动任务', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  const goal = app.store.read().goals.find(item => item.title === '研究美国市场');
  assert.equal(goal.status, 'draft'); assert.equal(calls.length, 0);
  checks.push('Composer creates one real saved goal and returns to its control drawer without automatically starting it.');

  await sheet().getByRole('button', { name: '启动任务', exact: true }).click();
  await sheet().getByRole('button', { name: '暂停任务', exact: true }).waitFor();
  await until(() => calls.length === 1, 'scripted provider admitted');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('heading', { name: '正在推进', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/mobile-working.png` });
  assert.equal(await page.locator('.control-spirit-float').evaluate(element => getComputedStyle(element).animationName), 'spirit-work');
  await page.locator('.control-task-peek').click();
  await sheet().getByRole('button', { name: '暂停任务', exact: true }).click();
  await sheet().getByRole('button', { name: '继续任务', exact: true }).waitFor();
  assert.equal(findGoal(goal.id).status, 'paused');
  assert.equal(calls[0].options.signal.aborted, true);
  await sheet().getByRole('button', { name: '继续任务', exact: true }).click();
  await until(() => calls.length === 2, 'resume reached scripted provider');
  calls[1].resolve('测试交付：先验证美国专业咖啡渠道。');
  await sheet().getByRole('button', { name: '查看并验收', exact: true }).waitFor();
  assert.equal(findGoal(goal.id).status, 'review_required');
  await page.screenshot({ path: `${output}/mobile-review.png` });
  checks.push('Start, pause and resume use real runtime transitions and abort signals; result waits for review.');

  await sheet().getByRole('button', { name: '查看并验收', exact: true }).click();
  await page.locator('.goal-output').getByText('测试交付：先验证美国专业咖啡渠道。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '标记已审核', exact: true }).click();
  await until(() => findGoal(goal.id).status === 'completed', 'explicit review persisted');
  checks.push('Review opens the exact goal output; explicit existing review action persists acceptance.');

  await page.goto(base);
  await page.getByRole('button', { name: '打开主控任务', exact: true }).click();
  await sheet().getByRole('button', { name: '已结束', exact: true }).click();
  await sheet().getByRole('button', { name: /研究美国市场/ }).click();
  await sheet().getByRole('button', { name: '补充指令', exact: true }).click();
  await page.getByRole('textbox', { name: '主控指令' }).fill('再补充英国市场');
  await page.getByRole('button', { name: '发送任务指令', exact: true }).click();
  await until(() => calls.length === 3, 'followup admitted');
  assert.equal(calls[2].options.conversationId, goal.conversationId);
  await page.getByRole('heading', { name: '正在推进', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '发送任务指令', exact: true }).isDisabled(), true);
  await page.locator('.control-task-peek').click();
  await sheet().getByRole('button', { name: '停止本次运行', exact: true }).click();
  await until(() => calls[2].options.signal.aborted, 'followup cancelled');
  assert.equal(findGoal(goal.id).status, 'completed', 'stopping followup does not rewrite accepted goal');
  checks.push('Follow-up stays bound to the exact conversation, blocks duplicate sends, reflects running state and can stop that run.');

  const { goal: cancelled } = await api('/goals', 'POST', { title: '准备店铺', description: '仅供本地测试', requestId: randomUUID() });
  await page.goto(base);
  await page.getByRole('button', { name: '打开主控任务', exact: true }).click();
  await sheet().getByRole('button', { name: /准备店铺/ }).click();
  await sheet().getByRole('button', { name: '停止任务', exact: true }).click();
  assert.equal(findGoal(cancelled.id).status, 'draft');
  await sheet().getByRole('button', { name: '确认停止', exact: true }).click();
  await until(() => findGoal(cancelled.id).status === 'cancelled', 'cancellation persisted');
  checks.push('Stopping a goal requires explicit confirmation and retains its history.');

  // Lose the response AFTER the server commits; retry must reuse exactly the same requestId.
  const { goal: retryGoal } = await api('/goals', 'POST', { title: '验证重试', description: '仅供本地测试', requestId: randomUUID() });
  const patchBodies = [];
  let loseResponse = true;
  await page.route(`**/api/goals/${retryGoal.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patchBodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (loseResponse) { loseResponse = false; await route.abort('failed'); } else await route.fulfill({ response });
  });
  await page.goto(base);
  await page.getByRole('button', { name: '打开主控任务', exact: true }).click();
  await sheet().getByRole('button', { name: /验证重试/ }).click();
  await sheet().getByRole('button', { name: '启动任务', exact: true }).click();
  await sheet().getByRole('button', { name: '重试原请求', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await sheet().count(), 1);
  await sheet().getByRole('button', { name: '重试原请求', exact: true }).click();
  await sheet().getByRole('button', { name: '暂停任务', exact: true }).waitFor();
  assert.equal(patchBodies.length, 2); assert.deepEqual(patchBodies[0], patchBodies[1]);
  assert.equal(app.store.read().runs.filter(run => run.goalId === retryGoal.id).length, 1);
  checks.push('Unknown committed response freezes controls and retries the original request without duplicate execution.');
  await sheet().getByRole('button', { name: '暂停任务', exact: true }).click();
  await sheet().getByRole('button', { name: '继续任务', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_OFFLINE', message: '本地测试断线' } }) }));
  await page.getByRole('heading', { name: '连接中断', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '主控指令' }).isDisabled(), true);
  assert.equal(await page.locator('.control-spirit-float').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.screenshot({ path: `${output}/mobile-offline.png` });
  await page.unroute('**/api/bootstrap');
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await page.getByRole('heading', { name: '随时可以开始', exact: true }).waitFor();
  checks.push('Disconnected data stops the busy animation and disables writes; refreshing recovers real state.');

  await page.getByRole('button', { name: '打开主控任务', exact: true }).click();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '打开主控任务', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '开启精灵动画', exact: true }).waitFor();
  assert.equal(await page.locator('.control-spirit-float').evaluate(element => getComputedStyle(element).animationName), 'none');

  await page.getByRole('button', { name: '开启精灵动画', exact: true }).click();
  assert.equal(await page.locator('.control-spirit-float').evaluate(element => getComputedStyle(element).animationName), 'spirit-float');
  await page.getByRole('button', { name: '暂停精灵动画', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '开启精灵动画', exact: true }).waitFor();
  assert.equal(await page.locator('.control-spirit-float').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.evaluate(() => localStorage.removeItem('workspace.control.motion'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.getByRole('button', { name: '暂停精灵动画', exact: true }).waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('.spirit-eye').first().evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('.spirit-eye').first().evaluate(element => getComputedStyle(element).animationPlayState), 'running');
  checks.push('Explicit motion toggle overrides system reduction, persists pause after reload, and visibility events pause layers.');
  checks.push('Task drawer traps keyboard focus, restores the avatar trigger and respects reduced motion.');

  for (const [width, height] of [[320,568],[390,844],[430,932],[768,1024],[1440,900],[844,390]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} horizontal overflow`);
    const control = await page.locator('.control-command').boundingBox();
    assert.ok(control.x >= 0 && control.x + control.width <= width + 1);
    if (height >= 568) {
      assert.ok(control.y + control.height <= height + 1, 'composer visible');
      const avatar = await page.locator('.control-spirit').boundingBox();
      assert.ok(Math.abs(avatar.x + avatar.width / 2 - width / 2) < 3, 'avatar centered horizontally');
    }
    if ([390,1440].includes(width)) await page.screenshot({ path: `${output}/control-${width}.png`, fullPage: true });
  }
  checks.push('Mobile 320/390/430, tablet, desktop and landscape geometry have no horizontal overflow.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开工作空间菜单', exact: true }).click();
  await sheet().getByRole('button', { name: '企业与产品', exact: true }).click();
  await page.waitForURL(`${base}/library`);
  await page.goto(base);
  await page.getByRole('button', { name: '打开工作空间菜单', exact: true }).click();
  await sheet().getByRole('button', { name: '连接与设置', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  checks.push('Collapsed workspace menu retains real library and runtime settings routes.');

  const { connector } = await app.capabilities.createConnector({ name: '本地审批验收', adapter: 'workspace-library', capabilities: ['create_file'] });
  await app.capabilities.updateConnector(connector.id, { enabled: true });
  const { goal: approvalGoal } = await api('/goals', 'POST', { title: '待审批的研究资料', description: '测试审批入口', inputContext: { connectorActions: [{ connectorId: connector.id, action: 'create_file' }] } });
  const beforeApprovalCalls = calls.length;
  await api('/goals/' + approvalGoal.id, 'PATCH', { action: 'start', requestId: randomUUID() });
  await until(() => calls.length > beforeApprovalCalls, 'approval fixture admitted');
  calls.at(-1).resolveValue({ done: false, content: '测试请求：创建研究草稿。', action: { connectorId: connector.id, action: 'create_file', resource: 'library:new', payload: { filename: 'review.txt', content: '本地测试，不执行写入。' } } });
  await until(() => findGoal(approvalGoal.id).status === 'awaiting_approval', 'approval pending');
  await page.goto(base);
  await page.getByRole('heading', { name: '需要你看一下', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开主控任务', exact: true }).click();
  await sheet().getByRole('button', { name: '待处理', exact: true }).click();
  await sheet().getByRole('button', { name: /待审批的研究资料/ }).click();
  await sheet().getByRole('button', { name: '查看并审批', exact: true }).click();
  await page.waitForURL(base + '/chat/' + approvalGoal.conversationId);
  await page.getByRole('button', { name: '拒绝此动作', exact: true }).click();
  await until(() => app.store.read().runs.find(run => run.goalId === approvalGoal.id)?.proposals[0]?.status === 'denied', 'exact proposal rejected');
  assert.equal(app.capabilities.listConnectorRuns().length, 0);
  checks.push('Pending approval raises avatar attention and opens the exact proposal; rejection performs no connector action.');

  await page.goto(base);
  await home.waitFor();
  await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 360 }); visualViewport.dispatchEvent(new Event('resize')); });
  const keyboardComposer = await page.locator('.control-command').boundingBox();
  assert.ok(keyboardComposer.y + keyboardComposer.height <= 360, 'input remains above simulated keyboard');
  const keyboardAvatar = await page.locator('.control-spirit').boundingBox();
  assert.ok(keyboardAvatar.y + keyboardAvatar.height < keyboardComposer.y, 'avatar and input do not overlap');
  await page.screenshot({ path: output + '/mobile-keyboard.png' });
  await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
  checks.push('VisualViewport keyboard resize keeps the avatar and command input visible without overlap (simulated viewport event).');

  await page.route('**/api/session', async route => {
    const response = await route.fetch(); const session = await response.json();
    await route.fulfill({ response, json: { ...session, user: { ...session.user, role: 'viewer' } } });
  });
  await page.goto(base);
  await page.getByText('仅可查看', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '主控指令' }).isDisabled(), true);
  await page.getByRole('button', { name: '打开主控任务', exact: true }).click();
  await sheet().getByRole('button', { name: /验证重试/ }).click();
  assert.equal(await sheet().getByRole('button', { name: '继续任务', exact: true }).isDisabled(), true);
  checks.push('Viewer session can inspect but cannot issue commands or control task execution.');
  assert.deepEqual(errors, []);
  const result = { result: 'passed', checks, errors, storage: app.store.diagnostics().durability, provider: 'scripted fixture', browser: browser.version(), paidModelCalls: false, externalDispatch: false, deployment: false };
  await writeFile(`${output}/VERIFICATION.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
