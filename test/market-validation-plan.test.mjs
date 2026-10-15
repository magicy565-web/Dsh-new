// Real original HTTP Session, Store and artifacts with synthetic product bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { materialsFixture, MODEL, RECIPIENT } from './fixtures/factory-materials-read.mjs';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { marketPlan } from './fixtures/market-validation-plan-data.mjs';
import { createWorkspaceFactoryMaterialsClient } from '../packages/workspace-procurement/src/workspace-factory-materials-client.mjs';
import { createMarketValidationPlanClient, MARKET_PLAN_FLAGS } from '../server/market-validation-plan.mjs';
import { validatePlanInput } from '../packages/workspace-market-validation/src/plan.mjs';
import extension, { marketValidationExtension, MARKET_VALIDATION_TOOLS } from '../packages/workspace-market-validation/src/extension.js';
import { publicPdfBytes } from './fixtures/workspace-omp-public-pdf.mjs';

async function fixture(t, documentBytes = null) {
  const f = await materialsFixture(t), flags = { active: true, admitted: true };
  if (documentBytes) {
    const file = (await f.app.artifacts.create({ requestId: randomUUID(), filename: 'synthetic-scanned.pdf', base64: documentBytes.toString('base64'), metadata: { businessLibrary: { visibility: 'internal' } } })).artifact;
    f.asset = { artifactId: file.id, version: file.currentVersion, sha256: file.sha256 };
    f.document = (await f.app.businessLibrary.createDocument({ requestId: randomUUID(), title: 'Synthetic scan', slotKey: 'specification', asset: f.asset }, f.actor)).document;
    f.product = (await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { documents: [{ documentId: f.document.id, documentVersion: 1, purpose: 'Synthetic scan' }] } }, f.actor)).product;
    f.policy.factoryMaterials.products = [{ id: f.product.id, revision: f.product.revision }];
    f.policy.factoryMaterials.documents = [{ id: f.document.id, revision: 1, documentVersion: 1, asset: f.asset }];
    await f.app.close(); Object.assign(f, await taskFixture(t, { directory: f.directory, enterprise: true, libraryModelReadPolicy: f.policy }));
  }
  const c = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Synthetic market plan conversation', requestId: randomUUID() } });
  assert.equal(c.status, 201, c.text); const conversationId = c.json.conversation.id;
  const materialsClient = createWorkspaceFactoryMaterialsClient({ recipient: RECIPIENT, request: async (route, options) => {
    const r = await f.workspace(route, { subject: 'member-a', headers: options.headers });
    return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
  } });
  const identity = { subject: 'member-a', workspaceId: 'pi-enterprise-test', role: 'admin' };
  const make = (overrides = {}) => createMarketValidationPlanClient({ materialsClient, artifacts: f.app.artifacts, store: f.app.store, identity,
    conversationId, authorize: async () => { if (!flags.active) throw Object.assign(Error('Synthetic original authority revoked'), { status: 403 }); },
    canSave: () => flags.active && flags.admitted, ...overrides });
  const selectors = { productId: f.product.id, documents: [{ documentId: f.document.id, documentVersion: 1 }] };
  let client = make();
  const input = async (mode = 'b2c', requestId = randomUUID()) => ({ ...selectors, sources: (await client.read(selectors, undefined, MODEL)).sources, plan: marketPlan(mode), requestId });
  return { f, selectors, flags, make, input, get client() { return client; }, async restart() {
    await f.app.close(); Object.assign(f, await taskFixture(t, { directory: f.directory, enterprise: true, libraryModelReadPolicy: f.policy })); client = make();
  } };
}
const savedRows = f => f.app.store.read().artifacts.filter(a => a.metadata?.marketValidationPlan);

test('reads original authorized product/documents with unknown supply and no private field expansion', async t => {
  const { f, client, selectors } = await fixture(t), receipt = await client.read(selectors, undefined, MODEL);
  assert.equal(receipt.status, 'available'); assert.equal(receipt.materialReceipt.products[0].id, f.product.id);
  assert.equal(receipt.materialReceipt.products[0].capacityNote, ''); assert.equal(receipt.materialReceipt.products[0].skuSpecifications[0].moq, null);
  const body = JSON.stringify(receipt);
  assert.ok(!body.includes('UNAPPROVED_PRIVATE_PRICE_NOTE')); assert.ok(!body.includes('UNAPPROVED_PACKAGING_NOTE'));
  assert.equal(receipt.sources.length, 2); assert.equal(receipt.sources[1].sha256, f.asset.sha256);
  await client.revalidateReceipt(receipt, MODEL); assert.equal(savedRows(f).length, 0);
  await assert.rejects(client.revalidateReceipt({ ...receipt, humanReviewed: true }, MODEL), e => e.code === 'MARKET_PLAN_CACHE_REFUSED');
  await assert.rejects(client.read({ ...selectors, documents: [{ documentId: randomUUID(), documentVersion: 1 }] }, undefined, MODEL), e => e.code === 'MARKET_PLAN_DOCUMENT_NOT_LINKED');
  await assert.rejects(client.read({ ...selectors, fields: ['price'] }, undefined, MODEL));
});

for (const mode of ['b2b', 'b2c', 'dual']) test(`${mode} draft retains freely authored steps and precise sources; saving does not launch or create tasks`, async t => {
  const { f, client, input } = await fixture(t), selected = await input(mode);
  selected.plan.paths[0].steps = ['模型按目标自选的比较与提问，无固定每日模板'];
  const before = structuredClone(f.app.store.read()), receipt = await client.save(selected, undefined, MODEL);
  assert.equal(receipt.status, 'saved-draft');
  for (const [k, v] of Object.entries(MARKET_PLAN_FLAGS)) assert.equal(receipt[k], v);
  const file = await f.app.artifacts.download(receipt.artifact.artifactId, { version: receipt.artifact.version }), saved = JSON.parse(file.bytes);
  assert.deepEqual(saved.plan, selected.plan); assert.deepEqual(saved.sources, selected.sources); assert.equal(saved.execution.durationDays, 7);
  assert.equal(saved.execution.actualStartedAt, null); assert.equal(saved.execution.endsAt, null); assert.equal(saved.execution.baseline, null);
  assert.equal(saved.shopifyHandoff.execute, 'shopify-execute'); assert.equal(saved.shopifyHandoff.b2bRfqPage, 'not_implemented');
  const after = f.app.store.read();
  for (const field of ['runs', 'workspaceAgentTasks', 'capabilities', 'workspaceSupplierServices']) assert.deepEqual(after[field], before[field]);
  await client.revalidateReceipt(receipt, MODEL);
});

test('plan input rejects model approval, fake starts, cross-path sales units and budget/commission ambiguity', () => {
  const input = { productId: randomUUID(), documents: [], sources: [{ kind: 'factory-product', recordId: randomUUID(), revision: 1,
    workspaceId: 'synthetic', projectionSha256: 'a'.repeat(64), api: '/original/materials' }], plan: marketPlan(), requestId: 'synthetic-validation' };
  assert.deepEqual(validatePlanInput(input), input);
  const bad = mutate => { const p = structuredClone(input); mutate(p); assert.throws(() => validatePlanInput(p)); };
  bad(p => { p.approved = true; }); bad(p => { p.plan.actualStartedAt = '2026-10-15T00:00:00Z'; });
  bad(p => { p.plan.supply.dropshipping.confirmed = true; }); bad(p => { p.plan.budget.approved = true; });
  bad(p => { p.plan.paths[0].salesRequirement.metric = 'qualified_inquiries'; });
  bad(p => { p.plan.mode = 'dual'; }); bad(p => { p.plan.paths[0].metrics[0].id = 'b2b_orders'; });
  bad(p => { p.plan.paths[0].metrics[0].availability = 'verified'; });
  bad(p => { p.plan.timeZone = 'unreal/zone'; });
  bad(p => { p.plan.timeZone = '+08:00'; });
  bad(p => { p.plan.budget = { status: 'proposed', currency: 'CNY', totalCap: '0.30', lines: [
    { id: 'a', category: 'other', acquisitionId: null, cap: '0.20', purpose: 'a' }, { id: 'b', category: 'other', acquisitionId: null, cap: '0.11', purpose: 'b' }] }; });
  const proposed = structuredClone(input);
  proposed.plan.budget = { status: 'proposed', currency: 'CNY', totalCap: '100.00', lines: [
    { id: 'channel', category: 'acquisition', acquisitionId: 'b2c-source', cap: '80', purpose: '待批准渠道' },
    { id: 'fee', category: 'commission', acquisitionId: null, cap: '20', purpose: '待批准佣金预留' }] };
  proposed.plan.commission = { status: 'proposed', payer: '工厂', payee: '待审核服务方', basis: '净支付商品额，扣退款，不含税费运费',
    method: 'percentage', rateOrAmount: '5', currency: 'CNY', settlement: '退款期过后逐单核对', refunds: '退款撤回佣金', cap: '20', budgetLineId: 'fee' };
  assert.deepEqual(validatePlanInput(proposed), proposed);
  for (const change of [c => { c.payee = null; }, c => { c.refunds = null; }, c => { c.currency = 'USD'; },
    c => { c.rateOrAmount = '100.01'; }, c => { c.cap = '21'; }, c => { c.budgetLineId = 'channel'; }]) {
    const next = structuredClone(proposed); change(next.plan.commission); assert.throws(() => validatePlanInput(next));
  }
});

test('exact parallel replay persists one original artifact; edits require a new requestId and survive reload', async t => {
  const state = await fixture(t), input = await state.input(), results = await Promise.all([state.client.save(input, undefined, MODEL), state.client.save(input, undefined, MODEL)]);
  assert.equal(results[0].artifact.artifactId, results[1].artifact.artifactId); assert.equal(savedRows(state.f).length, 1);
  await assert.rejects(state.client.save({ ...input, plan: { ...input.plan, goal: 'changed intent' } }, undefined, MODEL), e => e.code === 'MARKET_PLAN_REQUEST_CHANGED');
  await state.restart(); const replay = await state.client.save(input, undefined, MODEL);
  assert.equal(replay.artifact.artifactId, results[0].artifact.artifactId); assert.equal(replay.artifact.duplicate, true);
  await state.client.revalidateReceipt(replay, MODEL);
  const edited = await state.client.save({ ...input, requestId: randomUUID(), plan: { ...input.plan, goal: 'editable new draft' } }, undefined, MODEL);
  assert.notEqual(edited.artifact.artifactId, replay.artifact.artifactId); assert.equal(savedRows(state.f).length, 2);
});

test('revocation, receiver change, source drift and read-only intent block save and cached disclosure', async t => {
  const { f, client, input, flags, selectors } = await fixture(t), selected = await input(), receipt = await client.save(selected, undefined, MODEL);
  flags.admitted = false; await assert.rejects(client.save(selected, undefined, MODEL), e => e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED'); flags.admitted = true;
  flags.active = false; await assert.rejects(client.revalidateReceipt(receipt, MODEL), /revoked/); flags.active = true;
  await assert.rejects(client.read(selectors, undefined, { ...MODEL, id: 'different-model' }), e => e.code === 'MARKET_PLAN_SOURCE_REFUSED');
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'Synthetic changed product' } }, f.actor);
  await assert.rejects(client.save(selected, undefined, MODEL), e => e.code === 'MARKET_PLAN_SOURCE_REFUSED');
  await assert.rejects(client.revalidateReceipt(receipt, MODEL), e => e.code === 'MARKET_PLAN_SOURCE_REFUSED');
  assert.equal(savedRows(f).length, 1);
});

test('forged sources or cached fields cannot become evidence, and foreign original conversations cannot disclose', async t => {
  const { f, client, input, make } = await fixture(t), selected = await input(), receipt = await client.save(selected, undefined, MODEL);
  const forged = structuredClone(selected); forged.sources[0].projectionSha256 = '0'.repeat(64);
  await assert.rejects(client.save(forged, undefined, MODEL), e => e.code === 'MARKET_PLAN_SOURCE_CHANGED');
  for (const change of [r => { r.extraPrivatePayload = 'inadmissible'; }, r => { r.humanReviewed = true; }, r => { r.startedAt = '2026-10-15T00:00:00Z'; },
    r => { r.artifact.extraPrivatePayload = 'inadmissible'; }, r => { r.extraction[0].notice = 'inadmissible'; }, r => { r.planHash = '0'.repeat(64); },
    r => { r.input.unapproved = true; }]) {
    const next = structuredClone(receipt); change(next); await assert.rejects(client.revalidateReceipt(next, MODEL));
  }
  await assert.rejects(make({ identity: { subject: 'member-b', workspaceId: 'pi-enterprise-test', role: 'operator' } }).revalidateReceipt(receipt, MODEL));
  const foreign = await f.workspace('/api/conversations', { subject: 'member-b', body: { title: 'Foreign original conversation', requestId: randomUUID() } });
  assert.equal(foreign.status, 201);
  await assert.rejects(make({ conversationId: foreign.json.conversation.id }).save(selected, undefined, MODEL));
});

test('commit-bound cancellation and product drift refuse all draft persistence', async t => {
  const { f, client, input, flags } = await fixture(t), selected = await input(), original = f.app.artifacts.create;
  f.app.artifacts.create = (...args) => { flags.admitted = false; return original(...args); };
  await assert.rejects(client.save(selected, undefined, MODEL), e => e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED'); assert.equal(savedRows(f).length, 0);
  flags.admitted = true;
  f.app.artifacts.create = async (...args) => {
    await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: 1, changes: { name: 'Commit changed' } }, f.actor);
    return original(...args);
  };
  await assert.rejects(client.save(selected, undefined, MODEL), e => e.code === 'MARKET_PLAN_SOURCE_CHANGED'); assert.equal(savedRows(f).length, 0);
});

test('native PDF partial/OCR notices remain attached to the saved plan, without claiming complete document facts', { timeout: 30000 }, async t => {
  const { f, client, selectors, input } = await fixture(t, publicPdfBytes());
  const read = await client.read(selectors, undefined, MODEL); assert.equal(read.status, 'partial');
  assert.match(read.documentReceipts[0].document.text, /Text extraction is incomplete/); assert.deepEqual(read.extraction[0].pagesNeedingOcr, [1]);
  const receipt = await client.save(await input(), undefined, MODEL);
  const saved = JSON.parse((await f.app.artifacts.download(receipt.artifact.artifactId)).bytes);
  assert.deepEqual(saved.extraction, read.extraction); assert.equal(saved.execution.status, 'not_started');
  await client.revalidateReceipt(receipt, MODEL);
});

test('actual original Session logout and exact artifact edits invalidate plan read/cache', async t => {
  const { f, client, input, selectors } = await fixture(t), selected = await input(), receipt = await client.save(selected, undefined, MODEL);
  const row = f.app.artifacts.get(receipt.artifact.artifactId).artifact;
  await f.app.artifacts.update(row.id, { expectedRevision: row.revision, content: '{"fake":"not the reviewed source-bound plan"}' });
  await assert.rejects(client.revalidateReceipt(receipt, MODEL));
  const logout = await f.workspace('/api/session/logout', { subject: 'member-a', body: {} }); assert.equal(logout.status, 200);
  await assert.rejects(client.read(selectors, undefined, MODEL), e => e.code === 'MARKET_PLAN_SOURCE_REFUSED');
});

test('ordinary package is unconfigured; bound tools require current receiver and scrub private Host failures', async () => {
  const tools = []; extension({ registerTool: tool => tools.push(tool) });
  assert.deepEqual(tools.map(t => t.name), MARKET_VALIDATION_TOOLS);
  const read = { productId: randomUUID(), documents: [] };
  assert.equal((await tools[0].execute('id', read, undefined, undefined, {})).details.status, 'unconfigured');
  const bound = []; let calls = 0, active = true;
  marketValidationExtension({ authorize: async () => { if (!active) throw Error('private error'); }, client: { read: async () => {
    calls++; active = false; return { plugin: 'workspace-market-validation', status: 'available', sources: [{ private: 'must-be-scrubbed' }] };
  } } })({ registerTool: t => bound.push(t) });
  const refused = await bound[0].execute('id', read, undefined, undefined, { model: MODEL });
  assert.equal(refused.details.status, 'blocked'); assert.deepEqual(refused.details.sources, []); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(refused).includes('private error'));
});
