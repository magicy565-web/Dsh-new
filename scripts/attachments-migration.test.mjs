import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listFiles, migrateAttachments } from './migrate-attachments.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'attachments-migration-'));
  const from = path.join(root, 'legacy');
  const to = path.join(root, 'data');
  await mkdir(path.join(from, 'nested'), { recursive: true });
  await writeFile(path.join(from, '像素.png'), PNG);
  await writeFile(path.join(from, 'nested', '说明.md'), '# 说明\n', 'utf8');
  return { root, from, to };
}

test('a dry run lists what would be imported and writes nothing', async () => {
  const { root, from, to } = await workspace();
  try {
    const report = await migrateAttachments({ from, to, apply: false });
    assert.equal(report.dryRun, true);
    assert.equal(report.files, 2);
    assert.equal(report.eligible, 2);
    assert.equal(report.imported, 0);
    assert.equal(report.planned.length, 2);
    assert.ok(report.planned.some(item => item.mimeType === 'image/png'));
    assert.ok(report.planned.some(item => item.mimeType === 'text/markdown'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('apply imports bytes through the real artifacts service, idempotently', async () => {
  const { root, from, to } = await workspace();
  try {
    const first = await migrateAttachments({ from, to, apply: true });
    assert.equal(first.imported, 2);
    assert.equal(first.duplicates, 0);

    const second = await migrateAttachments({ from, to, apply: true });
    assert.equal(second.imported, 0);
    assert.equal(second.duplicates, 2);

    const { createFileStore } = await import('./migrate-attachments.mjs');
    const { createArtifacts } = await import('../packages/harness-seams/src/artifacts.mjs');
    const store = createFileStore(path.join(to, 'workspace.json'));
    await store.load();
    const artifacts = await createArtifacts({ store, directory: path.join(to, 'artifacts') });
    const listed = artifacts.list({});
    assert.equal(listed.artifacts.length, 2);
    const png = listed.artifacts.find(item => item.filename === '像素.png');
    assert.equal(png.mimeType, 'image/png');
    const downloaded = await artifacts.download(png.id);
    assert.deepEqual(Buffer.from(downloaded.bytes), PNG);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an oversized file is reported instead of imported', async () => {
  const { root, from, to } = await workspace();
  try {
    await writeFile(path.join(from, 'big.bin'), Buffer.alloc(5 * 1024 * 1024 + 1));
    const report = await migrateAttachments({ from, to, apply: true });
    assert.ok(report.skipped.some(item => item.file === 'big.bin' && item.reason === 'TOO_LARGE'));
    assert.equal(report.imported, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a missing source directory is refused', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'attachments-missing-'));
  try {
    await assert.rejects(
      migrateAttachments({ from: path.join(root, 'nope'), to: path.join(root, 'data'), apply: false }),
      error => error.code === 'ATTACHMENT_SOURCE',
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('directory walking stays bounded', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'attachments-walk-'));
  try {
    await mkdir(path.join(root, 'a', 'b'), { recursive: true });
    await writeFile(path.join(root, 'a', 'b', 'deep.txt'), 'x');
    assert.deepEqual(await listFiles(root), [path.join('a', 'b', 'deep.txt')]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
