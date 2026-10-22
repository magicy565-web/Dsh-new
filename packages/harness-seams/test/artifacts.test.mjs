// Artifacts seam tests: the real artifact service and the real storage seam in
// real temp directories, plus mounting through the real kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../../harness-kernel/src/app.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { createArtifacts, createArtifactsProvider, resolveArtifactsDirectory } from '../src/artifacts.mjs';
import { createStorage } from '../src/storage.mjs';
import { closeAfter, harnessError, makeTempDirectory, removeDirectory } from './helpers.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SILENT_LOGGER = Object.freeze({ error() {}, warn() {}, info() {}, debug() {} });
const ARTIFACT_METHODS = Object.freeze(['create', 'update', 'read', 'download', 'inspect', 'list', 'get', 'close']);

const newDirectory = async (t, label = 'seams-artifacts') => {
  const directory = await makeTempDirectory(label);
  removeDirectory(t, directory);
  return directory;
};

/** Open a real storage seam and a real artifacts seam on the same state directory. */
async function openPair(t, { storageDirectory, artifacts: artifactOptions = {} } = {}) {
  const directory = storageDirectory ?? (await newDirectory(t));
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  const artifacts = await createArtifacts({ store: storage, ...artifactOptions });
  closeAfter(t, artifacts);
  return { storage, artifacts };
}

test('create -> update -> read -> download round trip through the real services', async t => {
  const { storage, artifacts } = await openPair(t);
  assert.equal(artifacts.directory, await fs.realpath(path.join(storage.directory, 'artifacts')));
  assert.ok((await fs.stat(artifacts.directory)).isDirectory(), 'artifacts directory is created under the state directory');

  const created = await artifacts.create({
    filename: 'notes.md',
    content: '# Notes',
    title: 'Notes',
    description: 'round trip',
  });
  assert.match(created.artifact.id, /^[a-f0-9-]{36}$/u);
  assert.equal(created.artifact.currentVersion, 1);
  assert.equal(created.artifact.filename, 'notes.md');

  const first = await artifacts.read(created.artifact.id);
  assert.equal(first.encoding, 'utf8');
  assert.equal(first.content, '# Notes');
  assert.equal(first.version.version, 1);

  const download = await artifacts.download(created.artifact.id);
  assert.ok(Buffer.isBuffer(download.bytes));
  assert.equal(download.bytes.toString('utf8'), '# Notes');
  assert.equal(download.filename, 'notes.md');
  assert.equal(download.mimeType, 'text/markdown');

  const second = await artifacts.update(created.artifact.id, { content: '# Notes v2', title: 'Notes v2' });
  assert.equal(second.artifact.revision, 2);
  assert.equal(second.artifact.currentVersion, 2);
  assert.equal((await artifacts.read(created.artifact.id)).content, '# Notes v2');
  assert.equal((await artifacts.download(created.artifact.id, { version: 1 })).bytes.toString('utf8'), '# Notes');
  assert.equal(artifacts.list().artifacts.length, 1);
  assert.equal(artifacts.get(created.artifact.id).artifact.title, 'Notes v2');
});

test('metadata round trip keeps a nested inquiryRecovery object', async t => {
  const { artifacts } = await openPair(t);
  const inquiryRecovery = {
    leadId: 'lead-abc',
    sourceId: 'source-1',
    revision: 7,
    sourceHash: 'a'.repeat(64),
    importId: 'import-1',
    decision: 'follow_up',
    sent: false,
    humanReviewRequired: true,
    humanReviewed: false,
    independentlyVerified: false,
  };
  const created = await artifacts.create({
    filename: 'draft.md',
    content: 'unreviewed follow-up draft',
    metadata: { inquiryRecovery },
  });

  const got = artifacts.get(created.artifact.id).artifact;
  assert.deepEqual(got.metadata, { inquiryRecovery });
  assert.deepEqual(got.metadata.inquiryRecovery, inquiryRecovery);
  const listed = artifacts.list().artifacts.find(item => item.id === created.artifact.id);
  assert.deepEqual(listed.metadata.inquiryRecovery, inquiryRecovery);

  // Metadata reads are detached snapshots, not live store state.
  got.metadata.inquiryRecovery.leadId = 'mutated';
  assert.equal(artifacts.get(created.artifact.id).artifact.metadata.inquiryRecovery.leadId, 'lead-abc');
});

test('artifacts survive a close and a fresh reopen on the same state directory', async t => {
  const directory = await newDirectory(t);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  const artifacts = await createArtifacts({ store: storage });
  closeAfter(t, artifacts);
  const artifactDirectory = artifacts.directory;
  const created = await artifacts.create({ filename: 'persisted.txt', content: 'survives restart' });
  await artifacts.close();
  await storage.close();

  const reopenedStorage = await createStorage({ directory });
  closeAfter(t, reopenedStorage);
  const reopened = await createArtifacts({ store: reopenedStorage });
  closeAfter(t, reopened);
  assert.equal(reopened.directory, artifactDirectory);
  const read = await reopened.read(created.artifact.id);
  assert.equal(read.content, 'survives restart');
  assert.equal(read.version.sha256, created.artifact.sha256);
  assert.equal(reopened.list().artifacts.length, 1);
});

test('repeating create with the same requestId returns the same artifact without a duplicate record', async t => {
  const { artifacts } = await openPair(t);
  const body = {
    requestId: 'inquiry-recovery-idempotent-1',
    filename: 'draft.md',
    content: 'written once',
    title: 'Draft',
    metadata: { inquiryRecovery: { leadId: 'lead-1' } },
  };
  const first = await artifacts.create(body);
  const second = await artifacts.create({ ...body });
  assert.equal(second.duplicate, true);
  assert.equal(second.artifact.id, first.artifact.id);
  assert.equal(second.artifact.createdAt, first.artifact.createdAt);
  assert.equal(artifacts.list().artifacts.length, 1, 'no duplicate artifact record');
  assert.equal((await artifacts.download(first.artifact.id)).bytes.toString('utf8'), 'written once');

  await assert.rejects(
    artifacts.create({ ...body, content: 'different bytes' }),
    error => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409,
  );
  assert.equal(artifacts.list().artifacts.length, 1);
});

test('close() closes the artifact service and later operations fail', async t => {
  const { storage, artifacts } = await openPair(t);
  const created = await artifacts.create({ filename: 'closed.txt', content: 'before close' });
  const service = artifacts;

  await service.close();
  await service.close(); // idempotent
  const closedError = error => {
    assert.equal(error.code, 'ARTIFACTS_CLOSED');
    assert.equal(error.status, 503);
    return true;
  };
  await assert.rejects(service.create({ filename: 'after.txt', content: 'after close' }), closedError);
  await assert.rejects(service.download(created.artifact.id), closedError);
  await assert.rejects(service.read(created.artifact.id), closedError);
  await assert.rejects(service.inspect(created.artifact.id), closedError);

  // Closing artifacts never closes the storage service that owns the state.
  assert.equal(storage.read().artifacts.length, 1);
});

test('directory rules: inside the storage state directory only, never the repo root', async t => {
  const directory = await newDirectory(t);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  const stateDirectory = storage.directory;

  assert.equal(resolveArtifactsDirectory(undefined, stateDirectory), path.join(stateDirectory, 'artifacts'));
  assert.equal(resolveArtifactsDirectory('drafts', stateDirectory), path.join(stateDirectory, 'drafts'));
  assert.equal(
    resolveArtifactsDirectory(path.join(stateDirectory, 'custom', 'files'), stateDirectory),
    path.join(stateDirectory, 'custom', 'files'),
  );

  assert.throws(() => resolveArtifactsDirectory('', stateDirectory), harnessError(ERROR.storageInvalid));
  assert.throws(() => resolveArtifactsDirectory('   ', stateDirectory), harnessError(ERROR.storageInvalid));
  assert.throws(() => resolveArtifactsDirectory('.', stateDirectory), harnessError(ERROR.storageInvalid));
  assert.throws(() => resolveArtifactsDirectory('..', stateDirectory), harnessError(ERROR.storageInvalid));
  assert.throws(() => resolveArtifactsDirectory(path.join('..', 'escaped'), stateDirectory), harnessError(ERROR.storageInvalid));
  assert.throws(
    () => resolveArtifactsDirectory(path.resolve(stateDirectory, '..', 'escaped'), stateDirectory),
    harnessError(ERROR.storageInvalid),
  );
  assert.throws(
    () => resolveArtifactsDirectory(path.join(stateDirectory, '..', 'escaped'), stateDirectory),
    harnessError(ERROR.storageInvalid),
  );
  // REPO_ROOT itself is never the artifacts directory.
  assert.throws(
    () => resolveArtifactsDirectory('..', path.join(REPO_ROOT, '.harness-data')),
    error => {
      assert.equal(error.code, ERROR.storageInvalid);
      assert.match(error.message, /repository root/u);
      return true;
    },
  );
  // A storage service without an absolute state directory cannot mount artifacts.
  assert.throws(() => resolveArtifactsDirectory('artifacts', 'relative/state'), harnessError(ERROR.storageInvalid));

  const outside = path.join(path.dirname(stateDirectory), `seams-artifacts-outside-${randomUUID()}`);
  await assert.rejects(createArtifacts({ store: storage, directory: '..' }), harnessError(ERROR.storageInvalid));
  await assert.rejects(createArtifacts({ store: storage, directory: outside }), harnessError(ERROR.storageInvalid));
  await assert.rejects(
    createArtifacts({ store: { read: () => ({ artifacts: [] }), update() {} } }),
    harnessError(ERROR.storageInvalid),
  );
  await assert.rejects(fs.stat(outside), 'the refused directory was never created');

  // A safe relative directory really mounts below the state directory.
  const drafts = await createArtifacts({ store: storage, directory: 'drafts' });
  closeAfter(t, drafts);
  assert.equal(drafts.directory, await fs.realpath(path.join(stateDirectory, 'drafts')));
  const created = await drafts.create({ filename: 'custom.txt', content: 'custom directory' });
  assert.equal((await drafts.read(created.artifact.id)).content, 'custom directory');
});

test('provider refuses a context without storage, mounts ctx.artifacts with storage, and disposes closed', async t => {
  await assert.rejects(createArtifactsProvider().apply({}), harnessError(ERROR.pluginMissingDependency));

  const directory = await newDirectory(t);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  const ctx = { storage };
  const provider = createArtifactsProvider({ directory: 'seam-artifacts' });
  const dispose = await provider.apply(ctx, {});
  t.after(dispose);

  for (const method of ARTIFACT_METHODS) assert.equal(typeof ctx.artifacts[method], 'function', `ctx.artifacts.${method}`);
  assert.equal(ctx.artifacts.directory, await fs.realpath(path.join(storage.directory, 'seam-artifacts')));
  const created = await ctx.artifacts.create({ filename: 'plain.txt', content: 'through the provider' });
  assert.equal((await ctx.artifacts.read(created.artifact.id)).content, 'through the provider');
  assert.equal(ctx.artifacts.list().artifacts.length, 1);

  await assert.rejects(createArtifactsProvider().apply(ctx), harnessError(ERROR.pluginDuplicate));

  const service = ctx.artifacts;
  await dispose();
  assert.equal(ctx.artifacts, undefined, 'plain-object context has the service removed on dispose');
  await assert.rejects(
    service.create({ filename: 'after.txt', content: 'after dispose' }),
    error => error.code === 'ARTIFACTS_CLOSED',
  );
});

const compositionFor = rows => [
  'version: 1',
  'name: seams-artifacts',
  'server: { host: 127.0.0.1, port: 0 }',
  'plugins:',
  ...rows.flat(),
  '',
].join('\n');

const storageRow = dataDirectory => [
  '  - id: storage',
  '    name: "@workspace-harness/seams/storage"',
  `    config: { directory: ${JSON.stringify(dataDirectory)} }`,
];
const artifactsRow = () => ['  - id: artifacts', '    name: "@workspace-harness/seams/artifacts"'];

test('the kernel mounts storage + artifacts: ctx.artifacts exists and lives under the storage directory', async t => {
  const directory = await newDirectory(t, 'seams-artifacts-kernel');
  const dataDirectory = path.join(directory, 'data');
  const compositionPath = path.join(directory, 'artifacts.composition.yml');
  await fs.writeFile(compositionPath, compositionFor([storageRow(dataDirectory), artifactsRow()]), 'utf8');

  const harness = await createHarness({ compositionPath, root: REPO_ROOT, logger: SILENT_LOGGER });
  try {
    assert.deepEqual([...harness.plugins.keys()], ['storage', 'artifacts']);
    const { ctx } = harness;
    assert.ok(ctx.artifacts, 'the kernel context exposes ctx.artifacts');
    for (const method of ARTIFACT_METHODS) assert.equal(typeof ctx.artifacts[method], 'function', `ctx.artifacts.${method}`);
    assert.equal(typeof ctx.artifacts.directory, 'string');

    const storageDirectory = ctx.storage.directory;
    const expected = await fs.realpath(path.join(storageDirectory, 'artifacts'));
    assert.equal(ctx.artifacts.directory, expected);
    assert.equal(path.relative(storageDirectory, ctx.artifacts.directory), 'artifacts');
    assert.ok((await fs.stat(expected)).isDirectory());
    assert.equal(harness.healthz().status, 'ok');

    const created = await ctx.artifacts.create({ filename: 'kernel.txt', content: 'mounted through the kernel' });
    assert.equal((await ctx.artifacts.read(created.artifact.id)).content, 'mounted through the kernel');
    assert.ok(
      ctx.storage.read().artifacts.some(item => item.id === created.artifact.id),
      'artifact metadata is committed to the shared durable store',
    );
  } finally {
    await harness.stop();
  }
});

test('the kernel refuses an artifacts composition without a storage provider', async t => {
  const directory = await newDirectory(t, 'seams-artifacts-orphan');
  const compositionPath = path.join(directory, 'orphan.composition.yml');
  await fs.writeFile(compositionPath, compositionFor([artifactsRow()]), 'utf8');
  await assert.rejects(
    createHarness({ compositionPath, root: REPO_ROOT, logger: SILENT_LOGGER }),
    harnessError(ERROR.pluginMissingDependency),
  );
});
