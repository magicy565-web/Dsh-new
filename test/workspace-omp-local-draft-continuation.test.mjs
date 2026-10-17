import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { workspaceOmpPaths } from '../server/workspace-omp-runtime.mjs';

test('original local entry completes a draft then revises it in the same native Session without widening write authority', { timeout: 40000 }, async () => {
  const child = spawn(workspaceOmpPaths({}).bun, ['test/fixtures/workspace-omp-local-draft-continuation.mjs'], {
    env: { PATH: process.env.PATH, HOME: '/tmp', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
  assert.equal(await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); }), 0, err.slice(-5000) + out.slice(-2000));
  const report = JSON.parse(out.trim());
  assert.equal(report.passed, true); assert.equal(report.turns.length, 2);
  assert.equal(report.sameNativeSessionId, true); assert.equal(report.realProviderRequests, 0);
  assert.equal(report.overwriteRefused, true); assert.equal(report.changedSourceMockRequests, 0);
});
