import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateManifest } from '../../harness-contracts/src/index.mjs';
import { runWh } from '../src/cli.mjs';

const ENTRY = `export async function apply(ctx) {
  if (ctx?.health?.register) ctx.health.register('env-fixture', () => ({ status: 'ok' }));
}
export default { apply };
`;

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-env-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const plugin = path.join(root, 'plugins', 'env-fixture');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'harness.plugin.json'), JSON.stringify({
    id: 'env-fixture', version: '0.1.0', kind: 'plugin', entry: './index.mjs',
    env: ['DEEPSEEK_API_KEY', 'EXTRA_KEY'],
  }), 'utf8');
  await fs.writeFile(path.join(plugin, 'index.mjs'), ENTRY, 'utf8');
  await fs.writeFile(path.join(root, 'harness.yml'), [
    'version: 1', 'name: env-fixture', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: fixture', '    name: env-fixture',
    '',
  ].join('\n'), 'utf8');
  return { root };
}

test('manifest.env is validated as a bounded capability declaration', async t => {
  const base = { id: 'p', version: '0.1.0', kind: 'plugin', entry: './index.mjs' };
  assert.deepEqual(validateManifest({ ...base, env: ['A_1'] }).env, ['A_1']);
  assert.deepEqual(validateManifest(base).env, [], 'env is optional');
  for (const env of [['lower'], ['A B'], [''], 'A', ['A', 'A'], Array.from({ length: 17 }, (_, i) => `K_${i}`)]) {
    assert.throws(() => validateManifest({ ...base, env }), error => error.code === 'HARNESS_MANIFEST_INVALID', JSON.stringify(env));
  }
});

test('wh plugins --json exposes declared env names (never values)', async t => {
  const { root } = await fixture(t);
  const previous = process.env.EXTRA_KEY;
  process.env.EXTRA_KEY = 'super-secret-value';
  t.after(() => {
    if (previous === undefined) delete process.env.EXTRA_KEY;
    else process.env.EXTRA_KEY = previous;
  });

  const listed = capture();
  assert.equal(await runWh(['plugins', '--composition', 'harness.yml', '--json'], { root, ...listed }), 0);
  const document = JSON.parse(listed.stdout.text);
  assert.deepEqual(document.rows[0].env, ['DEEPSEEK_API_KEY', 'EXTRA_KEY']);
  assert.doesNotMatch(listed.stdout.text, /super-secret-value/u);

  const doctor = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml'], { root, ...doctor }), 0);
  assert.match(doctor.stdout.text, /environment reads \(declared names only, never values\):/u);
  assert.match(doctor.stdout.text, /fixture: DEEPSEEK_API_KEY, EXTRA_KEY/u);
  assert.doesNotMatch(doctor.stdout.text, /super-secret-value/u, 'doctor never prints an environment value');

  const doctorJson = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml', '--json'], { root, ...doctorJson }), 0);
  const doctorDocument = JSON.parse(doctorJson.stdout.text);
  assert.deepEqual(doctorDocument.envReads, [{ pluginId: 'fixture', manifestId: 'env-fixture', env: ['DEEPSEEK_API_KEY', 'EXTRA_KEY'] }]);
  assert.doesNotMatch(doctorJson.stdout.text, /super-secret-value/u);
});

test('a manifest without env declares no reads', async t => {
  const { root } = await fixture(t);
  const manifestPath = path.join(root, 'plugins', 'env-fixture', 'harness.plugin.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  delete manifest.env;
  await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  const doctorJson = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml', '--json'], { root, ...doctorJson }), 0);
  assert.deepEqual(JSON.parse(doctorJson.stdout.text).envReads, []);
});
