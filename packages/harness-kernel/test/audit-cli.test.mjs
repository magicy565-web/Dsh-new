import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgv, runWh } from '../src/cli.mjs';

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

const unified = (overrides = {}) => ({
  id: 'event-1', at: '2026-10-21T02:00:00.000Z', kind: 'inquiry', action: 'import',
  actor: { subject: 'local-operator', role: 'admin' }, ok: true, code: null, detail: { status: 201 }, ref: 'request-1',
  ...overrides,
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-audit-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const data = path.join(directory, 'data');
  await fs.mkdir(data, { recursive: true });
  const composition = path.join(directory, 'harness.yml');
  await fs.writeFile(composition, [
    'version: 1', 'name: audit-cli', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: storage', "    name: '@workspace-harness/seams/storage'", `    config: { directory: '${data.replace(/\\/gu, '/')}' }`,
    '',
  ].join('\n'), 'utf8');
  const state = path.join(data, 'workspace.json');
  await fs.writeFile(state, JSON.stringify({
    version: 1,
    harnessAudit: [
      unified({ id: 'e1', at: '2026-10-20T01:00:00.000Z', action: 'import' }),
      unified({ id: 'e2', at: '2026-10-20T02:00:00.000Z', action: 'identity-review', detail: { leadId: 'lead-alpha' } }),
      { id: 'legacy', at: '2026-10-20T03:00:00.000Z', actor: { subject: 'local-operator', role: 'admin' }, tool: 'inquiry_recovery_status', approvalId: null, ok: false, errorCode: 'HARNESS_TOOL_REFUSED' },
      unified({ id: 'e3', at: '2026-10-20T04:00:00.000Z', action: 'select', detail: { leadId: 'lead-alpha', selectionId: 'sel-1' } }),
    ],
  }), 'utf8');
  return { directory, composition, state, data };
}

test('wh audit reads the storage state file without mounting anything', async t => {
  const { directory, composition } = await fixture(t);
  const out = capture();
  assert.equal(await runWh(['audit', '--composition', composition, '--json'], { root: directory, ...out }), 0);
  const document = JSON.parse(out.stdout.text);
  assert.deepEqual(document.events.map(event => event.action), ['select', 'inquiry_recovery_status', 'identity-review', 'import'], 'newest first');
  const toolEvent = document.events.find(event => event.kind === 'tool');
  assert.equal(toolEvent.code, 'HARNESS_TOOL_REFUSED', 'legacy tool entries are normalised');

  const filtered = capture();
  assert.equal(await runWh(['audit', '--composition', composition, '--kind', 'inquiry', '--json'], { root: directory, ...filtered }), 0);
  assert.deepEqual(JSON.parse(filtered.stdout.text).events.map(event => event.action), ['select', 'identity-review', 'import']);

  const limited = capture();
  assert.equal(await runWh(['audit', '--composition', composition, '--limit', '2'], { root: directory, ...limited }), 0);
  assert.match(limited.stdout.text, /2 event\(s\)/u);
  assert.match(limited.stdout.text, /FAIL/u);

  const direct = capture();
  assert.equal(await runWh(['audit', '--state', path.join(directory, 'data', 'workspace.json')], { root: directory, ...direct }), 0);
  assert.match(direct.stdout.text, /4 event\(s\)/u);
});

test('wh audit fails honestly on missing state, no storage row and invalid JSON', async t => {
  const { directory, composition } = await fixture(t);
  const missing = capture();
  assert.equal(await runWh(['audit', '--state', path.join(directory, 'nope.json')], { root: directory, ...missing }), 2);
  assert.match(missing.stderr.text, /cannot read audit state/u);

  const noStorage = path.join(directory, 'empty.yml');
  await fs.writeFile(noStorage, 'version: 1\nname: empty\nserver: { host: 127.0.0.1, port: 0 }\nplugins: []\n', 'utf8');
  const none = capture();
  assert.equal(await runWh(['audit', '--composition', noStorage], { root: directory, ...none }), 2);
  assert.match(none.stderr.text, /no storage row/u);

  const broken = path.join(directory, 'broken.json');
  await fs.writeFile(broken, '{not json', 'utf8');
  const invalid = capture();
  assert.equal(await runWh(['audit', '--state', broken], { root: directory, ...invalid }), 1);
  assert.match(invalid.stderr.text, /not valid JSON/u);

  // The composition path is still honoured even when only the patch layer moves the storage row.
  assert.equal(parseArgv(['audit', '--state', 'x.json']).options.state, 'x.json');
  assert.equal(parseArgv(['audit', '--kind', 'tool']).options.kind, 'tool');
  assert.equal(parseArgv(['audit', '--limit', '5']).options.limit, 5);
  assert.equal(parseArgv(['audit', '--limit=0']).errors.length, 1);
  assert.equal(parseArgv(['audit', '--limit', '500']).errors.length, 1);
});
