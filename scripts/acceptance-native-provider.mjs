#!/usr/bin/env node
/** Opt-in native text/session acceptance. Never run by npm test with a real profile. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { createHarnessProvider } from '../server/harness-provider.mjs';
import { ProviderError } from '../server/provider.mjs';
import { assertRelayAcceptanceBilling } from '../server/relay-billing.mjs';
import { sourceFingerprint } from './acceptance-provider.mjs';

export const NATIVE_ACCEPTANCE_LIMITS = Object.freeze({
  appCommands: 4, requestedOutputTokensPerModelRequest: 512, totalAppInputCharacters: 32_000,
  timeoutMs: 240_000, automaticRetries: 0,
  nativeInternalRequestCount: 'unknown', monetaryLimitEnforcedByRunner: false,
  requestTokenLimitEnforcedByProvider: 'unverified',
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionIdPattern = /^workspace-session-[a-f0-9]{32}$/;
const requiredCapabilities = ['native-persisted-session-resume', 'native-contained-recovery-storage', 'owned-process-cancellation'];
const endpoints = { 'openai-completions': 'https://www.fastaitoken.com/v1', 'openai-responses': 'https://fastaitoken.com/v1', 'anthropic-messages': 'https://fastaitoken.com/' };
const requireCheck = (condition, code) => { if (!condition) throw new ProviderError(code, 'Native acceptance did not establish the required condition.'); };

/** The factory must create a NEW provider at every startup; close is permanent. */
export async function runNativeProviderAcceptance({ providerFactory, dataDirectory,
  evidenceKind = 'synthetic-harness-fixture', timeoutMs = NATIVE_ACCEPTANCE_LIMITS.timeoutMs } = {}) {
  if (typeof providerFactory !== 'function' || typeof dataDirectory !== 'string' || !path.isAbsolute(dataDirectory)
    || path.resolve(dataDirectory) !== dataDirectory || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
    || timeoutMs > NATIVE_ACCEPTANCE_LIMITS.timeoutMs
    || !['synthetic-harness-fixture', 'real-native-provider-fastaitoken'].includes(evidenceKind)) throw new Error('Invalid native acceptance setup.');
  const fingerprint = await sourceFingerprint();
  // A reviewed storage patch names this exact new directory. Never retarget it.
  await fs.mkdir(dataDirectory, { mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  const deadlineSignal = AbortSignal.timeout(timeoutMs);
  const calls = [], providers = new Set(), checks = {};
  const report = {
    schemaVersion: 1, evidenceKind, acceptanceScope: 'native-text-session-lifecycle',
    runtime: 'harness', provider: 'fastaitoken', model: 'gpt-6-sol', startedAt: new Date().toISOString(),
    limits: { ...NATIVE_ACCEPTANCE_LIMITS, timeoutMs }, sourceFingerprint: fingerprint,
    calls, checks, result: 'failed', isolatedNewWorkspace: true,
    nativeToolAcceptance: false, profilePermissionAcceptance: false,
    nativeInternalRequestsMeasured: false, noAutomaticPaidRetry: true,
    lifecycle: { providerInstances: 0, confirmedProviderCloses: 0 },
  };
  let app, provider, base, inputCharacters = 0, originalSessionId;
  let noUnconfirmedShutdown = true;
  async function close() {
    if (!app) {
      if (provider) { await provider.close(); provider = null; }
      return;
    }
    await app.close(); app = null; provider = null;
  }
  async function launch() {
    requireCheck(Date.now() < deadline, 'ACCEPTANCE_TIMEOUT');
    const native = await providerFactory({ dataDirectory, dshHome: path.join(dataDirectory, 'harness'), workspaceDirectory: path.join(dataDirectory, 'agent-workspace') });
    provider = native;
    requireCheck(native && !providers.has(native), 'ACCEPTANCE_FRESH_PROVIDER_REQUIRED');
    providers.add(native);
    requireCheck(native.configured === true && native.kind === 'deepseek-harness' && native.model === 'gpt-6-sol'
      && native.route?.provider === 'workspace-fastaitoken' && endpoints[native.route.protocol] === native.route.endpoint
      && requiredCapabilities.every(value => native.capabilities?.includes(value))
      && /^[a-f0-9]{64}$/.test(native.permissionFingerprint), 'ACCEPTANCE_NATIVE_SETUP_REQUIRED');
    if (report.permissionFingerprint) requireCheck(report.permissionFingerprint === native.permissionFingerprint, 'ACCEPTANCE_POLICY_CHANGED');
    else { report.permissionFingerprint = native.permissionFingerprint; report.protocol = native.route.protocol; report.endpoint = native.route.endpoint; }
    report.lifecycle.providerInstances++;
    let confirmed = false;
    provider = {
      ...native,
      async close() { await native.close(); if (!confirmed) { confirmed = true; report.lifecycle.confirmedProviderCloses++; } },
      async complete(options) {
        const characters = options.messages.reduce((sum, item) => sum + (typeof item.content === 'string' ? item.content.length : 0), 0);
        requireCheck(calls.length < NATIVE_ACCEPTANCE_LIMITS.appCommands && inputCharacters + characters <= NATIVE_ACCEPTANCE_LIMITS.totalAppInputCharacters, 'ACCEPTANCE_COMMAND_LIMIT');
        requireCheck(Date.now() < deadline, 'ACCEPTANCE_TIMEOUT');
        inputCharacters += characters;
        const call = { command: calls.length + 1, inputCharacters: characters, requestedMaxTokens: NATIVE_ACCEPTANCE_LIMITS.requestedOutputTokensPerModelRequest,
          outcome: 'started', nativeEventTypes: [] };
        calls.push(call);
        const scopeAbort = new AbortController();
        try {
          const result = await native.complete({ ...options,
            maxTokens: NATIVE_ACCEPTANCE_LIMITS.requestedOutputTokensPerModelRequest,
            signal: AbortSignal.any([deadlineSignal, scopeAbort.signal, ...(options.signal ? [options.signal] : [])]),
            onEvent(event) {
              // Save only known discriminants; neither tool inputs nor model text.
              if (typeof event?.type === 'string' && /^[A-Za-z0-9_./:-]{1,120}$/.test(event.type)
                && call.nativeEventTypes.length < 1000 && !call.nativeEventTypes.includes(event.type)) call.nativeEventTypes.push(event.type);
              if (['tool/call', 'tool/result', 'subagent.started'].includes(event?.type)) scopeAbort.abort();
              return options.onEvent?.(event);
            },
          });
          call.outcome = 'succeeded';
          call.nativeSessionMapped = sessionIdPattern.test(result.nativeSessionId);
          call.nativeSessionContinued = result.nativeSessionContinued === true;
          call.originalSession = !originalSessionId || originalSessionId === result.nativeSessionId;
          return result;
        } catch (error) {
          if (scopeAbort.signal.aborted) { call.outcome = 'ACCEPTANCE_TEXT_SCOPE_CHANGED'; throw new ProviderError(call.outcome, 'Unexpected non-text activity stopped acceptance.'); }
          call.outcome = error instanceof ProviderError && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'NATIVE_ACCEPTANCE_ERROR'; throw error;
        }
      },
    };
    app = await createApp({ dataDirectory, provider, maxConcurrentRuns: 1, capabilityEnvironment: {} });
    const address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
  }
  async function api(route, method = 'GET', body) {
    const response = await fetch(`${base}/api${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))) });
    const value = await response.json(); requireCheck(response.ok, 'ACCEPTANCE_HTTP_FAILED'); return value;
  }
  async function until(predicate) {
    while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await sleep(20); }
    throw new ProviderError('ACCEPTANCE_TIMEOUT', 'Native acceptance observation timed out.');
  }
  async function finish(runId) {
    const run = await until(async () => { const { run } = await api(`/runs/${runId}`); return !['running', 'queued'].includes(run.status) && run; });
    requireCheck(run.status === 'succeeded', /^ACCEPTANCE_[A-Z_]+$/.test(run.error?.code) ? run.error.code : 'ACCEPTANCE_RUN_FAILED'); return run;
  }
  const textOnly = 'This is an isolated text-only acceptance request. Do not call tools, create goals, spawn agents, or submit Worker jobs. ';
  try {
    await fs.mkdir(path.join(dataDirectory, 'harness'), { mode: 0o700 });
    await fs.mkdir(path.join(dataDirectory, 'agent-workspace'), { mode: 0o700 });
    await launch(); await api('/settings', 'PATCH', { model: 'gpt-6-sol', language: 'en' });
    const { conversation } = await api('/conversations', 'POST', { title: 'Isolated native acceptance' });
    const marker = `NATIVE-ACCEPTANCE-${randomUUID()}`;
    const requestId = randomUUID(), content = `${textOnly}Remember this marker and reply only with it: ${marker}`;
    const sent = await api(`/conversations/${conversation.id}/messages`, 'POST', { content, requestId });
    const first = await finish(sent.run.id);
    originalSessionId = first.nativeSessionId;
    let view = await api(`/conversations/${conversation.id}`);
    requireCheck(sessionIdPattern.test(originalSessionId) && view.conversation.nativeSessionId === originalSessionId && calls[0]?.nativeSessionContinued === false, 'ACCEPTANCE_NATIVE_MAPPING');
    requireCheck(view.messages.at(-1).content.includes(marker), 'ACCEPTANCE_FIRST_RESPONSE');
    checks.initialNativeMapping = true;
    const beforeDuplicate = calls.length;
    const duplicate = await api(`/conversations/${conversation.id}/messages`, 'POST', { content, requestId });
    requireCheck(duplicate.run.id === first.id && calls.length === beforeDuplicate, 'ACCEPTANCE_IDEMPOTENCY'); checks.duplicateIdempotency = true;
    const next = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: `${textOnly}Reply only with the marker from our previous native turn.`, requestId: randomUUID() });
    await finish(next.run.id); view = await api(`/conversations/${conversation.id}`);
    requireCheck(view.messages.at(-1).content.includes(marker) && calls[1]?.nativeSessionContinued === true && calls[1]?.originalSession === true, 'ACCEPTANCE_NATIVE_CONTINUATION');
    checks.sameProcessContinuation = true;
    const { artifact } = await api('/artifacts', 'POST', { filename: 'native-acceptance.txt', content: 'Isolated native lifecycle acceptance artifact' });
    await close(); checks.ownedProcessShutdown = report.lifecycle.confirmedProviderCloses === 1;
    await launch();
    const afterRestart = await api(`/conversations/${conversation.id}`);
    requireCheck(afterRestart.conversation.nativeSessionId === originalSessionId, 'ACCEPTANCE_PERSISTED_MAPPING');
    requireCheck((await api(`/artifacts/${artifact.id}/content`)).content === 'Isolated native lifecycle acceptance artifact', 'ACCEPTANCE_ARTIFACT_RESTART');
    checks.persistentArtifact = true;
    const resumed = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: `${textOnly}After this native process restart, reply only with the original marker from native history.`, requestId: randomUUID() });
    const resumedRun = await finish(resumed.run.id); view = await api(`/conversations/${conversation.id}`);
    requireCheck(resumedRun.nativeSessionId === originalSessionId && view.messages.at(-1).content.includes(marker)
      && calls[2]?.nativeSessionContinued === true && calls[2]?.originalSession === true, 'ACCEPTANCE_NATIVE_RESUME');
    checks.persistedNativeResume = true;
    requireCheck(calls.every(call => call.nativeEventTypes.includes('agent/inbox/spliced') && call.nativeEventTypes.includes('assistant/message')), 'ACCEPTANCE_NATIVE_RECEIPTS');
    checks.nativeEventReceipts = true;
    const cancelling = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: `${textOnly}For cancellation acceptance, write a long numbered list of 100 harmless colors and shapes.`, requestId: randomUUID() });
    await until(() => calls[3]?.nativeEventTypes.includes('agent/inbox/spliced'));
    requireCheck(calls[3].outcome === 'started', 'ACCEPTANCE_CANCELLATION_TOO_FAST');
    await api(`/runs/${cancelling.run.id}/cancel`, 'POST', {});
    await until(() => calls[3].outcome !== 'started');
    requireCheck(calls[3].outcome === 'CANCELLED' && (await api(`/runs/${cancelling.run.id}`)).run.status === 'cancelled', 'ACCEPTANCE_CANCELLATION_UNCONFIRMED');
    checks.cancellationAfterNativeAdmission = true;
    await close();
    checks.cancelledOwnedProcessShutdown = report.lifecycle.confirmedProviderCloses === 2;
    requireCheck(checks.ownedProcessShutdown && checks.cancelledOwnedProcessShutdown, 'ACCEPTANCE_SHUTDOWN_UNCONFIRMED');
    requireCheck(!calls.some(call => call.nativeEventTypes.some(type => ['tool/call', 'tool/result', 'subagent.started'].includes(type))), 'ACCEPTANCE_TEXT_SCOPE_CHANGED');
    requireCheck(await sourceFingerprint() === fingerprint, 'ACCEPTANCE_SOURCE_CHANGED');
    report.result = 'passed';
  } catch (error) {
    report.failure = { code: error instanceof ProviderError && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'ACCEPTANCE_FAILED',
      message: 'Native text/session acceptance did not pass every required condition. No automatic paid retry was attempted.' };
  } finally {
    try { await close(); }
    catch { noUnconfirmedShutdown = false; report.result = 'failed'; report.failure = { code: 'ACCEPTANCE_SHUTDOWN_UNCONFIRMED', message: 'Native shutdown was not confirmed. Preserve the isolated workspace and inspect the owned process before cleanup or retry.' }; }
    report.cleanup = noUnconfirmedShutdown ? 'removed' : 'preserved-shutdown-unconfirmed';
    if (noUnconfirmedShutdown) {
      try { await fs.rm(dataDirectory, { recursive: true, force: true }); }
      catch { report.cleanup = 'preserved-cleanup-failed'; report.result = 'failed'; report.failure = { code: 'ACCEPTANCE_CLEANUP_FAILED', message: 'The isolated workspace could not be removed. Inspect it before retrying.' }; }
    }
    report.finishedAt = new Date().toISOString(); report.appCommandCount = calls.length; report.appInputCharacters = inputCharacters;
  }
  return report;
}

/** Reads only exact documented environment entries; never scans credential files. */
export function nativeAcceptanceConfiguration(environment, args) {
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--execute-paid-requests', '--data', '--output'].includes(key) || options.has(key)) throw new Error('Invalid acceptance arguments.');
    if (key === '--execute-paid-requests') options.set(key, true);
    else { const value = args[++index]; if (!value || value.startsWith('--')) throw new Error('Missing acceptance argument.'); options.set(key, value); }
  }
  if (!options.has('--execute-paid-requests') || environment.WORKSPACE_ACCEPTANCE_APPROVED !== '1'
    || environment.WORKSPACE_ACCEPTANCE_NATIVE_PROFILE_REVIEWED !== '1'
    || environment.WORKSPACE_ACCEPTANCE_NATIVE_TEXT_ONLY_PROFILE_VERIFIED !== '1') throw new Error('Explicit native approval and a reviewed tool-free, non-autonomous acceptance profile are required. Tools, Worker and autonomous Goal side-effect paths must already be disabled before boot. Flags do not establish or enforce profile safety or a CNY5 hard cap.');
  const billingPrerequisites = assertRelayAcceptanceBilling(environment);
  const dataDirectory = options.get('--data'), output = options.get('--output');
  if (![dataDirectory, output].every(value => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value)
    || output === dataDirectory || output.startsWith(`${dataDirectory}${path.sep}`)) throw new Error('Use a new absolute data directory and a separate new absolute evidence file.');
  if (environment.DSH_PROVIDER !== 'workspace-fastaitoken' || environment.DSH_MODEL !== 'gpt-6-sol'
    || environment.DSH_API_KEY_ENV !== 'FASTAITOKEN_API_KEY' || !environment.FASTAITOKEN_API_KEY?.trim()
    || environment.DSH_WORKSPACE_BRIDGE !== '1' || !environment.DSH_PROFILE || !environment.DSH_RELAY_PATCH
    || !environment.DSH_REVIEWED_PATCH || !environment.DSH_RECOVERY_PATCH || !environment.DSH_BIN
    || !Object.hasOwn(endpoints, environment.DSH_PROTOCOL) || endpoints[environment.DSH_PROTOCOL] !== environment.DSH_BASE_URL) throw new Error('The exact reviewed native relay, model, bridge, storage and secure environment configuration is required.');
  const providerOptions = {
    apiKey: environment.FASTAITOKEN_API_KEY, dshBin: environment.DSH_BIN, profilePatch: environment.DSH_REVIEWED_PATCH,
    relayPatch: environment.DSH_RELAY_PATCH, recoveryPatch: environment.DSH_RECOVERY_PATCH,
    nativeBridge: true, bridgePatch: environment.DSH_WORKSPACE_BRIDGE_PATCH || '',
    nativeProvider: environment.DSH_PROVIDER, nativeProfile: environment.DSH_PROFILE, nativeModel: environment.DSH_MODEL,
    nativeProtocol: environment.DSH_PROTOCOL, nativeBaseURL: environment.DSH_BASE_URL, nativeApiKeyEnv: environment.DSH_API_KEY_ENV,
    dshHome: path.join(dataDirectory, 'harness'), workspaceDirectory: path.join(dataDirectory, 'agent-workspace'),
  };
  return { dataDirectory, output, providerOptions, billingPrerequisites };
}

async function main() {
  const config = nativeAcceptanceConfiguration(process.env, process.argv.slice(2));
  const preflight = createHarnessProvider(config.providerOptions); // Construction never starts a process.
  requireCheck(preflight.configured, 'ACCEPTANCE_NATIVE_SETUP_REQUIRED');
  await preflight.close();
  await fs.mkdir(path.dirname(config.output), { recursive: true, mode: 0o700 });
  const evidence = await fs.open(config.output, 'wx', 0o600); // Fail before any paid command if the file already exists.
  let report;
  try {
    report = await runNativeProviderAcceptance({ dataDirectory: config.dataDirectory,
      providerFactory: () => createHarnessProvider(config.providerOptions), evidenceKind: 'real-native-provider-fastaitoken' });
    report.authorizationPrerequisites = { operatorAssertedApproval: true, operatorAssertedReviewedNativeProfile: true,
      operatorAssertedToolFreeNonAutonomousProfile: true, profileSideEffectPaths: 'operator-verified-disabled-before-boot',
      totalBudgetCurrency: 'CNY', totalBudgetAmount: 5, hardCapVerification: 'operator-attested-prerequisite-not-independently-verified', hardCapEnforcedByRunner: false };
    report.billingPrerequisites = config.billingPrerequisites;
    await evidence.writeFile(`${JSON.stringify(report, null, 2)}\n`); await evidence.sync();
  } finally { await evidence.close(); }
  console.log(JSON.stringify({ result: report.result, evidenceKind: report.evidenceKind, acceptanceScope: report.acceptanceScope,
    appCommandCount: report.appCommandCount, nativeToolAcceptance: false, profilePermissionAcceptance: false, cleanup: report.cleanup }));
  if (report.result !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Native acceptance was not completed. Check explicit native approval, a verified tool-free/non-autonomous profile with tool/Worker/Goal side-effect paths disabled before boot, a securely configured key, verified CNY5 TOTAL account-side hard cap and billing, reviewed bridge/storage setup, and new --data /absolute/directory --output /absolute/report.json. No credential values are logged.'); process.exitCode = 1;
});
