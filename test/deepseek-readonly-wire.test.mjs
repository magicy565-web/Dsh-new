import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { PUBLIC_PROCUREMENT } from './fixtures/pi-workspace-agent-faux.mjs';
import { until } from './fixtures/pi-task-helpers.mjs';
const paths = workspaceOmpPaths();
const configured = existsSync(paths.bun) && existsSync(paths.packageRoot + '/package.json');
test('actual OMP AgentSession and provider wire read original Store; uncertain usage/auth/write/exhaustion stop', { skip: !configured, timeout: 90000 }, async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const submitted = await createWorkspaceClient(f).businessSubmit(PUBLIC_PROCUREMENT);
  await until(() => f.app.store.read().workspaceAgentTasks.tasks.find(r => r.id === submitted.task.taskId)?.status === 'done');
  const before = { tasks: f.app.store.read().workspaceAgentTasks.tasks.length, runs: f.app.store.read().runs.length, modelCalls: f.faux.state.callCount };
  for (const mode of ['happy', 'missing-usage', 'auth-error', 'forced-write', 'exhausted']) {
    await t.test(mode, async () => {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(paths.bun, ['test/fixtures/deepseek-omp-readonly-wire.mjs'], { env: { PATH: process.env.PATH,
          SYNTHETIC_BASE: f.baseURL, SYNTHETIC_TOKEN: f.token, SYNTHETIC_TASK_ID: submitted.task.taskId, SYNTHETIC_MODE: mode,
          WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
        child.once('error', reject); child.once('close', code => code === 0 ? resolve(out) : reject(Error('Synthetic OMP fixture failed: ' + err.slice(-3000))));
      });
      assert.equal(JSON.parse(result.trim().split('\n').at(-1)).realModelRequests, 0);
    });
  }
  assert.deepEqual({ tasks: f.app.store.read().workspaceAgentTasks.tasks.length, runs: f.app.store.read().runs.length, modelCalls: f.faux.state.callCount }, before);
});
