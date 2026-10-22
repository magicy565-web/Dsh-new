// End-to-end smoke for inquiry recovery.
//
// The plugin exposes read-only discovery endpoints plus audited write actions.
// This smoke proves the read surface answers, an unknown lead is a clean 404,
// and an invalid import is refused instead of writing.
//
// Usage: node scripts/inquiry-recovery-smoke.mjs
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
const compositionPath = path.join(root, '.harness-inquiry-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;
  const api = pathname => fetch(`${base}/api/inquiry-recovery/${pathname}`);

  const status = await api('status');
  const statusBody = await status.json();
  check('status answers with an object', status.status === 200 && typeof statusBody === 'object' && statusBody !== null, status.status);

  const opportunities = await api('opportunities');
  const opportunitiesBody = await opportunities.json();
  check('opportunities answers', opportunities.status === 200 && Array.isArray(opportunitiesBody.items ?? opportunitiesBody.opportunities ?? []), opportunities.status);

  const conflicts = await api('conflicts');
  check('conflicts answers', conflicts.status === 200, conflicts.status);

  const audit = await api('audit');
  check('audit answers', audit.status === 200, audit.status);

  const approvals = await api('approvals');
  check('approvals answers', approvals.status === 200, approvals.status);

  const missing = await api(`leads/${randomUUID()}`);
  check('an unknown lead is a clean 404', missing.status === 404, missing.status);

  const badImport = await fetch(`${base}/api/inquiry-recovery/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  });
  check('an invalid import is refused', badImport.status === 400 || badImport.status === 422, badImport.status);
} finally {
  await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
