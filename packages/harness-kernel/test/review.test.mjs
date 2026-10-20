import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installPlugin } from '../src/install.mjs';
import { runWh } from '../src/cli.mjs';

const ENTRY = `export async function apply(ctx) {
  if (ctx?.health?.register) ctx.health.register('review-probe', () => ({ status: 'ok' }));
}
export default { apply };
`;

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function pluginPackage(directory, { id, provides = [], requires = [], env = [], tools = [], routes = [] } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'harness.plugin.json'), JSON.stringify({
    id, version: '0.1.0', kind: 'plugin', entry: './index.mjs', provides, requires, env, tools, routes,
  }), 'utf8');
  await fs.writeFile(path.join(directory, 'index.mjs'), ENTRY, 'utf8');
  return directory;
}

async function fixture(t, { plugins = [{ id: 'review-plugin', provides: ['service-a'], env: ['KEY_A'], tools: ['tool_a'], routes: ['GET /api/a'] }], rows = null, install = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-review-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  for (const plugin of plugins) await pluginPackage(path.join(root, 'source', plugin.id), plugin);
  if (install) {
    for (const plugin of plugins) await installPlugin({ sourceDir: path.join(root, 'source', plugin.id), root, actor: 'ops' });
  }
  const compositionRows = rows ?? ['  - id: a', `    name: ${plugins[0].id}`];
  await fs.writeFile(path.join(root, 'harness.yml'), [
    'version: 1', 'name: review-fixture', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    ...compositionRows,
    '',
  ].join('\n'), 'utf8');
  return root;
}

test('review reports a ready deployment and can archive the JSON', async t => {
  const root = await fixture(t);
  const output = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--json'], { root, ...output }), 0);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.verdict, 'ready');
  assert.deepEqual(document.blockers, []);
  assert.equal(document.composition.name, 'review-fixture');
  assert.match(document.composition.digest, /^[a-f0-9]{64}$/u);
  assert.match(document.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(document.summary.rows, 1);
  assert.equal(document.summary.enabled, 1);
  assert.deepEqual(document.summary.services, ['service-a']);
  assert.deepEqual(document.envReads, ['KEY_A']);
  assert.equal(document.rows[0].toolCount, 1);
  assert.equal(document.rows[0].routeCount, 1);
  assert.equal(document.installed.ok, true);
  assert.deepEqual(document.installed.packages.map(item => item.status), ['ok']);

  const archived = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--out', 'review.json'], { root, ...archived }), 0);
  const written = JSON.parse(await fs.readFile(path.join(root, 'review.json'), 'utf8'));
  assert.equal(written.verdict, 'ready');
  assert.equal(written.composition.digest, document.composition.digest);
  assert.match(archived.stderr.text, /review written to review\.json/u);
});

test('review blocks on unmet requires and service conflicts without mounting', async t => {
  const root = await fixture(t, {
    plugins: [
      { id: 'needy', requires: ['missing-service'] },
      { id: 'dup-1', provides: ['dup-service'] },
      { id: 'dup-2', provides: ['dup-service'] },
    ],
    rows: [
      '  - id: needy', '    name: needy',
      '  - id: dup1', '    name: dup-1',
      '  - id: dup2', '    name: dup-2',
    ],
  });
  const output = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--json'], { root, ...output }), 1);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.verdict, 'blocked');
  assert.deepEqual(document.blockers.map(item => item.kind), ['unmet-requires', 'service-conflict']);
  assert.equal(document.blockers[0].service, 'missing-service');
  assert.deepEqual(document.blockers[1].pluginIds, ['dup1', 'dup2']);

  const text = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml'], { root, ...text }), 1);
  assert.match(text.stdout.text, /review "review-fixture" \(harness\.yml\): blocked/u);
  assert.match(text.stdout.text, /blocker: unmet-requires needy \(missing-service\)/u);
});

test('review blocks on unresolved rows, install drift and missing packages', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'unresolved.yml'), [
    'version: 1', 'name: unresolved', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: ghost', '    name: does-not-exist',
    '',
  ].join('\n'), 'utf8');
  const unresolved = capture();
  assert.equal(await runWh(['review', '--composition', 'unresolved.yml', '--json'], { root, ...unresolved }), 1);
  const unresolvedDocument = JSON.parse(unresolved.stdout.text);
  assert.deepEqual(unresolvedDocument.blockers, [{ kind: 'unresolved-row', pluginId: 'ghost', status: 'missing' }]);

  // A tampered install and a journalled-but-deleted package are both blockers.
  await fs.writeFile(path.join(root, 'plugins', 'review-plugin', 'index.mjs'), `${ENTRY}\n// tampered\n`, 'utf8');
  const drifted = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--json'], { root, ...drifted }), 1);
  const driftedDocument = JSON.parse(drifted.stdout.text);
  assert.deepEqual(driftedDocument.blockers.map(item => item.kind), ['install-drift']);
  assert.equal(driftedDocument.installed.ok, false);

  await fs.rm(path.join(root, 'plugins', 'review-plugin'), { recursive: true, force: true });
  const missing = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--json'], { root, ...missing }), 1);
  assert.deepEqual(JSON.parse(missing.stdout.text).blockers.map(item => item.kind), ['unresolved-row', 'install-missing']);
});

test('review verdicts are recorded in the unified audit stream on request', async t => {
  const root = await fixture(t);
  const auditState = path.join(root, 'data', 'workspace.json');

  const ready = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--audit-state', auditState, '--actor', 'ops'], { root, ...ready }), 0);
  const auditReady = capture();
  assert.equal(await runWh(['audit', '--state', auditState, '--kind', 'review', '--json'], { root, ...auditReady }), 0);
  const events = JSON.parse(auditReady.stdout.text).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'review');
  assert.equal(events[0].action, 'ready');
  assert.equal(events[0].ok, true);
  assert.equal(events[0].actor.subject, 'ops');
  assert.equal(events[0].ref, 'review-fixture');
  assert.match(events[0].detail.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(events[0].detail.blockers, []);

  // A blocked review is recorded as a failed event with the blocker kinds.
  await fs.writeFile(path.join(root, 'ghost.yml'), [
    'version: 1', 'name: ghosted', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: ghost', '    name: does-not-exist',
    '',
  ].join('\n'), 'utf8');
  const blocked = capture();
  assert.equal(await runWh(['review', '--composition', 'ghost.yml', '--audit-state', auditState, '--actor', 'ops'], { root, ...blocked }), 1);
  const auditBlocked = capture();
  assert.equal(await runWh(['audit', '--state', auditState, '--kind', 'review', '--json'], { root, ...auditBlocked }), 0);
  const all = JSON.parse(auditBlocked.stdout.text).events;
  assert.deepEqual(all.map(event => event.action), ['blocked', 'ready'], 'newest first');
  assert.equal(all[0].ok, false);
  assert.equal(all[0].code, 'HARNESS_REVIEW_BLOCKED');
  assert.deepEqual(all[0].detail.blockers, ['unresolved-row']);
});