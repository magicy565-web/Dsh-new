import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSteps, clearStaleLock, discoverTests } from './release-check.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('discovery finds the shipped test files', async () => {
  const files = await discoverTests(ROOT);
  assert.ok(files.length >= 15, `expected many test files, saw ${files.length}`);
  assert.ok(files.some(file => file === 'plugins/workspace-chat/test/domain.test.mjs'));
  assert.ok(files.some(file => file.startsWith('scripts/')), 'script tests are included');
  assert.ok(files.some(file => file.startsWith('packages/harness-kernel/test/')), 'kernel tests are included');
  assert.equal(new Set(files).size, files.length, 'no duplicates');
});

test('the plan runs tests, every shipped smoke, then doctor', async () => {
  const steps = await buildSteps(ROOT);
  assert.match(steps[0].name, /^unit \S+\.test\.mjs$/u);
  assert.ok(steps.filter(step => step.name.startsWith('unit ')).length >= 15, 'one step per test file');
  const smokes = steps.filter(step => step.name.startsWith('smoke '));
  assert.ok(smokes.length >= 10, `expected the smokes, saw ${smokes.length}`);
  assert.ok(smokes.some(step => step.name === 'smoke quote-tool-smoke.mjs'));
  assert.ok(smokes.some(step => step.name === 'smoke purchase-tool-smoke.mjs'));
  assert.equal(steps.at(-1).name, 'doctor');
});

test('skipping categories keeps the doctor gate', async () => {
  const steps = await buildSteps(ROOT, { skipTests: true, skipSmokes: true });
  assert.deepEqual(steps.map(step => step.name), ['doctor']);
});

test('a stale lock is cleared, a live one is not', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-lock-'));
  try {
    const absent = await clearStaleLock(directory);
    assert.deepEqual(absent, { cleared: false, reason: 'absent' });

    await writeFile(path.join(directory, 'workspace.lock'), JSON.stringify({ pid: 999_999_999 }), 'utf8');
    const stale = await clearStaleLock(directory);
    assert.equal(stale.cleared, true);
    assert.equal(await stat(path.join(directory, 'workspace.lock')).catch(() => null), null);

    await writeFile(path.join(directory, 'workspace.lock'), JSON.stringify({ pid: process.pid }), 'utf8');
    const live = await clearStaleLock(directory);
    assert.equal(live.cleared, false);
    assert.equal(live.reason, 'owner-alive');
    assert.ok(await stat(path.join(directory, 'workspace.lock')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unreadable lock is left alone', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-lock-bad-'));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'workspace.lock'), 'not json', 'utf8');
    const result = await clearStaleLock(directory);
    assert.deepEqual(result, { cleared: false, reason: 'unreadable' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
