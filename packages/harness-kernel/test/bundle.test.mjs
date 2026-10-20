import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installBundle, readBundle, validateBundle } from '../src/bundle.mjs';
import { listInstalled, readInstallJournal } from '../src/install.mjs';
import { runWh } from '../src/cli.mjs';

const ENTRY = `export async function apply(ctx) {
  if (ctx?.health?.register) ctx.health.register('bundle-probe', () => ({ status: 'ok' }));
}
export default { apply };
`;

const errorCode = code => error => error?.code === code;
function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function pluginPackage(directory, { id, provides = [], requires = [], version = '0.1.0' } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'harness.plugin.json'), JSON.stringify({
    id, version, kind: 'plugin', entry: './index.mjs', provides, requires,
  }), 'utf8');
  await fs.writeFile(path.join(directory, 'index.mjs'), ENTRY, 'utf8');
  return directory;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-bundle-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const bundle = path.join(root, 'bundle');
  await fs.mkdir(bundle, { recursive: true });
  return { root, bundle, plugins: path.join(root, 'plugins') };
}

async function writeBundle(bundle, { name = 'growth-suite', plugins } = {}) {
  await fs.writeFile(path.join(bundle, 'harness.bundle.json'), JSON.stringify({ version: 1, name, plugins }), 'utf8');
}

test('a bundle installs every plugin and records the group in the journal', async t => {
  const { root, bundle } = await fixture(t);
  await pluginPackage(path.join(bundle, 'a'), { id: 'plugin-a', provides: ['service-a'] });
  await pluginPackage(path.join(bundle, 'b'), { id: 'plugin-b', provides: ['service-b'], requires: ['service-a'] });
  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-b', dir: 'b' }] });

  const validation = await validateBundle({ bundleDir: bundle, root });
  assert.deepEqual(validation.providers, ['service-a', 'service-b']);
  const result = await installBundle({ bundleDir: bundle, root, actor: 'ops' });
  assert.equal(result.bundle, 'growth-suite');
  assert.deepEqual(result.installed.map(item => item.id), ['plugin-a', 'plugin-b']);
  assert.deepEqual((await listInstalled({ root })).map(item => item.id), ['plugin-a', 'plugin-b']);

  const journal = await readInstallJournal({ root });
  assert.deepEqual(journal.map(entry => entry.action), ['install', 'install', 'bundle-install']);
  assert.equal(journal.at(-1).bundle, 'growth-suite');
  assert.equal(journal.at(-1).actor, 'ops');
  assert.deepEqual(journal.at(-1).plugins.map(item => item.id), ['plugin-a', 'plugin-b']);
});

test('bundle validation refuses missing providers, duplicated providers and bad entries', async t => {
  const { root, bundle } = await fixture(t);
  await pluginPackage(path.join(bundle, 'a'), { id: 'plugin-a', provides: ['service-a'] });
  await pluginPackage(path.join(bundle, 'b'), { id: 'plugin-b', provides: ['service-a'] });

  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-b', dir: 'b' }] });
  await assert.rejects(validateBundle({ bundleDir: bundle, root }), error => /bundle conflict/u.test(error.message));

  await pluginPackage(path.join(bundle, 'needs'), { id: 'plugin-needs', requires: ['absent-service'] });
  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-needs', dir: 'needs' }] });
  await assert.rejects(validateBundle({ bundleDir: bundle, root }), error => /cannot be satisfied: plugin-needs requires absent-service/u.test(error.message));

  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-a', dir: 'a' }] });
  await assert.rejects(readBundle(bundle), error => /repeats plugin/u.test(error.message));

  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: '../escape' }] });
  await assert.rejects(readBundle(bundle), error => /stay inside the bundle/u.test(error.message));

  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a', version: '9.9.9' }] });
  await assert.rejects(validateBundle({ bundleDir: bundle, root }), error => /expects version 9\.9\.9/u.test(error.message));

  await assert.rejects(readBundle(path.join(root, 'missing')), errorCode('HARNESS_PLUGIN_FAILED'));
  assert.deepEqual(await listInstalled({ root }), [], 'a refused bundle never installs anything');
});

test('a failure mid-bundle rolls the target back to its previous state', async t => {
  const { root, bundle, plugins } = await fixture(t);
  await pluginPackage(path.join(bundle, 'a'), { id: 'plugin-a' });
  await pluginPackage(path.join(bundle, 'b'), { id: 'plugin-b' });
  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-b', dir: 'b' }] });
  // A plain file at plugin-b's destination makes its install fail after plugin-a succeeded.
  await fs.mkdir(plugins, { recursive: true });
  await fs.writeFile(path.join(plugins, 'plugin-b'), 'not a directory', 'utf8');

  await assert.rejects(installBundle({ bundleDir: bundle, root, actor: 'ops' }), error => /bundle growth-suite failed/u.test(error.message));
  await assert.rejects(fs.stat(path.join(plugins, 'plugin-a')), 'the first plugin is removed again');
  assert.equal(await fs.readFile(path.join(plugins, 'plugin-b'), 'utf8'), 'not a directory', 'the conflicting file is untouched');

  const journal = await readInstallJournal({ root });
  assert.deepEqual(journal.map(entry => entry.action), ['install', 'uninstall', 'bundle-failed'], 'the rollback itself is journalled');
  assert.equal(journal.at(-1).bundle, 'growth-suite');
  assert.deepEqual(journal.at(-1).rolledBack, ['plugin-a']);
});

test('an upgrade inside a failed bundle restores the previous installation', async t => {
  const { root, bundle, plugins } = await fixture(t);
  await pluginPackage(path.join(bundle, 'a'), { id: 'plugin-a', version: '0.2.0' });
  await pluginPackage(path.join(bundle, 'b'), { id: 'plugin-b' });
  await writeBundle(bundle, { plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-b', dir: 'b' }] });
  // Install the old version manually first, then block plugin-b's destination so the
  // bundle fails after plugin-a's upgrade already replaced it.
  const oldDir = path.join(root, 'old-a');
  await pluginPackage(oldDir, { id: 'plugin-a', version: '0.1.0' });
  const { installPlugin } = await import('../src/install.mjs');
  await installPlugin({ sourceDir: oldDir, root, actor: 'ops' });
  await fs.mkdir(plugins, { recursive: true });
  await fs.writeFile(path.join(plugins, 'plugin-b'), 'blocked', 'utf8');

  await assert.rejects(installBundle({ bundleDir: bundle, root, upgrade: true, actor: 'ops' }), error => /bundle growth-suite failed/u.test(error.message));
  const installed = await listInstalled({ root });
  assert.deepEqual(installed.map(item => [item.id, item.version]), [['plugin-a', '0.1.0']], 'the upgrade was reverted to the previous version');
});

test('wh install-bundle installs and reports the group', async t => {
  const { root, bundle } = await fixture(t);
  await pluginPackage(path.join(bundle, 'a'), { id: 'plugin-a', provides: ['service-a'] });
  await pluginPackage(path.join(bundle, 'b'), { id: 'plugin-b' });
  await writeBundle(bundle, { name: 'suite-cli', plugins: [{ id: 'plugin-a', dir: 'a' }, { id: 'plugin-b', dir: 'b' }] });

  const result = capture();
  assert.equal(await runWh(['install-bundle', bundle, '--actor', 'ops', '--json'], { root, ...result }), 0);
  const document = JSON.parse(result.stdout.text);
  assert.equal(document.bundle, 'suite-cli');
  assert.deepEqual(document.installed.map(item => item.id), ['plugin-a', 'plugin-b']);
  assert.deepEqual(document.providers, ['service-a']);

  const usage = capture();
  assert.equal(await runWh(['install-bundle'], { root, ...usage }), 2);
  assert.match(usage.stderr.text, /requires a bundle directory/u);
});
