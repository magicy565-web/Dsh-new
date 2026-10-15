// Official SDK and finite scripted provider. Client callbacks here are synthetic;
// original Session/Store/artifact authority is tested in the separate service suite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { marketPlan, marketServicePlan } from './market-validation-plan-data.mjs';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
let fetchAttempts = 0;
globalThis.fetch = async () => { fetchAttempts++; throw Error('External HTTP is forbidden in this keyless SDK fixture.'); };
const { marketValidationExtension, MARKET_VALIDATION_TOOLS } = await import(pathToFileURL(path.join(config.packageDir, 'src/extension.js')).href);
const { marketValidationMonitorExtension, MARKET_MONITOR_TOOLS } = await import(pathToFileURL(path.join(config.packageDir, 'src/monitor.js')).href);
const id = '11111111-1111-4111-8111-111111111111';
const sources = [{ kind: 'factory-product', recordId: id, revision: 1, workspaceId: 'synthetic', projectionSha256: 'a'.repeat(64), api: '/synthetic/materials' }];
let authorizations = 0, reads = 0, saves = 0, active = true, fail = false, revokeAfter = false, modelCalls = 0, lastRead, lastSaved;
const authorize = async (signal, model) => { authorizations++; signal?.throwIfAborted(); assert.equal(model.id, 'finite'); if (!active) throw Error('PRIVATE_HOST_ERROR'); };
const client = { read: async input => { lastRead = input; reads++; if (fail) throw Error('PRIVATE_HOST_ERROR'); if (revokeAfter) active = false;
  return { plugin: 'workspace-market-validation', status: 'available', sources, syntheticProduct: true }; },
save: async input => { lastSaved = input; saves++; return { plugin: 'workspace-market-validation', status: 'saved-draft', sources, syntheticSaved: true }; } };
const responses = [];
let session, auth, sdk, faux;
if (config.engine === 'pi') {
  sdk = await import(config.piSdk); const ai = await import(config.piAi), fixture = await import(config.piFaux);
  faux = fixture.fauxProvider({ api: 'faux', provider: 'market-plan-test-faux', models: [{ id: 'finite', maxTokens: 256 }] });
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = sdk.SettingsManager.create(config.directory, config.agentDir); settingsManager.setCompactionEnabled(false);
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd: config.directory, agentDir: config.agentDir, settingsManager,
    noContextFiles: true, noSkills: true, noExtensions: true, extensionFactories: [marketValidationExtension({ client, authorize }), marketValidationMonitorExtension()] });
  await resourceLoader.reload();
  const created = await sdk.createAgentSession({ cwd: config.directory, agentDir: config.agentDir, settingsManager,
    resourceLoader, modelRuntime, model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(config.directory) });
  session = created.session; await session.bindExtensions({});
} else {
  assert.equal(Bun.version, '1.3.14');
  const load = relative => import(pathToFileURL(path.join(config.ompRoot, relative)).href);
  sdk = { ...await load('src/sdk.ts'), ...await load('src/config/settings.ts'), ...await load('src/session/auth-storage.ts'),
    ...await load('src/config/model-registry.ts'), ...await load('src/session/session-manager.ts'), ...await load('../pi-ai/src/utils/event-stream.ts') };
  const settings = await sdk.Settings.init({ cwd: config.directory, agentDir: config.agentDir, inMemory: true, overrides: {
    'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false, 'retry.enabled': false,
    'retry.modelFallback': false, 'compaction.enabled': false, 'compaction.midTurnEnabled': false, 'eval.py': false, 'eval.autoProvision': false } });
  auth = await sdk.AuthStorage.create(path.join(config.agentDir, 'empty-auth.db'));
  const registry = new sdk.ModelRegistry(auth, path.join(config.agentDir, 'absent-models.yml'), { settings, ignoreLocalModelConfig: true });
  registry.registerProvider('market-plan-test-faux', { api: 'market-plan-explicit-faux', apiKey: 'explicit-keyless-test-value', baseUrl: 'https://synthetic.invalid',
    models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
    streamSimple(model) {
      const stream = new sdk.AssistantMessageEventStream();
      try {
        const spec = responses.shift(); assert.ok(spec, 'Finite test exhausted; no fallback'); modelCalls++;
        const message = { role: 'assistant', ...spec, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: 'start', partial: message });
        message.content.forEach((block, contentIndex) => stream.push(block.type === 'toolCall'
          ? { type: 'toolcall_end', contentIndex, toolCall: block, partial: message }
          : { type: 'text_end', contentIndex, content: block.text, partial: message }));
        stream.push({ type: 'done', reason: message.stopReason, message });
      } catch (error) { stream.fail(error); }
      return stream;
    } });
  const created = await sdk.createAgentSession({ cwd: config.directory, agentDir: config.agentDir, settings, authStorage: auth, modelRegistry: registry,
    model: registry.find('market-plan-test-faux', 'finite'), sessionManager: sdk.SessionManager.inMemory(config.directory),
    extensions: [marketValidationExtension({ client, authorize }), marketValidationMonitorExtension()], disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [],
    promptTemplates: [], slashCommands: [], enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    toolNames: [], spawns: '', hasUI: false, autoTitle: false, cacheWarming: false, allowSessionModelFallback: false });
  assert.deepEqual(created.extensionsResult.errors, []); session = created.session;
  const { initializeExtensions } = await load('src/modes/runtime-init.ts');
  await initializeExtensions(session, { mode: 'print', reportSendError: (_action, error) => { throw error; }, reportRuntimeError: error => { throw Error(error.error); } });
}
try {
  assert.ok(MARKET_VALIDATION_TOOLS.every(name => session.getActiveToolNames().includes(name)));
  let toolCalls = 0;
  async function prompt(specs) {
    const messages = specs.map(([name, args]) => ({ content: [{ type: 'toolCall', id: 'market-fixture-' + ++toolCalls, name, arguments: args }], stopReason: 'toolUse' }));
    messages.push({ content: [{ type: 'text', text: 'Synthetic test complete; no real plan execution.' }], stopReason: 'stop' });
    if (faux) { const { fauxAssistantMessage } = await import(config.piFaux); faux.setResponses(messages.map(m => fauxAssistantMessage(m.content, { stopReason: m.stopReason }))); }
    else responses.push(...messages);
    await session.prompt('Run only this finite synthetic goal-driven test.');
    const row = session.messages.filter(m => m.role === 'toolResult').at(-1);
    if (!specs.length) return null;
    try { return JSON.parse(row.content.filter(c => c.type === 'text').map(c => c.text).join('\n')); }
    catch { assert.equal(row.isError, true); return { status: 'blocked' }; }
  }
  // Asking a clarification may end a turn with no tool or saved artifact.
  await prompt([]); assert.equal(reads, 0); assert.equal(saves, 0);
  assert.equal((await prompt([[MARKET_VALIDATION_TOOLS[0], { productId: id, documents: [] }]])).status, 'available');
  for (const mode of ['b2b', 'b2c', 'dual']) {
    const p = mode === 'b2c' ? marketServicePlan(id) : marketPlan(mode); p.paths[0].steps = ['A freely model-authored action; no fixed funnel.'];
    const result = await prompt([[MARKET_VALIDATION_TOOLS[1], { productId: id, documents: [], sources, plan: p, requestId: mode }]]);
    assert.equal(result.status, 'saved-draft'); assert.equal(result.humanReviewed, false); assert.equal(result.startedAt, null);
    if (mode === 'b2c') { assert.equal(lastSaved.plan.paths[0].serviceTarget.targetUnits, 50); assert.equal(lastSaved.plan.paths[0].marketReference.sourcePlatform, 'tiktok'); }
  }
  for (const [name, args] of [[MARKET_MONITOR_TOOLS[0], { requestId: 'monitor', planId: id, planRevision: 1, launchReceiptId: 'synthetic' }], [MARKET_MONITOR_TOOLS[1], { goalId: id }], [MARKET_MONITOR_TOOLS[2], { goalId: id, action: 'pause' }]]) {
    assert.equal((await prompt([[name, args]])).status, 'unconfigured');
  }
  const before = reads;
  const extra = await prompt([[MARKET_VALIDATION_TOOLS[0], { productId: id, documents: [], fields: ['privateCost'] }]]);
  // OMP 18.10.4 repairs unknown keys by removing them before executing a tool;
  // Pi rejects this raw call. Neither passes a model-selected field to client.
  assert.equal(extra.status, config.engine === 'omp' ? 'available' : 'blocked');
  assert.equal(reads, before + (config.engine === 'omp' ? 1 : 0));
  assert.equal(lastRead.fields, undefined);
  fail = true; assert.equal((await prompt([[MARKET_VALIDATION_TOOLS[0], { productId: id, documents: [] }]])).status, 'blocked'); fail = false;
  active = false; const count = reads;
  assert.equal((await prompt([[MARKET_VALIDATION_TOOLS[0], { productId: id, documents: [] }]])).status, 'blocked'); assert.equal(reads, count);
  active = true; revokeAfter = true;
  const revoked = await prompt([[MARKET_VALIDATION_TOOLS[0], { productId: id, documents: [] }]]);
  assert.equal(revoked.status, 'blocked'); assert.deepEqual(revoked.sources, []);
  assert.ok(!JSON.stringify(revoked).includes('PRIVATE_HOST_ERROR'));
  assert.equal(fetchAttempts, 0);
  const evidence = { engine: config.engine, version: config.engine === 'pi' ? '1.1.0' : '18.10.4', syntheticClients: true,
    modelCalls: faux ? faux.state.callCount : modelCalls, reads, saves, authorizations, registeredTools: [...MARKET_VALIDATION_TOOLS, ...MARKET_MONITOR_TOOLS],
    actualSdkToolLoop: true, zeroToolClarificationTurn: true, freelyAuthoredSteps: true, beforeAfterAuthorization: true,
    extraFieldHandling: config.engine === 'omp' ? 'official_sdk_removed_before_tool' : 'rejected',
    fetchAttempts, paidModelCalls: 0, realModelCalls: 0, realStore: false, realSevenDays: false };
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} finally { await session?.dispose(); auth?.close(); }
