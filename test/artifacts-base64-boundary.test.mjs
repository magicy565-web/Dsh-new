import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createArtifactService, ARTIFACT_MAX_BYTES } from '../server/artifacts.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-artifact-base64-'));
  const store = await openStore(directory);
  const artifacts = await createArtifactService({ store, directory: path.join(directory, 'artifacts') });
  t.after(async () => {
    await artifacts.close(); await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { artifacts, store };
}
function pdfBytes(size) {
  const bytes = Buffer.alloc(size, 255);
  bytes.write('%PDF-', 0, 'ascii');
  return bytes;
}

// The three sizes cover canonical no-padding, == and = endings at the
// original maximum. These are inert synthetic bytes, not parsed documents.
for (const size of [ARTIFACT_MAX_BYTES - 2, ARTIFACT_MAX_BYTES - 1, ARTIFACT_MAX_BYTES]) {
  test(`canonical binary upload of ${size} bytes retains the original maximum and exact bytes`, async t => {
    const { artifacts } = await fixture(t), bytes = pdfBytes(size);
    const { artifact } = await artifacts.create({ filename: 'synthetic.pdf', base64: bytes.toString('base64') });
    assert.equal(artifact.size, size);
    assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual((await artifacts.download(artifact.id)).bytes, bytes);
  });
}

test('canonical empty, unpadded groups and both padded endings remain accepted', async t => {
  const { artifacts } = await fixture(t);
  for (const content of ['', 'a', 'ab', 'abc', 'abcd', '中文']) {
    const { artifact } = await artifacts.create({ filename: 'synthetic.txt', base64: Buffer.from(content).toString('base64') });
    assert.equal((await artifacts.read(artifact.id)).content, content);
  }
});

test('invalid alphabet, padding, pad bits, whitespace and data URL syntax still fail before persistence', async t => {
  const { artifacts, store } = await fixture(t);
  for (const base64 of ['a', 'YQ', 'YQ=', 'YQ===', 'YWJ', 'Y=Q=', '=YQ=', '====', 'YQ==YQ==',
    'YR==', 'YWJ=', 'YQ==\n', 'YQ==\r\n', ' YQ==', 'Y Q==', 'YQ==\t', 'YQ==\0',
    '-w==', '_w==', 'Y?==', 'Yé==', 'Y😀==', 'data:text/plain;base64,YQ==']) {
    await assert.rejects(artifacts.create({ filename: 'invalid.txt', base64 }), error => error.code === 'INVALID_INPUT' && error.status === 400, JSON.stringify(base64));
  }
  assert.equal(store.read().artifacts.length, 0);
});

test('decoded overflow sharing the maximum encoded length and encoded overflow both retain 413', async t => {
  const { artifacts, store } = await fixture(t);
  const encodedLimit = Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4;
  for (const extra of [1, 2]) {
    const base64 = pdfBytes(ARTIFACT_MAX_BYTES + extra).toString('base64');
    if (extra === 1) assert.equal(base64.length, encodedLimit);
    else assert.ok(base64.length > encodedLimit);
    await assert.rejects(artifacts.create({ filename: 'too-large.pdf', base64 }), error => error.code === 'ARTIFACT_TOO_LARGE' && error.status === 413);
  }
  assert.equal(store.read().artifacts.length, 0);
});
