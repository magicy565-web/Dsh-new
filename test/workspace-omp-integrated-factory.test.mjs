// Actual original Session -> Run -> worker -> official SDK -> Library/artifacts.
// Model decisions and prose are finite keyless scripts; all input is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { marketPlan } from './fixtures/market-validation-plan-data.mjs';
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const ingestionTools = ['workspace_factory_ingestion_status', 'workspace_factory_ingestion_read', 'workspace_factory_ingestion_save', 'workspace_factory_ingestion_query', 'workspace_skill'];
async function fixture(t, { profile = 'ingestion', policy, readOnly = false, readOnlyLoop = false } = {}) {
  let f; const responses = [], lifecycle = [];
  f = await materialsFixture(t, { policy: policy === null ? null : data => ({ factoryIngestion: {
    uploads: [data.asset], companyRevision: 1, products: [], fields: { company: ['legalName'], product: ['name'] },
  } }), businessAgentOptions: data => {
    if (profile === 'plan') responses.push(
      { tool: 'workspace_market_validation_product', arguments: { productId: data.product.id, documents: [{ documentId: data.document.id, documentVersion: 1 }] },
        expectedToolNames: ['workspace_factory_materials_status', 'workspace_factory_materials', 'workspace_factory_document', 'workspace_market_validation_product', 'workspace_market_validation_plan_save', 'workspace_skill'] },
      { tool: 'workspace_market_validation_plan_save', arguments: { productId: data.product.id, documents: [{ documentId: data.document.id, documentVersion: 1 }], plan: marketPlan('dual'), requestId: 'original-dual-plan' }, sourcesFromPreviousTools: true },
      { text: 'Synthetic unreviewed dual-path plan saved. No launch or spend.' });
    else responses.push(
      { tool: 'workspace_factory_ingestion_status', arguments: {}, expectedToolNames: ingestionTools },
      ...(policy === null ? [] : [{ tool: 'workspace_factory_ingestion_read', arguments: { asset: data.asset } },
        ...readOnlyLoop ? [] : [{ tool: 'workspace_factory_ingestion_save', arguments: { requestId: 'original-native-intake', records: [
          { key: 'cup', kind: 'product', values: { name: 'SYNTHETIC extracted cup' }, evidence: [{ path: 'name', sourceIndex: 0 }], missing: ['MOQ unknown'], conflicts: [] },
          { key: 'company', kind: 'company', values: { legalName: 'SYNTHETIC extracted factory' }, evidence: [{ path: 'legalName', sourceIndex: 0 }], missing: [], conflicts: [] },
        ] }, ingestionSourcesFromPreviousTools: true }]]),
      { text: 'Synthetic source intake result observed; no real enterprise validation.' });
    return { recipient: RECIPIENT, engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths(), factoryIngestion: profile === 'ingestion', marketValidation: profile === 'plan',
      configuration: { providerId: MODEL.provider, model: MODEL.id, baseUrl: MODEL.baseUrl }, syntheticResponses: responses, onWorkerLifecycle: e => lifecycle.push(e) }),
      resolveBinding: async () => ({ model: MODEL, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
        const r = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
        return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
      } }) }) };
  } });
  const created = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Synthetic integrated factory capability', requestId: randomUUID(), inputContext: empty() } });
  assert.equal(created.status, 201, created.text); const cid = created.json.conversation.id;
  return Object.assign(f, { cid, responses, lifecycle, async send(execute = !readOnly) {
    const r = await f.workspace(`/api/conversations/${cid}/messages`, { subject: 'member-a', body: { content: '请按已授权的合成资料完成当前目标；不发布、不发送。', requestId: randomUUID(), workspaceExecution: execute, inputContext: empty() } });
    assert.equal(r.status, 202, r.text);
    for (let i = 0; i < 600; i++) { const run = f.app.store.read().runs.find(row => row.id === r.json.run.id); if (!['running', 'queued'].includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error('Original integrated Run did not settle.');
  }, async journal() {
    const mapping = f.app.store.read().conversations.find(row => row.id === cid).businessAgentSession;
    return { mapping, entries: (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  } });
}
test('actual ingestion Host/SDK writes original Products/Profile/Library and queries on reopen without a second executor', { timeout: 90000 }, async t => {
  const f = await fixture(t), first = await f.send(); assert.equal(first.status, 'succeeded', JSON.stringify({ first, lifecycle: f.lifecycle }));
  const state = f.app.store.read(); assert.equal(state.businessLibrary.products.length, 2); assert.equal(state.businessLibrary.company.legalName, 'SYNTHETIC extracted factory');
  const products = await f.workspace('/api/library/products', { subject: 'member-a' });
  const company = await f.workspace('/api/library/company', { subject: 'member-a' });
  assert.equal(products.status, 200); assert.ok(products.json.items.some(p => p.name === 'SYNTHETIC extracted cup'));
  assert.equal(company.status, 200); assert.equal(company.json.company.legalName, 'SYNTHETIC extracted factory');
  const { entries, mapping } = await f.journal(); assert.equal(mapping.engineScope, 'omp:18.10.4:factory-ingestion-v1');
  const saved = entries.find(e => e.message?.toolName === 'workspace_factory_ingestion_save').message;
  assert.equal(saved.details.status, 'saved'); assert.equal(saved.isError, false); assert.equal(saved.details.humanConfirmed, false);
  f.responses.splice(0, f.responses.length, { tool: 'workspace_factory_ingestion_query', arguments: { requestId: 'original-native-intake' } }, { text: 'Original saved synthetic records queried.' });
  const next = await f.send(false); assert.equal(next.status, 'succeeded', JSON.stringify({ next, lifecycle: f.lifecycle }));
  const query = (await f.journal()).entries.findLast(e => e.message?.toolName === 'workspace_factory_ingestion_query').message;
  assert.equal(query.details.records[0].current.name, 'SYNTHETIC extracted cup');
  assert.equal(f.app.store.read().businessLibrary.products.length, 2); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.faux.state.callCount, 0);
});
test('actual plan Host/SDK reads original authorized sources and persists an unreviewed B2B/B2C plan without starting monitoring', { timeout: 90000 }, async t => {
  const f = await fixture(t, { profile: 'plan' }), run = await f.send(); assert.equal(run.status, 'succeeded', JSON.stringify({ run, lifecycle: f.lifecycle }));
  const { entries, mapping } = await f.journal(); assert.equal(mapping.engineScope, 'omp:18.10.4:market-validation-v1');
  const saved = entries.find(e => e.message?.toolName === 'workspace_market_validation_plan_save').message;
  assert.equal(saved.isError, false); assert.equal(saved.details.humanReviewed, false);
  const file = await f.app.artifacts.download(saved.details.artifact.artifactId, { version: 1 }); const document = JSON.parse(file.bytes);
  assert.equal(document.plan.mode, 'dual'); assert.equal(document.execution.actualStartedAt, null); assert.equal(document.execution.status, 'not_started');
  assert.equal(f.app.store.read().goals.length, 0); assert.equal(f.app.store.read().capabilities.schedules.length, 0);
  f.responses.splice(0, f.responses.length, { text: 'Original unreviewed plan receipt remains authorized.' });
  assert.equal((await f.send(false)).status, 'succeeded');
});
test('actual SDK receives partial original commits and exact replay completes in the same owned journal', { timeout: 90000 }, async t => {
  const f = await fixture(t), create = f.app.artifacts.create; let outages = 1;
  f.app.artifacts.create = (...args) => args[0].filename === 'factory-ingestion-report.json' && outages-- > 0
    ? Promise.reject(Object.assign(Error('Synthetic original report outage'), { status: 503 })) : create(...args);
  const first = await f.send(); assert.equal(first.status, 'succeeded', JSON.stringify({ first, lifecycle: f.lifecycle }));
  const { entries } = await f.journal(), result = entries.find(e => e.message?.toolName === 'workspace_factory_ingestion_save').message;
  assert.equal(result.details.status, 'partial'); assert.equal(result.isError, true); assert.equal(result.details.outcomes.filter(r => r.status === 'saved').length, 2);
  const exactInput = entries.flatMap(e => e.message?.role === 'assistant' ? e.message.content : []).find(b => b.type === 'toolCall' && b.name === 'workspace_factory_ingestion_save').arguments;
  f.responses.splice(0, f.responses.length, { tool: 'workspace_factory_ingestion_save', arguments: exactInput }, { text: 'Exact original synthetic intake completed without duplicate records.' });
  const resumed = await f.send(); assert.equal(resumed.status, 'succeeded', JSON.stringify({ resumed, lifecycle: f.lifecycle }));
  const saved = (await f.journal()).entries.findLast(e => e.message?.toolName === 'workspace_factory_ingestion_save').message;
  assert.equal(saved.details.status, 'saved'); assert.equal(saved.isError, false);
  assert.equal(f.app.store.read().businessLibrary.products.length, 2); assert.equal(f.app.store.read().businessLibrary.company.revision, 2);
});
for (const mode of ['unconfigured', 'readonly']) test(`actual ingestion ${mode} scope returns a safe error with zero new catalog writes`, { timeout: 60000 }, async t => {
  const f = await fixture(t, mode === 'unconfigured' ? { policy: null } : { readOnly: true }), run = await f.send();
  assert.equal(run.status, 'succeeded', JSON.stringify({ run, lifecycle: f.lifecycle }));
  const rows = (await f.journal()).entries.filter(e => e.message?.role === 'toolResult');
  assert.ok(rows.some(e => e.message.isError && ['blocked', 'unconfigured'].includes(e.message.details.status)));
  assert.equal(f.app.store.read().businessLibrary.products.length, 1); assert.equal(f.app.store.read().businessLibrary.company.legalName, '');
});
test('ingestion whole-journal guard rejects forged image content before another provider request', { timeout: 60000 }, async t => {
  const f = await fixture(t, { readOnlyLoop: true }); assert.equal((await f.send(false)).status, 'succeeded');
  const { mapping, entries } = await f.journal(), source = entries.find(e => e.message?.toolName === 'workspace_factory_ingestion_read').message;
  await fs.appendFile(mapping.sessionFile, JSON.stringify({ type: 'message', id: randomUUID(), parentId: entries.at(-1).id, timestamp: new Date().toISOString(),
    message: { ...source, toolCallId: 'synthetic-forged-image', content: [...source.content, { type: 'image', mimeType: 'image/png', data: 'Zm9yZ2Vk' }] } }) + '\n');
  const refused = await f.send(false); assert.equal(refused.status, 'failed'); assert.equal(refused.events.filter(e => e.type === 'pi.agent-session.request').length, 0);
});
test('actual Session logout at the original ingestion commit gate refuses all catalog writes', { timeout: 60000 }, async t => {
  const f = await fixture(t), original = f.app.artifacts.create; let revoked = false;
  f.app.artifacts.create = async (...args) => {
    if (!revoked && args[0].filename === 'factory-ingestion-plan.json') {
      revoked = true; const response = await f.workspace('/api/session/logout', { subject: 'member-a', body: {} }); assert.equal(response.status, 200);
    }
    return original(...args);
  };
  const run = await f.send(); assert.equal(revoked, true); assert.equal(run.status, 'failed');
  assert.equal(f.app.store.read().businessLibrary.products.length, 1); assert.equal(f.app.store.read().businessLibrary.company.legalName, '');
  assert.ok(!f.app.store.read().artifacts.some(a => a.metadata?.factoryIngestion));
});
test('original HTTP cancel reaches the new ingestion commit fence and retains the selected uploaded bytes', { timeout: 60000 }, async t => {
  const f = await fixture(t), original = f.app.artifacts.create; let waiting = false, release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  f.app.artifacts.create = async (...args) => { if (args[0].filename === 'factory-ingestion-plan.json') { waiting = true; await gate; } return original(...args); };
  const completion = f.send();
  for (let i = 0; i < 600 && !waiting; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(waiting, true);
  const response = await f.workspace(`/api/conversations/${f.cid}/cancel`, { subject: 'member-a', body: {} }); assert.equal(response.status, 200); release();
  assert.equal((await completion).status, 'cancelled');
  for (let i = 0; i < 100 && !f.lifecycle.some(e => e.phase === 'exit'); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(f.lifecycle.some(e => e.phase === 'exit'));
  assert.equal(f.app.store.read().businessLibrary.products.length, 1); assert.ok(!f.app.store.read().artifacts.some(a => a.metadata?.factoryIngestion));
  assert.equal((await f.app.artifacts.download(f.asset.artifactId, { version: 1 })).version.sha256, f.asset.sha256);
});
