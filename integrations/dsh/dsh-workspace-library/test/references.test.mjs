import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { LibraryStore, createLibraryService, createHttpHandler, apply, resolveDataDirectory, API_PREFIX } from '../index.js';
import { resolveDataDirectory as spaceDirectory } from '../../dsh-space-workspace/index.js';

test('both plugins follow native DSH_HOME, explicit overrides and existing profile fallback', () => {
  const originalHome = process.env.DSH_HOME, originalProfile = process.env.DSH_PROFILE_DIR;
  try {
    process.env.DSH_HOME = join(tmpdir(), 'native-home');
    process.env.DSH_PROFILE_DIR = join(tmpdir(), 'old-home', 'profiles', 'web');
    for (const [directory, name] of [[resolveDataDirectory, 'workspace-library'], [spaceDirectory, 'space-workspace']]) {
      assert.equal(directory(), join(tmpdir(), 'native-home', 'data', name));
      assert.equal(directory({ dataDir: './custom-data' }), resolve('custom-data'));
      process.env.DSH_HOME = '~/native-test';
      assert.equal(directory(), join(homedir(), 'native-test', 'data', name));
      process.env.DSH_HOME = ' ';
      assert.equal(directory(), join(tmpdir(), 'old-home', 'data', name));
      process.env.DSH_HOME = join(tmpdir(), 'native-home');
    }
  } finally {
    for (const [key, value] of [['DSH_HOME', originalHome], ['DSH_PROFILE_DIR', originalProfile]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

const pin = document => ({ documentId: document.id, version: document.versions[0].version, sha256: document.versions[0].sha256 });
async function setup(t, attachments = null) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-library-references-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LibraryStore({ dir });
  return { dir, store, service: createLibraryService(store, { attachments }) };
}
function attachmentStore() {
  const blobs = new Map();
  return {
    blobs,
    async saveFile({ data, name }) {
      const hash = createHash('sha256').update(data).digest('hex');
      const ref = { attachmentId: `sha256:${hash}`, name, bytes: data.length };
      blobs.set(ref.attachmentId, Buffer.from(data));
      return ref;
    },
    async *readFileStream(ref) { yield blobs.get(ref.attachmentId); },
  };
}

test('discovery is metadata-only and old pins keep their own content and review after a new version', async t => {
  const { service } = await setup(t);
  const first = await service.addDocument({ title: '供货政策', content: 'MOQ 300', slotKey: 'supply_policy' });
  await service.reviewDocument(first.id, 1, { expectedRevision: 1, decision: 'verified' });
  await service.addDocumentVersion(first.id, { content: 'MOQ 900' });
  const choices = await service.referenceCandidates({ q: '供货', limit: 20 });
  assert.deepEqual(choices.items.map(item => item.version), [2, 1]);
  assert.equal(choices.items.some(item => 'content' in item || 'attachment' in item), false);
  const result = await service.readReferences([pin(first)]);
  assert.equal(result.items[0].content, 'MOQ 300');
  assert.equal(result.items[0].source.reviewState, 'verified');
  assert.equal(result.items[0].source.currentVersion, 2);
  assert.equal(result.items[0].source.isCurrentVersion, false);
  assert.equal(choices.items[0].isCurrentVersion, true);
  assert.equal((await service.checkReferences([pin(first)])).references[0].version, 1);
});

test('native text attachments are verified by bytes and hash, including UTF-8 validation', async t => {
  const attachments = attachmentStore();
  const { service } = await setup(t, attachments);
  const doc = await service.addDocument({ title: '价格资料', fileName: 'prices.csv', mimeType: 'text/csv', data: Buffer.from('SKU,价格\nA,10\n') });
  const result = await service.readReferences([pin(doc)]);
  assert.match(result.items[0].content, /SKU,价格/u);
  const before = (await service.documents()).items[0];
  assert.equal(before.hasContent, true);
  assert.equal(before.hasFile, true);
  assert.equal(before.hasInlineText, false);
  await service.updateDocument(doc.id, { expectedRevision: 1, changes: { status: 'archived' } });
  assert.equal((await service.documents({ status: 'archived' })).items[0].hasContent, true, 'archiving does not turn a stored file into empty content');
  await service.updateDocument(doc.id, { expectedRevision: 2, changes: { status: 'active' } });
  attachments.blobs.set(doc.versions[0].attachment.attachmentId, Buffer.from('tampered'));
  await assert.rejects(() => service.readReferences([pin(doc)]), { code: 'REFERENCE_CHANGED' });
  const bad = await service.addDocument({ title: '坏编码', fileName: 'bad.txt', mimeType: 'text/plain', data: Buffer.from([0xc3, 0x28]) });
  await assert.rejects(() => service.readReferences([pin(bad)]), { code: 'REFERENCE_UNSUPPORTED' });
});

test('missing, changed, archived and binary references fail rather than selecting another source', async t => {
  const { service } = await setup(t, attachmentStore());
  const doc = await service.addDocument({ title: '文本', content: 'original' });
  const pdf = await service.addDocument({ title: 'PDF', fileName: 'a.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4') });
  assert.equal((await service.referenceCandidates()).items.some(item => item.documentId === pdf.id), false);
  await assert.rejects(() => service.checkReferences([pin(pdf)]), { code: 'REFERENCE_UNSUPPORTED' });
  await assert.rejects(() => service.readReferences([{ ...pin(doc), sha256: '0'.repeat(64) }]), { code: 'REFERENCE_CHANGED' });
  await assert.rejects(() => service.readReferences([{ ...pin(doc), version: 5 }]), { code: 'REFERENCE_NOT_FOUND' });
  await service.updateDocument(doc.id, { expectedRevision: 1, changes: { status: 'archived' } });
  await assert.rejects(() => service.checkReferences([pin(doc)]), { code: 'REFERENCE_ARCHIVED' });
});

test('a whole reference request is bounded, validates every pin, and never silently truncates', async t => {
  const { service } = await setup(t);
  const a = await service.addDocument({ title: 'A', content: 'a'.repeat(13_000) });
  const b = await service.addDocument({ title: 'B', content: 'b'.repeat(13_000) });
  await assert.rejects(() => service.readReferences([pin(a), pin(b)]), { code: 'REFERENCE_TOO_LARGE' });
  await assert.rejects(() => service.readReferences([pin(a), pin(a)]), { code: 'REFERENCE_INPUT' });
  await assert.rejects(() => service.readReferences(Array(9).fill(pin(a))), { code: 'REFERENCE_INPUT' });
  await assert.rejects(() => service.readReferences([{ ...pin(a), path: '/etc/passwd' }]), { code: 'REFERENCE_INPUT' });
  await assert.rejects(() => service.readReferences([{ ...pin(a), documentId: '../private' }]), { code: 'REFERENCE_INPUT' });
});

test('corrupted inline bytes and archive changes during an attachment read are detected before returning content', async t => {
  const attachments = attachmentStore();
  const { service, store } = await setup(t, attachments);
  const inline = await service.addDocument({ title: 'inline', content: 'safe' });
  (await store.state()).documents[0].versions[0].content = 'changed';
  await assert.rejects(() => service.readReferences([pin(inline)]), { code: 'REFERENCE_CHANGED' });
  const file = await service.addDocument({ title: 'file', fileName: 'a.txt', data: Buffer.from('text') });
  attachments.readFileStream = async function* (ref) {
    yield attachments.blobs.get(ref.attachmentId);
    await service.updateDocument(file.id, { expectedRevision: 1, changes: { status: 'archived' } });
  };
  await assert.rejects(() => service.readReferences([pin(file)]), { code: 'REFERENCE_ARCHIVED' });
});

test('cancellation and missing attachment storage return no source content', async t => {
  const attachments = attachmentStore();
  const { service, dir } = await setup(t, attachments);
  const doc = await service.addDocument({ title: 'text', fileName: 'a.txt', data: Buffer.from('text') });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => service.readReferences([pin(doc)], { signal: abort.signal }), { code: 'REFERENCE_CANCELLED' });
  const fresh = createLibraryService(new LibraryStore({ dir }));
  await assert.rejects(() => fresh.readReferences([pin(doc)]), { code: 'REFERENCE_UNAVAILABLE' });
});

test('pins survive a store restart without a second selection ledger or read-side mutations', async t => {
  const { service, dir } = await setup(t);
  const doc = await service.addDocument({ title: 'persisted', content: 'original' });
  const before = await service.status();
  const fresh = createLibraryService(new LibraryStore({ dir }));
  const result = await fresh.readReferences([pin(doc)]);
  assert.equal(result.items[0].content, 'original');
  assert.equal((await fresh.status()).sequence, before.sequence);
});

test('cancellation interrupts the native attachment stream while waiting for bytes', async t => {
  const attachments = attachmentStore();
  const { service } = await setup(t, attachments);
  const doc = await service.addDocument({ title: 'slow', fileName: 'slow.txt', data: Buffer.from('text') });
  const abort = new AbortController();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  attachments.readFileStream = async function* (_ref, signal) {
    assert.equal(signal, abort.signal);
    entered();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stream cancelled')), { once: true }));
  };
  const reading = service.readReferences([pin(doc)], { signal: abort.signal });
  await started;
  abort.abort();
  await assert.rejects(() => reading, { code: 'REFERENCE_CANCELLED' });
});

test('HTTP candidates and submit-time pin checks share authentication and expose no bytes', async t => {
  const { service } = await setup(t);
  const doc = await service.addDocument({ title: 'reference', content: 'do not send during selection' });
  const server = createServer(createHttpHandler(service, { authorize: req => req.headers.cookie === 'fixture=yes' ? undefined : 401 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + API_PREFIX + '/references')).status, 401);
  const response = await fetch(origin + API_PREFIX + '/references/check', {
    method: 'POST', headers: { cookie: 'fixture=yes', origin, 'content-type': 'application/json' }, body: JSON.stringify({ references: [pin(doc)] }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.references[0].sha256, pin(doc).sha256);
  assert.equal(JSON.stringify(result).includes('do not send during selection'), false);
  const refused = await fetch(origin + API_PREFIX + '/references/check', {
    method: 'POST', headers: { cookie: 'fixture=yes', origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify({ references: [pin(doc)] }),
  });
  assert.equal(refused.status, 403);
  await service.updateDocument(doc.id, { expectedRevision: 1, changes: { status: 'archived' } });
  const archived = await fetch(origin + API_PREFIX + '/references/check', {
    method: 'POST', headers: { cookie: 'fixture=yes', origin, 'content-type': 'application/json' }, body: JSON.stringify({ references: [pin(doc)] }),
  });
  assert.equal(archived.status, 409);
  assert.equal((await archived.json()).error.code, 'REFERENCE_ARCHIVED');
});

test('the DSH tool executes the same reader and forwards native cancellation', async t => {
  const { service, dir } = await setup(t);
  const doc = await service.addDocument({ title: 'native tool', content: 'source bytes' });
  const tools = new Map();
  apply({ attachments: null, tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } }, effect: fn => fn(), inject() {} }, { dataDir: dir });
  const tool = tools.get('workspace_library_references');
  assert.equal((await tool.execute({ references: [pin(doc)] }, {})).items[0].content, 'source bytes');
  const signal = AbortSignal.abort();
  await assert.rejects(() => tool.execute({ references: [pin(doc)] }, { signal }), { code: 'REFERENCE_CANCELLED' });
});
