import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installPlugin } from '../src/install.mjs';
import { runWh } from '../src/cli.mjs';

const ENTRY = `export async function apply(ctx) {
  if (ctx?.health?.register) ctx.health.register('doctor-fixture', () => ({ status: 'ok' }));
}
export default { apply };
`;

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function pluginPackage(directory, { id = 'doctor-plugin', env = ['DEEPSEEK_API_KEY'] } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'harness.plugin.json'), JSON.stringify({
    id, version: '0.1.0', kind: 'plugin', entry: './index.mjs', env,
  }), 'utf8');
  await fs.writeFile(path.join(directory, 'index.mjs'), ENTRY, 'utf8');
  return directory;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-doctor-report-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const source = await pluginPackage(path.join(root, 'source'));
  await installPlugin({ sourceDir: source, root, actor: 'ops' });
  await fs.writeFile(path.join(root, 'harness.yml'), [
    'version: 1', 'name: doctor-report', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: doctor', '    name: doctor-plugin',
    '',
  ].join('\n'), 'utf8');
  return { root, plugins: path.join(root, 'plugins') };
}

test('doctor reports composition digest, env declarations and install health in one JSON document', async t => {
  const { root } = await fixture(t);
  const output = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml', '--json'], { root, ...output }), 0);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.status, 'ok');
  assert.match(document.digest, /^[a-f0-9]{64}$/u);
  assert.match(document.patches.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(document.envReads, [{ pluginId: 'doctor', manifestId: 'doctor-plugin', env: ['DEEPSEEK_API_KEY'] }]);
  assert.equal(document.installed.ok, true);
  assert.deepEqual(document.installed.packages.map(item => [item.id, item.status]), [['doctor-plugin', 'ok']]);
  assert.deepEqual(document.installed.drift, []);
  assert.deepEqual(document.installed.missing, []);
  assert.deepEqual(document.routes.map(route => [route.method, route.path, route.pluginId]), [['GET', '/healthz', '__kernel__']]);

  const again = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml', '--json'], { root, ...again }), 0);
  assert.equal(JSON.parse(again.stdout.text).digest, document.digest, 'the composition digest is stable');
});

test('doctor fails when installed content drifted from the journal', async t => {
  const { root, plugins } = await fixture(t);
  await fs.writeFile(path.join(plugins, 'doctor-plugin', 'index.mjs'), `${ENTRY}\n// tampered\n`, 'utf8');
  const output = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml', '--json'], { root, ...output }), 1);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.status, 'ok', 'the composition itself still mounts');
  assert.equal(document.installed.ok, false);
  assert.deepEqual(document.installed.drift, ['doctor-plugin']);

  const text = capture();
  assert.equal(await runWh(['doctor', '--composition', 'harness.yml'], { root, ...text }), 1);
  assert.match(text.stdout.text, /installed packages \(plugins\): MISMATCH/u);
  assert.match(text.stdout.text, /digest: [a-f0-9]{64}/u);
});

test('a composition without packages reports clean install health', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'empty.yml'), [
    'version: 1', 'name: empty', 'server: { host: 127.0.0.1, port: 0 }', 'plugins: []',
    '',
  ].join('\n'), 'utf8');
  const output = capture();
  assert.equal(await runWh(['doctor', '--composition', 'empty.yml', '--target', 'empty-plugins', '--json'], { root, ...output }), 0);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.status, 'ok');
  assert.deepEqual(document.installed.packages, []);
  assert.equal(document.installed.ok, true);
  assert.deepEqual(document.plugins, []);
});
