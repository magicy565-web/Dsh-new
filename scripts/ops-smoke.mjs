// End-to-end smoke for the operations surface.
//
// Starts the real composition, reads status, writes a backup, lists it,
// restores it (with the echoed confirmation) and rejects a wrong confirmation.
//
// Usage: node scripts/ops-smoke.mjs
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
const compositionPath = path.join(root, '.harness-ops-smoke.yml');
await (await import('node:fs/promises')).writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
const cleanup = [];
try {
  const { address } = await harness.start();
  const base = address.url;

  const status = await fetch(`${base}/api/ops/status`).then(response => response.json());
  check('status reports a version and real counts', status.version === '0.1.0' && status.storage?.counts?.workspaces >= 1, status.storage?.counts);

  const page = await fetch(`${base}/ops`);
  const html = await page.text();
  check('the ops page renders', page.status === 200 && html.includes('运维台') && html.includes('id="stats"'), page.status);

  const created = await fetch(`${base}/api/ops/backups`, { method: 'POST' })
    .then(async response => ({ ok: response.ok, body: await response.json() }));
  check('a backup is written', created.ok && created.body.backup?.bytes > 0, created.body.backup);
  if (created.body?.backup?.id) cleanup.push(path.join(status.storage.directory, 'backups', created.body.backup.file));

  const listed = await fetch(`${base}/api/ops/backups`).then(response => response.json());
  check('the backup is listed', listed.items?.some(item => item.id === created.body.backup.id), listed.total);

  const backupId = created.body.backup.id;
  const restored = await fetch(`${base}/api/ops/restore`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backupId, confirm: backupId }),
  }).then(async response => ({ status: response.status, body: await response.json() }));
  check('a confirmed restore succeeds', restored.status === 200 && restored.body.restored === true, restored.status);

  const wrong = await fetch(`${base}/api/ops/restore`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backupId, confirm: 'not-the-id' }),
  });
  check('a wrong confirmation is refused', wrong.status === 409, wrong.status);

  const missing = await fetch(`${base}/api/ops/restore`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backupId: randomUUID(), confirm: randomUUID() }),
  });
  check('an unknown backup is refused', missing.status === 404, missing.status);
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
  for (const file of cleanup) await unlink(file).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
