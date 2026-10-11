// Actual Harness Sessions and Goals, synthetic OAuth/Worker results, no external model.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
const [source, workspace, mode = 'settled'] = process.argv.slice(2);
const pendingMode = mode.endsWith('pending');
const { startNativeDotHost, admittedNativePublicQuestion } = await import(pathToFileURL(path.join(workspace, 'deploy/native-dot-host.mjs')));
const { createNativeDotBinding } = await import(pathToFileURL(path.join(workspace, 'server/workspace-dot-host.mjs')));
const { inspectReviewedDotHistory } = await import(pathToFileURL(path.join(workspace, 'server/workspace-dot-history-review.mjs')));
const root = await mkdtemp(path.join(tmpdir(), 'workspace-history-fixture-'));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const expiresAt = Date.now() + 3600000;
const actor = { subject: 'owner', nativeAgentId: 'history-native-owner' };
const callback = 'https://receiver.example.com/history-fixture';
let dotConfiguration = { enabled: true, resource: 'https://workspace.example.com/mcp/dot', authorizationServer: 'https://auth.example.com/',
  workspaceId: 'fixture-enterprise', keys: [{ kid: 'fixture', alg: 'EdDSA', jwk: publicKey.export({ format: 'jwk' }) }],
  bindings: [], callbackURLs: [callback], encryptionKeys: [{ id: 'fixture-storage', base64: Buffer.alloc(32, 3).toString('base64') }],
  activeEncryptionKey: 'fixture-storage' };
const workersFile = path.join(root, 'workers.json');
await writeFile(workersFile, JSON.stringify({ enabled: true, admissions: [{ id: 'history-grant', subject: 'owner', provider: 'dot',
  agentId: '00000000-0000-4000-8000-000000000001', providerOwnerId: 'fixture-owner', protocolFingerprint: '1'.repeat(64),
  admission: 'invited', transport: 'workspace-pull', expiresAt }] }), { mode: 0o600 });
const configuration = { version: 1, harnessRoot: source, sessionDirectory: path.join(root, 'sessions'), mountDirectory: path.join(root, 'mount'),
  staticDirectory: path.join(root, 'static'), port: 0, dotOwnerSubject: 'owner', plugin: { enabled: true, scopeId: 'history-fixture',
    dataDirectory: path.join(root, 'business'), workerConfigFile: workersFile, operators: [actor] },
  initialEnrollment: { grantId: 'history-grant', oauthSubject: 'fixture-oauth-owner', expiresAt,
    reviewedDotURL: 'https://chatgpt.com/dots/00000000-0000-4000-8000-000000000001' } };
let host;
globalThis.fetch = () => { throw Error('This fixture forbids external network and model calls.'); };
const jwt = () => {
  const body = [{ alg: 'EdDSA', kid: 'fixture' }, { iss: dotConfiguration.authorizationServer, aud: dotConfiguration.resource,
    sub: 'fixture-oauth-owner', scope: 'workspace.dot', workspace_id: dotConfiguration.workspaceId,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(expiresAt / 1000) }].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return body + '.' + sign(null, Buffer.from(body), privateKey).toString('base64url');
};
async function rpc(method, params) {
  const response = await host.service.dot.handle(new Request(dotConfiguration.resource, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', Authorization: 'Bearer ' + jwt() },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params,
    _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'history-fixture', version: '1' } } } }) }));
  const value = await response.json(); assert.ok(value.result && !value.result.isError, JSON.stringify(value));
  return value.result.structuredContent ?? value.result;
}
const tool = (name, args = {}) => rpc('tools/call', { name: 'workspace_worker_' + name, arguments: args });
const subscribe = () => rpc('events/subscribe', { name: 'workspace.task.available', arguments: {},
  delivery: { mode: 'webhook', url: callback, secret: 'whsec_' + Buffer.alloc(32, 7).toString('base64') } });
const boot = () => startNativeDotHost({ environment: {}, configuration, dotConfiguration,
  dotTransport: async request => { await request.beforeSend(); const body = JSON.parse(request.body);
    return { status: 200, body: body.type === 'verification' ? JSON.stringify({ challenge: body.challenge }) : '' }; } });
try {
  host = await boot();
  const connection = (await host.service.bindActor(actor).view()).worker.connection;
  const originalBinding = { oauthSubject: 'fixture-oauth-owner', subject: 'owner', grantId: 'history-grant',
    connectionId: connection.id, authorizationEpoch: connection.authorizationEpoch, expiresAt };
  dotConfiguration = { ...dotConfiguration, bindings: [originalBinding] };
  await tool('identity');
  await subscribe();
  const binding = createNativeDotBinding({ ctx: host.ctx, service: host.service, actor, authorizePublicTask: () => true });
  await host.ctx.workspaceDotHost.submitQuestion(actor, { requestId: 'original-public-question',
    content: 'Public fixture original question', confirmed: true, dataScope: 'public-only' });
  await binding.reconcile();
  const task = (await host.service.bindDotTasks(actor).view())[0]; assert.ok(task.jobId);
  const claim = await tool('claim_task', { taskRef: task.jobId, requestId: 'original-claim' });
  const scope = { taskRef: task.jobId, attemptId: claim.delegation.attemptId, fence: claim.delegation.fence };
  const bytes = Buffer.from('# Synthetic original result\n');
  await tool('upload_file', { ...scope, uploadId: 'original-file', filename: 'result.md', base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex') });
  await tool('submit_result', { ...scope, requestId: 'original-result', summary: 'Synthetic fixture complete', sources: [],
    toolEvidence: [{ tool: 'fixture.local.write', receiptId: 'synthetic-only' }] });
  await binding.reconcile();
  const delivered = (await host.service.bindDotTasks(actor).view())[0];
  await host.ctx.workspaceDotHost.acceptResult(actor, { requestId: delivered.requestId, receiptHash: delivered.receiptHash, confirmed: true });
  const pending = { requestId: 'original-undispatched-question', content: 'Public fixture original pending question', confirmed: true, dataScope: 'public-only' };
  if (pendingMode) {
    // Reproduce the old write-before-dispatch failure without running a model.
    const agent = host.ctx.agents.get(actor.nativeAgentId);
    const id = 'xy-input-' + createHash('sha256').update(JSON.stringify([agent.id, pending.requestId])).digest('hex');
    agent.send({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: JSON.stringify(pending) }] }, 'next-step', false);
    host.ctx.goals.create(agent, { objective: pending.content, maxGoalRounds: 1 });
    assert.ok(await host.ctx.sessions.flush(agent.session));
  }
  const before = JSON.parse(await readFile(path.join(root, 'business/workspace.json'), 'utf8'));
  const originalSession = host.ctx.agents.get(actor.nativeAgentId).session.ownEvents();
  await host.close(); host = undefined;
  host = await boot();
  let paused = host.service.status();
  const current = (await host.service.bindActor(actor).view()).worker.connection;
  const retainedSession = host.ctx.agents.get(actor.nativeAgentId).session.ownEvents();
  assert.deepEqual(retainedSession.slice(0, originalSession.length), originalSession);
  assert.equal(paused.phase, 'paused');
  assert.equal(host.ctx.goals.get(host.ctx.agents.get(actor.nativeAgentId)).phase, pendingMode ? 'active' : 'complete');
  let review = { expectedEpoch: paused.epoch, configurationHash: paused.configurationHash, requestId: 'review-original-history',
    connectionId: current.id, authorizationEpoch: current.authorizationEpoch };
  await assert.rejects(host.ctx.workspaceDotHost.resumeEmptyMount(review), { code: 'WORKSPACE_DOT_EMPTY_REVIEW' });
  const inspected = await inspectReviewedDotHistory({ ctx: host.ctx, service: host.service,
    operators: [actor], ownerSubject: 'owner', authorizePublicTask: admittedNativePublicQuestion, review });
  await assert.rejects(host.ctx.workspaceDotHost.submitQuestion(actor,
    { ...pending, requestId: 'new-paused-question' }), { code: 'WORKSPACE_PLUGIN_PAUSED' });
  assert.deepEqual(host.ctx.agents.get(actor.nativeAgentId).session.ownEvents(), retainedSession);
  if (mode === 'active-pending') {
    await host.service.resume({ expectedEpoch: paused.epoch, configurationHash: paused.configurationHash, requestId: 'fixture-muse-active-scope' });
    paused = host.service.status();
    await host.ctx.workspaceDotHost.refreshReviewedTools({ expectedEpoch: paused.epoch, configurationHash: paused.configurationHash });
    review = { ...review, expectedEpoch: paused.epoch };
  }
  const hostInspected = await host.ctx.workspaceDotHost.inspectReviewedHistory(review);
  const currentInspected = await inspectReviewedDotHistory({ ctx: host.ctx, service: host.service,
    operators: [actor], ownerSubject: 'owner', authorizePublicTask: admittedNativePublicQuestion, review });
  assert.equal(hostInspected.historyHash, currentInspected.historyHash);
  await assert.rejects(host.ctx.workspaceDotHost.resumeReviewedHistory({ ...review, historyHash: '0'.repeat(64) }), { code: 'WORKSPACE_DOT_HISTORY_REVIEW' });
  const resumed = await host.ctx.workspaceDotHost.resumeReviewedHistory({ ...review, historyHash: currentInspected.historyHash });
  assert.equal(resumed.connection.id, connection.id); assert.equal(resumed.connection.grantId, connection.grantId);
  await host.ctx.workspaceDotHost.reviewBindings({ expectedEpoch: resumed.lifecycle.epoch, configurationHash: resumed.lifecycle.configurationHash,
    bindings: [{ ...originalBinding, authorizationEpoch: resumed.connection.authorizationEpoch }] });
  const after = JSON.parse(await readFile(path.join(root, 'business/workspace.json'), 'utf8'));
  assert.deepEqual(after.workspaceDotTasks, before.workspaceDotTasks);
  assert.deepEqual(after.personalWorkers.delegations, before.personalWorkers.delegations);
  assert.deepEqual(after.artifacts, before.artifacts);
  assert.deepEqual(host.ctx.agents.get(actor.nativeAgentId).session.ownEvents(), retainedSession);
  assert.equal(host.service.status().phase, 'active');
  await tool('identity');
  if (pendingMode) {
    const goalId = host.ctx.goals.get(host.ctx.agents.get(actor.nativeAgentId)).id;
    const retried = await host.ctx.workspaceDotHost.submitQuestion(actor, pending);
    const repeated = await host.ctx.workspaceDotHost.submitQuestion(actor, pending);
    assert.equal(retried.goalId, goalId); assert.equal(repeated.requestId, retried.requestId);
    assert.equal((await host.service.bindDotTasks(actor).view()).length, 2);
    await subscribe();
    await new Promise(resolve => setTimeout(resolve, 1400));
    const pendingJobs = (await host.service.bindActor(actor).view()).delegations.filter(job => job.id !== task.jobId);
    assert.equal(pendingJobs.length, 1); assert.equal(pendingJobs[0].state, 'queued');
  }
  console.log('PASS: real native Harness ' + mode + ' history survives restart; exact private recovery restores original connection; recovery never replays a Goal, attempt, receipt, file or Session; explicit pending retry preserves original IDs.');
} finally {
  if (host) await host.close();
  await rm(root, { recursive: true, force: true });
}
