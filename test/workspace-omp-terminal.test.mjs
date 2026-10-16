import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWorkspaceClient } from '../plugins/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { taskFixture, TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { registerWorkspaceHumanControls } from '../plugins/workspace-procurement/src/human-controls.mjs';
import { createWorkspaceOmpTerminalClient, workspaceOmpTerminalControlClient } from '../server/workspace-omp-terminal-client.mjs';
const repository = new URL('..', import.meta.url).pathname, paths = workspaceOmpPaths({});
const model = { provider: 'workspace-omp-terminal-fixture', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
async function until(check, label) { for (let i = 0; i < 700; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(typeof label === 'function' ? label() : label); }
test('actual official OMP TUI consumes natural input through original local HTTP Run, with no UI model or second ledger', { timeout: 70000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-terminal-'); let f;
  f = await taskFixture(t, { businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: [{ tool: 'workspace_factory_capabilities', arguments: {} }, { text: 'OMP_ORIGINAL_HTTP_TERMINAL_REPLY; public synthetic materials only.' }] }),
    resolveBinding: async () => ({ client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A }), model }) } });
  const driver = spawn('python3', [repository + '/test/fixtures/pi-tui-pty-driver.py', process.execPath, repository + '/scripts/workspace-omp.mjs'], {
    cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory,
      LANG: 'C.UTF-8', TERM: 'xterm-256color', PI_CODING_AGENT_DIR: directory + '/agent', PI_NO_TITLE: '1',
      WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: TOKEN_A, WS_AGENT_SESSION_DIR: directory,
      WORKSPACE_OMP_TERMINAL_DIAGNOSTIC: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'close'); let raw = '', buffer = '', error = '', terminalExit, phase = 'initialize', passed = false; const driverTrace = [];
  driver.stderr.on('data', data => { error += data; });
  driver.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) { const index = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      driverTrace.push(event.type); if (event.type === 'output') raw += event.data; if (event.type === 'exit') terminalExit = event.code; }
  });
  const write = text => driver.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => { write('\x15'); write(text + '\r'); };
  t.after(async () => {
    if (!passed) t.diagnostic(JSON.stringify({ phase, terminalExit: terminalExit ?? null, driverExit: driver.exitCode, driverTrace,
      stderr: error.slice(-12000).replaceAll(TOKEN_A, '[synthetic binding omitted]'), scrollback: raw.slice(-12000).replaceAll(TOKEN_A, '[synthetic binding omitted]') }));
    if (driver.exitCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await exit; await fs.rm(directory, { recursive: true, force: true });
  });
  await until(() => raw.includes('terminal model disabled'), () => 'Official OMP TUI did not initialize: ' + error + raw.slice(-3500) + JSON.stringify({ driverTrace, terminalExit }));
  phase = 'natural-input'; command('Organize these explicitly public synthetic factory materials.');
  await until(() => raw.includes('OMP_ORIGINAL_HTTP_TERMINAL_REPLY'), () => 'Original HTTP/Run reply did not reach official UI: ' + raw.slice(-3500));
  const state = f.app.store.read(); assert.equal(state.runs.length, 1); assert.equal(state.runs[0].status, 'succeeded'); assert.ok(state.runs[0].businessAgentContext);
  assert.equal(state.workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  assert.equal(state.conversations.length, 1); assert.equal(state.conversations[0].businessAgentSession.engineScope, 'omp:18.10.4:public-v1');
  phase = 'status'; const marker = raw.length; command('/ws-front-status'); await until(() => raw.slice(marker).includes(state.runs[0].id), 'Exact current Run receipt was not displayed.');
  await new Promise(resolve => setTimeout(resolve, 100));
  phase = 'shell-refusal'; command('!cat /tmp/forbidden-synthetic'); await until(() => raw.includes('Shell and Python execution are unavailable'), () => 'Original public input boundary was not enforced: ' + raw.slice(-3500));
  write('\x15');
  command('/export /tmp/forbidden-synthetic'); await until(() => raw.includes('Only the original human task commands'), 'Foreign builtin command was not blocked.');
  assert.equal(f.app.store.read().runs.length, 1); assert.ok(!raw.includes(TOKEN_A));
  write('\x15');
  phase = 'quit'; command('/quit'); await until(() => terminalExit !== undefined, 'Official OMP UI did not exit: ' + raw.slice(-1000)); assert.equal(terminalExit, 0); assert.equal((await exit)[0], 0, error); passed = true;
  t.diagnostic('Actual default Node launcher in real POSIX PTY -> official InteractiveMode; input handled:true -> original HTTP Conversation/Run -> isolated official OMP worker -> sendMessage receipt. UI provider disabled; finite keyless server fixture only.');
});

test('UI-only original execution/recovery commands return unconfigured without dispatch, while human status/cancel/approval remain separate', async () => {
  const commands = new Map(), calls = [], displayed = [];
  const underlying = Object.fromEntries(['submit', 'resume', 'continue', 'businessSubmit', 'businessResume', 'cancel', 'decision', 'businessCancel'].map(name => [name, async () => { calls.push(name); return { status: 'original-receipt' }; }]));
  underlying.status = async () => ({ status: 'interrupted', proposals: [{ id: 'original-proposal', status: 'approved' }] });
  underlying.businessStatus = async () => ({ task: { status: 'interrupted', result: { resumable: true } } });
  registerWorkspaceHumanControls({ registerCommand: (name, value) => commands.set(name, value), sendMessage: value => displayed.push(JSON.parse(value.content)) }, workspaceOmpTerminalControlClient(underlying));
  const ctx = { hasUI: true, ui: { confirm: async () => true, notify: message => { throw new Error(message); } } };
  await commands.get('ws-task').handler('{"title":"Public","content":"Public task","requestId":"stable-public"}', ctx);
  await commands.get('ws-resume').handler('original-run stable-recovery', ctx);
  await commands.get('ws-continue').handler('original-run original-proposal stable-continuation', ctx);
  await commands.get('ws-business-resume').handler('original-task stable-recovery', ctx);
  assert.deepEqual(calls, []); assert.equal(displayed.length, 4);
  assert.ok(displayed.every(receipt => receipt.status === 'unconfigured' && receipt.reason === 'ORIGINAL_HOST_EXECUTION_REVIEW_REQUIRED'));
  await commands.get('ws-cancel').handler('original-run', ctx); await commands.get('ws-approve').handler('original-run original-proposal', ctx);
  assert.deepEqual(calls, ['cancel', 'decision']);
});

test('terminal transport refuses a legacy Pi host and enterprise Session without creating a conversation or Run', async t => {
  const legacy = await taskFixture(t);
  const transport = createWorkspaceOmpTerminalClient({ baseURL: legacy.baseURL });
  await assert.rejects(transport.submit('Explicit public product text'), /HTTP 404|no fixed OMP public frontend/);
  assert.equal(legacy.app.store.read().conversations.length, 0); assert.equal(legacy.app.store.read().runs.length, 0); assert.equal(legacy.faux.state.callCount, 0);
  let reads = 0;
  const enterprise = createWorkspaceOmpTerminalClient({ baseURL: 'http://127.0.0.1:1', fetchImpl: async () => { reads++; return new Response(JSON.stringify({ mode: 'enterprise', authenticated: true, workspaceId: 'public-fixture-enterprise', user: { id: 'member-a' } })); } });
  await assert.rejects(enterprise.submit('Explicit public text'), /Enterprise Session\/CSRF/); assert.equal(reads, 1);
});

test('original public terminal receipt enforces enterprise Session, conversation ownership and exact Run membership', { timeout: 45000 }, async t => {
  let f;
  f = await taskFixture(t, { enterprise: true, businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: [{ text: 'Public original receipt only.' }] }),
    resolveBinding: async () => ({ client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
      const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
      return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
    } }), model }) } });
  const create = key => f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Public receipt scope', requestId: key } });
  const created = await create('omp-public-receipt-scope'), id = created.json.conversation.id;
  const sent = await f.workspace(`/api/conversations/${id}/messages`, { subject: 'member-a', body: { content: 'Explicit public text', requestId: 'omp-public-receipt-run' } });
  assert.equal(sent.status, 202, sent.text); const runId = sent.json.run.id;
  await until(() => f.app.store.read().runs.find(row => row.id === runId)?.status === 'succeeded', 'Original public Run did not finish.');
  const route = `/api/conversations/${id}/terminal-status?runId=${runId}`;
  const own = await f.workspace(route, { subject: 'member-a' }); assert.equal(own.status, 200, own.text); assert.equal(own.json.reply.runId, runId);
  assert.equal((await f.workspace(route, { subject: 'member-b' })).status, 404);
  const other = await create('omp-public-other-scope'); assert.equal((await f.workspace(`/api/conversations/${other.json.conversation.id}/terminal-status?runId=${runId}`, { subject: 'member-a' })).status, 404);
  assert.equal((await request(f.baseURL, route, { headers: { Host: 'workspace.example' } })).status, 401);
  assert.equal((await f.workspace(route + '&runId=' + runId, { subject: 'member-a' })).status, 400);
  await f.app.store.update(state => { state.messages.find(row => row.id === state.runs.find(run => run.id === runId).assistantId).content = 'password=public-synthetic-never-real-fixture'; });
  const secretLike = await f.workspace(route, { subject: 'member-a' }); assert.equal(secretLike.status, 403); assert.equal(secretLike.json.error.code, 'PUBLIC_RECEIPT_REQUIRED');
  assert.equal(f.app.store.read().runs.find(row => row.id === runId).events.filter(event => event.type === 'pi.agent-session.request').length, 1);
});

test('default official terminal stays interactive without credentials and displays original unconfigured refusal with zero Runs', { timeout: 45000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-unconfigured-ui-');
  const f = await taskFixture(t, { businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration }), resolveBinding: async () => null } });
  const driver = spawn('python3', [repository + '/test/fixtures/pi-tui-pty-driver.py', process.execPath, repository + '/scripts/workspace-omp.mjs'], {
    cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, LANG: 'C.UTF-8', TERM: 'xterm-256color',
      PI_NO_TITLE: '1', WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WS_AGENT_URL: f.baseURL }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'close'); let raw = '', buffer = '', terminalExit, error = '', phase = 'initialize', passed = false;
  driver.stderr.on('data', data => { error += data; });
  driver.stdout.on('data', data => { buffer += data;
    while (buffer.includes('\n')) { const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
      if (event.type === 'output') raw += event.data; if (event.type === 'exit') terminalExit = event.code; }
  });
  const command = text => { driver.stdin.write(JSON.stringify({ type: 'write', text: '\x15' + text + '\r' }) + '\n'); };
  t.after(async () => {
    if (!passed) t.diagnostic(JSON.stringify({ phase, terminalExit: terminalExit ?? null, driverExit: driver.exitCode,
      stderr: error.slice(-12000), scrollback: raw.slice(-12000) }));
    if (driver.exitCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await exit; await fs.rm(directory, { recursive: true, force: true });
  });
  await until(() => raw.includes('terminal model disabled'), () => 'Unconfigured official UI did not initialize: ' + raw.slice(-2000));
  phase = 'natural-unconfigured-refusal'; command('Organize explicitly supplied public factory text.');
  await until(() => raw.includes('BUSINESS_AGENT_UNCONFIGURED'), () => 'Original HTTP refusal was not displayed: ' + raw.slice(-2500));
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.faux.state.callCount, 0);
  phase = 'binding-unconfigured-refusal'; command('/ws-task {"title":"Public","content":"Public text","requestId":"ui-no-host-review"}');
  await until(() => raw.includes('EXISTING_WORKSPACE_BINDING_REQUIRED'), 'Unconfigured original command should return its binding gap.');
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.faux.state.callCount, 0);
  phase = 'quit'; command('/quit'); await until(() => terminalExit !== undefined, 'Unconfigured official UI did not close.'); assert.equal(terminalExit, 0, raw.slice(-6000)); assert.equal((await exit)[0], 0, raw.slice(-6000)); passed = true;
});

test('official terminal human stop confirmation preserves the original Run on Escape, then natively cancels that exact Run', { timeout: 45000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-terminal-stop-'), lifecycle = []; let f;
  f = await taskFixture(t, { businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: [{ wait: 60000, text: 'Must not complete before cancellation.' }], onWorkerLifecycle: event => lifecycle.push(event) }),
    resolveBinding: async () => ({ client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A }), model }) } });
  const driver = spawn('python3', [repository + '/test/fixtures/pi-tui-pty-driver.py', process.execPath, repository + '/scripts/workspace-omp.mjs'], {
    cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, LANG: 'C.UTF-8', TERM: 'xterm-256color',
      PI_NO_TITLE: '1', WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WS_AGENT_URL: f.baseURL }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'close'); let raw = '', buffer = '', terminalExit;
  driver.stdout.on('data', data => { buffer += data;
    while (buffer.includes('\n')) { const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
      if (event.type === 'output') raw += event.data; if (event.type === 'exit') terminalExit = event.code; }
  });
  const write = text => driver.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => write('\x15' + text + '\r');
  t.after(async () => { if (driver.exitCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await exit; await fs.rm(directory, { recursive: true, force: true }); });
  await until(() => raw.includes('terminal model disabled'), () => 'Official stop UI did not initialize: ' + raw.slice(-1500));
  command('Public synthetic frontend stop check.');
  await until(() => lifecycle.some(event => event.phase === 'nativeModelWaiting'), 'The actual OMP provider did not enter its synthetic wait.');
  const runId = f.app.store.read().runs[0].id;
  let marker = raw.length; command('/ws-stop');
  await until(() => raw.slice(marker).includes('Stop this original Workspace frontend Run?'), () => 'Official human stop confirmation did not open: ' + raw.slice(-2000));
  write('\x1b');
  await until(() => raw.includes('HUMAN_CONFIRMATION_DECLINED'), () => 'Escape did not finish the official confirmation handler: ' + raw.slice(-2500));
  assert.equal(f.app.store.read().runs[0].status, 'running');
  marker = raw.length; command('/ws-stop');
  await until(() => raw.slice(marker).includes('Stop this original Workspace frontend Run?'), () => 'Second original human stop confirmation did not open: ' + raw.slice(-2500));
  write('\r'); await until(() => f.app.store.read().runs[0].status === 'cancelled', 'Confirmed original stop did not cancel the exact Run.');
  await until(() => lifecycle.some(event => event.phase === 'exit'), 'Cancelled official worker did not close.');
  assert.ok(lifecycle.some(event => event.phase === 'nativeModelAbort')); assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().runs[0].id, runId);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
  await until(() => raw.includes('"status": "cancelled"'), 'Original cancellation receipt was not displayed in the official UI.');
  command('/quit'); await until(() => terminalExit !== undefined, 'Official stop UI did not close.'); assert.equal(terminalExit, 0, raw.slice(-6000)); assert.equal((await exit)[0], 0, raw.slice(-6000));
});
