// Bun-only integration with the reviewed official OMP SDK. This file supplies
// configuration and a provider transport; OMP owns the agent/tool/session loop.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { factoryExtension } from '../packages/workspace-procurement/src/extension.js';

export const OMP_VERSION = '18.10.4';
export const OMP_ENGINE_SCOPE = 'omp:18.10.4:public-v1';
export async function loadWorkspaceOmpSdk(packageRoot) {
  if (!globalThis.Bun) throw new Error('Workspace OMP requires the reviewed Bun runtime; Node is not an OMP fallback.');
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json')));
  assert.equal(manifest.name, '@oh-my-pi/pi-coding-agent'); assert.equal(manifest.version, OMP_VERSION);
  const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
  const [sdk, settings, registry, sessions, auth, streams, transport, skills] = await Promise.all([
    load('sdk.ts'), load('config/settings.ts'), load('config/model-registry.ts'), load('session/session-manager.ts'), load('session/auth-storage.ts'),
    import(pathToFileURL(path.join(packageRoot, '../pi-ai/src/utils/event-stream.ts')).href),
    import(pathToFileURL(path.join(packageRoot, '../pi-ai/src/stream.ts')).href),
    load('extensibility/skills.ts'),
  ]);
  return { ...sdk, ...settings, ...registry, ...sessions, ...auth, ...streams, ...skills, streamSimple: transport.streamSimple };
}

export async function createWorkspaceOmpSession({ packageRoot, client, cwd, agentDir, sessionDirectory, savedSession = null,
  configuration, syntheticResponses = null, authorize = async () => {}, onModelRequest = async () => {},
  maxModelCalls = 4, maxTokens = 1600, humanControls = false, factoryTasks = false, hasUI = false, ordinaryTools = false }) {
  const sdk = await loadWorkspaceOmpSdk(packageRoot);
  if (!configuration?.providerId || !configuration.model || !configuration.baseUrl || !syntheticResponses && !configuration.apiKey)
    throw new Error('Workspace OMP model configuration is unconfigured. No sample, account or alternate model is selected.');
  if (!syntheticResponses && (!configuration.remainingBudgetVerified || !configuration.cost
    || ['input', 'output', 'cacheRead', 'cacheWrite'].some(key => !Number.isFinite(configuration.cost[key]) || configuration.cost[key] < 0)))
    throw new Error('Workspace OMP live model cost and remaining budget are unverified. No paid request is admitted.');
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  const overrides = { 'compaction.enabled': false, 'compaction.midTurnEnabled': false,
    'retry.enabled': false, 'retry.modelFallback': false, 'startup.checkUpdate': false, 'startup.setupWizard': false,
    'telemetry.otlpExportEnabled': false, 'title.refreshOnReplan': false };
  const settings = await sdk.Settings.init({ cwd, agentDir, inMemory: true, overrides });
  const factorySkillDirectory = new URL('../packages/workspace-procurement/skills/factory/', import.meta.url).pathname;
  // Official loadSkillsFromDir scans child directories. Give it a dedicated
  // root containing only this selected public SKILL, never the legacy buyer skill.
  const selectedSkillRoot = path.join(agentDir, 'workspace-selected-skills');
  await fs.mkdir(path.join(selectedSkillRoot, 'factory'), { recursive: true, mode: 0o700 });
  await fs.copyFile(path.join(factorySkillDirectory, 'SKILL.md'), path.join(selectedSkillRoot, 'factory/SKILL.md'));
  const selectedSkills = await sdk.loadSkillsFromDir({ dir: selectedSkillRoot, source: 'custom:project' });
  assert.deepEqual(selectedSkills.warnings, []);
  assert.deepEqual(selectedSkills.skills.map(skill => skill.name), ['workspace-factory']);
  const factorySkillContent = await fs.readFile(path.join(factorySkillDirectory, 'SKILL.md'), 'utf8');
  const authStorage = await sdk.AuthStorage.create(agentDir + '/auth.db');
  const modelRegistry = new sdk.ModelRegistry(authStorage, agentDir + '/no-ambient-models.yml', { settings, ignoreLocalModelConfig: true });
  let modelCalls = 0;
  const customApi = syntheticResponses ? 'workspace-omp-explicit-faux' : 'workspace-omp-pinned-openai';
  const buildSynthetic = (spec, model) => {
    const content = spec.tool ? [{ type: 'toolCall', id: `workspace-omp-${modelCalls}`, name: spec.tool, arguments: spec.arguments || {} }]
      : [{ type: 'text', text: spec.text || 'Explicit synthetic model response.' }];
    return { role: 'assistant', content, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      stopReason: spec.tool ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  };
  modelRegistry.registerProvider(configuration.providerId, {
    api: customApi, apiKey: syntheticResponses ? 'explicit-finite-keyless-test-provider' : configuration.apiKey, baseUrl: configuration.baseUrl,
    models: [{ id: configuration.model, name: 'Workspace explicitly configured model', reasoning: false, input: ['text'],
      cost: syntheticResponses ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : configuration.cost,
      contextWindow: 32000, maxTokens: Math.max(1, Math.floor(maxTokens / maxModelCalls)) }],
    streamSimple(model, context, options) {
      const stream = new sdk.AssistantMessageEventStream();
      void (async () => {
        await authorize();
        if (++modelCalls > maxModelCalls || model.provider !== configuration.providerId || model.id !== configuration.model || model.baseUrl !== configuration.baseUrl)
          throw new Error('The original admitted request count or pinned OMP receiver changed.');
        await onModelRequest({ modelCalls });
        const signal = options?.signal;
        if (signal?.aborted) throw new Error('Workspace OMP turn cancelled.');
        if (syntheticResponses) {
          const spec = syntheticResponses[modelCalls - 1];
          if (!spec) throw new Error('Finite explicit faux responses exhausted; no real provider fallback.');
          if (spec.wait) await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, spec.wait);
            signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Explicit synthetic model cancelled')); }, { once: true });
          });
          const message = buildSynthetic(spec, model);
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
          for await (const event of upstream) stream.push(event);
        }
      })().catch(error => stream.fail(new Error(error.message.replaceAll(configuration.apiKey || '\0', '[REDACTED]'))));
      return stream;
    },
  });
  const manager = savedSession ? sdk.SessionManager.open(savedSession.sessionFile, sessionDirectory)
    : sdk.SessionManager.create(cwd, sessionDirectory);
  if (savedSession && (savedSession.engineScope !== OMP_ENGINE_SCOPE || manager.getSessionId() !== savedSession.agentSessionId || path.resolve(manager.getCwd()) !== cwd))
    throw new Error('This is not the current OMP public-only transcript; Pi/private history cannot migrate.');
  // A public-only session never discovers enterprise files, ambient auth, MCP,
  // user/project extensions, rules or skills. The ordinary factory extension
  // itself leaves the official host unchanged; the web host supplies this scope.
  const created = await sdk.createAgentSession({ cwd, agentDir, settings, modelRegistry, authStorage,
    model: modelRegistry.find(configuration.providerId, configuration.model), sessionManager: manager,
    extensions: [factoryExtension({ client, humanControls, factoryTasks, configuration: client ? 'configured_unverified' : 'unconfigured' })],
    disableExtensionDiscovery: true, skills: selectedSkills.skills, appendSystemPrompt: factorySkillContent,
    rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    ...ordinaryTools ? {} : { toolNames: [] }, spawns: '', hasUI, autoTitle: false, interactivePrompts: hasUI,
    allowSessionModelFallback: false });
  const session = created.session;
  assert.deepEqual(created.extensionsResult.errors, []);
  for (const forbidden of ['workspace_company_profile', 'workspace_products', 'workspace_product']) assert.ok(!session.getActiveToolNames().includes(forbidden));
  return { ...created, sdk, authStorage, modelRegistry, manager, modelCalls: () => modelCalls,
    selectedSkillNames: selectedSkills.skills.map(skill => skill.name),
    async close() { await session.dispose(); authStorage.close(); } };
}
