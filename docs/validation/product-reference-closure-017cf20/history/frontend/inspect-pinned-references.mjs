import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '/workspace/workspace-release-20261013/node_modules/playwright/index.mjs';
import { createApp } from '/workspace/workspace-release-20261013/server/index.mjs';
const output = '/tmp/workspace-launch-20261013/product-closure-3f84eb0/frontend';
const directory = await mkdtemp(join(tmpdir(), 'workspace-pinned-reference-before-'));
let app, browser, modelCalls = 0, base;
const observations = [], writes = [];
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
}
try {
  app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { configured: false, complete: async () => { modelCalls++; throw Error('No model calls'); } } });
  const address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  const conversation = (await request('/conversations', 'POST', { title: 'Pinned reference inspection fixture' })).conversation;
  const product = (await request('/library/products', 'POST', { requestId: randomUUID(), name: 'Pinned Product', description: 'SYNTHETIC_PRODUCT_R1' })).product;
  const artifact1 = (await request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'internal-v1.md', content: 'SYNTHETIC_PRIVATE_DOCUMENT_V1' })).artifact;
  const document = (await request('/library/documents', 'POST', { requestId: randomUUID(), title: 'Pinned Internal Specification', asset: { artifactId: artifact1.id, version: artifact1.currentVersion, sha256: artifact1.sha256 } })).document;
  const references = { products: [{ productId: product.id, productRevision: 1 }], documents: [{ documentId: document.id, documentVersion: 1 }] };
  await request(`/conversations/${conversation.id}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references });
  await request(`/library/products/${product.id}`, 'PATCH', { requestId: randomUUID(), expectedRevision: 1, changes: { description: 'SYNTHETIC_PRODUCT_R2' } });
  const artifact2 = (await request('/artifacts', 'POST', { requestId: randomUUID(), filename: 'internal-v2.md', content: 'SYNTHETIC_PRIVATE_DOCUMENT_V2' })).artifact;
  await request(`/library/documents/${document.id}/versions`, 'POST', { requestId: randomUUID(), expectedRevision: 1, asset: { artifactId: artifact2.id, version: artifact2.currentVersion, sha256: artifact2.sha256 } });
  browser = await chromium.launch({ headless: true, chromiumSandbox: false, executablePath: '/usr/bin/chromium' });
  for (const width of [320, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ status: 204, body: '' }));
    page.on('request', request => { if (request.method() !== 'GET') writes.push({ method: request.method(), path: new URL(request.url()).pathname }); });
    await page.goto(`${base}/chat/${conversation.id}`); await page.locator('.app-shell[aria-busy="false"]').waitFor();
    await page.getByRole('button', { name: '会话资料 · 1 个产品 / 1 份文件', exact: true }).click();
    const selected = page.locator('.bl-selected-reference').filter({ hasText: document.title }); await selected.waitFor();
    const selectedLabel = await selected.innerText();
    await selected.locator('button').first().click();
    await page.locator('.bl-picker-detail pre').filter({ hasText: 'SYNTHETIC_PRIVATE_DOCUMENT_V2' }).waitFor();
    const inspectedVersion = await page.getByRole('combobox', { name: '会话固定资料版本', exact: true }).inputValue();
    const preview = await page.locator('.bl-picker-detail pre').innerText(), download = await page.locator('.bl-picker-detail .bl-download').getAttribute('href');
    assert.equal(inspectedVersion, '2'); assert.ok(selectedLabel.includes('资料 v1'));
    observations.push({ width, selectedLabel, storedReference: references.documents[0], inspectedVersion, preview, download, v1ArtifactId: artifact1.id, v2ArtifactId: artifact2.id });
    await page.screenshot({ path: join(output, `before-document-reference-${width}.png`) });
    await page.getByRole('button', { name: '返回选择列表', exact: true }).click();
    await page.locator('.bl-selected-reference').filter({ hasText: product.name }).locator('button').first().click();
    await page.getByRole('button', { name: '选择此产品修订 2', exact: true }).waitFor();
    observations.push({ width, selectedProductRevision: 1, currentProductRevision: 2, detailText: await page.locator('.bl-picker-detail').innerText() });
    await page.screenshot({ path: join(output, `before-product-reference-${width}.png`) });
    await page.close();
  }
  assert.deepEqual((await request(`/conversations/${conversation.id}/library-references`)).libraryReferences.products, references.products);
  assert.deepEqual((await request(`/conversations/${conversation.id}/library-references`)).libraryReferences.documents, references.documents);
  assert.equal(writes.length, 0); assert.equal(modelCalls, 0);
  const evidence = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(), actualBrowser: true, browserVersion: browser.version(), observations, browserWrites: writes, modelCalls };
  await writeFile(join(output, 'BEFORE-PINNED-INSPECTION.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
