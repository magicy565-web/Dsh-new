// Actual official SDK/tool loop; injected client receipts are synthetic and do
// not prove enterprise authorization, HTTP projection or paid model readiness.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
let forbiddenFetchAttempts = 0;
globalThis.fetch = async () => { forbiddenFetchAttempts++; throw new Error('SDK package fixture forbids external HTTP; only its explicit local synthetic client is available.'); };
const { factoryMaterialsExtension, FACTORY_MATERIAL_TOOLS } = await import(pathToFileURL(path.join(config.packageDir, 'src/extension.js')).href);
const productId = '11111111-1111-4111-8111-111111111111', documentId = '22222222-2222-4222-8222-222222222222';
const source = { productId, productRevision: 7, documentId, documentVersion: 2,
  artifactId: '33333333-3333-4333-8333-333333333333', artifactVersion: 3, sha256: 'a'.repeat(64) };
const authorization = { workspaceId: 'synthetic-workspace', subject: 'synthetic-member', scopeFingerprint: 'b'.repeat(64),
  expiresAt: '2099-01-01T00:00:00.000Z', recipient: { kind: 'pi-coding-agent', provider: 'factory-materials-sdk-faux', model: 'finite', destination: 'https://synthetic.invalid' } };
let authorizations = 0, reads = 0, authorized = true, mode = 'available', modelCalls = 0, lastModel;
const events = [], receipt = (status, value = {}) => ({ plugin: 'workspace-factory-materials', status, authorization, sources: [source], ...value });
const authorize = async (signal, model) => { authorizations++; events.push('authorize'); assert.ok(!signal?.aborted); assert.equal(model.id, 'finite');
  if (!authorized) throw new Error('Synthetic reviewed Session revoked'); };
const client = {
  async status(signal, model) { reads++; events.push('status'); lastModel = model; return receipt('available'); },
  async materials(input, signal, model) {
    reads++; events.push('materials'); lastModel = model; assert.deepEqual(input, { productId, limit: 1 });
    if (mode === 'transport-error') throw new Error('Synthetic readonly transport unavailable');
    if (mode === 'post-read-revoked') authorized = false;
    if (mode === 'blocked') return receipt('blocked', { reason: 'SYNTHETIC_SCOPE_REFUSED' });
    return receipt('available', { products: [{ id: productId, revision: 7, name: 'Synthetic factory cup', category: 'Public synthetic fixture',
      skuSpecifications: [{ id: '44444444-4444-4444-8444-444444444444', code: 'SYNTHETIC-CUP', specs: [{ key: 'material', value: 'supplied synthetic steel' }], unit: 'piece', moq: null, leadTimeDays: null }],
      capacityNote: '', documentReferences: [{ documentId, documentVersion: 2 }], provenance: { kind: 'user_provided' } }] });
  },
  async document(input, signal, model) {
    reads++; events.push('document'); lastModel = model; assert.deepEqual(input, { documentId, documentVersion: 2 });
    if (mode === 'unavailable') return receipt('unavailable', { reason: 'SYNTHETIC_EXTRACTION_UNAVAILABLE' });
    return receipt('partial', { document: { ...source, text: 'Synthetic extracted text; capacity remains pending.',
      extraction: { status: 'partial_truncated', textTruncated: true, ocrStatus: 'unknown_after_truncation', pagesNeedingOcr: null } } });
  },
};
const responses = [];
let session, auth, settings, sdk, faux;
if (config.engine === 'pi') {
  sdk = await import(config.piSdk); const ai = await import(config.piAi);
  const { fauxProvider } = await import(config.piFaux);
  faux = fauxProvider({ api: 'faux', provider: 'factory-materials-sdk-faux', models: [{ id: 'finite', maxTokens: 256 }] });
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  settings = sdk.SettingsManager.create(config.directory, config.agentDir); settings.setCompactionEnabled(false);
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd: config.directory, agentDir: config.agentDir, settingsManager: settings,
    noContextFiles: true, noSkills: true, noExtensions: true, extensionFactories: [factoryMaterialsExtension({ client, authorize })] });
  await resourceLoader.reload();
  const created = await sdk.createAgentSession({ cwd: config.directory, agentDir: config.agentDir, settingsManager: settings,
    resourceLoader, modelRuntime, model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(config.directory) });
  session = created.session; await session.bindExtensions({});
} else {
  assert.equal(Bun.version, '1.3.14');
  const load = relative => import(pathToFileURL(path.join(config.ompRoot, relative)).href);
  sdk = { ...await load('src/sdk.ts'), ...await load('src/config/settings.ts'), ...await load('src/session/auth-storage.ts'),
    ...await load('src/config/model-registry.ts'), ...await load('src/session/session-manager.ts'), ...await load('../pi-ai/src/utils/event-stream.ts') };
  settings = await sdk.Settings.init({ cwd: config.directory, agentDir: config.agentDir, inMemory: true, overrides: {
    'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false, 'retry.enabled': false,
    'retry.modelFallback': false, 'compaction.enabled': false, 'compaction.midTurnEnabled': false, 'eval.py': false, 'eval.autoProvision': false } });
  auth = await sdk.AuthStorage.create(path.join(config.agentDir, 'empty-auth.db'));
  const registry = new sdk.ModelRegistry(auth, path.join(config.agentDir, 'absent-models.yml'), { settings, ignoreLocalModelConfig: true });
  registry.registerProvider('factory-materials-sdk-faux', { api: 'factory-materials-sdk-explicit-faux', apiKey: 'explicit-finite-keyless-fixture', baseUrl: 'https://synthetic.invalid',
    models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
    streamSimple(model) {
      const stream = new sdk.AssistantMessageEventStream();
      try {
        const spec = responses.shift(); assert.ok(spec, 'Finite SDK fixture exhausted; no fallback'); modelCalls++;
        const message = { role: 'assistant', content: spec.content, stopReason: spec.stopReason, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
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
    model: registry.find('factory-materials-sdk-faux', 'finite'), sessionManager: sdk.SessionManager.inMemory(config.directory),
    extensions: [factoryMaterialsExtension({ client, authorize })], disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [],
    promptTemplates: [], slashCommands: [], enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    toolNames: [], spawns: '', hasUI: false, autoTitle: false, cacheWarming: false, allowSessionModelFallback: false });
  assert.deepEqual(created.extensionsResult.errors, []); session = created.session;
  const { initializeExtensions } = await load('src/modes/runtime-init.ts');
  await initializeExtensions(session, { mode: 'print', reportSendError: (_action, error) => { throw error; },
    reportRuntimeError: error => { throw new Error(error.error); } });
}
try {
  for (const name of FACTORY_MATERIAL_TOOLS) assert.ok(session.getActiveToolNames().includes(name), name);
  async function call(tool, input) {
    const spec = { content: [{ type: 'toolCall', id: `materials-sdk-${modelCalls + 1}`, name: tool, arguments: input }], stopReason: 'toolUse' };
    const done = { content: [{ type: 'text', text: 'Explicit synthetic receipt observed; not a real Library read.' }], stopReason: 'stop' };
    if (faux) {
      const { fauxAssistantMessage } = await import(config.piFaux);
      faux.setResponses([fauxAssistantMessage(spec.content, { stopReason: 'toolUse' }), fauxAssistantMessage(done.content)]);
    } else responses.push(spec, done);
    await session.prompt('Execute only the explicitly selected synthetic material acceptance call.');
    const row = session.messages.filter(message => message.role === 'toolResult').at(-1);
    assert.equal(row.toolName, tool);
    const text = row.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    let value; try { value = JSON.parse(text); } catch { value = text; }
    return { row, value, text };
  }
  const status = await call(FACTORY_MATERIAL_TOOLS[0], {}); assert.equal(status.value.status, 'available', JSON.stringify(status));
  assert.deepEqual(events.splice(0), ['authorize', 'status', 'authorize']);
  const material = await call(FACTORY_MATERIAL_TOOLS[1], { productId, limit: 1 });
  assert.deepEqual(material.value, receipt('available', { products: [{ id: productId, revision: 7, name: 'Synthetic factory cup', category: 'Public synthetic fixture',
    skuSpecifications: [{ id: '44444444-4444-4444-8444-444444444444', code: 'SYNTHETIC-CUP', specs: [{ key: 'material', value: 'supplied synthetic steel' }], unit: 'piece', moq: null, leadTimeDays: null }],
    capacityNote: '', documentReferences: [{ documentId, documentVersion: 2 }], provenance: { kind: 'user_provided' } }] }));
  assert.deepEqual(events.splice(0), ['authorize', 'materials', 'authorize']); assert.equal(lastModel.id, 'finite');
  const partial = await call(FACTORY_MATERIAL_TOOLS[2], { documentId, documentVersion: 2 }); assert.equal(partial.value.status, 'partial');
  assert.equal(partial.row.isError, false); assert.equal(partial.value.document.extraction.ocrStatus, 'unknown_after_truncation');
  mode = 'blocked'; const blocked = await call(FACTORY_MATERIAL_TOOLS[1], { productId, limit: 1 }); assert.equal(blocked.row.isError, true); assert.equal(blocked.value.status, 'blocked');
  mode = 'unavailable'; const unavailable = await call(FACTORY_MATERIAL_TOOLS[2], { documentId, documentVersion: 2 }); assert.equal(unavailable.row.isError, true); assert.equal(unavailable.value.status, 'unavailable');
  mode = 'transport-error'; const failed = await call(FACTORY_MATERIAL_TOOLS[1], { productId, limit: 1 }); assert.equal(failed.row.isError, true);
  mode = 'available'; const recovered = await call(FACTORY_MATERIAL_TOOLS[1], { productId, limit: 1 }); assert.equal(recovered.row.isError, false);
  mode = 'post-read-revoked'; const revoked = await call(FACTORY_MATERIAL_TOOLS[1], { productId, limit: 1 }); assert.equal(revoked.row.isError, true); assert.ok(!revoked.text.includes('Synthetic factory cup'));
  const before = reads; const preDenied = await call(FACTORY_MATERIAL_TOOLS[0], {}); assert.equal(preDenied.row.isError, true); assert.equal(reads, before);
  authorized = true; mode = 'available';
  // OMP may normalize/drop additional JSON properties before extension dispatch.
  // Test invalid admitted selectors here; the direct-entry test separately
  // proves this package rejects unknown path/field/recipient selectors itself.
  for (const input of [{ productId: 'not-a-uuid' }, { limit: 0 }, { limit: 21 }]) {
    const rejected = await call(FACTORY_MATERIAL_TOOLS[1], input); assert.equal(rejected.row.isError, true); assert.equal(reads, before);
  }
  for (const input of [{ documentId, documentVersion: 101 }, { documentId: 'not-a-uuid', documentVersion: 2 }]) {
    const rejected = await call(FACTORY_MATERIAL_TOOLS[2], input); assert.equal(rejected.row.isError, true); assert.equal(reads, before);
  }
  const final = await call(FACTORY_MATERIAL_TOOLS[0], {}); assert.equal(final.row.isError, false);
  assert.equal(authorizations, reads * 2 + 1);
  assert.equal(forbiddenFetchAttempts, 0);
  const evidence = { version: 1, engine: config.engine, officialVersion: config.engine === 'pi' ? '1.1.0' : '18.10.4',
    runtimeVersion: config.engine === 'pi' ? process.version : Bun.version,
    syntheticClientOnly: true, realLibraryAuthorizationVerified: false, paidModelCalls: 0, externalFetchDenied: true, forbiddenFetchAttempts,
    modelCalls: faux ? faux.state.callCount : modelCalls, clientReads: reads, authorizationChecks: authorizations,
    registeredTools: [...FACTORY_MATERIAL_TOOLS], exactSourcePreserved: true, partialPreserved: true,
    blockedUnavailableErrorsPreserved: true, beforeAfterAuthorization: true, preReadDeniedZeroClientReads: true,
    postReadDeniedNoReceiptDisclosure: true, invalidInputZeroClientReads: true, errorRecovery: true };
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await session?.dispose(); auth?.close(); }
