/** Real Chromium + production Vite assets, with explicitly synthetic HTTP DTOs.
 * No original server/SDK/SSO, model, account, external service or private data
 * is exercised. This suite must never be presented as deployment acceptance.
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const output = resolve(process.env.HARNESS_EVIDENCE_DIR || '/tmp/harness-web-release-browser-sandbox');
const evidence = { actualBrowser: false, api: 'synthetic Playwright responses', originalServer: false, originalSdk: false,
  authentication: 'synthetic session DTO only; no signed ingress', externalModelCalls: 0,
  chromiumSandboxRequested: true, chromiumSandboxVerified: false, checks: [], screenshots: [] };
let server, browser, origin;
before(async () => {
  await mkdir(output, { recursive: true });
  evidence.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sources = ['src/App.tsx', 'src/api.ts', 'src/assistant/WorkspaceAssistant.tsx',
    'src/harness/useConversationRuntime.ts', 'src/harness/PluginStatusDialog.tsx', 'src/harness/harness-workspace.css',
    'test/harness-web-release.browser.mjs', 'package.json', 'package-lock.json', 'dist/index.html',
    ...(await readdir(resolve('dist/assets'))).filter(name => /\.(js|css)$/.test(name)).map(name => 'dist/assets/' + name)];
  evidence.sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async name => [name, createHash('sha256').update(await readFile(name)).digest('hex')])));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const asset = path.startsWith('/assets/') && !path.includes('..') ? resolve('dist', '.' + path) : resolve('dist/index.html');
    try { const body = await readFile(asset); res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(asset)] || 'text/html' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  evidence.actualBrowser = true;
  evidence.chromiumSandboxVerified = true;
  evidence.browserVersion = browser.version();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await writeFile(join(output, 'report.json'), JSON.stringify(evidence, null, 2));
});
const emptyContext = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const at = '2026-10-18T06:30:00.000Z';
const conversationId = 'synthetic:thread/one';
const runtimeDto = { engine: 'omp', engineScope: 'omp:18.10.4:business-v1', frontend: 'original-workspace-conversation-run', privateLibrary: 'original-reviewed-session-policy-required', contextReset: 'confirmed-original-human-control' };

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 } });
  t.after(() => context.close());
  context.setDefaultTimeout(8000);
  const page = await context.newPage(), requests = [], errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  let sequence = 1, authenticated = options.authenticated !== false, runtimeStatus = options.runtimeStatus || 200;
  let loseNextMessage = false, loseNextCreation = false, bootstrapUnavailable = false, medusaConfigured = options.medusaConfigured ?? false;
  const conversations = options.empty ? [] : [{ id: conversationId, title: '合成测试会话', status: 'idle', inputContext: emptyContext(), createdAt: at, updatedAt: at }];
  const messages = [], artifacts = [], documents = [], admitted = new Map(), creations = new Map();
  let references = { products: [], documents: [] }, refRevision = 0;
  const session = () => ({ mode: 'enterprise', authenticated, workspaceId: 'synthetic-workspace', user: authenticated ? { id: 'synthetic-member', role: options.role || 'operator' } : null, csrfToken: authenticated ? 'synthetic-csrf' : null, expiresAt: null, idleExpiresAt: null });
  const diagnostics = () => ({ schemaVersion: 1, instanceId: 'synthetic-instance', startedAt: at, observedAt: new Date().toISOString(), staleAfterMs: 10000, readOnly: true, externalCalls: false, overall: 'configured_unverified',
    provider: { configured: options.configured !== false, kind: 'synthetic', provider: 'synthetic', model: 'synthetic-no-model', configuration: 'present', onlineVerified: false, localVerification: { status: 'missing' }, liveValidation: { status: 'not_validated', scope: 'current-deployment' }, lastObservation: { status: 'not_observed', observedAt: null, code: null, scope: 'current-process-provider-return' } },
    storage: { state: 'open', durability: 'confirmed', schemaVersion: 1, exclusiveWriter: true, liveWriteProbe: false, warnings: [] }, scheduler: { state: 'stopped', automaticTimer: false, dispatchConfigured: false, enabled: 0, blocked: 0 },
    connectors: { total: 0, enabled: 0, configured: 0, blocked: 0, onlineVerified: false, items: [] }, recovery: { restored: false }, access: { mode: 'enterprise' }, blockers: [] });
  const bootstrap = () => ({ conversations, messages, goals: [], activity: [], memories: [], artifacts, runs: [], settings: { name: 'Workspace', language: 'zh', model: 'synthetic-no-model', maxGoalSteps: 3 },
    runtime: { provider: 'synthetic', kind: 'synthetic', configured: options.configured !== false, model: 'synthetic-no-model', status: 'ready' }, capabilities: { skills: [], connectors: options.connectors || [], approvals: [], schedules: [] }, meta: { sequence }, diagnostics: diagnostics() });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice(4), method = request.method(), body = request.postDataJSON();
    requests.push({ path: url.pathname + url.search, method, body, csrf: request.headers()['x-csrf-token'] });
    const respond = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const failed = (status, code) => respond({ code, error: { code, message: `Synthetic ${code}` } }, status);
    if (path === '/session') return respond(session());
    if (path === '/session/login') { authenticated = true; return respond(session()); }
    if (!authenticated) return failed(401, 'SESSION_REQUIRED');
    if (path === '/session/logout') { authenticated = false; return respond({}); }
    if (path === '/bootstrap') return bootstrapUnavailable ? failed(503, 'SYNTHETIC_DISCONNECTED') : respond(bootstrap());
    if (path === '/diagnostics') return respond(diagnostics());
    if (path === '/conversations/runtime') return runtimeStatus === 200 ? respond(runtimeDto) : failed(runtimeStatus, runtimeStatus === 404 ? 'NOT_FOUND' : 'SYNTHETIC_UNAVAILABLE');
    if (path === '/medusa/catalog/status') return options.medusaError ? failed(503, 'SYNTHETIC_MEDUSA_UNAVAILABLE') : respond({ medusa: { configured: medusaConfigured, connection: medusaConfigured ? 'configured_unverified' : 'unconfigured', mode: 'internal_draft_only', reason: medusaConfigured ? null : 'SYNTHETIC_UNCONFIGURED' } });
    if (path === '/events') return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (path === '/conversations' && method === 'POST') {
      let conversation = creations.get(body.requestId);
      if (!conversation) {
        conversation = { id: randomUUID(), title: body.title || '合成新会话', inputContext: body.inputContext || emptyContext(), status: 'idle', createdAt: at, updatedAt: at };
        creations.set(body.requestId, conversation); conversations.unshift(conversation); sequence++;
      }
      if (loseNextCreation) { loseNextCreation = false; return route.abort('failed'); }
      return respond({ conversation }, 201);
    }
    const message = path.match(/^\/conversations\/([^/]+)\/messages$/);
    if (message && method === 'POST') {
      const id = decodeURIComponent(message[1]);
      if (!admitted.has(body.requestId)) {
        messages.push({ id: randomUUID(), conversationId: id, role: 'user', content: body.content, status: 'complete', createdAt: at }, { id: randomUUID(), conversationId: id, role: 'assistant', content: '合成 API 回复：' + body.content, status: 'complete', createdAt: at });
        admitted.set(body.requestId, body); sequence++;
      } else assert.deepEqual(admitted.get(body.requestId), body, 'Retries keep the exact payload.');
      if (loseNextMessage) { loseNextMessage = false; return route.abort('failed'); }
      return respond({ accepted: true }, 202);
    }
    if (/\/library-references$/.test(path)) {
      if (method === 'PATCH') { references = body.references; refRevision++; sequence++; }
      return respond({ libraryReferences: { ...references, conversationId, revision: refRevision, updatedAt: at }, resolution: { products: references.products.map(value => ({ ...value, status: 'current' })), documents: references.documents.map(value => ({ ...value, status: 'current' })) } });
    }
    if (path === '/artifacts' && method === 'POST') {
      const content = Buffer.from(body.base64, 'base64'), sha256 = createHash('sha256').update(content).digest('hex');
      const artifact = { id: randomUUID(), title: body.title, filename: body.filename, currentVersion: 1, sha256, mimeType: 'text/markdown', size: content.length, revision: 1, versions: [{ version: 1, filename: body.filename, sha256, mimeType: 'text/markdown', size: content.length, createdAt: at }], createdAt: at, updatedAt: at };
      artifacts.push(artifact); sequence++; return respond({ artifact }, 201);
    }
    if (path === '/library/documents' && method === 'POST') {
      const document = { id: randomUUID(), revision: 1, companyId: 'synthetic-company', title: body.title, slotKey: body.slotKey, tags: body.tags, status: 'active', currentVersion: 1, versions: [{ version: 1, asset: body.asset, certificate: body.certificate, createdAt: at, createdBy: 'synthetic-member' }], reviews: [], createdAt: at, updatedAt: at };
      documents.push(document); sequence++; return respond({ document }, 201);
    }
    if (path === '/library/documents') return respond({ items: documents, nextCursor: null, sequence });
    if (path === '/library/products') return respond({ items: [], nextCursor: null, sequence });
    if (path.startsWith('/library/documents/')) return respond({ document: documents.find(value => value.id === path.split('/').at(-1)) });
    if (/^\/artifacts\/[^/]+\/content$/.test(path)) return respond({ encoding: 'utf8', content: 'SYNTHETIC_PUBLIC_DOCUMENT', version: { mimeType: 'text/markdown' } });
    if (path === '/library/company') return respond({ company: { id: 'synthetic-company', revision: 1, legalName: '', displayName: '', description: '', createdAt: at, updatedAt: at } });
    return failed(404, 'NOT_FOUND');
  });
  async function ready(path = '/') { await page.goto(origin + path); await page.locator('.app-shell[aria-busy="false"]').waitFor(); await page.getByRole('heading', { name: '从一个问题开始' }).waitFor(); }
  async function send(text) { await page.getByRole('textbox', { name: '输入消息', exact: true }).fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click(); await page.getByText('合成 API 回复：' + text, { exact: true }).waitFor(); }
  async function screenshot(name) { const filename = name + '.png'; await page.screenshot({ path: join(output, filename), fullPage: true, animations: 'disabled' }); evidence.screenshots.push(filename); }
  t.after(() => { assert.deepEqual(errors, [], 'No uncaught browser errors.'); assert.deepEqual(external, [], 'No external request or real service call.'); });
  return { page, context, requests, conversations, messages, ready, send, screenshot, session: () => { authenticated = false; }, disconnect: () => { bootstrapUnavailable = true; }, lose: () => { loseNextMessage = true; }, loseCreate: () => { loseNextCreation = true; }, runtime: status => { runtimeStatus = status; }, medusa: value => { medusaConfigured = value; } };
}

test('empty workspace creates one conversation, and an unknown creation response retains its exact request', async t => {
  const f = await fixture(t, { empty: true }); await f.ready(); f.loseCreate();
  await f.page.getByRole('textbox', { name: '输入消息', exact: true }).fill('首次合成问题');
  await f.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await f.page.getByRole('button', { name: '核对原提交结果', exact: true }).click();
  await f.page.getByText('合成 API 回复：首次合成问题', { exact: true }).waitFor();
  assert.equal(f.conversations.length, 1);
  const creations = f.requests.filter(value => value.method === 'POST' && value.path === '/api/conversations');
  assert.equal(creations.length, 2); assert.deepEqual(creations[0].body, creations[1].body);
  await f.send('新会话第二轮');
  const messages = f.requests.filter(value => value.method === 'POST' && value.path.endsWith('/messages'));
  assert.equal(messages.length, 2); assert.equal(messages[0].path, messages[1].path);
  evidence.checks.push('empty workspace, exact unknown creation recovery, continued new conversation');
});

test('desktop continues one opaque conversation, refreshes history, and preserves exact retry identity', async t => {
  const f = await fixture(t); await f.ready();
  await f.page.waitForURL('**/chat/' + encodeURIComponent(conversationId));
  await f.page.getByRole('complementary', { name: '聊天记录' }).waitFor();
  assert.equal(await f.page.locator('.assistant-panel').count(), 0);
  await f.send('第一轮合成公开问题'); await f.send('第二轮继续同一会话');
  assert.equal(f.requests.filter(value => value.method === 'POST' && value.path === '/api/conversations').length, 0);
  const submits = () => f.requests.filter(value => value.method === 'POST' && value.path.endsWith('/messages'));
  assert.equal(submits().length, 2);
  for (const request of submits()) { assert.equal(request.path, '/api/conversations/' + encodeURIComponent(conversationId) + '/messages'); assert.equal(request.body.workspaceExecution, false); assert.deepEqual(request.body.inputContext, emptyContext()); assert.equal(request.csrf, 'synthetic-csrf'); }
  await f.page.reload(); await f.page.getByText('合成 API 回复：第二轮继续同一会话', { exact: true }).waitFor();
  f.lose(); await f.send('响应丢失的合成问题');
  await f.page.getByRole('button', { name: '核对原提交结果' }).click();
  await f.page.locator('.workspace-submission-recovery').waitFor({ state: 'detached' });
  assert.deepEqual(submits().at(-1).body, submits().at(-2).body);
  assert.equal(f.messages.filter(value => value.role === 'user' && value.content === '响应丢失的合成问题').length, 1);
  assert.equal(await f.page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '', 'Successful reconciliation clears the recovered composer text.');
  await f.page.locator('.toast').waitFor({ state: 'detached' });
  await f.screenshot('desktop-conversation'); evidence.checks.push('same conversation, reload, exact unknown-result retry, synthetic CSRF');
});

test('original upload creates an actual synthetic artifact/document and local citation, then returns to the same conversation', async t => {
  const f = await fixture(t); await f.ready();
  await f.page.getByRole('textbox', { name: '输入消息', exact: true }).fill('未发送的合成草稿');
  await f.page.getByRole('button', { name: '上传资料', exact: true }).click();
  await f.page.getByRole('heading', { name: '上传企业资料' }).waitFor();
  await f.page.getByRole('textbox', { name: '文档标题', exact: true }).fill('合成公开资料');
  await f.page.getByLabel('上传文件', { exact: true }).setInputFiles({ name: 'synthetic-public.md', mimeType: 'text/markdown', buffer: Buffer.from('SYNTHETIC_PUBLIC_DOCUMENT') });
  await f.page.getByRole('button', { name: '保存资料', exact: true }).click();
  await f.page.getByRole('heading', { name: '合成公开资料', exact: true }).waitFor();
  await f.page.getByRole('button', { name: '返回原会话', exact: true }).click();
  await f.page.waitForURL('**/chat/' + encodeURIComponent(conversationId));
  assert.equal(await f.page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '未发送的合成草稿', 'Uploading does not discard the unsent message.');
  await f.page.getByRole('button', { name: '选择产品或资料', exact: true }).click();
  const dialog = f.page.getByRole('dialog', { name: '选择会话产品或资料' });
  await dialog.getByRole('button', { name: '企业资料', exact: true }).click();
  await dialog.getByRole('button', { name: /合成公开资料/ }).click();
  await dialog.getByRole('button', { name: '选择此资料版本 v1', exact: true }).click();
  await dialog.getByRole('button', { name: '保存关联并返回会话', exact: true }).click();
  await f.page.getByRole('button', { name: '会话资料 · 0 个产品 / 1 份文件' }).waitFor();
  await f.page.getByText('仅关联，未发送给模型', { exact: true }).waitFor();
  await f.send('资料保持本地关联');
  const writes = f.requests.filter(value => value.method !== 'GET');
  assert.deepEqual(writes.map(value => value.path), ['/api/artifacts', '/api/library/documents', '/api/conversations/' + encodeURIComponent(conversationId) + '/library-references', '/api/conversations/' + encodeURIComponent(conversationId) + '/messages']);
  assert.deepEqual(writes.at(-1).body.inputContext, emptyContext());
  assert.ok(writes.every(value => value.csrf === 'synthetic-csrf'));
  await f.screenshot('document-reference'); evidence.checks.push('original upload routes, versioned local citation, return to same conversation; synthetic API');
});

test('plugins show configured, unconfigured and unavailable without exposing actions or inventing an OMP inventory', async t => {
  const connector = { id: 'synthetic-connector', name: '合成连接器', enabled: true, adapterConfigured: true, credentialConfigured: true, status: 'ready', description: '合成测试配置', capabilities: [] };
  const f = await fixture(t, { connectors: [connector] }); await f.ready();
  await f.page.locator('.chat-header').getByRole('button', { name: '插件与连接', exact: true }).click();
  const dialog = f.page.getByRole('dialog', { name: '插件与连接' });
  await dialog.getByRole('region', { name: 'Medusa 连接状态' }).getByText('未配置', { exact: true }).waitFor();
  await dialog.getByRole('region', { name: 'OMP 插件清单状态' }).getByText('状态不可用', { exact: true }).waitFor();
  await dialog.getByRole('region', { name: '原连接器配置' }).getByText('已配置 · 在线待验证', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('link', { name: '打开官方 Medusa Admin ↗' }).getAttribute('href'), 'https://medusa.cnsubscribe.xyz/dashboard/');
  assert.equal(await dialog.getByRole('button', { name: /执行|启用|安装/ }).count(), 0);
  await f.screenshot('plugin-status');
  assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0);
  evidence.checks.push('truthful configuration states, independent official Admin link, read-only status');
});

test('Medusa configured and unreadable states remain distinct, and viewers do not probe restricted configuration', async t => {
  for (const options of [{ medusaConfigured: true }, { medusaError: true }, { role: 'viewer' }]) {
    const f = await fixture(t, options); await f.ready();
    await f.page.locator('.chat-header').getByRole('button', { name: '插件与连接', exact: true }).click();
    const section = f.page.getByRole('region', { name: 'Medusa 连接状态' });
    await section.getByText(options.medusaConfigured ? '已配置 · 在线待验证' : '状态不可用', { exact: true }).waitFor();
    if (options.role === 'viewer') assert.equal(f.requests.filter(value => value.path === '/api/medusa/catalog/status').length, 0);
    assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0);
  }
  evidence.checks.push('Medusa configured/unavailable distinction; viewer does not read restricted status');
});

test('mobile drawers, dialogs and composer remain usable without horizontal overflow', async t => {
  const f = await fixture(t, { viewport: { width: 390, height: 844 } }); await f.ready();
  await f.page.getByRole('button', { name: '打开或收起聊天记录' }).click();
  await f.page.getByRole('complementary', { name: '聊天记录' }).waitFor();
  await f.page.getByRole('button', { name: '收起聊天列表' }).click();
  await f.page.getByRole('button', { name: '显示助手面板' }).click();
  await f.page.getByRole('complementary', { name: 'Workspace 活动与目标' }).waitFor();
  assert.equal(await f.page.locator('.conversation-sidebar').count(), 0);
  await f.page.getByRole('button', { name: '收起助手面板' }).click();
  await f.send('移动端合成问题');
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const send = await f.page.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
  assert.ok(send.y >= 0 && send.y + send.height <= 844 - 64, 'Composer remains above the mobile navigation.');
  await f.screenshot('mobile-conversation');
  await f.page.setViewportSize({ width: 320, height: 640 });
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await f.screenshot('mobile-320'); evidence.checks.push('390/320 px real browser geometry, mutually exclusive drawers, visible composer');
});

test('a missing conversation cannot silently create or submit another one', async t => {
  const f = await fixture(t); await f.ready('/chat/missing-synthetic-conversation');
  await f.page.getByText('当前会话不存在或不可读取。请从聊天记录重新选择，或明确新建聊天。', { exact: true }).waitFor();
  await f.page.getByRole('textbox', { name: '输入消息', exact: true }).fill('不得发送');
  assert.equal(await f.page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), true);
  assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0); evidence.checks.push('missing route blocks accidental conversation creation');
});

test('runtime status failure fails closed, and explicit retry restores only the original UI', async t => {
  const f = await fixture(t, { runtimeStatus: 503 });
  await f.page.goto(origin); await f.page.getByText(/聊天运行时状态不可用/).waitFor();
  assert.equal(await f.page.getByRole('button', { name: '提交目标任务', exact: true }).isDisabled(), true);
  f.runtime(200); await f.page.getByRole('button', { name: '重新检查', exact: true }).click();
  await f.page.getByRole('heading', { name: '从一个问题开始' }).waitFor();
  assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0); evidence.checks.push('unavailable runtime blocks sends; read-only explicit retry');
});

test('a disconnected bootstrap disables sending and labels retained configuration as an old snapshot', async t => {
  const f = await fixture(t); await f.ready();
  await f.page.getByRole('textbox', { name: '输入消息', exact: true }).fill('暂不发送');
  assert.equal(await f.page.getByRole('button', { name: '发送消息', exact: true }).isEnabled(), true);
  f.disconnect(); await f.page.locator('.connection-banner').filter({ hasText: '服务已断开' }).waitFor();
  assert.equal(await f.page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), true);
  await f.page.locator('.chat-header').getByRole('button', { name: '插件与连接', exact: true }).click();
  await f.page.getByText('工作空间状态已失效，下方连接器仅为上次快照。', { exact: true }).waitFor();
  await f.page.getByRole('region', { name: '聊天运行时状态' }).getByText('状态不可用', { exact: true }).waitFor();
  assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0);
  evidence.checks.push('disconnected workspace blocks writes and marks stale configuration');
});

test('unconfigured model and viewer role do not present executable chat or Goal controls', async t => {
  for (const options of [{ configured: false }, { role: 'viewer' }]) {
    const f = await fixture(t, options); await f.ready();
    if (options.role !== 'viewer') await f.page.getByRole('textbox', { name: '输入消息', exact: true }).fill('不可执行');
    assert.equal(await f.page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), true);
    assert.equal(await f.page.getByRole('button', { name: '长期目标 · 待验收' }).isDisabled(), true);
    assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0);
  }
  evidence.checks.push('unconfigured model, read-only member, pending Goal scope');
});

test('session expiration removes the workspace and preserves the original login boundary', async t => {
  const f = await fixture(t); await f.ready(); f.session();
  await f.page.getByRole('heading', { name: '会话已失效', exact: true }).waitFor();
  assert.equal(await f.page.locator('.app-shell').count(), 0);
  await f.page.getByRole('button', { name: '使用企业身份继续', exact: true }).waitFor();
  assert.equal(f.requests.filter(value => value.method !== 'GET').length, 0); evidence.checks.push('synthetic 401 hides workspace; existing login UI retained');
});
