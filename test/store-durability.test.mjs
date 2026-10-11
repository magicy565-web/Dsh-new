import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, constants } from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { openStore, syncDirectory } from '../server/store.mjs';
import { assertWindowsDirectoryVolume } from '../server/windows-volume.mjs';
import { createArtifactService } from '../server/artifacts.mjs';

async function directory(t) {
  const root = path.resolve(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(root, 'workspace-durability-'));
  t.after(async () => {
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), root);
    assert.ok(path.basename(target).startsWith('workspace-durability-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  return dir;
}
const fault = (code = 'EPERM') => Object.assign(Error('Injected local storage failure'), { code });

test('directory flush uses required access, verifies identity, and preserves contents', async t => {
  const dir = await directory(t), original = fs.open.bind(fs), opens = [];
  await fs.writeFile(path.join(dir, 'keep.txt'), 'untouched');
  t.mock.method(fs, 'open', async (...args) => { if (args[0] === dir) opens.push(args[1]); return original(...args); });
  await syncDirectory(dir);
  assert.deepEqual(opens, [(process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW || 0)]);
  assert.equal(await fs.readFile(path.join(dir, 'keep.txt'), 'utf8'), 'untouched');
});

test('volume query is fixed, bounded, read-only and never substitutes success for unverified storage', async t => {
  const values = [{ fileSystem: 'ReFS', driveType: 3, flags: 8 }, { fileSystem: 'exFAT', driveType: 3, flags: 8 },
    { fileSystem: 'NTFS', driveType: 4, flags: 8 }, { fileSystem: 'NTFS', driveType: 3, flags: 0 },
    { fileSystem: 'NTFS', driveType: 3, flags: 0x80008 }, null, 'bad-json'];
  for (const value of values) {
    const dir = await directory(t);
    const mock = t.mock.method(childProcess, 'execFile', (executable, args, options, callback) => {
      assert.ok(path.win32.isAbsolute(executable)); assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 15_000); assert.equal(options.maxBuffer, 4096); assert.equal(options.shell, undefined);
      assert.equal(options.env.WORKSPACE_VOLUME_QUERY_DIRECTORY, dir);
      assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
      const command = Buffer.from(args[3], 'base64').toString('utf16le');
      assert.ok(!command.includes(dir)); assert.ok(!command.includes('ExecutionPolicy'));
      callback(null, typeof value === 'string' ? value : JSON.stringify(value));
    });
    await assert.rejects(assertWindowsDirectoryVolume(dir, await fs.stat(dir)), { code: 'WORKSPACE_DURABILITY_UNSUPPORTED' });
    mock.mock.restore();
  }
  const dir = await directory(t), denied = fault();
  const mock = t.mock.method(childProcess, 'execFile', (_executable, _args, _options, callback) => callback(denied));
  await assert.rejects(assertWindowsDirectoryVolume(dir, await fs.stat(dir)), error => error.code === 'WORKSPACE_DURABILITY_UNSUPPORTED' && error.cause === denied);
  mock.mock.restore();
});

test('unsupported preflight retains exact original state, writer and recovery locks', async t => {
  const dir = await directory(t), original = fs.open.bind(fs), denied = fault();
  const evidence = { 'workspace.json': 'original state bytes', 'workspace.lock': 'original owner bytes', 'workspace.lock.recovery': 'original recovery bytes' };
  for (const [name, bytes] of Object.entries(evidence)) await fs.writeFile(path.join(dir, name), bytes);
  const mock = t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args); if (args[0] === dir) handle.sync = async () => { throw denied; }; return handle;
  });
  await assert.rejects(openStore(dir), error => error.code === 'WORKSPACE_DURABILITY_UNSUPPORTED' && error.cause === denied);
  mock.mock.restore();
  assert.deepEqual((await fs.readdir(dir)).sort(), Object.keys(evidence).sort());
  for (const [name, bytes] of Object.entries(evidence)) assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), bytes);
});

test('pre-rename sync, close and rename errors retain old state, cursor, lock and observers', async t => {
  for (const point of ['file-sync', 'file-close', 'rename']) await t.test(point, async t => {
    const dir = await directory(t), store = await openStore(dir), events = [];
    const name = path.join(dir, 'workspace.json'), before = await fs.readFile(name), lock = await fs.readFile(path.join(dir, 'workspace.lock'));
    store.subscribe(event => events.push(event));
    const denied = fault('EIO'), originalOpen = fs.open.bind(fs), originalRename = fs.rename.bind(fs);
    let injected = false;
    const open = t.mock.method(fs, 'open', async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).startsWith(name + '.') && !injected) {
        if (point === 'file-sync') handle.sync = async () => { injected = true; throw denied; };
        if (point === 'file-close') { const close = handle.close.bind(handle); handle.close = async () => { await close(); if (!injected) { injected = true; throw denied; } }; }
      }
      return handle;
    });
    const rename = t.mock.method(fs, 'rename', async (...args) => { if (point === 'rename' && args[1] === name && !injected) { injected = true; throw denied; } return originalRename(...args); });
    try {
      await assert.rejects(store.update(state => { state.settings.name = 'must not commit'; }), error => error === denied);
      assert.equal(injected, true); assert.deepEqual(await fs.readFile(name), before);
      assert.equal(store.read().meta.sequence, 0); assert.deepEqual(events, []);
      assert.deepEqual(await fs.readFile(path.join(dir, 'workspace.lock')), lock);
      assert.equal(store.diagnostics().durability, 'confirmed');
    } finally { open.mock.restore(); rename.mock.restore(); }
    await store.update(state => { state.settings.name = 'retry after known rollback'; });
    assert.deepEqual(events.map(event => event.sequence), [1]); await store.close();
    const reopened = await openStore(dir); assert.equal(reopened.read().meta.sequence, 1); await reopened.close();
  });
});

test('post-rename flush and close failures stop writes and never emit durable receipts', async t => {
  for (const point of ['directory-sync', 'directory-close', 'sync-and-close']) await t.test(point, async t => {
    const dir = await directory(t), store = await openStore(dir), events = [], originalOpen = fs.open.bind(fs);
    const denied = fault(), closeError = fault('EIO'), lock = await fs.readFile(path.join(dir, 'workspace.lock'));
    store.subscribe(event => events.push(event)); let injected = false, laterCalled = false;
    const open = t.mock.method(fs, 'open', async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] === dir && !injected) {
        const close = handle.close.bind(handle);
        if (point !== 'directory-close') handle.sync = async () => { injected = true; throw denied; };
        if (point !== 'directory-sync') handle.close = async () => { await close(); injected = true; throw closeError; };
      }
      return handle;
    });
    try {
      const first = store.update(state => { state.settings.name = 'replacement exists, durability uncertain'; });
      const second = store.update(() => { laterCalled = true; });
      await assert.rejects(first, error => {
        assert.equal(error.code, 'WORKSPACE_COMMIT_UNCERTAIN');
        assert.equal(error.cause, point === 'directory-close' ? closeError : denied);
        if (point === 'sync-and-close') assert.equal(error.cause.closeError, closeError);
        return true;
      });
      await assert.rejects(second, /writes are stopped/); assert.equal(laterCalled, false);
      assert.equal(store.read().meta.sequence, 1); assert.equal(store.diagnostics().durability, 'uncertain');
      assert.equal(store.diagnostics().state, 'writes-stopped'); assert.deepEqual(events, []);
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')).meta.sequence, 1);
      assert.deepEqual(await fs.readFile(path.join(dir, 'workspace.lock')), lock);
      await assert.rejects(store.update(() => {}), /writes are stopped/);
    } finally { open.mock.restore(); await store.close(); }
    const reopened = await openStore(dir); assert.equal(reopened.read().meta.sequence, 1); await reopened.close();
  });
});

test('directory identity and file hard-link checks remain enforced on Windows', async t => {
  const dir = await directory(t), original = fs.open.bind(fs), before = await fs.stat(dir);
  const mock = t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args); if (args[0] === dir) handle.stat = async () => ({ ...before, dev: before.dev + 1, isDirectory: () => true }); return handle;
  });
  await assert.rejects(syncDirectory(dir), /directory changed/); mock.mock.restore();
  const store = await openStore(dir); await store.close();
  const originalBytes = await fs.readFile(path.join(dir, 'workspace.json'));
  await fs.link(path.join(dir, 'workspace.json'), path.join(dir, 'hard-link-evidence.json'));
  await assert.rejects(openStore(dir), { code: 'WORKSPACE_DATA_UNREADABLE' });
  assert.deepEqual(await fs.readFile(path.join(dir, 'workspace.json')), originalBytes);
  assert.deepEqual(await fs.readFile(path.join(dir, 'hard-link-evidence.json')), originalBytes);
});

test('lost directory-sync permission during release preserves the original writer lock', async t => {
  const dir = await directory(t), store = await openStore(dir), original = fs.open.bind(fs), denied = fault();
  const owner = await fs.readFile(path.join(dir, 'workspace.lock')), bytes = await fs.readFile(path.join(dir, 'workspace.json'));
  const mock = t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args); if (args[0] === dir) handle.sync = async () => { throw denied; }; return handle;
  });
  await assert.rejects(store.close(), error => error === denied); mock.mock.restore();
  assert.deepEqual(await fs.readFile(path.join(dir, 'workspace.lock')), owner);
  assert.deepEqual(await fs.readFile(path.join(dir, 'workspace.json')), bytes);
  await assert.rejects(openStore(dir), /already open/);
});

test('trusted artifact ownership persists atomically, is immutable across retries, and cannot come from the public body', async t => {
  const dir = await directory(t), store = await openStore(dir), artifacts = await createArtifactService({ store });
  const owner = { subject: 'original/requester', workerId: 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1' };
  const input = { filename: 'owned.txt', content: 'exact owned bytes', requestId: 'trusted-owner-test' };
  await assert.rejects(artifacts.create({ ...input, workerOwner: owner }), { code: 'INVALID_INPUT' });
  assert.throws(() => artifacts.create(input, { workerOwner: { ...owner, arbitrary: true } }), { code: 'INVALID_INPUT' });
  const pending = artifacts.create(input, { workerOwner: owner }); owner.subject = 'mutated-after-admission';
  const made = await pending;
  assert.equal(made.artifact.workerOwner.subject, 'original/requester');
  await assert.rejects(artifacts.create(input, { workerOwner: owner }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await artifacts.create(input, { workerOwner: made.artifact.workerOwner })).duplicate, true);
  assert.equal(store.read().artifacts.length, 1);
  await artifacts.close(); await store.close();
  const reopened = await openStore(dir), files = await createArtifactService({ store: reopened });
  assert.deepEqual(reopened.read().artifacts[0].workerOwner, made.artifact.workerOwner);
  assert.equal((await files.download(made.artifact.id, { version: 1 })).bytes.toString(), input.content);
  await files.close(); await reopened.close();
});
