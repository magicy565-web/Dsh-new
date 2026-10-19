import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publisherTrust, verifyReleaseEnvelope, releaseSummary } from '../../server/plugin-library/releases.mjs';
import { readPluginInventory, packageSnapshot } from '../../server/plugin-library/inventory.mjs';
import { fixture, signer } from './fixtures.mjs';
test('release verifies an actual ephemeral Ed25519 signature without execution', () => {
  const s = signer(), trust = publisherTrust([s.record]); const proof = verifyReleaseEnvelope(s.envelope(s.manifest), trust); assert.equal(proof.publisher, 'acme.labs'); assert.match(proof.fingerprint, /^[a-f0-9]{64}$/);
});
for (const [name, mutate] of [
  ['signature mismatch', envelope => { envelope.manifest.description = 'changed'; }],
  ['unknown key', envelope => { envelope.keyId = 'unknown'; }],
  ['extra public key', envelope => { envelope.publicKey = 'not trusted'; }],
]) test('release rejects ' + name, () => { const s = signer(), value = s.envelope(s.manifest); mutate(value); assert.throws(() => verifyReleaseEnvelope(value, publisherTrust([s.record]))); });
for (const [name, mutate] of [
  ['foreign namespace', m => { m.id = 'thirdparty.other.labs.example'; }],
  ['native JavaScript execution', m => { m.execution = 'native'; }],
  ['mutable image tag', m => { m.artifact.image = 'example.invalid/test:latest'; }],
  ['host filesystem grant', m => { m.permissions.hostFilesystem = 'read'; }],
  ['network access', m => { m.permissions.network = 'all'; }],
  ['relative command', m => { m.artifact.command = ['main.js']; }],
  ['oversized command', m => { m.artifact.command = Array(33).fill('/main'); }],
]) test('release rejects signed ' + name, () => { const s = signer(), m = structuredClone(s.manifest); mutate(m); assert.throws(() => verifyReleaseEnvelope(s.envelope(m), publisherTrust([s.record]))); });
test('release trust list rejects repeated keys and stale trust summary', () => {
  const s = signer(); assert.throws(() => publisherTrust([s.record, s.record])); const envelope = s.envelope(s.manifest), proof = verifyReleaseEnvelope(envelope, publisherTrust([s.record]));
  assert.equal(releaseSummary({ id: 'fixture', envelope, fingerprint: proof.fingerprint, status: 'published' }, new Map()).status, 'trust-unavailable');
});
test('inventory reads real manifests and never imports a throwing extension', async t => {
  const f = await fixture(t); const view = await readPluginInventory({ root: f.root }); assert.equal(view.packages.length, 1); assert.equal(view.codeExecuted, false); assert.equal(view.onlineVerified, false); assert.equal(view.packages[0].skills.length, 1);
});
test('inventory identity excludes runtime state but includes exact config bytes', async t => {
  const f = await fixture(t); const a = await readPluginInventory({ root: f.root, backendSelection: { enabled: () => true } }); const b = await readPluginInventory({ root: f.root, backendSelection: { enabled: () => false } }); assert.equal(a.snapshotSha256, b.snapshotSha256);
  await fs.appendFile(path.join(f.root, 'config.json'), '\n'); const c = await readPluginInventory({ root: f.root }); assert.notEqual(a.snapshotSha256, c.snapshotSha256);
});
test('inventory tracks source changes and preserves selection semantics', async t => {
  const f = await fixture(t); const a = await readPluginInventory({ root: f.root }); await f.write(f.pluginId + '/README.md', 'new reviewed bytes'); const b = await readPluginInventory({ root: f.root }); assert.notEqual(a.packages[0].packageSha256, b.packages[0].packageSha256);
  await f.write('config.json', JSON.stringify({ extensions: ['./' + f.pluginId], disabledExtensions: ['extension-module:' + f.pluginId] })); const c = await readPluginInventory({ root: f.root }); assert.equal(c.packages[0].selectedIn.includes('config.json'), false);
});
test('inventory refuses selected missing packages instead of substituting a fixture', async t => {
  const f = await fixture(t); await fs.rm(f.packageDirectory, { recursive: true }); await assert.rejects(readPluginInventory({ root: f.root }));
});
test('inventory refuses links and required-resource removal', async t => {
  const f = await fixture(t); await fs.symlink('/dev/null', path.join(f.packageDirectory, 'linked')); await assert.rejects(packageSnapshot(f.packageDirectory)); await fs.unlink(path.join(f.packageDirectory, 'linked'));
  await fs.unlink(path.join(f.packageDirectory, 'AGENTS.md')); await assert.rejects(readPluginInventory({ root: f.root }));
});
test('inventory is blocked by an unfinished selection barrier', async t => {
  const f = await fixture(t); await f.write('.plugin-selection-transaction.json', '{}'); await assert.rejects(readPluginInventory({ root: f.root }), error => error.code === 'PROJECT_PLUGIN_RECONCILIATION_REQUIRED');
});
test('inventory refuses a manifest edit between discovery and package hashing', async t => {
  const f = await fixture(t), manifestPath = path.join(f.packageDirectory, 'package.json'); const originalOpen = fs.open;
  let changed = false;
  t.mock.method(fs, 'open', async function(file, ...args) {
    if (!changed && file === path.join(f.packageDirectory, 'README.md')) {
      changed = true; const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); manifest.version = '2.0.0'; await fs.writeFile(manifestPath, JSON.stringify(manifest));
    }
    return originalOpen.call(fs, file, ...args);
  });
  await assert.rejects(readPluginInventory({ root: f.root })); assert.equal(changed, true);
});
test('release rejects noncanonical signature padding bits', () => {
  const s = signer(), envelope = s.envelope(s.manifest), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const index = alphabet.indexOf(envelope.signature[85]); envelope.signature = envelope.signature.slice(0, 85) + alphabet[index + 1] + '==';
  assert.throws(() => verifyReleaseEnvelope(envelope, publisherTrust([s.record])));
});
for (const executable of ['/app/..', '//app/main', '/app/./main', '/']) test('release rejects noncanonical executable ' + executable, () => {
  const s = signer(), m = structuredClone(s.manifest); m.artifact.command = [executable]; assert.throws(() => verifyReleaseEnvelope(s.envelope(m), publisherTrust([s.record])));
});
