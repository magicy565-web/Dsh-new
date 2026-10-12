import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

// Real local Chromium, original app/API/Store and synthetic buyer binding.
// No real account, model, Muse Connector, purchase or production endpoint.
const directory = await fs.mkdtemp('/tmp/workspace-procurement-browser-');
const token = 'synthetic-procurement-browser-buyer-0123456789';
let modelCalls = 0, browser;
const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {},
  provider: { kind: 'fixture', configured: false, complete() { modelCalls++; assert.fail('Procurement must not execute a model'); } },
  sourcingMcpConfig: { enabled: true, principals: [{ tokenDigest: createHash('sha256').update(token).digest('hex'), subject: 'external-browser-fixture-buyer', workspaceId: 'local' }] } });
const { port } = await app.listen(0), base = `http://127.0.0.1:${port}`;
const destination = 'docs/validation/procurement-main/browser', requestId = () => ({ requestId: randomUUID() });
const errors = [], checks = [];
async function http(route, method = 'GET', body, headers = {}) {
  const response = await fetch(base + route, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
async function mcp(name, args = {}) {
  const result = await http('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { Authorization: 'Bearer ' + token });
  assert.ok(result.result?.structuredContent && !result.result.structuredContent.error, JSON.stringify(result)); return result.result.structuredContent;
}
async function expand(page) {
  const outer = page.locator('.conversation-procurement > details');
  if (!await outer.evaluate(element => element.open)) await outer.locator(':scope > summary').click();
  const inner = page.locator('.conversation-procurement [data-inquiry-id]');
  if (!await inner.evaluate(element => element.open)) await inner.locator(':scope > summary').click();
}
try {
  await fs.mkdir(destination, { recursive: true });
  const main = (await http('/api/conversations', 'POST', { title: '原主会话 · 指定商家采购回复验收' })).conversation;
  assert.equal(main.createdBy, 'local-operator'); assert.equal(main.subject, undefined);
  const skuId = randomUUID(), product = (await http('/api/library/products', 'POST', { ...requestId(), name: '本地验收产品', skus: [{ id: skuId, code: 'P-FIXTURE' }] })).product;
  let supplier = (await http('/api/supply/suppliers', 'POST', { ...requestId(), displayName: '指定企业 · 本地 fixture', country: 'China' })).supplier;
  supplier = (await http(`/api/supply/suppliers/${supplier.id}/merchant`, 'POST', { ...requestId(), expectedRevision: supplier.revision, merchantSubject: 'local-operator', confirmed: true })).supplier;
  await http(`/api/supply/suppliers/${supplier.id}/publish`, 'POST', { ...requestId(), expectedRevision: supplier.revision, confirmed: true });
  let listing = (await http('/api/supply/listings', 'POST', { ...requestId(), supplierId: supplier.id, title: '已确认供货资料 · fixture', sku: 'S-FIXTURE', unitPrice: '1.50', currency: 'USD', moq: 1, leadDays: 7, incoterm: 'FOB' })).listing;
  listing = (await http(`/api/supply/listings/${listing.id}/product`, 'POST', { ...requestId(), expectedRevision: listing.revision, productId: product.id, expectedProductRevision: product.revision, skuId, confirmed: true })).listing;
  await http(`/api/supply/listings/${listing.id}/publish`, 'POST', { ...requestId(), expectedRevision: listing.revision, confirmed: true });
  const draft = (await mcp('workspace_procurement_draft', { ...requestId(), listingId: listing.id, quantity: 10, destination: 'US', notes: '本地采购 fixture：请确认交期；未经确认保持私有。' })).inquiry;
  assert.equal((await http('/api/supply/inquiries')).inquiries.length, 0);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/chat/' + encodeURIComponent(main.id));
  await page.waitForFunction(() => document.querySelector('[aria-busy="false"]'));
  assert.equal(await page.locator('.conversation-procurement').count(), 0);
  assert.equal(await page.locator('.control-spirit').count(), 1);
  checks.push('Actual buyer MCP draft remains private; original mobile main conversation and companion retained');
  const reviewed = await mcp('workspace_procurement_review', { inquiryId: draft.id });
  await mcp('workspace_procurement_share', { ...requestId(), inquiryId: draft.id, expectedRevision: draft.revision, expectedReviewHash: reviewed.reviewHash, confirmed: true });
  await page.reload(); await page.locator('.conversation-procurement').waitFor(); await expand(page);
  await page.getByRole('button', { name: '关联到本会话', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '确认关联本会话', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await expand(page); await page.getByRole('button', { name: '回复原采购方', exact: true }).waitFor();
  await page.screenshot({ path: `${destination}/mobile-confirmed-share.png`, fullPage: true });
  checks.push('Explicit buyer share and browser confirmation bind to HTTP-created main without fabricated ownership');
  await page.getByRole('button', { name: '回复原采购方', exact: true }).click(); dialog = page.getByRole('dialog');
  const replyText = '商家本地验收回复：交期需进一步确认。此为 fixture，未联系真实采购方。';
  await dialog.getByRole('textbox', { name: '给原采购方的回复' }).fill(replyText);
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '确认提交原回复', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const result = (await mcp('workspace_procurement_get', { inquiryId: draft.id })).inquiry;
  assert.equal(result.status, 'replied'); assert.equal(result.replies.length, 1); assert.equal(result.replies[0].content, replyText);
  await page.reload(); await page.locator('.conversation-procurement').waitFor(); await expand(page);
  await page.locator('.conversation-procurement').getByText(replyText, { exact: true }).waitFor();
  const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(geometry.scroll <= geometry.viewport + 1, JSON.stringify(geometry));
  await page.screenshot({ path: `${destination}/mobile-reply-reloaded.png`, fullPage: true });
  await page.locator('.conversation-procurement').getByText(replyText, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${destination}/mobile-current-inquiry.png`, fullPage: true });
  checks.push('Browser reply → original Store → buyer MCP result/status; reload preserves one reply at 390px');
  assert.equal(app.store.read().messages.filter(message => message.source === 'procurement').length, 2);
  assert.equal(app.store.read().runs.length, 0); assert.equal(app.store.read().workerOrders?.length || 0, 0); assert.equal(modelCalls, 0); assert.deepEqual(errors, []);
  const evidence = { result: 'passed', evidenceKind: 'actual-chromium-original-http-local-procurement-fixture', actualBrowser: true, chromium: browser.version(), checks, consoleErrors: errors,
    screenshots: ['mobile-confirmed-share.png', 'mobile-reply-reloaded.png', 'mobile-current-inquiry.png'], modelCalls, liveBuyer: false, liveMuse: false, wechatDevice: false, independentSecurityAudit: false };
  await fs.writeFile(`${destination}/acceptance.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
