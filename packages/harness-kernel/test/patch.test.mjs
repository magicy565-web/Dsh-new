import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readComposition } from '../src/resolve.mjs';
import { applyPatches, readPatch, validatePatch } from '../src/patch.mjs';
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
