import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runWh } from '../src/cli.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import {
  REPO_ROOT,
  cleanupRoot,
  fixtureComposition,
  makeRoot,
} from './helpers.mjs';

function fakeStream() {
  const chunks = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

async function run(argv, { root = REPO_ROOT } = {}) {
  const stdout = fakeStream();
  const stderr = fakeStream();
  const code = await runWh(argv, { stdout, stderr, root });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

test('cli: list prints resolved rows with status and requires/provides', async () => {
  const { code, stdout } = await run([
    'list',
    '--composition',
    fixtureComposition('order.composition.yml'),
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /composition "order"/u);
  assert.match(stdout, /consumer/u);
  assert.match(stdout, /provider/u);
  assert.match(stdout, /resolved/u);
  assert.match(stdout, /\balpha\b/u);
  assert.match(stdout, /\bbeta\b/u);
  assert.match(stdout, /trace-provider\/src\/index\.mjs/u);
});

test('cli: list --json is machine readable', async () => {
  const { code, stdout } = await run([
    'list',
    '--json',
    '--composition',
    fixtureComposition('order.composition.yml'),
  ]);
  assert.equal(code, 0);
  const document = JSON.parse(stdout);
  assert.equal(document.name, 'order');
  assert.equal(document.version, 1);
  assert.equal(document.rows.length, 2);
  const provider = document.rows.find(row => row.id === 'provider');
  assert.equal(provider.status, 'resolved');
  assert.deepEqual(provider.provides, ['alpha']);
  assert.deepEqual(provider.requires, []);
  assert.match(provider.entry, /trace-provider\/src\/index\.mjs$/u);
});

test('cli: list reports missing entries without crashing', async () => {
  const root = await makeRoot({
    'list.yml': `version: 1
name: missing-list
plugins:
  - id: nope
    name: definitely-not-installed
  - id: skipped
    name: also-not-installed
    disabled: true
`,
  });
  try {
    const { code, stdout } = await run(['list', '--json', '--composition', join(root, 'list.yml')], { root });
    assert.equal(code, 0);
    const document = JSON.parse(stdout);
    const nope = document.rows.find(row => row.id === 'nope');
    assert.equal(nope.status, 'missing');
    assert.equal(nope.error.code, ERROR.pluginFailed);
    const skipped = document.rows.find(row => row.id === 'skipped');
    assert.equal(skipped.status, 'disabled');
    assert.equal(skipped.disabled, true);
  } finally {
    await cleanupRoot(root);
  }
});

test('cli: list on the real harness.local.yml does not crash when seams are absent', async () => {
  const { code, stdout, stderr } = await run(['list', '--json', '--composition', 'harness.local.yml']);
  assert.equal(stderr, '');
  assert.equal(code, 0);
  const document = JSON.parse(stdout);
  assert.deepEqual(
    document.rows.map(row => row.id),
    ['storage', 'approval', 'tools'],
  );
  for (const row of document.rows) {
    assert.ok(['resolved', 'missing', 'invalid'].includes(row.status), `unexpected status ${row.status}`);
  }
});

test('cli: doctor loads, reports health, and exits 0 when healthy', async () => {
  const { code, stdout, stderr } = await run([
    'doctor',
    '--composition',
    fixtureComposition('http.composition.yml'),
  ]);
  assert.equal(stderr, '');
  assert.equal(code, 0);
  assert.match(stdout, /status: ok/u);
  assert.match(stdout, /routes-ok: ok/u);
  assert.match(stdout, /GET \/healthz/u);
  assert.match(stdout, /GET \/api\/fixture\/hello/u);
});

test('cli: doctor exits non-zero for a degraded harness', async () => {
  const { code, stdout } = await run([
    'doctor',
    '--composition',
    fixtureComposition('degraded.composition.yml'),
  ]);
  assert.equal(code, 1);
  assert.match(stdout, /status: degraded/u);
  assert.match(stdout, /fixture wants attention/u);
});

test('cli: doctor surfaces a manifest failure as exit code 1', async () => {
  const { code, stderr } = await run([
    'doctor',
    '--composition',
    fixtureComposition('bad-manifest.composition.yml'),
  ]);
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(ERROR.manifestInvalid, 'u'));
});

test('cli: usage errors exit 2 and help exits 0', async () => {
  assert.equal((await run(['help'])).code, 0);
  assert.match((await run(['help'])).stdout, /wh <command>/u);
  const unknownCommand = await run(['frobnicate']);
  assert.equal(unknownCommand.code, 2);
  assert.match(unknownCommand.stderr, /unknown command/u);
  const unknownOption = await run(['list', '--nope']);
  assert.equal(unknownOption.code, 2);
  assert.match(unknownOption.stderr, /unknown option/u);
});

test('cli: missing composition file exits 1 with the composition error code', async () => {
  const { code, stderr } = await run(['list', '--composition', 'nope-missing.yml']);
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(ERROR.compositionInvalid, 'u'));
  assert.match(stderr, /not found/u);
});
