// Bun-only integration with the reviewed official OMP SDK. This file supplies
// configuration and a provider transport; OMP owns the agent/tool/session loop.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isBrainGapReceipt,isMedusaGapReceipt } from './workspace-omp-business-journal.mjs';
import { projectPlugins } from './workspace-plugin-config.mjs';


// Import optional business code only for a selected business profile. Missing
// dependencies are explicit errors, never silently replaced by another plugin.
async function requiredBusinessModule(name, entry) {
  const file = new URL('../plugins/' + name + '/src/' + entry, import.meta.url);
  try { await fs.access(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw Object.assign(new Error('Enabled business profile requires plugin ' + name + ' (' + entry + '); reinstall it or disable the profile.'),
      {code:'WORKSPACE_PLUGIN_REQUIRED',pluginId:name,pluginEntry:entry});
  }
  return import(file.href);
}

export const OMP_VERSION = '18.10.4';
export const OMP_ENGINE_SCOPE = 'omp:18.10.4:public-v1';
export async function loadWorkspaceOmpSdk(packageRoot) {
  if (!globalThis.Bun) throw new Error('Workspace OMP requires the reviewed Bun runtime; Node is not an OMP fallback.');
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json')));
  assert.equal(manifest.name, '@oh-my-pi/pi-coding-agent'); assert.equal(manifest.version, OMP_VERSION);
  const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
  const [sdk, settings, registry, sessions, auth, streams, transport, skills, customModels, extensions] = await Promise.all([
    load('sdk.ts'), load('config/settings.ts'), load('config/model-registry.ts'), load('session/session-manager.ts'), load('session/auth-storage.ts'),
    import(pathToFileURL(path.join(packageRoot, '../pi-ai/src/utils/event-stream.ts')).href),
    import(pathToFileURL(path.join(packageRoot, '../pi-ai/src/stream.ts')).href),
    load('extensibility/skills.ts'), load('config/custom-models.ts'), load('extensibility/extensions/loader.ts'),
  ]);
  return { ...sdk, ...settings, ...registry, ...sessions, ...auth, ...streams, ...skills, ...customModels, ...extensions, streamSimple: transport.streamSimple };
}

export async function createWorkspaceOmpSession({ packageRoot, client, cwd, agentDir, sessionDirectory, savedSession = null, localSession = null,
  configuration, syntheticResponses = null, authorize = async () => {}, onModelRequest = async () => {}, onModelDispatched = () => {},
  maxModelCalls = 4, maxTokens = 1600, localFactory = null, providerTransport = null, readOnlyBusiness = false, humanControls = false, factoryTasks = false, hasUI = false, ordinaryTools = false, onModelAbort = () => {}, onModelWaiting = () => {},
  uiOnly = false, uiExtension = null, publicTools = {}, syntheticPublicSearchResponses = null, lifecycleSignal, pluginConfiguration = {}, referenceFence, enterpriseContextHost = null, freeTradeHost = null, publicTenderClient = null,
  nativeBusiness = false, factoryMaterials = false, factoryCustomers = false, factoryInquiries = false, factoryIngestion = false, marketValidation = false, shopifyProduct = false, medusaClient = null, brainClient = null, marketplaceClient = null, productClient = null, ingestionClient = null, planClient = null, monitorClient = null, materialsClient = null, inquiryClient = null, customerClient = null, engineScope = nativeBusiness ? 'omp:18.10.4:business-v1' : enterpriseContextHost ? 'omp:18.10.4:enterprise-context-v1' : freeTradeHost ? 'omp:18.10.4:free-trade-v1' : localFactory ? 'omp:18.10.4:local-factory-v1' : shopifyProduct ? 'omp:18.10.4:shopify-product-v1' : factoryIngestion ? 'omp:18.10.4:factory-ingestion-v1' : marketValidation ? 'omp:18.10.4:market-validation-v1' : factoryInquiries ? 'omp:18.10.4:factory-inquiries-v1' : factoryMaterials ? 'omp:18.10.4:factory-materials-v1' : factoryCustomers ? 'omp:18.10.4:factory-customers-v1' : OMP_ENGINE_SCOPE,
  bindingConfiguration = client ? 'configured_unverified' : 'unconfigured' }) {
  if(nativeBusiness&&(!factoryMaterials||!marketValidation||!shopifyProduct||localFactory||readOnlyBusiness||enterpriseContextHost||freeTradeHost||factoryIngestion||factoryCustomers||factoryInquiries||ordinaryTools||uiOnly))throw Error('NATIVE_BUSINESS_PROFILE_REQUIRED');
  if (providerTransport && !localFactory) throw Error('Bounded local provider transport requires the local factory profile.');
  if (localSession && (!localFactory || savedSession)) throw Error('LOCAL_SESSION_PROFILE_REFUSED');
  if (localFactory && (savedSession || readOnlyBusiness || factoryMaterials || factoryCustomers || factoryInquiries || factoryIngestion || marketValidation || shopifyProduct || productClient || ordinaryTools || uiOnly || client))
    throw Error('Local factory files cannot inherit remote profiles, clients or transcripts.');
  if (readOnlyBusiness && (factoryMaterials || factoryCustomers || factoryInquiries || factoryIngestion || marketValidation || shopifyProduct || productClient || ordinaryTools || uiOnly))
    throw Error('Session business reads require the original public tool profile.');
  const scopedHost=freeTradeHost||enterpriseContextHost;
  if(freeTradeHost&&enterpriseContextHost)throw Error('ONE_ORIGINAL_HOST_PROFILE_REQUIRED');
  if(scopedHost){
    if(localFactory||client||readOnlyBusiness||factoryMaterials||factoryCustomers||factoryInquiries||factoryIngestion||marketValidation||shopifyProduct||ordinaryTools||uiOnly)throw Error('FREE_TRADE_ORIGINAL_HOST_PROFILE_REQUIRED');
    if(freeTradeHost){const {assertFreeTradeHost}=await import('./workspace-free-trade-host.mjs');assertFreeTradeHost(freeTradeHost);}
    else{const {assertEnterpriseContextHost}=await import('./workspace-enterprise-context-host.mjs');assertEnterpriseContextHost(enterpriseContextHost);}
  }
  // Resolve the explicitly selected plugin before legacy profile dependencies.
  // A physically removed package must report its own useful missing-package
  // error even when the optional historical Pi frontend is not installed.
  const simplifiedProfile = scopedHost || factoryInquiries || factoryCustomers || factoryIngestion || marketValidation || shopifyProduct;
  const nativeSelection=nativeBusiness?await projectPlugins({configuration:'config.business.json',...pluginConfiguration}):null;
  const module = (enabled, name, entry='extension.js') => enabled && (!nativeBusiness || name==='workspace-procurement' || nativeSelection.enabled.some(p=>p.id===name)) ? requiredBusinessModule(name, entry) : {};
  const {shopifyProductExtension, SHOPIFY_PRODUCT_TOOLS=[], SHOPIFY_PRODUCT_SAFE_REASONS=[]} = await module(shopifyProduct,'workspace-shopify-product');
  const {marketValidationMonitorExtension, MARKET_MONITOR_TOOLS=[]} = await module(marketValidation,'workspace-market-validation','monitor.js');
  const {marketValidationExtension, MARKET_VALIDATION_TOOLS=[]} = await module(marketValidation,'workspace-market-validation');
  const {MEDUSA_CATALOG_TOOLS=[]}=await module(nativeBusiness,'workspace-medusa-catalog');
  const {isMarketplaceGap,marketplaceMessageReceipt}=await module(nativeBusiness,'workspace-marketplace','contract.js');
  const {factoryIngestionExtension, FACTORY_INGESTION_TOOLS=[]} = await module(factoryIngestion,'workspace-factory-ingestion');
  const {factoryInquiriesExtension, FACTORY_INQUIRY_TOOLS=[]} = await module(factoryInquiries,'workspace-factory-inquiries');
  const {factoryCustomersExtension, FACTORY_CUSTOMER_TOOLS=[]} = await module(factoryCustomers,'workspace-factory-customers');
  const {factoryMaterialsExtension, FACTORY_MATERIAL_TOOLS=[]} = await module(factoryMaterials,'workspace-factory-materials');
  const {factoryExtension, ORDINARY_FACTORY_TOOLS=[]} = await module(!localFactory && !readOnlyBusiness && !simplifiedProfile,'workspace-procurement');
  const {registerWorkspaceReadTools} = await module(readOnlyBusiness,'workspace-procurement','workspace-read.mjs');
  const {libraryReadHash} = await module(factoryMaterials || factoryIngestion,'workspace-procurement','library-model-read-contract.mjs');
  // Pure local/plugin sessions must not load legacy Pi/HTTP profile modules.
  // Selected historical profiles retain their original imports and guards.
  const { workspaceOmpPublicProfile } = !localFactory && !scopedHost
    ? await import('./workspace-omp-public-profile.mjs') : {};
  const { createWorkspaceOmpPublicTools, createWorkspaceOmpSyntheticPublicFetch, WORKSPACE_OMP_PUBLIC_PDF_POLICY } = !localFactory && !scopedHost
    ? await import('./workspace-omp-public-tools.mjs') : {};
  const { createWorkspaceOmpPublicTask } = !localFactory && !scopedHost
    ? await import('./workspace-omp-public-task.mjs') : {};
  const sdk = await loadWorkspaceOmpSdk(packageRoot);
  const disclosureGuards=[],originalAuthorize=authorize;
  authorize=async(...args)=>{await originalAuthorize(...args);for(const guard of disclosureGuards)await guard.check(...args);};
  const plugins = nativeSelection || (localFactory || scopedHost ? await projectPlugins(pluginConfiguration) : null);
  const declaredFiles = new Set(plugins?.enabled.flatMap(plugin => plugin.extensions));
  const nativePluginFiles = plugins ? (await sdk.discoverExtensionPaths(plugins.paths, cwd, undefined, { ambient: false }))
    .filter(file => declaredFiles.has(file)) : [];
  const privateProfile = factoryMaterials || factoryIngestion;
  const expectedScope = nativeBusiness ? 'omp:18.10.4:business-v1' : enterpriseContextHost ? 'omp:18.10.4:enterprise-context-v1' : freeTradeHost ? 'omp:18.10.4:free-trade-v1' : localFactory ? 'omp:18.10.4:local-factory-v1' : shopifyProduct ? 'omp:18.10.4:shopify-product-v1' : factoryIngestion ? 'omp:18.10.4:factory-ingestion-v1' : marketValidation ? 'omp:18.10.4:market-validation-v1' : factoryInquiries ? 'omp:18.10.4:factory-inquiries-v1' : factoryMaterials ? 'omp:18.10.4:factory-materials-v1' : factoryCustomers ? 'omp:18.10.4:factory-customers-v1' : OMP_ENGINE_SCOPE;
  if (shopifyProduct && (!factoryMaterials || !productClient || factoryIngestion || marketValidation && !nativeBusiness || factoryInquiries || factoryCustomers)) throw Error('Use the reviewed Shopify product Session.');
  if (engineScope !== expectedScope || factoryIngestion && (factoryMaterials || factoryCustomers || factoryInquiries || marketValidation || !ingestionClient)
    || marketValidation && (!factoryMaterials || !planClient || factoryCustomers || factoryInquiries) || factoryInquiries && (!factoryMaterials || !inquiryClient)
    || factoryMaterials && (!materialsClient || factoryCustomers) || privateProfile && (ordinaryTools || uiOnly)) throw Error('Use the reviewed original private Session profile.');

  // A single model-disclosure boundary refreshes the SAME original selector once.
  // Mutable cached views/status are always replaced; source/authority/extra keys
  // remain in the key and must pass the original client's validation.
  const shopifySnapshotKey = receipt => {
    const { view, status, ...source } = receipt;
    return 'shopify:' + libraryReadHash(source);
  };

  lifecycleSignal?.throwIfAborted();
  if (!configuration?.providerId || !configuration.model || !configuration.baseUrl || !uiOnly && !syntheticResponses && !configuration.apiKey)
    throw new Error('Workspace OMP model configuration is unconfigured. No sample, account or alternate model is selected.');
  if (!uiOnly && !syntheticResponses && (!configuration.remainingBudgetVerified || !configuration.cost
    || ['input', 'output', 'cacheRead', 'cacheWrite'].some(key => !Number.isFinite(configuration.cost[key]) || configuration.cost[key] < 0)))
    throw new Error('Workspace OMP live model cost and remaining budget are unverified. No paid request is admitted.');
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  const overrides = { 'compaction.enabled': false, 'compaction.midTurnEnabled': false,
    ...(localFactory ? { 'tools.intentTracing': false, 'compaction.supersedeReads': false, 'compaction.dropUseless': false } : {}),
    'retry.enabled': false, 'retry.modelFallback': false, 'startup.checkUpdate': false, 'startup.setupWizard': false,
    'telemetry.otlpExportEnabled': false, 'title.refreshOnReplan': false,
    'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'browser.headless': true,
    'eval.autoProvision': false,
    'task.batch': true, 'task.enableLsp': false, 'task.maxConcurrency': 2, 'task.maxRecursionDepth': 1,
    'task.maxRuntimeMs': 60000, 'task.softRequestBudget': 0, 'task.completionProbe': false, 'task.prewalk': false, 'task.structured': false,
    'task.speculativeLaunch': false, 'task.isolation.enabled': false, 'async.enabled': false };
  const settings = await sdk.Settings.init({ cwd, agentDir, inMemory: true, overrides });
  const factorySkillDirectory = new URL('../plugins/workspace-procurement/skills/factory/', import.meta.url).pathname;
  // Official loadSkillsFromDir scans child directories. Give it a dedicated
  // root containing only this selected public SKILL, never the legacy buyer skill.
  const selectedSkillRoot = path.join(agentDir, 'workspace-selected-skills');
  await fs.rm(selectedSkillRoot, { recursive: true, force: true });
  await fs.mkdir(selectedSkillRoot, { recursive: true, mode: 0o700 });
  if (!localFactory && !factoryCustomers && !factoryInquiries && !factoryIngestion && !marketValidation && !shopifyProduct) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory'));
    await fs.copyFile(path.join(factorySkillDirectory, 'SKILL.md'), path.join(selectedSkillRoot, 'factory/SKILL.md'));
  }
  if (factoryMaterials && !plugins) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-materials'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../plugins/workspace-factory-materials/skills/factory-materials/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-materials/SKILL.md'));
  }
  if (factoryCustomers) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-customers'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../plugins/workspace-factory-customers/skills/factory-customers/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-customers/SKILL.md'));
  }
  if (factoryInquiries) {
    await fs.mkdir(path.join(selectedSkillRoot, 'factory-inquiries'), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../plugins/workspace-factory-inquiries/skills/factory-inquiries/SKILL.md', import.meta.url), path.join(selectedSkillRoot, 'factory-inquiries/SKILL.md'));
  }
  for (const [active, kind] of [[factoryIngestion, 'factory-ingestion'], [marketValidation, 'market-validation'], [shopifyProduct, 'shopify-product']]) if (active && !plugins) {
    await fs.mkdir(path.join(selectedSkillRoot, kind), { recursive: true, mode: 0o700 });
    await fs.copyFile(new URL('../plugins/workspace-' + kind + '/skills/' + kind + '/SKILL.md', import.meta.url), path.join(selectedSkillRoot, kind + '/SKILL.md'));
  }
  if (plugins) for (const [index, skill] of plugins.skills.entries()) {
    await fs.cp(skill, path.join(selectedSkillRoot, 'plugin-' + index), { recursive: true });
  }
  const selectedSkills = await sdk.loadSkillsFromDir({ dir: selectedSkillRoot, source: 'custom:project' });
  assert.deepEqual(selectedSkills.warnings, []);
  if (!plugins) assert.deepEqual(selectedSkills.skills.map(skill => skill.name).sort(), shopifyProduct ? ['workspace-factory-materials', 'workspace-shopify-product'] : factoryIngestion ? ['workspace-factory-ingestion'] : marketValidation ? ['workspace-factory-materials', 'workspace-market-validation'] : factoryInquiries ? ['workspace-factory-inquiries', 'workspace-factory-materials'] : factoryMaterials ? ['workspace-factory', 'workspace-factory-materials'] : factoryCustomers ? ['workspace-factory-customers'] : ['workspace-factory']);
  const factorySkillContent = !localFactory && !scopedHost && !privateProfile && !factoryCustomers ? await fs.readFile(path.join(factorySkillDirectory, 'SKILL.md'), 'utf8') : '';
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
      if (message?.role !== 'toolResult' || ![...MEDUSA_CATALOG_TOOLS,...FACTORY_MATERIAL_TOOLS, ...(factoryInquiries ? FACTORY_INQUIRY_TOOLS : []), ...(factoryIngestion ? FACTORY_INGESTION_TOOLS : []), ...(marketValidation ? [...MARKET_VALIDATION_TOOLS, ...MARKET_MONITOR_TOOLS] : []), ...(shopifyProduct ? SHOPIFY_PRODUCT_TOOLS : [])].includes(message.toolName)) continue;
      let receipt;
      try { receipt = JSON.parse((message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')); }
      catch {
        // Official schema validation can fail before the extension runs. Such
        // errors have no data receipt; successful/partial material receipts in
        // every other journal entry are still revalidated below.
        if (message.isError === true && message.details === undefined) continue;
        throw Error('Factory cached receipt is malformed; no model disclosure is admitted.');
      }
      if (!['workspace-medusa-catalog','workspace-factory-materials', ...(factoryInquiries ? ['workspace-factory-inquiries'] : []), ...(factoryIngestion ? ['workspace-factory-ingestion'] : []), ...(marketValidation ? ['workspace-market-validation', 'workspace-market-monitor'] : []), ...(shopifyProduct ? ['workspace-shopify-product'] : [])].includes(receipt.plugin)) throw Error('Factory cached receipt provenance changed.');
      if (receipt.plugin === 'workspace-shopify-product' && !receipt.method) {
        if (!['blocked', 'unconfigured'].includes(receipt.status) || !SHOPIFY_PRODUCT_SAFE_REASONS.includes(receipt.reason)
          || Object.keys(receipt).some(k => !['plugin', 'status', 'reason', 'sources'].includes(k))
          || !Array.isArray(receipt.sources) || receipt.sources.length || message.content.some(b => b.type !== 'text')) throw Error('Original product gap receipt changed.');
        continue;
      }
      if(receipt.plugin==='workspace-medusa-catalog'&&!receipt.method){if(!isMedusaGapReceipt(receipt)||message.content.some(b=>b.type!=='text'))throw Error('MEDUSA_SOURCE_CHANGED');continue;}
      if (['unconfigured', 'blocked', 'unavailable'].includes(receipt.status) && Object.keys(receipt).every(key => ['plugin', 'status', 'reason', 'sources', 'detail', 'humanReviewRequired', 'humanReviewed', 'sent', 'externalActions', 'visibility', 'humanConfirmed', 'independentVerification', 'startedAt'].includes(key))
        && Array.isArray(receipt.sources) && receipt.sources.length === 0) continue;
      if(receipt.plugin==='workspace-medusa-catalog'){if(!medusaClient)throw Error('MEDUSA_SOURCE_CHANGED');const fresh=await medusaClient.refresh(receipt,model,signal);if(JSON.stringify(fresh)!==JSON.stringify(receipt))throw Error('MEDUSA_SOURCE_CHANGED');continue;}
      if (receipt.plugin === 'workspace-shopify-product') {
        const key = shopifySnapshotKey(receipt);
        if (!monitorSnapshots.has(key)) monitorSnapshots.set(key, await productClient.refresh(receipt, model, signal, message.content.filter(b => b.type === 'image')));
        continue;
      }
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
  let modelCalls = 0, preparedCalls=0; const completedUsage = new Map();
  const customApi = uiOnly ? 'workspace-omp-ui-only-disabled' : syntheticResponses ? 'workspace-omp-explicit-faux' : 'workspace-omp-pinned-openai';
  const buildSynthetic = (spec, model, callNumber, context) => {
    let args = spec.arguments || {};
    if (spec.sourcesFromPreviousTools) {
      if (!['workspace_factory_inquiry_save', 'workspace_market_validation_plan_save'].includes(spec.tool)) throw Error('Finite fixture source-copy target refused.');
      const names = spec.tool === 'workspace_market_validation_plan_save' ? ['workspace_market_validation_product'] : ['workspace_factory_document', 'workspace_factory_materials'];
      const sources = names.flatMap(name => {
        const previous = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === name);
        const receipt = JSON.parse(previous?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || 'null');
        if (!['workspace-medusa-catalog','workspace-factory-materials', 'workspace-market-validation'].includes(receipt?.plugin) || !Array.isArray(receipt.sources)) throw Error('Finite fixture requires actual original material receipts.');
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
    if(spec.parallelTools&&!(Array.isArray(spec.parallelTools)&&(localFactory&&spec.parallelTools.length===5&&spec.parallelTools.every(tool=>tool.name==='write')
      ||freeTradeHost&&spec.parallelTools.length===3&&spec.parallelTools.every(tool=>tool.name==='workspace_erpnext_read'))))throw Error('Finite scoped concurrent-tool fixture refused.');
    const content = spec.parallelTools ? spec.parallelTools.map((tool, index) => ({ type: 'toolCall', id: `workspace-omp-${callNumber}-${index}`, name: tool.name, arguments: tool.arguments }))
      : spec.tool ? [{ type: 'toolCall', id: `workspace-omp-${callNumber}`, name: spec.tool, arguments: args }]
      : [{ type: 'text', text: spec.text || 'Explicit synthetic model response.' }];
    return { role: 'assistant', content, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      stopReason: spec.tool || spec.parallelTools ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  };
  const modelDefinition = { id: configuration.model, name: uiOnly ? 'UI only; original host executes the selected model' : 'Workspace explicitly configured model', reasoning: false, input: shopifyProduct ? ['text', 'image'] : ['text'],
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
        if (shopifyProduct) for (const message of context.messages || []) {
          if (message?.role !== 'toolResult' || !SHOPIFY_PRODUCT_TOOLS.includes(message.toolName)) continue;
          let receipt; try { receipt = JSON.parse(message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')); } catch { continue; }
          if (!receipt.method) { message.details = receipt; continue; }
          const fresh = monitorSnapshots.get(shopifySnapshotKey(receipt));
          if (!fresh) throw Error('Original product snapshot required.');
          const { nativeContent = [], ...data } = fresh;
          message.content = [{ type: 'text', text: JSON.stringify(data) }, ...nativeContent]; message.details = data;
        }
        if (marketValidation) for (const message of context.messages || []) {
          if (message?.role !== 'toolResult' || !MARKET_MONITOR_TOOLS.includes(message.toolName)) continue;
          let receipt; try { receipt = JSON.parse(message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')); } catch { continue; }
          if (!receipt.input) continue;
          const fresh = monitorSnapshots.get(libraryReadHash([receipt.input, receipt.requestedAction]));
          if (!fresh) throw Error('Original monitor snapshot required.');
          message.content = [{ type: 'text', text: JSON.stringify(fresh) }]; message.details = fresh;
        }
        // Fail stale private sources before recording/reserving another model
        // request. Recheck below after the host request hook closes its race.
        if(scopedHost)await authorize({phase:'model:prepare'});
        const callNumber = enterpriseContextHost?++preparedCalls:++modelCalls;
        if (callNumber > maxModelCalls || model.provider !== configuration.providerId || model.id !== configuration.model || model.baseUrl !== configuration.baseUrl)
          throw new Error('The original admitted request count or pinned OMP receiver changed.');
        await onModelRequest({ modelCalls: callNumber });
        const signal = options?.signal;
        if (signal?.aborted) throw new Error('Workspace OMP turn cancelled.');
        if(localFactory||scopedHost||nativeBusiness)await authorize({phase:'model:disclose'});
        const permit=async wireBody=>{
          if(nativeBusiness){
            await authorize({phase:'model:disclose'});
            const freshSnapshots=await revalidateFactoryContext([...(manager?.getEntries() || []).map(e=>e.message),...(context.messages||[])],model,signal);
            // Initial refresh is before the async request hook. The exact views
            // about to leave must still equal a fresh original-client projection.
            for(const message of context.messages||[]){
              if(message?.role!=='toolResult')continue;
              let receipt;try{receipt=JSON.parse((message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n'));}catch{continue;}
              let fresh;
              if(receipt.plugin==='workspace-shopify-product'&&receipt.method){const value=freshSnapshots.get(shopifySnapshotKey(receipt));if(value){const {nativeContent,...data}=value;fresh=data;}}
              if(receipt.plugin==='workspace-market-monitor'&&receipt.input)fresh=freshSnapshots.get(libraryReadHash([receipt.input,receipt.requestedAction]));
              if(fresh&&libraryReadHash(fresh)!==libraryReadHash(receipt))throw Error('NATIVE_BUSINESS_WIRE_SOURCE_CHANGED');
            }
            await authorize({phase:'model:disclose'});
          }
          if(enterpriseContextHost){
            const control=enterpriseContextHost.open(manager.getSessionId());
            const snapshot=manager.getBranch().findLast(e=>e.type==='custom'&&e.customType==='workspace-plugin-disclosure-snapshot'&&e.data?.id==='workspace-enterprise-context-private-v1')?.data.snapshot;
            const memoryProofs=(snapshot?.proofs||[]).filter(proof=>proof.kind==='memory');
            await control.authorizeDisclosure({messages:manager.getEntries().flatMap(e=>e.message?[e.message]:[]),context:context.messages,memoryProofs,modelCalls:callNumber,...(wireBody===undefined?{}:{wireBody})},signal,model);
          }
          signal?.throwIfAborted();
        };
        await permit();
        let dispatched=false;
        const dispatch=()=>{if(!dispatched){dispatched=true;if(enterpriseContextHost){modelCalls=callNumber;onModelDispatched({modelCalls:callNumber});}}};
        if (syntheticResponses) {
          const spec = syntheticResponses[callNumber - 1];
          if (!spec) throw new Error('Finite explicit faux responses exhausted; no real provider fallback.');
          if (spec.expectedToolNames) assert.deepEqual((context.tools || []).map(tool => tool.name).sort(), [...spec.expectedToolNames].sort());
          if (spec.forbiddenContextText) assert.ok(!JSON.stringify(context.messages).includes(spec.forbiddenContextText), 'Explicit fixture refused stale or forged monitor context.');
          if (spec.expectedContextText) assert.ok(JSON.stringify(context.messages).includes(spec.expectedContextText), 'Explicit fixture expected the original public tool/child receipt.');
          dispatch();
          if (spec.wait) await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, spec.wait);
            signal?.addEventListener('abort', () => { clearTimeout(timer); onModelAbort(); reject(new Error('Explicit synthetic model cancelled')); }, { once: true });
            onModelWaiting();
          });
          const message = buildSynthetic(spec, model, callNumber, context);
          completedUsage.set(callNumber, message.usage);
          await authorize(localFactory||scopedHost?{phase:'model:complete'}:undefined);
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
          const disclosureAbort=new AbortController();
          const upstream = sdk.streamSimple({ ...model, api: 'openai-completions' }, context, { ...options, apiKey: configuration.apiKey,
            maxTokens: Math.min(Math.floor(maxTokens / maxModelCalls), options?.maxTokens || Infinity), maxRetries: 0,
            ...((enterpriseContextHost||nativeBusiness)?{signal:AbortSignal.any([signal,disclosureAbort.signal].filter(Boolean)),fetch:async(input,init)=>{
              try{if(dispatched)throw Error('OSS_MODEL_RETRY_NOT_ADMITTED');
                const request=new Request(input instanceof Request?input.clone():input,init),body=await request.clone().text();
                await permit(body);dispatch();return await globalThis.fetch(request);
              }catch(error){disclosureAbort.abort(error);throw error;}
            }}:{}),
            ...(providerTransport ? { fetch: providerTransport.fetch, onSseEvent: providerTransport.onSseEvent, acceptEmptyResponse: true,
              signal: AbortSignal.any([options?.signal, providerTransport.signal].filter(Boolean)) } : {}) });
          for await (const event of upstream) {
            if (event.type === 'done') { providerTransport?.complete(event.message); completedUsage.set(callNumber, event.message?.usage); await authorize(localFactory||scopedHost?{phase:'model:complete'}:undefined); }
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
  publicExtension = !localFactory && !scopedHost && !readOnlyBusiness && !uiOnly && !ordinaryTools && !privateProfile ? await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize, signal: lifecycleSignal,
    configuration: publicTools, fetchImpl: createWorkspaceOmpSyntheticPublicFetch({ responses: syntheticPublicSearchResponses, explicitFaux: Boolean(syntheticResponses) }) })
    : { tools: [], toolNames: [], capabilities: { status: 'not-enabled-in-ui-only-or-ordinary-host' }, close: async () => {} };
  publicTask = !localFactory && !scopedHost && !readOnlyBusiness && !uiOnly && !ordinaryTools && !privateProfile ? await createWorkspaceOmpPublicTask({ packageRoot, toolSession, configuration, authorize })
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
  const pluginDiagnostics = new Map();
  if (plugins) eventBus.on('workspace:plugin-host', request => request.accept({ selection: localFactory, packageRoot, toolSession,
    authorize, ...(nativeBusiness?{materialsClient,planClient,monitorClient,productClient,medusaClient,marketplaceClient,registerMarketplaceContextGuard:({validateReceipt})=>{
      if(!marketplaceClient||validateReceipt!==marketplaceClient.revalidateReceipt)return false;
      disclosureGuards.push({id:'workspace-business-marketplace-v1',check:async()=>{
        for(const entry of manager.getEntries()){const message=entry.message;if(message?.role!=='toolResult'||!message.toolName?.startsWith('workspace_marketplace_'))continue;
          const receipt=marketplaceMessageReceipt(message);
          if(!receipt.method){if(!isMarketplaceGap(receipt)||message.content.some(b=>b.type!=='text'))throw Error('MARKETPLACE_SOURCE_CHANGED');continue;}
          await marketplaceClient.revalidateReceipt(receipt,lifecycleSignal,created?.session?.model||modelRegistry.find(configuration.providerId,configuration.model));
        }
      }});return true;
    },brain:brainClient,registerBrainContextGuard:({validateReceipt})=>{
      if(!brainClient||validateReceipt!==brainClient.revalidateReceipt)return false;
      disclosureGuards.push({id:"workspace-business-brain-v1",check:async()=>{
        for(const entry of manager.getEntries()){const message=entry.message;if(message?.role!=="toolResult"||!message.toolName?.startsWith("workspace_brain_"))continue;
          let receipt;try{receipt=JSON.parse(message.content.filter(b=>b.type==="text").map(b=>b.text).join("\n"));}catch{throw Error("BRAIN_CACHE_REFUSED");}
          if(["blocked","unconfigured"].includes(receipt.status)){if(!isBrainGapReceipt(receipt)||message.content.some(b=>b.type!=="text"))throw Error("BRAIN_CACHE_REFUSED");continue;}
          await brainClient.revalidateReceipt(receipt,lifecycleSignal,created?.session?.model||modelRegistry.find(configuration.providerId,configuration.model));
        }
      }});return true;
    }}:{}), referenceFence,privateContext:Boolean(nativeBusiness||scopedHost||localFactory&&!localFactory.options?.publicOnly),enterpriseContext:enterpriseContextHost,freeTrade:freeTradeHost,publicTenderClient,nativeSessionId:manager.getSessionId(),
    getModel:()=>created?.session?.model||modelRegistry.find(configuration.providerId,configuration.model),signal:lifecycleSignal,addDisclosureGuard:(check,id)=>{
      if(typeof check!=='function'||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('WORKSPACE_DISCLOSURE_GUARD_INVALID');
      disclosureGuards.push({id,check});
    },disclosureSnapshot:id=>manager.getBranch().findLast(entry=>entry.type==='custom'&&entry.customType==='workspace-plugin-disclosure-snapshot'&&entry.data?.id===id)?.data.snapshot,
    recordDisclosure:(id,snapshot)=>{
      if(!disclosureGuards.some(guard=>guard.id===id)||Buffer.byteLength(JSON.stringify(snapshot))>65536)throw Error('WORKSPACE_DISCLOSURE_SNAPSHOT_REFUSED');
      manager.appendCustomEntry('workspace-plugin-disclosure-snapshot',{id,snapshot});
    },history: manager.buildSessionContext().messages, diagnostics: (name, report) => pluginDiagnostics.set(name, report) }));
  const simplified = scopedHost || factoryInquiries || factoryCustomers || factoryIngestion || marketValidation || shopifyProduct;
  const admittedTools = nativeBusiness ? skillTools.map(t=>t.name) : localFactory || scopedHost ? [] : readOnlyBusiness ? ['workspace_business_tasks', 'workspace_business_result'] : [...(simplified ? [] : ORDINARY_FACTORY_TOOLS), ...skillTools.map(t => t.name), ...(!simplified && factoryTasks ? ['workspace_factory_task'] : []), ...publicExtension.toolNames, ...publicTask.toolNames, ...(factoryMaterials ? FACTORY_MATERIAL_TOOLS : []), ...(factoryCustomers ? FACTORY_CUSTOMER_TOOLS : []), ...(factoryInquiries ? FACTORY_INQUIRY_TOOLS : []), ...(factoryIngestion ? FACTORY_INGESTION_TOOLS : []), ...(marketValidation ? [...MARKET_VALIDATION_TOOLS, ...MARKET_MONITOR_TOOLS] : []), ...(shopifyProduct ? SHOPIFY_PRODUCT_TOOLS : [])];
  if (savedSession && !ordinaryTools && !plugins) {
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
    extensions: [...(!nativeBusiness && shopifyProduct ? [shopifyProductExtension({ client: productClient, authorize })] : []), ...(factoryIngestion ? [factoryIngestionExtension({ client: ingestionClient, authorize })] : []), ...(!nativeBusiness && marketValidation ? [marketValidationExtension({ client: planClient, authorize }), marketValidationMonitorExtension({ client: monitorClient, authorize })] : []), ...(factoryInquiries ? [factoryInquiriesExtension({ client: inquiryClient, authorize })] : []), ...(factoryCustomers ? [factoryCustomersExtension({ authorize, client: customerClient })] : []), ...(!nativeBusiness && factoryMaterials ? [factoryMaterialsExtension({ client: materialsClient, authorize })] : []), ...(localFactory || scopedHost ? [] : readOnlyBusiness ? [pi => registerWorkspaceReadTools(pi, client, { library: false })] : simplified ? [] : [factoryExtension({ client, humanControls, factoryTasks, configuration: bindingConfiguration })]),
      pi => [...publicExtension.tools, ...publicTask.tools, ...skillTools].forEach(tool => pi.registerTool(tool)),
      ...ordinaryTools || localFactory || scopedHost || nativeBusiness ? [] : [workspaceOmpPublicProfile(admittedTools)], ...(uiExtension ? [uiExtension] : [])],
    disableExtensionDiscovery: true, additionalExtensionPaths: nativePluginFiles, skills: selectedSkills.skills, appendSystemPrompt: privateProfile || factoryCustomers ? undefined : factorySkillContent,
    rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    ...ordinaryTools ? {} : { toolNames: [] }, spawns: '', hasUI, autoTitle: false, interactivePrompts: hasUI, eventBus, subagentEventBus,
    cacheWarming: false, allowSessionModelFallback: false });
  const session = created.session;
  if(created.extensionsResult.errors.length)throw Object.assign(Error('PROJECT_PLUGIN_INITIALIZATION_FAILED'),{code:'PROJECT_PLUGIN_INITIALIZATION_FAILED',stage:'plugin-initialization',pluginReason:created.extensionsResult.errors.map(row=>(row.error||'').match(/\b(FREE_TRADE_[A-Z0-9_]+)\b/)?.[1]).find(Boolean)});
  const requiredGuards=new Set(manager.getEntries().filter(e=>e.type==='custom'&&e.customType==='workspace-disclosure-guard-required').flatMap(e=>e.data?.ids||[]));
  if([...requiredGuards].some(id=>!disclosureGuards.some(guard=>guard.id===id)))throw Error('WORKSPACE_DISCLOSURE_GUARD_REQUIRED');
  const newGuards=disclosureGuards.map(guard=>guard.id).filter(id=>!requiredGuards.has(id));
  if(newGuards.length)manager.appendCustomEntry('workspace-disclosure-guard-required',{ids:newGuards});
  if (plugins) {
    const explicitFiles = new Set(plugins.enabled.flatMap(plugin => plugin.extensions));
    const names = created.extensionsResult.extensions.filter(extension => explicitFiles.has(extension.path))
      .flatMap(extension => [...extension.tools.keys()]);
    if (new Set(names).size !== names.length) throw Error('PROJECT_PLUGIN_TOOL_COLLISION');
    admittedTools.push(...names);
    providerTransport?.configureTools?.(admittedTools);
  }
  if(savedSession&&plugins)for(const entry of manager.getBranch()){
    const message=entry.message;
    if(message?.role==='toolResult'&&!admittedTools.includes(message.toolName)||message?.role==='assistant'&&message.content?.some(block=>block.type==='toolCall'&&!admittedTools.includes(block.name)))throw Error('PROJECT_PLUGIN_HISTORY_TOOL_REFUSED');
  }
  if (localFactory || scopedHost || nativeBusiness || readOnlyBusiness) await session.setActiveToolsByName(admittedTools);
  if (privateProfile || factoryCustomers || scopedHost) {
    const { initializeExtensions } = await import(pathToFileURL(path.join(packageRoot, 'src/modes/runtime-init.ts')).href);
    await initializeExtensions(session, { reportSendError: () => {}, reportRuntimeError: () => {},
      filterActiveTools: names => names.filter(name => admittedTools.includes(name)) });
    await revalidateFactoryContext(manager.getEntries().map(e => e.message), session.model, lifecycleSignal);
  }
  for (const forbidden of ['workspace_company_profile', 'workspace_products', 'workspace_product']) assert.ok(!session.getActiveToolNames().includes(forbidden));
  return { ...created, sdk, authStorage, modelRegistry, manager, engineScope, modelCalls: () => modelCalls,
    publicCapabilities: publicExtension.capabilities, localContext: () => pluginDiagnostics.get('local-materials')?.(), plugins: plugins && { discovered: plugins.installed.map(p => p.id), enabled: plugins.enabled.map(p => p.id) },
    usage() {
      const sum = key => completedUsage.size === modelCalls && [...completedUsage.values()].every(row => Number.isSafeInteger(row?.[key]) && row[key] >= 0)
        ? [...completedUsage.values()].reduce((total, row) => total + row[key], 0) : null;
      return { promptTokens: sum('input'), completionTokens: sum('output'), totalTokens: sum('totalTokens') };
    },
    summarizeToolArguments: (...args) => pluginDiagnostics.get('arguments')?.(...args) || { objectArguments: args[1] !== null && typeof args[1] === 'object' && !Array.isArray(args[1]) },
    selectedSkillNames: selectedSkills.skills.map(skill => skill.name),authorizeDisclosure:async (...args)=>{await authorize(...args);if(nativeBusiness)await revalidateFactoryContext(manager.getEntries().map(e=>e.message),session.model,lifecycleSignal);},
    async close() { return closePromise ??= (async () => { try { await session.dispose(); } finally { await cleanup(); } })(); } };
  } catch (error) {
    try { await created?.session.dispose(); } finally { await cleanup(); }
    throw error;
  }
}
