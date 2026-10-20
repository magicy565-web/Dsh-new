import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHarness } from '../src/app.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { installPlugin, listInstalled, readInstallJournal, readPackage, rollbackPlugin, uninstallPlugin, verifyPackageSignature } from '../src/install.mjs';
import { runWh } from '../src/cli.mjs';

const errorCode = code => error => error?.code === code;

const PLUGIN_SOURCE = `export async function apply(ctx) {
  if (ctx?.health?.register) ctx.health.register('installed-probe', () => ({ status: 'ok', detail: { installed: true } }));
}
export default { apply };
`;

async function packageAt(directory, { id = 'sample-plugin', version = '0.1.0', body = PLUGIN_SOURCE, manifest = {} } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'harness.plugin.json'), JSON.stringify({
    id, version, kind: 'plugin', entry: './index.mjs', description: 'installed fixture', ...manifest,
  }), 'utf8');
  await fs.writeFile(path.join(directory, 'index.mjs'), body, 'utf8');
  return directory;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-install-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  return { root, plugins: path.join(root, 'plugins'), source: path.join(root, 'source') };
}

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

test('install is atomic, digest-checked and refuses a duplicate without upgrade', async t => {
  const { root, plugins, source } = await fixture(t);
  await packageAt(source);
  const pkg = await readPackage(source);
  assert.match(pkg.digest, /^[a-f0-9]{64}$/u);

  const installed = await installPlugin({ sourceDir: source, root });
  assert.equal(installed.id, 'sample-plugin');
  assert.equal(installed.digest, pkg.digest);
  assert.equal(installed.backup, null);
  assert.ok((await fs.stat(path.join(plugins, 'sample-plugin', 'index.mjs'))).isFile());
  const stagingLeftovers = (await fs.readdir(plugins)).filter(name => name.startsWith('.staging-'));
  assert.deepEqual(stagingLeftovers, [], 'no staging directory survives a successful install');

  await assert.rejects(installPlugin({ sourceDir: source, root }), errorCode('HARNESS_PLUGIN_DUPLICATE'));
  const listed = await listInstalled({ root });
  assert.deepEqual(listed.map(item => item.id), ['sample-plugin']);
});

test('upgrade replaces the package and keeps the previous bytes as a backup', async t => {
  const { root, plugins, source } = await fixture(t);
  await packageAt(source);
  const first = await installPlugin({ sourceDir: source, root });

  await packageAt(source, { version: '0.2.0', body: `${PLUGIN_SOURCE}\n// v2\n` });
  const upgraded = await installPlugin({ sourceDir: source, root, upgrade: true });
  assert.notEqual(upgraded.digest, first.digest);
  assert.ok(upgraded.backup && (await fs.stat(upgraded.backup)).isDirectory());
  const backupBody = await fs.readFile(path.join(upgraded.backup, 'index.mjs'), 'utf8');
  assert.equal(backupBody.includes('// v2'), false, 'the backup keeps the previous implementation');
  const manifest = JSON.parse(await fs.readFile(path.join(plugins, 'sample-plugin', 'harness.plugin.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
});

test('uninstall keeps a restorable backup and rollback restores it', async t => {
  const { root, plugins, source } = await fixture(t);
  await packageAt(source);
  const installed = await installPlugin({ sourceDir: source, root });

  const removed = await uninstallPlugin({ id: 'sample-plugin', root });
  assert.ok(removed.backup);
  await assert.rejects(fs.stat(path.join(plugins, 'sample-plugin')));
  assert.deepEqual(await listInstalled({ root }), []);

  const restored = await rollbackPlugin({ id: 'sample-plugin', root });
  assert.equal(restored.restoredFrom, removed.backup);
  const again = await listInstalled({ root });
  assert.deepEqual(again.map(item => [item.id, item.digest]), [['sample-plugin', installed.digest]]);

  await assert.rejects(rollbackPlugin({ id: 'never-installed', root }), errorCode('HARNESS_PLUGIN_FAILED'));
});

test('invalid packages and unsafe entries are refused before anything is written', async t => {
  const { root, plugins, source } = await fixture(t);
  await assert.rejects(readPackage(path.join(source, 'missing')), errorCode('HARNESS_PLUGIN_FAILED'));

  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'harness.plugin.json'), JSON.stringify({ id: 'sample-plugin', version: '0.1.0', kind: 'plugin', entry: './nope.mjs' }), 'utf8');
  await assert.rejects(readPackage(source), errorCode('HARNESS_PLUGIN_FAILED'));

  await fs.writeFile(path.join(source, 'harness.plugin.json'), JSON.stringify({ id: 'sample-plugin', version: '0.1.0', kind: 'plugin', entry: '../escape.mjs' }), 'utf8');
  await fs.writeFile(path.join(root, 'escape.mjs'), 'export default {}\n', 'utf8');
  await assert.rejects(readPackage(source), errorCode('HARNESS_PLUGIN_FAILED'));

  await fs.writeFile(path.join(source, 'harness.plugin.json'), JSON.stringify({ id: 'Bad Id', version: '0.1.0', kind: 'plugin', entry: './index.mjs' }), 'utf8');
  await fs.writeFile(path.join(source, 'index.mjs'), PLUGIN_SOURCE, 'utf8');
  await assert.rejects(readPackage(source), error => error instanceof Error);

  assert.deepEqual(await listInstalled({ root }), []);
  await assert.rejects(fs.stat(plugins), 'a refused package never creates the target directory');
});

test('an installed package is resolved and mounted by the kernel', async t => {
  const { root, source } = await fixture(t);
  await packageAt(source, { id: 'sample-plugin' });
  await installPlugin({ sourceDir: source, root });
  const composition = path.join(root, 'harness.yml');
  await fs.writeFile(composition, [
    'version: 1', 'name: installed', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: sample', '    name: sample-plugin',
    '',
  ].join('\n'), 'utf8');
  const harness = await createHarness({ compositionPath: composition, root });
  t.after(async () => { await harness.stop(); });
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id), ['sample']);
  assert.equal(harness.healthz().status, 'ok');
  assert.deepEqual(harness.healthz().checks.map(check => check.name), ['installed-probe']);
});

test('wh install / installed / uninstall / rollback work on the target directory', async t => {
  const { root, source } = await fixture(t);
  await packageAt(source);

  const installed = capture();
  assert.equal(await runWh(['install', source, '--json'], { root, ...installed }), 0);
  assert.equal(JSON.parse(installed.stdout.text).id, 'sample-plugin');

  const listed = capture();
  assert.equal(await runWh(['installed', '--json'], { root, ...listed }), 0);
  assert.deepEqual(JSON.parse(listed.stdout.text).packages.map(item => item.id), ['sample-plugin']);

  const removed = capture();
  assert.equal(await runWh(['uninstall', 'sample-plugin', '--json'], { root, ...removed }), 0);
  assert.ok(JSON.parse(removed.stdout.text).backup);

  const restored = capture();
  assert.equal(await runWh(['rollback', 'sample-plugin'], { root, ...restored }), 0);
  assert.match(restored.stdout.text, /restored sample-plugin/u);

  const usage = capture();
  assert.equal(await runWh(['install'], { root, ...usage }), 2);
  assert.match(usage.stderr.text, /requires a package directory/u);
});

test('every install operation is recorded in the install journal', async t => {
  const { root, source } = await fixture(t);
  await packageAt(source);
  await installPlugin({ sourceDir: source, root, actor: 'alice' });
  await packageAt(source, { version: '0.2.0', body: `${PLUGIN_SOURCE}\n// v2\n` });
  await installPlugin({ sourceDir: source, root, upgrade: true, actor: 'alice' });
  await uninstallPlugin({ id: 'sample-plugin', root, actor: 'bob' });
  await rollbackPlugin({ id: 'sample-plugin', root, actor: 'carol' });

  const journal = await readInstallJournal({ root });
  assert.deepEqual(journal.map(entry => entry.action), ['install', 'upgrade', 'uninstall', 'rollback']);
  assert.equal(journal[0].actor, 'alice');
  assert.equal(journal[1].actor, 'alice');
  assert.equal(journal[1].previousDigest, journal[0].digest);
  assert.equal(journal[2].actor, 'bob');
  assert.equal(journal[3].actor, 'carol');
  assert.match(journal[0].digest, /^[a-f0-9]{64}$/u);
  assert.equal(journal[0].signed, false);
  assert.doesNotMatch(JSON.stringify(journal), /apply\(ctx\)|installed fixture/u, 'the journal holds metadata only');
  assert.equal((await listInstalled({ root })).length, 1, 'the journal file itself is not a package');

  const shown = capture();
  assert.equal(await runWh(['installed', '--journal'], { root, ...shown }), 0);
  assert.match(shown.stdout.text, /install journal/u);
  assert.match(shown.stdout.text, /rollback/u);
  assert.match(shown.stdout.text, /by carol/u);
});

test('signed packages are verified offline; tampering and wrong keys are refused', async t => {
  const { root, source } = await fixture(t);
  await packageAt(source);
  const digest = (await readPackage(source)).digest;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const signature = sign(null, Buffer.from(digest, 'utf8'), privateKey).toString('base64');
  await fs.writeFile(path.join(source, 'harness.package.json'), JSON.stringify({ version: 1, digest, signature, signer: 'release-bot' }), 'utf8');

  const pkg = await readPackage(source);
  assert.equal(pkg.digest, digest, 'the package metadata file is excluded from its own digest');
  assert.deepEqual(verifyPackageSignature(pkg, { publicKey: pem }), { signed: true, verified: true, signer: 'release-bot' });
  assert.throws(() => verifyPackageSignature(pkg), /pass --public-key/u);

  const installed = await installPlugin({ sourceDir: source, root, publicKey: pem, actor: 'release-bot' });
  assert.equal(installed.signature.verified, true);
  const [entry] = await readInstallJournal({ root });
  assert.equal(entry.signed, true);
  assert.equal(entry.verified, true);

  await fs.writeFile(path.join(source, 'index.mjs'), `${PLUGIN_SOURCE}\n// tampered\n`, 'utf8');
  await assert.rejects(installPlugin({ sourceDir: source, root, target: 'signed-a', publicKey: pem }), error => /declared digest does not match/u.test(error.message));
  await fs.writeFile(path.join(source, 'index.mjs'), PLUGIN_SOURCE, 'utf8');
  const { publicKey: other } = generateKeyPairSync('ed25519');
  await assert.rejects(installPlugin({ sourceDir: source, root, target: 'signed-b', publicKey: other.export({ type: 'spki', format: 'pem' }) }), error => /signature does not match/u.test(error.message));
});

test('wh install verifies a signed package with --public-key and records the actor', async t => {
  const { root, source } = await fixture(t);
  await packageAt(source);
  const digest = (await readPackage(source)).digest;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  await fs.writeFile(path.join(source, 'harness.package.json'), JSON.stringify({ version: 1, digest, signature: sign(null, Buffer.from(digest, 'utf8'), privateKey).toString('base64'), signer: 'release-bot' }), 'utf8');
  await fs.writeFile(path.join(root, 'release.pub.pem'), pem, 'utf8');

  const result = capture();
  assert.equal(await runWh(['install', source, '--public-key', 'release.pub.pem', '--actor', 'ops'], { root, ...result }), 0);
  assert.match(result.stdout.text, /signature: verified \(release-bot\)/u);
  const [entry] = await readInstallJournal({ root });
  assert.equal(entry.actor, 'ops');
  assert.equal(entry.signed, true);
  assert.equal(entry.verified, true);

  await fs.rm(path.join(source, 'harness.package.json'));
  const unsigned = capture();
  assert.equal(await runWh(['install', source, '--upgrade'], { root, ...unsigned }), 0);
  assert.match(unsigned.stdout.text, /signature: none/u, 'upgrading without a key must not silently claim verification');
});