import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { openStore } from '../server/store.mjs';
import { createRuntime } from '../server/runtime.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { getPreset } from '../server/agent/presets.mjs';
import { buildAgentPresetContext } from '../server/agent/pi-preset.mjs';

const actor = { subject: 'local-operator', workspaceId: 'local', role: 'admin' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let index = 0; index < 500; index++) { if (check()) return; await delay(5); } throw new Error('Original Pi stage did not settle.'); }
const proposal = (text = '产品资料已提供，报价与交期仍需核对。', sources = ['input.product']) => ({ analysis: [{ text, sources }], recommendations: [{ text: '建议确认统一报价口径后再执行下一步。', sources: [] }], questions: [{ text: '是否可以补充原始报价材料？', sources: [] }] });
const complete = output => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', output || proposal()), { stopReason: 'toolUse' });
async function fixture(t, { responses = [], researchAdapter, configured = true, baseUrl } = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-agent-pi-core-');
  const faux = fauxProvider(); faux.setResponses(responses);
  let store, runtime, provider;
  async function open() {
    store = await openStore(directory);
    const models = createModels(); models.setProvider(faux.provider);
    provider = configured ? createPiProvider({ models, providerId: 'faux', model: 'faux-1', researchAdapter, baseUrl }) : createPiProvider();
    await provider.initialize({ store });
    runtime = await createRuntime({ store, provider });
  }
  await open();
  t.after(async () => { await runtime.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { faux, get runtime() { return runtime; }, get store() { return store; }, get provider() { return provider; },
    async reopen(options = {}) { await runtime.close(); await store.close(); if (options.baseUrl) baseUrl = options.baseUrl; await open(); },
    async task(type = 'procurement') {
      const conversation = (await runtime.createConversation({ title: '原任务采购', requestId: randomUUID() }, actor)).conversation;
      const preset = getPreset(type), id = randomUUID();
      const task = { id, subject: actor.subject, workspaceId: actor.workspaceId, conversationId: conversation.id, preset, type, title: '原任务采购',
        input: { product: '不锈钢保温杯', spec: '500ml', quantity: 1000, market: '美国' },
        steps: preset.stages.map(stage => ({ key: stage.key, title: stage.title, requestId: randomUUID(), runId: null, replyId: null, status: 'pending', output: null, error: null })),
        status: 'running', result: null, createdAt: new Date().toISOString(), finishedAt: null };
      await store.update(state => { (state.workspaceAgentTasks ||= { version: 1, tasks: [] }).tasks.push(task); });
      return task;
    },
    context(task, index = 0, extra = {}) { return buildAgentPresetContext({ state: store.read(), taskId: task.id, stageKey: task.steps[index].key, requestId: task.steps[index].requestId, actor, researchCapabilities: provider.researchCapabilities, ...extra }); },
    async submit(task, index = 0, extra = {}) {
      const context = this.context(task, index, extra);
      return runtime.sendMessage(task.conversationId, { content: `执行原任务阶段：${context.stage.title}`, requestId: context.requestId, queued: true, workspaceExecution: true }, { agentPresetContext: context });
    },
  };
}

test('Agent preset invokes real Pi SDK tool through the original Runtime and stores only a document result under the original budget', async t => {
  const f = await fixture(t, { responses: [complete()] }), task = await f.task();
  const admission = await f.submit(task, 0, { budget: { maxSteps: 1, maxOutputTokens: 1200 } });
  await until(() => f.runtime.getRun(admission.run.id).run.status === 'succeeded');
  const run = f.runtime.getRun(admission.run.id).run, saved = f.store.read().workspaceAgentTasks.tasks[0].steps[0];
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(saved.runId, run.id); assert.equal(saved.replyId, run.assistantId); assert.ok(run.piSubmissionId);
  assert.equal(f.provider.legacyPolicyCompatible, true);
  assert.equal(run.execution.permissionFingerprint, f.provider.agentPermissionFingerprint,
    'Agent document tool authority must bind V5, not inherit ordinary PR59 V4.');
  assert.notEqual(run.execution.permissionFingerprint, f.provider.permissionFingerprint);
  assert.equal(run.execution.endpointFingerprint, f.provider.endpointFingerprint,
    'Agent stages must always bind the exact model endpoint.');
  assert.equal(run.budget.maxOutputTokens, 1200); assert.equal(run.budget.maxSteps, 1);
  assert.equal(saved.status, 'succeeded'); assert.match(saved.output, /报价与交期仍需核对/);
  assert.equal(saved.result.completion, 'partial'); assert.equal(saved.result.businessGoalAchieved, false);
  assert.equal(f.store.read().workspaceAgentTasks.tasks[0].status, 'running');
  assert.equal(f.runtime.bootstrap().workspaceAgentTasks, undefined);
  assert.equal(f.store.read().capabilities.approvals.length, 0);
});

test('lost response and reopened original stage request deduplicate to the same run with no model call', async t => {
  const f = await fixture(t, { responses: [complete()] }), task = await f.task();
  const admission = await f.submit(task);
  await until(() => f.runtime.getRun(admission.run.id).run.status === 'succeeded');
  await f.reopen();
  const repeated = await f.submit(task);
  assert.equal(repeated.duplicate, true); assert.equal(repeated.run.id, admission.run.id);
  assert.equal(f.faux.state.callCount, 1); assert.equal(f.store.read().runs.length, 1);
});

test('interrupted preset recovers its original Pi submission and original budget without creating a new task or stage', async t => {
  const f = await fixture(t, { responses: [async (_request, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }] }), task = await f.task();
  const admitted = await f.submit(task);
  await until(() => f.runtime.getRun(admitted.run.id).run.piSubmissionId && f.faux.state.callCount === 1);
  const previous = f.runtime.getRun(admitted.run.id).run;
  await f.reopen();
  assert.equal(f.runtime.getRun(previous.id).run.status, 'interrupted');
  f.faux.setResponses([complete()]);
  const recovered = await f.runtime.recoverPiRun(previous.id, { requestId: 'original-stage-recovery' });
  assert.equal(recovered.run.id, previous.id);
  await until(() => f.runtime.getRun(previous.id).run.status !== 'running');
  const after = f.runtime.getRun(previous.id).run;
  assert.equal(after.status, 'succeeded', JSON.stringify(after.error)); assert.equal(after.piSubmissionId, previous.piSubmissionId);
  assert.equal(after.assistantId, previous.assistantId); assert.equal(after.reservedOutputTokens, previous.reservedOutputTokens);
  assert.equal(f.store.read().runs.length, 1); assert.equal(f.store.read().workspaceAgentTasks.tasks.length, 1);
});

test('preset scope changes block recovery while previously committed stage output remains available', async t => {
  const f = await fixture(t, { responses: [complete(), async (_request, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }] }), task = await f.task();
  const first = await f.submit(task); await until(() => f.runtime.getRun(first.run.id).run.status === 'succeeded');
  const saved = f.store.read().workspaceAgentTasks.tasks[0].steps[0].output;
  const second = await f.submit(task, 1); await until(() => f.runtime.getRun(second.run.id).run.piSubmissionId && f.faux.state.callCount === 2);
  await f.reopen();
  await f.store.update(state => { state.workspaceAgentTasks.tasks[0].input.spec = '750ml'; });
  await assert.rejects(f.runtime.recoverPiRun(second.run.id, { requestId: 'changed-stage-must-not-replay' }), { code: 'AGENT_CONTEXT_CHANGED' });
  assert.equal(f.faux.state.callCount, 2); assert.equal(f.store.read().workspaceAgentTasks.tasks[0].steps[0].output, saved);
});

test('production missing model or required real search remains blocked without a template result', async t => {
  const f = await fixture(t, { configured: false }), task = await f.task();
  const admitted = await f.submit(task);
  const run = f.runtime.getRun(admitted.run.id).run;
  assert.equal(run.status, 'blocked'); assert.equal(run.error.code, 'SETUP_REQUIRED');
  assert.equal(f.store.read().workspaceAgentTasks.tasks[0].steps[0].output, null);
  const opportunity = await f.task('opportunity-discovery');
  assert.throws(() => f.context(opportunity), { code: 'AGENT_REQUIRED_CAPABILITY_MISSING' });
  await f.store.update(state => {
    const current = state.workspaceAgentTasks.tasks.find(item => item.id === opportunity.id);
    current.preset.required_capabilities = [];
    current.preset.stages[0].required_capabilities = [];
  });
  assert.throws(() => f.context(opportunity), { code: 'AGENT_REQUIRED_CAPABILITY_MISSING' });
  assert.equal(f.faux.state.callCount, 0);
});

test('real Pi research tool calls the selected read adapter, persists evidence and requires citations', async t => {
  let reads = 0;
  const adapter = { id: 'local-source-fixture', revision: 1, replay: 'safe', configured: true, capabilities: ['web_search'],
    async search(request) {
      reads++; assert.equal(request.actor.subject, actor.subject); assert.equal(request.stageKey, 'price_bands');
      return { observedAt: '2026-10-12T10:00:00Z', sources: [{ url: 'https://example.com/product-evidence', title: '保温杯资料', excerpt: '样品资料记录了保温杯产品。', type: 'general' }] };
    } };
  const f = await fixture(t, { researchAdapter: adapter, responses: [fauxAssistantMessage(fauxToolCall('workspace_research', { query: '保温杯产品资料', limit: 1 }), { stopReason: 'toolUse' }), request => {
    const tool = request.messages.at(-1); assert.notEqual(tool.isError, true, JSON.stringify(tool));
    const receipt = JSON.parse(tool.content.find(item => item.type === 'text').text);
    return complete(proposal('样品资料记录了保温杯产品。', [receipt.evidence[0].id]));
  }] });
  const task = await f.task('opportunity-discovery'), admitted = await f.submit(task);
  await until(() => f.runtime.getRun(admitted.run.id).run.status !== 'running');
  const run = f.runtime.getRun(admitted.run.id).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); assert.equal(reads, 1); assert.equal(f.faux.state.callCount, 2);
  const step = f.store.read().workspaceAgentTasks.tasks[0].steps[0];
  assert.match(step.output, /https:\/\/example.com\/product-evidence/); assert.equal(step.result.businessGoalAchieved, false);
  assert.equal(step.result.externalSearchPerformed, true); assert.equal(step.result.researchReceipts.length, 1);
  await f.reopen(); const duplicate = await f.submit(task);
  assert.equal(duplicate.run.id, run.id); assert.equal(reads, 1); assert.equal(f.faux.state.callCount, 2);
});

test('unsupported plain text cannot substitute for a source checked preset result', async t => {
  const f = await fixture(t, { responses: [fauxAssistantMessage(JSON.stringify({ done: true, content: '任务完成' }))] }), task = await f.task();
  const admitted = await f.submit(task);
  await until(() => f.runtime.getRun(admitted.run.id).run.status !== 'running');
  const run = f.runtime.getRun(admitted.run.id).run;
  assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'PI_PRESET_PROPOSAL_REQUIRED');
  assert.equal(f.store.read().workspaceAgentTasks.tasks[0].steps[0].output, null);
});

test('recovery reuses a committed Pi research receipt after the following model response was interrupted', async t => {
  let reads = 0, receipt;
  const adapter = { id: 'read-recovery-fixture', revision: 1, replay: 'safe', configured: true, capabilities: ['web_search'], async search() {
    reads++; return { observedAt: '2026-10-12T10:00:00Z', sources: [{ url: 'https://example.com/read-recovery', title: '待核对资料', excerpt: '材料描述了保温杯的使用场景。' }] };
  } };
  const f = await fixture(t, { researchAdapter: adapter, responses: [fauxAssistantMessage(fauxToolCall('workspace_research', { query: '保温杯使用场景' }), { stopReason: 'toolUse' }), async (request, options) => {
    receipt = JSON.parse(request.messages.at(-1).content.find(item => item.type === 'text').text);
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }] });
  const task = await f.task('opportunity-discovery'), admitted = await f.submit(task);
  await until(() => reads === 1 && !!receipt && f.faux.state.callCount === 2);
  const previous = f.runtime.getRun(admitted.run.id).run;
  await f.reopen(); f.faux.setResponses([complete(proposal('材料描述了保温杯的使用场景。', [receipt.evidence[0].id]))]);
  await f.runtime.recoverPiRun(previous.id, { requestId: 'continue-after-read-checkpoint' });
  await until(() => f.runtime.getRun(previous.id).run.status !== 'running');
  const after = f.runtime.getRun(previous.id).run;
  assert.equal(after.status, 'succeeded', JSON.stringify(after.error));
  assert.equal(after.piSubmissionId, previous.piSubmissionId); assert.equal(reads, 1); assert.equal(f.faux.state.callCount, 3);
  assert.equal(after.agentPresetResult.researchReceipts[0].id, receipt.id);
});

test('empty real search sources block the document stage and cannot become completed research', async t => {
  const adapter = { id: 'empty-search-fixture', revision: 1, replay: 'safe', configured: true, capabilities: ['web_search'], async search() { return { observedAt: '2026-10-12T10:00:00Z', sources: [] }; } };
  const f = await fixture(t, { researchAdapter: adapter, responses: [fauxAssistantMessage(fauxToolCall('workspace_research', { query: '没有返回资料的查询' }), { stopReason: 'toolUse' }), complete(), request => {
    assert.equal(request.messages.at(-1).isError, true); return fauxAssistantMessage('缺少资料，请保留原任务。');
  }] });
  const task = await f.task('opportunity-discovery'), admitted = await f.submit(task);
  await until(() => f.runtime.getRun(admitted.run.id).run.status !== 'running');
  const run = f.runtime.getRun(admitted.run.id).run, step = f.store.read().workspaceAgentTasks.tasks[0].steps[0];
  assert.equal(run.status, 'blocked'); assert.equal(run.error.code, 'AGENT_EVIDENCE_MISSING');
  assert.equal(step.status, 'blocked'); assert.equal(step.output, null);
});

test('a changed server model endpoint cannot resume an admitted Pi checkpoint', async t => {
  for (const baseUrl of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=value', 'https://example.com/v1#fragment']) assert.throws(() => createPiProvider({ baseUrl }), /HTTPS URL without credentials/);
  const f = await fixture(t, { baseUrl: 'https://first.example.com/v1', responses: [async (_request, options) => {
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }] }), task = await f.task();
  const admitted = await f.submit(task);
  await until(() => f.runtime.getRun(admitted.run.id).run.piSubmissionId && f.faux.state.callCount === 1);
  const original = f.runtime.getRun(admitted.run.id).run;
  assert.equal(original.execution.endpointFingerprint, f.provider.endpointFingerprint);
  await f.reopen({ baseUrl: 'https://second.example.com/v1' });
  await assert.rejects(f.runtime.recoverPiRun(original.id, { requestId: 'different-endpoint-recovery' }), { code: 'EXECUTION_SCOPE_CHANGED' });
  assert.notEqual(original.execution.endpointFingerprint, f.provider.endpointFingerprint);
  assert.equal(f.faux.state.callCount, 1); assert.equal(f.store.read().runs.length, 1);
  assert.equal(f.runtime.getRun(original.id).run.piSubmissionId, original.piSubmissionId);
});
