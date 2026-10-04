import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
import { createBackup, verifyBackup, restoreBackup } from '../scripts/recovery.mjs';
import { createNativeStorageOverlay, readNativeStorageOverlay } from '../server/native-storage.mjs';
import { generateNativeStorageOverlay } from '../scripts/generate-native-bridge.mjs';
import { createHarnessProvider } from '../server/harness-provider.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'workspace-recovery-control-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'), backup = path.join(root, 'backup'), restored = path.join(root, 'restored');
  const app = await createApp({ dataDirectory: data }); await app.close();
  return { root, data, backup, restored };
}
// These exercise snapshot coordination only. The separate native-source suite
// verifies actual JSONL parsing, native migration, permissions and checkpoint repair.
async function syntheticNative(f, overrides = {}) {
  const id = 'workspace-session-' + 'a'.repeat(32);
  const dir = path.join(f.data, 'harness', 'sessions', 'fixture-project', id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'session.v4.jsonl'), 'Synthetic orchestration bytes, not a native session fixture\n');
  await fs.writeFile(path.join(dir, 'session.lock'), '');
  await fs.mkdir(path.join(f.data, 'harness', 'storages'), { recursive: true });
  await fs.writeFile(path.join(f.data, 'harness', 'storages', 'queued.json'), '{"fixture":"never execute"}');
  await fs.writeFile(path.join(f.data, 'harness', '.credentials.yaml'), 'synthetic-excluded-fixture');
  await fs.mkdir(path.join(f.data, 'agent-workspace')); await fs.writeFile(path.join(f.data, 'agent-workspace', 'result.txt'), 'Native workspace bytes');
  const state = JSON.parse(await fs.readFile(path.join(f.data, 'workspace.json')));
  state.conversations.push({ id: 'fixture-conversation', nativeSessionId: id, status: 'idle' });
  state.capabilities.skills.push({ id: 'skill', enabled: true }); state.capabilities.connectors.push({ id: 'connector', enabled: true });
  await fs.writeFile(path.join(f.data, 'workspace.json'), JSON.stringify(state));
  const summary = { runtimeVersion: '0.2.0-rc.2', sessionFormatVersion: 4, compression: 'none', sessions: [{ id, cwd: path.join(f.data, 'agent-workspace'), eventCount: 1, checkpointCount: 1 }] };
  const lease = { released: false, verified: false };
  const nativeAdapter = { inspect: async () => structuredClone(summary), quarantine: async () => ({ ...structuredClone(summary), permissionsReset: true, inFlightReplayed: false }), acquireLeases: async () => ({ release: async () => { lease.released = true; }, verify: async () => { lease.verified = true; } }), ...overrides };
  return { id, summary, lease, nativeAdapter, native: { compression: 'none' } };
}

test('native orchestration captures native bytes, quarantines durable queues and resets every app capability', async t => {
  const f = await fixture(t), n = await syntheticNative(f);
  await assert.rejects(createBackup(f.data, f.backup), /Unrecognized/);
  const result = await createBackup(f.data, f.backup, n);
  assert.equal(result.nativeRuntimeIncluded, true); assert.equal(n.lease.released, true); assert.equal(n.lease.verified, true);
  await assert.rejects(fs.stat(path.join(f.backup, 'harness', '.credentials.yaml')), { code: 'ENOENT' });
  const manifest = JSON.parse(await fs.readFile(path.join(f.backup, 'BACKUP-MANIFEST.json')));
  assert.deepEqual(manifest.excludedFiles, ['harness/.credentials.yaml']);
  await assert.rejects(verifyBackup(f.backup), /reviewed native recovery adapter/);
  await restoreBackup(f.backup, f.restored, n);
  assert.equal(await fs.readFile(path.join(f.restored, 'agent-workspace', 'result.txt'), 'utf8'), 'Native workspace bytes');
  await assert.rejects(fs.stat(path.join(f.restored, 'harness', 'storages')), { code: 'ENOENT' });
  assert.match(await fs.readFile(path.join(f.restored, 'recovery-quarantine', result.manifestSha256, 'harness', 'storages', 'queued.json'), 'utf8'), /never execute/);
  const state = JSON.parse(await fs.readFile(path.join(f.restored, 'workspace.json')));
  assert.equal(state.conversations[0].nativeSessionId, n.id);
  assert.equal(state.capabilities.skills[0].enabled, false); assert.equal(state.capabilities.connectors[0].enabled, false);
  const before = await fs.readFile(path.join(f.backup, 'workspace.json'));
  await assert.rejects(createApp({ dataDirectory: f.restored, provider: { kind: 'deepseek-harness', configured: false } }), { code: 'NATIVE_RESTORE_PATH_MISMATCH' });
  assert.deepEqual(await fs.readFile(path.join(f.backup, 'workspace.json')), before);
  // Native activation preserves the original absolute path; no history rewrite.
  await fs.rename(f.data, path.join(f.root, 'preserved-old')); await fs.rename(f.restored, f.data);
  const app = await createApp({ dataDirectory: f.data, provider: { kind: 'deepseek-harness', configured: false } });
  try {
    const address = await app.listen(0); const health = await (await fetch(`http://127.0.0.1:${address.port}/api/health`)).json();
    assert.equal(health.recovery.nativePathMatches, true); assert.equal(health.recovery.automaticWorkResumed, false);
    assert.equal(health.storage.schemaVersion, 2); assert.equal(health.storage.durability, 'confirmed');
  } finally { await app.close(); }
});

test('native restore remains unbootable throughout quarantine and a failed migration leaves original and snapshot unchanged', async t => {
  const f = await fixture(t), n = await syntheticNative(f);
  await createBackup(f.data, f.backup, n);
  const original = await fs.readFile(path.join(f.data, 'workspace.json'));
  n.nativeAdapter.quarantine = async () => {
    await assert.rejects(createApp({ dataDirectory: f.restored }), { code: 'RESTORE_INCOMPLETE' });
    throw new Error('Synthetic native migration failure');
  };
  await assert.rejects(restoreBackup(f.backup, f.restored, n), /Synthetic native migration failure/);
  await assert.rejects(fs.stat(f.restored), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(f.data, 'workspace.json')), original);
  assert.equal((await verifyBackup(f.backup, n)).verified, true);
});

test('native backup refuses incompatible native data or live native ownership before publishing snapshot', async t => {
  const f = await fixture(t), n = await syntheticNative(f);
  n.nativeAdapter.acquireLeases = async () => { throw new Error('Native session is still owned'); };
  await assert.rejects(createBackup(f.data, f.backup, n), /still owned/);
  await assert.rejects(fs.stat(f.backup), { code: 'ENOENT' });
  n.nativeAdapter.acquireLeases = async () => ({ release: async () => {} });
  n.nativeAdapter.inspect = async () => ({ ...n.summary, sessionFormatVersion: 5 });
  await assert.rejects(createBackup(f.data, f.backup, n), /incompatible/);
  n.nativeAdapter.inspect = async () => ({ ...n.summary, sessions: [] });
  await assert.rejects(createBackup(f.data, f.backup, n), /no durable native history/);
});

test('reviewed native storage overlay contains durable roots, preserves launch ownership and fingerprints exact bytes', async t => {
  const f = await fixture(t), dshHome = path.join(f.data, 'harness');
  const outputPath = path.join(f.root, 'storage.yml');
  await generateNativeStorageOverlay({ dshHome, compression: 'zstd', outputPath });
  const overlay = createNativeStorageOverlay({ dshHome, compression: 'zstd' });
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath)), overlay);
  assert.equal((await fs.stat(outputPath)).mode & 0o777, 0o600);
  assert.deepEqual(readNativeStorageOverlay(outputPath, dshHome), { compression: 'zstd' });
  await assert.rejects(generateNativeStorageOverlay({ dshHome, compression: 'zstd', outputPath }), { code: 'EEXIST' });
  const dshBin = path.join(f.root, 'fixture.mjs'), profilePatch = path.join(f.root, 'profile.yml');
  await fs.writeFile(dshBin, '// Synthetic fixture only'); await fs.writeFile(profilePatch, '# Fixture profile');
  let launch;
  class Harness { constructor(options) { launch = options; } async run(_input, { sessionId }) { return { sessionId, finalResponse: 'Explicit fixture response' }; } async close() {} }
  const options = { apiKey: 'synthetic-storage-fixture-key', dshBin, profilePatch, recoveryPatch: outputPath, dshHome, workspaceDirectory: path.join(f.data, 'agent-workspace'), HarnessClass: Harness };
  const provider = createHarnessProvider(options); t.after(() => provider.close());
  await provider.complete({ messages: [{ role: 'user', content: 'Synthetic request' }] });
  assert.deepEqual(launch.patches, [profilePatch, outputPath]);
  assert.equal(provider.recoveryStorage.configured, true);
  await fs.appendFile(outputPath, '\n');
  await assert.rejects(provider.complete({ messages: [{ role: 'user', content: 'No second call' }] }), { code: 'NATIVE_POLICY_CHANGED' });
  const changed = structuredClone(overlay); changed[3].config.root = '/tmp/uncontained-fixture';
  await fs.writeFile(outputPath, JSON.stringify(changed));
  assert.throws(() => createHarnessProvider(options), /Invalid reviewed native recovery storage patch/);
});
