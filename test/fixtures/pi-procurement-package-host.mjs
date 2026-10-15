// Copied outside the repository by the package test. Only official host imports,
// the copied package, loopback original service and explicit keyless faux model.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
if (config.enterpriseHost) {
  // Actual original HTTP transport with its reviewed ingress Host. Native
  // fetch does not honor this test ingress routing header consistently.
  globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => {
    assert.equal(new URL(url).origin, process.env.WS_AGENT_URL);
    const req = httpRequest(url, { method: options.method || 'GET', signal: options.signal,
      headers: { ...options.headers, Host: config.enterpriseHost } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      response.on('error', reject);
    });
    req.on('error', reject); req.end(options.body);
  });
}
const faux = fauxProvider({ api: 'faux', provider: 'workspace-agent-test-faux', models: [{ id: 'workspace-agent-test', maxTokens: 1000 }] });
const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
modelRuntime.registerNativeProvider(faux.provider);
const settingsManager = SettingsManager.create(config.directory, config.agentDir);
settingsManager.setCompactionEnabled(false);
const resourceLoader = new DefaultResourceLoader({ cwd: config.directory, agentDir: config.agentDir, settingsManager,
  noContextFiles: true, additionalExtensionPaths: [config.otherExtension, ...(config.compatibilityExtension ? [config.compatibilityExtension] : [])] });
await resourceLoader.reload();
assert.deepEqual(resourceLoader.getExtensions().errors, []);
assert.ok(resourceLoader.getSkills().skills.some(row => row.name === 'workspace-factory'));
const created = await createAgentSession({ cwd: config.directory, agentDir: config.agentDir, settingsManager, resourceLoader,
  modelRuntime, model: faux.getModel(), sessionManager: SessionManager.inMemory(config.directory) });
const session = created.session;
try {
  await session.bindExtensions({});
  const active = session.getActiveToolNames();
  for (const name of ['read', 'bash', 'other_plugin_tool', 'workspace_factory_rfq_requirements', 'workspace_business_result']) assert.ok(active.includes(name), name);
  if (!config.compatibilityExtension) for (const name of ['workspace_procurement_compare', 'workspace_procurement_requirements', 'workspace_business_task', 'workspace_business_presets']) assert.ok(!active.includes(name), name);
  assert.ok(!active.includes('workspace_products') && !active.includes('workspace_company_profile') && !active.includes('workspace_product'));
  const hooks = resourceLoader.getExtensions().extensions.find(row => row.path.endsWith('/src/extension.js')).handlers;
  for (const name of ['session_start', 'input', 'user_bash', 'tool_call', 'session_before_switch', 'session_before_fork']) assert.ok(!hooks.has(name), name);
  await session.prompt('/other-command');
  assert.equal(await fs.readFile(config.commandMarker, 'utf8'), 'other command ran');
  assert.equal(faux.state.callCount, 0);
  const read = async (tool, args) => {
    faux.setResponses([fauxAssistantMessage(fauxToolCall(tool, args), { stopReason: 'toolUse' }),
      context => { assert.equal(context.messages.at(-1).role, 'toolResult'); return fauxAssistantMessage('Explicit keyless synthetic receipt checked.'); }]);
    await session.prompt('Synthetic Chinese factory acceptance: execute exactly the supplied test call.');
    const row = session.messages.filter(row => row.role === 'toolResult').at(-1);
    const text = row.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    return { row, value: (() => { try { return JSON.parse(text); } catch { return text; } })() };
  };
  const capabilities = (await read('workspace_factory_capabilities', {})).value;
  assert.equal(capabilities.privateLibrary.status, 'disabled');
  assert.equal(capabilities.onlineVerified, false);
  assert.equal(capabilities.audience, 'Chinese-factory'); assert.equal(capabilities.defaultSupplierComparison, false);
  if (config.mode === 'unconfigured') {
    assert.equal(capabilities.configuration, 'unconfigured');
    for (const name of ['workspace_business_tasks', 'workspace_factory_rfq_requirements', 'workspace_factory_match_prepare']) {
      const { row, value } = await read(name, name.startsWith('workspace_factory_') ? { rfq: {} } : {});
      assert.equal(row.isError, false); assert.equal(value.status, name.startsWith('workspace_factory_') ? 'draft' : 'unconfigured'); assert.deepEqual(value.sources, []);
    }
  } else if (config.mode === 'refused') {
    const { row } = await read('workspace_business_tasks', {});
    assert.equal(row.isError, true);
  } else if (config.mode === 'foreign-result') {
    const { row, value } = await read('workspace_business_result', { taskId: config.taskId });
    assert.equal(row.isError, true); assert.match(value, /HTTP 404/);
  } else if (config.mode === 'factory') {
    const rfq = { product: 'Public synthetic factory cup', quantity: 100, target_market: 'Public synthetic target market' };
    const draft = (await read('workspace_factory_rfq_requirements', { rfq })).value;
    assert.equal(draft.status, 'draft'); assert.equal(draft.persisted, false); assert.equal(draft.submitted, false);
    assert.deepEqual(draft.customerRequirements, rfq); assert.deepEqual(draft.pending, ['spec', 'requested_delivery', 'requirements']);
    assert.ok(draft.sources.every(row => row.kind === 'user-provided' && row.recordId.startsWith('input.rfq.')));
    const pending = (await read('workspace_factory_match_prepare', { rfq })).value;
    assert.deepEqual(pending.suppliedFactoryMaterials, {}); assert.ok(pending.pendingFactoryFields.includes('production_capacity'));
    assert.ok(pending.pendingFactoryFields.includes('lead_time')); assert.equal(pending.matchingDecision, 'pending-human-review');
    const factoryOffer = { product: rfq.product, spec: 'Supplied synthetic factory spec', source: 'Public synthetic factory material' };
    const prepared = (await read('workspace_factory_match_prepare', { rfq, factoryOffer })).value;
    assert.deepEqual(prepared.suppliedFactoryMaterials, factoryOffer); assert.ok(prepared.pendingFactoryFields.includes('available_quantity'));
    assert.ok(prepared.pendingFactoryFields.includes('production_capacity')); assert.ok(prepared.pendingFactoryFields.includes('lead_time'));
    assert.equal(prepared.matchingDecision, 'pending-human-review'); assert.equal(prepared.persisted, false);
    const rejected = await read('workspace_factory_rfq_requirements', { rfq: { ...rfq, filePath: '/private-enterprise/catalog.pdf' } });
    assert.equal(rejected.row.isError, true);
    await fs.writeFile(config.evidenceFile, JSON.stringify({ audience: 'Chinese-factory', defaultSupplierComparison: false,
      defaultTaskSubmission: false, publicRFQDraft: true, factoryCapacityInvented: false, persisted: false,
      model: 'explicit-keyless-faux', paidModelCalls: 0, privateLibraryReads: 0, tools: active }));
  } else {
    const draft = (await read('workspace_procurement_requirements', { input: { product: 'Public synthetic cup' } })).value;
    assert.equal(draft.status, 'draft', JSON.stringify(draft)); assert.equal(draft.persisted, false); assert.equal(draft.submitted, false);
    assert.deepEqual(draft.missingRequired, ['spec', 'quantity']); assert.equal(draft.requiredFieldsPresent, false);
    const compared = (await read('workspace_procurement_compare', { quotes: config.task.input.quotes })).value;
    assert.equal(compared.alignment, 'pending'); assert.equal(compared.rows[0].cells.moq.status, 'pending');
    assert.equal(compared.rows[0].cells.unit_price.status, 'pending'); assert.equal(compared.rows[1].cells.lead_time.status, 'pending');
    assert.equal(compared.rows[1].cells.unit_price.value, 'USD 3.40 per supplied piece');
    assert.equal(compared.ranked, false); assert.equal(compared.independentVerification, false);
    const empty = (await read('workspace_procurement_compare', { quotes: [] })).value;
    assert.equal(empty.status, 'empty'); assert.deepEqual(empty.rows, []);
    const invalid = await read('workspace_procurement_compare', { quotes: [{ supplier: 'Public supplied fixture', api_key: 'do-not-send-credential-text' }] });
    assert.equal(invalid.row.isError, true);
    const prepared = (await read('workspace_procurement_requirements', { input: config.task.input })).value;
    assert.equal(prepared.requiredFieldsPresent, true); assert.deepEqual(prepared.provided, config.task.input);
    const submitted = (await read('workspace_business_task', config.task)).value;
    assert.ok(submitted.task.taskId); const taskId = submitted.task.taskId;
    let finished;
    for (let i = 0; i < 600; i++) {
      const response = await fetch(process.env.WS_AGENT_URL + '/api/agent/v1/tasks/' + taskId, { headers: { Authorization: 'Bearer ' + process.env.WS_AGENT_TOKEN } });
      finished = await response.json(); if (['done', 'failed', 'interrupted'].includes(finished.status)) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(finished.status, 'done', JSON.stringify({ result: finished.result, steps: finished.steps, error: finished.error })); assert.equal(finished.result.businessGoalAchieved, false);
    const saved = (await read('workspace_business_result', { taskId })).value;
    assert.equal(saved.status, 'available'); assert.equal(saved.artifacts.length, 3);
    const artifacts = saved.artifacts.map(row => {
      const sha256 = createHash('sha256').update(row.content).digest('hex');
      assert.ok(saved.sources.some(source => source.name === row.name && source.sha256 === sha256));
      return { name: row.name, bytes: row.bytes, sha256 };
    });
    await fs.writeFile(config.evidenceFile, JSON.stringify({ mode: config.mode, taskId, artifacts,
      frontendModelCallsThroughDocumentRead: faux.state.callCount, tools: active, privateLibrary: 'disabled', sharedImplementation: true }));
  }
  const other = await read('other_plugin_tool', {}); assert.equal(other.value.otherPlugin, true);
  // Ordinary package contributes no session veto. Exercise official hook paths.
  const switched = await session.extensionRunner.emit({ type: 'session_before_switch', reason: 'switch', targetSessionFile: '/tmp/synthetic-other-session.jsonl' });
  assert.ok(!switched?.cancel);
  const forked = await session.extensionRunner.emit({ type: 'session_before_fork', entryId: 'synthetic-entry' });
  assert.ok(!forked?.cancel);
  assert.ok(!JSON.stringify(session.messages).includes(process.env.WS_AGENT_TOKEN || 'ABSENT_TEST_TOKEN_SENTINEL'));
  console.log(JSON.stringify({ mode: config.mode, officialSDK: true, packageRoot: config.packageDir, modelCalls: faux.state.callCount,
    outsideWorkspace: true, privateLibrary: 'disabled', coexistence: true }));
} finally { session.dispose(); }
