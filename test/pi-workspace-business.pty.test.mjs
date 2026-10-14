// Real official TUI keystrokes against original business stages and auth.
// The finite keyless model transport is explicitly synthetic, never live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { startPiDevelopment } from '../server/pi-development.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(20); } throw new Error(label); }
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：原阶段资料缺口需逐项核对。', sources: ['input.product'] }], recommendations: [{ text: '建议确认原材料。', sources: [] }], questions: [{ text: '是否补充原始证据？', sources: [] }],
}), { stopReason: 'toolUse' });

test('official TUI PTY uses existing procurement stages and artifacts, refuses unsafe inputs and missing search, confirms original recovery and rejects revoked auth', { skip: process.platform === 'win32', timeout: 70_000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-business-pty-');
  let clock = Date.parse('2026-10-13T19:00:00.000Z');
  const settings = { dataDirectory: path.join(directory, 'workspace'), seedApprovalConnector: false, syntheticBindingExpiresAt: '2026-10-13T20:00:00.000Z', accessClock: () => clock };
  let backend = await startPiDevelopment(settings); const port = Number(new URL(backend.baseURL).port);
  const driver = spawn('python3', [path.join(root, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath, path.join(root, 'scripts/pi-workspace-tui.mjs')],
    { cwd: root, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', WS_AGENT_URL: backend.baseURL, WS_AGENT_TOKEN: backend.token }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(driver, 'exit'); let raw = '', buffer = '', stderr = '', exited;
  driver.stderr.on('data', data => { stderr += data; });
  driver.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) { const cut = buffer.indexOf('\n'); const event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
      if (event.type === 'output') raw += event.data; if (event.type === 'exit') exited = event.code; if (event.type === 'timeout') stderr += 'PTY deadline reached'; }
  });
  const write = text => driver.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => write(text + '\r');
  const task = key => backend.app.store.read().workspaceAgentTasks.tasks.find(row => row.requestKey === key);
  const terminal = key => ['done', 'failed', 'interrupted'].includes(task(key)?.status);
  const input = { product: '公开合成杯子', spec: '公开规格', quantity: 10 };
  const submit = (requestId, extras = {}) => command('/ws-business ' + JSON.stringify({ type: 'procurement', title: '公开合成采购资料', input, requestId, ...extras }));
  t.after(async () => { if (driver.exitCode === null && driver.signalCode === null) driver.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await exit; await backend.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await until(() => raw.includes('Use /ws-task'), 'Official TUI did not initialize: ' + stderr); assert.ok(raw.includes('v1.1.0'));
  command('Please buy a public cup');
  await until(() => raw.includes('Natural-language model execution is blocked'), 'Normal profile did not explain the absent frontend model');
  assert.equal(backend.faux.state.callCount, 0);
  command('/ws-procurement canceled-public');
  await until(() => raw.includes('Public product'), 'Official public product input did not open');
  write('\x1b'); await until(() => raw.includes('Canceled. No business task was submitted.'), 'Cancel did not preserve no-submission boundary');
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 0);
  command('/ws-presets'); await until(() => raw.includes('supplier-sourcing') && raw.includes('required_inputs'), 'Original preset registry was not displayed');
  submit('forbidden-host-context', { agentPresetContext: { tools: ['arbitrary'] } });
  await until(() => raw.includes('Business JSON allows only'), 'TUI did not refuse host authority input');
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(backend.faux.state.callCount, 0);
  submit('invalid-public-spec', { input: { ...input, quantity: 0 } });
  await until(() => raw.includes('HTTP 400'), 'Original preset specification did not refuse zero quantity');
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 0);

  async function procurement(requestId) {
    let marker = raw.length; command('/ws-procurement ' + requestId);
    await until(() => raw.slice(marker).includes('Public product'), 'Official product input did not open');
    marker = raw.length; write(input.product + '\r');
    await until(() => raw.slice(marker).includes('Public specification'), 'Official specification input did not open');
    marker = raw.length; write(input.spec + '\r');
    await until(() => raw.slice(marker).includes('Public quantity'), 'Official quantity input did not open');
    write(String(input.quantity) + '\r');
  }
  await procurement('pty-business'); await until(() => terminal('pty-business'), 'Original procurement task did not finish');
  assert.equal(task('pty-business').status, 'done'); assert.equal(backend.faux.state.callCount, 4);
  const id = task('pty-business').id, originalCount = backend.app.store.read().workspaceAgentTasks.tasks.length;
  const replayMarker = raw.length; await procurement('pty-business'); await until(() => raw.slice(replayMarker).includes(id), 'Stable business receipt was not displayed'); await delay(100);
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, originalCount); assert.equal(backend.faux.state.callCount, 4);
  command('/ws-business-status ' + id);
  await until(() => raw.includes('procurement-brief.md') && raw.includes('合成模型替身') && raw.includes('documents_ready'), 'Official TUI did not show actual persisted stage/document results');
  assert.equal(task('pty-business').steps.filter(row => row.status === 'succeeded').length, 4);
  assert.equal(task('pty-business').result.businessGoalAchieved, false); assert.equal(task('pty-business').deliverables.length, 3);
  assert.ok(task('pty-business').steps.every(row => backend.app.store.read().runs.find(run => run.id === row.runId)?.piTaskContext === undefined));
  command('/ws-status ' + id); await until(() => raw.includes('HTTP 404'), 'Business taskId was incorrectly treated as generic runId');

  submit('pty-search-gap', { type: 'opportunity-discovery', input: { product: '公开杯子', market: '公开市场' } });
  await until(() => terminal('pty-search-gap'), 'Missing research capability did not produce an original failure');
  assert.equal(task('pty-search-gap').status, 'failed'); assert.equal(task('pty-search-gap').result.reason, 'AGENT_REQUIRED_CAPABILITY_MISSING'); assert.equal(backend.faux.state.callCount, 4);
  command('/ws-business-status ' + task('pty-search-gap').id);
  await until(() => raw.includes('AGENT_REQUIRED_CAPABILITY_MISSING') && raw.includes('partial-price_bands-attempt-1.md'), 'Original failure and partial artifact were not displayed');

  submit('pty-business-restore', { input: { ...input, requirements: 'WAIT_FOR_BUSINESS_RESTART' } });
  await until(() => backend.faux.state.callCount === 7 && task('pty-business-restore')?.steps[2].runId, 'Original comparison-stage request did not actually enter its model hold');
  const saved = structuredClone(task('pty-business-restore')); const inquiry = saved.deliverables.find(row => row.name === 'inquiry-pack.md'); assert.ok(inquiry);
  await backend.close(); backend = await startPiDevelopment({ ...settings, port, responses: [complete(), complete()] });
  await until(() => task('pty-business-restore')?.status === 'interrupted', 'Restart did not preserve an interrupted original business task');
  assert.equal(backend.faux.state.callCount, 0); assert.equal(task('pty-business-restore').id, saved.id);
  command('/ws-business-resume ' + saved.id); await until(() => raw.includes('Resume this unchanged original business task?'), 'Original business recovery confirmation did not open');
  write('\x1b'); await delay(100); assert.equal(backend.faux.state.callCount, 0); assert.equal(task('pty-business-restore').attempt, 1);
  const marker = raw.length; command('/ws-business-resume ' + saved.id);
  await until(() => raw.slice(marker).includes('Resume this unchanged original business task?'), 'Second recovery confirmation did not open'); write('\r');
  await until(() => task('pty-business-restore')?.status === 'done', 'Explicit recovery did not finish the same original task');
  const recovered = task('pty-business-restore'); assert.equal(recovered.id, saved.id); assert.equal(recovered.attempt, 2); assert.equal(recovered.steps[2].runId, saved.steps[2].runId); assert.equal(recovered.steps[2].requestId, saved.steps[2].requestId); assert.equal(recovered.steps[2].replyId, saved.steps[2].replyId);
  assert.equal(recovered.deliverables.find(row => row.name === 'inquiry-pack.md').sha256, inquiry.sha256); assert.equal(backend.faux.state.callCount, 2);
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 3); assert.equal(recovered.result.businessGoalAchieved, false);
  command('/ws-business-status ' + saved.id); await until(() => raw.includes('合成模型替身：原阶段资料缺口'), 'Actual recovered business artifact was not displayed');
  const resumeMarker = raw.length; command('/ws-business-resume ' + saved.id);
  await until(() => raw.slice(resumeMarker).includes('No continuation was sent'), 'Completed business task did not reject further recovery'); assert.equal(backend.faux.state.callCount, 2);

  clock = Date.parse('2026-10-13T20:01:00.000Z'); const revokedMarker = raw.length;
  command('/ws-business-status ' + id); await until(() => raw.slice(revokedMarker).includes('HTTP 401') || raw.slice(revokedMarker).includes('HTTP 403'), 'Expired original service binding did not refuse TUI reads');
  const revokedSubmitMarker = raw.length; submit('revoked-business');
  await until(() => raw.slice(revokedSubmitMarker).includes('HTTP 401') || raw.slice(revokedSubmitMarker).includes('HTTP 403'), 'Expired original service binding did not refuse TUI admission');
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 3); assert.equal(backend.faux.state.callCount, 2);
  if (process.env.PI_TUI_TEST_EVIDENCE_DIR) {
    const evidenceDirectory = process.env.PI_TUI_TEST_EVIDENCE_DIR;
    assert.ok(path.isAbsolute(evidenceDirectory), 'Evidence directory must be explicit and absolute');
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(path.join(evidenceDirectory, 'normal-profile-pty.txt'), raw.replaceAll(backend.token, '[REDACTED]'));
    await fs.writeFile(path.join(evidenceDirectory, 'normal-profile-results.json'), JSON.stringify({
      transport: 'explicit-public-synthetic-backend-faux', cliSample: false, frontendModel: false, liveModelCalls: 0,
      procurement: { taskId: id, status: task('pty-business').status, result: task('pty-business').result, steps: task('pty-business').steps, deliverables: task('pty-business').deliverables },
      researchFailure: task('pty-search-gap').result,
      recovery: { taskId: saved.id, attempt: recovered.attempt, status: recovered.status, preservedInquirySha256: inquiry.sha256 },
      checks: ['natural-language refusal', 'official three-field public input', 'cancel without admission', 'stable requestId replay', 'persisted documents and events', 'missing-search error and partial documents', 'restart and explicit recovery', 'expired identity refusal'],
    }, null, 2));
  }
  command('/ws-quit'); await until(() => exited !== undefined, 'Official business TUI did not close'); assert.equal(exited, 0); assert.equal((await exit)[0], 0, stderr); assert.ok(!raw.includes(backend.token));
  t.diagnostic('Actual official Pi PTY: original procurement task, four real Pi stages, events/documents, public-input/identity/research/auth refusal, canceled and confirmed original checkpoint recovery. Model responses are finite explicitly labeled synthetic faux; no live model or business achievement is proved.');
});
