import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
test('owned public snapshots are removed on close, setup failure and cancellation while originals and other Runs survive', { timeout: 40000 }, async t => {
  const paths = workspaceOmpPaths({}), directory = await fs.mkdtemp('/tmp/workspace-omp-public-cleanup-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const evidence = path.join(directory, 'facts.json');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(paths.bun, [path.join(repository, 'test/fixtures/workspace-omp-public-cleanup.mjs')], {
      cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
        PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory,
        PI_CODING_AGENT_DIR: path.join(directory, 'agent'), WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot,
        WORKSPACE_OMP_PUBLIC_CLEANUP_EVIDENCE: evidence } });
    let output = '', timedOut = false, escalation;
    const stop = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const deadline = setTimeout(() => { timedOut = true; stop('SIGTERM'); escalation = setTimeout(() => stop('SIGKILL'), 1500); }, 30000);
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', error => { clearTimeout(deadline); clearTimeout(escalation); reject(error); });
    child.once('close', code => { clearTimeout(deadline); clearTimeout(escalation); resolve({ code, output, timedOut }); });
  });
  assert.equal(result.timedOut, false, result.output); assert.equal(result.code, 0, result.output);
  assert.match(result.output, /PUBLIC_OMP_SNAPSHOT_CLEANUP_VERIFIED/);
  const facts = JSON.parse(await fs.readFile(evidence));
  assert.equal(facts.realPublishedReadTool, true); assert.equal(facts.originalSourcePreserved, true);
  assert.equal(facts.networkCalls, 0); assert.equal(facts.paidModelCalls, 0);
  if (process.env.WORKSPACE_OMP_PUBLIC_CLEANUP_SAVE_EVIDENCE) await fs.copyFile(evidence, process.env.WORKSPACE_OMP_PUBLIC_CLEANUP_SAVE_EVIDENCE);
});
