import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { ProviderError } from '../server/provider.mjs';
import { createFastAITokenProvider } from '../server/relay-provider.mjs';
import { operationalDiagnostics, readLocalVerification } from '../server/diagnostics.mjs';
import { sourceFingerprint } from '../server/source-fingerprint.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 300; i++) { if (await check()) return; await sleep(10); } throw new Error('Diagnostic fixture timed out'); }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-diagnostics-'));
  let app = await createApp({ dataDirectory: directory, schedulerIntervalMs: 50, ...options });
  let address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(base + '/api' + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.equal(response.status < 300, true); assert.equal(response.headers.get('cache-control'), 'no-store'); return response.json();
  };
  return { get app() { return app; }, api, async restart() { await app.close(); app = await createApp({ dataDirectory: directory, schedulerIntervalMs: 50, ...options }); address = await app.listen(0); base = `http://127.0.0.1:${address.port}`; } };
}

test('diagnostics: GET snapshots expose actionable missing configuration without probes or workspace mutation', async t => {
  let calls = 0;
  const f = await fixture(t, { provider: createFastAITokenProvider({ model: 'gpt-6-sol', fetchImpl: () => { calls++; throw new Error('No networking in fixture'); } }) });
  const sequence = f.app.store.read().meta.sequence;
  const view = await f.api('/diagnostics'), state = await f.api('/bootstrap'), runtime = await f.api('/status');
  assert.equal(view.schemaVersion, 1); assert.match(view.instanceId, /^[a-f0-9-]{36}$/); assert.ok(Date.parse(view.observedAt) >= Date.parse(view.startedAt));
  assert.equal(view.readOnly, true); assert.equal(view.externalCalls, false); assert.equal(view.staleAfterMs, 15000);
  assert.equal(view.overall, 'setup_required'); assert.equal(view.provider.configuration, 'missing'); assert.equal(view.provider.onlineVerified, false);
  assert.equal(view.provider.liveValidation.status, 'not_validated'); assert.equal(view.provider.lastObservation.status, 'not_observed');
  assert.ok(view.blockers.some(item => item.code === 'PROVIDER_SETUP_REQUIRED' && item.action));
  assert.equal(state.diagnostics.instanceId, view.instanceId); assert.equal(runtime.readiness, 'setup_required'); assert.equal(runtime.onlineVerified, false);
  assert.equal(view.storage.liveWriteProbe, false); assert.equal(view.storage.durability, 'confirmed'); assert.equal(calls, 0); assert.equal(f.app.store.read().meta.sequence, sequence);
  assert.equal(state.capabilities.scheduler.automaticTimer, true); assert.equal((await f.api('/capabilities')).scheduler.automaticTimer, true);
});

test('diagnostics: configured fixture is never presented as live validated and secrets are excluded', async t => {
  let calls = 0;
  const secret = 'fixture-secret-diagnostic-never-visible';
  const f = await fixture(t, { provider: createFastAITokenProvider({ apiKey: secret, model: 'gpt-6-sol', fetchImpl: () => { calls++; } }) });
  for (let i = 0; i < 3; i++) {
    const view = await f.api('/diagnostics');
    assert.equal(view.overall, 'configured_unverified'); assert.equal(view.provider.configuration, 'present'); assert.equal(view.provider.lastObservation.status, 'not_observed');
    assert.equal(view.provider.liveValidation.status, 'not_validated'); assert.doesNotMatch(JSON.stringify(view), new RegExp(secret));
  }
  assert.equal(calls, 0);
});

test('diagnostics: provider failure, explicit retry and restart are separate from live acceptance', async t => {
  let calls = 0, fail = true;
  const provider = { configured: true, model: 'fixture-model', models: ['fixture-model'], complete: async () => { calls++; if (fail) throw new ProviderError('PROVIDER_UNREACHABLE', 'fixture outage'); return { content: 'Local fixture reply only' }; } };
  const f = await fixture(t, { provider });
  const { conversation } = await f.api('/conversations', 'POST', {});
  const send = async key => (await f.api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Fixture request', requestId: key })).run.id;
  const run = await send('outage'); await until(() => f.app.runtime.getRun(run).run.status === 'failed');
  let view = await f.api('/diagnostics'); const oldInstance = view.instanceId;
  assert.equal(view.overall, 'degraded'); assert.equal(view.provider.lastObservation.code, 'PROVIDER_UNREACHABLE'); assert.ok(view.blockers.some(item => item.code === 'PROVIDER_UNREACHABLE'));
  await f.api('/diagnostics'); assert.equal(calls, 1, 'Refresh does not retry');
  fail = false; const recovered = await send('manual-retry'); await until(() => f.app.runtime.getRun(recovered).run.status === 'succeeded');
  view = await f.api('/diagnostics'); assert.equal(view.overall, 'configured_unverified'); assert.equal(view.provider.lastObservation.status, 'succeeded'); assert.equal(view.provider.onlineVerified, false); assert.equal(view.provider.liveValidation.status, 'not_validated');
  await f.restart(); view = await f.api('/diagnostics'); assert.notEqual(view.instanceId, oldInstance); assert.equal(view.provider.lastObservation.status, 'not_observed'); assert.equal(view.provider.liveValidation.status, 'not_validated'); assert.equal(calls, 2); assert.equal((await f.api('/bootstrap')).runs.length, 2);
});

test('diagnostics: unsafe provider exception details and codes never enter diagnostics', async t => {
  const secret = 'do-not-copy-private-exception';
  const f = await fixture(t, { provider: { configured: true, complete: async () => { throw new ProviderError(secret, secret); } } });
  const { conversation } = await f.api('/conversations', 'POST', {});
  const { run } = await f.api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Fixture failure' });
  await until(() => f.app.runtime.getRun(run.id).run.status === 'failed');
  const view = await f.api('/diagnostics'); assert.equal(view.provider.lastObservation.code, 'PROVIDER_FAILURE'); assert.doesNotMatch(JSON.stringify(view), new RegExp(secret));
});

test('diagnostics: scheduler reports actual lifecycle, swallowed failures and recovery without external calls', async t => {
  const f = await fixture(t);
  await until(() => f.app.diagnostics().scheduler.state === 'healthy');
  const original = f.app.capabilities.tick; let calls = 0;
  f.app.capabilities.tick = async () => { calls++; throw new Error('sensitive filesystem detail'); };
  await until(() => f.app.diagnostics().scheduler.state === 'degraded');
  const failed = await f.api('/diagnostics'); assert.equal(failed.scheduler.lastError.code, 'SCHEDULER_TICK_FAILED'); assert.ok(failed.scheduler.lastCompletedAt); assert.doesNotMatch(JSON.stringify(failed), /sensitive filesystem detail/);
  assert.ok(calls > 0); f.app.capabilities.tick = original;
  await until(() => f.app.diagnostics().scheduler.state === 'healthy'); assert.equal(f.app.diagnostics().scheduler.lastError, null);
  await f.app.close(); assert.equal(f.app.diagnostics().scheduler.state, 'stopped'); assert.equal(f.app.diagnostics().scheduler.automaticTimer, false);
});

test('diagnostics: connector configuration health requires no adapter executions or credential exposure', async t => {
  let calls = 0;
  const f = await fixture(t, { connectorAdapters: { local: { capabilities: ['read'], credentialEnvNames: ['FIXTURE_TOKEN'], execute: async () => { calls++; } } }, capabilityEnvironment: { FIXTURE_TOKEN: '' } });
  const { connector } = await f.api('/connectors', 'POST', { name: 'Local fixture adapter', adapter: 'local', capabilities: ['read'], credentialRefs: { token: 'FIXTURE_TOKEN' } });
  await f.api(`/connectors/${connector.id}`, 'PATCH', { enabled: true });
  let view = await f.api('/diagnostics'); assert.equal(view.connectors.blocked, 1); assert.equal(view.connectors.items[0].status, 'credential_missing'); assert.equal(view.connectors.onlineVerified, false);
  assert.ok(view.blockers.some(item => item.code === 'CONNECTORS_NOT_CONFIGURED')); assert.doesNotMatch(JSON.stringify(view), /credentialRefs|FIXTURE_TOKEN/);
  await f.api(`/connectors/${connector.id}`, 'PATCH', { enabled: false }); view = await f.api('/diagnostics'); assert.equal(view.connectors.blocked, 0); assert.equal(view.connectors.items[0].status, 'disabled'); assert.equal(calls, 0);
});

function snapshot(overrides = {}) {
  return { instanceId: 'fixture-instance', startedAt: '2026-10-04T00:00:00.000Z', now: Date.parse('2026-10-04T00:00:30.000Z'), runtime: { provider: 'fixture', kind: 'fixture', model: 'fixture-model', configured: true, lastObservation: { status: 'not_observed', observedAt: null, code: null, scope: 'current-process-provider-return' } }, storage: { state: 'open', durability: 'confirmed', warnings: [] }, capabilities: { connectors: [], schedules: [], scheduler: { dispatchConfigured: true } }, scheduler: { state: 'healthy', automaticTimer: true, intervalMs: 50, lastStartedAt: '2026-10-04T00:00:00.000Z', lastCompletedAt: '2026-10-04T00:00:00.000Z', lastError: null }, recovery: { restored: false }, access: { mode: 'local' }, localVerification: { status: 'missing', evidenceKind: 'local-fixtures' }, ...overrides };
}

test('diagnostics: hung scheduler, uncertain storage and restored data have bounded truthful blockers', () => {
  let view = operationalDiagnostics(snapshot()); assert.equal(view.scheduler.state, 'stale'); assert.ok(view.blockers.some(item => item.code === 'SCHEDULER_REVIEW_REQUIRED'));
  view = operationalDiagnostics(snapshot({ storage: { state: 'writes-stopped', durability: 'uncertain', warnings: [{ code: 'WORKSPACE_MIGRATION_BACKUP_UNAVAILABLE', message: 'Backup cannot be verified.' }] }, recovery: { restored: true, reviewRequired: true } }));
  for (const code of ['STORAGE_REVIEW_REQUIRED', 'WORKSPACE_MIGRATION_BACKUP_UNAVAILABLE', 'RESTORE_REVIEW_REQUIRED']) assert.ok(view.blockers.some(item => item.code === code));
  assert.equal(view.storage.liveWriteProbe, false); assert.equal(view.overall, 'degraded');
});

test('diagnostics: local fixture evidence is bounded, source-bound and cannot imply live acceptance', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-local-evidence-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const folder of ['server', 'src', 'dist', 'vendor', 'scripts', 'evidence']) await fs.mkdir(path.join(directory, folder));
  for (const filename of ['package.json', 'package-lock.json']) await fs.writeFile(path.join(directory, filename), '{}');
  assert.equal((await readLocalVerification(directory)).status, 'missing');
  const filename = path.join(directory, 'evidence/local-verification.json');
  const report = { schemaVersion: 1, evidenceKind: 'local-fixtures', result: 'passed', checkedAt: new Date().toISOString(), externalCalls: false, actualBrowser: false, sourceFingerprint: await sourceFingerprint(directory), checks: ['backend', 'production-ui-dom'].map(name => ({ name, tests: 1, passed: 1, failed: 0, skipped: 0 })) };
  await fs.writeFile(filename, JSON.stringify(report)); assert.equal((await readLocalVerification(directory)).status, 'passed');
  await fs.writeFile(path.join(directory, 'src/changed.ts'), '// changed'); assert.equal((await readLocalVerification(directory)).status, 'stale');
  await fs.writeFile(filename, JSON.stringify({ ...report, evidenceKind: 'real-provider-fastaitoken' })); assert.equal((await readLocalVerification(directory)).status, 'invalid');
  await fs.writeFile(filename, JSON.stringify({ ...report, checks: report.checks.map(check => ({ ...check, skipped: 1 })) })); assert.equal((await readLocalVerification(directory)).status, 'invalid');
  await fs.writeFile(filename, 'x'.repeat(16385)); assert.equal((await readLocalVerification(directory)).status, 'invalid');
  await fs.rm(filename); await fs.symlink(path.join(directory, 'package.json'), filename); assert.equal((await readLocalVerification(directory)).status, 'invalid');
});

test('diagnostics: saved connector failure is scoped to current revision and never retried by GET', async t => {
  let calls = 0;
  const f = await fixture(t, { connectorAdapters: { fixture: { capabilities: ['read'], execute: async () => { calls++; throw new Error('fixture remote result unknown'); } } } });
  const { connector } = await f.api('/connectors', 'POST', { name: 'Fixture failing adapter', adapter: 'fixture', capabilities: ['read'] });
  await f.api(`/connectors/${connector.id}`, 'PATCH', { enabled: true });
  const input = { action: 'read', resource: 'fixture:document' };
  const { approval } = await f.api(`/connectors/${connector.id}/approval`, 'POST', input);
  await f.api(`/approvals/${approval.id}/decision`, 'POST', { decision: 'approved', confirmed: true });
  await f.api(`/connectors/${connector.id}/execute`, 'POST', { ...input, approvalId: approval.id });
  const view = await f.api('/diagnostics'); assert.equal(view.connectors.recentFailures, 1); assert.equal(view.connectors.items[0].lastRun.status, 'failed'); assert.ok(view.blockers.some(item => item.code === 'CONNECTOR_ACTION_REVIEW_REQUIRED')); assert.equal(calls, 1);
  await f.api(`/connectors/${connector.id}`, 'PATCH', { enabled: false });
  assert.equal((await f.api('/diagnostics')).connectors.recentFailures, 0); assert.equal(calls, 1);
});

test('diagnostics: older concurrent provider completion cannot hide a newer outage', async t => {
  let firstResolve, calls = 0;
  const f = await fixture(t, { provider: { configured: true, complete: async () => { calls++; if (calls === 1) return new Promise(resolve => { firstResolve = resolve; }); throw new ProviderError('PROVIDER_UNREACHABLE', 'fixture outage'); } } });
  const { conversation: first } = await f.api('/conversations', 'POST', {}), { conversation: second } = await f.api('/conversations', 'POST', {});
  const old = await f.api(`/conversations/${first.id}/messages`, 'POST', { content: 'first fixture' }); await until(() => firstResolve);
  const newer = await f.api(`/conversations/${second.id}/messages`, 'POST', { content: 'newer fixture' }); await until(() => f.app.runtime.getRun(newer.run.id).run.status === 'failed');
  firstResolve({ content: 'older fixture return' }); await until(() => f.app.runtime.getRun(old.run.id).run.status === 'succeeded');
  const view = await f.api('/diagnostics'); assert.equal(view.provider.lastObservation.status, 'failed'); assert.equal(view.provider.lastObservation.code, 'PROVIDER_UNREACHABLE'); assert.equal(view.provider.onlineVerified, false);
});
