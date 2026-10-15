// Actual official SDK/tool loop; synthetic client callbacks are not Library or artifact authority.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inquiryFixture } from './factory-inquiries-data.mjs';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
let fetchAttempts = 0;
globalThis.fetch = async () => { fetchAttempts++; throw new Error('No external HTTP in the explicit inquiry SDK fixture.'); };
const { factoryInquiriesExtension, FACTORY_INQUIRY_TOOLS } = await import(pathToFileURL(path.join(config.packageDir, 'src/extension.js')).href);
const { prepareFactoryInquiry, factoryInquiryHash } = await import(pathToFileURL(path.join(config.packageDir, 'src/drafts.mjs')).href);
const data = inquiryFixture(factoryInquiryHash);
let authorizations = 0, reads = 0, saved = 0, authorized = true, mode = 'normal', modelCalls = 0, toolCalls = 0;
const authorize = async (signal, model) => { authorizations++; assert.ok(!signal?.aborted); assert.equal(model.id, 'finite'); if (!authorized) throw new Error('Synthetic private Host error must not escape.'); };
const client = {
  async prepare(input, signal, model) {
    reads++; assert.deepEqual(input, data.input); assert.equal(model.id, 'finite');
    if (mode === 'throw') throw new Error('Synthetic Host private error /workspace/private-secret');
    if (mode === 'post-revoke') authorized = false;
    return prepareFactoryInquiry(data);
  },
  async save(input, signal, model) {
    reads++; assert.equal(model.id, 'finite'); assert.equal(input.confirmed, undefined);
    const fresh = prepareFactoryInquiry(data);
    if (input.expectedDraftHash !== fresh.draftHash) return { plugin: 'workspace-factory-inquiries', status: 'blocked', reason: 'SYNTHETIC_EXACT_DRAFT_CHANGED', sources: [], sent: false };
    saved++; return { ...fresh, status: 'saved-draft', save: { requestId: input.requestId, syntheticClientOnly: true }, sent: false };
  },
};
const responses = [];
let session, auth, settings, sdk, faux;
if (config.engine === 'pi') {
  sdk = await import(config.piSdk); const ai = await import(config.piAi);
  const { fauxProvider } = await import(config.piFaux);
  faux = fauxProvider({ api: 'faux', provider: 'factory-inquiries-test-faux', models: [{ id: 'finite', maxTokens: 256 }] });
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  settings = sdk.SettingsManager.create(config.directory, config.agentDir); settings.setCompactionEnabled(false);
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd: config.directory, agentDir: config.agentDir, settingsManager: settings,
    noContextFiles: true, noSkills: true, noExtensions: true, extensionFactories: [factoryInquiriesExtension({ client, authorize })] });
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
  registry.registerProvider('factory-inquiries-test-faux', { api: 'factory-inquiries-test-explicit-faux', apiKey: 'explicit-finite-keyless-fixture', baseUrl: 'https://synthetic.invalid',
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
    model: registry.find('factory-inquiries-test-faux', 'finite'), sessionManager: sdk.SessionManager.inMemory(config.directory),
    extensions: [factoryInquiriesExtension({ client, authorize })], disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [],
    promptTemplates: [], slashCommands: [], enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
    toolNames: [], spawns: '', hasUI: false, autoTitle: false, cacheWarming: false, allowSessionModelFallback: false });
  assert.deepEqual(created.extensionsResult.errors, []); session = created.session;
  const { initializeExtensions } = await load('src/modes/runtime-init.ts');
  await initializeExtensions(session, { mode: 'print', reportSendError: (_action, error) => { throw error; },
    reportRuntimeError: error => { throw new Error(error.error); } });
}
try {
  for (const name of FACTORY_INQUIRY_TOOLS) assert.ok(session.getActiveToolNames().includes(name), name);
  async function call(tool, input) {
    const spec = { content: [{ type: 'toolCall', id: `inquiry-sdk-${++toolCalls}`, name: tool, arguments: input }], stopReason: 'toolUse' };
    const done = { content: [{ type: 'text', text: 'Explicit synthetic draft receipt observed; no sending or real artifact write.' }], stopReason: 'stop' };
    if (faux) {
      const { fauxAssistantMessage } = await import(config.piFaux);
      faux.setResponses([fauxAssistantMessage(spec.content, { stopReason: 'toolUse' }), fauxAssistantMessage(done.content)]);
    } else responses.push(spec, done);
    await session.prompt('Run the explicitly requested source-bound inquiry fixture call only.');
    const row = session.messages.filter(message => message.role === 'toolResult').at(-1);
    assert.equal(row.toolName, tool);
    const value = JSON.parse(row.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
    return { row, value };
  }
  const prepared = await call(FACTORY_INQUIRY_TOOLS[0], data.input);
  assert.equal(prepared.row.isError, false); assert.equal(prepared.value.status, 'available');
  assert.equal(prepared.value.drafts.length, 3); assert.equal(prepared.value.sent, false);
  const saveInput = { ...data.input, requestId: 'synthetic-inquiry-save', expectedDraftHash: prepared.value.draftHash };
  const wrong = await call(FACTORY_INQUIRY_TOOLS[1], { ...saveInput, expectedDraftHash: '0'.repeat(64) });
  assert.equal(wrong.row.isError, true); assert.equal(wrong.value.status, 'blocked'); assert.equal(saved, 0);
  const written = await call(FACTORY_INQUIRY_TOOLS[1], saveInput); assert.equal(written.row.isError, false); assert.equal(written.value.status, 'saved-draft'); assert.equal(saved, 1);
  mode = 'throw'; const failed = await call(FACTORY_INQUIRY_TOOLS[0], data.input);
  assert.equal(failed.row.isError, true); assert.equal(failed.value.status, 'blocked'); assert.deepEqual(failed.value.sources, []);
  assert.doesNotMatch(JSON.stringify(failed.value), /private-secret|authorization/);
  mode = 'normal'; assert.equal((await call(FACTORY_INQUIRY_TOOLS[0], data.input)).value.status, 'available');
  authorized = false; const count = reads; assert.equal((await call(FACTORY_INQUIRY_TOOLS[0], data.input)).value.status, 'blocked'); assert.equal(reads, count);
  authorized = true; mode = 'post-revoke'; const revoked = await call(FACTORY_INQUIRY_TOOLS[0], data.input);
  assert.equal(revoked.value.status, 'blocked'); assert.deepEqual(revoked.value.sources, []); assert.equal(revoked.value.authorization, undefined);
  mode = 'normal'; authorized = true; const beforeInvalid = reads;
  // Official schema validation may reject before the extension. No client call.
  if (faux) {
    const { fauxAssistantMessage, fauxToolCall } = await import(config.piFaux);
    faux.setResponses([fauxAssistantMessage(fauxToolCall(FACTORY_INQUIRY_TOOLS[1], { ...saveInput, expectedDraftHash: 'not-a-sha256' }), { stopReason: 'toolUse' }), fauxAssistantMessage('Model approval claim rejected.')]);
  } else responses.push({ content: [{ type: 'toolCall', id: 'invalid-model-approval', name: FACTORY_INQUIRY_TOOLS[1], arguments: { ...saveInput, expectedDraftHash: 'not-a-sha256' } }], stopReason: 'toolUse' }, { content: [{ type: 'text', text: 'Model approval claim rejected.' }], stopReason: 'stop' });
  await session.prompt('Reject this model-provided approval claim.');
  assert.equal(session.messages.filter(message => message.role === 'toolResult').at(-1).isError, true); assert.equal(reads, beforeInvalid);
  const final = await call(FACTORY_INQUIRY_TOOLS[0], data.input); assert.equal(final.value.status, 'available');
  assert.equal(authorizations, reads * 2 + 1); assert.equal(saved, 1); assert.equal(fetchAttempts, 0);
  const evidence = { version: 1, engine: config.engine, officialVersion: config.engine === 'pi' ? '1.1.0' : '18.10.4',
    runtimeVersion: config.engine === 'pi' ? process.version : Bun.version, syntheticClientOnly: true,
    realLibraryAuthorizationVerified: false, realArtifactSavingVerified: false, paidModelCalls: 0, forbiddenFetchAttempts: fetchAttempts,
    modelCalls: faux ? faux.state.callCount : modelCalls, syntheticClientCalls: reads, authorizations, syntheticSaveCount: saved,
    registeredTools: [...FACTORY_INQUIRY_TOOLS], exactDraftHashForwarded: true, changedDraftHashBlockedByInjectedClient: true,
    humanReviewVerified: false, savesOnlyUnreviewedDrafts: true, beforeAfterAuthorization: true, preRevokeZeroClientReads: true,
    postRevokeNoReceiptDisclosed: true, hostErrorTextNotDisclosed: true, errorRecovery: true, sent: false };
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify(evidence));
} finally { await session?.dispose(); auth?.close(); }
