// Real published OMP SDK + native public provider wrapper. Positive source HTML
// is explicitly synthetic; original Workspace HTTP/backend execution is real,
// with a finite keyless model. Optional live research is read-only, once only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { request as httpRequest } from 'node:http';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
assert.equal(Bun.version, '1.3.14');
const load = relative => import(pathToFileURL(path.join(config.ompRoot, relative)).href);
const sdk = { ...await load('src/sdk.ts'), ...await load('src/config/settings.ts'), ...await load('src/session/auth-storage.ts'),
  ...await load('src/config/model-registry.ts'), ...await load('src/session/session-manager.ts'), ...await load('../pi-ai/src/utils/event-stream.ts') };
const { createWorkspaceOmpPublicTools } = await import(pathToFileURL(path.join(config.repository, 'server/workspace-omp-public-tools.mjs')).href);
const { createWorkspaceClient } = await import(pathToFileURL(path.join(config.repository, 'packages/workspace-procurement/src/workspace.mjs')).href);
const { factoryCustomersExtension } = await import(pathToFileURL(path.join(config.packageDir, 'src/extension.js')).href);
const settings = await sdk.Settings.init({ cwd: config.directory, agentDir: config.agentDir, inMemory: true, overrides: {
  'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false, 'retry.enabled': false,
  'retry.modelFallback': false, 'compaction.enabled': false, 'compaction.midTurnEnabled': false, 'eval.py': false, 'eval.autoProvision': false,
  'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'browser.headless': true } });
const auth = await sdk.AuthStorage.create(path.join(config.agentDir, 'empty-auth.db'));
const registry = new sdk.ModelRegistry(auth, path.join(config.agentDir, 'absent-models.yml'), { settings, ignoreLocalModelConfig: true });
let modelCalls = 0, nativeSearchRequests = 0, invoked = [], submits = 0, authorizations = 0, session;
const observedURL = 'https://example.com/synthetic-cup-catalog';
const authorize = async (_signal, model) => { authorizations++; if (model) assert.equal(model.id, 'finite'); };
const toolSession = { cwd: config.directory, settings, authStorage: auth, modelRegistry: registry,
  getSessionId: () => 'customer-source-fixture', getArtifactsDir: () => config.directory };
const original = await createWorkspaceOmpPublicTools({ packageRoot: config.ompRoot, toolSession, authorize,
  configuration: { searchProvider: 'duckduckgo', browserExecutable: '/usr/bin/chromium' },
  lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }], // Real admission rejects before browser launch.
  fetchImpl: async (url, init) => { nativeSearchRequests++; assert.equal(url.href, 'https://html.duckduckgo.com/html/'); assert.equal(init.redirect, 'error');
    return new Response(`<div class="result"><a class="result__a" href="${observedURL}">Public synthetic cup catalog</a><a class="result__snippet">Synthetic source explicitly reports kitchenware distribution; buyer identity and purchasing intent are unknown.</a></div>`); } });
const transport = (url, options = {}) => new Promise((resolve, reject) => {
  assert.equal(new URL(url).origin, config.baseURL);
  const req = httpRequest(url, { method: options.method || 'GET', signal: options.signal, headers: { ...options.headers, Host: 'workspace.example' } }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }))); res.once('error', reject);
  }); req.once('error', reject); req.end(options.body);
});
const originalClient = createWorkspaceClient({ baseURL: config.baseURL, token: config.syntheticToken, fetchImpl: transport });
const client = {
  status: async () => ({ toolNames: original.toolNames, businessSubmit: true }),
  invokeTool: async (name, input, signal) => { invoked.push(name); const tool = original.tools.find(tool => tool.name === name); assert.ok(tool); return tool.execute(`native-${invoked.length}`, input, signal); },
  businessSubmit: async (input, signal) => { submits++; assert.equal(input.type, 'factory-export'); return originalClient.businessSubmit(input, signal); },
};
const specs = [
  { content: [{ type: 'toolCall', id: 'original-customer-research', name: 'workspace_factory_customers_research', arguments: {
    product: 'Public synthetic steel cup', targetMarket: 'United Kingdom', query: 'Public synthetic steel cup distributor catalog', limit: 1, inspectPages: true } }], stopReason: 'toolUse' },
  { content: [{ type: 'toolCall', id: 'original-customer-save', name: 'workspace_factory_customers_save', arguments: {
    title: 'Public synthetic factory customer evidence', product: 'Public synthetic steel cup', spec: 'Public supplied synthetic specification',
    targetMarket: 'United Kingdom', researchCallId: 'original-customer-research', requestId: 'factory-customers-original-save' } }], stopReason: 'toolUse' },
  { content: [{ type: 'text', text: 'Original public evidence receipt submitted for review documents only; no verified buyer, contact or business outcome.' }], stopReason: 'stop' },
];
registry.registerProvider('factory-customers-native-faux', { api: 'factory-customers-native-explicit-faux', apiKey: 'explicit-finite-keyless-fixture', baseUrl: 'https://synthetic.invalid',
  models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
  streamSimple(model, context) {
    const stream = new sdk.AssistantMessageEventStream();
    try {
      const ordinal = modelCalls++, spec = specs[ordinal]; assert.ok(spec, 'Finite fixture exhausted; no real model fallback');
      if (ordinal === 1) {
        const receipt = JSON.parse(context.messages.at(-1).content[0].text);
        assert.equal(receipt.status, 'partial'); assert.equal(receipt.sources[0].url, observedURL);
        assert.equal(receipt.sources[0].originalTool, 'workspace_public_search'); assert.ok(Number.isFinite(Date.parse(receipt.sources[0].observedAt)));
        assert.equal(receipt.nativeReceipts[1].status, 'unavailable'); assert.equal(receipt.matchedCustomer, false);
        assert.equal(receipt.verifiedBuyer, false); assert.equal(receipt.contactPermission, false); assert.deepEqual(receipt.inferences, []);
      }
      if (ordinal === 2) assert.equal(JSON.parse(context.messages.at(-1).content[0].text).status, 'submitted');
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
    extensions: [factoryCustomersExtension({ client, authorize })], disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true, toolNames: [], spawns: '', hasUI: false, autoTitle: false, cacheWarming: false });
  assert.deepEqual(created.extensionsResult.errors, []); session = created.session;
  const { initializeExtensions } = await load('src/modes/runtime-init.ts');
  await initializeExtensions(session, { mode: 'print', reportSendError: (_action, error) => { throw error; }, reportRuntimeError: error => { throw new Error(error.error); } });
  await session.prompt('Use only this public synthetic brief to research, then save the original review documents as explicitly requested by this acceptance fixture.');
  const results = session.messages.filter(row => row.role === 'toolResult'); assert.equal(results.length, 2); assert.ok(results.every(row => !row.isError));
  const research = JSON.parse(results[0].content[0].text), saved = JSON.parse(results[1].content[0].text);
  assert.equal(research.saved, false); assert.equal(submits, 1); assert.equal(modelCalls, 3);
  assert.deepEqual(invoked, ['workspace_public_search', 'workspace_public_browser']); assert.equal(nativeSearchRequests, 1);
  // A real native provider HTTP403 is preserved as blocked, never empty/available.
  const refusal = await createWorkspaceOmpPublicTools({ packageRoot: config.ompRoot, toolSession, authorize,
    fetchImpl: async () => new Response('Explicit synthetic refusal', { status: 403 }) }); others.push(refusal);
  const refusedTools = [];
  factoryCustomersExtension({ authorize, client: { status: async () => ({ toolNames: refusal.toolNames, businessSubmit: false }),
    invokeTool: (name, input, signal) => refusal.tools.find(tool => tool.name === name).execute('native-403', input, signal) } })({ registerTool: tool => refusedTools.push(tool) });
  const refused = await refusedTools[1].execute('refused', { product: 'Public synthetic steel cup', targetMarket: 'United Kingdom', query: 'Public synthetic catalog' },
    new AbortController().signal, undefined, { model: session.model });
  assert.equal(refused.details.status, 'blocked'); assert.equal(refused.isError, true); assert.equal(refused.details.sources.length, 0);
  const evidence = { version: 1, officialOmpVersion: '18.10.4', bunVersion: Bun.version, positiveWorkflowSyntheticOnly: true,
    nativeSearch: { implementation: 'published-OMP-searchDuckDuckGo-through-existing-public-tool', transport: 'finite-synthetic-HTML', requestCount: nativeSearchRequests,
      sourceCount: research.sources.length, originalTool: research.sources[0].originalTool, observationTimePreserved: true },
    browser: { implementation: 'existing-native-browser-admission', privateDNSDeniedBeforeNavigation: true, output: 'partial-source-evidence', realPublicNavigation: 'not-executed-in-positive-fixture' },
    native403: { status: refused.details.status, sourceCount: 0, noFallback: true },
    officialSDKModelCalls: modelCalls, model: 'explicit-finite-keyless-faux', originalBusinessSubmitCalls: submits,
    originalTaskId: saved.originalReceipt.task.taskId, originalBackendAuthority: true, privateLibraryReads: 0, paidModelCalls: 0,
    credentialCreation: false, externalSending: false, buyerVerified: false, customerMatched: false, sourceProvenancePreserved: true,
    factsInferencesMissingSeparate: true, authorizations };
  if (config.live) {
    const live = await createWorkspaceOmpPublicTools({ packageRoot: config.ompRoot, toolSession, authorize,
      configuration: { searchProvider: 'duckduckgo', browserExecutable: '/usr/bin/chromium' } }); others.push(live);
    const result = await live.tools.find(tool => tool.name === 'workspace_public_search').execute('single-live-readonly-search',
      { query: 'stainless steel cup distributor United Kingdom public catalog', limit: 1 }, new AbortController().signal);
    evidence.live = { testedAt: new Date().toISOString(), provider: 'duckduckgo', attempts: 1, status: result.details.status,
      failure: result.details.failure || null, sourceCount: result.details.sources.length,
      sources: result.details.sources.map(({ title, url }) => ({ title, url })), paidModelCalls: 0, fallback: false, challengeBypass: false,
      meaning: 'Actual native public network observation only; no buyer identity, match or intent verification.' };
  }
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n'); console.log('FACTORY_CUSTOMERS_NATIVE_ORIGINAL_HTTP_VERIFIED');
} finally { for (const item of others) await item.close(); await original.close(); await session?.dispose(); auth.close(); }
