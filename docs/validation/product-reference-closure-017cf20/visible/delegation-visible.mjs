// Temporary visual wrapper around the frozen original source test. No repository source writes.
/** Fixed Library inspection → explicit public Muse scope, on original local HTTP.
 * The pre-existing local operator/native-session metadata and reviewed binding
 * flags below are synthetic fixtures. This is not real Host/account acceptance.
 * A disabled provider and blocked external browser requests forbid live execution.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '/workspace/workspace-release-20261013/node_modules/playwright/index.mjs';
import { createApp } from '/workspace/workspace-release-20261013/server/index.mjs';
import { openStore } from '/workspace/workspace-release-20261013/server/store.mjs';

const output = resolve(process.argv[2] || join('evidence', 'library-reference-scope', new Date().toISOString().replace(/[:.]/g, '-')));
await mkdir(output, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceStatus = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
await writeFile(join(output, 'RUN.json'), JSON.stringify({ source, sourceStatus, startedAt: new Date().toISOString(), scope: 'synthetic existing owner/session fixture, original loopback HTTP/Store, production React and actual Chromium' }, null, 2) + '\n', { flag: 'wx' });
const directory = await mkdtemp(join(tmpdir(), 'workspace-library-reference-scope-'));
const actor = { subject: 'local-operator', nativeAgentId: randomUUID() }, checks = [], errors = [], writes = [], blockedHosts = new Set();
const hash = value => createHash('sha256').update(value).digest('hex');
let app, browser, page, base, modelCalls = 0;
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`); return value;
}
async function capture(name) { await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
async function noOverflow(label) { const measured = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })); assert.ok(measured.document <= measured.viewport + 1 && measured.body <= measured.viewport + 1, `${label}: ${JSON.stringify(measured)}`); }
async function waitEnabled(control) { await page.waitForFunction(element => !element.disabled, await control.elementHandle()); }
async function openNativePreparation() {
  const summary = page.locator('.conversation-native > .conversation-task-list > summary');
  if (!await summary.evaluate(element => element.parentElement.open)) await summary.click();
  const prepare = page.getByRole('button', { name: '准备 Muse 委托', exact: true }); await waitEnabled(prepare); await prepare.click();
  const modal = page.getByRole('dialog', { name: '准备原会话 Muse 委托', exact: true }); await modal.waitFor();
  for (const label of ['公开请求正文', '公开产品说明', '市场', '范围与验收要求', '明确截止时间']) assert.equal(await modal.getByLabel(label, { exact: true }).inputValue(), '', `${label} must require explicit input`);
  assert.equal(await modal.getByRole('checkbox').isChecked(), false);
  assert.equal(await modal.getByRole('button', { name: '准备待审原订单', exact: true }).isDisabled(), true);
  assert.equal((app.store.read().workerOrders || []).length, 0); assert.equal((app.store.read().museTasks || []).length, 0);
  return modal;
}
try {
  const seed = await openStore(directory), now = new Date().toISOString();
  await seed.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Synthetic fixed-reference public-scope fixture', status: 'idle', createdAt: now, updatedAt: now })); await seed.close();
  app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { configured: false, kind: 'fixture', complete: async () => { modelCalls++; throw Error('Model calls are forbidden'); } },
    museOriginalBinding: { actor, operators: [actor], expectedHost: 'fixture.test' },
    museWorkerConfig: { workerId: 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1', ownerId: 'synthetic-only-owner', tokenDigest: hash('synthetic-only-local-fixture-not-a-credential'), enabled: true, scopeReviewed: true, externalBudgetVerified: true } });
  const address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  const product = (await request('/library/products', 'POST', { requestId: randomUUID(), name: 'SYNTHETIC_PRIVATE_LIBRARY_PRODUCT', description: 'PRIVATE_PRODUCT_R1', supply: { paymentTerms: 'PRIVATE_LIBRARY_COST_MARKER' } })).product;
  const firstText = 'SYNTHETIC_PRIVATE_DOCUMENT_V1', secondText = 'SYNTHETIC_PRIVATE_DOCUMENT_V2';
  const first = (await request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'private-company-v1.md', content: firstText })).artifact;
  const document = (await request('/library/documents', 'POST', { requestId: randomUUID(), title: 'SYNTHETIC_PRIVATE_COMPANY_DOCUMENT', asset: { artifactId: first.id, version: 1, sha256: first.sha256 } })).document;
  const references = { products: [{ productId: product.id, productRevision: 1 }], documents: [{ documentId: document.id, documentVersion: 1 }] };
  await request(`/conversations/${actor.nativeAgentId}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references });
  await request(`/library/products/${product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, changes: { description: 'PRIVATE_PRODUCT_R2' } });
  const second = (await request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'private-company-v2.md', content: secondText })).artifact;
  await request(`/library/documents/${document.id}/versions`, 'POST', { requestId: randomUUID(), expectedRevision: 1, asset: { artifactId: second.id, version: 1, sha256: second.sha256 } });
  browser = await chromium.launch({ headless: true, chromiumSandbox: process.env.CHROMIUM_NO_SANDBOX !== '1', ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base) return route.continue(); blockedHosts.add(url.hostname); return route.fulfill({ status: 204, body: '' }); });
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  page.on('request', incoming => { const url = new URL(incoming.url()); if (url.origin === base && url.pathname.startsWith('/api/') && incoming.method() !== 'GET') writes.push({ path: url.pathname, method: incoming.method(), body: incoming.postDataJSON() }); });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(`${base}/chat/${actor.nativeAgentId}`); await page.locator('.app-shell[aria-busy="false"]').waitFor();
    await page.getByRole('button', { name: '会话资料 · 1 个产品 / 1 份文件', exact: true }).click();
    const selectedDocument = page.locator('.bl-selected-reference').filter({ hasText: document.title }); await selectedDocument.waitFor(); await selectedDocument.locator('button').first().click();
    await page.locator('.bl-picker-detail pre').filter({ hasText: firstText }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '会话固定资料版本', exact: true }).inputValue(), '1');
    const download = await page.locator('.bl-picker-detail .bl-download').getAttribute('href'); assert.equal(download, `/api/artifacts/${first.id}/download?version=1`);
    const bytes = Buffer.from(await (await fetch(new URL(download, base))).arrayBuffer()); assert.equal(bytes.toString('utf8'), firstText); assert.equal(hash(bytes), first.sha256);
    assert.equal(await page.getByRole('button', { name: '保存关联并返回会话', exact: true }).isDisabled(), true);
    await noOverflow(`fixed document ${width}`); await capture(`01-fixed-document-v1-${width}`);
    await page.getByRole('button', { name: '返回选择列表', exact: true }).click();
    await page.locator('.bl-selected-reference').filter({ hasText: product.name }).locator('button').first().click();
    await page.getByRole('button', { name: '选择此产品修订 2', exact: true }).waitFor();
    assert.match(await page.locator('.bl-picker-detail [role="status"]').innerText(), /当前展示产品修订 2；会话仍引用修订 1。重新选择才会更新引用/);
    await noOverflow(`current product context ${width}`); await capture(`02-product-current-r2-pinned-r1-${width}`);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click(); await page.locator('.bl-picker').waitFor({ state: 'detached' });
    assert.equal(writes.length, 0, 'inspection cannot rebind, send or prepare');
    const modal = await openNativePreparation(); await noOverflow(`blank public scope ${width}`); await capture(`03-explicit-public-scope-blank-${width}`);
    if (width === 320) { await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click(); continue; }
    for (const [label, value] of [['公开请求正文', 'Public protocol fixture request only.'], ['公开产品说明', 'Human-entered public example product.'], ['市场', 'US'], ['范围与验收要求', 'Synthetic read-only research scope; no contact, publishing or payment.'], ['明确截止时间', new Date(Date.now() + 86400000).toISOString().slice(0, 16)]]) await modal.getByLabel(label, { exact: true }).fill(value);
    const confirmation = modal.getByRole('checkbox'), submit = modal.getByRole('button', { name: '准备待审原订单', exact: true });
    assert.equal(await submit.isDisabled(), true); await confirmation.check();
    await modal.getByLabel('市场', { exact: true }).fill('United States'); assert.equal(await confirmation.isChecked(), false); assert.equal(await submit.isDisabled(), true, 'changed public scope requires fresh confirmation');
    await confirmation.check(); await waitEnabled(submit); await capture('04-human-confirmed-public-scope-390'); await submit.click(); await modal.waitFor({ state: 'detached' });
  }
  const delegations = (await request(`/conversations/${actor.nativeAgentId}/muse-delegations`)).delegations;
  assert.equal(delegations.length, 1); assert.equal(delegations[0].phase, 'review_required'); assert.equal(delegations[0].taskRef, null);
  const prepareBody = writes[0]?.body; assert.equal(writes.length, 1); assert.equal(writes[0].path, `/api/conversations/${actor.nativeAgentId}/muse-delegations`);
  assert.equal(prepareBody.order.publicDataConfirmed, true);
  assert.equal(prepareBody.order.product, 'Human-entered public example product.'); assert.equal(prepareBody.order.market, 'United States');
  const serialized = JSON.stringify(prepareBody);
  for (const privateValue of ['PRIVATE_LIBRARY_COST_MARKER', firstText, secondText, product.name, document.title, product.id, document.id, first.id, second.id]) assert.ok(!serialized.includes(privateValue), `Private Library value is not public authorization: ${privateValue}`);
  assert.equal((app.store.read().workerOrders || []).length, 1); assert.equal((app.store.read().museTasks || []).length, 0); assert.equal((app.store.read().runs || []).length, 0);
  const saved = (await request(`/conversations/${actor.nativeAgentId}/library-references`)).libraryReferences; assert.deepEqual(saved.products, references.products); assert.deepEqual(saved.documents, references.documents);
  const order = page.locator(`[data-order-id="${delegations[0].orderId}"]`); await order.locator('summary').first().click(); await order.getByRole('button', { name: '审阅并批准范围', exact: true }).waitFor();
  await noOverflow('prepared original order mobile'); await capture('05-original-order-awaiting-review-390');
  checks.push('320/390 px selected document v1 inspection previews/downloads exact original bytes and SHA after a new v2 exists.', 'Current product r2 inspection identifies its still-pinned r1 and requires explicit reselection; inspection causes zero writes.', 'The original Muse preparation opens only by explicit user action with blank public facts and unchecked consent; Library values are never prefilled.', 'Human-entered public scope requires fresh confirmation after edits and prepares exactly one review-required original order, with no task dispatch, run or model call.', 'Private names, costs, document bytes and reference IDs are absent from the exact prepare request; fixed Library references remain unchanged.');
  assert.equal(modelCalls, 0); assert.deepEqual(errors, []);
  // Additional read-only visual capture of the same persisted pending order.
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${base}/chat/${actor.nativeAgentId}`); await page.locator('.app-shell[aria-busy="false"]').waitFor();
    const nativeSummary = page.locator('.conversation-native > .conversation-task-list > summary');
    if (!await nativeSummary.evaluate(element => element.parentElement.open)) await nativeSummary.click();
    const currentOrder = page.locator(`[data-order-id="${delegations[0].orderId}"]`);
    const currentSummary = currentOrder.locator('summary').first();
    if (!await currentSummary.evaluate(element => element.parentElement.open)) await currentSummary.click();
    await currentOrder.getByRole('button', { name: '审阅并批准范围', exact: true }).waitFor();
    await currentOrder.scrollIntoViewIfNeeded(); await noOverflow(`pending delegation ${width}`); await capture(`06-pending-delegation-${width}`);
  }
  assert.equal(writes.length, 1); assert.equal((app.store.read().museTasks || []).length, 0); assert.equal(modelCalls, 0); assert.deepEqual(errors, []);
  const evidence = { result: 'passed', source, sourceStatus, actualBrowser: true, browserVersion: browser.version(), checkCount: checks.length, checks, modelCalls, pageErrors: errors, browserWrites: writes, fixedDocument: { version: 1, artifactId: first.id, sha256: first.sha256 }, prepared: { orderId: delegations[0].orderId, phase: delegations[0].phase, taskRef: delegations[0].taskRef }, externalHostsBlocked: [...blockedHosts], boundary: 'Synthetic pre-existing local operator/native-session metadata and reviewed config flags. Original production HTTP/binding/Store code is exercised locally; real Host/identity/native execution is unverified.' };
  await writeFile(join(output, 'VERIFICATION.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await capture('FAILURE').catch(() => {});
  await writeFile(join(output, 'FAILURE.json'), JSON.stringify({ result: 'failed', source, sourceStatus, modelCalls, errors, writes, error: error.stack, bodyText: page && !page.isClosed() ? await page.locator('body').innerText().catch(() => '') : '' }, null, 2) + '\n', { flag: 'wx' }); throw error;
} finally { await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
