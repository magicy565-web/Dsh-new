// End-to-end smoke for the deployment review surface.
//
// 1. `wh review --out` writes a real review document.
// 2. A harness mounting workspace-harness-review with that file serves it over
//    GET /api/harness/review.
// 3. Deleting the file makes the endpoint degrade honestly instead of inventing
//    a stale verdict.
//
// Usage: node scripts/harness-review-smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };
const node = process.execPath;

function run(args) {
  return new Promise(resolve => {
    const child = spawn(node, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' } });
    child.on('error', () => resolve(1));
    child.on('exit', code => resolve(code ?? 1));
  });
}

const workdir = await mkdtemp(path.join(tmpdir(), 'review-smoke-'));
const reviewFile = path.join(workdir, 'review.json');
const compositionPath = path.join(root, '.harness-review-smoke.yml');

try {
  const generated = await run([path.join('packages', 'harness-kernel', 'bin', 'wh.mjs'), 'review', '-c', 'harness.local.yml', '--out', reviewFile]);
  check('wh review writes a document', generated === 0, generated);
  const document = JSON.parse(await readFile(reviewFile, 'utf8').catch(() => '{}'));
  check('the review names a verdict', typeof document.verdict === 'string' || typeof document.status === 'string', Object.keys(document).slice(0, 6));

  const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
  composition.server = { host: '127.0.0.1', port: 0 };
  composition.plugins = [...composition.plugins, {
    id: 'review', name: 'workspace-harness-review', config: { reviewFile },
  }];
  await writeFile(compositionPath, stringify(composition), 'utf8');

  const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
  try {
    const { address } = await harness.start();
    const base = address.url;

    const served = await fetch(`${base}/api/harness/review`);
    const body = await served.json();
    check('the review endpoint serves the document', served.status === 200 && typeof body === 'object', served.status);
    check('the served document keeps the verdict', JSON.stringify(body).includes(document.verdict ?? document.status ?? 'verdict'), Object.keys(body).slice(0, 6));

    await unlink(reviewFile);
    const missing = await fetch(`${base}/api/harness/review`);
    check('a missing review file degrades instead of inventing', missing.status >= 400 && missing.status < 600, missing.status);
  } finally {
    await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
} catch (error) {
  results.push({ name: 'smoke body threw', ok: false, detail: String(error?.stack ?? error).slice(0, 300) });
} finally {
  await unlink(compositionPath).catch(() => {});
  await rm(workdir, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
