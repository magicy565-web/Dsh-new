import { statSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DeepSeekHarness } from '../vendor/harness-sdk/index.mjs';
import { ProviderError } from './provider.mjs';
import { readNativeStorageOverlay } from './native-storage.mjs';

const SESSION_ID = /^workspace-session-[a-f0-9]{32}$/;
const MAX_EVENTS = 1000;
const isFile = value => {
  try { return typeof value === 'string' && path.isAbsolute(value) && statSync(value).isFile(); }
  catch { return false; }
};
const failure = (code, message) => new ProviderError(code, message);

const RELAY_ENDPOINTS = Object.freeze({
  'openai-completions': 'https://www.fastaitoken.com/v1',
  'openai-responses': 'https://fastaitoken.com/v1',
  'anthropic-messages': 'https://fastaitoken.com/',
});
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PROFILE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const invalidRoute = () => { throw new TypeError('Invalid reviewed native provider configuration.'); };

function validateRoute({ nativeProvider, nativeProtocol, nativeBaseURL, nativeApiKeyEnv, nativeModel, nativeProfile }) {
  if (typeof nativeModel !== 'string' || !MODEL_ID.test(nativeModel)
    || typeof nativeProfile !== 'string' || !PROFILE_ID.test(nativeProfile)) invalidRoute();
  if (nativeProvider === 'deepseek-official') {
    if (nativeProtocol !== 'deepseek-native' || nativeBaseURL !== 'https://api.deepseek.com'
      || nativeApiKeyEnv !== 'DEEPSEEK_API_KEY') invalidRoute();
  } else if (nativeProvider !== 'workspace-fastaitoken' || !Object.hasOwn(RELAY_ENDPOINTS, nativeProtocol)
    || nativeBaseURL !== RELAY_ENDPOINTS[nativeProtocol] || nativeApiKeyEnv !== 'FASTAITOKEN_API_KEY') invalidRoute();
}

/** Build a credential-free JSON/YAML patch for the existing native llm-pi-ai plugin. */
export function createNativeRelayOverlay({ nativeProvider, nativeProtocol, nativeBaseURL, nativeApiKeyEnv,
  nativeModel, contextWindow, maxTokens }) {
  validateRoute({ nativeProvider, nativeProtocol, nativeBaseURL, nativeApiKeyEnv, nativeModel, nativeProfile: 'sdk' });
  if (nativeProvider === 'deepseek-official' || !Number.isSafeInteger(contextWindow) || contextWindow < 1
    || contextWindow > 10_000_000 || !Number.isSafeInteger(maxTokens) || maxTokens < 1
    || maxTokens > 131_072 || maxTokens > contextWindow) invalidRoute();
  return [{ id: 'llm-pi-ai', config: { providers: { [nativeProvider]: {
    api: nativeProtocol, baseURL: nativeBaseURL, apiKeyEnv: nativeApiKeyEnv,
    models: [{ id: nativeModel, contextWindow, maxTokens, input: ['text'] }],
    retryPolicy: { mode: 'normal', maxRetries: 0 },
  } } } }];
}

function readRelayOverlay(file, route) {
  try {
    const text = readFileSync(file, 'utf8');
    if (text.length > 32_768) invalidRoute();
    const parsed = JSON.parse(text);
    const model = parsed?.[0]?.config?.providers?.[route.nativeProvider]?.models?.[0];
    const expected = createNativeRelayOverlay({ ...route, contextWindow: model?.contextWindow, maxTokens: model?.maxTokens });
    // Keep this deployment entry narrow: no headers, inline credentials, JS, extra
    // providers, tools, permissive flags or native settings changes can enter it.
    if (!isDeepStrictEqual(parsed, expected)) invalidRoute();
    return model;
  } catch { invalidRoute(); }
}

/** Explicit SDK/profile adapter. Construction never starts a process or calls a model. */
export function createHarnessProvider({
  apiKey = '', dshBin = '', profilePatch = '', bridgePatch = '', nativeBridge = false,
  dshHome = path.resolve('data/harness'), workspaceDirectory = path.resolve('data/agent-workspace'),
  nativeProvider = 'deepseek-official', nativeProfile = 'sdk',
  nativeModel = nativeProvider === 'deepseek-official' ? 'deepseek-v4-flash' : '',
  nativeProtocol = nativeProvider === 'deepseek-official' ? 'deepseek-native' : '',
  nativeBaseURL = nativeProvider === 'deepseek-official' ? 'https://api.deepseek.com' : '',
  nativeApiKeyEnv = nativeProvider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : '',
  relayPatch = '', recoveryPatch = '', timeoutMs = 180_000, HarnessClass = DeepSeekHarness,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new TypeError('Invalid native timeout.');
  const route = Object.freeze({ nativeProvider, nativeProfile, nativeModel, nativeProtocol, nativeBaseURL, nativeApiKeyEnv });
  validateRoute(route);
  const relay = nativeProvider !== 'deepseek-official';
  if (!relay && relayPatch) invalidRoute();
  const recoveryStorage = recoveryPatch ? readNativeStorageOverlay(recoveryPatch, dshHome) : null;
  const relayModel = relay && isFile(relayPatch) ? readRelayOverlay(relayPatch, route) : null;
  const configured = typeof apiKey === 'string' && Boolean(apiKey.trim()) && isFile(dshBin)
    && /\.(?:m?js|cjs)$/.test(dshBin) && isFile(profilePatch) && (!relay || Boolean(relayModel))
    && (!recoveryPatch || isFile(recoveryPatch))
    && (!bridgePatch || (nativeBridge && isFile(bridgePatch)))
    && path.isAbsolute(dshHome) && path.isAbsolute(workspaceDirectory);
  const fingerprint = () => {
    const hash = createHash('sha256');
    hash.update(JSON.stringify({ kind: 'deepseek-harness', ...route, nativeBridge, workspaceDirectory, dshHome, recoveryStorage }));
    for (const file of [dshBin, profilePatch, ...(relayPatch ? [relayPatch] : []), ...(bridgePatch ? [bridgePatch] : []), ...(recoveryPatch ? [recoveryPatch] : [])]) {
      const content = readFileSync(file);
      hash.update(JSON.stringify([file, content.length])); hash.update(content);
    }
    hash.update(readFileSync(new URL('./harness-provider.mjs', import.meta.url)));
    if (nativeBridge) hash.update(readFileSync(new URL('./native-bridge.mjs', import.meta.url)));
    return hash.digest('hex');
  };
  let permissionFingerprint = null;
  if (configured) { try { permissionFingerprint = fingerprint(); } catch { /* Setup is rechecked before execution. */ } }
  let policyChanged = false;
  let current;
  let active = false;
  let closed = false;
  let shutdownFailed = false;
  const sessions = new Set();

  async function release(owned) {
    if (!owned) return;
    owned.closing ??= Promise.resolve().then(() => owned.harness.close());
    try { await owned.closing; }
    catch {
      shutdownFailed = true;
      throw failure('HARNESS_SHUTDOWN', 'The native Harness did not confirm shutdown. Restart the server before starting another run.');
    }
    if (current === owned) { current = undefined; sessions.clear(); }
  }

  const provider = {
    configured,
    permissionFingerprint,
    containsCredential(value) { return Boolean(apiKey && typeof value === 'string' && value.includes(apiKey)); },
    kind: 'deepseek-harness',
    provider: relay ? 'fastaitoken' : 'deepseek',
    model: nativeModel,
    models: [nativeModel],
    recoveryStorage: recoveryStorage ? Object.freeze({ configured: true, compression: recoveryStorage.compression }) : Object.freeze({ configured: false }),
    route: Object.freeze({ provider: nativeProvider, protocol: nativeProtocol, endpoint: nativeBaseURL, profile: nativeProfile }),
    setupMessage: relay ? 'Native relay requires an explicit model, approved credential reference, DSH_BIN, DSH_REVIEWED_PATCH and matching DSH_RELAY_PATCH. Your work is saved.' : 'Native Harness requires DEEPSEEK_API_KEY, DSH_BIN, and DSH_REVIEWED_PATCH. Your work is saved.',
    capabilities: ['official-harness-sdk', 'native-session-events', 'native-session-continuation',
      ...(nativeBridge ? ['native-persisted-session-resume'] : []),
      ...(relay ? ['native-custom-provider-route'] : []),
      ...(recoveryStorage ? ['native-contained-recovery-storage'] : []),
      'profile-defined-tools', 'owned-process-cancellation'],
    limitations: [
      'Tools, MCP, native Goal and worker permissions are owned by the reviewed Harness profile; Workspace grants none.',
      'Native approval replies are not exposed by this SDK adapter. The profile must fail closed or use an independently reviewed interaction adapter.',
      'Stopping a run closes its owned native runtime. Remote-worker cancellation still needs independent acknowledgment.',
      ...(nativeBridge ? ['Persisted resume requires the reviewed Workspace bridge overlay and the same native persistence directory.']
        : ['The stock SDK can continue live sessions only. Restarted or cancelled sessions need the opt-in native resume bridge.']),
      'Native model execution and remote workers have not been verified with live credentials.',
      ...(relay ? ['Relay protocol support is documented and fixture-tested, not live verified; model, token group, budget, profile and egress review remain required.'] : []),
    ],
    async close() {
      closed = true;
      await release(current);
    },
    async complete({ messages, signal, maxTokens = 4096, json = false, nativeSessionId,
      onEvent, onApproval, runId, conversationId } = {}) {
      if (!configured) throw failure('SETUP_REQUIRED', provider.setupMessage);
      if (shutdownFailed || active) throw failure('RUNTIME_BUSY', 'The native Harness is running or has not confirmed shutdown.');
      if (policyChanged) throw failure('NATIVE_POLICY_CHANGED', 'The reviewed native launch files changed. Restart and reapprove pending work before execution.');
      if (closed) throw failure('RUNTIME_CLOSED', 'The native provider is closed. Restart the server to continue.');
      if (signal?.aborted) throw failure('CANCELLED', 'The request was stopped.');
      if (onApproval !== undefined) throw failure('NATIVE_APPROVAL_UNSUPPORTED', 'The native SDK has no approval-response method. Review the native interaction policy before running.');
      if (!Array.isArray(messages) || messages.length > 1024 || messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role)
        || typeof message.content !== 'string') || messages.reduce((n, m) => n + m.content.length, 0) > 200_000) {
        throw failure('INVALID_INPUT', 'Native input must contain bounded text messages with supported roles.');
      }
      if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 131_072) throw failure('INVALID_INPUT', 'The native output limit is invalid.');
      if (relayModel && maxTokens > relayModel.maxTokens) throw failure('INVALID_INPUT', 'The native output limit exceeds the reviewed relay model limit.');
      if (nativeSessionId !== undefined && (typeof nativeSessionId !== 'string' || !SESSION_ID.test(nativeSessionId))) throw failure('INVALID_NATIVE_SESSION', 'The native session identity is invalid.');
      const continuing = nativeSessionId !== undefined;
      if (continuing && !sessions.has(nativeSessionId) && !nativeBridge) {
        throw failure('NATIVE_RESUME_UNSUPPORTED', 'This stored native session is no longer live. Enable the reviewed native resume bridge to continue its native history.');
      }
      if (current && current.maxTokens !== maxTokens) {
        throw failure('NATIVE_CONFIGURATION_CHANGED', 'The SDK output limit is fixed for its runtime. Keep the same limit or restart with the reviewed native resume bridge.');
      }
      let observedFingerprint;
      try { observedFingerprint = fingerprint(); } catch { observedFingerprint = null; }
      if (!permissionFingerprint || observedFingerprint !== permissionFingerprint) {
        policyChanged = true;
        await release(current);
        throw failure('NATIVE_POLICY_CHANGED', 'The reviewed native launch files changed. Restart and reapprove pending work before execution.');
      }
      active = true;
      const id = nativeSessionId ?? `workspace-session-${randomUUID().replaceAll('-', '')}`;
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const trace = [];
      let acceptingEvents = true;
      let owned = current;
      let succeeded = false;
      const emit = metadata => {
        if (!acceptingEvents || combined.aborted || closed || trace.length >= MAX_EVENTS) return;
        const event = Object.freeze({ ...metadata, source: 'deepseek-harness', nativeSessionId: id,
          ...(typeof runId === 'string' ? { runId: runId.slice(0, 128) } : {}),
          ...(typeof conversationId === 'string' ? { conversationId: conversationId.slice(0, 128) } : {}) });
        if (apiKey && JSON.stringify(event).includes(apiKey)) return;
        trace.push(event);
        if (typeof onEvent !== 'function') return;
        try {
          void Promise.resolve(onEvent(event)).catch(() => {});
        } catch { /* An observer cannot break native ownership or suppress another event. */ }
      };
      const abort = () => { acceptingEvents = false; void release(owned).catch(() => {}); };
      combined.addEventListener('abort', abort, { once: true });
      try {
        if (!owned) {
          const env = { PATH: process.env.PATH, HOME: dshHome, LANG: process.env.LANG || 'en_US.UTF-8',
            [nativeApiKeyEnv]: apiKey, DSH_HOME: dshHome };
          let harness;
          try {
            harness = new HarnessClass({ dshBin, profile: nativeProfile, patches: [profilePatch, ...(relayPatch ? [relayPatch] : []), ...(bridgePatch ? [bridgePatch] : []), ...(recoveryPatch ? [recoveryPatch] : [])],
              dshHome, cwd: workspaceDirectory, processCwd: path.dirname(dshBin), env,
              provider: nativeProvider, model: nativeModel, maxTokens,
              initializeTimeoutMs: 20_000, shutdownTimeoutMs: 1_000, disposeEofGraceMs: 2_000, disposeGraceMs: 2_000 });
          } catch { throw failure('HARNESS_SETUP', 'The native Harness launch settings are invalid. Check its executable and reviewed profile.'); }
          owned = { harness, maxTokens, closing: null };
          current = owned;
        }
        if (combined.aborted || closed) throw new Error('stopped');
        if (nativeBridge) {
          await owned.harness.start();
          if (combined.aborted || closed) throw new Error('stopped');
          let opened;
          try {
            opened = await owned.harness.client.request('workspace/session/open', { version: 1, sessionId: id,
              mode: continuing ? 'resume' : 'create' });
          } catch { throw failure('NATIVE_BRIDGE_ERROR', 'The reviewed native bridge could not open this session. Check bridge installation, persistence ownership, workspace scope, and saved history.'); }
          if (opened?.version !== 1 || opened.sessionId !== id || opened.resumed !== continuing) {
            throw failure('NATIVE_BRIDGE_PROTOCOL', 'The native bridge returned an incompatible session mapping.');
          }
        }
        if (combined.aborted || closed) throw new Error('stopped');
        emit({ type: 'native.session', continued: continuing });
        // The native session already owns earlier turns. Replaying them as a new
        // user prompt would duplicate context and could repeat earlier actions.
        const supplied = continuing ? messages.filter(message => message.role === 'system')
          .concat(messages.filter(message => message.role === 'user').slice(-1)) : messages;
        const input = [
          'The following is input from the local Workspace application. Follow the configured native permission policy. Never claim external action without a successful native tool result or verified application connector receipt.',
          continuing ? 'Continue the existing native session. Prior conversation turns are already in its native history.' : '',
          json ? 'Return one valid JSON object as the final answer, without markdown.' : '',
          ...supplied.map(message => `${message.role.toUpperCase()}:\n${message.content}`),
        ].filter(Boolean).join('\n\n');
        const descendants = new Set([id]);
        const result = await owned.harness.run(input, { sessionId: id, onNotification(notification) {
          if (notification?.method === 'subagent.started' && descendants.has(notification.params?.parentSessionId)
            && typeof notification.params?.childSessionId === 'string') descendants.add(notification.params.childSessionId);
          const params = notification?.params;
          const session = params?.sessionId ?? params?.parentSessionId;
          if (!descendants.has(session)) return;
          const type = notification.method === 'session.event' ? params?.event?.type : notification.method;
          // Only discriminants cross into app state; never tool inputs, outputs,
          // hidden reasoning, credentials, or arbitrary notification payloads.
          if (typeof type === 'string' && /^[A-Za-z0-9_./:-]{1,120}$/.test(type)) emit({ type });
        } });
        if (combined.aborted || closed || owned.closing) throw new Error('stopped');
        if (result.sessionId !== id) throw failure('NATIVE_SESSION_MISMATCH', 'The native response did not belong to the requested session.');
        if (typeof result.finalResponse !== 'string' || !result.finalResponse.trim()) throw failure('EMPTY_RESPONSE', 'The native Harness finished without an assistant response.');
        if (apiKey && result.finalResponse.includes(apiKey)) throw failure('CREDENTIAL_IN_RESPONSE', 'The native response contained a credential and was withheld.');
        sessions.add(id);
        succeeded = true;
        return { content: result.finalResponse.slice(0, 80_000), usage: null,
          nativeSessionId: id, nativeSessionContinued: continuing, nativeEvents: trace, runtime: 'deepseek-harness' };
      } catch (error) {
        if (signal?.aborted || closed) throw failure('CANCELLED', 'The native Harness run was stopped.');
        if (timeout.aborted) throw failure('PROVIDER_TIMEOUT', 'The native Harness exceeded the run time limit and was stopped.');
        if (error instanceof ProviderError) throw error;
        throw failure('HARNESS_ERROR', 'The native Harness could not finish the run. Check its dependencies, reviewed profile, and provider configuration.');
      } finally {
        acceptingEvents = false;
        combined.removeEventListener('abort', abort);
        try {
          if (!succeeded || combined.aborted || closed) await release(owned);
        } finally { active = false; }
      }
    },
  };
  return provider;
}
