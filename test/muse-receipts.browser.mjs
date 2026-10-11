/** Built V22 UI + persisted local application + HTTP file fixture.
 * This is NOT an original Native Harness host or real Muse execution. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'v22-muse-receipts-'));
const output = process.env.CONTROL_QA_OUTPUT || 'docs/screenshots/muse-receipts';
const hash = value => createHash('sha256').update(value).digest('hex');
const checks = [], errors = [], writes = [], fileRequests = [], downloads = [];
let app, proxy, browser, fileMode = 'success', viewer = false, exposeMuse = true;
try {
  const boot = () => createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: {
    kind: 'deepseek-harness', configured: false, complete() { throw Error('No model or research calls allowed'); }
  } });
  app = await boot(); await app.listen(0);
  await app.runtime.createConversation({ title: '原会话附件 · 隔离夹具' });
  const conversationId = app.store.read().conversations[0].id;
  const bytes = Buffer.from('source,claim\nfixture,合成附件；未执行真实 Muse 研究\n', 'utf8');
  await writeFile(path.join(directory, 'fixture.csv'), bytes);
  const file = { id: 'original-file', version: 1, sha256: hash(bytes), filename: 'fixture.csv' };
  const report = { schema: 'workspace.worker.delivery.v1', orderId: 'original-order', independentlyVerified: false };
  const receipt = { schema: 'workspace.muse.session-receipt.v1', nativeAgentId: conversationId, workerId: 'original-muse-worker',
    orderId: 'original-order', requestId: 'original-order-request', taskRef: 'original-muse-task', attemptId: 'original-muse-attempt', fence: 1,
    submitRequestId: 'original-submit', submitHash: hash('synthetic submit'), reportSha256: hash(JSON.stringify(report)), report,
    summary: '<img src=x onerror=alert(1)> 原会话合成回执', files: [file], sources: [], toolEvidence: [],
    evidenceNote: 'Synthetic HTTP/UI fixture; no real Muse research.', independentlyVerified: false };
  const receiptHash = hash(JSON.stringify(receipt));
  const message = { id: 'original-receipt-message', conversationId, role: 'assistant', content: receipt.summary, status: 'complete',
    createdAt: new Date().toISOString(), museOrderId: receipt.orderId, museReceiptHash: receiptHash, museReceipt: receipt };
  await app.store.update(state => state.messages.push({ id: 'legacy-text', conversationId, role: 'assistant', content: '旧记录：只有摘要', createdAt: message.createdAt }, message,
    { ...message, id: 'malformed-record', content: '无效附件字段记录', museReceipt: { ...receipt, files: {} } },
    { ...message, id: 'changed-receipt', content: '被更改的回执记录', museReceipt: { ...receipt, summary: 'Changed metadata without changing its hash' } }));
  const future = () => new Date(Date.now() + 60000).toISOString();
  let dot = { id: 'dot-job', prompt: 'Dot 正在执行 · 混合任务夹具', state: 'running', conversationId, attemptId: 'dot-attempt', fence: 1,
    leaseUntil: future(), deadlineAt: new Date(Date.now() + 3600000).toISOString(), receiptHash: null, returnedHash: null, files: [] };
  let task = { agentKind: 'muse', orderId: receipt.orderId, requestId: receipt.requestId, nativeAgentId: conversationId, workerId: receipt.workerId,
    taskRef: null, status: 'queued', executionStatus: 'pending', attemptId: null, fence: 0, leaseUntil: null,
    createdAt: message.createdAt, updatedAt: message.createdAt, deadlineAt: dot.deadlineAt, serviceId: 'channel-validation',
    product: 'Synthetic public fixture', market: 'US', objective: 'Muse 原会话附件 · 隔离夹具', budgetCredits: 5,
    summary: '', receipt: null, receiptHash: null, returnedHash: null, acceptedAt: null, independentlyVerified: false };
  let others = [];
  const snapshot = () => ({ enabled: true, canDelegate: true, worker: { id: 'original-dot-worker', connection: {
    id: 'original-connection', provider: 'dot', authenticatedRecently: true } }, delegations: [dot, ...others],
    dotTasks: [dot, ...others].map(job => ({ requestId: 'request-' + job.id, nativeAgentId: conversationId, jobId: job.id,
      prompt: job.prompt, state: job.state, receiptHash: job.receiptHash, returnedHash: job.returnedHash, acceptedHash: job.acceptedHash, receipt: null })),
    ...(exposeMuse ? { museTasks: [task] } : {}) });

  // A real loopback response exercises fetch/download bytes. Its ownership and
  // error modes are explicit fixtures, not the production native file service.
  proxy = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.test');
    if (url.pathname.startsWith('/api/muse-worker-files/')) {
      fileRequests.push(req.url);
      if (fileMode === 'network') { req.socket.destroy(); return; }
      const status = ({ unauthorized: 401, forbidden: 403, missing: 404, unavailable: 503 })[fileMode];
      if (status) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Isolated download fixture' })); return; }
      if (url.pathname !== '/api/muse-worker-files/' + file.id || url.searchParams.get('version') !== '1' || url.searchParams.get('sha256') !== file.sha256) {
        res.writeHead(404); res.end(); return;
      }
      if (fileMode === 'slow') await new Promise(resolve => setTimeout(resolve, 3500));
      const body = fileMode === 'corrupt' ? Buffer.from('Different file bytes') : await readFile(path.join(directory, 'fixture.csv'));
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': body.length, 'Content-Disposition': 'attachment; filename="fixture.csv"',
        'Cache-Control': 'no-store', 'X-Content-SHA256': fileMode === 'wrong-header' ? hash('wrong') : file.sha256 }); res.end(body); return;
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(503); res.end(); }); req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + proxy.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message)); page.on('download', download => downloads.push(download));
  await page.route('**/api/**', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); await route.fulfill({ status: 500, json: { error: 'Unexpected mutation' } }); }
    else await route.fallback();
  });
  await page.route('**/api/session', async route => { const response = await route.fetch(), value = await response.json();
    await route.fulfill({ response, json: { ...value, user: { ...value.user, role: viewer ? 'viewer' : 'admin' } } }); });
  await page.route('**/api/bootstrap', async route => { const response = await route.fetch(), value = await response.json();
    await route.fulfill({ response, json: { ...value, runtime: { ...value.runtime, cloudDot: true, cloudWorkerReady: true } } }); });
  await page.route('**/api/personal-worker', route => route.fulfill({ json: snapshot() }));
  await mkdir(output, { recursive: true });
  const open = async () => { await page.goto(base + '/chat/' + conversationId); await page.getByTestId('v22-cloud-control').waitFor(); };
  const history = async () => { await open(); await page.getByRole('button', { name: '任务 · 2', exact: true }).click();
    await page.getByRole('button', { name: /Muse 原会话附件/ }).click(); await page.getByRole('button', { name: '查看原会话记录', exact: true }).click();
    await page.getByRole('dialog', { name: '原会话记录', exact: true }).waitFor(); };
  const downloaded = async () => { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /fixture.csv/ }).click()]);
    const destination = path.join(directory, 'download-' + downloads.length + '.csv'); await download.saveAs(destination);
    const actual = await readFile(destination); assert.deepEqual(actual, bytes); assert.equal(hash(actual), file.sha256); assert.equal(download.suggestedFilename(), file.filename); };

  for (const status of ['queued', 'draft']) {
    task.status = status; await open(); await page.getByRole('heading', { name: '执行中', exact: true }).waitFor();
    assert.equal(await page.locator('.control-spirit.is-working').count(), 1); assert.match(await page.locator('.control-presence').innerText(), /Dot 正在执行/);
  }
  checks.push('Queued and draft Muse cannot mask a Dot with original attempt/fence and future lease/deadline.');
  others = ['blocked', 'cancel_requested'].map((state, index) => ({ ...dot, id: 'attention-' + index, state, prompt: state + ' · 待处理夹具' }));
  await open(); await page.getByRole('button', { name: '另有 2 项待处理', exact: true }).waitFor();
  await page.screenshot({ path: output + '/mixed-running-phone-fixture.png' });
  await page.getByRole('button', { name: '另有 2 项待处理', exact: true }).click();
  await page.getByText(/等待停止确认/).waitFor(); await page.getByText(/执行受阻/).waitFor();
  checks.push('One central running spirit retains a visible entry for blocked and cancellation tasks.');
  others = []; dot.leaseUntil = new Date(Date.now() - 1).toISOString();
  await open(); await page.getByRole('heading', { name: '执行凭据待核对', exact: true }).waitFor();
  assert.equal(await page.locator('.control-spirit.is-working').count(), 0);
  checks.push('Expired Dot lease stops animation and remains actionable ahead of draft Muse.');
  dot.state = 'queued'; task = { ...task, status: 'running', executionStatus: 'claimed', taskRef: receipt.taskRef,
    attemptId: receipt.attemptId, fence: receipt.fence, leaseUntil: future() };
  await open(); await page.getByRole('heading', { name: '已领取 · 租约有效', exact: true }).waitFor();
  assert.equal(await page.locator('.control-spirit.is-working').count(), 1);
  task.deadlineAt = new Date(Date.now() - 1).toISOString(); await open();
  await page.getByRole('heading', { name: '执行租约待核对', exact: true }).waitFor(); assert.equal(await page.locator('.control-spirit.is-working').count(), 0);
  checks.push('Live Muse outranks queued Dot; a passed Muse deadline stops the working animation.');

  dot.state = 'succeeded'; dot.acceptedHash = hash('accepted dot');
  task = { ...task, deadlineAt: dot.deadlineAt, status: 'review_required', executionStatus: 'submitted', summary: receipt.summary, receipt, receiptHash, returnedHash: receiptHash };
  await history(); await page.getByRole('link', { name: /fixture.csv/ }).waitFor();
  assert.equal(await page.getByText(receipt.summary, { exact: true }).count(), 1);
  await page.getByText('旧记录：只有摘要', { exact: true }).waitFor();
  assert.equal(await page.locator('.cloud-conversation img').count(), 0);
  assert.equal(await page.getByText('回执附件信息不完整或校验失败，等待原订单核对。', { exact: true }).count(), 2);
  assert.equal(await page.getByRole('button', { name: '确认验收这份成果', exact: true }).count(), 0);
  await page.screenshot({ path: output + '/original-receipt-phone-fixture.png' });
  await downloaded();
  assert.equal(fileRequests.at(-1), '/api/muse-worker-files/' + file.id + '?version=1&sha256=' + file.sha256);
  checks.push('Original history keeps text and one receipt attachment; a real HTTP click downloads exact bytes/SHA/name using the original ID/version/hash.');
  fileMode = 'slow'; await downloaded();
  checks.push('A slow attachment download survives routine bootstrap/task polling without being unmounted or aborted.');
  for (const [mode, text] of [['unauthorized', '登录已失效'], ['forbidden', '当前账号无权'], ['missing', '此版本附件不可用'],
    ['unavailable', '下载失败'], ['network', '无法连接下载服务'], ['corrupt', '附件校验失败'], ['wrong-header', '附件校验失败']]) {
    fileMode = mode; const before = downloads.length;
    await page.getByRole('link', { name: /fixture.csv/ }).click(); await page.getByRole('alert').filter({ hasText: text }).waitFor();
    assert.equal(downloads.length, before);
  }
  checks.push('401/403/404/503/network errors and changed bytes or hash headers produce visible retryable errors and no download.');
  fileMode = 'success'; await downloaded();
  checks.push('Retry succeeds for the same attachment after the file response recovers.');
  await history(); await page.getByRole('link', { name: /fixture.csv/ }).waitFor(); await downloaded();
  assert.equal(await page.getByText(receipt.summary, { exact: true }).count(), 1);
  checks.push('Reload preserves the original persisted message and exact attachment download.');
  await app.close(); app = await boot(); await app.listen(0);
  assert.equal(app.store.read().messages.filter(item => item.id === message.id).length, 1);
  await history(); await page.getByRole('link', { name: /fixture.csv/ }).waitFor(); await downloaded();
  assert.equal(await page.getByText(receipt.summary, { exact: true }).count(), 1);
  checks.push('Restart of the local application fixture retains one original message and correct file bytes; this does not verify Native Harness reconciliation.');
  viewer = true; await history(); await page.getByText('当前账号未获此附件的下载授权。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /fixture.csv/ }).count(), 0);
  checks.push('Read-only viewer cannot initiate an attachment download.');
  viewer = false; exposeMuse = false; await open(); await page.getByRole('button', { name: '查看云端任务进度' }).click();
  await page.getByRole('button', { name: '查看原会话记录', exact: true }).click();
  await page.getByText('当前账号未获此附件的下载授权。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /fixture.csv/ }).count(), 0);
  checks.push('Missing owner-authorized Muse task view keeps legacy receipt text without granting a file link.');
  exposeMuse = true; task.workerId = 'different-worker'; await history();
  await page.getByText('当前账号未获此附件的下载授权。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /fixture.csv/ }).count(), 0);
  task.workerId = receipt.workerId; const originalReceipt = task.receipt; task.receipt = null;
  await history(); await page.getByText('当前账号未获此附件的下载授权。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /fixture.csv/ }).count(), 0);
  checks.push('A changed Worker or missing authorized receipt file list cannot grant historical attachment access.');
  task.receipt = originalReceipt; await history(); await page.getByRole('link', { name: /fixture.csv/ }).waitFor();
  for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: output + '/receipt-' + width + '-fixture.png' });
  }
  checks.push('Built V22 history and attachments fit 320px, 390px and desktop viewports without horizontal overflow.');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { result: 'passed', checks, errors, writes, downloads: downloads.length, fileRequests, fileSha256: file.sha256,
    deployment: false, proof: 'built V22 UI + persisted local application + synthetic HTTP file fixture; NOT original Native Harness or real Muse execution' };
  await writeFile(output + '/MUSE-RECEIPT-VERIFICATION.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close(); if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  await app?.close(); await rm(directory, { recursive: true, force: true });
}
