// Actual official OMP SDK tool loop; finite explicit model and search transport.
// The model selects native research tools directly. Save client is a test double,
// not a claim of original artifact/Library integration or real customer discovery.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
assert.equal(Bun.version, '1.3.14');
const load = relative => import(pathToFileURL(path.join(config.ompRoot, relative)).href);
const sdk = { ...await load('src/sdk.ts'), ...await load('src/config/settings.ts'), ...await load('src/session/auth-storage.ts'),
  ...await load('src/config/model-registry.ts'), ...await load('src/session/session-manager.ts'), ...await load('../pi-ai/src/utils/event-stream.ts') };
const { createWorkspaceOmpPublicTools } = await import(pathToFileURL(path.join(config.repository, 'server/workspace-omp-public-tools.mjs')).href);
const { factoryCustomersExtension } = await import(pathToFileURL(path.join(config.packageDir, 'src/extension.js')).href);
const settings = await sdk.Settings.init({ cwd: config.directory, agentDir: config.agentDir, inMemory: true, overrides: {
  'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false, 'retry.enabled': false,
  'retry.modelFallback': false, 'compaction.enabled': false, 'compaction.midTurnEnabled': false, 'eval.py': false, 'eval.autoProvision': false,
  'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'browser.headless': true } });
const auth = await sdk.AuthStorage.create(path.join(config.agentDir, 'empty-auth.db'));
const registry = new sdk.ModelRegistry(auth, path.join(config.agentDir, 'absent-models.yml'), { settings, ignoreLocalModelConfig: true });
let modelCalls = 0, nativeSearchRequests = 0, saves = 0, authorizations = 0, session;
const observedURL = 'https://example.com/synthetic-cup-catalog';
const authorize = async (_signal, model) => { authorizations++; if (model) assert.equal(model.id, 'finite'); };
const toolSession = { cwd: config.directory, settings, authStorage: auth, modelRegistry: registry,
  getSessionId: () => 'customer-source-fixture', getArtifactsDir: () => config.directory };
const original = await createWorkspaceOmpPublicTools({ packageRoot: config.ompRoot, toolSession, authorize,
  configuration: { searchProvider: 'duckduckgo', browserExecutable: '/usr/bin/chromium' },
  lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }], // Real admission rejects before browser launch.
  fetchImpl: async (url, init) => { nativeSearchRequests++; assert.equal(url.href, 'https://html.duckduckgo.com/html/'); assert.equal(init.redirect, 'error');
    return new Response(`<div class="result"><a class="result__a" href="${observedURL}">Public synthetic cup catalog</a><a class="result__snippet">Synthetic source explicitly reports kitchenware distribution; buyer identity and purchasing intent are unknown.</a></div>`); } });
const draftInput = { requestId: 'customer-model-written-save', sourceToolCallIds: ['native-search'], documents: [
  { name: 'candidate-notes.md', content: 'Source reports kitchenware distribution. Buyer identity and purchasing intent remain unknown. This is an unreviewed, unsent draft.' },
] };
const client = { save: async (input, signal, model) => {
  saves++; assert.deepEqual(input, draftInput); assert.equal(model.id, 'finite'); signal.throwIfAborted();
  const receipt = session.messages.find(row => row.role === 'toolResult' && row.toolCallId === 'native-search');
  assert.equal(receipt.toolName, 'workspace_public_search'); assert.equal(receipt.details.status, 'sources_observed');
  return { plugin: 'workspace-factory-customers', status: 'saved-draft', sources: [{ toolCallId: 'native-search', url: observedURL }],
    documents: [{ name: input.documents[0].name, artifactId: 'synthetic-save-client-receipt' }], sent: false, humanReviewRequired: true };
} };
const specs = [
  { content: [{ type: 'toolCall', id: 'native-search', name: 'workspace_public_search', arguments: {
    query: 'Public synthetic steel cup distributor catalog', limit: 1 } }], stopReason: 'toolUse' },
  { content: [{ type: 'toolCall', id: 'native-browser', name: 'workspace_public_browser', arguments: { url: observedURL } }], stopReason: 'toolUse' },
  { content: [{ type: 'toolCall', id: 'model-draft-save', name: 'workspace_factory_customers_save', arguments: draftInput }], stopReason: 'toolUse' },
  { content: [{ type: 'text', text: 'Unreviewed public research draft saved through the explicit test-double client; no buyer verified or contacted.' }], stopReason: 'stop' },
];
registry.registerProvider('factory-customers-native-faux', { api: 'factory-customers-native-explicit-faux', apiKey: 'explicit-finite-keyless-fixture', baseUrl: 'https://synthetic.invalid',
  models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
  streamSimple(model, context) {
    const stream = new sdk.AssistantMessageEventStream();
    try {
      const ordinal = modelCalls++, spec = specs[ordinal]; assert.ok(spec, 'Finite fixture exhausted; no real model fallback');
      if (ordinal === 1) {
        const receipt = context.messages.at(-1).details;
        assert.equal(receipt.status, 'sources_observed'); assert.equal(receipt.sources[0].url, observedURL);
        assert.ok(Number.isFinite(Date.parse(receipt.observedAt)));
      }
      if (ordinal === 2) { assert.equal(context.messages.at(-1).isError, true); assert.match(context.messages.at(-1).content[0].text, /private or reserved address/); }
      if (ordinal === 3) assert.equal(JSON.parse(context.messages.at(-1).content[0].text).status, 'saved-draft');
      const message = { role: 'assistant', ...spec, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'start', partial: message }); spec.content.forEach((block, contentIndex) => stream.push(block.type === 'toolCall'
        ? { type: 'toolcall_end', contentIndex, toolCall: block, partial: message } : { type: 'text_end', contentIndex, content: block.text, partial: message }));
      stream.push({ type: 'done', reason: spec.stopReason, message });
    } catch (error) { stream.fail(error); } return stream;
  } });
const others = [];
try {
  const created = await sdk.createAgentSession({ cwd: config.directory, agentDir: config.agentDir, settings, authStorage: auth, modelRegistry: registry,
    model: registry.find('factory-customers-native-faux', 'finite'), sessionManager: sdk.SessionManager.inMemory(config.directory),
    extensions: [pi => original.tools.forEach(tool => pi.registerTool(tool)), factoryCustomersExtension({ client, authorize })], disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true, toolNames: [], spawns: '', hasUI: false, autoTitle: false, cacheWarming: false });
  assert.deepEqual(created.extensionsResult.errors, []); session = created.session;
  const { initializeExtensions } = await load('src/modes/runtime-init.ts');
  await initializeExtensions(session, { mode: 'print', reportSendError: (_action, error) => { throw error; }, reportRuntimeError: error => { throw new Error(error.error); } });
  await session.prompt('This finite fixture explicitly selects original native public tools and then saves a model-written draft. There is no plugin research pipeline.');
  const results = session.messages.filter(row => row.role === 'toolResult'); assert.equal(results.length, 3, JSON.stringify(session.messages));
  assert.deepEqual(results.map(row => row.toolName), ['workspace_public_search', 'workspace_public_browser', 'workspace_factory_customers_save']);
  assert.equal(results[0].isError, false); assert.equal(results[1].isError, true); assert.ok(!results[2].isError);
  assert.equal(saves, 1); assert.equal(modelCalls, 4); assert.equal(nativeSearchRequests, 1);
  const refusal = await createWorkspaceOmpPublicTools({ packageRoot: config.ompRoot, toolSession, authorize,
    fetchImpl: async () => new Response('Explicit synthetic refusal', { status: 403 }) }); others.push(refusal);
  const refused = await refusal.tools.find(tool => tool.name === 'workspace_public_search').execute('native-403', { query: 'Public synthetic catalog' }, new AbortController().signal);
  assert.equal(refused.details.status, 'unavailable'); assert.equal(refused.isError, true); assert.equal(refused.details.sources.length, 0);
  const evidence = { version: 2, officialOmpVersion: '18.10.4', bunVersion: Bun.version, positiveSourceTransport: 'finite-synthetic-HTML',
    officialSDKModelCalls: modelCalls, model: 'explicit-finite-keyless-faux', sourceRequests: nativeSearchRequests,
    modelDirectNativeToolCalls: results.map(row => row.toolName), pluginResearchTools: [], pluginNativeDispatches: 0,
    saveClient: 'explicit-test-double-not-original-artifact-integration', saveCalls: saves, variableModelWrittenDocuments: true,
    originalBusinessTaskSubmissions: 0, nativeBrowserPrivateDNSDenied: true, native403NoFallback: true,
    privateLibraryReads: 0, paidModelCalls: 0, actualPublicNetworkRequests: 0, externalSending: false, buyerVerified: false, authorizations };
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n'); console.log('FACTORY_CUSTOMERS_DIRECT_NATIVE_SDK_VERIFIED');
} finally { for (const item of others) await item.close(); await original.close(); await session?.dispose(); auth.close(); }
