import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createStorage } from '../src/storage.mjs';
import { scopeStorage } from '../src/scope.mjs';
import { harnessError, makeTempDirectory, removeDirectory, closeAfter } from './helpers.mjs';

async function fixture(t) {
  const directory = await makeTempDirectory('harness-scope-');
  removeDirectory(t, directory);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  return { storage, directory };
}

test('two workspace scopes never share business records', async t => {
  const { storage } = await fixture(t);
  const alpha = scopeStorage(storage, 'alpha');
  const beta = scopeStorage(storage, 'beta');

  assert.deepEqual(alpha.read(), {}, 'a missing partition reads as empty, not undefined');
  await alpha.update(state => { state.inquiryRecovery = { leads: ['a1'] }; });
  await beta.update(state => { state.inquiryRecovery = { leads: ['b1'] }; });
  assert.deepEqual(alpha.read().inquiryRecovery.leads, ['a1']);
  assert.deepEqual(beta.read().inquiryRecovery.leads, ['b1']);

  await alpha.update(state => { state.conversations = [{ id: 'c-alpha' }]; return state.conversations.length; });
  assert.equal(storage.read().workspaces.alpha.conversations.length, 1);
  assert.equal(storage.read().workspaces.beta.conversations, undefined, 'beta stays untouched');

  // Shared (top-level) state is not visible inside a partition.
  await storage.update(state => { state.inquiryRecovery = { leads: ['legacy'] }; });
  assert.deepEqual(alpha.read().inquiryRecovery.leads, ['a1'], 'the legacy top-level key does not leak into a tenant');
  assert.deepEqual(alpha.root().inquiryRecovery.leads, ['legacy']);
});

test('scoped updates persist across storage restarts and keep other partitions intact', async t => {
  const { storage, directory } = await fixture(t);
  await scopeStorage(storage, 'alpha').update(state => { state.inquiryRecovery = { leads: ['a1', 'a2'] }; });
  await storage.close();

  const reopened = await createStorage({ directory });
  closeAfter(t, reopened);
  assert.deepEqual(scopeStorage(reopened, 'alpha').read().inquiryRecovery.leads, ['a1', 'a2']);
  assert.deepEqual(scopeStorage(reopened, 'beta').read(), {});
});

test('invalid workspace ids and a damaged partition root fail closed', async t => {
  const { storage } = await fixture(t);
  assert.throws(() => scopeStorage(storage, 'Bad Id'), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => scopeStorage(storage, ''), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => scopeStorage(null, 'alpha'), TypeError);

  await storage.update(state => { state.workspaces = []; });
  await assert.rejects(scopeStorage(storage, 'alpha').update(state => { state.x = 1; }), harnessError('HARNESS_STORAGE_INVALID'));
  assert.deepEqual(scopeStorage(storage, 'alpha').read(), {}, 'a damaged root reads as empty rather than crashing');
});
