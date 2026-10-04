import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNativeRecoveryAdapter, loadNativeRecoveryAdapter } from '../server/native-recovery.mjs';

test('native recovery rejects incomplete, source-path and unreviewed runtime dependencies', async t => {
  assert.throws(() => createNativeRecoveryAdapter({ SESSION_FORMAT_VERSION: 3 }), /reviewed native recovery/);
  await assert.rejects(loadNativeRecoveryAdapter('relative/package.json'), /reviewed built base or SDK runtime/);
  const root = await mkdtemp(path.join(tmpdir(), 'native-recovery-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = path.join(root, 'package.json');
  await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-sdk-jsonrpc-server', version: '0.1.0' }));
  await assert.rejects(loadNativeRecoveryAdapter(manifest), /Harness 0.2.0-rc.2/);
});

const sourceRoot = process.env.DSH_TEST_SOURCE_ROOT || fileURLToPath(new URL('../../muse-development/deepseek-harness-enterprise/', import.meta.url));
const sourceLoader = path.join(sourceRoot, 'node_modules/tsx/dist/esm/index.mjs');
test('native recovery uses real JSONL and native tool history; old work never replays after restore',
  { skip: !existsSync(sourceLoader), timeout: 60_000 }, async t => {
    const home = await mkdtemp(path.join(tmpdir(), 'workspace-native-recovery-home-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--import', sourceLoader, fileURLToPath(new URL('./fixtures/native-recovery-source.mjs', import.meta.url)), sourceRoot, fileURLToPath(new URL('../', import.meta.url))],
      { env: { PATH: process.env.PATH, HOME: home, TSX_TSCONFIG_PATH: path.join(sourceRoot, 'tsconfig.json') }, timeout: 55_000 });
    assert.match(stdout, /Real native backup, immutable-source migration, restrictive quarantine and no-replay recovery fixture passed/);
    assert.ok(!(stdout + stderr).includes('fixture-secret-never-copied'));
  });

const runtimePackagePath = path.join(sourceRoot, 'packages/bundle/base/package.json');
let builtExportsAvailable = false;
try {
  const require = createRequire(runtimePackagePath);
  builtExportsAvailable = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-sandbox-policy', '@deepseek-ai/dsh-user-approval', '@deepseek-ai/dsh-goal'].every(name => existsSync(require.resolve(name)));
} catch { /* Source-only checkouts have no built public exports. */ }
test('native recovery loader resolves reviewed built public exports from the explicit base manifest',
  { skip: !builtExportsAvailable, timeout: 30_000 }, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'native-recovery-built-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const adapter = await loadNativeRecoveryAdapter(runtimePackagePath);
    const summary = await adapter.inspect(path.join(root, 'sessions'), 'none');
    assert.equal(summary.runtimeVersion, '0.2.0-rc.2'); assert.deepEqual(summary.sessions, []);
    const sessionRoot = path.join(root, 'sessions'), sessionDir = path.join(sessionRoot, '--workspace--', 'fixture-built');
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const header = JSON.stringify({ type: 'session', version: 3, id: 'fixture-built', cwd: '/workspace', createdAt: 1, isSeeded: false, delegationDepth: 0 }) + '\n';
    await writeFile(path.join(sessionDir, 'session.v3.jsonl'), header, { mode: 0o600 });
    assert.equal((await adapter.inspect(sessionRoot, 'none')).sessions[0].eventCount, 0);
    const quarantine = await adapter.quarantine(sessionRoot, 'none');
    assert.equal(quarantine.permissionsReset, true); assert.equal(quarantine.inFlightReplayed, false);
    assert.deepEqual(quarantine.migrations, [{ id: 'fixture-built', from: 3, to: 4 }]);
    assert.equal(await readFile(path.join(sessionDir, 'session.v3.jsonl'), 'utf8'), header);
    assert.ok((await readdir(sessionDir)).includes('session.v4.jsonl'));
    const leases = await adapter.acquireLeases(sessionRoot); await leases.verify(); await leases.release();
  });
