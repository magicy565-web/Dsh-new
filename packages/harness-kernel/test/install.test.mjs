import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHarness } from '../src/app.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { checkInstallDrift, installPlugin, listInstalled, readInstallJournal, readPackage, rollbackPlugin, uninstallPlugin, verifyPackageSignature } from '../src/install.mjs';
import { appendAuditEntry } from '../src/audit-state.mjs';
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
test('install operations can be appended to the unified audit stream', async t => {
  const { root, source } = await fixture(t);
  const auditState = path.join(root, 'data', 'workspace.json');
  await packageAt(source);

  const appended = await appendAuditEntry(auditState, {
    kind: 'install', action: 'install', actor: { subject: 'alice', role: 'operator' },
    ok: true, ref: 'sample-plugin', detail: { digest: 'a'.repeat(64) },
  }, { root });
  assert.equal(appended.total, 1);
  assert.match(appended.entry.id, /^[0-9a-f-]{36}$/u);
  assert.match(appended.entry.at, /^\d{4}-\d{2}-\d{2}T/u);

  const read = capture();
  assert.equal(await runWh(['audit', '--state', auditState, '--json'], { root, ...read }), 0);
  const document = JSON.parse(read.stdout.text);
  assert.equal(document.events.length, 1);
  assert.equal(document.events[0].kind, 'install');
  assert.equal(document.events[0].action, 'install');
  assert.equal(document.events[0].actor.subject, 'alice');
  assert.equal(document.events[0].detail.digest, 'a'.repeat(64));
});

test('the audit append is capped, rejects malformed entries and never overwrites damaged state', async t => {
  const { root } = await fixture(t);
  const auditState = path.join(root, 'data', 'workspace.json');
  for (let index = 0; index < 3; index += 1)
    await appendAuditEntry(auditState, { kind: 'install', action: `install-${index}` }, { root, limit: 2 });
  const read = capture();
  assert.equal(await runWh(['audit', '--state', auditState, '--json'], { root, ...read }), 0);
  assert.deepEqual(JSON.parse(read.stdout.text).events.map(event => event.action), ['install-2', 'install-1']);

  await assert.rejects(appendAuditEntry(auditState, { kind: 'Bad Kind', action: 'install' }, { root }), error => error.code === 'HARNESS_STORAGE_INVALID');
  await assert.rejects(appendAuditEntry(auditState, { kind: 'install', action: 'install', body: 'nope' }, { root }), error => error.code === 'HARNESS_STORAGE_INVALID');

  const damaged = path.join(root, 'damaged.json');
  await fs.writeFile(damaged, '{not json', 'utf8');
  await assert.rejects(appendAuditEntry(damaged, { kind: 'install', action: 'install' }, { root }), error => error.code === 'HARNESS_STORAGE_INVALID');
  assert.equal(await fs.readFile(damaged, 'utf8'), '{not json', 'damaged state is never overwritten');
});

test('wh install/uninstall/rollback write install events to --audit-state', async t => {
  const { root, source } = await fixture(t);
  const auditState = path.join(root, 'data', 'workspace.json');
  await packageAt(source);

  const installed = capture();
  assert.equal(await runWh(['install', source, '--actor', 'ops', '--audit-state', auditState], { root, ...installed }), 0);
  const removed = capture();
  assert.equal(await runWh(['uninstall', 'sample-plugin', '--actor', 'ops', '--audit-state', auditState], { root, ...removed }), 0);
  const restored = capture();
  assert.equal(await runWh(['rollback', 'sample-plugin', '--actor', 'ops', '--audit-state', auditState], { root, ...restored }), 0);

  const read = capture();
  assert.equal(await runWh(['audit', '--state', auditState, '--json'], { root, ...read }), 0);
  const events = JSON.parse(read.stdout.text).events;
  assert.deepEqual(events.map(event => event.action), ['rollback', 'uninstall', 'install'], 'newest first');
  assert.ok(events.every(event => event.kind === 'install' && event.ok === true && event.actor.subject === 'ops'));
  assert.match(events[0].detail.digest, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(read.stdout.text, /apply\(ctx\)|installed fixture/u, 'only metadata reaches the audit stream');
});
test('drift check compares installed content with the latest journalled digest', async t => {
  const { root, source, plugins } = await fixture(t);
  await packageAt(source);
  await installPlugin({ sourceDir: source, root });

  let drift = await checkInstallDrift({ root });
  assert.equal(drift.ok, true);
  assert.deepEqual(drift.packages.map(item => item.status), ['ok']);
  assert.deepEqual(drift.missing, []);

  // Tampering with installed content is detected.
  await fs.writeFile(path.join(plugins, 'sample-plugin', 'index.mjs'), `${PLUGIN_SOURCE}\n// tampered after install\n`, 'utf8');
  drift = await checkInstallDrift({ root });
  assert.equal(drift.ok, false);
  assert.equal(drift.packages[0].status, 'drift');
  assert.notEqual(drift.packages[0].installedDigest, drift.packages[0].journalDigest);
  const checked = capture();
  assert.equal(await runWh(['installed', '--check'], { root, ...checked }), 1);
  assert.match(checked.stdout.text, /MISMATCH/u);
  assert.match(checked.stdout.text, /drift/u);

  // Re-installing the same package restores the journalled digest.
  await installPlugin({ sourceDir: source, root, upgrade: true });
  drift = await checkInstallDrift({ root });
  assert.equal(drift.ok, true);
  const repaired = capture();
  assert.equal(await runWh(['installed', '--check', '--json'], { root, ...repaired }), 0);
  assert.equal(JSON.parse(repaired.stdout.text).ok, true);
});

test('drift check reports untracked copies and journalled packages that vanished', async t => {
  const { root, source, plugins } = await fixture(t);
  await packageAt(source);
  await installPlugin({ sourceDir: source, root });

  // A package copied in by hand has no journal record. That is reported, but it is
  // not a failure by default because git-checkout plugins are legitimately untracked;
  // --strict turns it into one.
  await packageAt(path.join(root, 'manual'), { id: 'manual-plugin' });
  await fs.cp(path.join(root, 'manual'), path.join(plugins, 'manual-plugin'), { recursive: true });
  let drift = await checkInstallDrift({ root });
  assert.equal(drift.ok, true, 'untracked copies are reported but tolerated by default');
  assert.deepEqual(drift.untracked, ['manual-plugin']);
  assert.equal(drift.packages.find(item => item.id === 'manual-plugin').status, 'untracked');
  const strictDrift = await checkInstallDrift({ root, strict: true });
  assert.equal(strictDrift.ok, false);
  const strictCli = capture();
  assert.equal(await runWh(['installed', '--check', '--strict'], { root, ...strictCli }), 1);
  assert.match(strictCli.stdout.text, /untracked package\(s\)/u);

  // Deleting an installation behind the journal's back is reported as missing.
  await fs.rm(path.join(plugins, 'sample-plugin'), { recursive: true, force: true });
  await fs.rm(path.join(plugins, 'manual-plugin'), { recursive: true, force: true });
  drift = await checkInstallDrift({ root });
  assert.equal(drift.ok, false);
  assert.deepEqual(drift.missing, ['sample-plugin']);

  // An uninstall clears the expectation, so the check is clean again.
  await installPlugin({ sourceDir: source, root });
  await uninstallPlugin({ id: 'sample-plugin', root });
  drift = await checkInstallDrift({ root });
  assert.equal(drift.ok, true);
  assert.deepEqual(drift.missing, []);
});