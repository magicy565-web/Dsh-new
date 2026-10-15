// Actual official OMP SDK, original Store/Library/artifacts/native ReadTool.
// Model decisions and authority are explicit finite keyless fixtures. No real
// model intelligence, private enterprise authorization or extraction accuracy claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('No external HTTP in the finite SDK fixture.'); };
const load = relative => import(pathToFileURL(path.join(config.ompRoot, relative)).href);
const sdk = { ...await load('src/sdk.ts'), ...await load('src/config/settings.ts'), ...await load('src/session/auth-storage.ts'),
  ...await load('src/config/model-registry.ts'), ...await load('src/session/session-manager.ts'), ...await load('../pi-ai/src/utils/event-stream.ts') };
const { loadSkillsFromDir } = await load('src/extensibility/skills.ts');
const { factoryIngestionExtension } = await import(pathToFileURL(path.join(config.packageDir, 'src/extension.js')).href);
const original = relative => import(pathToFileURL(path.join(config.repository, relative)).href);
const { openStore } = await original('server/store.mjs');
const { createArtifactService } = await original('server/artifacts.mjs');
const { createFactoryLibraryIngestionClient } = await original('server/factory-library-ingestion.mjs');
const store = await openStore(path.join(config.directory, 'original-store'));
const artifacts = await createArtifactService({ store });
await store.update(s => s.conversations.push({ id: 'sdk-owned-original-conversation' }));
const uploaded = (await artifacts.create({ filename: 'synthetic-factory.txt', content: 'Synthetic CUP-A, steel cup, MOQ 100. OEM supported. Missing lead time.', metadata: { businessLibrary: { visibility: 'internal' } } })).artifact;
const asset = { artifactId: uploaded.id, version: 1, sha256: uploaded.sha256 };
const settings = await sdk.Settings.init({ cwd: config.directory, agentDir: config.agentDir, inMemory: true, overrides: {
  'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false, 'retry.enabled': false,
  'retry.modelFallback': false, 'compaction.enabled': false, 'compaction.midTurnEnabled': false, 'eval.py': false, 'eval.autoProvision': false } });
const auth = await sdk.AuthStorage.create(path.join(config.agentDir, 'empty-auth.db'));
const registry = new sdk.ModelRegistry(auth, path.join(config.agentDir, 'absent-models.yml'), { settings, ignoreLocalModelConfig: true });
const identity = { workspaceId: 'sdk-synthetic-enterprise', subject: 'sdk-synthetic-operator', role: 'operator' };
let authorityChecks = 0, calls = 0, session;
const authorize = async () => ({ assertCurrent() { authorityChecks++; } });
const client = createFactoryLibraryIngestionClient({ store, artifacts, identity, conversationId: 'sdk-owned-original-conversation', authorize, canSave: () => true,
  scope: { workspaceId: identity.workspaceId, subject: identity.subject, expiresAt: '2099-01-01T00:00:00.000Z',
    fields: { company: ['legalName', 'displayName', 'description'], product: ['name', 'description', 'category', 'skus', 'images', 'supply.capacityNote'] },
    recipient: { kind: 'pi-coding-agent', provider: 'ingestion-explicit-faux', model: 'finite', destination: 'https://synthetic.invalid' }, uploads: [asset], companyRevision: 1, products: [] } });
const requestId = 'sdk-source-bound-intake';
registry.registerProvider('ingestion-explicit-faux', { api: 'ingestion-finite-keyless', apiKey: 'explicit-fixture-no-real-key', baseUrl: 'https://synthetic.invalid',
  models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 512 }],
  streamSimple(model, context) {
    const stream = new sdk.AssistantMessageEventStream();
    try {
      const index = calls++; assert.ok(index < 5, 'Finite SDK fixture exhausted, no fallback.');
      let tool, input;
      if (index === 0) { tool = 'workspace_factory_ingestion_status'; input = {}; }
      if (index === 1) { assert.equal(context.messages.at(-1).details.uploads[0].asset.sha256, asset.sha256); tool = 'workspace_factory_ingestion_read'; input = { asset }; }
      if (index === 2) {
        const receipt = context.messages.at(-1).details; assert.equal(receipt.status, 'available'); assert.match(receipt.extractionPolicy, /original-omp-read/);
        const quote = 'Synthetic CUP-A, steel cup, MOQ 100. OEM supported. Missing lead time.', start = receipt.text.indexOf(quote); assert.ok(start >= 0);
        tool = 'workspace_factory_ingestion_save'; input = { requestId, sources: [receipt.source], records: [{ key: 'cup', kind: 'product',
          values: { name: 'Synthetic steel cup', skus: [{ code: 'CUP-A', moq: 100 }], oem: 'supported' },
          evidence: ['name', 'skus.0.code', 'skus.0.moq', 'oem'].map(p => ({ path: p, sourceIndex: 0, start, end: start + quote.length, quote })), missing: ['lead time', 'ODM', 'dropshipping'], conflicts: [] }] };
      }
      if (index === 3) { assert.equal(context.messages.at(-1).details.status, 'saved', JSON.stringify(context.messages.at(-1))); tool = 'workspace_factory_ingestion_query'; input = { requestId }; }
      if (index === 4) { assert.equal(context.messages.at(-1).details.records[0].current.skus[0].moq, 100); }
      const content = tool ? [{ type: 'toolCall', id: `ingestion-sdk-${index}`, name: tool, arguments: input }]
        : [{ type: 'text', text: 'Original synthetic product saved and queried. Model decisions were a finite keyless script; no real enterprise/product identification accepted.' }];
      const message = { role: 'assistant', content, stopReason: tool ? 'toolUse' : 'stop', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'start', partial: message }); content.forEach((block, contentIndex) => stream.push(block.type === 'toolCall'
        ? { type: 'toolcall_end', contentIndex, toolCall: block, partial: message } : { type: 'text_end', contentIndex, content: block.text, partial: message }));
      stream.push({ type: 'done', reason: message.stopReason, message });
    } catch (error) { stream.fail(error); } return stream;
  } });
try {
  const loaded = await loadSkillsFromDir({ dir: path.join(config.packageDir, 'skills'), source: 'explicit-ingestion-package' });
  assert.equal(loaded.skills.length, 1); assert.equal(loaded.skills[0].name, 'workspace-factory-ingestion');
  const result = await sdk.createAgentSession({ cwd: config.directory, agentDir: config.agentDir, settings, authStorage: auth, modelRegistry: registry,
    model: registry.find('ingestion-explicit-faux', 'finite'), sessionManager: sdk.SessionManager.inMemory(config.directory),
    extensions: [factoryIngestionExtension({ client, authorize })], disableExtensionDiscovery: true, skills: loaded.skills, rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true, toolNames: [], spawns: '', hasUI: false, autoTitle: false, cacheWarming: false, allowSessionModelFallback: false });
  assert.deepEqual(result.extensionsResult.errors, []); session = result.session;
  const { initializeExtensions } = await load('src/modes/runtime-init.ts');
  await initializeExtensions(session, { mode: 'print', reportSendError: (_action, error) => { throw error; }, reportRuntimeError: error => { throw Error(error.error); } });
  await session.prompt('This is a finite keyless SDK acceptance fixture. Inspect only its synthetic authorized upload, save an original product and query it.');
  const toolResults = session.messages.filter(r => r.role === 'toolResult');
  assert.deepEqual(toolResults.map(r => r.toolName), ['workspace_factory_ingestion_status', 'workspace_factory_ingestion_read', 'workspace_factory_ingestion_save', 'workspace_factory_ingestion_query']);
  assert.ok(toolResults.every(r => !r.isError), JSON.stringify(toolResults)); assert.equal(calls, 5); assert.equal(networkAttempts, 0);
  assert.equal(store.read().businessLibrary.products.length, 1); assert.equal(store.read().businessLibrary.products[0].status, 'draft');
  await client.revalidateReceipt(toolResults[2].details, registry.find('ingestion-explicit-faux', 'finite'));
  const evidence = { officialOmpVersion: '18.10.4', bunVersion: Bun.version, model: 'explicit-finite-keyless-script', officialSDKModelCalls: calls,
    realOriginalStoreLibraryArtifacts: true, realNativeDocumentRead: true, toolCalls: toolResults.map(r => r.toolName), savedProductCount: 1, queriedMOQ: 100,
    paidModelCalls: 0, actualNetworkRequests: networkAttempts, realEnterpriseAuthorization: false, realModelIntelligenceAccepted: false, authorityChecks };
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n'); console.log('FACTORY_INGESTION_ORIGINAL_LIBRARY_SDK_VERIFIED');
} finally { await session?.dispose(); auth.close(); await artifacts.close(); await store.close(); }
