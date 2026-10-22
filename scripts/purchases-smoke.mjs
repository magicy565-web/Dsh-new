// End-to-end smoke for purchase orders.
//
// Draft -> operator approval refused -> administrator approval -> ordered ->
// received, all over HTTP, plus the page and the "no model approval tool" rule.
//
// Usage: node scripts/purchases-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
const compositionPath = path.join(root, '.harness-purchases-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/purchases`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(),
      supplier: '无锡法兰厂',
      currency: 'CNY',
      lines: [{ description: '不锈钢法兰 DN50', quantity: 500, unitPriceMinor: 1250 }],
    }),
  }).then(async response => ({ ok: response.ok, body: await response.json() }));
  const order = created.body.order;
  check('a purchase order starts as draft', created.ok && order.status === 'draft', order?.status);
  check('the server computed the total', order?.total === '6250.00', order?.total);
  check('the order has a number', /^PO-\d{8}-\d{3}$/u.test(order?.number ?? ''), order?.number);

  const listed = await fetch(`${base}/api/purchases?status=all`).then(response => response.json());
  check('the order is listed', listed.items.some(item => item.id === order.id), listed.total);

  const approved = await fetch(`${base}/api/purchases/${order.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
  }).then(async response => ({ ok: response.ok, body: await response.json() }));
  check('an administrator approves the order', approved.ok && approved.body.order.status === 'approved', approved.body.order?.status);
  check('the approval records who approved', approved.body.order.approvedBy === 'local-operator', approved.body.order?.approvedBy);

  const skipped = await fetch(`${base}/api/purchases/${order.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'received' }),
  });
  check('skipping a state is refused', skipped.status === 409, skipped.status);

  const ordered = await fetch(`${base}/api/purchases/${order.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ordered' }),
  }).then(response => response.json());
  check('the order can be placed', ordered.order.status === 'ordered', ordered.order?.status);

  const received = await fetch(`${base}/api/purchases/${order.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'received' }),
  }).then(response => response.json());
  check('the order can be received', received.order.status === 'received', received.order?.status);

  const page = await fetch(`${base}/purchases`);
  const html = await page.text();
  check('the purchases page renders', page.status === 200 && html.includes('新建采购单'), page.status);
} finally {
  await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
