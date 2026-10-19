import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyToolSelection, reconcileToolSelection, planToolSelection, PLUGIN_SELECTION_BARRIER } from '../../server/plugin-library/apply.mjs';
import { readPluginInventory } from '../../server/plugin-library/inventory.mjs';
import { fixture, code } from './fixtures.mjs';
const args = (f, control, intent) => ({ control, root: f.root, requestId: intent.requestId, expectedRevision: control.read().revision, confirmPackageSha256: intent.packageSha256, subject: 'os:fixture-admin', clock: f.clock });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('lifecycle applies reviewed disable then enable without importing plugin code', async t => {
  const f = await fixture(t), store = await f.open(), beforePackage = await fs.readFile(path.join(f.packageDirectory, 'src/extension.js'));
  const disable = await f.request(store); const result = await applyToolSelection(args(f, store, disable)); assert.equal(result.selectionApplied, true); assert.equal(result.backendChanged, false); assert.equal(result.dataDeleted, false);
  assert.equal((await readPluginInventory({ root: f.root })).packages[0].selectedIn.includes('config.json'), false);
  const enable = await f.request(store, 'enable-tools'); await applyToolSelection(args(f, store, enable)); assert.equal((await readPluginInventory({ root: f.root })).packages[0].selectedIn.includes('config.json'), true);
  assert.deepEqual(await fs.readFile(path.join(f.packageDirectory, 'src/extension.js')), beforePackage); assert.equal((await fs.readdir(f.root)).includes(PLUGIN_SELECTION_BARRIER), false);
});
test('lifecycle result survives restart and explicit reconcile never applies twice', async t => {
  const f = await fixture(t), a = await f.open(), intent = await f.request(a); await applyToolSelection(args(f, a, intent)); const revision = a.read().revision; await a.close();
  const b = await f.open(); const result = await reconcileToolSelection(args(f, b, intent)); assert.equal(result.selectionApplied, true); assert.equal(b.read().revision, revision); await assert.rejects(applyToolSelection(args(f, b, intent)), code('PLUGIN_APPLY_RECONCILE_REQUIRED'));
});
test('lifecycle refuses an expired request before any configuration write', async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store); const before = await fs.readFile(path.join(f.root, 'config.json')); f.advance(86400001);
  await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_APPLY_REAPPROVAL_REQUIRED')); assert.deepEqual(await fs.readFile(path.join(f.root, 'config.json')), before); assert.equal(store.read().intents[0].status, 'awaiting-verified-executor');
});
test('lifecycle refuses legacy unbounded requests rather than silently reauthorizing them', async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store, 'disable-tools', { expiresAt: null });
  await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_APPLY_REAPPROVAL_REQUIRED'));
});
test('lifecycle refuses cancelled requests and unsupported full-module operations', async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store, 'disable-tools', { status: 'cancelled' });
  await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_APPLY_RECONCILE_REQUIRED'));
  const upgrade = await f.request(store, 'upgrade'); await assert.rejects(applyToolSelection(args(f, store, upgrade)), code('PLUGIN_FULL_MODULE_EXECUTOR_REQUIRED'));
});
test('lifecycle refuses stale source and wrong explicit package confirmation', async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store);
  await assert.rejects(applyToolSelection({ ...args(f, store, intent), confirmPackageSha256: 'f'.repeat(64) }), code('PLUGIN_APPLY_CONFIRMATION_REQUIRED'));
  await f.write(f.pluginId + '/README.md', 'changed source'); await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_APPLY_SOURCE_CHANGED'));
});
test('lifecycle preserves required Brain dependency in the original business profile', async t => {
  const f = await fixture(t, { pluginId: 'workspace-goal-intelligence' }), store = await f.open(), intent = await f.request(store, 'disable-tools', { configuration: 'config.business.json' });
  await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_CORE_DEPENDENCY_REQUIRED'));
});
for (const applied of [false, true]) test(`lifecycle explicitly reconciles a staged ${applied ? 'committed' : 'uncommitted'} configuration`, async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store);
  const configurationBytes = await fs.readFile(path.join(f.root, 'config.json')), inventory = await readPluginInventory({ root: f.root }); const plan = planToolSelection({ intent, inventory, configurationBytes });
  const application = { schemaVersion: 1, intentId: intent.id, requestId: intent.requestId, configuration: intent.configuration, beforeSha256: digest(configurationBytes), afterSha256: plan.afterSha256 };
  await store.transact({ requestId: 'fixture-prepare', expectedRevision: 1, subject: 'admin-a', operation: { type: 'fixture.crash-window' } }, state => { state.intents[0].status = 'applying'; state.intents[0].application = application; return { prepared: true }; });
  await f.write(PLUGIN_SELECTION_BARRIER, JSON.stringify(application)); if (applied) await f.write('config.json', plan.after);
  await assert.rejects(readPluginInventory({ root: f.root }), code('PROJECT_PLUGIN_RECONCILIATION_REQUIRED'));
  const result = await reconcileToolSelection(args(f, store, intent)); assert.equal(result.selectionApplied, applied); assert.equal(store.read().intents[0].status, applied ? 'selection-applied' : 'not-applied'); assert.equal((await fs.readdir(f.root)).includes(PLUGIN_SELECTION_BARRIER), false);
});
test('lifecycle keeps a mismatched crash barrier instead of deleting evidence', async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store); await f.write(PLUGIN_SELECTION_BARRIER, '{"wrong":true}');
  await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_APPLY_RECONCILE_REQUIRED')); assert.equal(await fs.readFile(path.join(f.root, PLUGIN_SELECTION_BARRIER), 'utf8'), '{"wrong":true}');
});
test('lifecycle validates stored paths before reading outside the reviewed package root', async t => {
  const f = await fixture(t), store = await f.open(), intent = await f.request(store, 'disable-tools', { configuration: '../outside' });
  await assert.rejects(applyToolSelection(args(f, store, intent)), code('PLUGIN_APPLY_IDENTITY_REFUSED'));
});
