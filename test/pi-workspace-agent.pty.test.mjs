import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startPiDevelopment } from '../server/pi-development.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(20); } throw new Error(label); }

test('official agent PTY submits natural input, reads four original stages and reopens the persisted official chat', { skip: process.platform === 'win32', timeout: 45_000 }, async t => {
  const isolated = await fs.mkdtemp('/tmp/workspace-pi-agent-pty-');
  const backend = await startPiDevelopment({ seedApprovalConnector: false });
  const drivers = [];
  t.after(async () => {
    for (const driver of drivers) { if (driver.child.exitCode === null) driver.child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await driver.closed; }
    await backend.close(); await fs.rm(isolated, { recursive: true, force: true });
  });
  function launch(sessionFile) {
    const child = spawn('python3', [path.join(root, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath, path.join(root, 'test/fixtures/pi-workspace-agent-pty.mjs')],
      { cwd: root, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', WS_AGENT_URL: backend.baseURL, WS_AGENT_TOKEN: backend.token,
        PI_OFFLINE: '1', PI_CODING_AGENT_DIR: path.join(isolated, 'agent'), PI_AGENT_TEST_DIRECTORY: isolated, ...(sessionFile ? { PI_AGENT_TEST_SESSION_FILE: sessionFile } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    const driver = { child, closed: once(child, 'exit'), raw: '', stderr: '', code: undefined }; drivers.push(driver);
    let buffer = '';
    child.stderr.on('data', data => { driver.stderr += data; });
    child.stdout.on('data', data => {
      buffer += data;
      while (buffer.includes('\n')) { const cut = buffer.indexOf('\n'); const event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
        if (event.type === 'output') driver.raw += event.data; if (event.type === 'exit') driver.code = event.code; }
    });
    driver.write = text => child.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
    driver.command = text => driver.write(text + '\r');
    return driver;
  }
  const first = launch(); await until(() => first.raw.includes('Explicit synthetic agent PTY fixture'), 'Official injected agent did not initialize: ' + first.stderr);
  assert.match(first.raw, /v1\.1\.0/);
  first.command('Prepare procurement documents for this public synthetic cup, public specification and quantity 10.');
  const findTask = () => backend.app.store.read().workspaceAgentTasks.tasks.find(row => row.requestKey === 'agent-pty-public-procurement');
  await until(() => findTask()?.status === 'done', 'Natural prompt did not dispatch to the original four-stage procurement');
  const saved = findTask(); assert.equal(saved.steps.filter(row => row.status === 'succeeded').length, 4); assert.equal(backend.faux.state.callCount, 4);
  first.command('Read the persisted original procurement documents.');
  try { await until(() => first.raw.includes('procurement-brief.md') && first.raw.includes('documents_ready'), 'Official Agent did not render original documents'); }
  catch (error) { t.diagnostic(first.raw.slice(-8000)); throw error; }
  assert.ok(first.raw.includes(saved.id)); assert.equal(saved.result.businessGoalAchieved, false);
  const marker = first.raw.length; first.command('Cancel this synthetic turn before submitting any task.');
  await until(() => first.raw.slice(marker).includes('Cancel this synthetic turn'), 'Synthetic cancel prompt was not accepted by the official editor');
  await delay(100); first.write('\x1b'); await delay(200);
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(backend.faux.state.callCount, 4);
  first.command('/ws-quit'); await until(() => first.code !== undefined, 'Official first agent session did not close'); assert.equal((await first.closed)[0], 0, first.stderr);
  const names = await fs.readdir(path.join(isolated, 'sessions')); assert.equal(names.filter(name => name.endsWith('.jsonl')).length, 1);
  const sessionFile = path.join(isolated, 'sessions', names.find(name => name.endsWith('.jsonl')));
  assert.ok((await fs.readFile(sessionFile, 'utf8')).includes(saved.id));
  const requests = [], handler = backend.app.server.listeners('request')[0]; backend.app.server.removeListener('request', handler);
  backend.app.server.on('request', (req, res) => { requests.push({ method: req.method, url: req.url }); handler(req, res); });
  const second = launch(sessionFile); await until(() => second.raw.includes('Explicit synthetic agent PTY fixture'), 'Official reopened agent did not initialize: ' + second.stderr);
  second.command('Read the original task again after reopening this chat.');
  await until(() => second.raw.includes('procurement-brief.md') && second.raw.includes('documents_ready'), 'Official reopened model context could not read original task');
  assert.ok(second.raw.includes(saved.id)); assert.ok(requests.some(row => row.url === `/api/agent/v1/tasks/${saved.id}`));
  assert.ok(requests.every(row => row.method === 'GET')); assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 1);
  second.command('/ws-quit'); await until(() => second.code !== undefined, 'Official reopened agent did not close'); assert.equal((await second.closed)[0], 0, second.stderr);
  assert.ok(!first.raw.includes(backend.token) && !second.raw.includes(backend.token));
  if (process.env.PI_AGENT_TEST_EVIDENCE_DIR) {
    const target = process.env.PI_AGENT_TEST_EVIDENCE_DIR; assert.ok(path.isAbsolute(target)); await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'agent-pty.txt'), first.raw + '\nOFFICIAL SESSION REOPEN\n' + second.raw);
    await fs.writeFile(path.join(target, 'agent-pty.json'), JSON.stringify({ transport: 'explicit-synthetic-faux-frontend-and-backend', liveModelCalls: 0, cliSample: false,
      taskId: saved.id, status: saved.status, steps: saved.steps, result: saved.result, deliverables: saved.deliverables, reopenedRequests: requests }, null, 2));
  }
  t.diagnostic('Real official InteractiveMode and PTY, injected finite faux frontend, original backend four Pi stages/documents, cancellation without new admission, and SessionManager.open with fresh HTTP reads; no live model call.');
});
