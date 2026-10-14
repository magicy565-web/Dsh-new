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
const completeStage = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：恢复本阶段，仅核对明确提供的公开材料。', sources: ['input.product'] }],
  recommendations: [{ text: '建议确认原始证据后再开展后续操作。', sources: [] }],
  questions: [{ text: '是否可以提供原始报价？', sources: [] }],
}), { stopReason: 'toolUse' });

test('agent:dev official PTY preserves human approval, separate stable continuation, confirmed cancellation and same-checkpoint recovery', { skip: process.platform === 'win32', timeout: 70_000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-lifecycle-pty-');
  const settings = { dataDirectory: path.join(directory, 'workspace') };
  let backend = await startPiDevelopment(settings);
  const port = Number(new URL(backend.baseURL).port), requests = [];
  function capture() {
    const handler = backend.app.server.listeners('request')[0]; backend.app.server.removeListener('request', handler);
    backend.app.server.on('request', (req, res) => { requests.push({ method: req.method, url: req.url, key: req.headers['idempotency-key'] || null }); handler(req, res); });
  }
  capture();
  const child = spawn('python3', [path.join(root, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath, path.join(root, 'test/fixtures/pi-workspace-lifecycle-pty.mjs')],
    { cwd: root, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', WS_AGENT_URL: backend.baseURL, WS_AGENT_TOKEN: backend.token,
      PI_AGENT_TEST_DIRECTORY: path.join(directory, 'agent') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'exit'); let raw = '', buffer = '', stderr = '', code;
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => { buffer += data; while (buffer.includes('\n')) {
    const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
    if (event.type === 'output') raw += event.data; if (event.type === 'exit') code = event.code;
  } });
  const write = text => child.stdin.write(JSON.stringify({ type: 'write', text }) + '\n');
  const command = text => write(text + '\r');
  const run = key => backend.app.store.read().runs.find(row => row.requestId === key);
  const task = key => backend.app.store.read().workspaceAgentTasks.tasks.find(row => row.requestKey === key);
  const controlPosts = suffix => requests.filter(row => row.method === 'POST' && row.url.endsWith(suffix)).length;
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await closed;
    await backend.close(); await fs.rm(directory, { recursive: true, force: true }); });
  try {
    await until(() => raw.includes('Explicit synthetic lifecycle agent fixture'), 'Official Agent development InteractiveMode did not start: ' + stderr);
    assert.match(raw, /v1\.1\.0/);
    command('/ws-task ' + JSON.stringify({ title: 'Public exact lifecycle review', content: 'LOCAL_APPROVAL_FIXTURE', requestId: 'agent-life-review',
      connectorActions: [{ connectorId: backend.approvalConnectorId, action: 'create_file' }] }));
    await until(() => run('agent-life-review')?.status === 'awaiting_approval', 'Original approval proposal was not persisted');
    const reviewId = run('agent-life-review').id, proposalId = run('agent-life-review').proposals[0].id;
    const approveCommand = '/ws-approve ' + reviewId + ' ' + proposalId;
    let marker = raw.length; command(approveCommand);
    await until(() => raw.slice(marker).includes('Approve this exact original Workspace proposal?'), 'Exact original approval confirmation was not visible');
    write('\x1b'); await delay(120);
    assert.equal(run('agent-life-review').proposals[0].status, 'pending'); assert.equal(controlPosts('/decision'), 0);
    assert.equal(backend.app.capabilities.listConnectorRuns().length, 0); assert.equal(backend.app.artifacts.list().artifacts.length, 0);
    marker = raw.length; command(approveCommand);
    await until(() => raw.slice(marker).includes('Approve this exact original Workspace proposal?'), 'Repeat exact review confirmation was not visible'); write('\r');
    await until(() => run('agent-life-review').proposals[0].status === 'approved', 'Confirmed original proposal did not become approved');
    assert.equal(backend.app.capabilities.listConnectorRuns().length, 0, 'Approval alone must not execute');
    marker = raw.length; command('/ws-continue ' + reviewId + ' ' + proposalId);
    await until(() => /stable|STABLE|request/i.test(raw.slice(marker)), 'Missing continuation identity was not refused');
    assert.equal(controlPosts('/continue'), 0);
    const continueCommand = '/ws-continue ' + reviewId + ' ' + proposalId + ' agent-life-continuation';
    marker = raw.length; command(continueCommand);
    await until(() => raw.slice(marker).includes('Continue this exact approved Pi action?'), 'Separate continuation confirmation was not visible');
    write('\x1b'); await delay(120); assert.equal(controlPosts('/continue'), 0); assert.equal(backend.app.capabilities.listConnectorRuns().length, 0);
    marker = raw.length; command(continueCommand);
    await until(() => raw.slice(marker).includes('Continue this exact approved Pi action?'), 'Confirmed continuation dialog did not reopen'); write('\r');
    await until(() => run('agent-life-review')?.status === 'succeeded', 'Original approved connector continuation did not settle');
    assert.equal(backend.app.capabilities.listConnectorRuns().length, 1); assert.equal(backend.app.artifacts.list().artifacts.length, 1);
    const approvedFile = await backend.app.artifacts.download(backend.app.artifacts.list().artifacts[0].id);
    assert.equal(approvedFile.filename, 'pi-tui-approved-synthetic.txt'); assert.equal(approvedFile.bytes.toString('utf8'), 'Explicit synthetic approved output.');
    const beforeReplayCalls = backend.faux.state.callCount;
    marker = raw.length; command(continueCommand);
    await until(() => raw.slice(marker).includes('Continue this exact approved Pi action?'), 'Stable continuation replay was not reviewed'); write('\r');
    await until(() => controlPosts('/continue') === 2, 'Stable continuation replay did not reach original API'); await delay(120);
    assert.equal(backend.faux.state.callCount, beforeReplayCalls); assert.equal(backend.app.capabilities.listConnectorRuns().length, 1); assert.equal(backend.app.artifacts.list().artifacts.length, 1);

    command('/ws-task ' + JSON.stringify({ title: 'Public held original run', content: 'WAIT_FOR_CANCEL', requestId: 'agent-life-cancel' }));
    await until(() => run('agent-life-cancel')?.piNativeTaskId && run('agent-life-cancel')?.status === 'running', 'Original cancellable model request did not start');
    const cancelCommand = '/ws-cancel ' + run('agent-life-cancel').id;
    marker = raw.length; command(cancelCommand);
    await until(() => raw.slice(marker).includes('Cancel this original Pi task?'), 'Generic cancellation confirmation was not visible'); write('\x1b'); await delay(120);
    assert.equal(run('agent-life-cancel').status, 'running'); assert.equal(controlPosts('/cancel'), 0);
    marker = raw.length; command(cancelCommand);
    await until(() => raw.slice(marker).includes('Cancel this original Pi task?'), 'Generic cancellation confirmation did not reopen'); write('\r');
    await until(() => run('agent-life-cancel').status === 'cancelled', 'Confirmed original run cancellation did not settle');
    const afterCancelCalls = backend.faux.state.callCount; await delay(120); assert.equal(backend.faux.state.callCount, afterCancelCalls);
    assert.equal(backend.app.capabilities.listConnectorRuns().length, 1); assert.equal(backend.app.artifacts.list().artifacts.length, 1);

    command('/ws-business ' + JSON.stringify({ type: 'procurement', title: 'Public held business task', requestId: 'agent-life-business-cancel',
      input: { product: 'Public synthetic cup', spec: 'Public synthetic specification', quantity: 10, requirements: 'WAIT_FOR_BUSINESS_RESTART' } }));
    await until(() => task('agent-life-business-cancel')?.steps[2]?.runId && task('agent-life-business-cancel')?.status === 'running', 'Original business comparison request did not start');
    const businessId = task('agent-life-business-cancel').id, businessCancel = '/ws-business-cancel ' + businessId;
    marker = raw.length; command(businessCancel);
    await until(() => raw.slice(marker).includes('Cancel this original business task?'), 'Business cancellation confirmation was not visible'); write('\x1b'); await delay(120);
    assert.equal(task('agent-life-business-cancel').status, 'running'); assert.equal(controlPosts('/cancel'), 1);
    const callsBeforeBusinessCancel = backend.faux.state.callCount;
    marker = raw.length; command(businessCancel);
    await until(() => raw.slice(marker).includes('Cancel this original business task?'), 'Business cancellation confirmation did not reopen'); write('\r');
    await until(() => task('agent-life-business-cancel').status === 'cancelled', 'Confirmed original business cancellation did not settle');
    await delay(120); assert.equal(backend.faux.state.callCount, callsBeforeBusinessCancel);
    assert.equal(task('agent-life-business-cancel').result.resumable, false); assert.equal(task('agent-life-business-cancel').result.businessGoalAchieved, false);
    assert.ok(!task('agent-life-business-cancel').steps[3].runId, 'Cancelled business task must not start a later stage');

    const beforeBusinessRestoreCalls = backend.faux.state.callCount;
    command('/ws-business ' + JSON.stringify({ type: 'procurement', title: 'Public original business checkpoint', requestId: 'agent-life-business-restore',
      input: { product: 'Public synthetic cup', spec: 'Public synthetic specification', quantity: 10, requirements: 'WAIT_FOR_BUSINESS_RESTART' } }));
    await until(() => task('agent-life-business-restore')?.steps[2]?.runId && backend.faux.state.callCount === beforeBusinessRestoreCalls + 3,
      'Original business checkpoint did not enter its actual held comparison request');
    const originalBusiness = structuredClone(task('agent-life-business-restore'));
    const inquiry = originalBusiness.deliverables.find(row => row.name === 'inquiry-pack.md'); assert.ok(inquiry);
    const beforeRestoreCalls = backend.faux.state.callCount;
    command('/ws-task ' + JSON.stringify({ title: 'Public original recovery checkpoint', content: 'WAIT_FOR_CANCEL', requestId: 'agent-life-restore' }));
    await until(() => run('agent-life-restore')?.piNativeTaskId && backend.faux.state.callCount > beforeRestoreCalls, 'Original recovery checkpoint did not enter its model request');
    const original = structuredClone(run('agent-life-restore')), beforeRestartRuns = backend.app.store.read().runs.length;
    await backend.close(); backend = await startPiDevelopment({ ...settings, port, responses: [fauxAssistantMessage('Explicit synthetic same-checkpoint recovered output.'), completeStage(), completeStage()] }); capture();
    assert.equal(run('agent-life-restore').status, 'interrupted'); assert.equal(backend.faux.state.callCount, 0);
    const resumeCommand = '/ws-resume ' + original.id + ' agent-life-recovery';
    marker = raw.length; command(resumeCommand);
    await until(() => raw.slice(marker).includes('Recover this original Pi checkpoint?'), 'Original checkpoint recovery confirmation was not visible'); write('\x1b'); await delay(120);
    assert.equal(controlPosts('/resume'), 0); assert.equal(backend.faux.state.callCount, 0); assert.equal(run('agent-life-restore').status, 'interrupted');
    marker = raw.length; command(resumeCommand);
    await until(() => raw.slice(marker).includes('Recover this original Pi checkpoint?'), 'Recovery confirmation did not reopen'); write('\r');
    await until(() => run('agent-life-restore').status === 'succeeded', 'Confirmed original checkpoint did not recover');
    assert.equal(run('agent-life-restore').piNativeTaskId, original.piNativeTaskId); assert.equal(run('agent-life-restore').assistantId, original.assistantId);
    assert.equal(backend.app.store.read().runs.length, beforeRestartRuns); assert.equal(backend.faux.state.callCount, 1);
    marker = raw.length; command(resumeCommand);
    await until(() => raw.slice(marker).includes('Only an interrupted original Pi checkpoint can recover'), 'Completed original checkpoint did not reject unnecessary recovery');
    assert.equal(controlPosts('/resume'), 1); await delay(120);
    assert.equal(backend.faux.state.callCount, 1); assert.equal(backend.app.store.read().runs.length, beforeRestartRuns);
    assert.equal(task('agent-life-business-restore').status, 'interrupted');
    const businessResume = '/ws-business-resume ' + originalBusiness.id + ' agent-life-business-recovery';
    marker = raw.length; command('/ws-business-resume ' + originalBusiness.id);
    await until(() => /stable|STABLE|request/i.test(raw.slice(marker)), 'Missing business recovery identity was not refused'); assert.equal(controlPosts('/resume'), 1);
    marker = raw.length; command(businessResume);
    await until(() => raw.slice(marker).includes('Resume this unchanged original business task?'), 'Original business recovery confirmation was not visible'); write('\x1b'); await delay(120);
    assert.equal(task('agent-life-business-restore').attempt, 1); assert.equal(backend.faux.state.callCount, 1); assert.equal(controlPosts('/resume'), 1);
    marker = raw.length; command(businessResume);
    await until(() => raw.slice(marker).includes('Resume this unchanged original business task?'), 'Business recovery confirmation did not reopen'); write('\r');
    await until(() => task('agent-life-business-restore').status === 'done', 'Confirmed original business checkpoint did not finish');
    const recoveredBusiness = task('agent-life-business-restore');
    assert.equal(recoveredBusiness.id, originalBusiness.id); assert.equal(recoveredBusiness.attempt, 2);
    for (const key of ['runId', 'requestId', 'replyId']) assert.equal(recoveredBusiness.steps[2][key], originalBusiness.steps[2][key]);
    assert.equal(recoveredBusiness.deliverables.find(row => row.name === 'inquiry-pack.md').sha256, inquiry.sha256);
    assert.equal(backend.faux.state.callCount, 3); assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 2);
    marker = raw.length; command(businessResume);
    await until(() => raw.slice(marker).includes('No continuation was sent'), 'Completed original business checkpoint did not reject unnecessary recovery');
    assert.equal(controlPosts('/resume'), 2); assert.equal(backend.faux.state.callCount, 3);
    command('/ws-status ' + original.id); await until(() => raw.includes('Explicit synthetic same-checkpoint recovered output.'), 'Actual recovered receipt was not displayed');
    command('/ws-quit'); await until(() => code !== undefined, 'Official lifecycle Agent did not close'); assert.equal((await closed)[0], 0, stderr);
    assert.ok(!raw.includes(backend.token));
    t.diagnostic('Real official Pi AgentSession/InteractiveMode PTY; human commands only, synthetic finite backend provider and injected unused frontend; no real model, external Worker, publish or notification.');
  } catch (error) {
    t.diagnostic(JSON.stringify({ syntheticCalls: backend.faux.state.callCount,
      tasks: backend.app.store.read().workspaceAgentTasks.tasks.map(row => ({ id: row.id, status: row.status, result: row.result,
        steps: row.steps.map(step => ({ key: step.key, runId: step.runId, status: step.status })) })),
      runs: backend.app.store.read().runs.map(row => ({ id: row.id, status: row.status, error: row.error, recover: row.piRecoverRequests })) }));
    t.diagnostic(raw.slice(-3000)); throw error;
  }
});
