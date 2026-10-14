import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { PUBLIC_PROCUREMENT } from './fixtures/pi-workspace-agent-faux.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(20); } throw new Error(label); }
const PRIVATE = 'PRIVATE_PLUGIN_PTY_LIBRARY_SENTINEL_MUST_NOT_REACH_MODEL';
async function launcher(t, backend) {
  const isolated = await fs.mkdtemp('/tmp/workspace-pi-plugin-pty-');
  const child = spawn('python3', [path.join(root, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath, path.join(root, 'test/fixtures/pi-workspace-plugins-pty.mjs')],
    { cwd: root, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', WS_AGENT_URL: backend.baseURL,
      WS_AGENT_TOKEN: backend.token, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: path.join(isolated, 'agent'), PI_PLUGIN_TEST_DIRECTORY: isolated }, stdio: ['pipe', 'pipe', 'pipe'] });
  const driver = { child, closed: once(child, 'exit'), raw: '', stderr: '', code: undefined }; let buffer = '';
  child.stderr.on('data', data => { driver.stderr += data; });
  child.stdout.on('data', data => { buffer += data; while (buffer.includes('\n')) {
    const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
    if (event.type === 'output') driver.raw += event.data; if (event.type === 'exit') driver.code = event.code;
  } });
  driver.command = text => child.stdin.write(JSON.stringify({ type: 'write', text: text + '\r' }) + '\n');
  t.after(async () => { if (child.exitCode === null) child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await driver.closed; await fs.rm(isolated, { recursive: true, force: true }); });
  await until(() => driver.raw.includes('Explicit synthetic built-in plugin PTY fixture'), 'Official plugin fixture failed to start: ' + driver.stderr);
  assert.match(driver.raw, /v1\.1\.0/);
  driver.question = async (question, tool) => {
    const offset = driver.raw.length; driver.command(question);
    await until(() => driver.raw.slice(offset).includes('PLUGIN_REPLY_END ' + tool), 'Official tool answer missing: ' + tool);
    return driver.raw.slice(offset);
  };
  driver.quit = async () => { driver.command('/ws-quit'); await until(() => driver.code !== undefined, 'Official plugin TUI did not close'); assert.equal((await driver.closed)[0], 0, driver.stderr); };
  return driver;
}

test('real official Pi PTY calls built-in plugins for product questions and original task/result records', { skip: process.platform === 'win32', timeout: 45_000 }, async t => {
  const backend = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => backend.close());
  const actor = { subject: 'synthetic-owner', role: 'admin' }, company = backend.app.businessLibrary.getCompany().company;
  await backend.app.businessLibrary.updateCompany({ requestId: randomUUID(), expectedRevision: company.revision, changes: { description: PRIVATE } }, actor);
  const product = (await backend.app.businessLibrary.createProduct({ requestId: randomUUID(), name: PRIVATE }, actor)).product;
  const saved = await createWorkspaceClient(backend).businessSubmit({ ...PUBLIC_PROCUREMENT, requestId: 'plugins-pty-original-task' });
  const task = () => backend.app.store.read().workspaceAgentTasks.tasks.find(row => row.id === saved.task.taskId);
  await until(() => task()?.status === 'done', 'Original public procurement did not settle');
  const calls = [], handler = backend.app.server.listeners('request')[0]; backend.app.server.removeListener('request', handler);
  backend.app.server.on('request', (req, res) => { calls.push({ method: req.method, route: req.url }); handler(req, res); });
  const driver = await launcher(t, backend);
  for (const [question, tool] of [['有哪些产品？', 'workspace_products'], [`产品详情 ${product.id} 是什么？`, 'workspace_product'], ['公司资料是什么？', 'workspace_company_profile']]) {
    const output = await driver.question(question, tool); assert.match(output, /LIBRARY_SESSION_READ_UNCONFIGURED/); assert.match(output, /unconfigured/);
  }
  const progress = await driver.question('任务进度是什么？', 'workspace_business_tasks');
  assert.ok(progress.includes(saved.task.taskId)); assert.match(progress, /done/);
  const result = await driver.question('上次成果是什么？', 'workspace_business_result');
  assert.ok(result.includes(saved.task.taskId)); assert.match(result, /documents_ready/); assert.match(result, /procurement-brief\.md/);
  assert.ok(calls.some(row => row.route === '/api/agent/v1/tasks?limit=1&withArtifacts=1'));
  assert.ok(calls.some(row => row.route === `/api/agent/v1/tasks/${saved.task.taskId}/artifacts/procurement-brief.md`));
  assert.ok(calls.every(row => row.method === 'GET' && !row.route.startsWith('/api/library/')));
  assert.ok(!driver.raw.includes(PRIVATE)); assert.ok(!driver.raw.includes(backend.token));
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(backend.faux.state.callCount, 4);
  await driver.quit();
  if (process.env.PI_PLUGIN_TEST_EVIDENCE_DIR) {
    const target = process.env.PI_PLUGIN_TEST_EVIDENCE_DIR; assert.ok(path.isAbsolute(target)); await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'plugins-pty.txt'), driver.raw);
    await fs.writeFile(path.join(target, 'plugins-pty.json'), JSON.stringify({ transport: 'explicit-keyless-faux-frontend-and-backend', liveModelCalls: 0,
      officialVersion: '1.1.0', tools: ['workspace_products', 'workspace_product', 'workspace_company_profile', 'workspace_business_tasks', 'workspace_business_result'],
      taskId: saved.task.taskId, status: task().status, calls, artifacts: task().deliverables.map(row => ({ name: row.name, sha256: row.sha256 })),
      terminalSha256: createHash('sha256').update(driver.raw).digest('hex'), privateLibraryDisclosed: false }, null, 2));
  }
  t.diagnostic('Official v1.1.0 InteractiveMode with explicit finite faux frontend answered five typical questions through original tools/HTTP; private library unconfigured, one original task, three original text artifacts, no live model call.');
});

test('official Pi PTY answers empty task/result queries honestly without synthetic production fallback', { skip: process.platform === 'win32', timeout: 30_000 }, async t => {
  const backend = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => backend.close());
  const driver = await launcher(t, backend);
  assert.match(await driver.question('任务进度是什么？', 'workspace_business_tasks'), /empty/);
  assert.match(await driver.question('上次成果是什么？', 'workspace_business_result'), /empty/);
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(backend.faux.state.callCount, 0);
  assert.ok(!driver.raw.includes(backend.token)); await driver.quit();
});
