import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '/workspace/workspace-release-20261013/node_modules/playwright/index.mjs';
import { createModels } from '/workspace/workspace-release-20261013/node_modules/@earendil-works/pi-ai/dist/index.js';
import { fauxProvider, fauxAssistantMessage } from '/workspace/workspace-release-20261013/node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
import { createPiProvider } from '/workspace/workspace-release-20261013/server/pi-provider.mjs';
import { createApp } from '/workspace/workspace-release-20261013/server/index.mjs';

const output = '/tmp/workspace-launch-20261013/frontend-visible-017cf20/pi-results';
await mkdir(output, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceStatus = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
assert.equal(source, '017cf2030836398513319a7c910c6ad732e43b16');
const directory = await mkdtemp(join(tmpdir(), 'workspace-pi-results-visible-'));
const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
const provider = () => createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
const errors = [], checks = [], screenshots = [], externalHosts = new Set();
const inputText = 'EXPLICIT_PUBLIC_LOCAL_VISUAL_FIXTURE_V1';
const outputText = '# Workspace 本地合成成果\n\n这份文件由当前原始 Runtime 与真实安装的 Pi SDK 通过本地 faux provider 生成并保存。\n\n这是合成验收数据，不代表真实模型、Muse、Shopify 或生产执行。\n\n来源：显式选择的公开合成输入 v1。\n源码：017cf2030836398513319a7c910c6ad732e43b16。\n';
let app, browser, page, base;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`); return value;
}
async function capture(name) { const path = join(output, name + '.png'); await page.screenshot({ path, fullPage: true }); screenshots.push(path); }
async function noOverflow(label) { const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(geometry.scroll <= geometry.width + 1, `${label}: ${JSON.stringify(geometry)}`); }
try {
  app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: provider() });
  let address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  const input = (await api('/artifacts', 'POST', { requestId: randomUUID(), filename: 'reviewed-public-synthetic-scope.md', content: inputText })).artifact;
  const conversation = (await api('/conversations', 'POST', { title: 'Pi 本地合成成果 · 非生产执行', inputContext: { artifacts: [{ id: input.id, version: 1 }] } })).conversation;
  faux.setResponses([request => {
    const serialized = JSON.stringify(request.messages); assert.ok(serialized.includes(inputText));
    return fauxAssistantMessage(JSON.stringify({ done: true, content: '本地合成文件已保存。下面可预览或下载原始版本；此结果不代表真实模型或 Muse 执行。', artifact: { filename: 'workspace-local-result.md', content: outputText } }));
  }]);
  browser = await chromium.launch({ headless: true, chromiumSandbox: false, executablePath: '/usr/bin/chromium' });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base) return route.continue(); externalHosts.add(url.hostname); return route.fulfill({ status: 204, body: '' }); });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${base}/chat/${conversation.id}`); await page.locator('.app-shell[aria-busy="false"]').waitFor();
  await page.getByRole('checkbox', { name: '生成计划与文件草稿', exact: true }).check();
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('请依据显式选择的合成公开资料制作一份本地文件，不调用外部工具。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const previewLabel = '预览 workspace-local-result.md'; await page.getByRole('button', { name: previewLabel, exact: true }).waitFor();
  assert.equal(faux.state.callCount, 1);
  const bootstrap = await api('/bootstrap'), run = bootstrap.runs.find(item => item.conversationId === conversation.id), message = bootstrap.messages.find(item => item.runId === run.id && item.artifactReference);
  assert.equal(run.status, 'succeeded'); assert.ok(message?.artifactReference);
  const artifact = bootstrap.artifacts.find(item => item.id === message.artifactId); assert.equal(artifact.sourceRunId, run.id); assert.equal(artifact.sourceConversationId, conversation.id); assert.equal(run.outputArtifactId, artifact.id);
  const reference = message.artifactReference; assert.equal(reference.version, 1); assert.equal(reference.sha256, createHash('sha256').update(outputText).digest('hex'));
  checks.push('Actual original browser send → original HTTP/Runtime → installed Pi SDK with faux provider → same-conversation durable file and exact provenance.');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.reload(); await page.locator('.app-shell[aria-busy="false"]').waitFor();
    const preview = page.getByRole('button', { name: previewLabel, exact: true }); await preview.waitFor(); await preview.scrollIntoViewIfNeeded();
    assert.equal(faux.state.callCount, 1); await noOverflow(`result ${width}`); await capture(`01-original-result-card-${width}`);
    await preview.click(); const dialog = page.getByRole('dialog', { name: '附件 workspace-local-result.md', exact: true }); await dialog.locator('pre').waitFor(); assert.equal(await dialog.locator('pre').innerText(), outputText);
    await noOverflow(`verified preview ${width}`); await capture(`02-verified-result-preview-${width}`);
    const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载此版本', exact: true }).click(); const download = await downloading;
    await download.saveAs(join(output, `downloaded-original-${width}.md`)); const bytes = await readFile(join(output, `downloaded-original-${width}.md`)); assert.equal(bytes.toString('utf8'), outputText); assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256);
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  checks.push('390/1440 px actual result card and SHA-verified preview remain readable; browser downloads match the persisted file bytes exactly.');
  await page.goto('about:blank'); await app.close(); app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: provider() }); address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  await page.goto(`${base}/chat/${conversation.id}`); await page.getByRole('button', { name: previewLabel, exact: true }).waitFor(); assert.equal(faux.state.callCount, 1); assert.equal(app.runtime.getRun(run.id).run.status, 'succeeded');
  const reopened = app.runtime.bootstrap().messages.find(item => item.id === message.id); assert.deepEqual(reopened.artifactReference, reference);
  checks.push('Actual original host/Store restart restores the same succeeded fixture run and exact file reference without replaying Pi.');
  assert.deepEqual(errors, []); assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), source);
  const evidence = { result: 'passed', source, sourceStatus, actualBrowser: true, browserVersion: browser.version(), screenshotCount: screenshots.length, screenshots, checks, errors, actualPiSdkRequests: faux.state.callCount, liveModelCalls: 0, liveMuseExecution: false, externalHostsBlocked: [...externalHosts], dataSource: 'Temporary original Workspace Store, explicit synthetic input and actual Pi faux provider output.', state: { conversationId: conversation.id, runId: run.id, runStatus: run.status, artifactId: artifact.id, artifactReference: reference, sourceConversationId: artifact.sourceConversationId, sourceRunId: artifact.sourceRunId, downloadedSha256: reference.sha256 }, boundary: 'Current actual production App/Runtime/Pi package on loopback, local synthetic provider only. No production models, credentials, native Host/login acceptance or deployment.' };
  await writeFile(join(output, 'VERIFICATION.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await capture('FAILURE').catch(() => {});
  await writeFile(join(output, 'FAILURE.json'), JSON.stringify({ source, sourceStatus, result: 'failed', errors, error: error.stack, actualPiSdkRequests: faux.state.callCount, body: page && !page.isClosed() ? await page.locator('body').innerText().catch(() => '') : '' }, null, 2) + '\n', { flag: 'wx' }); throw error;
} finally { await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
