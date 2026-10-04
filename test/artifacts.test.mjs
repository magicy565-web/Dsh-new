import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createArtifactService, ARTIFACT_MAX_BYTES } from '../server/artifacts.mjs';
const digest = content => createHash('sha256').update(content).digest('hex');
const blob = artifact => `${artifact.id}.v${artifact.currentVersion}.${artifact.sha256}.blob`;
const code = expected => error => error.code === expected;
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-artifacts-'));
  const store = await openStore(directory);
  const artifacts = await createArtifactService({ store, directory: path.join(directory, 'artifacts'), ...options });
  t.after(async () => { await artifacts.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, store, artifacts, artifactDirectory: path.join(directory, 'artifacts') };
}

test('UTF-8 artifacts and metadata reload durably, with private files and SHA-256 provenance', async t => {
  const { artifacts, store, directory, artifactDirectory } = await fixture(t);
  const content = '# 工作草稿\nReadable after restart';
  const { artifact } = await artifacts.create({ filename: '工作草稿.md', content, title: 'Saved draft', metadata: { category: 'draft' } });
  assert.equal(artifact.size, Buffer.byteLength(content)); assert.equal(artifact.sha256, digest(content)); assert.equal(artifact.currentVersion, 1);
  assert.equal((await artifacts.read(artifact.id)).content, content); assert.equal((await artifacts.inspect(artifact.id)).versions[0].verified, true);
  const download = await artifacts.download(artifact.id); assert.ok(Buffer.isBuffer(download.bytes)); assert.equal(download.filename, '工作草稿.md'); assert.equal(download.mimeType, 'text/markdown');
  if (process.platform !== 'win32') { assert.equal((await fs.stat(artifactDirectory)).mode & 0o777, 0o700); for (const name of await fs.readdir(artifactDirectory)) assert.equal((await fs.stat(path.join(artifactDirectory, name))).mode & 0o777, 0o600); }
  await artifacts.close(); await store.close();
  const reopenedStore = await openStore(directory); const reopened = await createArtifactService({ store: reopenedStore, directory: artifactDirectory });
  t.after(async () => { await reopened.close(); await reopenedStore.close(); });
  assert.equal((await reopened.read(artifact.id)).content, content); assert.deepEqual(reopened.get(artifact.id).artifact.metadata, { category: 'draft' }); assert.equal(reopened.recovery.unavailableVersions.length, 0);
});

test('content revisions retain immutable bytes and metadata edits support optimistic concurrency', async t => {
  const { artifacts } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'draft.txt', content: 'version one' });
  const second = (await artifacts.update(artifact.id, { content: 'version two', filename: 'edited.txt', expectedRevision: 1 })).artifact;
  assert.equal(second.currentVersion, 2); assert.equal(second.revision, 2); assert.equal(second.versions.length, 2);
  assert.equal((await artifacts.read(artifact.id, { version: 1 })).content, 'version one'); assert.equal((await artifacts.read(artifact.id, { version: '2' })).content, 'version two');
  const renamed = (await artifacts.update(artifact.id, { filename: 'renamed.txt', title: 'Final title', description: 'A useful description', metadata: { approved: false }, expectedRevision: 2 })).artifact;
  assert.equal(renamed.currentVersion, 2); assert.equal(renamed.revision, 3); assert.equal((await artifacts.download(artifact.id)).filename, 'renamed.txt'); assert.equal((await artifacts.download(artifact.id, { version: 1 })).filename, 'draft.txt');
  await assert.rejects(artifacts.update(artifact.id, { title: 'stale', expectedRevision: 1 }), code('REVISION_CONFLICT'));
  await assert.rejects(artifacts.update(artifact.id, { filename: 'changed.pdf' }), code('INVALID_INPUT'));
  await assert.rejects(artifacts.read(artifact.id, { version: 99 }), code('NOT_FOUND'));
  assert.equal((await artifacts.export(artifact.id)).bytes.toString(), 'version two');
});

test('source association validation is strict, while deleting sources preserves historical artifacts', async t => {
  const { artifacts, store } = await fixture(t);
  await store.update(state => { state.conversations.push({ id: 'c1' }, { id: 'c2' }); state.goals.push({ id: 'g1', conversationId: 'c1' }); state.runs.push({ id: 'r1', goalId: 'g1', conversationId: 'c1' }); });
  const { artifact } = await artifacts.create({ filename: 'result.txt', content: 'result', sourceGoalId: 'g1', sourceConversationId: 'c1', sourceRunId: 'r1' });
  assert.equal(artifacts.list({ sourceGoalId: 'g1' }).artifacts[0].id, artifact.id);
  await assert.rejects(artifacts.create({ filename: 'bad.txt', content: '', sourceGoalId: 'missing' }), code('SOURCE_NOT_FOUND'));
  await assert.rejects(artifacts.create({ filename: 'bad.txt', content: '', sourceGoalId: 'g1', sourceConversationId: 'c2' }), code('SOURCE_MISMATCH'));
  await assert.rejects(artifacts.update(artifact.id, { sourceRunId: 'missing' }), code('SOURCE_NOT_FOUND'));
  await store.update(state => { state.goals = []; state.runs = []; state.conversations = []; });
  assert.equal((await artifacts.read(artifact.id)).content, 'result'); await artifacts.update(artifact.id, { title: 'Historical result' });
  assert.equal(artifacts.get(artifact.id).artifact.sourceGoalId, 'g1');
});

test('safe filename normalization never uses supplied names as filesystem paths', async t => {
  const { artifacts, artifactDirectory } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: ' useful<draft>.txt ', content: '<script>never executable</script>' });
  assert.equal(artifact.filename, 'useful_draft_.txt');
  assert.ok((await fs.readdir(artifactDirectory)).includes(blob(artifact))); assert.ok(!(await fs.readdir(artifactDirectory)).includes(artifact.filename));
  for (const filename of ['../escape.txt', '..\\escape.txt', '/tmp/escape.txt', 'C:\\temp\\escape.txt', '.hidden.txt', 'x\r\nHeader.txt', 'nul.txt', 'CON.txt', 'report.html', 'evil.svg', 'run.js', 'archive.zip']) await assert.rejects(artifacts.create({ filename, content: 'no' }));
  await assert.rejects(artifacts.create({ filename: 'plain.txt', content: 'x', mimeType: 'text/html' }), code('UNSUPPORTED_ARTIFACT_TYPE'));
  assert.equal(artifacts.list().artifacts.length, 1);
  assert.throws(() => artifacts.get('../workspace.json'), code('NOT_FOUND'));
});

test('uploads enforce byte-size bounds, canonical encoding, UTF-8, safe JSON input and allowed MIME types', async t => {
  const { artifacts } = await fixture(t, { maxBytes: 12 });
  for (const body of [null, [], {}, { filename: 'a.txt' }, { filename: 'a.txt', content: 'x', base64: 'eA==' }, { filename: 'a.txt', content: 3 }, { filename: 'a.txt', base64: 'YQ' }, { filename: 'a.txt', base64: 'YR==' }, { filename: 'a.txt', base64: 'data:text/plain;base64,YQ==' }, { filename: 'a.txt', base64: 'AA==' }, { filename: 'a.txt', base64: '/w==' }, { filename: 'a.txt', content: '', unknown: true }, { filename: 'a.json', content: '{invalid' }, { filename: 'a.png', content: 'text' }, { filename: 'a.pdf', base64: Buffer.from('wrong').toString('base64') }, { filename: 'a.txt', content: 'ok', metadata: [] }, { filename: 'a.txt', content: 'ok', metadata: JSON.parse('{"__proto__":{"polluted":true}}') }]) await assert.rejects(artifacts.create(body));
  for (const body of [{ content: '1234567890123' }, { content: '你好你好你' }, { base64: Buffer.alloc(13, 97).toString('base64') }]) await assert.rejects(artifacts.create({ filename: 'too-big.txt', ...body }), code('ARTIFACT_TOO_LARGE'));
  const { artifact } = await artifacts.create({ filename: 'exact.txt', content: '123456789012' }); assert.equal(artifact.size, 12);
  assert.equal({}.polluted, undefined);
});

test('base64 binary artifacts round-trip only through explicit inert byte downloads', async t => {
  const { artifacts } = await fixture(t);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
  const { artifact } = await artifacts.create({ filename: 'image.png', base64: png.toString('base64'), mimeType: 'image/png' });
  assert.deepEqual((await artifacts.download(artifact.id)).bytes, png);
  const content = await artifacts.read(artifact.id); assert.equal(content.encoding, 'base64'); assert.equal(content.content, png.toString('base64'));
  await assert.rejects(artifacts.read(artifact.id, { encoding: 'utf8' }), code('INVALID_INPUT'));
});

test('byte quotas and artifact-count bounds include all retained versions', async t => {
  const { artifacts } = await fixture(t, { maxBytes: 64, maxTotalBytes: 128, maxArtifacts: 2 });
  const first = (await artifacts.create({ filename: 'one.txt', content: 'a'.repeat(40) })).artifact;
  const second = (await artifacts.create({ filename: 'two.txt', content: 'b'.repeat(40) })).artifact;
  await assert.rejects(artifacts.create({ filename: 'three.txt', content: '' }), code('ARTIFACT_QUOTA'));
  await artifacts.update(first.id, { content: 'c'.repeat(40) });
  await assert.rejects(artifacts.update(first.id, { content: 'd'.repeat(9) }), code('ARTIFACT_QUOTA'));
  await artifacts.delete(second.id); await artifacts.update(first.id, { content: 'e'.repeat(40) }); assert.equal(artifacts.get(first.id).artifact.versions.length, 3);
});

test('idempotent upload retries do not create duplicate files and conflicting requests fail', async t => {
  const { artifacts, artifactDirectory } = await fixture(t);
  const input = { filename: 'retry.txt', content: 'same content', requestId: 'upload-1' };
  const [first, second] = await Promise.all([artifacts.create(input), artifacts.create(input)]);
  assert.equal(first.artifact.id, second.artifact.id); assert.equal(second.duplicate, true);
  assert.equal((await fs.readdir(artifactDirectory)).filter(name => name.endsWith('.blob')).length, 1);
  await assert.rejects(artifacts.create({ ...input, content: 'different' }), code('IDEMPOTENCY_CONFLICT'));
  const withMetadata = { ...input, requestId: 'upload-2', metadata: { a: 1, b: 2 } };
  const initial = await artifacts.create(withMetadata); const reordered = await artifacts.create({ ...withMetadata, metadata: { b: 2, a: 1 } });
  assert.equal(initial.artifact.id, reordered.artifact.id); assert.equal(reordered.duplicate, true);
});

test('symlink and hard-link artifact bytes cannot leak external content', async t => {
  if (process.platform === 'win32') return t.skip('Creating symlinks needs additional Windows privileges.');
  const { artifacts, artifactDirectory, directory } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'safe.txt', content: 'safe' });
  const filename = path.join(artifactDirectory, blob(artifact)); const outside = path.join(directory, 'external.txt'); await fs.writeFile(outside, 'external secret');
  await fs.unlink(filename); await fs.symlink(outside, filename);
  await assert.rejects(artifacts.download(artifact.id), code('ARTIFACT_UNSAFE')); assert.equal((await artifacts.inspect(artifact.id)).versions[0].available, false);
  await fs.unlink(filename); await fs.link(outside, filename); await assert.rejects(artifacts.read(artifact.id), code('ARTIFACT_UNSAFE'));
  await artifacts.delete(artifact.id); assert.equal(await fs.readFile(outside, 'utf8'), 'external secret');
});

test('symlink directories, root replacement and second artifact writers are refused', async t => {
  const { store, artifacts, artifactDirectory, directory } = await fixture(t);
  await assert.rejects(createArtifactService({ store, directory: artifactDirectory }), /already open/);
  if (process.platform === 'win32') return;
  const alias = path.join(directory, 'alias'); await fs.symlink(artifactDirectory, alias); await assert.rejects(createArtifactService({ store, directory: alias }), /symbolic link/);
  const moved = path.join(directory, 'moved-artifacts'); await fs.rename(artifactDirectory, moved); await fs.mkdir(artifactDirectory);
  await assert.rejects(artifacts.create({ filename: 'no.txt', content: 'no' }), /directory changed/);
  await fs.rmdir(artifactDirectory); await fs.rename(moved, artifactDirectory);
});

test('same-size corruption and missing blobs report integrity errors without erasing metadata', async t => {
  const { artifacts, artifactDirectory } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'bytes.txt', content: 'before' }); const filename = path.join(artifactDirectory, blob(artifact));
  await fs.writeFile(filename, 'after!'); await assert.rejects(artifacts.download(artifact.id), code('ARTIFACT_INTEGRITY'));
  await fs.unlink(filename); await assert.rejects(artifacts.download(artifact.id), code('ARTIFACT_UNAVAILABLE'));
  assert.equal(artifacts.get(artifact.id).artifact.sha256, artifact.sha256); assert.equal((await artifacts.inspect(artifact.id)).versions[0].verified, false);
});

test('restart recovers unreferenced and interrupted files, preserving referenced corruption and unrelated files', async t => {
  const { artifacts, store, directory, artifactDirectory } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'preserve.txt', content: 'saved' });
  await artifacts.close(); await store.close();
  const orphan = `${randomUUID()}.v1.${digest('orphan')}.blob`; const upload = `.${randomUUID()}.upload`;
  await fs.writeFile(path.join(artifactDirectory, orphan), 'orphan'); await fs.writeFile(path.join(artifactDirectory, upload), 'interrupted'); await fs.writeFile(path.join(artifactDirectory, 'unrelated.keep'), 'keep');
  await fs.writeFile(path.join(artifactDirectory, blob(artifact)), 'wrong');
  const reopenedStore = await openStore(directory); const reopened = await createArtifactService({ store: reopenedStore, directory: artifactDirectory });
  t.after(async () => { await reopened.close(); await reopenedStore.close(); });
  assert.equal(reopened.recovery.orphanFilesRemoved, 2); assert.deepEqual(reopened.recovery.unavailableVersions, [{ artifactId: artifact.id, version: 1, code: 'ARTIFACT_INTEGRITY' }]);
  assert.equal(await fs.readFile(path.join(artifactDirectory, blob(artifact)), 'utf8'), 'wrong'); assert.equal(await fs.readFile(path.join(artifactDirectory, 'unrelated.keep'), 'utf8'), 'keep'); assert.equal(reopened.list().artifacts.length, 1);
});

test('failed metadata commits clean newly written blobs and cannot invent stored artifacts', async t => {
  const { artifacts, store, artifactDirectory } = await fixture(t);
  await store.close(); await assert.rejects(artifacts.create({ filename: 'not-committed.txt', content: 'content' }), /closed/);
  assert.equal(store.read().artifacts.length, 0); assert.deepEqual((await fs.readdir(artifactDirectory)).filter(name => name.endsWith('.blob')), []);
});

test('deletion removes every version and survives reload without resurrection', async t => {
  const { artifacts, store, directory, artifactDirectory } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'delete.txt', content: 'one' }); await artifacts.update(artifact.id, { content: 'two' });
  assert.deepEqual(await artifacts.delete(artifact.id), { ok: true }); assert.equal(artifacts.list().artifacts.length, 0);
  assert.deepEqual((await fs.readdir(artifactDirectory)).filter(name => name.endsWith('.blob')), []); assert.throws(() => artifacts.get(artifact.id), code('NOT_FOUND'));
  await artifacts.close(); await store.close(); const reopenedStore = await openStore(directory); const reopened = await createArtifactService({ store: reopenedStore, directory: artifactDirectory });
  t.after(async () => { await reopened.close(); await reopenedStore.close(); }); assert.equal(reopened.list().artifacts.length, 0);
});

test('close drains uploads and forbids new artifact operations', async t => {
  const { artifacts } = await fixture(t);
  const upload = artifacts.create({ filename: 'last.txt', content: 'last' }); const closing = artifacts.close();
  const { artifact } = await upload; await closing; assert.equal(artifacts.get(artifact.id).artifact.filename, 'last.txt');
  await assert.rejects(artifacts.create({ filename: 'late.txt', content: 'no' }), code('ARTIFACTS_CLOSED')); await artifacts.close();
});

test('unsafe persisted artifact metadata is rejected before orphan cleanup can delete files', async t => {
  const { artifacts, store, artifactDirectory } = await fixture(t); await artifacts.close();
  await store.update(state => { state.artifacts.push({ id: randomUUID(), versions: [{ version: '../outside', sha256: 'bad' }], revision: 1, currentVersion: 1 }); });
  const orphan = `${randomUUID()}.v1.${digest('keep')}.blob`; await fs.writeFile(path.join(artifactDirectory, orphan), 'keep');
  await assert.rejects(createArtifactService({ store, directory: artifactDirectory }), /artifact/); assert.equal(await fs.readFile(path.join(artifactDirectory, orphan), 'utf8'), 'keep');
});

test('service limit configuration cannot bypass upload safety ceiling', async t => {
  const { store, directory } = await fixture(t);
  await assert.rejects(createArtifactService({ store, directory: path.join(directory, 'other'), maxBytes: ARTIFACT_MAX_BYTES + 1 }), /bounds/);
});

test('content version limit is bounded and preserves all previous versions', async t => {
  const { artifacts } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'versions.txt', content: '1' });
  for (let version = 2; version <= 100; version += 1) await artifacts.update(artifact.id, { content: String(version) });
  await assert.rejects(artifacts.update(artifact.id, { content: '101' }), code('ARTIFACT_VERSION_LIMIT'));
  assert.equal((await artifacts.read(artifact.id)).content, '100'); assert.equal((await artifacts.read(artifact.id, { version: 1 })).content, '1');
  assert.equal(artifacts.get(artifact.id).artifact.versions.length, 100);
});
