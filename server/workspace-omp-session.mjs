import { marketValidationMonitorExtension, MARKET_MONITOR_TOOLS } from '../packages/workspace-market-validation/src/monitor.js';
// Bun-only integration with the reviewed official OMP SDK. This file supplies
// configuration and a provider transport; OMP owns the agent/tool/session loop.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { factoryIngestionExtension, FACTORY_INGESTION_TOOLS } from '../packages/workspace-factory-ingestion/src/extension.js';
import { marketValidationExtension, MARKET_VALIDATION_TOOLS } from '../packages/workspace-market-validation/src/extension.js';
import { factoryInquiriesExtension, FACTORY_INQUIRY_TOOLS } from '../packages/workspace-factory-inquiries/src/extension.js';
import { factoryCustomersExtension, FACTORY_CUSTOMER_TOOLS } from '../packages/workspace-factory-customers/src/extension.js';
import { factoryMaterialsExtension, FACTORY_MATERIAL_TOOLS } from '../packages/workspace-factory-materials/src/extension.js';
import { registerWorkspaceReadTools } from '../packages/workspace-procurement/src/workspace-read.mjs';
import { registerFactoryTools } from '../packages/workspace-procurement/src/factory.mjs';
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

export async function createWorkspaceOmpSession({ packageRoot, client, cwd, agentDir, sessionDirectory, savedSession = null, localSession = null,
  configuration, syntheticResponses = null, authorize = async () => {}, onModelRequest = async () => {},
  maxModelCalls = 4, maxTokens = 1600, localFactory = null, providerTransport = null, readOnlyBusiness = false, humanControls = false, factoryTasks = false, hasUI = false, ordinaryTools = false, onModelAbort = () => {}, onModelWaiting = () => {},
  uiOnly = false, uiExtension = null, publicTools = {}, syntheticPublicSearchResponses = null, lifecycleSignal,
  factoryMaterials = false, factoryCustomers = false, factoryInquiries = false, factoryIngestion = false, marketValidation = false, ingestionClient = null, planClient = null, monitorClient = null, materialsClient = null, inquiryClient = null, customerClient = null, engineScope = localFactory ? 'omp:18.10.4:local-factory-v1' : factoryIngestion ? 'omp:18.10.4:factory-ingestion-v1' : marketValidation ? 'omp:18.10.4:market-validation-v1' : factoryInquiries ? 'omp:18.10.4:factory-inquiries-v1' : factoryMaterials ? 'omp:18.10.4:factory-materials-v1' : factoryCustomers ? 'omp:18.10.4:factory-customers-v1' : OMP_ENGINE_SCOPE,
  bindingConfiguration = client ? 'configured_unverified' : 'unconfigured' }) {
  if (providerTransport && !localFactory) throw Error('Bounded local provider transport requires the local factory profile.');
  if (localSession && (!localFactory || savedSession)) throw Error('LOCAL_SESSION_PROFILE_REFUSED');
  if (localFactory && (savedSession || readOnlyBusiness || factoryMaterials || factoryCustomers || factoryInquiries || factoryIngestion || marketValidation || ordinaryTools || uiOnly || client))
    throw Error('Local factory files cannot inherit remote profiles, clients or transcripts.');
  if (readOnlyBusiness && (factoryMaterials || factoryCustomers || factoryInquiries || factoryIngestion || marketValidation || ordinaryTools || uiOnly))
    throw Error('Session business reads require the original public tool profile.');
  const sdk = await loadWorkspaceOmpSdk(packageRoot);
  const privateProfile = factoryMaterials || factoryIngestion;
  const expectedScope = localFactory ? 'omp:18.10.4:local-factory-v1' : factoryIngestion ? 'omp:18.10.4:factory-ingestion-v1' : marketValidation ? 'omp:18.10.4:market-validation-v1' : factoryInquiries ? 'omp:18.10.4:factory-inquiries-v1' : factoryMaterials ? 'omp:18.10.4:factory-materials-v1' : factoryCustomers ? 'omp:18.10.4:factory-customers-v1' : OMP_ENGINE_SCOPE;
  if (engineScope !== expectedScope || factoryIngestion && (factoryMaterials || factoryCustomers || factoryInquiries || marketValidation || !ingestionClient)
    || marketValidation && (!factoryMaterials || !planClient || factoryCustomers || factoryInquiries) || factoryInquiries && (!factoryMaterials || !inquiryClient)
    || factoryMaterials && (!materialsClient || factoryCustomers) || privateProfile && (ordinaryTools || uiOnly)) throw Error('Use the reviewed original private Session profile.');

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
  await fs.rm(selectedSkillRoot, { recursive: true, force: true });
  await fs.mkdir(selectedSkillRoot, { recursive: true, mode: 0o700 });
  if (!factoryCustomers && !factoryInquiries && !factoryIngestion && !marketValidation) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory'));
    await fs.copyFile(path.join(factorySkillDirectory, 'SKILL.md'), path.join(selectedSkillRoot, 'factory/SKILL.md'));
  }
  if (factoryMaterials) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-materials'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../packages/workspace-factory-materials/skills/factory-materials/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-materials/SKILL.md'));
  }
  if (factoryCustomers) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-customers'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../packages/workspace-factory-customers/skills/factory-customers/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-customers/SKILL.md'));
  }
  if (factoryInquiries) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-inquiries'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../packages/workspace-factory-inquiries/skills/factory-inquiries/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-inquiries/SKILL.md'));
  }
  for (const [active, kind] of [[factoryIngestion, 'factory-ingestion'], [marketValidation, 'market-validation']]) if (active) {
    await fs.mkdir(path.join(selectedSkillRoot, kind), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../packages/workspace-' + kind + '/skills/' + kind + '/SKILL.md', import.meta.url), path.join(selectedSkillRoot, kind + '/SKILL.md'));
  }
  const selectedSkills = await sdk.loadSkillsFromDir({ dir: selectedSkillRoot, source: 'custom:project' });
  assert.deepEqual(selectedSkills.warnings, []);
  assert.deepEqual(selectedSkills.skills.map(skill => skill.name).sort(), factoryIngestion ? ['workspace-factory-ingestion'] : marketValidation ? ['workspace-factory-materials', 'workspace-market-validation'] : factoryInquiries ? ['workspace-factory-inquiries', 'workspace-factory-materials'] : factoryMaterials ? ['workspace-factory', 'workspace-factory-materials'] : factoryCustomers ? ['workspace-factory-customers'] : ['workspace-factory']);
  const factorySkillContent = !privateProfile && !factoryCustomers ? await fs.readFile(path.join(factorySkillDirectory, 'SKILL.md'), 'utf8') : '';
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
    if (!privateProfile) return;
    const monitorSnapshots = new Map(); // One disclosure boundary only.
    const checkedReceipts = new Set(); // Only this validation boundary, never a permission cache.
    for (const message of messages) {
      if (message?.role !== 'toolResult' || ![...FACTORY_MATERIAL_TOOLS, ...(factoryInquiries ? FACTORY_INQUIRY_TOOLS : []), ...(factoryIngestion ? FACTORY_INGESTION_TOOLS : []), ...(marketValidation ? [...MARKET_VALIDATION_TOOLS, ...MARKET_MONITOR_TOOLS] : [])].includes(message.toolName)) continue;
      let receipt;
      try { receipt = JSON.parse((message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')); }
      catch {
        // Official schema validation can fail before the extension runs. Such
        // errors have no data receipt; successful/partial material receipts in
        // every other journal entry are still revalidated below.
        if (message.isError === true && message.details === undefined) continue;
        throw Error('Factory cached receipt is malformed; no model disclosure is admitted.');
      }
      if (!['workspace-factory-materials', ...(factoryInquiries ? ['workspace-factory-inquiries'] : []), ...(factoryIngestion ? ['workspace-factory-ingestion'] : []), ...(marketValidation ? ['workspace-market-validation', 'workspace-market-monitor'] : [])].includes(receipt.plugin)) throw Error('Factory cached receipt provenance changed.');
      if (['unconfigured', 'blocked', 'unavailable'].includes(receipt.status) && Object.keys(receipt).every(key => ['plugin', 'status', 'reason', 'sources', 'detail', 'humanReviewRequired', 'humanReviewed', 'sent', 'externalActions', 'visibility', 'humanConfirmed', 'independentVerification', 'startedAt'].includes(key))
        && Array.isArray(receipt.sources) && receipt.sources.length === 0) continue;
      if (receipt.plugin === 'workspace-market-monitor') {
        const key = libraryReadHash([receipt.input, receipt.requestedAction]);
        if (!monitorSnapshots.has(key)) monitorSnapshots.set(key, await monitorClient.refresh(receipt, model, signal));
        continue;
      }
      if (!receipt.authorization && !factoryIngestion) throw Error('Factory cached receipt has no exact original authorization.');
      const key = libraryReadHash([receipt, (message.content || []).filter(b => b.type === 'image')]);
      if (checkedReceipts.has(key)) continue;
      checkedReceipts.add(key);
      await authorize();
      if (receipt.plugin === 'workspace-factory-ingestion') await ingestionClient.revalidateReceipt(receipt, model, signal, (message.content || []).filter(b => b.type === 'image'));
      else if (receipt.plugin === 'workspace-market-validation') await planClient.revalidateReceipt(receipt, model, signal);
      else if (receipt.plugin === 'workspace-factory-inquiries') await inquiryClient.revalidateReceipt(receipt, model, signal);
      else await materialsClient.revalidateReceipt(receipt, model, signal);
      await authorize();
    }
    return monitorSnapshots;
  }
  let modelCalls = 0; const completedUsage = new Map();
  const customApi = uiOnly ? 'workspace-omp-ui-only-disabled' : syntheticResponses ? 'workspace-omp-explicit-faux' : 'workspace-omp-pinned-openai';
  const buildSynthetic = (spec, model, callNumber, context) => {
    let args = spec.arguments || {};
    if (spec.sourcesFromPreviousTools) {
      if (!['workspace_factory_inquiry_save', 'workspace_market_validation_plan_save'].includes(spec.tool)) throw Error('Finite fixture source-copy target refused.');
      const names = spec.tool === 'workspace_market_validation_plan_save' ? ['workspace_market_validation_product'] : ['workspace_factory_document', 'workspace_factory_materials'];
      const sources = names.flatMap(name => {
        const previous = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === name);
        const receipt = JSON.parse(previous?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || 'null');
        if (!['workspace-factory-materials', 'workspace-market-validation'].includes(receipt?.plugin) || !Array.isArray(receipt.sources)) throw Error('Finite fixture requires actual original material receipts.');
        return receipt.sources;
      });
      args = { ...args, sources };
    }
    if (spec.ingestionSourcesFromPreviousTools) {
      if (spec.tool !== 'workspace_factory_ingestion_save') throw Error('Finite fixture source-copy target refused.');
      const receipts = context.messages.filter(m => m.role === 'toolResult' && m.toolName === 'workspace_factory_ingestion_read').map(m => JSON.parse(m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')));
      if (!receipts.length || receipts.some(r => r.plugin !== 'workspace-factory-ingestion' || !r.source)) throw Error('Finite fixture needs original native read receipts.');
      args = structuredClone(args); args.sources = receipts.map(r => r.source);
      for (const row of args.records) for (const e of row.evidence) {
        const r = receipts[e.sourceIndex]; if (!r || e.observation) throw Error('Finite text evidence target refused.');
        e.start = 0; e.end = r.text.length; e.quote = r.text;
      }
    }
    if (spec.sourceToolIdsFromPreviousTools) {
      if (spec.tool !== 'workspace_factory_customers_save') throw Error('Finite fixture public source-copy target refused.');
      args = { ...args, sourceToolCallIds: context.messages.filter(message => message.role === 'toolResult'
        && ['workspace_public_search', 'workspace_public_browser'].includes(message.toolName) && !message.isError).map(message => message.toolCallId) };
    }
    if (spec.parallelTools && (!localFactory || !Array.isArray(spec.parallelTools) || spec.parallelTools.length !== 5
      || spec.parallelTools.some(tool => tool.name !== 'write'))) throw Error('Finite local concurrent-write fixture refused.');
    const content = spec.parallelTools ? spec.parallelTools.map((tool, index) => ({ type: 'toolCall', id: `workspace-omp-${callNumber}-${index}`, name: tool.name, arguments: tool.arguments }))
      : spec.tool ? [{ type: 'toolCall', id: `workspace-omp-${callNumber}`, name: spec.tool, arguments: args }]
      : [{ type: 'text', text: spec.text || 'Explicit synthetic model response.' }];
    return { role: 'assistant', content, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      stopReason: spec.tool || spec.parallelTools ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
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
        const monitorSnapshots = await revalidateFactoryContext([...(manager?.getEntries() || []).map(e => e.message), ...(context.messages || [])], model, options?.signal);
        if (marketValidation) for (const message of context.messages || []) {
          if (message?.role !== 'toolResult' || !MARKET_MONITOR_TOOLS.includes(message.toolName)) continue;
          let receipt; try { receipt = JSON.parse(message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')); } catch { continue; }
          if (!receipt.input) continue;
          const fresh = monitorSnapshots.get(libraryReadHash([receipt.input, receipt.requestedAction]));
          if (!fresh) throw Error('Original monitor snapshot required.');
          message.content = [{ type: 'text', text: JSON.stringify(fresh) }]; message.details = fresh;
        }
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
          if (spec.forbiddenContextText) assert.ok(!JSON.stringify(context.messages).includes(spec.forbiddenContextText), 'Explicit fixture refused stale or forged monitor context.');
          if (spec.expectedContextText) assert.ok(JSON.stringify(context.messages).includes(spec.expectedContextText), 'Explicit fixture expected the original public tool/child receipt.');
          if (spec.wait) await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, spec.wait);
            signal?.addEventListener('abort', () => { clearTimeout(timer); onModelAbort(); reject(new Error('Explicit synthetic model cancelled')); }, { once: true });
            onModelWaiting();
          });
          const message = buildSynthetic(spec, model, callNumber, context);
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
            maxTokens: Math.min(Math.floor(maxTokens / maxModelCalls), options?.maxTokens || Infinity), maxRetries: 0,
            ...(providerTransport ? { fetch: providerTransport.fetch, onSseEvent: providerTransport.onSseEvent, acceptEmptyResponse: true,
              signal: AbortSignal.any([options?.signal, providerTransport.signal].filter(Boolean)) } : {}) });
          for await (const event of upstream) {
            if (event.type === 'done') { providerTransport?.complete(event.message); completedUsage.set(callNumber, event.message?.usage); }
            if (event.type === 'error') providerTransport?.stop('LOCAL_PROVIDER_ERROR_STOP_DO_NOT_RETRY');
            stream.push(event);
          }
        }
      })().catch(error => stream.fail(new Error(error.message.replaceAll(configuration.apiKey || '\0', '[REDACTED]'))));
      return stream;
    },
  });
  manager = localSession?.file ? await sdk.SessionManager.open(localSession.file, sessionDirectory, undefined, { throwIfMissing: localSession.resume === true, initialCwd: cwd })
    : savedSession ? await sdk.SessionManager.open(savedSession.sessionFile, sessionDirectory)
    : await sdk.SessionManager.create(cwd, sessionDirectory);
  if (localSession) {
    if (path.resolve(manager.getCwd()) !== cwd) throw Error('LOCAL_SESSION_PROFILE_REFUSED');
    if (localSession.resume) {
      const binding = manager.getEntries().find(e => e.type === 'custom' && e.customType === 'workspace-local-binding');
      const lastTurn = manager.getEntries().filter(e => e.type === 'custom' && e.customType === 'workspace-local-turn').at(-1);
      if (!binding || binding.data?.engineScope !== engineScope || JSON.stringify(binding.data.binding) !== JSON.stringify(localSession.binding)
        || lastTurn?.data?.billingUncertain) throw Error('LOCAL_SESSION_SELECTION_OR_BILLING_REFUSED');
    } else manager.appendCustomEntry('workspace-local-binding', { engineScope, binding: localSession.binding });
  }
  if (savedSession && (savedSession.engineScope !== engineScope || manager.getSessionId() !== savedSession.agentSessionId || path.resolve(manager.getCwd()) !== cwd))
    throw new Error('This is not the selected OMP engine scope; history cannot migrate across profiles.');
  const { EventBus } = await import(pathToFileURL(path.join(packageRoot, 'src/utils/event-bus.ts')).href);
  const eventBus = new EventBus(), subagentEventBus = new EventBus();
  const toolSession = { cwd, settings, authStorage, modelRegistry, eventBus, subagentEventBus, skills: selectedSkills.skills, getSessionId: () => manager.getSessionId(),
    getSessionFile: () => manager.getSessionFile(), getArtifactsDir: () => cwd };
  publicExtension = !localFactory && !readOnlyBusiness && !uiOnly && !ordinaryTools && !privateProfile ? await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize, signal: lifecycleSignal,
    configuration: publicTools, fetchImpl: createWorkspaceOmpSyntheticPublicFetch({ responses: syntheticPublicSearchResponses, explicitFaux: Boolean(syntheticResponses) }) })
    : { tools: [], toolNames: [], capabilities: { status: 'not-enabled-in-ui-only-or-ordinary-host' }, close: async () => {} };
  publicTask = !localFactory && !readOnlyBusiness && !uiOnly && !ordinaryTools && !privateProfile ? await createWorkspaceOmpPublicTask({ packageRoot, toolSession, configuration, authorize })
    : { tools: [], toolNames: [], close: async () => {} };
  // Advertise/load approved Skills through the official resolver and ReadTool.
  // No arbitrary path, URL, plugin discovery or duplicated full-Skill prompt.
  const skillTools = [];
  if (privateProfile || factoryCustomers) {
    const { ReadTool } = await import(pathToFileURL(path.join(packageRoot, 'src/tools/read.ts')).href);
    const reader = new ReadTool(toolSession), names = selectedSkills.skills.map(s => s.name);
    skillTools.push({ name: 'workspace_skill', label: 'Read a loaded factory Skill', readsSkillUris: true,
      description: 'Read one explicitly loaded Skill through the official skill:// resolver. Choose a listed name; no file paths or additional resources.',
      parameters: { type: 'object', properties: { name: { type: 'string', enum: names } }, required: ['name'], additionalProperties: false },
      async execute(id, input, signal, update) {
        if (!input || Object.keys(input).some(k => k !== 'name') || !names.includes(input.name)) throw Error('Only an explicitly loaded Skill is admitted.');
        signal?.throwIfAborted(); await authorize();
        const result = await reader.execute(id, { path: 'skill://' + input.name }, signal, update);
        await authorize(); signal?.throwIfAborted(); return result;
      } });
  }
  const localFileTools = localFactory ? await localFactory.initialize({ packageRoot, toolSession }) : [];
  const simplified = factoryInquiries || factoryCustomers || factoryIngestion || marketValidation;
  const admittedTools = localFactory ? ['read', 'write', 'workspace_factory_capabilities', 'workspace_factory_rfq_requirements', 'workspace_factory_match_prepare'] : readOnlyBusiness ? ['workspace_business_tasks', 'workspace_business_result'] : [...(simplified ? [] : ORDINARY_FACTORY_TOOLS), ...skillTools.map(t => t.name), ...(!simplified && factoryTasks ? ['workspace_factory_task'] : []), ...publicExtension.toolNames, ...publicTask.toolNames, ...(factoryMaterials ? FACTORY_MATERIAL_TOOLS : []), ...(factoryCustomers ? FACTORY_CUSTOMER_TOOLS : []), ...(factoryInquiries ? FACTORY_INQUIRY_TOOLS : []), ...(factoryIngestion ? FACTORY_INGESTION_TOOLS : []), ...(marketValidation ? [...MARKET_VALIDATION_TOOLS, ...MARKET_MONITOR_TOOLS] : [])];
  if (savedSession && !ordinaryTools) {
    for (const entry of manager.getEntries()) {
      const message = entry.message;
      if (message?.role === 'toolResult' && !admittedTools.includes(message.toolName)
        || message?.role === 'assistant' && message.content?.some(block => block.type === 'toolCall' && !admittedTools.includes(block.name)))
        throw new Error(factoryMaterials ? 'The selected OMP profile cannot inherit non-admitted tool receipts.'
          : 'The public OMP profile cannot inherit private or non-admitted tool receipts.');
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
    extensions: [...(factoryIngestion ? [factoryIngestionExtension({ client: ingestionClient, authorize })] : []), ...(marketValidation ? [marketValidationExtension({ client: planClient, authorize }), marketValidationMonitorExtension({ client: monitorClient, authorize })] : []), ...(factoryInquiries ? [factoryInquiriesExtension({ client: inquiryClient, authorize })] : []), ...(factoryCustomers ? [factoryCustomersExtension({ authorize, client: customerClient })] : []), ...(factoryMaterials ? [factoryMaterialsExtension({ client: materialsClient, authorize })] : []), ...(localFactory ? [pi => registerFactoryTools(pi, null, 'local-files', { localOnly: true })] : readOnlyBusiness ? [pi => registerWorkspaceReadTools(pi, client, { library: false })] : simplified ? [] : [factoryExtension({ client, humanControls, factoryTasks, configuration: bindingConfiguration })]),
      pi => [...localFileTools, ...publicExtension.tools, ...publicTask.tools, ...skillTools].forEach(tool => pi.registerTool(tool)),
      ...ordinaryTools ? [] : [workspaceOmpPublicProfile(admittedTools)], ...(uiExtension ? [uiExtension] : [])],
    disableExtensionDiscovery: true, skills: selectedSkills.skills, appendSystemPrompt: privateProfile || factoryCustomers ? undefined : factorySkillContent,
    rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    ...ordinaryTools ? {} : { toolNames: [] }, spawns: '', hasUI, autoTitle: false, interactivePrompts: hasUI, eventBus, subagentEventBus,
    cacheWarming: false, allowSessionModelFallback: false });
  const session = created.session;
  if (localFactory || readOnlyBusiness) await session.setActiveToolsByName(admittedTools);
  if (privateProfile || factoryCustomers) {
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
