import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openStore, STORE_VERSION, privateDirectory } from '../server/store.mjs';

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-store-v2-'));
  await privateDirectory(dir);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const v1 = () => ({ version: 1, conversations: [{ id: 'conversation-1', title: '已有聊天' }], messages: [{ id: 'message-1', conversationId: 'conversation-1', content: 'Saved content' }], goals: [], activity: [], memories: [{ id: 'memory-1', content: 'Saved note', category: 'saved' }], settings: { name: 'My workspace', language: 'zh', model: 'deepseek-flash', maxGoalSteps: 3 }, customExtension: { preserved: true } });

test('new v3 state is durable immediately and reads/results cannot mutate it', async t => {
  const dir = await directory(t); const store = await openStore(dir);
  assert.equal(store.read().version, STORE_VERSION); assert.equal(store.read().meta.sequence, 0);
  assert.deepEqual(store.read().runs, []); assert.deepEqual(store.read().artifacts, []);
  assert.equal(store.read().capabilities.version, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')).version, 3);
  let retained;
  const result = await store.update(state => { retained = state; const item = { id: 'one', content: 'persisted' }; state.memories.push(item); return item; });
  result.content = 'mutated result'; retained.memories[0].content = 'mutated callback';
  store.read().memories[0].content = 'mutated read';
  assert.equal(store.read().memories[0].content, 'persisted');
  await store.close();
  const reopened = await openStore(dir); t.after(() => reopened.close());
  assert.equal(reopened.read().memories[0].content, 'persisted'); assert.equal(reopened.read().meta.sequence, 1);
});

test('v1 migrates once with a byte-for-byte backup and preserves all existing records', async t => {
  const dir = await directory(t); const old = v1(); const raw = JSON.stringify(old, null, 4);
  await fs.writeFile(path.join(dir, 'workspace.json'), raw);
  const store = await openStore(dir);
  const state = store.read();
  assert.equal(state.version, 3); assert.deepEqual(state.memories, old.memories); assert.deepEqual(state.settings, old.settings); assert.deepEqual(state.customExtension, old.customExtension);
  assert.equal(await fs.readFile(path.join(dir, 'workspace.v1.backup.json'), 'utf8'), raw);
  await store.update(next => { next.settings.name = 'New name'; }); await store.close();
  const reopened = await openStore(dir); t.after(() => reopened.close());
  assert.equal(reopened.read().settings.name, 'New name'); assert.equal(await fs.readFile(path.join(dir, 'workspace.v1.backup.json'), 'utf8'), raw);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, 'workspace.v1.backup.json'))).mode & 0o777, 0o600);
});

test('a conflicting migration backup is never replaced and original v1 remains intact', async t => {
  const dir = await directory(t); const raw = JSON.stringify(v1());
  await fs.writeFile(path.join(dir, 'workspace.json'), raw);
  await fs.writeFile(path.join(dir, 'workspace.v1.backup.json'), 'existing unrelated backup');
  await assert.rejects(openStore(dir), /backup.*safely/i);
  assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), raw);
  assert.equal(await fs.readFile(path.join(dir, 'workspace.v1.backup.json'), 'utf8'), 'existing unrelated backup');
  await assert.rejects(fs.stat(path.join(dir, 'workspace.lock')), { code: 'ENOENT' });
});

test('corrupt, unsupported and structurally invalid stores are preserved exactly', async t => {
  const dir = await directory(t);
  for (const value of ['broken-json', 'null', JSON.stringify({ ...v1(), version: 999 }), JSON.stringify({ ...v1(), settings: [] }), JSON.stringify({ ...v1(), messages: [null] }), JSON.stringify({ ...v1(), memories: [{ id: 'dup' }, { id: 'dup' }] }), '{"version":1,"__proto__":{"polluted":true}}']) {
    await fs.writeFile(path.join(dir, 'workspace.json'), value);
    await assert.rejects(openStore(dir), /no data has been overwritten/);
    assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), value);
    await assert.rejects(fs.stat(path.join(dir, 'workspace.lock')), { code: 'ENOENT' });
  }
  assert.equal({}.polluted, undefined);
  const malformedUtf8 = Buffer.concat([Buffer.from(JSON.stringify(v1()).replace('My workspace', 'INVALID_UTF8').split('INVALID_UTF8')[0]), Buffer.from([255]), Buffer.from(JSON.stringify(v1()).replace('My workspace', 'INVALID_UTF8').split('INVALID_UTF8')[1])]);
  await fs.writeFile(path.join(dir, 'workspace.json'), malformedUtf8);
  await assert.rejects(openStore(dir), /no data has been overwritten/);
  assert.deepEqual(await fs.readFile(path.join(dir, 'workspace.json')), malformedUtf8);
});

test('invalid and asynchronous transactions roll back and do not poison the transaction queue', async t => {
  const dir = await directory(t); const store = await openStore(dir); t.after(() => store.close());
  const before = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
  for (const mutate of [state => { state.memories.push({ id: 'bad', value: undefined }); }, state => { state.meta = null; state.version = 4; }, state => { state.memories.push({ id: 'same' }, { id: 'same' }); }, state => { state.settings.nan = NaN; }, state => { state.settings.nested = new Date(); }, state => { state.settings.cycle = state; }, state => { state.settings.payload = JSON.parse('{"constructor":{}}'); }, state => { state.settings.name = 'discard'; throw new Error('Expected callback error'); }]) await assert.rejects(store.update(mutate));
  await assert.rejects(store.update(async state => { await Promise.resolve(); state.settings.name = 'async mutation'; }), /synchronous/);
  assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), before); assert.equal(store.read().meta.sequence, 0);
  await store.update(state => { state.settings.name = 'recovered'; }); assert.equal(store.read().settings.name, 'recovered');
});

test('concurrent transactions are serialized and subscribers only receive durable committed cursors', async t => {
  const dir = await directory(t); const store = await openStore(dir); t.after(() => store.close());
  const events = []; const persistedChecks = [];
  const unsubscribe = store.subscribe(event => { events.push(event.sequence); assert.equal(store.read().meta.sequence, event.sequence); persistedChecks.push(fs.readFile(path.join(dir, 'workspace.json'), 'utf8').then(raw => assert.ok(JSON.parse(raw).meta.sequence >= event.sequence))); });
  store.subscribe(() => { throw new Error('Untrusted observer'); }); store.subscribe(async () => { throw new Error('Rejected observer'); });
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.update(state => { state.memories.push({ id: `item-${i}` }); })));
  await Promise.all(persistedChecks); assert.deepEqual(events, Array.from({ length: 12 }, (_, i) => i + 1)); assert.equal(store.read().memories.length, 12);
  unsubscribe(); await store.update(() => {}); assert.equal(events.length, 12);
});

test('close drains accepted transactions, refuses new writes, and is idempotent', async t => {
  const dir = await directory(t); const store = await openStore(dir);
  const update = store.update(state => { state.settings.name = 'last accepted write'; });
  const closed = store.close(); await assert.rejects(store.update(() => {}), /closed/);
  await Promise.all([update, closed, store.close()]);
  const reopened = await openStore(dir); t.after(() => reopened.close()); assert.equal(reopened.read().settings.name, 'last accepted write');
});

test('single writer lock and concurrent recovery of a dead process cannot admit two writers', async t => {
  const dir = await directory(t); const store = await openStore(dir);
  await assert.rejects(openStore(dir), /already open/); await store.close();
  const deadPid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
  await fs.writeFile(path.join(dir, 'workspace.lock'), JSON.stringify({ pid: deadPid, token: randomUUID() }));
  const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => openStore(dir)));
  const winners = attempts.filter(item => item.status === 'fulfilled');
  assert.equal(winners.length, 1); await winners[0].value.close();
});

test('malformed and ambiguous recovery locks fail closed', async t => {
  const dir = await directory(t);
  await fs.writeFile(path.join(dir, 'workspace.lock'), 'not-json');
  await assert.rejects(openStore(dir), /lock is unreadable/); assert.equal(await fs.readFile(path.join(dir, 'workspace.lock'), 'utf8'), 'not-json');
  await fs.writeFile(path.join(dir, 'workspace.lock.recovery'), '{}');
  await assert.rejects(openStore(dir), /recovery lock/);
});

test('symlink and hard-link workspace files and symlink directories are refused', async t => {
  if (process.platform === 'win32') return t.skip('Creating local symlinks requires additional Windows privileges.');
  const dir = await directory(t); const target = path.join(dir, 'target'); await fs.mkdir(target);
  const linkedDir = path.join(dir, 'linked'); await fs.symlink(target, linkedDir);
  await assert.rejects(openStore(linkedDir), /symbolic link/);
  const external = path.join(dir, 'original.json'); const raw = JSON.stringify(v1()); await fs.writeFile(external, raw);
  await fs.symlink(external, path.join(target, 'workspace.json')); await assert.rejects(openStore(target), /unreadable/);
  assert.equal(await fs.readFile(external, 'utf8'), raw);
  await fs.unlink(path.join(target, 'workspace.json')); await fs.link(external, path.join(target, 'workspace.json'));
  await assert.rejects(openStore(target), /unreadable/); assert.equal(await fs.readFile(external, 'utf8'), raw);
});

test('out-of-band corruption and stolen locks cannot be overwritten by an open store', async t => {
  const dir = await directory(t); const store = await openStore(dir);
  const filename = path.join(dir, 'workspace.json'); const original = await fs.readFile(filename, 'utf8');
  await fs.writeFile(filename, 'external corrupted data'); await assert.rejects(store.update(state => { state.settings.name = 'unsafe'; }), /changed outside/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'external corrupted data'); assert.notEqual(store.read().settings.name, 'unsafe');
  await fs.writeFile(filename, original);
  const lockname = path.join(dir, 'workspace.lock'); const owner = await fs.readFile(lockname, 'utf8');
  await fs.writeFile(lockname, JSON.stringify({ pid: process.pid, token: 'different-owner' }));
  await assert.rejects(store.update(() => {}), /lock changed/); assert.equal(await fs.readFile(filename, 'utf8'), original);
  await fs.writeFile(lockname, owner); await store.close();
});

test('private permissions and bounded-name orphan cleanup survive restart', async t => {
  const dir = await directory(t); const store = await openStore(dir); await store.close();
  const orphan = `workspace.json.${randomUUID()}.tmp`; await fs.writeFile(path.join(dir, orphan), 'partial write'); await fs.writeFile(path.join(dir, 'unrelated.tmp'), 'retain me');
  const reopened = await openStore(dir); t.after(() => reopened.close());
  await assert.rejects(fs.stat(path.join(dir, orphan)), { code: 'ENOENT' }); assert.equal(await fs.readFile(path.join(dir, 'unrelated.tmp'), 'utf8'), 'retain me');
  if (process.platform !== 'win32') { assert.equal((await fs.stat(dir)).mode & 0o777, 0o700); for (const name of ['workspace.json', 'workspace.lock']) assert.equal((await fs.stat(path.join(dir, name))).mode & 0o777, 0o600); }
});
