import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const tail = raw => raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-4500);
const until = async (check, label) => { for (let i = 0; i < 1800; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(typeof label === 'function' ? label() : label); };
for (const mode of ['approval', 'checkpoint', 'business']) test(`official OMP enterprise Session terminal performs original human ${mode} controls`, { timeout: 85000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-enterprise-recovery-'), evidence = path.join(directory, 'facts.json');
  const driver = spawn('python3', [path.join(repository, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath,
    path.join(repository, 'test/fixtures/workspace-omp-terminal-recovery.mjs')], { cwd: directory,
    env: { PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory, LANG: 'C.UTF-8', TERM: 'xterm-256color',
      WORKSPACE_OMP_RECOVERY_MODE: mode, WORKSPACE_OMP_RECOVERY_EVIDENCE: evidence }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'close'); let raw = '', buffer = '', stderr = '', terminalExit;
  driver.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  driver.stderr.on('data', bytes => { stderr += bytes; });
  driver.stdout.on('data', bytes => { buffer += bytes;
    while (buffer.includes('\n')) { const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
      if (event.type === 'output') raw += event.data; if (event.type === 'exit') terminalExit = event.code; }
  });
  t.after(async () => { if (driver.exitCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await exit; await fs.rm(directory, { recursive: true, force: true }); });
  const write = text => driver.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => write('\x15' + text + '\r');
  await until(() => {
    if (terminalExit !== undefined) throw new Error('Official enterprise terminal exited before initialization: ' + stderr + raw.slice(-3500));
    return raw.includes('OMP_RECOVERY_READY ') && raw.includes('terminal model disabled');
  }, () => 'Official enterprise terminal did not initialize: ' + stderr + raw.slice(-3500));
  const ids = JSON.parse(raw.match(/OMP_RECOVERY_READY (\{[^\r\n]+\})/)[1]);
  async function confirm(commandText, title, declineProperty = null) {
    if (declineProperty) {
      const start = raw.length; command(commandText);
      await until(() => raw.slice(start).includes(title), () => 'Official decline dialog did not open: ' + tail(raw));
      if (mode === 'business') { const visible = tail(raw.slice(start)); assert.ok(visible.includes(ids.businessTaskId));
        assert.ok(visible.includes(ids.existingDocumentSha)); assert.ok(visible.includes(ids.originalStageRunId)); }
      write('\x1b');
      await until(() => raw.slice(start).includes(declineProperty), () => 'Original human decline receipt was not displayed: ' + tail(raw));
    }
    const start = raw.length; command(commandText);
    await until(() => raw.slice(start).includes(title), () => 'Official confirmation did not open: ' + tail(raw));
    const receiptStart = raw.length; write('\r');
    await until(() => mode === 'business' ? raw.slice(receiptStart).includes('"authority": "workspace-store"')
      : raw.slice(receiptStart).includes('workspace-original-control') || raw.slice(receiptStart).includes('"status"'), () => 'Original control receipt was not displayed: ' + tail(raw));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (mode === 'approval') {
    await confirm(`/ws-approve ${ids.proposalRunId} ${ids.proposalId}`, 'Approve this exact original Workspace proposal?', '"approved": false');
    await confirm(`/ws-continue ${ids.proposalRunId} ${ids.proposalId} terminal-continue-stable`, 'Continue this exact approved original action?');
    await confirm(`/ws-cancel ${ids.cancelRunId}`, 'Cancel this original Workspace run?', '"cancelled": false');
  } else if (mode === 'checkpoint') {
    await confirm(`/ws-resume ${ids.recoverRunId} terminal-recover-stable`, 'Recover this unchanged original checkpoint?', '"resumed": false');
  } else {
    await confirm(`/ws-business-resume ${ids.businessTaskId} terminal-business-recover-stable`, 'Recover this unchanged original business task?', '"resumed": false');
  }
  await until(() => raw.includes('OMP_RECOVERY_VERIFIED '), () => 'Original state was not verified after real TUI commands: ' + raw.slice(-4000));
  command('/quit'); await until(() => terminalExit !== undefined, () => 'Official enterprise terminal did not close: ' + raw.slice(-2000));
  assert.equal(terminalExit, 0, raw.slice(-3000)); assert.equal((await exit)[0], 0, stderr);
  const facts = JSON.parse(await fs.readFile(evidence)); assert.equal(facts.originalStateVerified, true); assert.equal(facts.paidModelCalls, 0);
  assert.equal(raw.includes('pi-public-synthetic-test-member-a'), false); assert.equal(raw.includes('csrfToken'), false);
  if (process.env.WORKSPACE_OMP_TERMINAL_RECOVERY_SAVE_DIR) {
    await fs.mkdir(process.env.WORKSPACE_OMP_TERMINAL_RECOVERY_SAVE_DIR, { recursive: true });
    await fs.copyFile(evidence, path.join(process.env.WORKSPACE_OMP_TERMINAL_RECOVERY_SAVE_DIR, mode + '.json'));
  }
});
