import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHarnessProvider, createNativeRelayOverlay } from '../server/harness-provider.mjs';
import { createNativeStorageOverlay } from '../server/native-storage.mjs';
import { runNativeProviderAcceptance, nativeAcceptanceConfiguration, NATIVE_ACCEPTANCE_LIMITS } from '../scripts/acceptance-native-provider.mjs';

/** Local synthetic Harness with durable fixture history. Never boots a native profile. */
async function fixture(t, { omitReceipts = false, cancelCompletes = false, failSecondClose = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'native-acceptance-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, 'new-data'), dshHome = path.join(dataDirectory, 'harness');
  const options = { apiKey: 'synthetic-not-a-real-key', dshBin: path.join(root, 'fixture-bin.mjs'),
    profilePatch: path.join(root, 'fixture-profile.yml'), relayPatch: path.join(root, 'fixture-relay.yml'),
    bridgePatch: path.join(root, 'fixture-bridge.yml'), recoveryPatch: path.join(root, 'fixture-storage.yml'),
    nativeBridge: true, nativeProvider: 'workspace-fastaitoken', nativeProfile: 'sdk', nativeModel: 'gpt-6-sol',
    nativeProtocol: 'openai-completions', nativeBaseURL: 'https://www.fastaitoken.com/v1', nativeApiKeyEnv: 'FASTAITOKEN_API_KEY',
    dshHome, workspaceDirectory: path.join(dataDirectory, 'agent-workspace') };
  await writeFile(options.dshBin, '// Inert path fixture; never executed.\n');
  await writeFile(options.profilePatch, '# Inert profile fixture; never loaded.\n');
  await writeFile(options.bridgePatch, '# Inert bridge fixture; never loaded.\n');
  await writeFile(options.relayPatch, JSON.stringify(createNativeRelayOverlay({ ...options, contextWindow: 8192, maxTokens: 1600 })));
  await writeFile(options.recoveryPatch, JSON.stringify(createNativeStorageOverlay({ dshHome, compression: 'none' })));
  const observations = { constructed: 0, closed: 0, commands: 0, opens: [], requests: [], markers: [] };
  class SyntheticHarness {
    closed = false;
    pending;
    constructor(settings) {
      this.settings = settings; this.number = ++observations.constructed;
      assert.equal(settings.maxTokens, NATIVE_ACCEPTANCE_LIMITS.requestedOutputTokensPerModelRequest);
      assert.deepEqual(settings.patches, [options.profilePatch, options.relayPatch, options.bridgePatch, options.recoveryPatch]);
      assert.equal(settings.cwd, options.workspaceDirectory); assert.equal(settings.dshHome, dshHome);
      this.client = { request: async (method, payload) => {
        assert.equal(method, 'workspace/session/open'); assert.equal(payload.version, 1);
        assert.equal(this.closed, false);
        observations.opens.push({ number: this.number, mode: payload.mode, sessionId: payload.sessionId });
        this.filename = path.join(dshHome, `${payload.sessionId}.synthetic-fixture.json`);
        if (payload.mode === 'create') { this.state = { sessionId: payload.sessionId, marker: null, turns: 0 }; await writeFile(this.filename, JSON.stringify(this.state), { flag: 'wx' }); }
        else this.state = JSON.parse(await readFile(this.filename, 'utf8'));
        assert.equal(this.state.sessionId, payload.sessionId);
        return { version: 1, sessionId: payload.sessionId, resumed: payload.mode === 'resume' };
      } };
    }
    async start() { assert.equal(this.closed, false); }
    async run(input, { sessionId, onNotification }) {
      assert.equal(this.closed, false); observations.commands++; observations.requests.push(input);
      assert.equal(this.state.sessionId, sessionId);
      this.state.marker ||= input.match(/NATIVE-ACCEPTANCE-[a-f0-9-]{36}/)?.[0];
      assert.ok(this.state.marker);
      if (this.state.turns > 0) assert.ok(!input.includes(this.state.marker), 'Native continuation must not replay the original marker as a new user turn');
      this.state.turns++; await writeFile(this.filename, JSON.stringify(this.state));
      observations.markers.push(this.state.marker);
      const notify = type => { if (!omitReceipts) onNotification({ method: 'session.event', params: { sessionId, event: { type } } }); };
      notify('agent/inbox/spliced');
      if (observations.commands === 4 && !cancelCompletes) return await new Promise((_resolve, reject) => { this.pending = reject; });
      notify('assistant/message');
      return { sessionId, finalResponse: this.state.marker };
    }
    async close() {
      observations.closed++; this.closed = true; this.pending?.(new Error('Synthetic process stopped'));
      if (failSecondClose && this.number === 2) throw new Error('Synthetic unconfirmed shutdown');
    }
  }
  const providerFactory = () => createHarnessProvider({ ...options, HarnessClass: SyntheticHarness });
  return { root, dataDirectory, options, observations, providerFactory };
}

function fixtureEnvironment(options) {
  return {
    PATH: process.env.PATH, FASTAITOKEN_API_KEY: options.apiKey,
    DSH_BIN: options.dshBin, DSH_PROFILE: options.nativeProfile, DSH_MODEL: options.nativeModel,
    DSH_PROVIDER: options.nativeProvider, DSH_PROTOCOL: options.nativeProtocol, DSH_BASE_URL: options.nativeBaseURL,
    DSH_API_KEY_ENV: options.nativeApiKeyEnv, DSH_RELAY_PATCH: options.relayPatch, DSH_REVIEWED_PATCH: options.profilePatch,
    DSH_WORKSPACE_BRIDGE: '1', DSH_WORKSPACE_BRIDGE_PATCH: options.bridgePatch, DSH_RECOVERY_PATCH: options.recoveryPatch,
    WORKSPACE_ACCEPTANCE_APPROVED: '1', WORKSPACE_ACCEPTANCE_NATIVE_PROFILE_REVIEWED: '1',
    WORKSPACE_ACCEPTANCE_NATIVE_TEXT_ONLY_PROFILE_VERIFIED: '1',
    WORKSPACE_ACCEPTANCE_TOTAL_CAP_CNY: '5', WORKSPACE_ACCEPTANCE_HARD_CAP_VERIFIED: '1',
    WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE: 'token-only', WORKSPACE_ACCEPTANCE_MODEL_GROUP: 'explicit-fixture-group',
    WORKSPACE_ACCEPTANCE_ACCOUNT_CURRENCY: 'CNY', WORKSPACE_ACCEPTANCE_BILLING_REVIEWED: '1',
    WORKSPACE_ACCEPTANCE_HARD_CAP_SEMANTICS_VERIFIED: '1',
  };
}

test('native runner uses real HTTP and adapter, new providers per restart, persisted synthetic history and confirmed cancellation', async t => {
  const f = await fixture(t);
  const report = await runNativeProviderAcceptance({ ...f, timeoutMs: 15_000 });
  assert.equal(report.result, 'passed', JSON.stringify(report));
  assert.equal(report.evidenceKind, 'synthetic-harness-fixture');
  assert.equal(report.acceptanceScope, 'native-text-session-lifecycle');
  assert.equal(report.nativeToolAcceptance, false); assert.equal(report.profilePermissionAcceptance, false);
  assert.equal(report.nativeInternalRequestsMeasured, false); assert.equal(report.limits.monetaryLimitEnforcedByRunner, false);
  assert.equal(report.appCommandCount, 4); assert.equal(f.observations.commands, 4);
  assert.equal(f.observations.constructed, 2); assert.equal(f.observations.closed, 2);
  assert.deepEqual(report.lifecycle, { providerInstances: 2, confirmedProviderCloses: 2 });
  assert.ok(Object.values(report.checks).every(Boolean)); assert.equal(Object.keys(report.checks).length, 9);
  assert.equal(report.calls[0].nativeSessionContinued, false);
  assert.equal(report.calls[2].nativeSessionContinued, true); assert.equal(report.calls[2].originalSession, true);
  assert.equal(f.observations.opens[2].number, 2); assert.equal(f.observations.opens[2].mode, 'resume');
  assert.equal(report.calls[3].outcome, 'CANCELLED'); assert.equal(report.cleanup, 'removed');
  await assert.rejects(stat(f.dataDirectory), { code: 'ENOENT' });
  const text = JSON.stringify(report);
  assert.ok(!text.includes(f.options.apiKey)); assert.ok(!text.includes(f.observations.markers[0]));
  assert.ok(!text.includes(f.dataDirectory)); assert.match(report.sourceFingerprint, /^[a-f0-9]{64}$/);
});

test('native runner cannot pass lifecycle acceptance from generated mapping alone without native event receipts', async t => {
  const f = await fixture(t, { omitReceipts: true });
  const report = await runNativeProviderAcceptance({ ...f, timeoutMs: 15_000 });
  assert.equal(report.result, 'failed'); assert.equal(report.failure.code, 'ACCEPTANCE_NATIVE_RECEIPTS');
  assert.equal(report.appCommandCount, 3); assert.equal(f.observations.closed, 2);
  assert.equal(report.cleanup, 'removed');
});

test('native cancellation that finishes too fast is inconclusive and never retried', async t => {
  const f = await fixture(t, { cancelCompletes: true });
  const report = await runNativeProviderAcceptance({ ...f, timeoutMs: 15_000 });
  assert.equal(report.result, 'failed'); assert.equal(report.failure.code, 'ACCEPTANCE_CANCELLATION_TOO_FAST');
  assert.equal(report.appCommandCount, 4); assert.equal(f.observations.commands, 4);
  assert.equal(report.noAutomaticPaidRetry, true); assert.equal(report.checks.cancellationAfterNativeAdmission, undefined);
});

test('native acceptance retains its isolated data when owned shutdown is unconfirmed', async t => {
  const f = await fixture(t, { failSecondClose: true });
  const report = await runNativeProviderAcceptance({ ...f, timeoutMs: 15_000 });
  assert.equal(report.result, 'failed'); assert.equal(report.failure.code, 'ACCEPTANCE_SHUTDOWN_UNCONFIRMED');
  assert.equal(report.cleanup, 'preserved-shutdown-unconfirmed');
  assert.equal((await stat(f.dataDirectory)).isDirectory(), true);
  assert.equal(report.appCommandCount, 4); assert.equal(report.lifecycle.confirmedProviderCloses, 1);
});

test('native acceptance requires fresh provider ownership for the second server lifetime', async t => {
  const f = await fixture(t); const reused = f.providerFactory();
  const report = await runNativeProviderAcceptance({ ...f, providerFactory: () => reused, timeoutMs: 15_000 });
  assert.equal(report.result, 'failed'); assert.equal(report.failure.code, 'ACCEPTANCE_FRESH_PROVIDER_REQUIRED');
  assert.equal(report.appCommandCount, 2); assert.equal(f.observations.constructed, 1);
});

test('native acceptance does not inspect or change an existing data directory', async t => {
  const f = await fixture(t); await mkdir(f.dataDirectory); await writeFile(path.join(f.dataDirectory, 'preserve.txt'), 'fixture bytes');
  await assert.rejects(runNativeProviderAcceptance({ ...f }), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(f.dataDirectory, 'preserve.txt'), 'utf8'), 'fixture bytes');
  assert.equal(f.observations.constructed, 0);
});

test('native live CLI is opt-in, has no fallback and never echoes a synthetic environment credential', () => {
  assert.throws(() => nativeAcceptanceConfiguration({}, []), /approval/);
  try {
    execFileSync(process.execPath, ['scripts/acceptance-native-provider.mjs'], {
      env: { PATH: process.env.PATH, FASTAITOKEN_API_KEY: 'synthetic-key-must-not-be-printed' }, encoding: 'utf8', stdio: 'pipe',
    }); assert.fail('The CLI should reject absent authorization');
  } catch (error) {
    assert.equal(error.status, 1); assert.match(error.stderr, /CNY5 TOTAL/);
    assert.doesNotMatch(`${error.stdout}${error.stderr}`, /synthetic-key-must-not-be-printed/);
  }
});

test('native CLI configuration preserves exact reviewed settings and requires tool-free profile and billing prerequisites', async t => {
  const f = await fixture(t), env = fixtureEnvironment(f.options);
  const args = ['--execute-paid-requests', '--data', f.dataDirectory, '--output', path.join(f.root, 'new-evidence.json')];
  const config = nativeAcceptanceConfiguration(env, args);
  assert.deepEqual(config.providerOptions, f.options);
  assert.equal(config.billingPrerequisites.independentlyVerified, false);
  assert.equal(config.billingPrerequisites.keyBillingMode, 'token-only');
  assert.equal(config.billingPrerequisites.requestTokenLimitEnforcedByProvider, 'unverified');
  assert.throws(() => nativeAcceptanceConfiguration({ ...env, WORKSPACE_ACCEPTANCE_NATIVE_TEXT_ONLY_PROFILE_VERIFIED: undefined }, args), /tool-free/);
  assert.throws(() => nativeAcceptanceConfiguration({ ...env, WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE: undefined }, args), /billing mode/);
  assert.throws(() => nativeAcceptanceConfiguration({ ...env, WORKSPACE_ACCEPTANCE_HARD_CAP_SEMANTICS_VERIFIED: undefined }, args), /in-flight/);
  assert.throws(() => nativeAcceptanceConfiguration({ ...env, DSH_MODEL: 'different-fixture-model' }, args), /exact reviewed/);
  assert.throws(() => nativeAcceptanceConfiguration({ ...env, DSH_WORKSPACE_BRIDGE: '0' }, args), /exact reviewed/);
  assert.throws(() => nativeAcceptanceConfiguration(env, [...args, '--unrecognized']), /arguments/);
  assert.throws(() => nativeAcceptanceConfiguration(env, ['--execute-paid-requests', '--data', f.dataDirectory, '--output', path.join(f.dataDirectory, 'report.json')]), /separate/);
  assert.equal(f.observations.constructed, 0);
});

test('native CLI refuses an existing evidence destination before any Harness process can start', async t => {
  const f = await fixture(t), output = path.join(f.root, 'existing-evidence.json');
  await writeFile(output, 'preserved fixture evidence');
  try {
    execFileSync(process.execPath, ['scripts/acceptance-native-provider.mjs', '--execute-paid-requests', '--data', f.dataDirectory, '--output', output],
      { env: fixtureEnvironment(f.options), encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
    assert.fail('Existing evidence must not be overwritten');
  } catch (error) { assert.equal(error.status, 1); assert.match(error.stderr, /not completed/); }
  assert.equal(await readFile(output, 'utf8'), 'preserved fixture evidence');
  await assert.rejects(stat(f.dataDirectory), { code: 'ENOENT' });
});
