// Real Pi SDK/tool loop; the save callback is explicitly a synthetic client.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.argv[2], directory = process.argv[3];
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const sdk = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
const ai = await load('node_modules/@earendil-works/pi-ai/dist/index.js');
const { factoryCustomersExtension } = await load('plugins/workspace-factory-customers/src/extension.js');
let externalRequests = 0; globalThis.fetch = async () => { externalRequests++; throw Error('External network forbidden in this finite fixture.'); };
const faux = ai.fauxProvider({ api: 'faux', provider: 'factory-customers-pi-faux', models: [{ id: 'finite', maxTokens: 256 }] });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
modelRuntime.registerNativeProvider(faux.provider);
const agentDir = directory + '/agent'; const settings = sdk.SettingsManager.create(directory, agentDir); settings.setCompactionEnabled(false);
let calls = 0, checks = 0, permitted = true, mode = 'normal';
const input = { requestId: 'synthetic-stable', sourceToolCallIds: ['original-search'], documents: [{ name: 'notes.md', content: 'Public source claims; customer fit and contact permission are pending.' }] };
const authorize = async (signal, model) => { checks++; signal?.throwIfAborted(); assert.equal(model.id, 'finite'); if (!permitted) throw Error('Private host refusal.'); };
const client = { async save(value, signal, model) {
  calls++; assert.deepEqual(value, input); signal.throwIfAborted(); assert.equal(model.id, 'finite');
  if (mode === 'failure') throw Error('Private host failure must not escape.');
  if (mode === 'revoke') permitted = false;
  return { plugin: 'workspace-factory-customers', status: 'saved-draft', sources: [], artifacts: [],
    humanReviewed: false, humanReviewRequired: true, sent: false, externalActions: false, verifiedBuyer: false, contactPermission: false };
} };
const resourceLoader = new sdk.DefaultResourceLoader({ cwd: directory, agentDir, settingsManager: settings, noContextFiles: true, noSkills: true, noExtensions: true,
  extensionFactories: [factoryCustomersExtension({ client, authorize })] });
await resourceLoader.reload();
const { session } = await sdk.createAgentSession({ cwd: directory, agentDir, settingsManager: settings, resourceLoader, modelRuntime,
  model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(directory) });
await session.bindExtensions({});
try {
  assert.ok(session.getActiveToolNames().includes('workspace_factory_customers_save'));
  let id = 0;
  async function run(value = input) {
    faux.setResponses([ai.fauxAssistantMessage([{ type: 'toolCall', id: `synthetic-${++id}`, name: 'workspace_factory_customers_save', arguments: value }], { stopReason: 'toolUse' }),
      ai.fauxAssistantMessage('Synthetic receipt observed, no real artifact or business result.')]);
    await session.prompt('Run only the finite keyless tool contract fixture.');
    const row = session.messages.findLast(message => message.role === 'toolResult');
    let receipt; try { receipt = JSON.parse(row.content[0].text); } catch { assert.equal(row.isError, true); return { row }; }
    assert.deepEqual(receipt, row.details); assert.doesNotMatch(JSON.stringify(receipt), /Private host/); return { row, receipt };
  }
  assert.equal((await run()).receipt.status, 'saved-draft');
  assert.equal((await run({ ...input, sourceToolCallIds: [] })).row.isError, true); assert.equal(calls, 1);
  mode = 'failure'; assert.equal((await run()).receipt.reason, 'ORIGINAL_HOST_OPERATION_FAILED');
  mode = 'revoke'; assert.equal((await run()).receipt.reason, 'ORIGINAL_AUTHORIZATION_REFUSED');
  const before = calls; assert.equal((await run()).row.isError, true); assert.equal(calls, before);
  permitted = true; mode = 'normal'; assert.equal((await run()).receipt.status, 'saved-draft');
  assert.equal(calls, 4); assert.equal(externalRequests, 0);
  console.log(JSON.stringify({ upstream: 'pi', version: '1.1.0', toolCalls: id, scriptedModelCalls: faux.state.callCount, syntheticSaveCalls: calls, authorizationChecks: checks, realOrPaidModelCalls: 0, realArtifacts: false }));
} finally { await session.dispose(); }
