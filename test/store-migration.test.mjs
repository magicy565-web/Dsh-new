import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openStore, SUPPORTED_STORE_VERSIONS } from '../server/store.mjs';

const storeModule = new URL('../server/store.mjs', import.meta.url).href;
const backupName = 'workspace.v1.backup.json';
const legacy = () => ({ version: 1, conversations: [{ id: 'saved-chat', title: 'Saved conversation' }], messages: [{ id: 'saved-message', conversationId: 'saved-chat', content: '已有内容 🌱' }], goals: [], activity: [], memories: [], settings: { name: 'Existing workspace' }, extension: { untouched: true } });
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-migration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function writeLegacy(dir) {
  const raw = `${JSON.stringify(legacy(), null, 4)}\n`;
  await fs.writeFile(path.join(dir, 'workspace.json'), raw);
  return raw;
}

// Faults apply only to this child process and its synthetic test directory.
// Deliberate process exits leave actual abandoned files/locks, without adding
// fault-injection callbacks or environment variables to production code.
function interruptedOpen(dir, point) {
  const code = `
    import { promises as fs } from 'node:fs';
    import path from 'node:path';
    import { openStore } from ${JSON.stringify(storeModule)};
    const [directory, point] = process.argv.slice(1);
    const originalOpen = fs.open.bind(fs), originalRename = fs.rename.bind(fs);
    const crash = () => process.exit(73);
    const ioFailure = () => Object.assign(new Error('Synthetic local disk failure'), { code: 'ENOSPC' });
    let lastPublished;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), name = path.basename(String(args[0]));
      if (name.startsWith('workspace.v1.backup.json.') && name.endsWith('.tmp')) {
        const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
        handle.writeFile = async data => {
          if (['partial-backup-write', 'failed-backup-write'].includes(point)) {
            await write(String(data).slice(0, 17));
            if (point === 'partial-backup-write') crash();
            throw ioFailure();
          }
          return write(data);
        };
        handle.sync = async () => { await sync(); if (point === 'synced-backup-stage') crash(); };
      }
      if (String(args[0]) === directory) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if ((point === 'failed-backup-directory-sync' && lastPublished === 'workspace.v1.backup.json') || (point === 'failed-state-directory-sync' && lastPublished === 'workspace.json')) {
            lastPublished = null; throw ioFailure();
          }
          return sync();
        };
      }
      return handle;
    };
    fs.rename = async (from, to) => {
      const name = path.basename(to);
      if (name === 'workspace.json' && point === 'before-state-publish') crash();
      await originalRename(from, to); lastPublished = name;
      if ((name === 'workspace.v1.backup.json' && point === 'published-backup') || (name === 'workspace.json' && point === 'published-state')) crash();
    };
    try {
      const store = await openStore(directory); await store.close();
      process.stdout.write(JSON.stringify({ unexpectedSuccess: true }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ code: error.code, phase: error.phase, message: error.message }));
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code, dir, point], { encoding: 'utf8', timeout: 10000 });
}

test('migration survives process exits at every publication boundary without exposing a partial backup', async t => {
  for (const point of ['partial-backup-write', 'synced-backup-stage', 'published-backup', 'before-state-publish', 'published-state']) await t.test(point, async t => {
    const dir = await directory(t), raw = await writeLegacy(dir);
    const result = interruptedOpen(dir, point);
    assert.equal(result.status, 73, result.stderr || result.stdout);
    const before = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    assert.equal(JSON.parse(before).version, point === 'published-state' ? 2 : 1);
    if (point !== 'published-state') assert.equal(before, raw);
    if (['partial-backup-write', 'synced-backup-stage'].includes(point)) await assert.rejects(fs.stat(path.join(dir, backupName)), { code: 'ENOENT' });
    else assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), raw);
    const store = await openStore(dir);
    assert.equal(store.read().version, 2);
    assert.deepEqual(store.read().messages, legacy().messages);
    assert.deepEqual(store.read().extension, legacy().extension);
    assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), raw);
    const diagnostics = store.diagnostics();
    assert.equal(diagnostics.startup.action, point === 'published-state' ? 'opened' : 'migrated');
    assert.equal(diagnostics.migrationBackup.status, 'verified-v1');
    if (['partial-backup-write', 'synced-backup-stage', 'before-state-publish'].includes(point)) assert.equal(diagnostics.startup.abandonedWritesRemoved, 1);
    assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')).length, 0);
    await store.close();
    const again = await openStore(dir);
    assert.equal(again.diagnostics().startup.action, 'opened');
    assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), raw);
    await again.close();
  });
});

test('backup I/O failures retain v1; uncertain migration commit is distinct and safe to reopen', async t => {
  for (const point of ['failed-backup-write', 'failed-backup-directory-sync', 'failed-state-directory-sync']) await t.test(point, async t => {
    const dir = await directory(t), raw = await writeLegacy(dir);
    const result = interruptedOpen(dir, point);
    assert.equal(result.status, 0, result.stderr);
    const failure = JSON.parse(result.stdout);
    const uncertainCommit = point === 'failed-state-directory-sync';
    assert.equal(failure.code, uncertainCommit ? 'WORKSPACE_COMMIT_UNCERTAIN' : 'WORKSPACE_MIGRATION_BACKUP_FAILED');
    assert.equal(failure.phase, uncertainCommit ? 'migration-commit' : 'migration-backup');
    const current = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    if (uncertainCommit) assert.equal(JSON.parse(current).version, 2);
    else assert.equal(current, raw);
    await assert.rejects(fs.stat(path.join(dir, 'workspace.lock')), { code: 'ENOENT' });
    const store = await openStore(dir);
    assert.equal(store.read().version, 2);
    assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), raw);
    await store.close();
  });
});

test('legacy partial backup blocks migration with actionable diagnostics and preserves every byte', async t => {
  const dir = await directory(t), raw = await writeLegacy(dir), partial = raw.slice(0, 17);
  await fs.writeFile(path.join(dir, backupName), partial);
  await assert.rejects(openStore(dir), error => {
    assert.equal(error.code, 'WORKSPACE_MIGRATION_BACKUP_CONFLICT');
    assert.equal(error.phase, 'migration-backup');
    assert.match(error.message, /new directory/); return true;
  });
  assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), raw);
  assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), partial);
  assert.deepEqual((await fs.readdir(dir)).sort(), [backupName, 'workspace.json'].sort());
});

test('validated legacy source can be upgraded in a fresh destination without altering the blocked source', async t => {
  const root = await directory(t), source = path.join(root, 'source'), destination = path.join(root, 'new-data');
  await fs.mkdir(source, { mode: 0o700 });
  const raw = await writeLegacy(source), partial = raw.slice(0, 17);
  await fs.writeFile(path.join(source, backupName), partial);
  await assert.rejects(openStore(source), { code: 'WORKSPACE_MIGRATION_BACKUP_CONFLICT' });
  await fs.mkdir(destination, { mode: 0o700 });
  const copy = await fs.open(path.join(destination, 'workspace.json'), 'wx', 0o600);
  try { await copy.writeFile(await fs.readFile(path.join(source, 'workspace.json'))); await copy.sync(); } finally { await copy.close(); }
  const recovered = await openStore(destination);
  assert.equal(recovered.diagnostics().startup.action, 'migrated');
  assert.deepEqual(recovered.read().messages, legacy().messages);
  assert.equal(await fs.readFile(path.join(destination, backupName), 'utf8'), raw);
  assert.equal(await fs.readFile(path.join(source, 'workspace.json'), 'utf8'), raw);
  assert.equal(await fs.readFile(path.join(source, backupName), 'utf8'), partial);
  await recovered.close();
});

test('exact existing backup is synced, reused and made private before migration', async t => {
  const dir = await directory(t), raw = await writeLegacy(dir);
  await fs.writeFile(path.join(dir, backupName), raw, { mode: 0o644 });
  const store = await openStore(dir);
  assert.equal(store.diagnostics().startup.migrationBackup, 'reused');
  assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), raw);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, backupName))).mode & 0o777, 0o600);
  await store.close();
});

test('startup distinguishes unknown schema from invalid data without changing either', async t => {
  const dir = await directory(t);
  for (const [version, code] of [[3, 'WORKSPACE_VERSION_UNSUPPORTED'], [0, 'WORKSPACE_VERSION_UNSUPPORTED'], ['2', 'WORKSPACE_DATA_INVALID']]) {
    const raw = JSON.stringify({ ...legacy(), version });
    await fs.writeFile(path.join(dir, 'workspace.json'), raw);
    await assert.rejects(openStore(dir), error => { assert.equal(error.code, code); assert.equal(error.phase, 'validate'); return true; });
    assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), raw);
    assert.deepEqual(await fs.readdir(dir), ['workspace.json']);
  }
  assert.deepEqual(SUPPORTED_STORE_VERSIONS, [1, 2]);
});

test('missing authoritative state with write evidence fails closed instead of creating an empty workspace', async t => {
  for (const name of [backupName, `workspace.json.${randomUUID()}.tmp`, `${backupName}.${randomUUID()}.tmp`]) await t.test(name, async t => {
    const dir = await directory(t), raw = JSON.stringify(legacy());
    await fs.writeFile(path.join(dir, name), raw);
    await assert.rejects(openStore(dir), error => { assert.equal(error.code, 'WORKSPACE_STATE_MISSING'); assert.match(error.message, /new data directory/); return true; });
    assert.deepEqual(await fs.readdir(dir), [name]);
    assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), raw);
  });
});

test('incomplete restore marker blocks startup before a writer lock is created', async t => {
  for (const markerType of ['file', 'directory']) await t.test(markerType, async t => {
    const dir = await directory(t), marker = path.join(dir, 'RECOVERY-INCOMPLETE.json');
    if (markerType === 'file') await fs.writeFile(marker, '{"incomplete":true}');
    else await fs.mkdir(marker);
    for (const withState of [false, true]) {
      if (withState) await writeLegacy(dir);
      await assert.rejects(openStore(dir), error => { assert.equal(error.code, 'RESTORE_INCOMPLETE'); return true; });
      await assert.rejects(fs.stat(path.join(dir, 'workspace.lock')), { code: 'ENOENT' });
      if (withState) assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')).version, 1);
    }
  });
});

test('startup diagnostics are detached and report unusable rollback backup without blocking valid v2', async t => {
  const dir = await directory(t), store = await openStore(dir);
  assert.equal(store.diagnostics().startup.action, 'created');
  assert.equal(store.diagnostics().startup.sourceVersion, null);
  assert.equal(store.diagnostics().migrationBackup.status, 'absent');
  const view = store.diagnostics(); view.startup.action = 'wrong'; view.supportedVersions.push(9);
  assert.equal(store.diagnostics().startup.action, 'created');
  assert.deepEqual(store.diagnostics().supportedVersions, [1, 2]);
  await store.update(state => { state.settings.name = 'Retained v2 state'; });
  assert.equal(store.diagnostics().sequence, 1); await store.close();
  assert.equal(store.diagnostics().state, 'closed');
  const before = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
  await fs.writeFile(path.join(dir, backupName), 'partial legacy backup');
  const reopened = await openStore(dir);
  assert.equal(reopened.read().settings.name, 'Retained v2 state');
  assert.equal(reopened.diagnostics().migrationBackup.status, 'invalid');
  assert.equal(reopened.diagnostics().warnings[0].code, 'WORKSPACE_MIGRATION_BACKUP_UNAVAILABLE');
  assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), before);
  assert.equal(await fs.readFile(path.join(dir, backupName), 'utf8'), 'partial legacy backup');
  await reopened.close();
});

test('migration staging evidence is retained when a valid v2 store has no usable final backup', async t => {
  const dir = await directory(t), store = await openStore(dir); await store.close();
  const staged = `${backupName}.${randomUUID()}.tmp`, content = JSON.stringify(legacy());
  await fs.writeFile(path.join(dir, staged), content);
  const unrelated = `${backupName}.operator-copy.tmp`; await fs.writeFile(path.join(dir, unrelated), 'Keep this too');
  const reopened = await openStore(dir);
  assert.equal(reopened.diagnostics().startup.abandonedMigrationWritesRetained, 1);
  assert.equal(reopened.diagnostics().warnings[0].code, 'WORKSPACE_MIGRATION_STAGING_RETAINED');
  assert.equal(await fs.readFile(path.join(dir, staged), 'utf8'), content);
  assert.equal(await fs.readFile(path.join(dir, unrelated), 'utf8'), 'Keep this too');
  await reopened.close();
});

test('uncertain transaction durability is visible and prevents subsequent writes', async t => {
  const dir = await directory(t), store = await openStore(dir), events = [];
  store.subscribe(event => events.push(event));
  const originalOpen = fs.open.bind(fs); let fail = true;
  const mock = t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === dir) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => { if (fail) { fail = false; throw Object.assign(new Error('Synthetic directory sync failure'), { code: 'EIO' }); } await originalSync(); };
    }
    return handle;
  });
  try {
    await assert.rejects(store.update(state => { state.settings.name = 'Replacement reached disk'; }), { code: 'WORKSPACE_COMMIT_UNCERTAIN' });
    assert.equal(store.diagnostics().state, 'writes-stopped');
    assert.equal(store.diagnostics().durability, 'uncertain');
    assert.equal(store.diagnostics().sequence, 1);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')).settings.name, 'Replacement reached disk');
    await assert.rejects(store.update(() => {}), /writes are stopped/);
    assert.deepEqual(events, []);
  } finally { mock.mock.restore(); await store.close(); }
  const reopened = await openStore(dir);
  assert.equal(reopened.read().settings.name, 'Replacement reached disk');
  assert.equal(reopened.diagnostics().state, 'open');
  await reopened.close();
});
