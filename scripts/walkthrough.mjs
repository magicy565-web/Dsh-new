// Product walkthrough: prove the whole machine works, not just its parts.
//
// Boots the composition with the session layer enabled, signs in, then visits
// every page a plugin declares and the key APIs behind them. Unlike the release
// gate (which proves each piece), this walks the assembled product.
//
// Usage: node scripts/walkthrough.mjs [--json <file>]
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

async function pageRoutes() {
  const entries = await readdir(path.join(root, 'plugins'), { withFileTypes: true });
  const routes = [];
  for (const entry of entries.filter(item => item.isDirectory())) {
    const manifest = JSON.parse(await readFile(path.join(root, 'plugins', entry.name, 'harness.plugin.json'), 'utf8').catch(() => 'null'));
    if (!manifest) continue;
    for (const route of manifest.routes ?? []) {
      const match = /^GET (\/[a-z][a-z-]*)$/u.exec(route);
      if (match) routes.push({ plugin: manifest.id ?? entry.name, path: match[1] });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
composition.plugins = [...composition.plugins, { id: 'access', name: 'workspace-access', config: { workspaceId: 'local' } }];
const compositionPath = path.join(root, '.harness-walkthrough.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const login = await fetch(`${base}/api/access/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'local-operator' }),
  });
  const cookie = ((login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])[0] ?? '').split(';')[0];
  check('sign-in works', login.status === 200 && /dsh_session=/u.test(cookie), login.status);

  const pages = await pageRoutes();
  check('the product declares pages', pages.length >= 10, pages.length);

  for (const page of pages) {
    const response = await fetch(`${base}${page.path}`, { headers: { cookie } });
    const html = await response.text();
    const ok = response.status === 200
      && /text\/html/u.test(response.headers.get('content-type') ?? '')
      && html.includes('<html')
      && !html.includes('HARNESS_');
    check(`page ${page.path}`, ok, { plugin: page.plugin, status: response.status, bytes: html.length });
  }

  const apis = [
    '/api/chat/status', '/api/goals?status=all', '/api/quotes?status=all', '/api/purchases?status=all',
    '/api/inbox?status=all', '/api/artifacts', '/api/access/sessions', '/api/ops/status', '/api/schedules?status=all',
  ];
  for (const api of apis) {
    const response = await fetch(`${base}${api}`, { headers: { cookie } });
    const body = await response.json().catch(() => null);
    check(`api ${api}`, response.status === 200 && body !== null, response.status);
  }

  const denied = await fetch(`${base}/api/chat/status`);
  check('an unauthenticated API call is refused', denied.status === 401, denied.status);
} catch (error) {
  results.push({ name: 'walkthrough threw', ok: false, detail: String(error?.stack ?? error).slice(0, 300) });
} finally {
  await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);

const jsonIndex = process.argv.indexOf('--json');
if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
  await writeFile(path.resolve(process.argv[jsonIndex + 1]), `${JSON.stringify({ ok: failed.length === 0, results }, null, 2)}\n`, 'utf8');
}
process.exitCode = failed.length ? 1 : 0;
