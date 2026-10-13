/** Current conversation / Library browser acceptance using the original HTTP host.
 * Synthetic local data only. No provider call, dispatch, public publication or
 * authenticated native/production acceptance is claimed by this driver.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const output = resolve(process.argv[2] || join('evidence', 'conversation-library', new Date().toISOString().replace(/[:.]/g, '-')));
await mkdir(output, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceStatus = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
await writeFile(join(output, 'RUN.json'), JSON.stringify({ source, sourceStatus, startedAt: new Date().toISOString(), scope: 'synthetic original loopback HTTP / production React / actual Chromium' }, null, 2) + '\n', { flag: 'wx' });
const directory = await mkdtemp(join(tmpdir(), 'workspace-conversation-library-browser-'));
let modelCalls = 0;
const options = { dataDirectory: directory, capabilityEnvironment: {}, provider: { configured: false, kind: 'fixture', provider: 'disabled-browser-fixture', complete: async () => { modelCalls++; throw Error('Provider calls are forbidden in this browser driver'); } } };
let app, browser, page, base, viewerSession = false;
const checks = [], errors = [], requests = [], emptyLayoutMeasurements = [], blockedExternalHosts = new Set();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
async function ready() { await page.locator('.app-shell[aria-busy="false"]').waitFor(); }
async function capture(name) { await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
async function noOverflow(label) {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(geometry.document <= geometry.viewport + 1 && geometry.body <= geometry.viewport + 1, `${label}: ${JSON.stringify(geometry)}`);
}
async function readableEmptyConversation(label) {
  const measured = await page.locator('.message-scroll.is-empty').evaluate(scroll => {
    const welcome = scroll.querySelector('.welcome-conversation'), native = scroll.querySelector('.conversation-native'), summary = native?.querySelector('.conversation-task-list > summary');
    assertPresent(welcome, 'welcome'); assertPresent(native, 'native controls'); assertPresent(summary, 'native summary');
    function assertPresent(element, name) { if (!element) throw Error(`Missing empty conversation ${name}`); }
    const css = getComputedStyle(scroll), summaryCSS = getComputedStyle(summary), range = document.createRange(); range.selectNodeContents(summary);
    const box = element => element.getBoundingClientRect().toJSON();
    return { viewport: innerWidth, viewportHeight: innerHeight, direction: css.flexDirection, alignItems: css.alignItems, availableWidth: scroll.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), scrollClientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight, scroll: box(scroll), welcome: box(welcome), native: box(native), summary: { text: summary.textContent, box: box(summary), lineHeight: parseFloat(summaryCSS.lineHeight), lineRects: [...range.getClientRects()].map(rect => rect.toJSON()) } };
  });
  emptyLayoutMeasurements.push({ label, ...measured });
  assert.equal(measured.direction, 'column', `${label}: original empty conversation siblings stack vertically`);
  assert.equal(measured.alignItems, 'stretch', `${label}: original task controls use the available width`);
  assert.ok(measured.native.width >= measured.availableWidth - 1, `${label}: native controls ${measured.native.width} px / available ${measured.availableWidth} px`);
  assert.ok(measured.summary.box.width >= Math.min(180, measured.availableWidth - 2), `${label}: native summary has readable width`);
  assert.equal(measured.summary.lineRects.length, 1, `${label}: original delegation summary is one readable text line`);
  assert.ok(measured.summary.lineRects[0].height <= measured.summary.lineHeight + 1, `${label}: summary text is not vertically wrapped`);
  assert.ok(measured.native.top >= measured.welcome.bottom - 1, `${label}: task controls follow the welcome content`);
}
async function accessibleEmptyScroll(label) {
  const scroll = page.locator('.message-scroll.is-empty');
  await scroll.evaluate(element => { element.scrollTo({ top: 0, behavior: 'instant' }); });
  const top = await scroll.evaluate(element => ({ scrollTop: element.scrollTop, scroll: element.getBoundingClientRect().toJSON(), welcome: element.querySelector('.welcome-conversation').getBoundingClientRect().toJSON() }));
  assert.equal(top.scrollTop, 0, `${label}: beginning of the original empty view is reachable`);
  assert.ok(top.welcome.top >= top.scroll.top - 1 && top.welcome.top < top.scroll.bottom, `${label}: welcome begins inside the scroll viewport`);
  await capture(`03a-empty-welcome-${label}`);
  await scroll.evaluate(element => { element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }); });
  await page.waitForFunction(() => { const element = document.querySelector('.message-scroll.is-empty'); return Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1; });
  const bottom = await scroll.evaluate(element => ({ scroll: element.getBoundingClientRect().toJSON(), summary: element.querySelector('.conversation-native .conversation-task-list > summary').getBoundingClientRect().toJSON(), scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  assert.ok(bottom.scrollHeight > bottom.clientHeight, `${label}: short-screen content uses the original vertical scroller`);
  assert.ok(bottom.summary.top >= bottom.scroll.top - 1 && bottom.summary.bottom <= bottom.scroll.bottom + 1, `${label}: original delegation summary is fully reachable at the bottom`);
  emptyLayoutMeasurements.push({ label: `scroll-${label}`, top, bottom });
  await capture(`03b-empty-delegation-${label}`);
}
async function openGroup(label) {
  const summary = page.locator('summary').filter({ hasText: label }).first();
  if (!await summary.evaluate(element => element.parentElement.open)) await summary.click();
}
async function openLibraryTab(label) {
  const tabs = page.locator('.business-library .bl-tabs');
  // Current detail screens expose their original back control; category tabs
  // are deliberately shown on the list screen, so follow the reachable UI.
  if (!await tabs.isVisible()) await page.locator('.business-library .bl-back').click();
  await tabs.getByRole('button', { name: label, exact: true }).click();
}
async function documentDownload(document, version, expectedText) {
  const selected = document.versions.find(item => item.version === version);
  assert.ok(selected, `Document v${version} exists`);
  const href = await page.getByRole('link', { name: '下载此版本', exact: true }).getAttribute('href');
  assert.equal(href, `/api/artifacts/${encodeURIComponent(selected.asset.artifactId)}/download?version=${selected.asset.version}`);
  const response = await fetch(new URL(href, base)); assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('utf8'), expectedText); assert.equal(sha(bytes), selected.asset.sha256);
  return { documentVersion: version, artifactId: selected.asset.artifactId, artifactVersion: selected.asset.version, sha256: sha(bytes), byteLength: bytes.length };
}

try {
  app = await createApp(options); let address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, chromiumSandbox: process.env.CHROMIUM_NO_SANDBOX !== '1', ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => {
    const incoming = route.request(), url = new URL(incoming.url());
    if (url.origin !== base) { blockedExternalHosts.add(url.hostname); await route.fulfill({ status: 204, body: '' }); return; }
    if (viewerSession && url.pathname === '/api/session') {
      const response = await route.fetch(), original = await response.json();
      // UI-only viewer DTO, over the real local response. This does not claim
      // that local no-login mode proves actual enterprise authorization.
      await route.fulfill({ response, json: { ...original, mode: 'enterprise', authenticated: true, user: { id: 'synthetic-browser-viewer', role: 'viewer' } } }); return;
    }
    await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', incoming => { const url = new URL(incoming.url()); if (url.origin === base && url.pathname.startsWith('/api/')) requests.push({ path: url.pathname + url.search, method: incoming.method() }); });

  await page.goto(base); await ready(); await page.getByRole('textbox', { name: '输入消息', exact: true }).waitFor();
  assert.equal(await page.locator('.conversation-spirit .control-spirit-stage').count(), 1);
  assert.equal(await page.locator('.master-control').count(), 0);
  assert.equal(requests.filter(item => item.method !== 'GET').length, 0);
  assert.equal(app.store.read().conversations.length, 0); assert.equal(app.store.read().runs.length, 0);
  await noOverflow('empty desktop entry'); await capture('01-conversation-desktop');
  checks.push('Current empty entry renders one original conversation and companion without creating a run or conversation.');

  const earlier = (await request('/conversations', 'POST', { title: 'Earlier synthetic conversation' })).conversation;
  const conversation = (await request('/conversations', 'POST', { title: 'Current synthetic conversation' })).conversation;
  await page.goto(base); await ready(); await page.waitForURL(`${base}/chat/${encodeURIComponent(conversation.id)}`);
  assert.equal(await page.locator('.chat-title-pill span').innerText(), conversation.title);
  assert.equal(app.store.read().conversations.length, 2); assert.equal(app.store.read().runs.length, 0);
  await readableEmptyConversation('desktop-1440');
  await page.locator('.chat-title-pill').click(); await page.locator('.conversation-sidebar').waitFor();
  assert.equal(await page.locator('.assistant-panel').isVisible(), true, '1440 px retains the original desktop assistant alongside its conversation sidebar');
  await noOverflow('desktop conversation sidebar'); await capture('01b-conversation-desktop-sidebar');
  await page.getByRole('button', { name: '收起聊天列表', exact: true }).click();
  checks.push('Current entry selects the actual newest stored conversation without duplicating or executing it.');

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(base); await ready();
    await readableEmptyConversation(`empty-${width}`);
    await page.locator('.chat-title-pill').click(); await page.locator('.conversation-sidebar').waitFor();
    assert.equal(await page.locator('.assistant-panel').count(), 0);
    await noOverflow(`conversation drawer ${width}`); await capture(`02-conversation-drawer-${width}`);
    await page.getByRole('button', { name: '收起聊天列表', exact: true }).click();
    await page.getByRole('button', { name: '打开助手面板', exact: true }).click(); await page.locator('.assistant-panel').waitFor();
    assert.equal(await page.locator('.conversation-sidebar').count(), 0); await noOverflow(`assistant drawer ${width}`);
    await capture(`02b-assistant-drawer-${width}`);
    await page.getByRole('button', { name: '收起助手面板', exact: true }).click();
    assert.equal(await page.locator('.assistant-panel').count(), 0, `${width} px drawer closes`);
    await noOverflow(`conversation entry ${width}`); await capture(`03-conversation-mobile-${width}`);
  }
  checks.push('320, 390 and 768 px real-browser entry and both exclusive drawers open visibly, close and fit the viewport; desktop retains its original sidebar behavior.');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 600 }); await page.goto(base); await ready();
    await readableEmptyConversation(`short-${width}`); await accessibleEmptyScroll(`${width}-600`); await noOverflow(`empty short screen ${width}`);
  }
  checks.push('Original empty conversation welcome and native controls stack at full readable width with one summary text line; 320/390 px screens at 600 px height can scroll to both welcome and delegation controls.');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole('button', { name: '资料库', exact: true }).click(); await page.getByRole('button', { name: '产品库', exact: true }).click();
  await page.getByRole('button', { name: '新建产品', exact: true }).click();
  await page.getByRole('textbox', { name: '产品名称', exact: true }).fill('Synthetic Library Product');
  await page.getByRole('textbox', { name: '产品简介', exact: true }).fill('Saved only as an internal enterprise draft.');
  await page.getByRole('button', { name: '添加 SKU', exact: true }).click();
  await page.getByRole('textbox', { name: 'SKU 1 编码', exact: true }).fill('BROWSER-1');
  await page.getByRole('textbox', { name: 'SKU 1 单位', exact: true }).fill('piece');
  await page.getByRole('spinbutton', { name: 'SKU 1 MOQ', exact: true }).fill('10');
  await openGroup('内部报价'); await page.getByRole('combobox', { name: 'SKU 1 报价方式', exact: true }).selectOption('tiered');
  await page.getByRole('button', { name: '添加价格阶梯', exact: true }).click();
  await page.getByRole('textbox', { name: 'SKU 1 阶梯 1 单价', exact: true }).fill('2.40');
  await page.getByRole('textbox', { name: 'SKU 1 阶梯 1 币种', exact: true }).fill('USD');
  await openGroup('供货条件'); await page.getByRole('textbox', { name: '付款条件', exact: true }).fill('SYNTHETIC_INTERNAL_PAYMENT');
  await noOverflow('mobile product editor'); await capture('04-product-editor-mobile');
  await page.getByRole('button', { name: '保存产品', exact: true }).click(); await page.getByRole('button', { name: '编辑产品', exact: true }).waitFor();
  let product = (await request('/library/products')).items[0]; assert.equal(product.name, 'Synthetic Library Product');
  assert.equal(product.revision, 1); assert.equal(product.status, 'draft'); assert.equal(product.skus[0].priceTiers[0].unitPrice, '2.40');
  assert.equal(product.supply.paymentTerms, 'SYNTHETIC_INTERNAL_PAYMENT'); assert.equal(Object.hasOwn(product, 'published'), false);
  assert.deepEqual((await request('/supply/public')).items, []); assert.equal(app.store.read().runs.length, 0);
  await noOverflow('mobile product detail'); await capture('05-product-detail-mobile');
  checks.push('Reachable Products UI saves exact SKU/pricing/private policy facts as one original internal draft with no public listing or run.');

  await page.getByRole('button', { name: '编辑产品', exact: true }).click();
  await page.getByRole('textbox', { name: '产品简介', exact: true }).fill('Unsaved synthetic edit retained by navigation guard.');
  await page.getByRole('button', { name: '目标', exact: true }).click(); await page.getByRole('dialog', { name: '离开未保存的内容' }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '产品简介', exact: true }).inputValue(), 'Unsaved synthetic edit retained by navigation guard.');
  await page.getByRole('button', { name: '保存产品', exact: true }).click(); await page.getByRole('button', { name: '编辑产品', exact: true }).waitFor();
  product = (await request(`/library/products/${product.id}`)).product; assert.equal(product.revision, 2);
  checks.push('Original unsaved-navigation guard retains the typed product edit and saves its exact next revision.');

  await openLibraryTab('企业资料'); await page.getByRole('button', { name: '上传资料', exact: true }).click();
  const firstText = 'SYNTHETIC_DOCUMENT_V1\nOriginal fixed company file.\n';
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('Synthetic Company Specification');
  await page.getByRole('combobox', { name: '资料分类', exact: true }).selectOption('specification');
  await page.getByRole('textbox', { name: '资料标签', exact: true }).fill('browser, synthetic');
  await page.getByLabel('上传文件', { exact: true }).setInputFiles({ name: 'synthetic-specification.md', mimeType: 'text/markdown', buffer: Buffer.from(firstText) });
  await page.getByRole('button', { name: '保存资料', exact: true }).click(); await page.getByRole('heading', { name: 'Synthetic Company Specification', exact: true }).waitFor();
  await page.locator('.bl-preview pre').filter({ hasText: 'SYNTHETIC_DOCUMENT_V1' }).waitFor();
  let document = (await request('/library/documents')).items[0]; assert.equal(document.currentVersion, 1);
  const firstDownload = await documentDownload(document, 1, firstText); await noOverflow('document detail mobile'); await capture('06-document-v1-mobile');
  checks.push('Reachable Company UI uploads one real synthetic file, renders its content and downloads exact v1 bytes matching the stored SHA-256.');

  await openLibraryTab('产品库'); await page.getByRole('button', { name: /Synthetic Library Product/ }).click();
  await page.getByRole('button', { name: '编辑产品', exact: true }).click(); await openGroup('关联企业资料');
  await page.getByRole('combobox', { name: '选择企业资料', exact: true }).selectOption(document.id);
  await page.getByRole('combobox', { name: '固定资料版本', exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: '关联用途', exact: true }).fill('Pin original browser fixture specification');
  await page.getByRole('button', { name: '关联此版本', exact: true }).click(); await page.getByRole('button', { name: '保存产品', exact: true }).click();
  await page.getByRole('button', { name: '编辑产品', exact: true }).waitFor();
  product = (await request(`/library/products/${product.id}`)).product; assert.equal(product.revision, 3);
  assert.deepEqual(product.documents, [{ documentId: document.id, documentVersion: 1, purpose: 'Pin original browser fixture specification' }]);
  checks.push('Original product editor explicitly pins the exact company document v1 and its purpose.');

  await openLibraryTab('企业资料'); await page.getByRole('button', { name: /Synthetic Company Specification/ }).click();
  await page.getByRole('button', { name: '添加新版本', exact: true }).click();
  const secondText = 'SYNTHETIC_DOCUMENT_V2\nA distinct company file revision.\n';
  await page.getByLabel('上传文件', { exact: true }).setInputFiles({ name: 'synthetic-specification-v2.md', mimeType: 'text/markdown', buffer: Buffer.from(secondText) });
  await page.getByRole('button', { name: '保存新版本', exact: true }).click(); await page.getByRole('combobox', { name: '资料版本', exact: true }).waitFor();
  await page.locator('.bl-preview pre').filter({ hasText: 'SYNTHETIC_DOCUMENT_V2' }).waitFor();
  document = (await request(`/library/documents/${document.id}`)).document; assert.equal(document.currentVersion, 2); assert.equal(document.versions.length, 2);
  const secondDownload = await documentDownload(document, 2, secondText);
  await page.getByRole('combobox', { name: '资料版本', exact: true }).selectOption('1'); await page.locator('.bl-preview pre').filter({ hasText: 'SYNTHETIC_DOCUMENT_V1' }).waitFor();
  assert.deepEqual(await documentDownload(document, 1, firstText), firstDownload); await capture('07-document-historical-v1-mobile');
  await openLibraryTab('产品库'); await page.getByRole('button', { name: /Synthetic Library Product/ }).click();
  await page.getByText('当前企业资料为 v2，此产品继续固定 v1。', { exact: true }).waitFor();
  await openGroup('预览与下载关联文件'); await page.locator('.bl-document-pin .bl-preview pre').filter({ hasText: 'SYNTHETIC_DOCUMENT_V1' }).waitFor();
  assert.deepEqual(await documentDownload(document, 1, firstText), firstDownload); await noOverflow('fixed product document mobile'); await capture('08-product-pinned-v1-mobile');
  checks.push('New document v2 preserves historical v1 download/content/SHA and the original product continues to use its fixed v1 association.');

  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.locator('.chat-title-pill').click();
  await page.locator('.conversation-select').filter({ hasText: conversation.title }).click();
  await page.waitForURL(`${base}/chat/${conversation.id}`);
  await page.getByRole('button', { name: '选择产品或资料', exact: true }).click();
  await page.locator('.bl-picker .bl-row').filter({ hasText: product.name }).click();
  await page.getByRole('button', { name: `选择此产品修订 ${product.revision}`, exact: true }).click();
  await page.getByRole('button', { name: '企业资料', exact: true }).click();
  await page.locator('.bl-picker .bl-row').filter({ hasText: document.title }).click();
  await page.getByRole('combobox', { name: '会话固定资料版本', exact: true }).selectOption('1');
  await page.getByRole('button', { name: '选择此资料版本 v1', exact: true }).click();
  await noOverflow('mobile original resource picker'); await capture('09-conversation-reference-picker-mobile');
  await page.getByRole('button', { name: '保存关联并返回会话', exact: true }).click(); await page.locator('.bl-picker').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('.chat-library-chip').length === 2);
  const references = (await request(`/conversations/${conversation.id}/library-references`)).libraryReferences;
  assert.deepEqual(references.products, [{ productId: product.id, productRevision: 3 }]);
  assert.deepEqual(references.documents, [{ documentId: document.id, documentVersion: 1 }]);
  assert.deepEqual((await request(`/conversations/${earlier.id}/library-references`)).libraryReferences, { conversationId: earlier.id, revision: 0, products: [], documents: [], updatedAt: null });
  assert.equal(requests.filter(item => /\/messages$|\/dispatch$|\/delegate$/.test(item.path)).length, 0);
  await capture('10-conversation-fixed-references-mobile');
  checks.push('Current conversation picker persists exact product r3/document v1 only to its selected conversation without sending, dispatching or selecting unrelated conversation data.');

  await page.goto('about:blank'); await app.close(); app = await createApp(options); address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  await page.goto(base); await ready(); await page.waitForURL(`${base}/chat/${conversation.id}`); await page.waitForFunction(() => document.querySelectorAll('.chat-library-chip').length === 2);
  assert.deepEqual((await request(`/conversations/${conversation.id}/library-references`)).libraryReferences, references);
  assert.equal((await request(`/library/products/${product.id}`)).product.revision, 3);
  assert.equal((await request(`/library/documents/${document.id}`)).document.currentVersion, 2);
  assert.equal(app.store.read().conversations.length, 2); assert.equal(app.store.read().runs.length, 0);
  checks.push('Actual host/Store restart plus browser reentry restores exact pinned references and original product/document revisions.');

  viewerSession = true; const writesBeforeViewer = requests.filter(item => item.method !== 'GET').length;
  await page.goto(`${base}/library/products/${product.id}/edit`); await ready(); await page.getByRole('button', { name: '编辑产品', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '编辑产品', exact: true }).isDisabled(), true); assert.equal(await page.locator('.bl-editor').count(), 0);
  await page.goto(`${base}/library/company/documents/${document.id}`); await ready();
  assert.equal(await page.getByRole('button', { name: '编辑资料信息', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '添加新版本', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '审核此版本', exact: true }).count(), 0);
  await page.getByRole('combobox', { name: '资料版本', exact: true }).selectOption('1'); await page.locator('.bl-preview pre').filter({ hasText: 'SYNTHETIC_DOCUMENT_V1' }).waitFor();
  await documentDownload(document, 1, firstText); await noOverflow('viewer document mobile'); await capture('11-viewer-document-mobile');
  assert.equal(requests.filter(item => item.method !== 'GET').length, writesBeforeViewer);
  checks.push('Synthetic viewer session DTO retains file-version read/download and disables product/document writes and admin review; this checks UI only, not enterprise authorization.');

  viewerSession = false;
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}/library/products`); await ready(); await page.locator('.bl-product-row').waitFor(); await noOverflow(`product list ${width}`);
    await capture(`12-products-${width}`);
    await page.goto(`${base}/library/company`); await ready(); await page.locator('.ys-document-row').waitFor(); await noOverflow(`document list ${width}`); await capture(`13-company-${width}`);
  }
  checks.push('Original product/document lists fit 320, 390 and 1440 px in actual Chromium.');
  assert.equal(modelCalls, 0); assert.equal(app.store.read().runs.length, 0); assert.deepEqual(errors, []);
  const evidence = { result: 'passed', source, sourceStatus, actualBrowser: true, browserVersion: browser.version(), checks, checkCount: checks.length, errors, modelCalls, emptyLayoutMeasurements, providerConfigured: false, noExternalExecution: true, externalHostsBlocked: [...blockedExternalHosts], storage: app.store.diagnostics().durability, documentDownloads: [firstDownload, secondDownload], productRevision: product.revision, documentCurrentVersion: document.currentVersion, requestCount: requests.length, browserWrites: requests.filter(item => item.method !== 'GET'), boundaries: ['Loopback HTTP, original persisted Workspace Store and current production React bundle.', 'Viewer behavior uses a synthetic browser session DTO; actual signed-session authorization is outside this driver.', 'No real account, model, native host, Shopify/GA4/WeChat or deployment acceptance.'] };
  await writeFile(join(output, 'VERIFICATION.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await capture('FAILURE').catch(() => {});
  const uiState = page && !page.isClosed() ? await page.evaluate(() => {
    const panel = document.querySelector('.assistant-panel');
    return { path: location.pathname, viewport: innerWidth, shell: document.querySelector('.app-shell')?.className, panelMounted: !!panel, panelDisplay: panel ? getComputedStyle(panel).display : null, panelBounds: panel?.getBoundingClientRect().toJSON(), bodyText: document.body.innerText.slice(0, 2000) };
  }).catch(() => null) : null;
  await writeFile(join(output, 'FAILURE.json'), JSON.stringify({ result: 'failed', source, sourceStatus, checks, errors, modelCalls, emptyLayoutMeasurements, error: error.stack, uiState, requests }, null, 2) + '\n', { flag: 'wx' });
  throw error;
} finally {
  await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true });
}
