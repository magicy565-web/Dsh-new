import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const sdk = process.env.OMP_BUILTINS_SDK_ROOT;
const bun = fileURLToPath(new URL('../support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun', import.meta.url));
test('published OMP builtin task divides public synthetic reads and cancels its original child session',
  { skip: !sdk && 'Set OMP_BUILTINS_SDK_ROOT to fixed audited 18.10.4.', timeout: 60000 }, async t => {
    const dir = await fs.mkdtemp('/tmp/omp-factory-task-'); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const evidence = path.join(dir, 'evidence.json');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(bun, [fileURLToPath(new URL('./fixtures/omp-factory-task.mjs', import.meta.url))], { cwd: dir,
        env: { PATH: path.dirname(bun) + ':/usr/bin:/bin', HOME: dir, TMPDIR: dir,
          PI_CODING_AGENT_DIR: path.join(dir, 'agent'), OMP_BUILTINS_SDK_ROOT: sdk,
          OMP_BUILTINS_EVIDENCE: evidence, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('OMP builtin task fixture timeout')); }, 55000);
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output); assert.match(result.output, /OMP_BUILTIN_TASK_CHILDREN_VERIFIED/);
    const facts = JSON.parse(await fs.readFile(evidence)); assert.equal(facts.paidModelCalls, 0);
    if (process.env.OMP_TASK_SAVE_EVIDENCE) await fs.copyFile(evidence, process.env.OMP_TASK_SAVE_EVIDENCE);
    t.diagnostic('Original OMP TaskTool child AgentSessions, explicit finite faux and public synthetic files only. Not an original Workspace business task or real model/customer proof.');
  });
