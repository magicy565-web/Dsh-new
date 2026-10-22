import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runWh } from '../src/cli.mjs';

const ENTRY = `export async function apply(ctx) {}
export default { apply };
`;

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function pluginPackage(directory, { id, provides = [], requires = [], tools = [], routes = [], env = [], skills = [], slots = [] } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'harness.plugin.json'), JSON.stringify({
    id, version: '0.1.0', kind: 'plugin', entry: './index.mjs', provides, requires, tools, routes, env, skills, slots,
  }), 'utf8');
  await fs.writeFile(path.join(directory, 'index.mjs'), ENTRY, 'utf8');
  return directory;
}

async function harnessRoot(t, { plugins, rows }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-capabilities-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  for (const plugin of plugins) await pluginPackage(path.join(root, 'plugins', plugin.id), plugin);
  await fs.writeFile(path.join(root, 'harness.yml'), [
    'version: 1', 'name: capabilities-fixture', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    ...rows,
    '',
  ].join('\n'), 'utf8');
  return root;
}

test('capabilities lists every row with services, routes, tools, skills and env', async t => {
  const root = await harnessRoot(t, {
    plugins: [
      { id: 'plugin-a', provides: ['service-a'], routes: ['GET /api/a'], tools: ['tool_a'], env: ['KEY_A'], skills: ['skills/a'], slots: ['home.cards'] },
      { id: 'plugin-b', provides: ['service-b'], requires: ['service-a'] },
    ],
    rows: [
      '  - id: a', '    name: plugin-a',
      '  - id: b', '    name: plugin-b',
      '  - id: off', '    name: plugin-b', '    disabled: true',
    ],
  });
  const output = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'harness.yml', '--json'], { root, ...output }), 0);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.composition.name, 'capabilities-fixture');
  assert.match(document.composition.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(document.services, { 'service-a': ['a'], 'service-b': ['b'] }, 'disabled rows provide nothing');
  assert.deepEqual(document.unmet, []);
  assert.deepEqual(document.conflicts, []);
  assert.deepEqual(document.tools, ['tool_a']);
  assert.deepEqual(document.env, ['KEY_A']);
  assert.deepEqual(document.skills, ['skills/a']);

  const rowA = document.rows.find(row => row.id === 'a');
  assert.deepEqual(rowA.provides, ['service-a']);
  assert.deepEqual(rowA.routes, ['GET /api/a']);
  assert.deepEqual(rowA.slots, ['home.cards']);
  assert.equal(rowA.manifestId, 'plugin-a');
  const disabled = document.rows.find(row => row.id === 'off');
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.manifestId, 'plugin-b');

  const text = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'harness.yml'], { root, ...text }), 0);
  assert.match(text.stdout.text, /capabilities of "capabilities-fixture"/u);
  assert.match(text.stdout.text, /unmet requires: none/u);
  assert.match(text.stdout.text, /env declared: KEY_A/u);
});

test('capabilities reports unmet requires and service conflicts, and can fail on them', async t => {
  const root = await harnessRoot(t, {
    plugins: [
      { id: 'needy', requires: ['missing-service'] },
      { id: 'dup-1', provides: ['dup-service'] },
      { id: 'dup-2', provides: ['dup-service'] },
    ],
    rows: [
      '  - id: needy', '    name: needy',
      '  - id: dup1', '    name: dup-1',
      '  - id: dup2', '    name: dup-2',
      '  - id: off', '    name: needy', '    disabled: true',
    ],
  });
  const output = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'harness.yml', '--json'], { root, ...output }), 0, 'inventory alone never fails');
  const document = JSON.parse(output.stdout.text);
  assert.deepEqual(document.unmet, [{ pluginId: 'needy', service: 'missing-service' }], 'disabled rows are not counted');
  assert.deepEqual(document.conflicts, [{ service: 'dup-service', pluginIds: ['dup1', 'dup2'] }]);

  const text = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'harness.yml'], { root, ...text }), 0);
  assert.match(text.stdout.text, /unmet requires: needy→missing-service/u);
  assert.match(text.stdout.text, /conflicts: dup-service \(dup1, dup2\)/u);

  const checked = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'harness.yml', '--check-unmet'], { root, ...checked }), 1);
});

test('capabilities honours patch layers and reports an empty composition cleanly', async t => {
  const root = await harnessRoot(t, {
    plugins: [{ id: 'plugin-a', provides: ['service-a'], requires: ['service-a'] }],
    rows: ['  - id: a', '    name: plugin-a'],
  });
  await fs.writeFile(path.join(root, 'off.yml'), 'version: 1\nentries:\n  - id: a\n    disabled: true\n', 'utf8');
  const output = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'harness.yml', '--patch', 'off.yml', '--json'], { root, ...output }), 0);
  const document = JSON.parse(output.stdout.text);
  assert.deepEqual(document.services, {}, 'a disabled row provides nothing');
  assert.deepEqual(document.unmet, []);
  assert.equal(document.rows[0].disabled, true);

  await fs.writeFile(path.join(root, 'empty.yml'), 'version: 1\nname: empty\nserver: { host: 127.0.0.1, port: 0 }\nplugins: []\n', 'utf8');
  const empty = capture();
  assert.equal(await runWh(['capabilities', '--composition', 'empty.yml', '--json'], { root, ...empty }), 0);
  const emptyDocument = JSON.parse(empty.stdout.text);
  assert.deepEqual(emptyDocument.rows, []);
  assert.deepEqual(emptyDocument.services, {});
  assert.deepEqual(emptyDocument.unmet, []);
});
