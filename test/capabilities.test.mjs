import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../server/store.mjs';
import { CapabilityError, capabilityPayloadHash, createCapabilityService, goalDefinition } from '../server/capabilities.mjs';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-capabilities-'));
  let store = await openStore(directory);
  let time = Date.parse('2026-10-04T10:00:00.000Z');
  let service = await createCapabilityService({ store, clock: () => time, ...options });
  t.after(async () => { await service.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return {
    get service() { return service; }, get store() { return store; }, directory,
    advance: milliseconds => { time += milliseconds; },
    async restart(extra = {}) { await service.close(); await store.close(); store = await openStore(directory); service = await createCapabilityService({ store, clock: () => time, ...options, ...extra }); return service; },
    async goal() { const goal = { id: 'goal-test', title: 'Draft a report', description: 'Use supplied notes only.', maxSteps: 3, status: 'draft' }; await store.update(state => state.goals.push(goal)); return goal; },
  };
}
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof CapabilityError && error.code === code);
async function approve(service, scope, expiry = 300) { const { approval } = await service.requestApproval({ ...scope, expiresInSeconds: expiry }); await service.decideApproval(approval.id, { decision: 'approved', confirmed: true }); return approval.id; }
async function connector(service, extra = {}) { const { connector: saved } = await service.createConnector({ name: 'Reviewed test connector', adapter: 'test', capabilities: ['read'], ...extra }); return (await service.updateConnector(saved.id, { enabled: true })).connector; }
const fakeAdapter = execute => ({ capabilities: ['read'], credentialEnvNames: ['TEST_SERVICE_TOKEN'], execute });
const call = { action: 'read', resource: 'document:123', payload: { query: 'draft' } };

// Tests use injected inert adapters and callbacks; no network, models, shell, or cron.
test('registries initialize lazily, remain disabled, and survive a store restart', async t => {
  const f = await fixture(t);
  const { skill } = await f.service.createSkill({ name: 'Editing', instructions: 'Write concise drafts.' });
  const { connector: saved } = await f.service.createConnector({ name: 'Unavailable integration', adapter: 'none', capabilities: ['read'], credentialRefs: { token: 'SERVICE_TOKEN' } });
  const goal = await f.goal();
  const { schedule } = await f.service.createSchedule({ title: 'Draft later', goalId: goal.id, kind: 'every', everySeconds: 60 });
  assert.equal(skill.enabled, false); assert.equal(saved.enabled, false); assert.equal(schedule.enabled, false);
  assert.deepEqual(f.service.getPromptSkills(), []);
  await f.service.updateSkill(skill.id, { enabled: true });
  await f.restart();
  assert.equal(f.service.getSkill(skill.id).instructions, 'Write concise drafts.');
  assert.equal(f.service.getConnector(saved.id).adapterConfigured, false);
  assert.equal(f.service.getSchedule(schedule.id).enabled, false);
  assert.equal(f.service.getPromptSkills()[0].id, skill.id);
  await f.service.deleteSkill(skill.id); await f.service.deleteConnector(saved.id); await f.service.deleteSchedule(schedule.id);
  assert.equal(f.service.listSkills().length, 0); assert.equal(f.service.listConnectors().length, 0); assert.equal(f.service.listSchedules().length, 0);
});

test('connector registry rejects raw credential fields and unreviewed environment names', async t => {
  const f = await fixture(t, { adapters: { test: fakeAdapter(async () => ({})) }, environment: { TEST_SERVICE_TOKEN: 'private-test-value' } });
  await rejects(f.service.createConnector({ name: 'Bad', adapter: 'test', capabilities: ['read'], apiKey: 'raw-value' }), 'INVALID_INPUT');
  await rejects(f.service.createConnector({ name: 'Bad', adapter: 'test', capabilities: ['read'], credentialRefs: { token: 'raw-secret-with-dashes' } }), 'RAW_CREDENTIAL_REJECTED');
  await rejects(f.service.createConnector({ name: 'Bad', adapter: 'test', capabilities: ['read'], credentialRefs: { token: 'UNREVIEWED_ENV' } }), 'ADAPTER_SCOPE_DENIED');
  await rejects(f.service.createConnector({ name: 'Bad', adapter: 'test', capabilities: ['write'] }), 'ADAPTER_SCOPE_DENIED');
  await rejects(f.service.createConnector({ name: 'private-test-value', adapter: 'test', capabilities: ['read'] }), 'RAW_CREDENTIAL_REJECTED');
  assert.equal(f.service.listConnectors().length, 0);
});

test('missing adapter, disabled connector and missing credential return honest blocked outcomes', async t => {
  let executions = 0;
  const f = await fixture(t, { adapters: { test: fakeAdapter(async () => { executions += 1; }) }, environment: {} });
  const { connector: disabled } = await f.service.createConnector({ name: 'Disabled', adapter: 'test', capabilities: ['read'] });
  assert.equal((await f.service.executeConnector(disabled.id, call)).execution.error.code, 'DISABLED');
  const missingAdapter = await connector(f.service, { adapter: 'missing' });
  assert.equal((await f.service.executeConnector(missingAdapter.id, call)).execution.error.code, 'ADAPTER_MISSING');
  const missingCredential = await connector(f.service, { credentialRefs: { token: 'TEST_SERVICE_TOKEN' } });
  assert.equal((await f.service.executeConnector(missingCredential.id, call)).execution.error.code, 'CREDENTIAL_MISSING');
  assert.equal(executions, 0);
});

test('connector execution requires a confirmed exact single-use approval', async t => {
  let executions = 0;
  const f = await fixture(t, { adapters: { test: fakeAdapter(async () => ({ receipt: ++executions })) } });
  const saved = await connector(f.service);
  await rejects(f.service.executeConnector(saved.id, call), 'APPROVAL_REQUIRED');
  await rejects(f.service.executeConnector(saved.id, { ...call, action: 'write' }), 'CAPABILITY_DENIED');
  const { approval } = await f.service.requestApproval(f.service.connectorApprovalRequest(saved.id, call));
  await rejects(f.service.decideApproval(approval.id, { decision: 'approved' }), 'EXPLICIT_DECISION_REQUIRED');
  await rejects(f.service.executeConnector(saved.id, { ...call, approvalId: approval.id }), 'APPROVAL_REQUIRED');
  await f.service.decideApproval(approval.id, { decision: 'approved', confirmed: true });
  await rejects(f.service.executeConnector(saved.id, { ...call, resource: 'document:other', approvalId: approval.id }), 'APPROVAL_MISMATCH');
  await rejects(f.service.executeConnector(saved.id, { ...call, payload: { query: 'changed' }, approvalId: approval.id }), 'APPROVAL_MISMATCH');
  const completed = await f.service.executeConnector(saved.id, { ...call, approvalId: approval.id });
  assert.equal(completed.execution.status, 'succeeded'); assert.equal(executions, 1);
  await rejects(f.service.executeConnector(saved.id, { ...call, approvalId: approval.id }), 'APPROVAL_USED');
  await f.restart();
  await rejects(f.service.executeConnector(saved.id, { ...call, approvalId: approval.id }), 'APPROVAL_USED');
  assert.equal(f.service.listConnectorRuns()[0].result.receipt, 1);
});

test('denied, expired, tampered, cross-resource and stale-configuration approvals never execute', async t => {
  let executions = 0;
  const f = await fixture(t, { adapters: { test: fakeAdapter(async () => { executions += 1; }) } });
  const a = await connector(f.service); const b = await connector(f.service);
  const denied = (await f.service.requestApproval(f.service.connectorApprovalRequest(a.id, call))).approval;
  await f.service.decideApproval(denied.id, { decision: 'denied', confirmed: true });
  await rejects(f.service.executeConnector(a.id, { ...call, approvalId: denied.id }), 'APPROVAL_REQUIRED');
  const expired = await approve(f.service, f.service.connectorApprovalRequest(a.id, call), 1); f.advance(1000);
  await rejects(f.service.executeConnector(a.id, { ...call, approvalId: expired }), 'APPROVAL_EXPIRED');
  const cross = await approve(f.service, f.service.connectorApprovalRequest(a.id, call));
  await rejects(f.service.executeConnector(b.id, { ...call, approvalId: cross }), 'APPROVAL_MISMATCH');
  const stale = await approve(f.service, f.service.connectorApprovalRequest(a.id, call));
  await f.service.updateConnector(a.id, { name: 'Changed configuration' });
  await rejects(f.service.executeConnector(a.id, { ...call, approvalId: stale }), 'APPROVAL_MISMATCH');
  const tampered = await approve(f.service, f.service.connectorApprovalRequest(a.id, call));
  await f.store.update(state => { state.capabilities.approvals.find(item => item.id === tampered).payload.resource = 'tampered'; });
  await rejects(f.service.executeConnector(a.id, { ...call, approvalId: tampered }), 'APPROVAL_MISMATCH');
  assert.equal(executions, 0);
});

test('simultaneous connector calls cannot consume one approval twice', async t => {
  let executions = 0;
  const f = await fixture(t, { adapters: { test: fakeAdapter(async () => ({ count: ++executions })) } });
  const saved = await connector(f.service);
  const approvalId = await approve(f.service, f.service.connectorApprovalRequest(saved.id, call));
  const results = await Promise.allSettled([f.service.executeConnector(saved.id, { ...call, approvalId }), f.service.executeConnector(saved.id, { ...call, approvalId })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(executions, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'APPROVAL_USED');
});

test('credential references persist, but adapter result echoes and errors cannot expose credentials', async t => {
  const secret = 'fake-private-credential-value'; let received; let mode = 'success';
  const f = await fixture(t, { environment: { TEST_SERVICE_TOKEN: secret }, adapters: { test: fakeAdapter(async input => {
    received = input.credentials.token;
    if (mode === 'failure') throw new Error(`upstream echo ${secret}`);
    return { text: `echo ${secret}`, url: encodeURIComponent(secret), encoded: Buffer.from(secret).toString('base64'), token: 'some-other-sensitive-value', nested: [{ [secret]: secret }] };
  }) } });
  const saved = await connector(f.service, { credentialRefs: { token: 'TEST_SERVICE_TOKEN' } });
  let approvalId = await approve(f.service, f.service.connectorApprovalRequest(saved.id, call));
  const result = await f.service.executeConnector(saved.id, { ...call, approvalId });
  assert.equal(received, secret); assert.equal(result.execution.result.text, 'echo [REDACTED]');
  assert.equal(result.execution.result.token, '[REDACTED]');
  mode = 'failure'; approvalId = await approve(f.service, f.service.connectorApprovalRequest(saved.id, call));
  assert.equal((await f.service.executeConnector(saved.id, { ...call, approvalId })).execution.status, 'failed');
  assert.equal(JSON.stringify(f.service.bootstrap()).includes(secret), false);
  assert.equal((await fs.readFile(path.join(f.directory, 'workspace.json'), 'utf8')).includes(secret), false);
  await rejects(f.service.requestApproval({ ...f.service.connectorApprovalRequest(saved.id, call), payload: { apiKey: 'any-value' } }), 'RAW_CREDENTIAL_REJECTED');
  await rejects(f.service.executeConnector(saved.id, { ...call, payload: { text: secret } }), 'RAW_CREDENTIAL_REJECTED');
  await rejects(f.service.executeConnector(saved.id, { ...call, resource: secret }), 'RAW_CREDENTIAL_REJECTED');
  await rejects(f.service.executeConnector(saved.id, { ...call, payload: { [secret]: 'value' } }), 'RAW_CREDENTIAL_REJECTED');
  await assert.rejects(f.service.createConnector({ [secret]: 'value' }), error => !error.message.includes(secret));
});

test('disabled schedules, missing dispatchers and invalid frequencies do not enqueue work', async t => {
  let dispatches = 0; const f = await fixture(t, { dispatchGoal: async () => { dispatches += 1; return { status: 'queued' }; } });
  const goal = await f.goal();
  await rejects(f.service.createSchedule({ title: 'Too often', goalId: goal.id, kind: 'every', everySeconds: 59 }), 'INVALID_INPUT');
  await rejects(f.service.createSchedule({ title: 'Auto-enable', goalId: goal.id, kind: 'every', everySeconds: 60, enabled: true }), 'APPROVAL_REQUIRED');
  const { schedule } = await f.service.createSchedule({ title: 'Later', goalId: goal.id, kind: 'every', everySeconds: 60 });
  f.advance(120_000); assert.deepEqual((await f.service.tick()).runs, []); assert.equal(dispatches, 0);
  await rejects(f.service.enableSchedule(schedule.id, {}), 'APPROVAL_REQUIRED');
  const approvalId = await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)); await f.service.enableSchedule(schedule.id, { approvalId });
  await f.restart({ dispatchGoal: undefined });
  assert.equal((await f.service.tick()).status, 'blocked'); assert.equal(f.service.listScheduleRuns().length, 0);
});

test('schedules claim latest missed occurrence exactly once and preserve idempotency across restart', async t => {
  const dispatches = []; const f = await fixture(t, { dispatchGoal: async input => { dispatches.push(input); return { status: 'queued' }; } });
  const goal = await f.goal();
  const { schedule } = await f.service.createSchedule({ title: 'Recurring report', goalId: goal.id, kind: 'every', everySeconds: 60 });
  const approvalId = await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)); await f.service.enableSchedule(schedule.id, { approvalId });
  f.advance(190_000);
  await Promise.all([f.service.tick(), f.service.tick(), f.service.tick()]);
  assert.equal(dispatches.length, 1); assert.equal(dispatches[0].dueAt, '2026-10-04T10:03:00.000Z');
  assert.equal(dispatches[0].goalId, goal.id); assert.match(dispatches[0].requestId, /^schedule-/);
  assert.equal(dispatches[0].expectedGoalDefinitionHash, capabilityPayloadHash(goalDefinition(goal, f.store.read())));
  assert.equal(f.service.getSchedule(schedule.id).scheduledAt, '2026-10-04T10:04:00.000Z');
  await f.restart(); await f.service.tick(); assert.equal(dispatches.length, 1);
  f.advance(50_000); await f.service.tick(); assert.equal(dispatches.length, 2);
  assert.notEqual(dispatches[0].requestId, dispatches[1].requestId);
  assert.equal(f.service.listScheduleRuns().every(item => item.status === 'queued'), true);
});

test('one-shot schedules end after admission and cannot silently replay', async t => {
  let dispatches = 0; const f = await fixture(t, { dispatchGoal: async () => { dispatches += 1; return { goal: { id: 'goal-test', status: 'queued' } }; } });
  const goal = await f.goal();
  const { schedule } = await f.service.createSchedule({ title: 'One report', goalId: goal.id, kind: 'at', scheduledAt: '2026-10-04T10:01:00Z' });
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  f.advance(60_000); await f.service.tick(); await f.service.tick();
  assert.equal(dispatches, 1); assert.equal(f.service.getSchedule(schedule.id).status, 'ended');
  await rejects(f.service.enableSchedule(schedule.id, {}), 'SCHEDULE_ENDED');
});

test('schedule edits require new consent and goal definition changes stop dispatch', async t => {
  let dispatches = 0; const f = await fixture(t, { dispatchGoal: async () => { dispatches += 1; return { status: 'queued' }; } });
  const goal = await f.goal();
  const { schedule } = await f.service.createSchedule({ title: 'Report', goalId: goal.id, kind: 'every', everySeconds: 60 });
  const stale = await approve(f.service, f.service.scheduleApprovalRequest(schedule.id));
  await f.service.updateSchedule(schedule.id, { title: 'Changed report' });
  await rejects(f.service.enableSchedule(schedule.id, { approvalId: stale }), 'APPROVAL_MISMATCH');
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  await f.store.update(state => { state.goals[0].description = 'Different authority'; });
  f.advance(60_000); await f.service.tick();
  assert.equal(dispatches, 0); assert.equal(f.service.getSchedule(schedule.id).lastError.code, 'GOAL_CHANGED');
  assert.equal(f.service.getSchedule(schedule.id).enabled, false);
});

test('blocked and failed goal dispatches disable schedules without automatic retry', async t => {
  let calls = 0; const f = await fixture(t, { dispatchGoal: async () => { calls += 1; if (calls === 1) return { status: 'skipped' }; throw new Error('private internal detail'); } });
  const goal = await f.goal();
  const { schedule } = await f.service.createSchedule({ title: 'Report', goalId: goal.id, kind: 'every', everySeconds: 60 });
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  f.advance(60_000); assert.equal((await f.service.tick()).runs[0].status, 'skipped');
  f.advance(60_000); await f.service.tick(); assert.equal(calls, 1);
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  assert.equal((await f.service.tick()).runs[0].status, 'failed');
  assert.equal(JSON.stringify(f.service.bootstrap()).includes('private internal detail'), false);
  f.advance(60_000); await f.service.tick(); assert.equal(calls, 2);
});

test('restart marks uncertain admissions interrupted and never redispatches', async t => {
  let calls = 0; const f = await fixture(t, { dispatchGoal: async () => { calls += 1; return { status: 'queued' }; } });
  const goal = await f.goal(); const { schedule } = await f.service.createSchedule({ title: 'Report', goalId: goal.id, kind: 'every', everySeconds: 60 });
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  await f.store.update(state => { state.capabilities.scheduleRuns.push({ id: 'uncertain', scheduleId: schedule.id, requestId: 'schedule-uncertain', dueAt: schedule.scheduledAt, status: 'dispatching' }); });
  f.advance(120_000); await f.restart(); await f.service.tick();
  assert.equal(calls, 0); assert.equal(f.service.listScheduleRuns()[0].status, 'interrupted');
  assert.equal(f.service.getSchedule(schedule.id).enabled, false);
});

test('shutdown records uncertain dispatch and fences late completion before rejecting new work', async t => {
  let finish; let entered; const enteredPromise = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { dispatchGoal: async () => { entered(); await new Promise(resolve => { finish = resolve; }); return { status: 'queued' }; } });
  const goal = await f.goal(); const { schedule } = await f.service.createSchedule({ title: 'Report', goalId: goal.id, kind: 'every', everySeconds: 60 });
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  f.advance(60_000); const tick = f.service.tick(); await enteredPromise;
  let drained = false; const close = f.service.close().then(() => { drained = true; });
  await rejects(f.service.tick(), 'SHUTTING_DOWN'); assert.equal(drained, false);
  await tick; await close; assert.equal(drained, true);
  assert.equal(f.service.listScheduleRuns()[0].status, 'interrupted');
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.service.listScheduleRuns()[0].status, 'interrupted');
});

test('canonical hashing bounds payloads and treats JSON key order consistently', () => {
  assert.equal(capabilityPayloadHash({ a: 1, b: [true, null] }), capabilityPayloadHash({ b: [true, null], a: 1 }));
  assert.throws(() => capabilityPayloadHash({ value: undefined }), { code: 'INVALID_INPUT' });
  assert.throws(() => capabilityPayloadHash(JSON.parse('{"__proto__":{}}')), { code: 'INVALID_INPUT' });
  assert.throws(() => capabilityPayloadHash('x'.repeat(64_001)), { code: 'PAYLOAD_TOO_LARGE' });
});


test('connector timeout and shutdown bound an adapter that ignores abort and fence late results', async t => {
  let finish; let entered; const enteredPromise = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { adapterTimeoutMs: 15, adapters: { test: fakeAdapter(async () => { entered(); return new Promise(resolve => { finish = resolve; }); }) } });
  const saved = await connector(f.service);
  const approvalId = await approve(f.service, f.service.connectorApprovalRequest(saved.id, call));
  const pending = f.service.executeConnector(saved.id, { ...call, approvalId }); await enteredPromise;
  const result = await pending;
  assert.equal(result.execution.status, 'interrupted'); assert.equal(result.execution.error.code, 'CONNECTOR_TIMEOUT');
  finish({ text: 'Too late' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.service.listConnectorRuns()[0].status, 'interrupted');
  assert.equal(f.service.listConnectorRuns()[0].result, undefined);
  await rejects(f.service.executeConnector(saved.id, { ...call, approvalId }), 'APPROVAL_USED');
  let enteredAgain; const enteredAgainPromise = new Promise(resolve => { enteredAgain = resolve; });
  await f.restart({ adapterTimeoutMs: 60_000, adapters: { test: fakeAdapter(async () => { enteredAgain(); return new Promise(() => {}); }) } });
  const freshApproval = await approve(f.service, f.service.connectorApprovalRequest(saved.id, call));
  const ignoredAbort = f.service.executeConnector(saved.id, { ...call, approvalId: freshApproval }); await enteredAgainPromise;
  await f.service.close(); const stopped = await ignoredAbort;
  assert.equal(stopped.execution.error.code, 'INTERRUPTED');
});

test('schedule approvals bind total output budget at enable and dispatch time', async t => {
  let calls = 0; const f = await fixture(t, { dispatchGoal: async () => { calls += 1; return { status: 'queued' }; } });
  const goal = await f.goal(); const { schedule } = await f.service.createSchedule({ title: 'Budgeted', goalId: goal.id, kind: 'every', everySeconds: 60 });
  const stale = await approve(f.service, f.service.scheduleApprovalRequest(schedule.id));
  await f.store.update(state => { state.goals[0].maxOutputTokens = 9000; });
  await rejects(f.service.enableSchedule(schedule.id, { approvalId: stale }), 'APPROVAL_MISMATCH');
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  await f.store.update(state => { state.goals[0].maxOutputTokens = 10_000; });
  f.advance(60_000); await f.service.tick();
  assert.equal(calls, 0); assert.equal(f.service.getSchedule(schedule.id).lastError.code, 'GOAL_CHANGED');
});

test('idle ticks do not write unchanged state', async t => {
  const f = await fixture(t, { dispatchGoal: async () => ({ status: 'queued' }) });
  let writes = 0; const original = f.store.update; f.store.update = callback => { writes += 1; return original(callback); };
  await f.service.tick(); await f.service.tick(); assert.equal(writes, 0);
  const goal = await f.goal(); const { schedule } = await f.service.createSchedule({ title: 'Future', goalId: goal.id, kind: 'every', everySeconds: 60 });
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  writes = 0; await f.service.tick(); assert.equal(writes, 0);
});


test('schedule consent binds global model and immutable execution context across restart', async t => {
  let calls = 0;
  const f = await fixture(t, { executionContext: { kind: 'text', model: 'model-a', permissionFingerprint: null }, dispatchGoal: async () => { calls += 1; return { status: 'queued' }; } });
  const goal = await f.goal(); const { schedule } = await f.service.createSchedule({ title: 'Model-bound', goalId: goal.id, kind: 'every', everySeconds: 60 });
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  await f.store.update(state => { state.settings.model = 'different-model'; });
  f.advance(60_000); await f.service.tick(); assert.equal(calls, 0);
  assert.equal(f.service.getSchedule(schedule.id).enabled, false);
  await f.service.enableSchedule(schedule.id, { approvalId: await approve(f.service, f.service.scheduleApprovalRequest(schedule.id)) });
  await f.restart({ executionContext: { kind: 'native', model: 'model-a', permissionFingerprint: 'reviewed-new-profile' } });
  await f.service.tick(); assert.equal(calls, 0);
  assert.equal(f.service.getSchedule(schedule.id).enabled, false);
});


test('memory guard detects declared credentials and key assignments without scanning unrelated env', async t => {
  const environment = new Proxy({ TEST_SERVICE_TOKEN: 'known-private-value' }, {
    ownKeys() { throw new Error('Environment enumeration forbidden'); },
    get(target, name) { assert.equal(name, 'TEST_SERVICE_TOKEN'); return target[name]; },
  });
  const f = await fixture(t, { environment, adapters: { test: fakeAdapter(async () => ({})) } });
  assert.equal(f.service.assertSafeMemory('Prefer concise reports.'), 'Prefer concise reports.');
  for (const content of ['Save known-private-value', Buffer.from('known-private-value').toString('base64'), 'api_key=unlisted-key', 'password: do-not-store', 'Authorization: Bearer private-token-value', '-----BEGIN PRIVATE KEY-----']) {
    assert.throws(() => f.service.assertSafeMemory(content), { code: 'RAW_CREDENTIAL_REJECTED' });
  }
  assert.equal(f.store.read().memories.length, 0);
});

test('draft creation request IDs prevent parallel/lost-response duplicates and reject changed bodies across restart', async t => {
  const f = await fixture(t); const goal = await f.goal();
  for (const [method, key, body] of [
    ['createSkill', 'skill', { name: 'Idempotent skill', instructions: 'Fixture only', requestId: 'create-skill' }],
    ['createConnector', 'connector', { name: 'Idempotent connector', adapter: 'unavailable', capabilities: ['read'], requestId: 'create-connector' }],
    ['createSchedule', 'schedule', { title: 'Idempotent schedule', goalId: goal.id, kind: 'every', everySeconds: 60, requestId: 'create-schedule' }],
  ]) {
    const results = await Promise.all(Array.from({ length: 5 }, () => f.service[method](body)));
    assert.equal(new Set(results.map(item => item[key].id)).size, 1);
    f.advance(70_000); await f.restart();
    assert.equal((await f.service[method](body))[key].id, results[0][key].id);
    await rejects(f.service[method]({ ...body, [key === 'schedule' ? 'title' : 'name']: 'Changed content' }), 'IDEMPOTENCY_CONFLICT');
  }
  assert.equal(f.store.read().capabilities.skills.length, 1); assert.equal(f.store.read().capabilities.connectors.length, 1); assert.equal(f.store.read().capabilities.schedules.length, 1);
});
