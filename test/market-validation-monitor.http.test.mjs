import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
import { localHttpTransport } from './fixtures/local-http.mjs';
import { libraryReadHash } from '../server/library-model-read-contract.mjs';

// Actual original App HTTP, signed ingress, ephemeral Sessions, Runtime,
// dispatcher and timer. These signing keys exist only in process memory for
// offline tests; no production credentials, model or acquisition are created.
const DAY = 86400000;
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/market-monitor-http-'), keys = generateKeyPairSync('ed25519');
  let clock = Date.parse('2026-10-12T10:00:00Z'), app, transport, receipt, planId, members = [
    { subject: 'owner', role: 'admin' }, { subject: 'other', role: 'operator' }, { subject: 'viewer', role: 'viewer' },
  ], sessions = new Map(), resolveGate = null, resolverEntered = null;
  const access = { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'fixture-workspace', issuer: 'fixture-ingress', keyId: 'fixture-only-key',
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), members };
  const settings = { dataDirectory: directory, access, capabilityEnvironment: {}, accessClock: () => clock, schedulerIntervalMs: options.automatic ? 50 : 60000,
    provider: { kind: 'pi-durable', configured: false, complete() { assert.fail('A monitoring task cannot invoke a model'); } },
    businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: 'workspace-agent-test-faux', model: 'workspace-agent-test', destination: 'faux://keyless-synthetic' },
      engineAdapter: { scope: 'omp:18.10.4:public-v1', complete() { assert.fail('No OMP model turn is authorized in monitoring'); } },
      resolveBinding() { assert.fail('Monitoring cannot obtain a second model or Agent binding'); } },
    marketValidationOptions: options.noResolver ? {} : { async resolveLaunchReceipt(input) {
      if (resolveGate) { resolverEntered?.(); await resolveGate; }
      assert.equal(input.planId, planId); assert.equal(input.planRevision, 1); assert.equal(input.launchReceiptId, 'original-launch');
      return structuredClone(receipt);
    } },
    shopifyFetch() { assert.fail('No real shop is configured or called by the HTTP lifecycle tests'); },
  };
  async function start() { app = await createApp(settings); const address = await app.listen(0); transport = localHttpTransport(`http://127.0.0.1:${address.port}`); sessions = new Map(); }
  async function stop() { await transport.close(); await app.close(); }
  await start(); t.after(async () => { await stop(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(pathname, { method = 'GET', body, subject = 'owner', headers = {}, unsigned = false } = {}) {
    const bytes = body === undefined ? '' : JSON.stringify(body), session = sessions.get(subject);
    const response = await transport.fetch(pathname, { method, headers: { Host: 'workspace.example',
      ...(!['GET', 'HEAD'].includes(method) ? { Origin: access.publicOrigin } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session || {}),
      ...(!unsigned ? { 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: keys.privateKey, ...access, subject, method, target: pathname, body: bytes, now: clock }) } : {}), ...headers }, ...(body !== undefined ? { body: bytes } : {}) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, response };
  }
  async function login(subject = 'owner') {
    sessions.delete(subject);
    const result = await api('/api/session/login', { method: 'POST', body: {}, subject, headers: { 'X-Workspace-Login': '1' } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    sessions.set(subject, { Cookie: result.response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': result.data.csrfToken });
  }
  await login();
  const source = await api('/api/conversations', { method: 'POST', body: { title: 'Original business Agent source', requestId: 'source-original' } });
  assert.equal(source.status, 201, JSON.stringify(source.data));
  const sourceId = source.data.conversation.id;
  const plan = { timeZone: 'Asia/Shanghai', paths: [{ mode: 'b2c', acquisition: [{ id: 'approved-source' }],
    metrics: (options.metrics || ['net_paid_units']).map(id => ({ id, definition: `Original selected metric: ${id}` })),
    salesRequirement: { metric: 'net_paid_units', target: 1, definition: 'A paid unit is not an inquiry or a view.' } }] };
  const saved = await app.artifacts.create({ requestId: 'original-plan-artifact', filename: 'market-validation-plan.json',
    content: JSON.stringify({ schema: 'workspace.market-validation-plan.v1', plan }), sourceConversationId: sourceId,
    metadata: { marketValidationPlan: { ownerHash: libraryReadHash(['fixture-workspace', 'owner', sourceId]), planHash: libraryReadHash(plan) } } });
  planId = saved.artifact.id;
  receipt = { id: 'original-launch', planId, planRevision: 1, planSha256: saved.artifact.sha256, planHash: libraryReadHash(plan), planAcquisitionId: 'approved-source', approved: true, status: 'launched', evidenceKind: 'real', launchKind: 'acquisition',
    startedAt: '2026-10-12T09:00:00.000Z', timezone: 'Asia/Shanghai', productId: 'gid://shopify/Product/123', variantIds: [], shopId: 'gid://shopify/Shop/1', channelId: 'approved-source', businessMode: 'b2c', conversationId: sourceId };
  return { get app() { return app; }, sourceId, get receipt() { return receipt; }, api, login,
    create: (patch = {}) => api(`/api/conversations/${sourceId}/market-validation-monitors`, { method: 'POST', body: { requestId: 'monitor-original', planId, planRevision: 1, launchReceiptId: 'original-launch', confirmed: true, ...patch } }),
    advance(value) { clock += value; }, async restart() { await stop(); await start(); await login(); },
    deferResolver() { let release; const entered = new Promise(resolve => { resolverEntered = resolve; }); resolveGate = new Promise(resolve => { release = resolve; }); const finish = () => { resolveGate = null; resolverEntered = null; release(); }; finish.entered = entered; return finish; },
  };
}
const route = task => `/api/goals/${task.goalId}/market-validation-monitor`;
const read = task => ({ requestId: 'read-original', confirmed: true, expectedScopeHash: task.scopeHash });
const control = (task, action) => ({ action, confirmed: true, expectedScopeHash: task.scopeHash });
async function approve(f, task) {
  const requested = await f.api(`/api/schedules/${task.scheduleId}/approval`, { method: 'POST', body: {} });
  assert.equal(requested.status, 201, JSON.stringify(requested.data));
  const decision = await f.api(`/api/approvals/${requested.data.approval.id}/decision`, { method: 'POST', body: { decision: 'approved', confirmed: true } }); assert.equal(decision.status, 200);
  const enabled = await f.api(`/api/schedules/${task.scheduleId}/enable`, { method: 'POST', body: { approvalId: requested.data.approval.id } }); assert.equal(enabled.status, 200);
}
async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) { const result = check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('The original automatic scheduler did not produce its expected outcome');
}

test('authenticated business source links one original service-only Goal without adopting its Agent transcript', async t => {
  const f = await fixture(t);
  assert.equal((await f.create({ confirmed: false })).status, 400);
  const forbidden = await f.api('/api/goals', { method: 'POST', body: { title: 'Forbidden second model loop', conversationId: f.sourceId } });
  assert.equal(forbidden.data.error.code, 'BUSINESS_AGENT_CONVERSATION_ONLY');
  const result = await f.create(); assert.equal(result.status, 201, JSON.stringify(result.data)); const task = result.data;
  assert.notEqual(task.taskConversationId, f.sourceId); assert.equal(task.conversationId, f.sourceId); assert.equal(task.scheduleEnabled, false);
  const state = f.app.store.read(), context = state.conversations.find(row => row.id === task.taskConversationId);
  assert.equal(context.createdBy, 'owner'); assert.equal(context.workspaceId, 'fixture-workspace'); assert.equal(context.serviceTaskOwner.subject, 'owner');
  assert.equal(context.sourceConversationId, f.sourceId); assert.equal(context.businessAgentOwner, undefined);
  assert.equal(state.conversations.find(row => row.id === f.sourceId).businessAgentOwner.subject, 'owner'); assert.equal(state.runs.length, 0);
  await assert.rejects(f.app.runtime.sendMessage(task.taskConversationId, { content: 'Forbidden model chat', requestId: 'forbidden-chat' }), { code: 'SERVICE_TASK_MODEL_FORBIDDEN' });
  assert.equal((await f.api('/api/goals', { method: 'POST', body: { title: 'Generic adoption forbidden', conversationId: task.taskConversationId } })).data.error.code, 'SERVICE_TASK_CONTEXT_REQUIRED');
  assert.equal((await f.api(`/api/goals/${task.goalId}`, { method: 'PATCH', body: { action: 'start', requestId: 'forbidden-start' } })).data.error.code, 'SERVICE_TASK_MODEL_FORBIDDEN');
  await f.restart(); const duplicate = await f.create({ requestId: 'retry-after-restart' });
  assert.equal(duplicate.data.goalId, task.goalId); assert.equal(duplicate.data.taskConversationId, task.taskConversationId);
  const linked = await f.api(`/api/conversations/${f.sourceId}/market-validation-monitors`); assert.equal(linked.data.monitors[0].goalId, task.goalId);
  assert.equal(f.app.store.read().goals.length, 1); assert.equal(f.app.store.read().conversations.length, 2);
});
test('original HTTP approval and automatic timer dispatch the linked monitor and end it for native review', async t => {
  const f = await fixture(t, { automatic: true }), task = (await f.create()).data;
  await approve(f, task); f.advance(DAY);
  await until(() => f.app.store.read().goals[0].marketValidationMonitor.observations[0]?.status === 'complete');
  assert.equal(f.app.store.read().capabilities.scheduleRuns[0].status, 'completed'); assert.equal(f.app.store.read().runs.length, 0);
  await f.restart(); f.advance(7 * DAY);
  await until(() => f.app.store.read().goals[0].marketValidationMonitor.summary);
  await f.login();
  const current = (await f.api(route(task))).data;
  assert.equal(current.status, 'window_ended'); assert.equal(current.goalStatus, 'review_required'); assert.equal(current.scheduleEnabled, false);
  assert.equal(current.observations.length, 2); assert.equal(current.summary.provisional, true);
  assert.equal(current.startAt, f.receipt.startedAt); assert.equal(f.app.store.read().runs.length, 0);
});
test('native Goal pause/cancel disable the original schedule; resume stays explicit and requires new consent', async t => {
  const f = await fixture(t), task = (await f.create()).data; await approve(f, task);
  const paused = await f.api(`/api/goals/${task.goalId}`, { method: 'PATCH', body: { action: 'pause', requestId: 'pause-original' } }); assert.equal(paused.status, 200);
  let current = (await f.api(route(task))).data; assert.equal(current.goalStatus, 'paused'); assert.equal(current.status, 'paused'); assert.equal(current.scheduleEnabled, false);
  const pausedRevision = f.app.capabilities.getSchedule(task.scheduleId).revision;
  await f.api(`/api/goals/${task.goalId}`, { method: 'PATCH', body: { action: 'pause', requestId: 'pause-original' } });
  assert.equal(f.app.capabilities.getSchedule(task.scheduleId).revision, pausedRevision);
  assert.equal((await f.api(route(task) + '/observe', { method: 'POST', body: read(task) })).data.error.code, 'MONITOR_STOPPED');
  await f.restart();
  const resumed = await f.api(route(task) + '/control', { method: 'POST', body: control(task, 'resume') }); assert.equal(resumed.status, 200); assert.equal(resumed.data.scheduleEnabled, false);
  assert.equal((await f.api(`/api/schedules/${task.scheduleId}/enable`, { method: 'POST', body: {} })).data.error.code, 'APPROVAL_REQUIRED');
  await approve(f, task); f.advance(DAY); await f.login();
  assert.equal((await f.app.capabilities.tick()).runs[0].status, 'completed');
  const cancelled = await f.api(`/api/goals/${task.goalId}`, { method: 'PATCH', body: { action: 'cancel', requestId: 'cancel-original' } }); assert.equal(cancelled.status, 200);
  current = (await f.api(route(task))).data; assert.equal(current.status, 'cancelled'); assert.equal(current.scheduleEnabled, false);
  await f.restart(); assert.equal((await f.api(route(task) + '/control', { method: 'POST', body: control(task, 'resume') })).data.error.code, 'MONITOR_CANCELLED');
});
test('signed Session, CSRF, role and cross-member privacy apply to source, task, Goal and Schedule routes', async t => {
  const f = await fixture(t), task = (await f.create()).data;
  assert.equal((await f.api(route(task), { unsigned: true })).status, 401);
  assert.equal((await f.api(route(task) + '/observe', { method: 'POST', body: read(task), headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  await f.login('other');
  for (const pathname of [route(task), `/api/goals/${task.goalId}`, `/api/conversations/${task.taskConversationId}`, `/api/schedules/${task.scheduleId}`]) assert.equal((await f.api(pathname, { subject: 'other' })).status, 404, pathname);
  const bootstrap = await f.api('/api/bootstrap', { subject: 'other' }); assert.equal(bootstrap.status, 200); assert.ok(!JSON.stringify(bootstrap.data).includes(task.goalId));
  assert.equal((await f.api(`/api/conversations/${f.sourceId}/market-validation-monitors`, { subject: 'other', method: 'POST', body: { requestId: 'wrong-owner', planId: 'original-plan', planRevision: 1, launchReceiptId: 'original-launch', confirmed: true } })).status, 404);
  await f.login('viewer'); assert.equal((await f.api('/api/conversations', { subject: 'viewer', method: 'POST', body: { title: 'Forbidden write' } })).status, 403);
});
test('default unconfigured Host and unreviewed plan/publication cannot start a task or acquire authority', async t => {
  const unconfigured = await fixture(t, { noResolver: true }); const blocked = await unconfigured.create();
  assert.equal(blocked.data.error.code, 'REAL_LAUNCH_RECEIPT_REQUIRED'); assert.equal(unconfigured.app.store.read().goals.length, 0);
  const f = await fixture(t); f.receipt.approved = false;
  assert.equal((await f.create()).data.error.code, 'REAL_LAUNCH_RECEIPT_REQUIRED'); f.receipt.approved = true; f.receipt.launchKind = 'publication';
  assert.equal((await f.create()).data.error.code, 'REAL_LAUNCH_RECEIPT_REQUIRED'); assert.equal(f.app.store.read().conversations.length, 1);
  const other = await f.api('/api/conversations', { method: 'POST', body: { title: 'Different source', requestId: 'source-other' } });
  f.receipt.launchKind = 'acquisition'; f.receipt.conversationId = other.data.conversation.id;
  assert.equal((await f.create()).data.error.code, 'MARKET_PLAN_RECEIPT_MISMATCH'); assert.equal(f.app.store.read().goals.length, 0);
});
test('session expiry while the trusted resolver waits cannot commit a linked task', async t => {
  const f = await fixture(t), release = f.deferResolver();
  const pending = f.create(); await release.entered; f.advance(DAY); release();
  const result = await pending; assert.equal(result.status, 403, JSON.stringify(result.data));
  assert.equal(f.app.store.read().goals.length, 0); assert.equal(f.app.store.read().conversations.length, 1);
});
test('Host reads original plan version/hash and channel binding, never trusts a caller or resolver plan flag', async t => {
  const f = await fixture(t);
  const original = f.receipt.planSha256; f.receipt.planSha256 = '0'.repeat(64);
  assert.equal((await f.create()).data.error.code, 'MARKET_PLAN_RECEIPT_MISMATCH'); assert.equal(f.app.store.read().goals.length, 0);
  f.receipt.planSha256 = original; f.receipt.planAcquisitionId = 'unapproved-channel';
  assert.equal((await f.create()).data.error.code, 'MARKET_PLAN_RECEIPT_MISMATCH'); f.receipt.planAcquisitionId = 'approved-source';
  const task = (await f.create()).data;
  assert.equal(task.requiredMetrics[0].id, 'net_paid_units');
  await f.app.artifacts.update(f.receipt.planId, { content: JSON.stringify({ schema: 'workspace.market-validation-plan.v1', plan: { changed: true } }) });
  assert.equal((await f.api(route(task) + '/observe', { method: 'POST', body: read(task) })).data.error.code, 'MARKET_PLAN_RECEIPT_MISMATCH');
  assert.equal(f.app.store.read().goals.length, 1); assert.equal(f.app.store.read().goals[0].marketValidationMonitor.observations.length, 0);
});
test('plan-selected required metrics appear in the HTTP summary even when paid/order sources are missing', async t => {
  const f = await fixture(t, { metrics: ['visits', 'add_to_cart', 'checkouts', 'refunds', 'net_paid_units'] }), task = (await f.create()).data;
  f.advance(8 * DAY); await f.login();
  const result = await f.api(route(task) + '/observe', { method: 'POST', body: read(task) }); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.summary.measurement.status, 'insufficient_evidence'); assert.equal(result.data.summary.goalVerified, false);
  assert.deepEqual(result.data.summary.measurement.gaps.map(item => item.metric), ['visits', 'add_to_cart', 'checkouts', 'refunds', 'net_paid_units']);
  assert.equal(result.data.summary.baseline.status, 'unavailable'); assert.equal(f.app.store.read().goals.length, 1);
});
test('plan Artifact mutation during original receipt resolution is fenced before any task creation', async t => {
  const f = await fixture(t), release = f.deferResolver(), pending = f.create(); await release.entered;
  await f.app.artifacts.update(f.receipt.planId, { description: 'Synthetic metadata revision during original receipt resolution' });
  release(); const result = await pending;
  assert.equal(result.data.error.code, 'MARKET_PLAN_RECEIPT_MISMATCH'); assert.equal(f.app.store.read().goals.length, 0); assert.equal(f.app.store.read().conversations.length, 1);
});
