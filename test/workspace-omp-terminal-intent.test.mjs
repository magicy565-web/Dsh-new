import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../plugins/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { taskFixture, TOKEN_A } from './fixtures/pi-task-helpers.mjs';

const repository = new URL('..', import.meta.url).pathname, paths = workspaceOmpPaths({});
const model = { provider: 'public-terminal-intent', id: 'finite', baseUrl: 'https://synthetic.invalid' };
async function until(check, label) {
  for (let i = 0; i < 1200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(label());
}
test('real official OMP TUI keeps natural input read-only even when the model submits, and enables only human-confirmed explicit execution', { timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/omp-terminal-intent-'); let f;
  const draft = { title: 'Public synthetic execution choice', requestId: 'public-intent-exact-task', input: {
    product: 'Public synthetic cup', spec: 'Public synthetic specification', target_market: 'Public synthetic overseas market',
    factory_materials: 'Capacity, prices and delivery unknown.', customer_materials: 'No verified buyer or contact consent.' } };
  // This regression verifies admission, not completion of business documents.
  // The separately bounded backend fixture leaves a visible incomplete stage.
  f = await taskFixture(t, { responses: [fauxAssistantMessage('Public synthetic stage remains incomplete; no completed document claim.')], businessAgentOptions: {
    recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration: { providerId: model.provider, model: model.id, baseUrl: model.baseUrl },
      syntheticResponses: [{ tool: 'workspace_factory_task', arguments: draft }, { text: 'PUBLIC_INTENT_BOUNDARY_REPLY' }] }),
    resolveBinding: async () => ({ client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A }), model }),
  } });
  const driver = spawn('python3', [repository + '/test/fixtures/pi-tui-pty-driver.py', process.execPath, repository + '/scripts/workspace-omp-legacy.mjs', '--terminal'], {
    cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory,
      LANG: 'C.UTF-8', TERM: 'xterm-256color', PI_NO_TITLE: '1', WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WS_AGENT_URL: f.baseURL },
    stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'close'); let raw = '', buffer = '', terminalExit;
  driver.stdout.on('data', bytes => { buffer += bytes;
    while (buffer.includes('\n')) { const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
      if (event.type === 'output') raw += event.data; if (event.type === 'exit') terminalExit = event.code; }
  });
  const write = text => driver.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => write('\x15' + text + '\r');
  t.after(async () => { if (driver.exitCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await exit; await fs.rm(directory, { recursive: true, force: true }); });
  await until(() => raw.includes('terminal model disabled'), () => 'Official UI did not initialize: ' + raw.slice(-2000));
  command('Only answer a public product question; do not start work.');
  await until(() => raw.includes('PUBLIC_INTENT_BOUNDARY_REPLY'), () => 'Original reply missing: ' + raw.slice(-2500));
  let state = f.app.store.read();
  assert.equal(state.runs.length, 1); assert.equal(state.runs[0].businessAgentContext.allowBusinessSubmit, false);
  assert.ok(state.runs[0].events.some(event => event.type === 'pi.tool.failed' && event.toolName === 'workspace_factory_task'));
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  command('/ws-execute Prepare the explicitly supplied public synthetic factory documents.');
  await until(() => raw.includes('Allow original business submission for this exact public input?'), () => 'Explicit choice not displayed: ' + raw.slice(-2500));
  write('\x1b');
  await until(() => raw.includes('HUMAN_CONFIRMATION_DECLINED'), () => 'Declined choice not acknowledged: ' + raw.slice(-2500));
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  let marker = raw.length;
  command('/ws-execute Prepare the explicitly supplied public synthetic factory documents.');
  await until(() => raw.slice(marker).includes('Allow original business submission for this exact public input?'), () => 'Second choice not displayed: ' + raw.slice(-2500));
  write('\r');
  await until(() => f.app.store.read().workspaceAgentTasks.tasks.length === 1, () => 'Confirmed original task was not admitted: ' + raw.slice(-2000));
  await until(() => f.app.store.read().runs.filter(run => run.businessAgentContext).every(run => run.status === 'succeeded'), () => 'Original frontend did not settle: ' + raw.slice(-2500));
  state = f.app.store.read(); const frontend = state.runs.filter(run => run.businessAgentContext);
  assert.equal(frontend.length, 2); assert.deepEqual(frontend.map(run => run.businessAgentContext.allowBusinessSubmit), [false, true]);
  assert.equal(state.workspaceAgentTasks.tasks.length, 1);
  assert.equal(state.workspaceAgentTasks.tasks[0].title, draft.title);
  assert.equal(frontend[1].executionRefs[0].taskId, state.workspaceAgentTasks.tasks[0].id);
  marker = raw.length; command('/ws-front-status');
  await until(() => raw.slice(marker).includes(frontend[1].id), () => 'Exact executed Run receipt missing: ' + raw.slice(-2500));
  command('/quit'); await until(() => terminalExit !== undefined, () => 'Official UI did not exit: ' + raw.slice(-1500));
  assert.equal(terminalExit, 0); assert.equal((await exit)[0], 0);
});
