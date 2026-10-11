import path from 'node:path';
import { createNativeMuseBinding, quarantineNativeMuse } from './muse-worker-native.mjs';
import { MuseWorkerError } from './muse-worker-api.mjs';
import { validateMuseSessionReceipts } from './muse-worker-session.mjs';
import { validateMuseConversationDelegations } from './muse-conversation-delegation.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { openStore } from './store.mjs';
import { createArtifactService } from './artifacts.mjs';
import { createPersonalWorkerService, validateWorkerState } from './personal-worker.mjs';
import { workerConfigFromEnvironment } from './worker-identity.mjs';
import { createDotMcp } from './dot-mcp.mjs';
import { createWorkspaceDotTasks, validateWorkspaceDotTasks } from './workspace-dot-tasks.mjs';
import { workerArtifactOwner, canReadWorkerArtifact } from './worker-artifact-access.mjs';
import { createCapabilityService, capabilityPayloadHash } from './capabilities.mjs';
import { prepareNativeResults, createNativeResultBinding } from './workspace-native-results.mjs';
import { createWorkspaceBusinessView } from './workspace-business-view.mjs';
import { readRecoveryStatus } from './recovery-status.mjs';
import { createWorkspaceRecords, ApiError } from './runtime.mjs';
import { looksLikeCredential } from './security.mjs';
import { normalizeWorkspacePluginConfig, pluginConfigurationHash, pluginFail, pluginId, pluginFields } from './workspace-plugin-config.mjs';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
const phases = new Set(['active', 'paused', 'draining', 'detached']);
const nextEpoch = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) pluginFail('WORKSPACE_PLUGIN_EPOCH', 'The authorization epoch cannot advance safely.');
  return value + 1;
};
function validateLifecycle(value, scopeId) {
  if (!value) return;
  if (value.version !== 1) pluginFail('WORKSPACE_PLUGIN_VERSION', 'Unsupported plugin state version; preserve the current business state.');
  if (value.nativeSubmissions !== undefined && (!Array.isArray(value.nativeSubmissions) || value.nativeSubmissions.length > 1000
    || value.nativeSubmissions.some(i => !pluginId(i.subject) || !pluginId(i.nativeAgentId) || !pluginId(i.requestId)
      || !pluginId(i.taskKey) || !/^[a-f0-9]{64}$/.test(i.hash) || !/^[a-f0-9]{64}$/.test(i.reviewHash)
      || i.hash !== capabilityPayloadHash({ taskKey: i.taskKey, reviewHash: i.reviewHash })
      || !Number.isSafeInteger(i.approvedAt) || i.jobId !== null && !pluginId(i.jobId))
    || new Set(value.nativeSubmissions.map(i => JSON.stringify([i.subject, i.requestId]))).size !== value.nativeSubmissions.length)) {
    pluginFail('WORKSPACE_PLUGIN_STATE', 'Native submission approvals are invalid; preserve the saved intent.');
  }
  if (value.scopeId !== scopeId) pluginFail('WORKSPACE_PLUGIN_SCOPE', 'This business store belongs to a different plugin scope.');
  if (!phases.has(value.phase) || !Number.isSafeInteger(value.epoch) || value.epoch < 1
    || !/^[a-f0-9]{64}$/.test(value.configurationHash) || !Array.isArray(value.controls) || value.controls.length > 256
    || value.controls.some(r => !pluginId(r.requestId) || !/^[a-f0-9]{64}$/.test(r.hash))) pluginFail('WORKSPACE_PLUGIN_STATE', 'Plugin lifecycle state is invalid; it has not been reset.');
}
function quarantine(state, now, reason) {
  quarantineNativeMuse(state, reason);
  if (!state.personalWorkers) return;
  validateWorkerState(state.personalWorkers);
  for (const worker of state.personalWorkers.workers) for (const connection of worker.connections) {
    if (connection.revokedAt) continue;
    Object.assign(connection, { authorizationEpoch: nextEpoch(connection.authorizationEpoch ?? 1), pausedAt: now,
      lastAuthenticatedAt: null, pluginPauseReason: reason });
  }
  for (const job of state.personalWorkers.delegations) if (!terminal.has(job.state)) {
    // Even fence=0 can represent a submission whose response was lost. This
    // business projection cannot cancel, retry or settle the native execution.
    Object.assign(job, { state: 'uncertain', reconciliationRequired: true, pluginPauseReason: reason });
  }
  validateWorkerState(state.personalWorkers);
}

/** Business services only: no createApp/createRuntime, HTTP listener, timer,
 * provider client, Harness subprocess, DAG or native execution state machine.
 * Host controls are deliberately separate from model-callable tool handlers.
 */
export async function openWorkspacePluginService({ config: input, workerConfiguration, nativeResults = [], dotConfiguration = { enabled: false }, dotOwnerSubject, dotTransport, now = Date.now } = {}) {
  const config = normalizeWorkspacePluginConfig(input);
  if (!config.enabled) return Object.freeze({ enabled: false, status: () => ({ phase: 'disabled', nativeExecutionVerified: false }), close: async () => ({ phase: 'disabled', writerReleased: true }) });
  const configuration = workerConfiguration ?? await workerConfigFromEnvironment({ WORKSPACE_WORKERS_FILE: config.workerConfigFile });
  if (dotConfiguration.enabled === true && (!pluginId(dotOwnerSubject) || !config.operators.some(o => o.subject === dotOwnerSubject)
    || configuration.admissions?.filter(a => a.provider === 'dot' && a.subject === dotOwnerSubject).length !== 1)) {
    pluginFail('WORKSPACE_DOT_OWNER_REQUIRED', 'Configure one explicit reviewed platform dot owner independently of task requesters.');
  }
  if (configuration.enabled !== true || configuration.admissions?.some(a => !config.operators.some(o => o.subject === a.subject))) pluginFail('WORKSPACE_PLUGIN_CONFIG', 'Every admitted Worker needs a reviewed native-to-business ownership binding.');
  const nativeSpecs = prepareNativeResults(nativeResults, config, configuration);
  const reviewedConfig = dotConfiguration.enabled === true ? { ...config, dotOwnerSubject, dotConfigurationHash: capabilityPayloadHash(dotConfiguration) } : config;
  const fingerprintFor = reviewed => pluginConfigurationHash(nativeSpecs.length ? { ...reviewed,
    nativeResultContracts: nativeSpecs.map(s => ({ actor: s.actor, contractHash: s.contract.contractHash,
      ...(s.submitNative ? { nativeDispatchAvailable: true } : {}) })) } : reviewed, configuration);
  let fingerprint = fingerprintFor(reviewedConfig);
  const store = await openStore(config.dataDirectory), context = new AsyncLocalStorage(), pending = new Set();
  let artifacts, workers, capabilities, recovery, dot, dotTasks, dotStarted = false, resultBindings = [], initializing = true, stopping = false, finalizing, closeResult, museRest, museRestOptions, refreshingMuse;
  let resolveClosed, rejectClosed;
  const whenClosed = new Promise((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
  // A caller may use close() alone; retain errors without unhandled rejection.
  void whenClosed.catch(() => {});
  const snapshot = () => store.read().workspacePlugin;
  function authorize(state, token) {
    const lifecycle = state.workspacePlugin;
    if (!token || stopping || lifecycle.epoch !== token.epoch || lifecycle.configurationHash !== fingerprint) pluginFail('WORKSPACE_PLUGIN_STALE', 'The plugin scope or authorization changed; old tool handles cannot execute.');
    if (token.active && lifecycle.phase !== 'active') pluginFail('WORKSPACE_PLUGIN_PAUSED', 'This plugin scope is not accepting work.');
    if (token.subject && !config.operators.some(o => o.subject === token.subject && o.nativeAgentId === token.nativeAgentId)) pluginFail('WORKSPACE_PLUGIN_OWNER', 'The native Agent is not bound to this Workspace owner.');
  }
  const guardedStore = { ...store,
    update(callback) {
      const token = context.getStore(), setup = initializing;
      return store.update(state => { if (!setup) authorize(state, token); return callback(state); });
    },
  };
  try {
    const initial = store.read(); validateLifecycle(initial.workspacePlugin, config.scopeId);
    validateMuseConversationDelegations(initial, { operators: config.operators });
    validateWorkspaceDotTasks(initial.workspaceDotTasks);
    validateMuseSessionReceipts(initial.workspaceMuseSessionReceipts, { operators: config.operators, orders: initial.workerOrders ?? [],
      messages: initial.messages, conversations: initial.conversations });
    recovery = await readRecoveryStatus(config.dataDirectory, 'deepseek-harness');
    if (initial.personalWorkers) validateWorkerState(initial.personalWorkers);
    artifacts = await createArtifactService({ store: guardedStore, directory: path.join(config.dataDirectory, 'artifacts'), maxPendingOperations: config.maxPendingOperations });
    workers = await createPersonalWorkerService({ store: guardedStore, artifacts, configuration,
      now, dotMcpEnabled: dotConfiguration.enabled === true, requireDotConversation: dotConfiguration.enabled === true,
      onUpdate: state => dot?.reconcile(state),
      authorizeSubject: subject => config.operators.some(o => o.subject === subject) });
    resultBindings = nativeSpecs.map(spec => createNativeResultBinding({ spec, store: guardedStore, artifacts, now, getCapabilities: () => capabilities }));
    capabilities = await createCapabilityService({ store: guardedStore, environment: {},
      adapters: Object.fromEntries(resultBindings.map(b => [b.adapterName, b.adapter])) });
    await store.update(state => {
      const previous = state.workspacePlugin;
      if (previous || state.personalWorkers?.workers.length) quarantine(state, now(), previous?.configurationHash === fingerprint ? 'plugin-reattach' : 'plugin-configuration-review');
      state.workspacePlugin = { version: 1, scopeId: config.scopeId, epoch: previous ? nextEpoch(previous.epoch) : 1,
        configurationHash: fingerprint, previousConfigurationHash: previous?.configurationHash ?? null,
        phase: previous || state.personalWorkers?.workers.length ? 'paused' : 'active',
        reason: previous ? previous.configurationHash === fingerprint ? 'reattach-requires-review' : 'configuration-changed' : 'initial-attach',
        controls: previous?.controls ?? [], attachedAt: now(), detachedAt: null };
      if (previous?.nativeSubmissions) state.workspacePlugin.nativeSubmissions = previous.nativeSubmissions;
    });
    initializing = false;
    // The transport shares this writer and Worker registry. Its host starts and
    // disposes event delivery; it never starts another Workspace runtime.
    const dotStore = { ...store, update: callback => run({ epoch: snapshot().epoch, active: false }, () => guardedStore.update(callback)) };
    dot = createDotMcp({ store: dotStore, workers, config: dotConfiguration, now, transport: dotTransport });
    if (dot.enabled) dotTasks = createWorkspaceDotTasks({ store: guardedStore, workers, artifacts, workerSubject: dotOwnerSubject, now });
  } catch (error) {
    await Promise.allSettled([dot?.close(), capabilities?.close(), workers?.close(), artifacts?.close()]);
    await store.close(); throw error;
  }

  function status() {
    const state = store.read(), lifecycle = state.workspacePlugin;
    const { nativeSubmissions, ...publicLifecycle } = lifecycle;
    return { ...structuredClone(publicLifecycle), configurationHash: fingerprint, pendingOperations: pending.size,
      unfinishedDelegations: (state.personalWorkers?.delegations ?? []).filter(j => !terminal.has(j.state)).length,
      reconciliationRequired: (state.personalWorkers?.delegations ?? []).some(j => j.reconciliationRequired && !terminal.has(j.state))
        || (lifecycle.nativeSubmissions ?? []).some(i => !i.jobId),
      nativeExecutionVerified: false, ownsExecutionRuntime: false, ownsHttpListener: false };
  }
  function run(token, callback) {
    authorize(store.read(), token);
    if (pending.size >= config.maxPendingOperations) pluginFail('WORKSPACE_PLUGIN_BUSY', 'The plugin operation limit has been reached.');
    const task = context.run(token, async () => { authorize(store.read(), token); const result = await callback(); authorize(store.read(), token); return result; });
    pending.add(task); void task.finally(() => pending.delete(task)).catch(() => {}); return task;
  }
  function attachMuseRest(options) {
    if (museRest || refreshingMuse) pluginFail('WORKSPACE_MUSE_ALREADY_MOUNTED', 'Withdraw the original Muse binding before remounting.');
    if (configuration.admissions.some(admission => admission.agentId === options.config?.workerId))
      pluginFail('WORKSPACE_MUSE_IDENTITY_CONFLICT', 'Muse REST cannot overwrite an original native Worker identity.');
    const epoch = snapshot().epoch;
    const binding = createNativeMuseBinding({ ...options, operators: config.operators,
      store: guardedStore, artifacts,
      run: (callback, operation) => run({ ...options.actor, epoch, active: operation.active }, callback) });
    museRestOptions = options; museRest = binding;
    return binding;
  }
  async function refreshMuseRest(review) {
    if (!museRestOptions) return;
    pluginFields(review, ['expectedEpoch', 'configurationHash']);
    if (stopping || refreshingMuse || review.expectedEpoch !== snapshot().epoch || review.configurationHash !== fingerprint)
      pluginFail('WORKSPACE_MUSE_STALE_REVIEW', 'Review the current original Host epoch before remounting Muse.');
    refreshingMuse = true;
    const original = museRest; museRest = undefined;
    try { await original?.close(); }
    finally { refreshingMuse = false; }
    const replacement = attachMuseRest(museRestOptions);
    try { await replacement.initialize(); }
    catch (error) { museRest = undefined; await replacement.close(); throw error; }
  }
  const businessSnapshot = createWorkspaceBusinessView({ store, capabilities, nativeSpecs, status, recovery, now,
    dotStatus: dot.enabled ? () => ({ enabled: true, worker: workers.view(dotOwnerSubject).worker, canDelegate: workers.view(dotOwnerSubject).canDelegate }) : undefined });
  const records = createWorkspaceRecords({ store: guardedStore, models: [], validateMemory: content => {
    if (looksLikeCredential(content)) throw new ApiError(400, 'RAW_CREDENTIAL_REJECTED', 'Use reviewed server-side credential references.');
    capabilities.assertSafeMemory(content);
  } });
  /** Trusted frontend binding; pausing dispatch preserves local enterprise editing. */
  function bindFrontend(actor) {
    pluginFields(actor, ['subject', 'nativeAgentId']);
    if (!pluginId(actor.subject) || !pluginId(actor.nativeAgentId)) pluginFail('WORKSPACE_PLUGIN_OWNER', 'An explicit reviewed owner and native Agent are required.');
    const token = Object.freeze({ ...actor, epoch: snapshot().epoch, active: false });
    authorize(store.read(), token);
    const ownedArtifact = (id, state = store.read()) => {
      const item = state.artifacts.find(a => a.id === id);
      if (!item || !canReadWorkerArtifact(state, item, actor.subject)) pluginFail('WORKSPACE_PLUGIN_FILE', 'This file is not available to the current owner.');
      return item;
    };
    const sharedArtifact = (id, state) => {
      const item = ownedArtifact(id, state);
      if (workerArtifactOwner(state, item) !== null) throw new ApiError(403, 'WORKER_FILE_IMMUTABLE', 'Original Worker deliverables and their versions cannot be edited or deleted here.');
    };
    const sharedCreate = (body, state) => {
      if (body.metadata && ['museOwnerSubject', 'museNativeAgentId', 'museTaskRef', 'museWorkerId', 'workerOrderId'].some(key => Object.hasOwn(body.metadata, key)))
        throw new ApiError(400, 'RESERVED_ARTIFACT_OWNER', 'Muse delivery ownership is assigned only by the trusted native Host.');
      if (typeof body.requestId === 'string' && /^(?:muse-upload-|worker-delivery-)/.test(body.requestId))
        throw new ApiError(400, 'RESERVED_REQUEST_ID', 'Muse delivery request identities are reserved.');
      if (typeof body.requestId === 'string' && body.requestId.startsWith('worker-file-')) throw new ApiError(400, 'RESERVED_REQUEST_ID', 'Worker upload identities are reserved for original deliveries.');
      const previous = state.artifacts.find(a => a.requestId && a.requestId === body.requestId);
      if (previous) sharedArtifact(previous.id, state);
    };
    return Object.freeze({ snapshot: access => run(token, () => businessSnapshot(actor, access)),
      file: (id, options, content = false) => run(token, () => {
        ownedArtifact(id); return content ? artifacts.read(id, options) : artifacts.get(id);
      }),
      download: (id, options) => run(token, () => { ownedArtifact(id); return artifacts.download(id, options); }),
      updateSettings: body => run(token, () => records.updateSettings(body)),
      createMemory: body => run(token, () => records.createMemory(body)),
      updateMemory: (id, body) => run(token, () => records.updateMemory(id, body)),
      deleteMemory: id => run(token, () => records.deleteMemory(id)),
      createArtifact: body => run(token, () => artifacts.create(body, { check: state => sharedCreate(body, state) })),
      updateArtifact: (id, body) => run(token, () => artifacts.update(id, body, { check: state => sharedArtifact(id, state) })),
      deleteArtifact: id => run(token, () => artifacts.delete(id, { check: state => sharedArtifact(id, state) })),
    });
  }
  /** Dispatch approval retains a durable intent before calling the native execution owner. */
  function bindNativeTasks(actor) {
    pluginFields(actor, ['subject', 'nativeAgentId']);
    if (!pluginId(actor.subject) || !pluginId(actor.nativeAgentId)) pluginFail('WORKSPACE_PLUGIN_OWNER', 'An explicit reviewed owner and native Agent are required.');
    const token = Object.freeze({ ...actor, epoch: snapshot().epoch, active: true });
    const readToken = Object.freeze({ ...token, active: false });
    authorize(store.read(), readToken);
    const spec = nativeSpecs.find(s => s.actor.subject === actor.subject && s.actor.nativeAgentId === actor.nativeAgentId);
    const intents = state => (state.workspacePlugin.nativeSubmissions ?? []).filter(i => i.subject === actor.subject);
    return Object.freeze({
      catalog: () => run(readToken, () => {
        const view = workers.view(actor.subject), connection = view.worker?.connection;
        const available = Boolean(spec?.submitNative);
        const pendingIntent = intents(store.read()).some(i => !i.jobId);
        const nativeSubmitBlockers = [
          ...(!available ? ['dispatch_unavailable'] : []),
          ...(snapshot().phase !== 'active' ? ['plugin_paused'] : []),
          ...(connection?.transport !== 'muse-native' ? ['connection_unavailable'] : []),
          ...(!connection?.authenticatedRecently ? ['authentication_required'] : []),
          ...(connection?.pausedAt ? ['connection_paused'] : []),
          ...(connection?.drainingAt ? ['connection_draining'] : []),
          ...(pendingIntent ? ['submission_uncertain'] : []),
          ...(view.delegations.some(j => !terminal.has(j.state)) ? ['task_unfinished'] : []),
        ];
        return { plugin: status(), connectionActionsAllowed: snapshot().phase === 'active',
          nativeDispatchAvailable: available,
          canSubmitNative: nativeSubmitBlockers.length === 0, nativeSubmitBlockers,
          nativeTasks: spec ? Object.keys(spec.contract.configuration.workflows).map(taskKey => ({
            ...spec.contract.review(taskKey), reviewHash: spec.contract.reviewHash(taskKey) })) : [],
          submissionReviewRequired: pendingIntent };
      }),
      submit: body => run(readToken, async () => {
        pluginFields(body, ['taskKey', 'requestId', 'expectedReviewHash', 'confirmed']);
        if (!spec?.submitNative) pluginFail('WORKSPACE_NATIVE_DISPATCH_REQUIRED', 'The trusted native task dispatcher is not configured.');
        if (!pluginId(body.requestId) || body.confirmed !== true || body.expectedReviewHash !== spec.contract.reviewHash(body.taskKey)) {
          pluginFail('WORKSPACE_NATIVE_TASK_REVIEW', 'Confirm the exact task catalog and current review hash.');
        }
        const hash = capabilityPayloadHash({ taskKey: body.taskKey, reviewHash: body.expectedReviewHash });
        let duplicate = false;
        await guardedStore.update(state => {
          const previous = intents(state).find(i => i.requestId === body.requestId);
          if (previous) {
            if (previous.hash !== hash) pluginFail('WORKSPACE_PLUGIN_IDEMPOTENCY', 'The requestId already identifies another native task approval.');
            duplicate = true; return;
          }
          authorize(state, token);
          const view = workers.view(actor.subject), connection = view.worker?.connection;
          if (intents(state).some(i => !i.jobId) || view.delegations.some(j => !terminal.has(j.state))) {
            pluginFail('WORKSPACE_NATIVE_TASK_UNFINISHED', 'Keep the unfinished delegation or uncertain submission; do not dispatch a replacement.');
          }
          if (!connection || connection.transport !== 'muse-native' || !connection.authenticatedRecently
            || connection.pausedAt || connection.drainingAt) pluginFail('WORKSPACE_NATIVE_AUTH_REQUIRED', 'The original Muse connection needs fresh native authentication.');
          const rows = state.workspacePlugin.nativeSubmissions ??= [];
          if (rows.length >= 1000) pluginFail('WORKSPACE_PLUGIN_CAPACITY', 'Review native submission history before admitting more tasks.');
          rows.push({ subject: actor.subject, nativeAgentId: actor.nativeAgentId, requestId: body.requestId,
            taskKey: body.taskKey, hash, reviewHash: body.expectedReviewHash, approvedAt: now(), jobId: null });
        });
        if (!duplicate) {
          authorize(store.read(), token);
          // No caller abort or retry: the native service owns persistence, uncertainty and polling.
          const job = await spec.submitNative({ taskKey: body.taskKey, review: spec.contract.review(body.taskKey) });
          if (!pluginId(job?.id) || job.sessionId !== actor.nativeAgentId || job.submission?.taskKey !== body.taskKey
            || job.submission.query !== spec.contract.review(body.taskKey).workflow.query
            || job.submission.acceptance !== spec.contract.review(body.taskKey).workflow.acceptance) {
            pluginFail('WORKSPACE_NATIVE_DISPATCH_SCOPE', 'The native submission does not cover the exact approved Agent and task.');
          }
          await guardedStore.update(state => {
            workers.admitNative(state, { binding: spec.contract.binding, jobId: job.id, taskKey: body.taskKey,
              requestId: body.requestId, reviewHash: body.expectedReviewHash, deadlineAt: job.submission.deadlineAt });
            const intent = intents(state).find(i => i.requestId === body.requestId);
            intent.jobId = job.id;
            if (job.stage === 'prepared' || job.localError) {
              const worker = state.personalWorkers.workers.find(w => w.subject === actor.subject);
              const projection = state.personalWorkers.delegations.find(j => j.workerId === worker.id && j.nativeJobId === job.id);
              projection.state = 'uncertain';
            }
          });
        }
        return { submission: structuredClone(intents(store.read()).find(i => i.requestId === body.requestId)), duplicate };
      }),
    });
  }
  // Trusted Host use only. A model must never choose subject/nativeAgentId or
  // obtain a new handle itself; the native tool binding supplies verified scope.
  function bindActor({ subject, nativeAgentId }) {
    if (!pluginId(subject) || !pluginId(nativeAgentId)) pluginFail('WORKSPACE_PLUGIN_OWNER', 'An explicit native Agent and Workspace owner binding is required.');
    const token = Object.freeze({ subject, nativeAgentId, epoch: snapshot().epoch, active: true });
    const readToken = Object.freeze({ ...token, active: false });
    authorize(store.read(), readToken);
    return Object.freeze({
      subject, nativeAgentId, epoch: token.epoch,
      view: () => run(readToken, () => workers.view(subject)),
      register: body => run(token, () => workers.register(subject, body)),
      disconnect: body => run(token, () => workers.disconnect(subject, body)),
      delegate: body => run(token, () => workers.delegate(subject, body)),
      pauseConnection: body => run(token, () => workers.pause(subject, body)),
      revokeConnection: body => run(token, () => workers.revoke(subject, body)),
      resumeConnection: body => run(token, () => workers.resume(subject, body)),
      async download(request) {
        pluginFields(request, ['artifactId', 'version', 'sha256']);
        const { artifactId, version, sha256 } = request;
        if (!pluginId(artifactId) || !Number.isSafeInteger(version) || version < 1 || !/^[a-f0-9]{64}$/.test(sha256)) pluginFail('WORKSPACE_PLUGIN_FILE', 'Use an exact saved artifact/version/hash reference.');
        return run(readToken, async () => {
          const state = store.read(), item = state.artifacts.find(a => a.id === artifactId);
          if (!item || workerArtifactOwner(state, item) !== subject) pluginFail('WORKSPACE_PLUGIN_FILE', 'This owner cannot read that Worker artifact.');
          const output = await artifacts.download(artifactId, { version });
          if (output.version.sha256 !== sha256) pluginFail('WORKSPACE_PLUGIN_FILE', 'The saved artifact hash does not match the requested version.');
          return { filename: output.filename, mimeType: output.mimeType, version, sha256, bytes: output.bytes };
        });
      },
    });
  }
  function bindDotTasks(actor) {
    pluginFields(actor, ['subject', 'nativeAgentId']);
    const token = Object.freeze({ ...actor, epoch: snapshot().epoch, active: true });
    const readToken = Object.freeze({ ...token, active: false });
    authorize(store.read(), readToken);
    if (!dot.enabled) pluginFail('WORKSPACE_DOT_SETUP_REQUIRED', 'The original dot transport is not configured in this native Host.');
    return Object.freeze({
      submit: body => run(token, () => dotTasks.submit(actor, body)),
      ready: requestId => run(token, () => dotTasks.ready(actor, requestId)),
      view: () => run(readToken, () => dotTasks.view(actor)),
      dispatchNext: checkNative => run(token, () => dotTasks.dispatchNext(actor, checkNative)),
      acknowledge: (requestId, receiptHash) => run(readToken, () => dotTasks.acknowledge(actor, requestId, receiptHash)),
      accept: (requestId, receiptHash) => run(readToken, () => dotTasks.accept(actor, requestId, receiptHash)),
      cancel: requestId => run(readToken, () => dotTasks.cancel(actor, requestId)),
      close: (requestId, receiptHash) => run(readToken, () => dotTasks.close(actor, requestId, receiptHash)),
      download: reference => run(readToken, () => dotTasks.download(actor, reference)),
    });
  }
  async function reviewDotBindings(body) {
    pluginFields(body, ['expectedEpoch', 'configurationHash', 'bindings', 'callbackURLs']);
    const lifecycle = snapshot();
    if (stopping || !dot.enabled || lifecycle.phase !== 'active' || body.expectedEpoch !== lifecycle.epoch
      || body.configurationHash !== fingerprint || !Array.isArray(body.bindings)) pluginFail('WORKSPACE_DOT_BINDING_REVIEW', 'Review the current live Host and exact original dot connections.');
    const nextConfig = { ...structuredClone(dotConfiguration), bindings: structuredClone(body.bindings) };
    if (body.callbackURLs !== undefined) {
      const candidates = dot.events.view(dotOwnerSubject).callbackCandidates;
      if (!Array.isArray(body.callbackURLs) || body.callbackURLs.some(url => !dotConfiguration.callbackURLs.includes(url)
        && !candidates.some(c => c.url === url && c.expiresAt > now()))) pluginFail('WORKSPACE_DOT_CALLBACK_REVIEW', 'Review only exact unexpired callback candidates from authenticated ChatGPT subscription requests.');
      nextConfig.callbackURLs = structuredClone(body.callbackURLs);
    }
    for (const binding of nextConfig.bindings) {
      if (binding.subject !== dotOwnerSubject) pluginFail('WORKSPACE_DOT_OWNER_REQUIRED', 'The platform Worker must remain bound to its reviewed original owner.');
      workers.dotBinding(binding);
    }
    // Construct and validate the replacement before withdrawing the old grant.
    const dotStore = { ...store, update: callback => run({ epoch: snapshot().epoch, active: false }, () => guardedStore.update(callback)) };
    const replacement = createDotMcp({ store: dotStore, workers, config: nextConfig, now, transport: dotTransport });
    const nextHash = fingerprintFor({ ...config, dotOwnerSubject, dotConfigurationHash: capabilityPayloadHash(nextConfig) });
    await dot.close();
    try {
      await store.update(state => {
        if (stopping || state.workspacePlugin.epoch !== body.expectedEpoch || state.workspacePlugin.configurationHash !== body.configurationHash) pluginFail('WORKSPACE_PLUGIN_STALE', 'The Host changed while reviewing dot authorization.');
        Object.assign(state.workspacePlugin, { epoch: nextEpoch(body.expectedEpoch), previousConfigurationHash: fingerprint,
          configurationHash: nextHash, reason: 'dot-binding-review' });
      });
      fingerprint = nextHash; dotConfiguration = nextConfig; dot = replacement;
      if (dotStarted) await dot.start();
    } catch (error) { await replacement.close(); throw error; }
    return status();
  }
  // This Host-only projection never submits to, polls, cancels or emulates Muse.
  // The native execution authority must verify the receipt before calling it.
  function bindNativeProjection(actor, binding) {
    pluginFields(actor, ['subject', 'nativeAgentId']);
    if (!pluginId(actor.subject) || !pluginId(actor.nativeAgentId)) pluginFail('WORKSPACE_PLUGIN_OWNER', 'An explicit native Agent and Workspace owner binding is required.');
    const token = Object.freeze({ ...actor, epoch: snapshot().epoch, active: true });
    authorize(store.read(), token);
    const match = configuration.admissions.filter(a => a.subject === actor.subject && a.provider === 'muse'
      && a.agentId === binding?.workerId && a.providerOwnerId === binding?.ownerId && a.protocolFingerprint === binding?.protocolFingerprint);
    if (match.length !== 1) pluginFail('WORKSPACE_PLUGIN_OWNER', 'The native projection does not belong to this owner and original Muse.');
    const reviewedBinding = structuredClone(binding);
    return Object.freeze({
      admit: request => run(token, () => guardedStore.update(state => workers.admitNative(state, { ...request, binding: reviewedBinding }))),
      observe: observation => run(token, () => guardedStore.update(state => workers.observeNative(state, reviewedBinding, observation))),
      authenticate: () => run(token, () => workers.authenticateNative(reviewedBinding)),
    });
  }
  // Owner-bound Host/UI operations only. These are not model tools, vendor API
  // methods or an approval bypass. Each execution consumes the existing exact
  // connector approval; paused scopes may reconcile, never dispatch new work.
  function bindNativeResults(actor) {
    pluginFields(actor, ['subject', 'nativeAgentId']);
    const token = Object.freeze({ ...actor, epoch: snapshot().epoch, active: false });
    authorize(store.read(), token);
    const binding = resultBindings.find(b => b.actor.subject === actor.subject && b.actor.nativeAgentId === actor.nativeAgentId);
    if (!binding) pluginFail('WORKSPACE_NATIVE_RESULT_BINDING_REQUIRED', 'No reviewed original-native result reader is configured for this owner.');
    const checkConnector = id => binding.connector(store.read(), id);
    return Object.freeze({
      review: taskKey => run(token, () => binding.contract.review(taskKey)),
      inspect: jobId => run(token, () => binding.inspect(jobId)),
      createConnector: () => run(token, () => capabilities.createConnector({ name: 'Reviewed native result return',
        adapter: binding.adapterName, capabilities: ['publish_result', 'reconcile'],
        requestId: `native_results_${capabilityPayloadHash(binding.adapterName)}` })),
      setEnabled: (id, enabled) => run(token, () => { checkConnector(id); return capabilities.updateConnector(id, { enabled }); }),
      requestApproval: (id, input) => run(token, () => {
        checkConnector(id); return capabilities.requestApproval(capabilities.connectorApprovalRequest(id, input));
      }),
      decideApproval: (id, input) => run(token, () => {
        const approval = store.read().capabilities.approvals.find(a => a.id === id);
        if (approval?.payload?.adapter !== binding.adapterName) pluginFail('WORKSPACE_PLUGIN_OWNER', 'This approval belongs to a different native result binding.');
        return capabilities.decideApproval(id, input);
      }),
      execute: (id, input) => run(token, () => {
        checkConnector(id); return capabilities.executeConnector(id, input, { assertAllowed: state => binding.connector(state, id) });
      }),
    });
  }
  async function control(action, body) {
    pluginFields(body, ['expectedEpoch', 'configurationHash', 'requestId']);
    if (!pluginId(body.requestId) || !Number.isSafeInteger(body.expectedEpoch) || body.configurationHash !== fingerprint) pluginFail('WORKSPACE_PLUGIN_CONTROL', 'Use the exact reviewed configuration, epoch and stable control requestId.');
    if (stopping) pluginFail('WORKSPACE_PLUGIN_CLOSED', 'The plugin is unloading.');
    const hash = pluginConfigurationHash({ action, ...body }, {});
    await store.update(state => {
      const lifecycle = state.workspacePlugin, previous = lifecycle.controls.find(r => r.requestId === body.requestId);
      if (previous) { if (previous.hash !== hash) pluginFail('WORKSPACE_PLUGIN_IDEMPOTENCY', 'The control requestId already identifies another action.'); return; }
      if (lifecycle.epoch !== body.expectedEpoch) pluginFail('WORKSPACE_PLUGIN_STALE', 'The control action refers to an older scope epoch.');
      if (lifecycle.controls.length >= 256) pluginFail('WORKSPACE_PLUGIN_CAPACITY', 'Review lifecycle retention before admitting more control operations.');
      if (action === 'resume' && ((state.museTasks ?? []).some(task => !['stopped', 'submitted'].includes(task.status))
        || (state.personalWorkers?.delegations ?? []).some(j => !terminal.has(j.state))
        || (lifecycle.nativeSubmissions ?? []).some(i => !i.jobId))) pluginFail('WORKSPACE_PLUGIN_RECONCILE', 'Unfinished assignments require the original native authority; no replacement attempt is allowed.');
      lifecycle.epoch = nextEpoch(lifecycle.epoch); lifecycle.phase = action === 'resume' ? 'active' : 'paused'; lifecycle.reason = action;
      if (action !== 'resume') quarantine(state, now(), action);
      lifecycle.controls.push({ requestId: body.requestId, hash, action, at: now() });
    });
    return status();
  }
  async function finishClose() {
    await museRest?.close();
    await dot?.close();
    await Promise.allSettled([...pending]);
    await capabilities?.close(); await workers.close(); await artifacts.close();
    await store.update(state => { state.workspacePlugin.phase = 'detached'; state.workspacePlugin.detachedAt = now(); });
    const result = { ...status(), writerReleased: true };
    await store.close(); resolveClosed(result); return result;
  }
  function close() {
    if (closeResult) return closeResult;
    stopping = true; // Reject before the first asynchronous durable write.
    closeResult = (async () => {
      try {
        await store.update(state => {
          const lifecycle = state.workspacePlugin; lifecycle.epoch = nextEpoch(lifecycle.epoch);
          lifecycle.phase = 'draining'; lifecycle.reason = 'scope-disposed'; quarantine(state, now(), 'scope-disposed');
        });
        finalizing = finishClose(); void finalizing.catch(rejectClosed);
        let timer;
        try {
          return await Promise.race([finalizing, new Promise(resolve => { timer = setTimeout(() => resolve({ ...status(), writerReleased: false, drainTimedOut: true }), config.drainTimeoutMs); })]);
        } finally { clearTimeout(timer); }
      } catch (error) { rejectClosed(error); throw error; }
    })();
    return closeResult;
  }
  return Object.freeze({ enabled: true, status, bindActor, bindFrontend, bindNativeTasks, bindNativeProjection, bindNativeResults, bindDotTasks, close, whenClosed,
    attachMuseRest, refreshMuseRest,
    muse: Object.freeze({
      get enabled() { return Boolean(museRest); },
      handle(req, res, pathname) {
        if (!museRest) throw new MuseWorkerError(503, 'MW_GATEWAY_UNAVAILABLE', 'The original Muse binding is unavailable.');
        return museRest.handle(req, res, pathname);
      },
      bindDesk(actor) {
        if (!museRest) throw new MuseWorkerError(503, 'MW_GATEWAY_UNAVAILABLE', 'The original Muse binding is unavailable.');
        return museRest.bindDesk(actor);
      },
      bindConversation(actor) {
        if (!museRest) throw new MuseWorkerError(503, "MW_GATEWAY_UNAVAILABLE", "The original Muse binding is unavailable.");
        return museRest.bindConversation(actor);
      },
      bindControl(actor) {
        if (!museRest) throw new MuseWorkerError(503, 'MW_GATEWAY_UNAVAILABLE', 'The original Muse binding is unavailable.');
        return museRest.bindControl(actor, { workspaceId: config.scopeId,
          policyVersion: 'plugin-epoch-' + snapshot().epoch + '.' + fingerprint });
      },
      bindSession(actor) {
        if (!museRest) throw new MuseWorkerError(503, 'MW_GATEWAY_UNAVAILABLE', 'The original Muse binding is unavailable.');
        return museRest.bindSession(actor);
      },
    }),
    dot: Object.freeze({
      enabled: dot.enabled,
      metadataPath: dot.metadataPath,
      metadata: dot.metadata,
      async start() { await dot.start(); dotStarted = true; },
      handle: request => run({ epoch: snapshot().epoch, active: false }, () => dot.handle(request)),
      view: subject => dot.events?.view(subject),
      // Trusted Host control only: never exposed as a model or MCP tool.
      reviewBindings: body => reviewDotBindings(body),
    }),
    pause: body => control('pause', body), resume: body => control('resume', body),
    // Original signed native gateway semantics are unchanged; Muse REST has a separate fixed owner.
    gateway(request) {
      try { return run({ epoch: snapshot().epoch, active: true }, () => workers.gateway(request))
        .catch(() => Response.json({ error: { code: 'WORKSPACE_PLUGIN_SCOPE_CHANGED' } }, { status: 503 })); }
      catch (error) { return Promise.resolve(Response.json({ error: { code: error.code ?? 'WORKSPACE_PLUGIN_UNAVAILABLE' } }, { status: 503 })); }
    },
  });
}
