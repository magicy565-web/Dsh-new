import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { canonical } from '../../server/plugin-library/control-store.mjs';
import { fixture, TestApiError, code } from './fixtures.mjs';
const transaction = (store, id = 'request-0001', revision = 0, subject = 'admin-a') => store.transact({ requestId: id, expectedRevision: revision, subject, operation: { type: 'test.change' } }, () => ({ executed: false }));
test('control store persists exact receipts across close and reopen', async t => {
  const f = await fixture(t), a = await f.open(); const result = await transaction(a); await a.close();
  const b = await f.open(); assert.deepEqual(b.receipt('request-0001', 'admin-a'), result); assert.equal(b.read().revision, 1);
});
test('control store has one exclusive writer and retains an existing lock', async t => {
  const f = await fixture(t), a = await f.open(); await assert.rejects(f.open(), code('PLUGIN_CONTROL_WRITER_BUSY'));
  assert.equal((await fs.stat(path.join(f.directory, 'writer.lock'))).isFile(), true); await a.close();
});
test('control store serializes competing CAS writes with only one commit', async t => {
  const f = await fixture(t), store = await f.open(); const results = await Promise.allSettled([transaction(store), transaction(store, 'request-0002')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(store.read().revision, 1); assert.equal(store.read().receipts.length, 1);
});
test('control store exact retry does not reexecute the transaction', async t => {
  const f = await fixture(t), store = await f.open(); const first = await transaction(store);
  const second = await store.transact({ requestId: 'request-0001', expectedRevision: 0, subject: 'admin-a', operation: { type: 'test.change' } }, () => assert.fail('executed again'));
  assert.deepEqual(second, first); assert.equal(store.read().revision, 1);
});
test('control store refuses changed content and cross-actor request IDs', async t => {
  const f = await fixture(t), store = await f.open(); await transaction(store);
  await assert.rejects(transaction(store, 'request-0001', 1), code('PLUGIN_CONTROL_REQUEST_CONFLICT'));
  await assert.rejects(transaction(store, 'request-0001', 0, 'admin-b'), code('PLUGIN_CONTROL_REQUEST_CONFLICT'));
  assert.equal(store.receipt('request-0001', 'admin-b'), null);
});
test('control store returns defensive copies and does not expose mutable state', async t => {
  const f = await fixture(t), store = await f.open(); await transaction(store); const view = store.read(); view.revision = 100;
  const receipt = store.receipt('request-0001', 'admin-a'); receipt.executed = true;
  assert.equal(store.read().revision, 1); assert.equal(store.receipt('request-0001', 'admin-a').executed, false);
});
test('control store checks live authority after staging and before commit', async t => {
  const f = await fixture(t), store = await f.open();
  await assert.rejects(store.transact({ requestId: 'request-guard', expectedRevision: 0, subject: 'admin-a', operation: { type: 'test.guard' }, assertCurrent() {
    if (readdirSync(f.directory).some(name => name.endsWith('.tmp'))) throw new TestApiError(403, 'AUTH_REVOKED', 'Revoked during staging.');
  } }, () => ({ executed: false })), code('AUTH_REVOKED'));
  assert.equal(store.read().revision, 0); assert.equal(store.read().receipts.length, 0);
  assert.equal((await fs.readdir(f.directory)).some(name => name.endsWith('.tmp')), false);
});
test('control store close is idempotent and refuses further mutations', async t => {
  const f = await fixture(t), store = await f.open(); const a = store.close(), b = store.close(); assert.equal(a, b); await a;
  assert.throws(() => store.read(), code('PLUGIN_CONTROL_UNAVAILABLE')); await assert.rejects(transaction(store), code('PLUGIN_CONTROL_UNAVAILABLE'));
});
test('control store refuses corrupt state without resetting its bytes', async t => {
  const f = await fixture(t); const file = path.join(f.directory, 'state.json'); await fs.writeFile(file, '{broken', { mode: 0o600 });
  await assert.rejects(f.open()); assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});
test('control store refuses another workspace and insecure directory mode', async t => {
  const f = await fixture(t), store = await f.open(); await transaction(store); await store.close();
  const file = path.join(f.directory, 'state.json'); const state = JSON.parse(await fs.readFile(file, 'utf8')); state.workspaceId = 'another-enterprise'; await fs.writeFile(file, JSON.stringify(state));
  await assert.rejects(f.open(), code('PLUGIN_CONTROL_STATE_REFUSED')); await fs.chmod(f.directory, 0o755);
  await assert.rejects(f.open(), code('PLUGIN_CONTROL_DIRECTORY_REFUSED')); await fs.chmod(f.directory, 0o700);
});
test('control store rejects symlink state and reserved JSON keys', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.base, 'outside'), '{}'); await fs.symlink(path.join(f.base, 'outside'), path.join(f.directory, 'state.json'));
  await assert.rejects(f.open()); assert.throws(() => canonical(JSON.parse('{"__proto__":{}}'))); assert.throws(() => canonical({ value: Infinity }));
});
test('control store leaves a crashed writer lock for explicit operator review', async t => {
  const f = await fixture(t); const { spawnSync } = await import('node:child_process');
  const moduleUrl = new URL('../../server/plugin-library/control-store.mjs', import.meta.url).href;
  const script = `import {openPluginControlStore} from ${JSON.stringify(moduleUrl)}; class E extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}; await openPluginControlStore({directory:${JSON.stringify(f.directory)},workspaceId:'plugin-library-fixture-enterprise',ApiError:E}); process.exit(17);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 17); await assert.rejects(f.open(), code('PLUGIN_CONTROL_WRITER_BUSY'));
  assert.equal((await fs.stat(path.join(f.directory, 'writer.lock'))).isFile(), true);
});
