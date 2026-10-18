import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { harnessSourceIdentity } from './fixtures/harness-source-identity.mjs';
const hash = (kind, bytes) => createHash(kind).update(bytes).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-source-identity-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'); await fs.mkdir(source);
  const bytes = Buffer.from('synthetic source\n'); await fs.writeFile(path.join(source, 'source.mjs'), bytes);
  const manifest = { schema: 'workspace.source-acceptance-manifest.v1', commit: 'a'.repeat(40), appliedCommits: ['b'.repeat(40)],
    files: [{ path: 'source.mjs', bytes: bytes.length, sha256: hash('sha256', bytes), gitBlobSha1: hash('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])) }] };
  const manifestPath = path.join(directory, 'SOURCE_MANIFEST.json');
  const writeManifest = async () => { const raw = JSON.stringify(manifest); await fs.writeFile(manifestPath, raw); return { cwd: source, manifestPath, manifestSha256: hash('sha256', raw) }; };
  return { directory, source, manifest, writeManifest };
}
test('verified source subset reports exact pins without inventing a Git HEAD', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.source, 'dist')); await fs.writeFile(path.join(f.source, 'dist/index.html'), 'generated build');
  const options = await f.writeManifest(), value = await harnessSourceIdentity(options);
  assert.equal(value.sourceCommit, null); assert.deepEqual(value.sourceIdentity, { kind: 'verified-source-subset', baseCommit: 'a'.repeat(40), appliedCommits: ['b'.repeat(40)], manifestSha256: options.manifestSha256, fileCount: 1, fullGitTree: false });
});
test('changed source bytes cannot inherit a valid pinned manifest', async t => {
  const f = await fixture(t), options = await f.writeManifest(); await fs.writeFile(path.join(f.source, 'source.mjs'), 'tampered! source\n');
  await assert.rejects(harnessSourceIdentity(options), /mismatch/);
});
test('missing or incorrect external manifest pin fails closed', async t => {
  const f = await fixture(t), options = await f.writeManifest();
  await assert.rejects(harnessSourceIdentity({ ...options, manifestSha256: undefined }), /expected SHA256/);
  await assert.rejects(harnessSourceIdentity({ ...options, manifestSha256: '0'.repeat(64) }), /SHA256 mismatch/);
});
test('duplicate, traversal and excluded paths cannot become declared sources', async t => {
  const f = await fixture(t), original = { ...f.manifest.files[0] };
  f.manifest.files.push(original); await assert.rejects(harnessSourceIdentity(await f.writeManifest()), /duplicate source path/);
  for (const invalid of ['../outside', '/absolute', 'src/../source.mjs', 'src\\source.mjs', 'dist/index.html', 'node_modules/x']) {
    f.manifest.files = [{ ...original, path: invalid }];
    await assert.rejects(harnessSourceIdentity(await f.writeManifest()), /source path/);
  }
});
test('source symlinks fail even when their target bytes match the manifest', async t => {
  const f = await fixture(t), options = await f.writeManifest();
  await fs.rename(path.join(f.source, 'source.mjs'), path.join(f.directory, 'original.mjs'));
  await fs.symlink(path.join(f.directory, 'original.mjs'), path.join(f.source, 'source.mjs'));
  await assert.rejects(harnessSourceIdentity(options), /Regular source file/);
});
test('unlisted source files fail while generated build files remain separately identified', async t => {
  const f = await fixture(t), options = await f.writeManifest(); await fs.writeFile(path.join(f.source, 'extra.mjs'), 'unreviewed');
  await assert.rejects(harnessSourceIdentity(options), /Unexpected or missing source files/);
});
