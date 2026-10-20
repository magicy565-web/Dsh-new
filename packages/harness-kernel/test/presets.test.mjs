import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composePreset, listPresets, loadPreset, presetSummary, validatePreset } from '../src/presets.mjs';
import { runWh, parseArgv } from '../src/cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const code = expected => error => error?.code === expected;

function capture() {
  const stdout = { text: '', write(chunk) { this.text += chunk; } };
  const stderr = { text: '', write(chunk) { this.text += chunk; } };
  return { stdout, stderr };
}

test('the repository ships two real agent presets', async t => {
  const presets = await listPresets({ root: ROOT });
  assert.deepEqual(presets.map(preset => preset.name), ['growth-manager', 'inquiry-analyst']);
  const growth = presets[0];
  assert.equal(growth.title, '海外增长经理');
  assert.ok(growth.persona.includes('海外增长经理'));
  assert.deepEqual(growth.tools, ['inquiry_recovery_status', 'inquiry_recovery_opportunities', 'inquiry_recovery_select']);
  assert.deepEqual(growth.denyTools, []);
  assert.deepEqual(growth.skills, ['inquiries']);
  const analyst = presets[1];
  assert.deepEqual(analyst.denyTools, ['inquiry_recovery_select']);
  assert.equal(analyst.tools.includes('inquiry_recovery_select'), false);
});

test('a malformed preset fails closed with a composition error', async t => {
  assert.throws(() => validatePreset({ version: 1, name: 'x', title: 't' }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePreset({ version: 2, name: 'x', title: 't', persona: 'p' }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePreset({ version: 1, name: 'Bad Name', title: 't', persona: 'p' }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePreset({ version: 1, name: 'x', title: 't', persona: 'p', tools: ['a'], denyTools: ['a'] }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePreset({ version: 1, name: 'x', title: 't', persona: 'p', extends: '/etc/passwd' }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePreset({ version: 1, name: 'x', title: 't', persona: 'p'.repeat(9000) }), code('HARNESS_COMPOSITION_INVALID'));
  assert.throws(() => validatePreset({ version: 1, name: 'x', title: 't', persona: 'p', plugins: [{ id: 'a', name: 'a' }, { id: 'a', name: 'b' }] }), code('HARNESS_COMPOSITION_INVALID'));
  await assert.rejects(loadPreset('does-not-exist', { root: ROOT }), code('HARNESS_COMPOSITION_INVALID'));
});

test('a preset composes over its base composition without hiding base rows', async t => {
  const preset = await loadPreset('growth-manager', { root: ROOT });
  assert.equal(preset.extends, '../harness.dev.yml');
  const composed = await composePreset(preset, { root: ROOT });
  const ids = composed.composition.rows.map(row => row.id);
  for (const baseId of ['storage', 'artifacts', 'approval', 'tools', 'inquiries']) assert.ok(ids.includes(baseId), `missing ${baseId}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(composed.composition.server.port, 8791);
  assert.deepEqual(composed.tools, preset.tools);
  assert.equal(composed.persona, preset.persona);
});

test('the CLI lists and shows presets, and still rejects stray positionals elsewhere', async t => {
  const list = capture();
  assert.equal(await runWh(['presets', 'list', '--json'], { root: ROOT, ...list }), 0);
  const listed = JSON.parse(list.stdout.text);
  assert.deepEqual(listed.map(preset => preset.name), ['growth-manager', 'inquiry-analyst']);

  const shown = capture();
  assert.equal(await runWh(['presets', 'show', 'inquiry-analyst', '--json'], { root: ROOT, ...shown }), 0);
  const preset = JSON.parse(shown.stdout.text);
  assert.ok(preset.denyTools.includes('inquiry_recovery_select'));
  assert.ok(preset.composition.some(row => row.id === 'inquiries'));

  const text = capture();
  assert.equal(await runWh(['presets', 'list'], { root: ROOT, ...text }), 0);
  assert.match(text.stdout.text, /growth-manager/u);

  const unknown = capture();
  assert.equal(await runWh(['presets', 'nope'], { root: ROOT, ...unknown }), 2);
  assert.match(unknown.stderr.text, /unknown presets subcommand/u);

  assert.equal(parseArgv(['list', 'stray']).errors.length, 1);
  assert.deepEqual(parseArgv(['presets', 'show', 'growth-manager']).options.args, ['show', 'growth-manager']);
});

test('preset summaries expose metadata only, not the whole composition body', async t => {
  const preset = await loadPreset('inquiry-analyst', { root: ROOT });
  const summary = presetSummary(preset);
  assert.deepEqual(Object.keys(summary).sort(), ['denyTools', 'extends', 'file', 'model', 'name', 'persona', 'plugins', 'skills', 'title', 'tools']);
  assert.equal(summary.plugins[0], 'inquiries');
});
