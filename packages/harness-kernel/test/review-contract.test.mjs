import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ERROR, REVIEW_BLOCKER, REVIEW_STATE, REVIEW_VERDICT } from '../../harness-contracts/src/index.mjs';
import { installPlugin } from '../src/install.mjs';
import { runWh } from '../src/cli.mjs';

const ENTRY = `export default { apply() {} };\n`;

function capture() {
  return { stdout: { text: '', write(chunk) { this.text += chunk; } }, stderr: { text: '', write(chunk) { this.text += chunk; } } };
}

async function pluginPackage(directory, { id, provides = [], requires = [] } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'harness.plugin.json'), JSON.stringify({
    id, version: '0.1.0', kind: 'plugin', entry: './index.mjs', provides, requires,
  }), 'utf8');
  await fs.writeFile(path.join(directory, 'index.mjs'), ENTRY, 'utf8');
  return directory;
}

test('the review vocabulary is frozen and shared', async t => {
  assert.deepEqual(REVIEW_VERDICT, { ready: 'ready', blocked: 'blocked' });
  assert.deepEqual(Object.values(REVIEW_BLOCKER).sort(), [
    'install-drift', 'install-missing', 'service-conflict', 'unmet-requires', 'unresolved-row',
  ]);
  assert.deepEqual(Object.values(REVIEW_STATE).sort(), ['invalid', 'missing', 'ok', 'stale', 'unavailable']);
  assert.equal(ERROR.reviewUnavailable, 'HARNESS_REVIEW_UNAVAILABLE');
  assert.equal(ERROR.reviewBlocked, 'HARNESS_REVIEW_BLOCKED');
  assert.ok(Object.isFrozen(REVIEW_VERDICT) && Object.isFrozen(REVIEW_BLOCKER) && Object.isFrozen(REVIEW_STATE));
});

test('wh review uses the shared blocker kinds and audit code', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-contract-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  await pluginPackage(path.join(root, 'source', 'needy'), { id: 'needy', requires: ['missing-service'] });
  await pluginPackage(path.join(root, 'source', 'dup-1'), { id: 'dup-1', provides: ['dup-service'] });
  await pluginPackage(path.join(root, 'source', 'dup-2'), { id: 'dup-2', provides: ['dup-service'] });
  for (const id of ['needy', 'dup-1', 'dup-2']) await installPlugin({ sourceDir: path.join(root, 'source', id), root });
  await fs.writeFile(path.join(root, 'harness.yml'), [
    'version: 1', 'name: review-contract', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: needy', '    name: needy',
    '  - id: dup1', '    name: dup-1',
    '  - id: dup2', '    name: dup-2',
    '  - id: ghost', '    name: missing-plugin',
    '',
  ].join('\n'), 'utf8');

  const auditState = path.join(root, 'data', 'workspace.json');
  const output = capture();
  assert.equal(await runWh(['review', '--composition', 'harness.yml', '--audit-state', auditState, '--json'], { root, ...output }), 1);
  const document = JSON.parse(output.stdout.text);
  assert.equal(document.verdict, REVIEW_VERDICT.blocked);
  assert.deepEqual(
    document.blockers.map(blocker => blocker.kind).sort(),
    [REVIEW_BLOCKER.serviceConflict, REVIEW_BLOCKER.unmetRequires, REVIEW_BLOCKER.unresolvedRow].sort(),
  );

  const audit = capture();
  assert.equal(await runWh(['audit', '--state', auditState, '--kind', 'review', '--json'], { root, ...audit }), 0);
  const event = JSON.parse(audit.stdout.text).events[0];
  assert.equal(event.action, REVIEW_VERDICT.blocked);
  assert.equal(event.code, ERROR.reviewBlocked);
  assert.deepEqual(event.detail.blockers.sort(), [REVIEW_BLOCKER.serviceConflict, REVIEW_BLOCKER.unmetRequires, REVIEW_BLOCKER.unresolvedRow].sort());

  // A ready review uses the ready verdict and no failure code.
  await fs.writeFile(path.join(root, 'clean.yml'), [
    'version: 1', 'name: clean', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: dup1', '    name: dup-1',
    '',
  ].join('\n'), 'utf8');
  const cleanAudit = path.join(root, 'data', 'clean.json');
  const clean = capture();
  assert.equal(await runWh(['review', '--composition', 'clean.yml', '--audit-state', cleanAudit, '--json'], { root, ...clean }), 0);
  assert.equal(JSON.parse(clean.stdout.text).verdict, REVIEW_VERDICT.ready);
  const cleanEvents = capture();
  assert.equal(await runWh(['audit', '--state', cleanAudit, '--kind', 'review', '--json'], { root, ...cleanEvents }), 0);
  const readyEvent = JSON.parse(cleanEvents.stdout.text).events[0];
  assert.equal(readyEvent.action, REVIEW_VERDICT.ready);
  assert.equal(readyEvent.code, null);
});
