// Storage seam tests: real durable stores in real temp directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_DIRECTORY,
  REPO_ROOT,
  createStorage,
  createStorageProvider,
  resolveStorageDirectory,
} from '../src/storage.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { openStore } from '../../../server/store.mjs';
import { captureError, closeAfter, harnessError, makeTempDirectory, removeDirectory } from './helpers.mjs';

const newDirectory = async (t, label = 'seams-storage') => {
  const directory = await makeTempDirectory(label);
  removeDirectory(t, directory);
  return directory;
};

test('opens the real workspace store and persists state across a restart', async t => {
  const directory = await newDirectory(t);
  const first = await createStorage({ directory });
  closeAfter(t, first);
  assert.equal(first.directory, await fs.realpath(directory));
  const initial = first.read();
  assert.ok(initial.meta && Number.isInteger(initial.meta.sequence), 'store snapshot has meta.sequence');
  assert.ok(Array.isArray(initial.meta ? initial.harnessAudit ?? [] : []), 'harnessAudit starts absent or as an array');
  const result = await first.update(state => {
    state.harnessAudit = [{ id: 'persisted-entry', note: 'survives restart' }];
    return 'updated';
  });
  assert.equal(result, 'updated');
  await first.close();

  const second = await createStorage({ directory });
  closeAfter(t, second);
  assert.deepEqual(second.read().harnessAudit, [{ id: 'persisted-entry', note: 'survives restart' }]);
  await second.close();
});

test('read returns a detached snapshot and update commits atomically', async t => {
  const directory = await newDirectory(t);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  const snapshot = storage.read();
  snapshot.harnessAudit = [{ id: 'mutated-outside-the-store' }];
  assert.notDeepEqual(storage.read().harnessAudit, snapshot.harnessAudit);

  const sequence = storage.read().meta.sequence;
  await storage.update(state => {
    state.harnessAudit = [{ id: 'committed' }];
  });
  const committed = storage.read();
  assert.deepEqual(committed.harnessAudit, [{ id: 'committed' }]);
  assert.equal(committed.meta.sequence, sequence + 1);
});

test('apply(ctx) registers ctx.storage and the disposer closes it', async t => {
  const directory = await newDirectory(t);
  const ctx = {};
  const provider = createStorageProvider({ directory });
  const dispose = await provider.apply(ctx, { directory });
  assert.equal(ctx.storage.directory, await fs.realpath(directory));
  assert.equal(typeof ctx.storage.read, 'function');
  assert.equal(typeof ctx.storage.update, 'function');
  assert.equal(typeof ctx.storage.close, 'function');
  await ctx.storage.update(state => {
    state.harnessAudit = [{ id: 'through-provider' }];
  });
  const service = ctx.storage;
  await dispose();
  await assert.rejects(service.update(() => {}), /closed|Cannot read/i);
  assert.equal(ctx.storage, undefined, 'plain-object context has the service removed on dispose');
});

test('a second storage provider refuses to overwrite an existing ctx.storage', async t => {
  const directory = await newDirectory(t);
  const ctx = {};
  const first = createStorageProvider({ directory });
  const dispose = await first.apply(ctx, { directory });
  t.after(dispose);
  const second = createStorageProvider({ directory });
  await assert.rejects(second.apply(ctx, { directory }), harnessError(ERROR.pluginDuplicate));
  assert.ok(ctx.storage, 'original service is untouched');
});

test('a damaged workspace state is refused exactly like the original store', async t => {
  const directory = await newDirectory(t);
  const created = await createStorage({ directory });
  await created.close();
  const filename = path.join(directory, 'workspace.json');
  const damaged = `${JSON.stringify({ version: 3, name: 'damaged' })}\n`;
  await fs.writeFile(filename, damaged);

  const original = await captureError(() => openStore(directory));
  assert.equal(original.code, 'WORKSPACE_DATA_INVALID');
  assert.match(original.message, /no data has been overwritten/i);

  const adapted = await captureError(() => createStorage({ directory, root: process.cwd() }));
  assert.equal(adapted.name, original.name);
  assert.equal(adapted.code, original.code);
  assert.equal(adapted.message, original.message);
  assert.equal(await fs.readFile(filename, 'utf8'), damaged, 'the damaged state was not overwritten');
});

test('relative config.directory must stay inside the repository root', async t => {
  const root = await newDirectory(t, 'seams-root');
  assert.throws(() => resolveStorageDirectory('..', root), harnessError(ERROR.storageInvalid));
  assert.throws(
    () => resolveStorageDirectory(path.join('..', 'escaped-storage'), root),
    harnessError(ERROR.storageInvalid),
  );
  assert.throws(() => resolveStorageDirectory('', root), harnessError(ERROR.storageInvalid));
  assert.throws(() => resolveStorageDirectory('.', root), harnessError(ERROR.storageInvalid));
  const outsideName = `seams-escaped-${randomUUID()}`;
  await assert.rejects(
    createStorage({ directory: path.join('..', outsideName), root }),
    harnessError(ERROR.storageInvalid),
  );
  await assert.rejects(fs.stat(path.join(path.dirname(root), outsideName)));
});

test('the live Workspace data directory is always refused', async t => {
  const root = await newDirectory(t, 'seams-root');
  assert.throws(() => resolveStorageDirectory('.data', root), harnessError(ERROR.storageInvalid));
  assert.throws(() => resolveStorageDirectory(path.join(root, '.data'), root), harnessError(ERROR.storageInvalid));
  assert.throws(
    () => resolveStorageDirectory(path.join(root, '.data', 'nested'), root),
    harnessError(ERROR.storageInvalid),
  );
  await assert.rejects(createStorage({ directory: '.data', root }), harnessError(ERROR.storageInvalid));
  await assert.rejects(fs.stat(path.join(root, '.data')));
});

test('resolution rule: relative under root, absolute honoured, default is .harness-data', async t => {
  const root = await newDirectory(t, 'seams-root');
  // The default root is this checkout (derived from the module location, not cwd).
  assert.equal(REPO_ROOT, path.resolve(REPO_ROOT));
  assert.equal(resolveStorageDirectory(DEFAULT_DIRECTORY), path.join(REPO_ROOT, DEFAULT_DIRECTORY));
  assert.equal(resolveStorageDirectory(undefined, root), path.join(root, DEFAULT_DIRECTORY));
  assert.equal(resolveStorageDirectory('.harness-data', root), path.join(root, '.harness-data'));
  const absolute = path.join(os.tmpdir(), `seams-absolute-${randomUUID()}`);
  assert.equal(resolveStorageDirectory(absolute, root), path.resolve(absolute));
  assert.throws(() => resolveStorageDirectory('.harness-data', 'relative-root'), harnessError(ERROR.storageInvalid));

  // A relative directory inside the root is a valid mount and stays inside it.
  const relativeStorage = await createStorage({ directory: 'relative-data', root });
  closeAfter(t, relativeStorage);
  assert.equal(relativeStorage.directory, await fs.realpath(path.join(root, 'relative-data')));
  await relativeStorage.close();
  assert.ok((await fs.stat(path.join(root, 'relative-data'))).isDirectory());
});
