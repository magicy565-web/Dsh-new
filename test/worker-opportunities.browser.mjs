import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const prospect = {
  name: 'Fixture Textile Distributor', country: 'United States',
  website: 'https://distributor.example.org',
  fitReason: 'Published wholesale textile assortment',
  sourceUrl: 'https://distributor.example.org/products',
};
const worker = {
  ready: true, budgetEnforced: true, services: ['buyer-discovery'], displayName: 'Fixture Worker',
  async submit(task) { return { jobId: 'fixture-' + task.orderId }; },
  async get(jobId) { return { jobId, status: 'completed', costCredits: 2,
    deliverables: [{ name: 'Prospect sheet', type: 'table', summary: 'One sourced distributor' }],
    prospects: [prospect],
    evidence: [{ title: 'Company catalog', url: prospect.sourceUrl, detail: 'Fixture only' }],
  }; },
  async cancel() { return { status: 'cancel_requested' }; },
};

const directory = await mkdtemp(path.join(tmpdir(), 'worker-opportunities-browser-'));
const app = await createApp({ dataDirectory: directory, workerAdapters: { fixture: worker } });
const address = await app.listen(0);
const base = 'http://127.0.0.1:' + address.port;
let browser;
const errors = [];
try {
  const post = async (route, data = {}) => {
    const response = await fetch(base + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal(response.ok, true, route + ' unexpectedly failed: ' + response.status);
    return response.json();
  };
  const { order } = await post('/api/worker-orders', {
    requestId: 'worker-browser-prospect-fixture', serviceId: 'buyer-discovery',
    product: 'Printed fabrics', market: 'United States', objective: 'Find a distributor with public evidence',
    deadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), budgetCredits: 10,
    publicDataConfirmed: true,
  });
  await post('/api/worker-orders/' + order.id + '/approve', { confirmed: true, workerId: 'fixture' });
  await post('/api/worker-orders/' + order.id + '/dispatch');
  await post('/api/worker-orders/' + order.id + '/refresh');
  await post('/api/worker-orders/' + order.id + '/accept', { confirmed: true });
  await post('/api/worker-orders/' + order.id + '/promote', {
    indices: [0], requestId: 'promote-' + order.id, confirmed: true,
  });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const page = await browser.newPage({ viewport: { width: 1260, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/workers');
  await page.getByRole('heading', { name: '企业商机池' }).waitFor();
  await page.getByText('Fixture Textile Distributor').waitFor();
  const row = page.locator('.worker-opportunity-row').first();
  assert.equal(await row.getByText('待审核').count(), 1);
  await mkdir('evidence/browser', { recursive: true });
  await page.screenshot({ path: 'evidence/browser/10-worker-opportunity-desktop.png', fullPage: true });
  await row.getByRole('button', { name: '审核' }).click();
  await page.getByRole('dialog').getByRole('heading', { name: '人工核实客户线索' }).waitFor();
  await page.getByRole('dialog').locator('textarea').fill('Buyer product portfolio appears relevant; requires independent verification');
  await page.getByRole('button', { name: '人工判断为相关客户' }).click();
  await row.getByText('相关客户').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'evidence/browser/11-worker-opportunity-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(errors, []);
  console.log('PASS: real React Work Orders -> Opportunities -> human qualification desktop and mobile');
} finally {
  await browser?.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
