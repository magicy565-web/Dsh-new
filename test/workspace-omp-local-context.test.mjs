import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
test('original OMP context pruning completes three natural-language turns under the unchanged HTTP cap', { timeout: 40000 }, async () => {
  const child = spawn(workspaceOmpPaths({}).bun, ['test/fixtures/workspace-omp-local-context.mjs'], { env: { PATH: process.env.PATH, HOME: '/tmp' }, stdio: ['ignore','pipe','pipe'] });
  let out = '', err = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  assert.equal(await new Promise(resolve => child.once('close', resolve)), 0, err.slice(-5000) + out.slice(-2000));
  const result = JSON.parse(out.trim()); assert.equal(result.passed, true); assert.equal(result.repaired.saved, 3); assert.equal(result.repaired.realProviderRequests, 0);
});
