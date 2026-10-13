// Actual official InteractiveMode in a POSIX PTY, with explicit keyless faux
// models and the real original HTTP/Store/approval/child/recovery backends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { startPiDevelopment } from '../server/pi-development.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 500; i++) { if (await check()) return; await delay(20); }
  throw new Error(message);
}

test('official Pi TUI PTY starts tasks and an owned child, reviews exact approval, cancels and explicitly restores original checkpoints', { skip: process.platform === 'win32', timeout: 70_000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-tui-pty-');
  let backend = await startPiDevelopment({ dataDirectory: path.join(directory, 'workspace') });
  const port = new URL(backend.baseURL).port;
  const driver = spawn('python3', [path.join(root, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath, path.join(root, 'scripts/pi-workspace-tui.mjs')],
    { cwd: root, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', WS_AGENT_URL: backend.baseURL, WS_AGENT_TOKEN: backend.token }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'exit');
  let raw = '', stderr = '', buffer = '', exited;
  driver.stderr.on('data', data => { stderr += data; });
  driver.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const cut = buffer.indexOf('\n'), line = buffer.slice(0, cut); buffer = buffer.slice(cut + 1);
      const event = JSON.parse(line);
      if (event.type === 'output') raw += event.data;
      if (event.type === 'exit') exited = event.code;
      if (event.type === 'timeout') stderr += 'PTY driver deadline reached';
    }
  });
  const write = text => driver.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => write(text + '\r');
  const run = key => backend.app.store.read().runs.find(value => value.requestId === key);
  const settled = key => run(key) && !['queued', 'running'].includes(run(key).status);
  const receipt = key => backend.app.store.read().messages.find(value => value.id === run(key)?.assistantId);
  t.after(async () => {
    if (driver.exitCode === null && driver.signalCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
    await exit; await backend.close(); await fs.rm(directory, { recursive: true, force: true });
  });
  await until(() => raw.includes('Use /ws-task'), 'Official Pi TUI did not initialize: ' + stderr);
  assert.ok(raw.includes('v1.1.0'));
  const sentinel = path.join(directory, 'private-synthetic.txt');
  await fs.writeFile(sentinel, 'SYNTHETIC_PRIVATE_SENTINEL_BYTES');
  command('@' + sentinel);
  await until(() => raw.includes('Natural-language model execution is blocked'), 'Command profile did not block model input');
  assert.equal(backend.faux.state.callCount, 0); assert.equal(backend.app.store.read().runs.length, 0);
  assert.ok(!raw.includes('SYNTHETIC_PRIVATE_SENTINEL_BYTES'));
  const forbidden = path.join(directory, 'forbidden-export.html');
  command('/export ' + forbidden);
  await until(() => raw.includes('Only /ws-* task commands and /quit'), 'Official builtin export was not blocked');
  await assert.rejects(fs.stat(forbidden), { code: 'ENOENT' });
  write('\x03'); await delay(60); write('\x07');
  await until(() => raw.includes('External editors, file completion'), 'External editor shortcut was not blocked');

  command('/ws-task ' + JSON.stringify({ title: 'Public PTY task', content: 'Explicit public task text.', requestId: 'pty-task' }));
  await until(() => settled('pty-task'), 'TUI did not submit an actual original task');
  assert.equal(run('pty-task').status, 'succeeded'); assert.ok(receipt('pty-task').content.includes('Explicit public task text.'));
  command('/ws-status ' + run('pty-task').id);
  await until(() => raw.includes('original-workspace-runtime'), 'TUI did not display its actual task authority');

  const before = backend.faux.state.callCount;
  command('/ws-delegate ' + JSON.stringify({ title: 'Public PTY delegate', content: 'Explicit public child task.', requestId: 'pty-delegate' }));
  await until(() => settled('pty-delegate'), 'TUI delegated task did not settle');
  assert.equal(run('pty-delegate').status, 'succeeded', JSON.stringify(run('pty-delegate').error));
  assert.equal(backend.faux.state.callCount - before, 3);
  const child = receipt('pty-delegate').runtime.delegations;
  assert.equal(child.length, 1); assert.equal(child[0].status, 'completed'); assert.deepEqual(child[0].tools, []); assert.equal(child[0].background, false);
  command('/ws-status ' + run('pty-delegate').id);
  await until(() => raw.includes('Controlled faux child result'), 'TUI did not display its original child result');

  command('/ws-task ' + JSON.stringify({ title: 'Public exact local review', content: 'LOCAL_APPROVAL_FIXTURE', requestId: 'pty-review', connectorActions: [{ connectorId: backend.approvalConnectorId, action: 'create_file' }] }));
  await until(() => run('pty-review')?.status === 'awaiting_approval', 'TUI did not pause for original exact approval');
  const proposal = run('pty-review').proposals[0].id, reviewId = run('pty-review').id;
  assert.equal(backend.app.capabilities.listConnectorRuns().length, 0);
  command('/ws-continue ' + reviewId + ' ' + proposal);
  await until(() => raw.includes('Workspace refused this operation'), 'Unapproved continuation did not refuse');
  assert.equal(backend.app.capabilities.listConnectorRuns().length, 0);
  command('/ws-approve ' + reviewId + ' ' + proposal);
  await until(() => raw.includes('Approve this exact original Workspace proposal?'), 'Official confirmation dialog did not open');
  write('\x1b'); await delay(100);
  assert.equal(run('pty-review').proposals[0].status, 'pending');
  const marker = raw.length;
  command('/ws-approve ' + reviewId + ' ' + proposal);
  await until(() => raw.slice(marker).includes('Approve this exact original Workspace proposal?'), 'Second exact confirmation did not open');
  write('\r');
  await until(() => run('pty-review').proposals[0].status === 'approved', 'Human confirmation did not approve the original payload');
  assert.equal(backend.app.capabilities.listConnectorRuns().length, 0, 'Approval alone is not execution');
  command('/ws-continue ' + reviewId + ' ' + proposal);
  await until(() => ['succeeded', 'failed', 'cancelled'].includes(run('pty-review')?.status), 'Approved action did not settle through original continuation');
  assert.equal(run('pty-review').status, 'succeeded', JSON.stringify(run('pty-review').error));
  assert.equal(backend.app.capabilities.listConnectorRuns().length, 1);
  assert.equal(backend.app.artifacts.list().artifacts.length, 1);

  command('/ws-task ' + JSON.stringify({ title: 'Public cancel fixture', content: 'WAIT_FOR_CANCEL', requestId: 'pty-cancel' }));
  await until(() => run('pty-cancel')?.piNativeTaskId, 'Original cancellable Pi task did not start');
  command('/ws-cancel ' + run('pty-cancel').id);
  await until(() => run('pty-cancel').status === 'cancelled', 'TUI cancellation did not stop the original run');

  const beforeRestore = backend.faux.state.callCount;
  command('/ws-task ' + JSON.stringify({ title: 'Public restore fixture', content: 'WAIT_FOR_CANCEL', requestId: 'pty-restore' }));
  await until(() => run('pty-restore')?.piNativeTaskId && backend.faux.state.callCount > beforeRestore, 'Original restart fixture did not start its actual model request');
  const original = structuredClone(run('pty-restore'));
  await backend.close();
  backend = await startPiDevelopment({ dataDirectory: path.join(directory, 'workspace'), port: Number(port), responses: [fauxAssistantMessage('Controlled recovered original TUI task.')] });
  assert.equal(run('pty-restore').status, 'interrupted'); assert.equal(backend.faux.state.callCount, 0);
  command('/ws-resume ' + original.id);
  await until(() => ['succeeded', 'failed', 'cancelled'].includes(run('pty-restore')?.status), 'TUI did not explicitly reattach the original checkpoint');
  assert.equal(run('pty-restore').status, 'succeeded', JSON.stringify(run('pty-restore').error));
  assert.equal(run('pty-restore').piNativeTaskId, original.piNativeTaskId); assert.equal(run('pty-restore').assistantId, original.assistantId);
  assert.equal(backend.app.store.read().runs.length, 5); assert.equal(backend.faux.state.callCount, 1);
  command('/ws-status ' + original.id);
  await until(() => raw.includes('Controlled recovered original TUI task.'), 'Recovered result was not displayed by the official TUI');
  command('/ws-quit');
  await until(() => exited !== undefined, 'Official TUI did not shut down');
  assert.equal(exited, 0); assert.equal((await exit)[0], 0, stderr);
  assert.ok(!raw.includes(backend.token), 'The official TUI must not print the service credential');
  t.diagnostic('Actual official Pi InteractiveMode PTY: task, owned child, status, exact human approval, separate continuation, cancellation, original checkpoint recovery and profile refusals. Model transport is controlled faux, never a live account.');
});
