import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readComposition } from '../src/resolve.mjs';
import { applyPatches, digestComposition, readPatch, setRowDisabled, validatePatch, writePatch } from '../src/patch.mjs';
import { runWh, parseArgv } from '../src/cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMPOSITION = path.join(ROOT, 'harness.dev.yml');
const code = expected => error => error?.code === expected;

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function base() {
  return (await readComposition(COMPOSITION, { root: ROOT })).composition;
}

test('patches disable, re-enable and replace row config wholesale', async t => {
  const composition = await base();
  const patched = applyPatches(composition, [validatePatch({
    version: 1,
    entries: [
      { id: 'inquiries', disabled: true },
      { id: 'tools', config: { allowedTools: ['inquiry_recovery_status'] } },
    ],
  })]);
  const inquiries = patched.composition.rows.find(row => row.id === 'inquiries');
  assert.equal(inquiries.disabled, true);
  const tools = patched.composition.rows.find(row => row.id === 'tools');
  assert.deepEqual(tools.config, { allowedTools: ['inquiry_recovery_status'] });
  assert.equal(patched.composition.rows.find(row => row.id === 'storage').config.directory, '.harness-dev-data');
  assert.deepEqual(patched.applied.map(entry => entry.action), ['disable', 'config']);

  const reenabled = applyPatches(composition, [validatePatch({ version: 1, entries: [{ id: 'inquiries', disabled: false }] })]);
  assert.equal(reenabled.composition.rows.find(row => row.id === 'inquiries').disabled, false);
});

test('patches may insert rows and refuse unknown targets, duplicates and renames', async t => {
  const composition = await base();
  const inserted = applyPatches(composition, [validatePatch({
    version: 1,
    insert: [{ id: 'echo', name: './test/fixtures/plugins/trace-consumer/src/index.mjs', config: {} }],
  })]);
  assert.ok(inserted.composition.rows.some(row => row.id === 'echo'));
  assert.equal(inserted.applied[0].action, 'insert');

  assert.throws(() => applyPatches(composition, [validatePatch({ version: 1, entries: [{ id: 'does-not-exist', disabled: true }] })]),
    error => error.code === 'HARNESS_COMPOSITION_INVALID' && /unknown row/u.test(error.message));
  assert.throws(() => applyPatches(composition, [validatePatch({ version: 1, insert: [{ id: 'storage', name: 'x', config: {} }] })]),
    error => error.code === 'HARNESS_COMPOSITION_INVALID' && /duplicate row/u.test(error.message));
  assert.throws(() => applyPatches(composition, [validatePatch({ version: 1, entries: [{ id: 'tools', name: 'other-tools' }] })]),
    error => error.code === 'HARNESS_COMPOSITION_INVALID' && /may not rename/u.test(error.message));
});

test('a malformed patch fails closed before anything is applied', async t => {
  assert.throws(() => validatePatch({ version: 2, entries: [] }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePatch({ version: 1 }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePatch({ version: 1, entries: [{ id: 'tools', disabled: 'yes' }] }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePatch({ version: 1, entries: [{ id: 'tools', unknown: true }] }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePatch({ version: 1, entries: [{ id: 'tools', disabled: true }, { id: 'tools', disabled: false }] }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePatch({ version: 1, entries: [{ id: 'tools' }] }), code('HARNESS_COMPOSITION_INVALID'));

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-patch-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const invalid = path.join(directory, 'bad.yml');
  await fs.writeFile(invalid, 'version: 1\nentries: [\n', 'utf8');
  await assert.rejects(readPatch(invalid, { root: directory }), code('HARNESS_COMPOSITION_INVALID'));
  await assert.rejects(readPatch('missing.yml', { root: directory }), code('HARNESS_COMPOSITION_INVALID'));
});

test('wh plugins and wh list accept --patch layers and show the effective rows', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-patch-cli-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const patchFile = path.join(directory, 'offline.yml');
  await fs.writeFile(patchFile, 'version: 1\nname: offline\nentries:\n  - id: inquiries\n    disabled: true\n', 'utf8');

  const json = capture();
  assert.equal(await runWh(['plugins', '--composition', 'harness.dev.yml', '--patch', patchFile, '--json'], { root: ROOT, ...json }), 0);
  const document = JSON.parse(json.stdout.text);
  assert.equal(document.rows.find(row => row.id === 'inquiries').disabled, true);
  assert.deepEqual(document.patches.map(entry => entry.action), ['disable']);

  const text = capture();
  assert.equal(await runWh(['list', '--composition', 'harness.dev.yml', '-p', patchFile], { root: ROOT, ...text }), 0);
  assert.match(text.stdout.text, /inquiries/u);

  const parsed = parseArgv(['list', '--patch', 'a.yml', '--patch=b.yml']);
  assert.deepEqual(parsed.options.patches, ['a.yml', 'b.yml']);
  assert.equal(parseArgv(['list', '--patch']).errors.length, 1);
});

test('setRowDisabled writes a reviewed layer, backs it up, and removes it when empty', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-patch-write-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'local.yml');

  const created = await setRowDisabled(file, 'inquiries', true, { root: directory });
  assert.equal(created.action, 'disable');
  assert.equal(created.backup, null, 'first write has no previous layer to back up');
  const first = await readPatch(file, { root: directory });
  assert.deepEqual(first.patch.entries, [{ id: 'inquiries', disabled: true }]);

  const backedUp = await setRowDisabled(file, 'tools', true, { root: directory });
  assert.equal(backedUp.backup, `${file}.bak`);
  assert.ok(await fs.readFile(`${file}.bak`, 'utf8'));
  const second = await readPatch(file, { root: directory });
  assert.deepEqual(second.patch.entries.map(entry => entry.id), ['inquiries', 'tools']);

  // Enabling everything back leaves an empty layer, which is removed (not written invalid).
  await setRowDisabled(file, 'inquiries', false, { root: directory });
  const removed = await setRowDisabled(file, 'tools', false, { root: directory });
  assert.equal(removed.removed, true);
  await assert.rejects(readPatch(file, { root: directory }), code('HARNESS_COMPOSITION_INVALID'));
});

test('writePatch refuses a malformed layer and keeps the previous bytes intact', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-patch-refuse-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'layer.yml');
  await writePatch(file, { version: 1, name: 'keep', entries: [{ id: 'inquiries', disabled: true }] }, { root: directory });
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(writePatch(file, { version: 1, entries: [{ id: 'inquiries', disabled: 'nope' }] }, { root: directory }), code('HARNESS_COMPOSITION_INVALID'));
  assert.equal(await fs.readFile(file, 'utf8'), before, 'a refused write must not touch the layer');
});

test('digestComposition is stable and changes when the effective rows change', async t => {
  const composition = await base();
  const first = digestComposition(composition);
  assert.equal(first, digestComposition(await base()));
  const patched = applyPatches(composition, [validatePatch({ version: 1, entries: [{ id: 'inquiries', disabled: true }] })]).composition;
  assert.notEqual(digestComposition(patched), first);
  const reformatted = structuredClone(composition);
  reformatted.rows = reformatted.rows.map(row => ({ ...row, config: { ...row.config } }));
  assert.equal(digestComposition(reformatted), first);
});

test('wh patch show/disable/enable edits the layer and reports the backup', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-patch-command-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'layer.yml');
  await fs.writeFile(file, 'version: 1\nname: cli\nentries:\n  - id: inquiries\n    disabled: true\n', 'utf8');

  const shown = capture();
  assert.equal(await runWh(['patch', 'show', '--patch', file, '--json'], { root: directory, ...shown }), 0);
  assert.deepEqual(JSON.parse(shown.stdout.text).entries, [{ id: 'inquiries', disabled: true }]);

  const disabled = capture();
  assert.equal(await runWh(['patch', 'disable', 'tools', '--patch', file, '--json'], { root: directory, ...disabled }), 0);
  const result = JSON.parse(disabled.stdout.text);
  assert.equal(result.action, 'disable');
  assert.equal(result.rowId, 'tools');
  assert.ok(result.backup.endsWith('.bak'));

  const enabled = capture();
  assert.equal(await runWh(['patch', 'enable', 'inquiries', '--patch', file, '--json'], { root: directory, ...enabled }), 0);
  const reloaded = await readPatch(file, { root: directory });
  assert.deepEqual(reloaded.patch.entries.map(entry => entry.id), ['tools']);

  const missing = capture();
  assert.equal(await runWh(['patch', 'disable', '--patch', file], { root: directory, ...missing }), 2);
  assert.match(missing.stderr.text, /requires a row id/u);
  assert.equal(await runWh(['patch', 'show'], { root: directory, ...capture() }), 2);
});

