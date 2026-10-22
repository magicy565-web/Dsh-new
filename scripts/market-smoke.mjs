// End-to-end smoke for the market surface.
//
// Market serves the repository root page plus its own page and static assets.
// This smoke proves the shell and assets are served with the right types and a
// strict CSP, without touching any business data.
//
// Usage: node scripts/market-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
const compositionPath = path.join(root, '.harness-market-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const redirect = await fetch(`${base}/`, { redirect: 'manual' });
  check('the root redirects to the market page', redirect.status === 302 && redirect.headers.get('location') === '/market', redirect.status);

  const page = await fetch(`${base}/market`);
  const pageHtml = await page.text();
  check('the market page is served', page.status === 200 && pageHtml.includes('<html'), page.status);
  const csp = page.headers.get('content-security-policy') ?? '';
  check('the market page declares a strict CSP',
    csp.includes("base-uri 'none'") && csp.includes("frame-ancestors 'none'") && !csp.includes('unsafe-inline'), csp);
  check('the market page loads its own assets', pageHtml.includes('/market/app.js') || pageHtml.includes('/market/app.css'), pageHtml.length);

  const script = await fetch(`${base}/market/app.js`);
  check('the market script is served as javascript',
    script.status === 200 && /javascript/u.test(script.headers.get('content-type') ?? ''), script.status);

  const style = await fetch(`${base}/market/app.css`);
  check('the market stylesheet is served as css',
    style.status === 200 && /css/u.test(style.headers.get('content-type') ?? ''), style.status);
} finally {
  await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
