// End-to-end smoke for quotes.
//
// Creates a quote over HTTP, checks the server-computed total, moves it through
// the status machine and renders the page. The model-facing tool is gated by the
// same approval seam the guarded smoke already proves, so this smoke stays on the
// HTTP contract.
//
// Usage: node scripts/quotes-smoke.mjs
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
const compositionPath = path.join(root, '.harness-quotes-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/quotes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(),
      customer: '海祺贸易',
      currency: 'CNY',
      lines: [
        { description: '不锈钢法兰 DN50', quantity: 500, unitPriceMinor: 1250 },
        { description: '运费', quantity: 1, unitPriceMinor: 30000 },
      ],
    }),
  }).then(async response => ({ ok: response.ok, body: await response.json() }));
  check('a quote is created as a draft', created.ok && created.body.quote.status === 'draft', created.body.quote?.status);
  const quote = created.body.quote;
  check('the server computed the total', quote.total === '6550.00', quote.total);
  check('the quote has a number', /^Q-\d{8}-\d{3}$/u.test(quote.number), quote.number);

  const listed = await fetch(`${base}/api/quotes?status=all`).then(response => response.json());
  check('the quote is listed', listed.items.some(item => item.id === quote.id), listed.total);

  const sent = await fetch(`${base}/api/quotes/${quote.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'sent' }),
  }).then(async response => ({ ok: response.ok, body: await response.json() }));
  check('the quote moves to sent', sent.ok && sent.body.quote.status === 'sent', sent.body.quote?.status);

  const backwards = await fetch(`${base}/api/quotes/${quote.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'draft' }),
  });
  check('an illegal transition is refused', backwards.status === 409, backwards.status);

  const page = await fetch(`${base}/quotes`);
  const html = await page.text();
  check('the quotes page renders', page.status === 200 && html.includes('新建报价'), page.status);

  const csv = await fetch(`${base}/api/quotes/${quote.id}/export.csv`);
  const csvText = await csv.text();
  check('the quote exports as CSV',
    csv.status === 200 && /text\/csv/u.test(csv.headers.get('content-type') ?? '') && csvText.includes(quote.number), csv.status);

  const print = await fetch(`${base}/api/quotes/${quote.id}/print`);
  const printHtml = await print.text();
  check('the quote renders a printable page', print.status === 200 && printHtml.includes(`报价单 ${quote.number}`), print.status);
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
