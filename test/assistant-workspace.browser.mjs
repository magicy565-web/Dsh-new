/** Real production App -> original HTTP/Runtime -> actual Pi SDK/faux tool.
 * Every model response and record here is a local synthetic fixture. External
 * model calls, real source claims, notifications and deployment are excluded.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { assistantWorkspaceFixture, PUBLIC_INPUT, OUTPUT_TEXT } from './fixtures/assistant-workspace.mjs';

const destination = resolve(process.argv[2] || '/tmp/workspace-launch-20261013/assistant-workspace-browser');
await mkdir(destination, { recursive: true });
const evidence = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), actualBrowser: true, actualPiSdk: true, syntheticProvider: true, externalModelCalls: 0, checks: [], screenshots: [], requests: [], consoleErrors: [], failures: [] };
let browser, fixture, page;
let loseNextSubmitResponse = false;
const sha = value => createHash('sha256').update(value).digest('hex');
async function settled(check, label) { for (let i = 0; i < 400; i++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error(`Timed out: ${label}`); }
async function ready() { await page.locator('.app-shell[aria-busy="false"]').waitFor(); }
async function capture(name) { const filename = `${name}.png`; await page.screenshot({ path: join(destination, filename), fullPage: true }); evidence.screenshots.push(filename); }
async function exposeRunCard(run) {
  const card = page.locator(`[data-run-id="${run.id}"]`);
  await card.waitFor({ state: 'attached' });
  const panel = page.locator('details.conversation-run').filter({ has: card });
  if (await panel.count() && !await panel.evaluate(element => element.open)) await panel.locator(':scope > summary').click();
  await card.waitFor();
  return card;
}
async function downloadOutput(run, filename) {
  const file = fixture.app.store.read().artifacts.find(item => item.sourceRunId === run.id && item.filename === filename);
  assert.ok(file, 'Original Runtime persisted the result artifact.');
  const card = await exposeRunCard(run);
  const link = card.getByRole('link', { name: `下载成果：${filename} · v1`, exact: true });
  await link.waitFor();
  const href = await link.getAttribute('href');
  assert.equal(href, `/api/artifacts/${encodeURIComponent(file.id)}/download?version=1`);
  const response = await page.request.get(new URL(href, fixture.base).href);
  assert.equal(response.status(), 200);
  const bytes = await response.body();
  assert.equal(bytes.toString('utf8'), OUTPUT_TEXT);
  assert.equal(sha(bytes), file.versions[0].sha256);
  return { artifactId: file.id, version: 1, sha256: sha(bytes), bytes: bytes.length };
}
try {
  const sources = ['src/App.tsx', 'src/TaskContext.tsx', 'src/experience/GoalFocus.tsx', 'src/experience/GoalComposer.tsx',
    'src/assistant/WorkspaceAssistant.tsx', 'src/assistant/WorkspaceAssistantRuntime.tsx', 'src/assistant/workspaceRuntimeAdapter.ts',
    'server/runtime.mjs', 'server/pi-provider.mjs', 'package.json', 'package-lock.json',
    'test/assistant-workspace.browser.mjs', 'test/fixtures/assistant-workspace.mjs', 'dist/index.html'];
  evidence.sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async filename => [filename, sha(await readFile(filename))])));
  fixture = await assistantWorkspaceFixture();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== fixture.base) { await route.fulfill({ status: 204, body: '' }); return; }
    if (url.pathname.startsWith('/api/')) evidence.requests.push({ method: request.method(), path: url.pathname + url.search,
      ...(!['GET', 'HEAD'].includes(request.method()) ? { bodySha256: sha(request.postData() || '') } : {}) });
    if (loseNextSubmitResponse && request.method() === 'POST' && /\/api\/conversations\/[^/]+\/messages$/.test(url.pathname)) {
      loseNextSubmitResponse = false;
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 202, 'The original Host actually admitted the request before its response was lost.');
      await accepted.dispose(); await route.abort('failed'); return;
    }
    await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => evidence.consoleErrors.push(error.message));
  await page.goto(`${fixture.base}/chat/${encodeURIComponent(fixture.conversation.id)}`); await ready();
  await page.getByTestId('workspace-assistant').waitFor();
  assert.equal(await page.getByRole('button', { name: '目标任务', exact: true }).getAttribute('aria-pressed'), 'true');
  evidence.checks.push('Actual assistant-ui thread mounts with structured task mode selected by default.');

  // Local Library associations are selected through the actual product UI.
  await page.getByRole('button', { name: '选择产品或资料', exact: true }).click();
  const refs = page.getByRole('dialog');
  await refs.getByRole('button', { name: /PRIVATE_LIBRARY_PRODUCT_MUST_REMAIN_LOCAL/ }).click();
  await refs.getByRole('button', { name: '选择此产品修订 1', exact: true }).click();
  await refs.getByRole('button', { name: '企业资料', exact: true }).click();
  await refs.getByRole('button', { name: /Local exact document/ }).click();
  await refs.getByRole('combobox', { name: '会话固定资料版本', exact: true }).selectOption('1');
  await refs.getByRole('button', { name: '选择此资料版本 v1', exact: true }).click();
  await refs.getByRole('button', { name: '保存关联并返回会话', exact: true }).click();
  await settled(() => fixture.app.store.read().businessLibrary.conversationReferences?.find(item => item.conversationId === fixture.conversation.id), 'Library association saved by the UI');

  await page.getByRole('button', { name: '选择任务输入', exact: true }).click();
  await page.getByRole('checkbox', { name: '使用文件 public-selected.txt', exact: true }).check();
  await page.getByRole('combobox', { name: 'public-selected.txt 输入版本', exact: true }).selectOption('1');
  await page.getByRole('button', { name: '保存任务输入', exact: true }).click();
  fixture.complete('assistant-result.md');
  await page.getByRole('textbox', { name: '输入目标任务', exact: true }).fill('Read the explicitly selected public v1 input and save a local reviewed result.');
  await page.getByRole('button', { name: '提交目标任务', exact: true }).click();
  const chatRun = await settled(() => fixture.app.store.read().runs.find(run => run.conversationId === fixture.conversation.id && run.status === 'succeeded'), 'UI-submitted Pi task complete');
  assert.equal(chatRun.workspaceExecution, true);
  assert.ok(chatRun.piSubmissionId);
  assert.equal(chatRun.inputContextSnapshot.artifacts[0].version, 1);
  assert.equal(chatRun.inputContextSnapshot.artifacts[0].content, PUBLIC_INPUT);
  assert.equal(fixture.faux.state.callCount, 2);
  assert.deepEqual(chatRun.events.filter(event => event.type.startsWith('pi.tool.')).map(event => [event.type, event.toolName]), [
    ['pi.tool.started', 'workspace_input'], ['pi.tool.finished', 'workspace_input'],
  ]);
  const chatCard = await exposeRunCard(chatRun);
  await chatCard.getByText('Read exact selected source', { exact: true }).waitFor();
  await chatCard.locator('.run-events > summary').click();
  await page.locator('.workspace-tool[data-tool-name="workspace_input"][data-tool-phase="finished"]').waitFor();
  evidence.chatArtifact = await downloadOutput(chatRun, 'assistant-result.md');
  evidence.checks.push('Library pins stay local; explicit public v1 selection reaches original Pi workspace_input tool, exact run snapshot and SHA/version result download through main send button.');
  await capture('assistant-thread-desktop-1440');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.viewport + 1, `No horizontal overflow at ${width}: ${JSON.stringify(geometry)}`);
    await capture(`assistant-thread-${width}`);
  }
  const beforeReload = fixture.faux.state.callCount;
  await page.reload(); await ready();
  await page.getByTestId('workspace-assistant').waitFor();
  await downloadOutput(chatRun, 'assistant-result.md');
  assert.equal(fixture.faux.state.callCount, beforeReload);
  evidence.checks.push('Browser reopen reads saved output and does not repeat Pi work.');
  const eventsBefore = evidence.requests.filter(item => item.path === '/api/events').length;
  const writesBeforeDisconnect = evidence.requests.filter(item => !['GET', 'HEAD'].includes(item.method)).length;
  fixture.app.server.closeAllConnections();
  await settled(() => evidence.requests.filter(item => item.path === '/api/events').length > eventsBefore, 'Actual SSE disconnect reconnects the original read endpoint');
  assert.equal(fixture.faux.state.callCount, beforeReload);
  assert.equal(evidence.requests.filter(item => !['GET', 'HEAD'].includes(item.method)).length, writesBeforeDisconnect);
  evidence.checks.push('Actual SSE connection loss reconnects a read endpoint without a mutation or model replay.');

  // Goal creation and start both pass through the actual product controls.
  // The configured Pi runtime must never be blocked by the old DSH-only gate.
  const goalDescription = 'Assistant Pi Goal: save a local result using the explicitly reviewed public input.';
  await page.getByRole('button', { name: '新建长期目标', exact: true }).click();
  await page.getByRole('textbox', { name: '你希望达成的结果', exact: true }).fill(goalDescription);
  await page.getByRole('button', { name: '保存目标', exact: true }).click();
  const goal = await settled(() => fixture.app.store.read().goals.find(item => item.description === goalDescription), 'GoalComposer primary save creates one original goal');
  fixture.complete('assistant-goal.md');
  await page.getByTestId('v21-goal-session').waitFor();
  const start = page.locator('.ys21-current .ys21-primary');
  assert.ok(await start.isEnabled());
  assert.equal((await start.innerText()).includes('配置原生 Harness'), false, 'Configured Pi is admitted by the visible primary goal control.');
  await start.click();
  const goalRun = await settled(() => fixture.app.store.read().runs.find(run => run.goalId === goal.id && run.status === 'succeeded'), 'GoalFocus primary button runs Pi');
  assert.ok(goalRun.piSubmissionId);
  assert.equal(goalRun.inputContextSnapshot.artifacts[0].version, 1);
  assert.equal(goalRun.inputContextSnapshot.artifacts[0].content, PUBLIC_INPUT);
  assert.equal(fixture.app.store.read().goals.find(item => item.id === goal.id).status, 'review_required');
  assert.equal(fixture.faux.state.callCount, beforeReload + 2);
  await capture('assistant-goal-pi-start');
  await page.getByRole('button', { name: '返回工作', exact: true }).click();
  await page.getByTestId('workspace-assistant').waitFor();
  evidence.goalArtifact = await downloadOutput(goalRun, 'assistant-goal.md');
  evidence.checks.push('Actual GoalComposer save and GoalFocus primary start retain exact public inputs, admit configured Pi and finish one original goal run with review-required output.');

  await page.goto(`${fixture.base}/chat/${encodeURIComponent(fixture.conversation.id)}`); await ready();
  const connector = (await fixture.app.capabilities.createConnector({ name: 'Synthetic local approval connector', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
  await fixture.app.capabilities.updateConnector(connector.id, { enabled: true });
  await page.reload(); await ready();
  await page.getByRole('button', { name: '选择任务输入', exact: true }).click();
  await page.getByRole('checkbox', { name: '允许提议 Synthetic local approval connector create_file', exact: true }).check();
  await page.getByRole('button', { name: '保存任务输入', exact: true }).click();
  const callsBeforeApproval = fixture.faux.state.callCount;
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: 'Review this exact synthetic local file creation.', connectorId: connector.id, action: 'create_file', resource: 'library:new', payload: { filename: 'approved-local.txt', content: 'Exact original local connector receipt bytes.' } }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(JSON.stringify({ done: true, content: 'The original approved local connector receipt succeeded.', artifact: { filename: 'assistant-approved.md', content: OUTPUT_TEXT } })),
  ]);
  await page.getByRole('textbox', { name: '输入目标任务', exact: true }).fill('Propose the selected local file action, wait for approval, then save the receipt summary.');
  await page.getByRole('button', { name: '提交目标任务', exact: true }).click();
  const awaiting = await settled(() => fixture.app.store.read().runs.find(run => run.conversationId === fixture.conversation.id && run.status === 'awaiting_approval'), 'Exact connector proposal awaits approval');
  assert.equal(fixture.faux.state.callCount, callsBeforeApproval + 1);
  assert.equal(fixture.app.store.read().artifacts.some(item => item.filename === 'approved-local.txt'), false);
  const approvalCard = page.locator(`[data-run-id="${awaiting.id}"]`);
  await approvalCard.getByRole('button', { name: '批准此动作', exact: true }).click();
  await settled(() => fixture.app.runtime.getRun(awaiting.id).run.proposals[0].status === 'approved', 'Actual approval button records the original decision');
  assert.equal(fixture.app.store.read().artifacts.some(item => item.filename === 'approved-local.txt'), false, 'Approval itself cannot execute the connector.');
  assert.equal(fixture.faux.state.callCount, callsBeforeApproval + 1);
  await approvalCard.getByRole('button', { name: '按已批准范围继续', exact: true }).click();
  const continued = await settled(() => { const run = fixture.app.runtime.getRun(awaiting.id).run; return run.status === 'succeeded' && run; }, 'Explicit continuation consumes original approval');
  assert.equal(continued.proposals[0].receipt.status, 'succeeded');
  assert.equal(fixture.faux.state.callCount, callsBeforeApproval + 2);
  evidence.approvedArtifact = await downloadOutput(continued, 'assistant-approved.md');
  await capture('assistant-exact-local-approval');
  evidence.checks.push('Visible exact-action approval and separate continue buttons consume one original receipt; neither model output nor approval alone executes the connector.');

  const pending = async (_request, options) => {
    if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  };
  const beforeCancel = fixture.faux.state.callCount;
  fixture.faux.setResponses([pending]);
  await page.getByRole('textbox', { name: '输入目标任务', exact: true }).fill('Synthetic cancellation fixture: remain pending until I stop this task.');
  await page.getByRole('button', { name: '提交目标任务', exact: true }).click();
  const cancelRun = await settled(() => fixture.app.store.read().runs.find(run => run.conversationId === fixture.conversation.id && run.status === 'running' && run.piSubmissionId && fixture.faux.state.callCount === beforeCancel + 1), 'Original Pi cancellation fixture is actually running');
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await settled(() => fixture.app.runtime.getRun(cancelRun.id).run.status === 'cancelled', 'Main composer cancel stops the original run');
  await page.reload(); await ready();
  assert.equal(fixture.faux.state.callCount, beforeCancel + 1);
  assert.equal(fixture.app.runtime.getRun(cancelRun.id).run.status, 'cancelled');
  evidence.checks.push('Main assistant-ui cancel aborts the original Pi run; browser reopen does not resurrect it.');

  const beforeInterruption = fixture.faux.state.callCount;
  fixture.faux.setResponses([pending]);
  await page.getByRole('textbox', { name: '输入目标任务', exact: true }).fill('Synthetic interruption fixture: preserve this original task and selected input.');
  await page.getByRole('button', { name: '提交目标任务', exact: true }).click();
  const interrupted = await settled(() => fixture.app.store.read().runs.find(run => run.conversationId === fixture.conversation.id && run.status === 'running' && run.piSubmissionId && fixture.faux.state.callCount === beforeInterruption + 1), 'Original checkpoint admitted before restart');
  await page.goto('about:blank');
  await fixture.reopen();
  assert.equal(fixture.app.runtime.getRun(interrupted.id).run.status, 'interrupted');
  assert.equal(fixture.faux.state.callCount, beforeInterruption + 1);
  fixture.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Explicitly resumed the original synthetic task.', artifact: { filename: 'assistant-recovered.md', content: OUTPUT_TEXT } }))]);
  await page.goto(`${fixture.base}/chat/${encodeURIComponent(fixture.conversation.id)}`); await ready();
  const recoveryCard = page.locator(`[data-run-id="${interrupted.id}"]`);
  await recoveryCard.getByRole('button', { name: '恢复原任务', exact: true }).waitFor();
  assert.equal(fixture.faux.state.callCount, beforeInterruption + 1, 'Read-only reopen cannot resume a model.');
  await recoveryCard.getByRole('button', { name: '恢复原任务', exact: true }).click();
  const recovered = await settled(() => { const run = fixture.app.runtime.getRun(interrupted.id).run; return run.status === 'succeeded' && run; }, 'Explicit original run recovery button completes the checkpoint');
  assert.equal(recovered.id, interrupted.id);
  assert.equal(recovered.piSubmissionId, interrupted.piSubmissionId);
  assert.deepEqual(recovered.inputContextSnapshot, interrupted.inputContextSnapshot);
  assert.deepEqual(recovered.budget, interrupted.budget);
  assert.equal(fixture.faux.state.callCount, beforeInterruption + 2);
  evidence.recoveredArtifact = await downloadOutput(recovered, 'assistant-recovered.md');
  await capture('assistant-original-checkpoint-recovery');
  evidence.checks.push('Host restart preserves one interrupted run/submission, complete input snapshot and original budget; only the visible original-run recovery button resumes it.');
  const runsBeforeLoss = new Set(fixture.app.store.read().runs.map(run => run.id));
  const callsBeforeLoss = fixture.faux.state.callCount;
  const writeCountBeforeLoss = evidence.requests.length;
  fixture.complete('assistant-lost-response.md'); loseNextSubmitResponse = true;
  await page.getByRole('textbox', { name: '输入目标任务', exact: true }).fill('Synthetic lost-response fixture: retain the exact original submit request.');
  await page.getByRole('button', { name: '提交目标任务', exact: true }).click();
  await page.getByRole('button', { name: '核对原提交结果', exact: true }).waitFor();
  const lostRun = await settled(() => fixture.app.store.read().runs.find(run => !runsBeforeLoss.has(run.id) && run.status === 'succeeded'), 'Original admitted work finishes while its HTTP response was lost');
  assert.equal(fixture.faux.state.callCount, callsBeforeLoss + 2);
  await capture('assistant-unknown-submit-original-request');
  await page.getByRole('button', { name: '核对原提交结果', exact: true }).click();
  await downloadOutput(lostRun, 'assistant-lost-response.md');
  assert.equal(fixture.app.store.read().runs.length, runsBeforeLoss.size + 1);
  assert.equal(fixture.faux.state.callCount, callsBeforeLoss + 2);
  const lossWrites = evidence.requests.slice(writeCountBeforeLoss).filter(item => item.method === 'POST' && /\/messages$/.test(item.path));
  assert.equal(lossWrites.length, 2, 'Only the original submit and explicit exact-request reconciliation are sent.');
  assert.equal(lossWrites[0].bodySha256, lossWrites[1].bodySha256);
  evidence.originalRuns = { task: chatRun.id, goal: goalRun.id, approval: awaiting.id,
    cancellation: cancelRun.id, recovery: interrupted.id, lostAcknowledgment: lostRun.id };
  evidence.selectedInput = { artifactId: fixture.file.id, version: 1, sha256: chatRun.inputContextSnapshot.artifacts[0].sha256 };
  evidence.persistedToolEvents = chatRun.events.filter(event => event.type.startsWith('pi.tool.'))
    .map(({ sequence, type, toolName, toolCallId }) => ({ sequence, type, toolName, toolCallId }));
  evidence.localFixtureModelCalls = fixture.faux.state.callCount;
  evidence.checks.push('Lost HTTP acknowledgment retains an explicit original-request reconciliation; its exact body replays to the same run with no extra Pi call.');
  await context.close();
  await fixture.close(); fixture = null;

  fixture = await assistantWorkspaceFixture({ configured: false });
  const blockedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blockedContext.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.base) { await route.fulfill({ status: 204, body: '' }); return; }
    await route.continue();
  });
  page = await blockedContext.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => evidence.consoleErrors.push(error.message));
  await page.goto(`${fixture.base}/chat/${encodeURIComponent(fixture.conversation.id)}`); await ready();
  await page.getByRole('textbox', { name: '输入目标任务', exact: true }).fill('Keep this task honestly blocked while no model is configured.');
  await page.getByRole('button', { name: '提交目标任务', exact: true }).click();
  const blockedRun = await settled(() => fixture.app.store.read().runs.find(run => run.conversationId === fixture.conversation.id && run.status === 'blocked'), 'Unconfigured task saved as blocked');
  assert.ok(blockedRun.error?.code);
  await page.getByText(blockedRun.error.message, { exact: true }).first().waitFor();
  assert.equal(fixture.faux.state.callCount, 0);
  assert.equal(fixture.app.store.read().artifacts.some(item => item.sourceRunId === blockedRun.id), false);
  await capture('assistant-unconfigured-blocked-390');
  evidence.checks.push('Actual unconfigured main submit preserves a blocked task, visible setup reason and zero provider calls/results.');
  await blockedContext.close(); await fixture.close(); fixture = null;

  fixture = await assistantWorkspaceFixture({ enterpriseViewer: true });
  const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const [cookieName, cookieValue] = fixture.session.cookie.split('=');
  await viewerContext.addCookies([{ name: cookieName, value: cookieValue, url: 'https://workspace.example', httpOnly: true, secure: true, sameSite: 'Strict' }]);
  await viewerContext.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'https://workspace.example') { await route.fulfill({ status: 204, body: '' }); return; }
    // The fixture stands in for the existing HTTPS ingress and signs the exact
    // browser method/target/body; the real enterprise Host still authorizes it.
    const response = await fixture.signedRequest(url.pathname + url.search, request.method(), request.postData() || '', request.headers());
    const headers = Object.fromEntries([...response.headers.entries()].filter(([name]) => !['connection', 'transfer-encoding'].includes(name)));
    if (url.pathname === '/api/events' && response.ok) {
      // Playwright route fulfillment cannot relay an unbounded stream. Relay
      // its real first invalidation frame and close that upstream connection.
      // Reconnects still use the original signed read route, never a mutation.
      const reader = response.body.getReader(), frame = await reader.read();
      await reader.cancel();
      await route.fulfill({ status: response.status, headers, body: Buffer.from(frame.value || []) });
    } else await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
  });
  page = await viewerContext.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => evidence.consoleErrors.push(error.message));
  await page.goto(`https://workspace.example/chat/${encodeURIComponent(fixture.conversation.id)}`); await ready();
  await page.getByTestId('workspace-assistant').waitFor();
  assert.equal(await page.getByRole('button', { name: '提交目标任务', exact: true }).isDisabled(), true);
  const rejected = await fixture.signedRequest(`/api/conversations/${fixture.conversation.id}/messages`, 'POST', JSON.stringify({ content: 'Viewer cannot execute', requestId: 'viewer-denied-request' }), { 'Content-Type': 'application/json', Cookie: fixture.session.cookie, 'X-CSRF-Token': fixture.session.csrfToken });
  assert.equal(rejected.status, 403);
  assert.equal(fixture.app.store.read().runs.length, 0);
  assert.equal(fixture.faux.state.callCount, 0);
  await capture('assistant-actual-enterprise-viewer-390');
  evidence.checks.push('Actual enterprise viewer session renders disabled execute controls; the same signed Host rejects execution with 403 and zero runs/provider calls.');
  await viewerContext.close();
  assert.deepEqual(evidence.consoleErrors, []);
  evidence.result = 'passed';
} catch (error) {
  evidence.result = 'failed'; evidence.failures.push(error.stack || error.message);
  if (page) await capture('failure-visible-state').catch(() => {});
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(join(destination, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser?.close(); await fixture?.close();
}
console.log(JSON.stringify(evidence, null, 2));
