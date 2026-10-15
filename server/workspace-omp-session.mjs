// Bun-only integration with the reviewed official OMP SDK. This file supplies
// configuration and a provider transport; OMP owns the agent/tool/session loop.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { factoryMaterialsExtension, FACTORY_MATERIAL_TOOLS } from '../packages/workspace-factory-materials/src/extension.js';
import { factoryExtension } from '../packages/workspace-procurement/src/extension.js';
import { ORDINARY_FACTORY_TOOLS } from '../packages/workspace-procurement/src/extension.js';
import { workspaceOmpPublicProfile } from './workspace-omp-public-profile.mjs';
import { createWorkspaceOmpPublicTools, createWorkspaceOmpSyntheticPublicFetch, WORKSPACE_OMP_PUBLIC_PDF_POLICY } from './workspace-omp-public-tools.mjs';
import { createWorkspaceOmpPublicTask } from './workspace-omp-public-task.mjs';

export const OMP_VERSION = '18.10.4';
export const OMP_ENGINE_SCOPE = 'omp:18.10.4:public-v1';
export async function loadWorkspaceOmpSdk(packageRoot) {
  if (!globalThis.Bun) throw new Error('Workspace OMP requires the reviewed Bun runtime; Node is not an OMP fallback.');
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json')));
  assert.equal(manifest.name, '@oh-my-pi/pi-coding-agent'); assert.equal(manifest.version, OMP_VERSION);
  const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
  const [sdk, settings, registry, sessions, auth, streams, transport, skills, customModels] = await Promise.all([
    load('sdk.ts'), load('config/settings.ts'), load('config/model-registry.ts'), load('session/session-manager.ts'), load('session/auth-storage.ts'),
    import(pathToFileURL(path.join(packageRoot, '../pi-ai/src/utils/event-stream.ts')).href),
    import(pathToFileURL(path.join(packageRoot, '../pi-ai/src/stream.ts')).href),
    load('extensibility/skills.ts'), load('config/custom-models.ts'),
  ]);
  return { ...sdk, ...settings, ...registry, ...sessions, ...auth, ...streams, ...skills, ...customModels, streamSimple: transport.streamSimple };
}

export async function createWorkspaceOmpSession({ packageRoot, client, cwd, agentDir, sessionDirectory, savedSession = null,
  configuration, syntheticResponses = null, authorize = async () => {}, onModelRequest = async () => {},
  maxModelCalls = 4, maxTokens = 1600, humanControls = false, factoryTasks = false, hasUI = false, ordinaryTools = false, onModelAbort = () => {}, onModelWaiting = () => {},
  uiOnly = false, uiExtension = null, publicTools = {}, syntheticPublicSearchResponses = null, lifecycleSignal,
  factoryMaterials = false, materialsClient = null, engineScope = factoryMaterials ? 'omp:18.10.4:factory-materials-v1' : OMP_ENGINE_SCOPE,
  bindingConfiguration = client ? 'configured_unverified' : 'unconfigured' }) {
  const sdk = await loadWorkspaceOmpSdk(packageRoot);
  if (engineScope !== (factoryMaterials ? 'omp:18.10.4:factory-materials-v1' : OMP_ENGINE_SCOPE) || factoryMaterials && (!materialsClient || ordinaryTools || uiOnly)) throw Error('Use the fixed original factory materials Session profile.');
  lifecycleSignal?.throwIfAborted();
  if (!configuration?.providerId || !configuration.model || !configuration.baseUrl || !uiOnly && !syntheticResponses && !configuration.apiKey)
    throw new Error('Workspace OMP model configuration is unconfigured. No sample, account or alternate model is selected.');
  if (!uiOnly && !syntheticResponses && (!configuration.remainingBudgetVerified || !configuration.cost
    || ['input', 'output', 'cacheRead', 'cacheWrite'].some(key => !Number.isFinite(configuration.cost[key]) || configuration.cost[key] < 0)))
    throw new Error('Workspace OMP live model cost and remaining budget are unverified. No paid request is admitted.');
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  const overrides = { 'compaction.enabled': false, 'compaction.midTurnEnabled': false,
    'retry.enabled': false, 'retry.modelFallback': false, 'startup.checkUpdate': false, 'startup.setupWizard': false,
    'telemetry.otlpExportEnabled': false, 'title.refreshOnReplan': false,
    'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'browser.headless': true,
    'eval.autoProvision': false,
    'task.batch': true, 'task.enableLsp': false, 'task.maxConcurrency': 2, 'task.maxRecursionDepth': 1,
    'task.maxRuntimeMs': 60000, 'task.softRequestBudget': 0, 'task.completionProbe': false, 'task.prewalk': false, 'task.structured': false,
    'task.speculativeLaunch': false, 'task.isolation.enabled': false, 'async.enabled': false };
  const settings = await sdk.Settings.init({ cwd, agentDir, inMemory: true, overrides });
  const factorySkillDirectory = new URL('../packages/workspace-procurement/skills/factory/', import.meta.url).pathname;
  // Official loadSkillsFromDir scans child directories. Give it a dedicated
  // root containing only this selected public SKILL, never the legacy buyer skill.
  const selectedSkillRoot = path.join(agentDir, 'workspace-selected-skills');
  await fs.mkdir(path.join(selectedSkillRoot, 'factory'), { recursive: true, mode: 0o700 });
  await fs.copyFile(path.join(factorySkillDirectory, 'SKILL.md'), path.join(selectedSkillRoot, 'factory/SKILL.md'));
  if (factoryMaterials) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-materials'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../packages/workspace-factory-materials/skills/factory-materials/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-materials/SKILL.md'));
  }
  const selectedSkills = await sdk.loadSkillsFromDir({ dir: selectedSkillRoot, source: 'custom:project' });
  assert.deepEqual(selectedSkills.warnings, []);
  assert.deepEqual(selectedSkills.skills.map(skill => skill.name).sort(), factoryMaterials ? ['workspace-factory', 'workspace-factory-materials'] : ['workspace-factory']);
  const factorySkillContent = await fs.readFile(path.join(factorySkillDirectory, 'SKILL.md'), 'utf8') + (factoryMaterials ? '\n' + await fs.readFile(new URL('../packages/workspace-factory-materials/skills/factory-materials/SKILL.md', import.meta.url), 'utf8') : '');
  const authStorage = await sdk.AuthStorage.create(agentDir + '/auth.db');
  let publicExtension, publicTask, created, cleanupPromise, closePromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    try { await publicExtension?.close(); }
    finally { try { await publicTask?.close(); } finally { authStorage.close(); } }
  })();
  try {
  const modelRegistry = new sdk.ModelRegistry(authStorage, agentDir + '/no-ambient-models.yml', { settings, ignoreLocalModelConfig: true });
  let manager;
  async function revalidateFactoryContext(messages, model, signal) {
    if (!factoryMaterials) return;
    for (const message of messages) {
      if (message?.role !== 'toolResult' || !FACTORY_MATERIAL_TOOLS.includes(message.toolName)) continue;
      let receipt;
      try { receipt = JSON.parse((message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')); }
      catch {
        // Official schema validation can fail before the extension runs. Such
        // errors have no data receipt; successful/partial material receipts in
        // every other journal entry are still revalidated below.
        if (message.isError === true && message.details === undefined) continue;
        throw Error('Factory cached receipt is malformed; no model disclosure is admitted.');
      }
      if (receipt.plugin !== 'workspace-factory-materials') throw Error('Factory cached receipt provenance changed.');
      if (['unconfigured', 'blocked', 'unavailable'].includes(receipt.status) && Object.keys(receipt).every(key => ['plugin', 'status', 'reason', 'sources', 'detail'].includes(key))
        && Array.isArray(receipt.sources) && receipt.sources.length === 0) continue;
      if (!receipt.authorization) throw Error('Factory cached receipt has no exact original authorization.');
      await authorize(); await materialsClient.revalidateReceipt(receipt, model, signal); await authorize();
    }
  }
  let modelCalls = 0; const completedUsage = new Map();
  const customApi = uiOnly ? 'workspace-omp-ui-only-disabled' : syntheticResponses ? 'workspace-omp-explicit-faux' : 'workspace-omp-pinned-openai';
  const buildSynthetic = (spec, model, callNumber) => {
    const content = spec.tool ? [{ type: 'toolCall', id: `workspace-omp-${callNumber}`, name: spec.tool, arguments: spec.arguments || {} }]
      : [{ type: 'text', text: spec.text || 'Explicit synthetic model response.' }];
    return { role: 'assistant', content, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      stopReason: spec.tool ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  };
  const modelDefinition = { id: configuration.model, name: uiOnly ? 'UI only; original host executes the selected model' : 'Workspace explicitly configured model', reasoning: false, input: ['text'],
      // UI metadata is never a claim of free business inference. Unknown cost
      // remains unbounded, and this transport refuses before any provider call.
      cost: uiOnly ? configuration.cost || { input: Infinity, output: Infinity, cacheRead: Infinity, cacheWrite: Infinity }
        : syntheticResponses ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : configuration.cost,
      contextWindow: 32000, maxTokens: Math.max(1, Math.floor(maxTokens / maxModelCalls)) };
  modelRegistry.registerProvider(configuration.providerId, {
    api: customApi, apiKey: uiOnly ? undefined : syntheticResponses ? 'explicit-finite-keyless-test-provider' : configuration.apiKey, baseUrl: configuration.baseUrl,
    // OMP permits registering a disabled API without credential-backed model
    // discovery. The UI receives explicit metadata, never a dummy API key.
    models: uiOnly ? [] : [modelDefinition],
    streamSimple(model, context, options) {
      const stream = new sdk.AssistantMessageEventStream();
      void (async () => {
        if (uiOnly) throw new Error('This official terminal is UI-only. Model execution must use the original Workspace Conversation/Run HTTP authority.');
        await authorize();
        await revalidateFactoryContext([...(manager?.getEntries() || []).map(e => e.message), ...(context.messages || [])], model, options?.signal);
        const callNumber = ++modelCalls;
        if (callNumber > maxModelCalls || model.provider !== configuration.providerId || model.id !== configuration.model || model.baseUrl !== configuration.baseUrl)
          throw new Error('The original admitted request count or pinned OMP receiver changed.');
        await onModelRequest({ modelCalls: callNumber });
        const signal = options?.signal;
        if (signal?.aborted) throw new Error('Workspace OMP turn cancelled.');
        if (syntheticResponses) {
          const spec = syntheticResponses[callNumber - 1];
          if (!spec) throw new Error('Finite explicit faux responses exhausted; no real provider fallback.');
          if (spec.expectedToolNames) assert.deepEqual((context.tools || []).map(tool => tool.name).sort(), [...spec.expectedToolNames].sort());
          if (spec.expectedContextText) assert.ok(JSON.stringify(context.messages).includes(spec.expectedContextText), 'Explicit fixture expected the original public tool/child receipt.');
          if (spec.wait) await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, spec.wait);
            signal?.addEventListener('abort', () => { clearTimeout(timer); onModelAbort(); reject(new Error('Explicit synthetic model cancelled')); }, { once: true });
            onModelWaiting();
          });
          const message = buildSynthetic(spec, model, callNumber);
          completedUsage.set(callNumber, message.usage);
          stream.push({ type: 'start', partial: message });
          for (let i = 0; i < message.content.length; i++) {
            const block = message.content[i]; stream.push(block.type === 'toolCall'
              ? { type: 'toolcall_end', contentIndex: i, toolCall: block, partial: message }
              : { type: 'text_end', contentIndex: i, content: block.text, partial: message });
          }
          stream.push({ type: 'done', reason: message.stopReason, message });
        } else {
          // Retain the official provider transport. The separate API identifier
          // avoids replacing any built-in handler or recursively dispatching.
          const upstream = sdk.streamSimple({ ...model, api: 'openai-completions' }, context, { ...options, apiKey: configuration.apiKey,
            maxTokens: Math.min(Math.floor(maxTokens / maxModelCalls), options?.maxTokens || Infinity), maxRetries: 0 });
          for await (const event of upstream) { if (event.type === 'done') completedUsage.set(callNumber, event.message?.usage); stream.push(event); }
        }
      })().catch(error => stream.fail(new Error(error.message.replaceAll(configuration.apiKey || '\0', '[REDACTED]'))));
      return stream;
    },
  });
  manager = savedSession ? await sdk.SessionManager.open(savedSession.sessionFile, sessionDirectory)
    : await sdk.SessionManager.create(cwd, sessionDirectory);
  if (savedSession && (savedSession.engineScope !== engineScope || manager.getSessionId() !== savedSession.agentSessionId || path.resolve(manager.getCwd()) !== cwd))
    throw new Error('This is not the current OMP public-only transcript; Pi/private history cannot migrate.');
  const { EventBus } = await import(pathToFileURL(path.join(packageRoot, 'src/utils/event-bus.ts')).href);
  const eventBus = new EventBus(), subagentEventBus = new EventBus();
  const toolSession = { cwd, settings, authStorage, modelRegistry, eventBus, subagentEventBus, getSessionId: () => manager.getSessionId(),
    getSessionFile: () => manager.getSessionFile(), getArtifactsDir: () => cwd };
  publicExtension = !uiOnly && !ordinaryTools && !factoryMaterials ? await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize, signal: lifecycleSignal,
    configuration: publicTools, fetchImpl: createWorkspaceOmpSyntheticPublicFetch({ responses: syntheticPublicSearchResponses, explicitFaux: Boolean(syntheticResponses) }) })
    : { tools: [], toolNames: [], capabilities: { status: 'not-enabled-in-ui-only-or-ordinary-host' }, close: async () => {} };
  publicTask = !uiOnly && !ordinaryTools && !factoryMaterials ? await createWorkspaceOmpPublicTask({ packageRoot, toolSession, configuration, authorize })
    : { tools: [], toolNames: [], close: async () => {} };
  const admittedTools = [...ORDINARY_FACTORY_TOOLS, ...(factoryTasks ? ['workspace_factory_task'] : []), ...publicExtension.toolNames, ...publicTask.toolNames, ...(factoryMaterials ? FACTORY_MATERIAL_TOOLS : [])];
  if (savedSession && !ordinaryTools) {
    for (const entry of manager.getEntries()) {
      const message = entry.message;
      if (message?.role === 'toolResult' && !admittedTools.includes(message.toolName)
        || message?.role === 'assistant' && message.content?.some(block => block.type === 'toolCall' && !admittedTools.includes(block.name)))
        throw new Error('A public-only OMP transcript cannot inherit private or non-admitted tool receipts.');
      if (message?.role === 'toolResult' && message.toolName === 'workspace_public_document') {
        const selected = (publicTools.publicFiles || []).find(file => file.id === message.details?.documentId && file.sha256 === message.details?.sha256);
        if (!selected) throw new Error('The cached public document was revoked or its exact selected bytes changed. No model request is admitted.');
        if (selected.format === 'pdf' && message.details?.extractionPolicy !== WORKSPACE_OMP_PUBLIC_PDF_POLICY)
          throw new Error('The cached public PDF extraction predates the current text/OCR policy. Start a fresh public conversation; no model request is admitted.');
      }
    }
  }
  // A public-only session never discovers enterprise files, ambient auth, MCP,
  // user/project extensions, rules or skills. The ordinary factory extension
  // itself leaves the official host unchanged; the web host supplies this scope.
  lifecycleSignal?.throwIfAborted();
  created = await sdk.createAgentSession({ cwd, agentDir, settings, modelRegistry, authStorage,
    model: uiOnly ? sdk.finalizeCustomModel(sdk.buildCustomModelOverlay(configuration.providerId, configuration.baseUrl, customApi,
      undefined, undefined, undefined, undefined, undefined, undefined, modelDefinition), { useDefaults: true })
      : modelRegistry.find(configuration.providerId, configuration.model), sessionManager: manager,
    extensions: [...(factoryMaterials ? [factoryMaterialsExtension({ client: materialsClient, authorize })] : []), factoryExtension({ client, humanControls, factoryTasks, configuration: bindingConfiguration }),
      pi => [...publicExtension.tools, ...publicTask.tools].forEach(tool => pi.registerTool(tool)),
      ...ordinaryTools ? [] : [workspaceOmpPublicProfile(admittedTools)], ...(uiExtension ? [uiExtension] : [])],
    disableExtensionDiscovery: true, skills: selectedSkills.skills, appendSystemPrompt: factorySkillContent,
    rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    ...ordinaryTools ? {} : { toolNames: [] }, spawns: '', hasUI, autoTitle: false, interactivePrompts: hasUI, eventBus, subagentEventBus,
    cacheWarming: false, allowSessionModelFallback: false });
  const session = created.session;
  if (factoryMaterials) {
    const { initializeExtensions } = await import(pathToFileURL(path.join(packageRoot, 'src/modes/runtime-init.ts')).href);
    await initializeExtensions(session, { reportSendError: () => {}, reportRuntimeError: () => {},
      filterActiveTools: names => names.filter(name => admittedTools.includes(name)) });
    await revalidateFactoryContext(manager.getEntries().map(e => e.message), session.model, lifecycleSignal);
  }
  assert.deepEqual(created.extensionsResult.errors, []);
  for (const forbidden of ['workspace_company_profile', 'workspace_products', 'workspace_product']) assert.ok(!session.getActiveToolNames().includes(forbidden));
  return { ...created, sdk, authStorage, modelRegistry, manager, engineScope, modelCalls: () => modelCalls,
    publicCapabilities: publicExtension.capabilities,
    usage() {
      const sum = key => completedUsage.size === modelCalls && [...completedUsage.values()].every(row => Number.isSafeInteger(row?.[key]) && row[key] >= 0)
        ? [...completedUsage.values()].reduce((total, row) => total + row[key], 0) : null;
      return { promptTokens: sum('input'), completionTokens: sum('output'), totalTokens: sum('totalTokens') };
    },
    selectedSkillNames: selectedSkills.skills.map(skill => skill.name),
    async close() { return closePromise ??= (async () => { try { await session.dispose(); } finally { await cleanup(); } })(); } };
  } catch (error) {
    try { await created?.session.dispose(); } finally { await cleanup(); }
    throw error;
  }
}
