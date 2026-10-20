import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createAiWorkService, normalizeProductDefinition, leadDiscoveryDefinition } from '../server/ai-works.mjs';

const ADMIN = Object.freeze({ subject: 'local-operator', role: 'admin', workspaceId: 'local' });
const ADMIN2 = Object.freeze({ subject: 'second-admin', role: 'admin', workspaceId: 'local' });
const OPERATOR = Object.freeze({ subject: 'ops-1', role: 'operator', workspaceId: 'local' });
const VIEWER = Object.freeze({ subject: 'viewer-1', role: 'viewer', workspaceId: 'local' });
const LIBRARY_PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-21T00:00:00.000Z';

function libraryProduct(overrides = {}) {
  return {
    id: LIBRARY_PRODUCT_ID,
    revision: 1,
    companyId: 'company',
    name: '工业级手动工具套装',
    description: '面向维修与装配场景的手动工具套装，含扳手、套筒与收纳箱。',
    category: '手工具',
    status: 'draft',
    skus: [{
      id: '22222222-2222-4222-8222-222222222222',
      code: 'HT-001', unit: 'set', moq: 100, pricingMode: 'unset', pricingNote: '', priceTiers: [], leadTimeDays: 20,
      specs: [{ key: '材质', value: '铬钒钢' }, { key: '件数', value: '48 件' }],
    }],
    images: [],
    supply: { packaging: '纸箱 + 收纳盒', samplePolicy: '付费样品', paymentTerms: 'T/T 30% 定金', shippingTerms: 'FOB 上海', capacityNote: '月产能 5 万套' },
    documents: [],
    source: { kind: 'user_provided', referenceOnly: false, sourceUrl: null, fetchedAt: null, batchId: null, fieldSources: [] },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

async function fixture(t, { sourceEnvironment = {}, fetchImpl = fetch, outreachFetch = fetch } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-works-'));
  const products = new Map([[LIBRARY_PRODUCT_ID, libraryProduct()]]);
  const lookupProduct = id => {
    const product = products.get(id);
    if (!product) throw new Error('not found');
    return { product };
  };
  const clock = () => Date.parse(NOW);
  let store = await openStore(dir);
  const service = createAiWorkService({ store, lookupProduct, sourceEnvironment, fetchImpl, outreachFetch, clock });
  await service.initialize();
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  return {
    dir, products, lookupProduct,
    get store() { return store; },
    service,
    async reopen() {
      await store.close();
      store = await openStore(dir);
      return createAiWorkService({ store, lookupProduct, sourceEnvironment, fetchImpl, outreachFetch, clock });
    },
  };
}

const delegationBody = (overrides = {}) => ({
  requestId: 'req-delegation-1',
  productId: LIBRARY_PRODUCT_ID,
  targetCountry: '美国',
  buyerType: '进口商',
  targetCount: 30,
  deadlineDays: 21,
  ...overrides,
});
const importedRow = (overrides = {}) => ({
  companyName: 'Best Tools GmbH',
  website: 'https://best-tools.example.com',
  country: '德国',
  buyerType: '分销商',
  contactName: 'Anna Weber',
  contactTitle: 'Purchasing Manager',
  contactEmail: 'anna@best-tools.example.com',
  sourceUrl: 'https://best-tools.example.com/about',
  sourceExcerpt: 'We distribute hand tools and garden hardware across Germany.',
  sourceFetchedAt: '2026-10-15',
  ...overrides,
});
const importBody = (rows, requestId = 'req-import-1') => ({ requestId, format: 'json', content: JSON.stringify({ candidates: rows }) });

async function approvedDelegation(f, requestId = 'req-exec-1', overrides = {}) {
  const created = await f.service.createDelegation('lead-discovery', delegationBody({ requestId, ...overrides }), OPERATOR);
  const approved = await f.service.approveDelegation(created.delegation.id, { requestId: `approve-${requestId}`, confirmed: true }, ADMIN);
  return approved.delegation;
}

async function qualifiedCandidate(f, delegation, rowOverrides = {}, requestId = 'req-qualified-import') {
  const imported = await f.service.importCandidates(delegation.id, importBody([importedRow(rowOverrides)], requestId), OPERATOR);
  assert.equal(imported.import.imported, 1, JSON.stringify(imported.import));
  await f.service.executeDelegation(delegation.id, { requestId: `req-qualified-exec-${requestId}` }, OPERATOR);
  const candidate = f.service.listCandidates(delegation.id).candidates.find(item => item.status === 'needs_review');
  await f.service.reviewCandidate(candidate.id, { requestId: `req-qualified-review-${requestId}`, decision: 'qualified', reason: '证据与匹配度符合清单要求' }, OPERATOR);
  return f.service.listCandidates(delegation.id).candidates.find(item => item.id === candidate.id);
}

test('the first AI-work is published to the platform product registry exactly once', async t => {
  const f = await fixture(t);
  const catalog = f.service.catalog();
  assert.equal(catalog.products.length, 1);
  const product = catalog.products[0];
  assert.equal(product.id, 'lead-discovery');
  assert.equal(product.name, '客户线索挖掘');
  assert.equal(product.status, 'published');
  assert.equal(product.revision, 1);
  assert.match(product.contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(product.inputSchema.fields[0].name, 'productId');
  assert.equal(product.inputSchema.fields[0].type, 'product_ref');
  assert.ok(product.workflow.some(step => step.id === 'product-profile-check'));

  const again = await f.service.initialize();
  assert.equal(again.created, false);
  assert.equal(again.current, true);
  assert.equal(f.store.read().aiWorks.products.length, 1);

  const reopened = await f.reopen();
  assert.equal((await reopened.initialize()).created, false);
  assert.equal(reopened.catalog().products.length, 1);
  assert.equal(reopened.status().productLibraryAvailable, true);
});

test('product publication requires admin, versions by expectedRevision and is idempotent', async t => {
  const f = await fixture(t);
  const base = {
    requestId: 'req-publish-1', id: 'market-scan', playbook: 'lead-discovery',
    name: '市场扫描', summary: '扫描目标市场的采购客户结构。', category: '市场研究',
    inputSchema: { fields: [{ name: 'targetCountry', label: '目标国家', type: 'string', required: true, maxLength: 80 }] },
    workflow: [{ id: 'scan', title: '扫描', owner: 'agent', output: '扫描报告' }],
    deliverables: ['扫描报告'], acceptance: ['每条结论有来源'],
  };
  await assert.rejects(f.service.publish(base, OPERATOR), { code: 'ROLE_REQUIRED' });
  const created = await f.service.publish(base, ADMIN);
  assert.equal(created.duplicate, false);
  assert.equal(created.product.revision, 1);
  const duplicate = await f.service.publish(base, ADMIN);
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(f.service.publish({ ...base, name: '市场扫描 v2' }, ADMIN), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.service.publish({ ...base, requestId: 'req-publish-2', name: '市场扫描 v2' }, ADMIN), { code: 'REVISION_REQUIRED' });
  await assert.rejects(f.service.publish({ ...base, requestId: 'req-publish-2', name: '市场扫描 v2', expectedRevision: 9 }, ADMIN), { code: 'REVISION_CONFLICT' });
  const revised = await f.service.publish({ ...base, requestId: 'req-publish-2', name: '市场扫描 v2', expectedRevision: 1 }, ADMIN);
  assert.equal(revised.product.revision, 2);
  assert.equal(f.service.catalog().products.find(item => item.id === 'market-scan').revision, 2);
  await assert.rejects(f.service.publish({ ...base, id: 'bad-playbook', playbook: 'unknown' }, ADMIN), { code: 'UNSUPPORTED_PLAYBOOK' });
  await assert.rejects(f.service.publish({ ...base, id: 'bad-field', unexpected: true }, ADMIN), { code: 'INVALID_INPUT' });
});

test('a development-plan delegation pins the exact product-library revision', async t => {
  const f = await fixture(t);
  const created = await f.service.createDelegation('lead-discovery', delegationBody(), OPERATOR);
  const { delegation } = created;
  assert.equal(delegation.status, 'draft');
  assert.match(delegation.planHash, /^[a-f0-9]{64}$/u);
  assert.equal(delegation.productRefs[0].productId, LIBRARY_PRODUCT_ID);
  assert.equal(delegation.plan.productFacts.name, '工业级手动工具套装');
  assert.equal(delegation.plan.productFacts.supply.paymentTerms, 'T/T 30% 定金');
  assert.equal(delegation.plan.market.country.code, 'US');
  assert.ok(delegation.plan.discovery.queries.length >= 6);
  assert.ok(delegation.plan.discovery.queries.every(item => !item.query.includes('{产品/品类')));

  const again = await f.service.createDelegation('lead-discovery', delegationBody(), OPERATOR);
  assert.equal(again.duplicate, true);
  assert.equal(again.delegation.id, delegation.id);
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody({ targetCount: 99 }), OPERATOR), { code: 'IDEMPOTENCY_CONFLICT' });

  f.products.set(LIBRARY_PRODUCT_ID, libraryProduct({ revision: 2, name: '工业级手动工具套装（二代）', updatedAt: '2026-10-20T00:00:00.000Z' }));
  const revised = await f.service.createDelegation('lead-discovery', delegationBody({ requestId: 'req-delegation-2' }), OPERATOR);
  assert.equal(revised.delegation.productRefs[0].revision, 2);
  assert.equal(f.service.getDelegation(delegation.id).delegation.productRefs[0].revision, 1);
});

test('delegation input validation and product-library failures are explicit', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody({ productId: undefined }), OPERATOR), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody({ productId: '33333333-3333-4333-8333-333333333333' }), OPERATOR), { code: 'PRODUCT_NOT_FOUND' });
  f.products.set(LIBRARY_PRODUCT_ID, libraryProduct({ status: 'archived' }));
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody(), OPERATOR), { code: 'PRODUCT_ARCHIVED' });
  f.products.set(LIBRARY_PRODUCT_ID, libraryProduct());
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody(), VIEWER), { code: 'ROLE_REQUIRED' });
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody({ targetCountry: '' }), OPERATOR), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody({ targetCount: 2 }), OPERATOR), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.createDelegation('lead-discovery', delegationBody({ unexpected: 1 }), OPERATOR), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.createDelegation('not-published', delegationBody(), OPERATOR), { code: 'PRODUCT_NOT_PUBLISHED' });
});

test('market compliance, unknown-profile degradation and missing product facts are explicit', async t => {
  const f = await fixture(t);
  const germany = await f.service.createDelegation('lead-discovery', delegationBody({ requestId: 'req-de', targetCountry: '德国', buyerType: '分销商' }), OPERATOR);
  assert.equal(germany.delegation.plan.market.coldEmailPolicy, 'consent_required');
  assert.ok(germany.delegation.plan.market.coldEmailNote.includes('UWG'));
  const unknown = await f.service.createDelegation('lead-discovery', delegationBody({ requestId: 'req-unknown', targetCountry: '瓦坎达', buyerType: '神秘采购方' }), OPERATOR);
  assert.equal(unknown.delegation.plan.market.country.known, false);
  assert.equal(unknown.delegation.plan.buyerProfile.known, false);
  assert.ok(unknown.delegation.plan.notes.length >= 2);

  f.products.set(LIBRARY_PRODUCT_ID, libraryProduct({ category: '', description: '', skus: [], supply: { packaging: '', samplePolicy: '', paymentTerms: '', shippingTerms: '', capacityNote: '' } }));
  const incomplete = await f.service.createDelegation('lead-discovery', delegationBody({ requestId: 'req-incomplete' }), OPERATOR);
  assert.equal(incomplete.delegation.plan.productFacts.factCompleteness, 'incomplete');
  assert.ok(incomplete.delegation.plan.productFacts.missingFields.includes('category'));
  assert.ok(incomplete.delegation.plan.notes.some(item => item.includes('产品库事实缺口')));
});

test('approval and cancellation are admin-gated, durable and idempotent', async t => {
  const f = await fixture(t);
  const { delegation } = await f.service.createDelegation('lead-discovery', delegationBody(), OPERATOR);
  await assert.rejects(f.service.approveDelegation(delegation.id, { requestId: 'req-approve-0', confirmed: true }, OPERATOR), { code: 'ROLE_REQUIRED' });
  await assert.rejects(f.service.approveDelegation(delegation.id, { requestId: 'req-approve-0', confirmed: false }, ADMIN), { code: 'CONFIRMATION_REQUIRED' });
  const approved = await f.service.approveDelegation(delegation.id, { requestId: 'req-approve-1', confirmed: true, note: '计划已确认' }, ADMIN);
  assert.equal(approved.delegation.status, 'approved');
  assert.equal(approved.delegation.approvedBy, 'local-operator');
  assert.equal((await f.service.approveDelegation(delegation.id, { requestId: 'req-approve-1', confirmed: true, note: '计划已确认' }, ADMIN)).duplicate, true);
  await assert.rejects(f.service.approveDelegation(delegation.id, { requestId: 'req-approve-2', confirmed: true }, ADMIN), { code: 'INVALID_STATE' });

  const second = await f.service.createDelegation('lead-discovery', delegationBody({ requestId: 'req-cancel' }), OPERATOR);
  await assert.rejects(f.service.cancelDelegation(second.delegation.id, { requestId: 'req-cancel-1' }, VIEWER), { code: 'ROLE_REQUIRED' });
  const cancelled = await f.service.cancelDelegation(second.delegation.id, { requestId: 'req-cancel-1', reason: '客户暂停' }, OPERATOR);
  assert.equal(cancelled.delegation.status, 'cancelled');
  assert.equal(cancelled.delegation.cancelReason, '客户暂停');
  await assert.rejects(f.service.cancelDelegation(delegation.id, { requestId: 'req-cancel-2' }, OPERATOR), { code: 'INVALID_STATE' });

  const reopened = await f.reopen();
  assert.equal(reopened.getDelegation(delegation.id).delegation.status, 'approved');
  assert.equal(reopened.listDelegations().delegations.length, 2);
  assert.equal(reopened.catalog().products.length, 1);
});

test('stored AI-work records fail closed when the durable shape is damaged', async t => {
  const f = await fixture(t);
  const snapshot = f.store.read();
  const damaged = structuredClone(snapshot);
  damaged.aiWorks.version = 99;
  await assert.rejects(f.store.update(state => { state.aiWorks = damaged.aiWorks; }), /Unsupported or invalid workspace data/u);
  const brokenDelegation = structuredClone(snapshot);
  brokenDelegation.aiWorks.delegations.push({ id: 'x', status: 'running' });
  await assert.rejects(f.store.update(state => { state.aiWorks = brokenDelegation.aiWorks; }), /Unsupported or invalid workspace data/u);
  const brokenCandidate = structuredClone(snapshot);
  brokenCandidate.aiWorks.candidates = [{ id: 'c1', delegationId: 'missing', status: 'needs_review' }];
  await assert.rejects(f.store.update(state => { state.aiWorks = brokenCandidate.aiWorks; }), /Unsupported or invalid workspace data/u);
  const brokenDraft = structuredClone(snapshot);
  brokenDraft.aiWorks.drafts = [{ id: 'd1', delegationId: 'missing', candidateId: 'missing', status: 'draft', humanReviewRequired: true, sent: false, evidenceRefs: [] }];
  await assert.rejects(f.store.update(state => { state.aiWorks = brokenDraft.aiWorks; }), /Unsupported or invalid workspace data/u);
});

test('normalized product definition is stable and content-hashed', () => {
  const first = normalizeProductDefinition({ ...leadDiscoveryDefinition(), requestId: 'r-1' });
  const second = normalizeProductDefinition({ ...leadDiscoveryDefinition(), requestId: 'r-1' });
  assert.equal(first.contentHash, second.contentHash);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/u);
});

test('authorized import -> execution -> human review, with row-level rejection and durable counts', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-exec-1', { targetCountry: '德国', buyerType: '分销商' });
  const unapproved = await f.service.createDelegation('lead-discovery', delegationBody({ requestId: 'req-exec-unapproved' }), OPERATOR);
  await assert.rejects(f.service.importCandidates(unapproved.delegation.id, importBody([importedRow()], 'req-import-unapproved'), OPERATOR), { code: 'DELEGATION_NOT_APPROVED' });
  await assert.rejects(f.service.executeDelegation(unapproved.delegation.id, { requestId: 'req-exec-u1' }, OPERATOR), { code: 'DELEGATION_NOT_APPROVED' });

  const rows = [
    importedRow(),
    importedRow({ companyName: 'Alpha Hardware Ltd', website: 'https://www.alpha-hardware.example.com', contactEmail: 'buyer@alpha-hardware.example.com', sourceUrl: 'https://alpha-hardware.example.com/company', sourceExcerpt: 'Alpha Hardware imports garden tools for UK retailers.', country: '英国' }),
    importedRow({ companyName: 'Best Tools Duplicate', website: 'https://best-tools.example.com' }),
    importedRow({ companyName: 'No Evidence Corp', website: 'https://no-evidence.example.com', sourceExcerpt: '' }),
    importedRow({ companyName: 'Bad Website', website: 'javascript:alert(1)' }),
  ];
  const imported = await f.service.importCandidates(delegation.id, importBody(rows), OPERATOR);
  assert.equal(imported.import.imported, 2);
  assert.equal(imported.import.duplicates, 1);
  assert.equal(imported.import.rejected.length, 3);
  assert.deepEqual(imported.import.rejected.map(item => item.code).sort(), ['DUPLICATE_CANDIDATE', 'INVALID_ROW', 'INVALID_WEBSITE'].sort());
  assert.equal(imported.delegation.execution.counts.imported, 2);
  assert.equal(imported.delegation.execution.counts.candidates, 2);

  const repeated = await f.service.importCandidates(delegation.id, importBody(rows), OPERATOR);
  assert.equal(repeated.duplicate, true);
  await assert.rejects(f.service.importCandidates(delegation.id, importBody([importedRow({ companyName: 'Changed' })], 'req-import-1'), OPERATOR), { code: 'IDEMPOTENCY_CONFLICT' });

  const candidates = f.service.listCandidates(delegation.id).candidates;
  assert.equal(candidates.length, 2);
  const best = candidates.find(item => item.companyName === 'Best Tools GmbH');
  assert.equal(best.evidence[0].fetchedAt, '2026-10-15T00:00:00.000Z');
  assert.ok(best.fitScore >= 60);
  assert.ok(best.fitReasons.some(reason => reason.includes('目标国家')));

  const executed = await f.service.executeDelegation(delegation.id, { requestId: 'req-exec-1' }, OPERATOR);
  assert.equal(executed.delegation.execution.status, 'completed');
  assert.deepEqual(executed.delegation.execution.sources, ['authorized_import']);
  assert.equal((await f.service.executeDelegation(delegation.id, { requestId: 'req-exec-1' }, OPERATOR)).duplicate, true);

  await assert.rejects(f.service.reviewCandidate(best.id, { requestId: 'req-review-0', decision: 'qualified', reason: 'x' }, OPERATOR), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.reviewCandidate(best.id, { requestId: 'req-review-0', decision: 'qualified', reason: '资料齐全' }, VIEWER), { code: 'ROLE_REQUIRED' });
  const reviewed = await f.service.reviewCandidate(best.id, { requestId: 'req-review-1', decision: 'qualified', reason: '产品/国家/买家类型与证据齐全' }, OPERATOR);
  assert.equal(reviewed.candidate.status, 'qualified');
  assert.equal(reviewed.delegation.execution.counts.qualified, 1);
  await assert.rejects(f.service.reviewCandidate(best.id, { requestId: 'req-review-2', decision: 'rejected', reason: '重复审核' }, OPERATOR), { code: 'INVALID_STATE' });

  const reopened = await f.reopen();
  assert.equal(reopened.getDelegation(delegation.id).delegation.execution.counts.qualified, 1);
  assert.equal(reopened.listCandidates(delegation.id).candidates.length, 2);
  assert.equal(reopened.status().candidatesQualified, 1);
});

test('CSV import, awaiting-source honesty and source readiness', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-exec-csv');
  const empty = await f.service.executeDelegation(delegation.id, { requestId: 'req-exec-csv-1' }, OPERATOR);
  assert.equal(empty.awaitingSource, true);
  assert.equal(empty.delegation.execution.status, 'awaiting_source');
  assert.equal(f.service.listCandidates(delegation.id).candidates.length, 0);

  const csv = [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Casa Utensili S.r.l.","https://casa-utensili.example.it","意大利","经销商","Marco","Buyer","marco@casa-utensili.example.it","https://casa-utensili.example.it/about","""We import hand tools for the Italian market,"" said Marco.","2026-10-16","首批优先"',
  ].join('\n');
  const imported = await f.service.importCandidates(delegation.id, { requestId: 'req-import-csv', format: 'csv', content: csv }, OPERATOR);
  assert.equal(imported.import.imported, 1);
  assert.equal(imported.delegation.execution.status, 'not_started');
  const [candidate] = f.service.listCandidates(delegation.id).candidates;
  assert.equal(candidate.companyName, 'Casa Utensili S.r.l.');
  assert.ok(candidate.evidence[0].excerpt.includes('We import hand tools'));
  assert.equal((await f.service.executeDelegation(delegation.id, { requestId: 'req-exec-csv-2' }, OPERATOR)).delegation.execution.status, 'completed');

  const byId = Object.fromEntries(f.service.sources().sources.map(item => [item.id, item]));
  assert.equal(byId.authorized_import.status, 'available');
  assert.equal(byId.serper.status, 'unconfigured');
  assert.equal(byId.companies_house.status, 'unconfigured');
});

test('execution inputs are bounded and idempotent', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-exec-bounds');
  await assert.rejects(f.service.importCandidates(delegation.id, { requestId: 'req-bad-format', format: 'xml', content: '<x/>' }, OPERATOR), { code: 'INVALID_IMPORT' });
  await assert.rejects(f.service.importCandidates(delegation.id, { requestId: 'req-too-big', format: 'json', content: 'x'.repeat(64 * 1024 + 1) }, OPERATOR), { code: 'IMPORT_TOO_LARGE' });
  const rejected = await f.service.importCandidates(delegation.id, importBody([{ unexpected: true }], 'req-unknown'), OPERATOR);
  assert.equal(rejected.import.imported, 0);
  assert.equal(rejected.import.rejected[0].code, 'UNKNOWN_FIELD');
  const many = Array.from({ length: 3 }, (_, index) => importedRow({ companyName: `Row ${index}`, website: `https://row-${index}.example.com`, sourceUrl: `https://row-${index}.example.com/about` }));
  const imported = await f.service.importCandidates(delegation.id, importBody(many, 'req-many'), OPERATOR);
  assert.equal(imported.import.imported, 3);
  await assert.rejects(f.service.executeDelegation(delegation.id, { requestId: '' }, OPERATOR), { code: 'INVALID_INPUT' });
});

function serperFetch(results) {
  return async (url, options = {}) => {
    assert.match(String(url), /google\.serper\.dev/u);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-API-KEY'], 'test-serper-key');
    return { ok: true, status: 200, json: async () => ({ organic: results }) };
  };
}

test('configured Serper search turns planned queries into reviewable candidates with real evidence', async t => {
  const fetchImpl = serperFetch([
    { title: 'Best Tools GmbH', link: 'https://best-tools.example.com/about', snippet: 'We distribute hand tools and garden hardware across Germany.' },
    { title: 'Best Tools duplicate', link: 'https://best-tools.example.com/about', snippet: 'We distribute hand tools and garden hardware across Germany.' },
    { title: 'Insecure Tools', link: 'http://insecure.example.com/about', snippet: 'Hand tools importer without HTTPS.' },
    { title: 'No snippet', link: 'https://no-snippet.example.com', snippet: '' },
  ]);
  const f = await fixture(t, { sourceEnvironment: { SERPER_API_KEY: 'test-serper-key' }, fetchImpl });
  const delegation = await approvedDelegation(f, 'req-auto-serper', { targetCountry: '德国', buyerType: '分销商' });
  const executed = await f.service.executeDelegation(delegation.id, { requestId: 'req-auto-exec-1' }, OPERATOR);
  assert.equal(executed.delegation.execution.status, 'completed');
  assert.deepEqual(executed.delegation.execution.sources, ['serper']);
  const candidates = f.service.listCandidates(delegation.id).candidates;
  assert.equal(candidates.length, 1, 'one HTTPS result with a snippet is retained; duplicates/invalid/empty snippets are dropped');
  const [candidate] = candidates;
  assert.equal(candidate.companyName, 'Best Tools GmbH');
  assert.equal(candidate.source.kind, 'serper');
  assert.equal(candidate.evidence[0].sourceUrl, 'https://best-tools.example.com/about');
  assert.equal(candidate.evidence[0].fetchedAt, NOW);
  assert.equal(candidate.status, 'needs_review');
  assert.ok(candidate.fitScore > 0);
  assert.equal((await f.service.executeDelegation(delegation.id, { requestId: 'req-auto-exec-1' }, OPERATOR)).duplicate, true);
  const second = await f.service.executeDelegation(delegation.id, { requestId: 'req-auto-exec-2' }, OPERATOR);
  assert.equal(second.delegation.execution.status, 'completed');
  assert.equal(f.service.listCandidates(delegation.id).candidates.length, 1, 'a second run de-duplicates the same company/domain');
  const sources = Object.fromEntries(f.service.sources().sources.map(item => [item.id, item]));
  assert.equal(sources.serper.status, 'available');
  assert.equal(sources.serper.configured, true);
});

test('companies-house adapter creates registry-backed candidates without inventing contacts', async t => {
  const fetchImpl = async url => {
    assert.match(String(url), /api\.company-information\.service\.gov\.uk/u);
    return { ok: true, status: 200, json: async () => ({ items: [
      { title: 'Alpha Hardware Ltd', company_number: '12345678', snippet: 'Wholesale of hardware', address_snippet: 'London' },
      { title: 'No Number Ltd', snippet: 'Wholesale of tools' },
    ] }) };
  };
  const f = await fixture(t, { sourceEnvironment: { COMPANIES_HOUSE_API_KEY: 'test-ch-key' }, fetchImpl });
  const delegation = await approvedDelegation(f, 'req-auto-ch', { targetCountry: '英国', buyerType: '分销商' });
  const executed = await f.service.executeDelegation(delegation.id, { requestId: 'req-auto-ch-exec' }, OPERATOR);
  assert.equal(executed.delegation.execution.status, 'completed');
  const candidates = f.service.listCandidates(delegation.id).candidates;
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.country, '英国');
  assert.ok(candidate.notes.includes('12345678'));
  assert.equal(candidate.source.kind, 'companies_house');
  assert.match(candidate.evidence[0].sourceUrl, /^https:\/\/find-and-update\.company-information\.service\.gov\.uk\/company\/12345678$/u);
  assert.equal(candidate.contact.email, '');
});

test('a failing configured source is reported honestly and never fabricates candidates', async t => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const f = await fixture(t, { sourceEnvironment: { SERPER_API_KEY: 'test-serper-key' }, fetchImpl });
  const delegation = await approvedDelegation(f, 'req-auto-fail');
  const executed = await f.service.executeDelegation(delegation.id, { requestId: 'req-auto-fail-exec' }, OPERATOR);
  assert.equal(executed.delegation.execution.status, 'failed');
  assert.equal(executed.delegation.execution.lastError.code, 'SOURCE_PARTIAL_FAILURE');
  assert.ok(executed.delegation.execution.lastError.message.includes('HTTP 503'));
  assert.equal(f.service.listCandidates(delegation.id).candidates.length, 0);
});

test('qualified candidates produce UNSENT outreach drafts with an approval gate and no external send', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-draft-delegation', { targetCountry: '德国', buyerType: '分销商' });
  const candidate = await qualifiedCandidate(f, delegation);

  await assert.rejects(f.service.createDraft(candidate.id, { requestId: 'req-draft-0', language: 'fr' }, OPERATOR), { code: 'INVALID_LANGUAGE' });
  const draft = (await f.service.createDraft(candidate.id, { requestId: 'req-draft-1', language: 'en' }, OPERATOR)).draft;
  assert.equal(draft.status, 'draft');
  assert.equal(draft.sent, false);
  assert.equal(draft.humanReviewRequired, true);
  assert.equal(draft.externalSend, 'not_implemented');
  assert.ok(draft.subject.includes('Best Tools GmbH'));
  assert.ok(draft.body.includes('Best Tools GmbH'));
  assert.ok(draft.body.includes('hand tools and garden hardware'));
  assert.ok(draft.body.includes('best-tools.example.com/about'));
  assert.ok(draft.body.includes('[Unsubscribe link]'));
  assert.equal(draft.compliance.consentRequired, true);
  assert.ok(draft.warnings.some(item => item.includes('UWG')));
  assert.match(draft.productFacts.sha256, /^[a-f0-9]{64}$/u);

  assert.equal((await f.service.createDraft(candidate.id, { requestId: 'req-draft-1', language: 'en' }, OPERATOR)).duplicate, true);
  await assert.rejects(f.service.createDraft(candidate.id, { requestId: 'req-draft-1', language: 'de' }, OPERATOR), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.service.createDraft(candidate.id, { requestId: 'req-draft-2', language: 'en' }, OPERATOR), { code: 'DRAFT_EXISTS' });
  await assert.rejects(f.service.approveDraft(draft.id, { requestId: 'req-draft-approve-0', confirmed: true }, OPERATOR), { code: 'ROLE_REQUIRED' });
  await assert.rejects(f.service.approveDraft(draft.id, { requestId: 'req-draft-approve-0', confirmed: false }, ADMIN), { code: 'CONFIRMATION_REQUIRED' });
  const approved = await f.service.approveDraft(draft.id, { requestId: 'req-draft-approve-1', confirmed: true, note: '内容与证据已审核' }, ADMIN);
  assert.equal(approved.draft.status, 'approved');
  assert.equal(approved.draft.sent, false);
  assert.equal((await f.service.approveDraft(draft.id, { requestId: 'req-draft-approve-1', confirmed: true, note: '内容与证据已审核' }, ADMIN)).duplicate, true);
  await assert.rejects(f.service.rejectDraft(draft.id, { requestId: 'req-draft-reject-1', reason: '已批准后拒绝' }, OPERATOR), { code: 'INVALID_STATE' });

  const second = await qualifiedCandidate(f, delegation, { companyName: 'Zwei Handel GmbH', website: 'https://zwei-handel.example.com', contactEmail: 'einkauf@zwei-handel.example.com', sourceUrl: 'https://zwei-handel.example.com/about', sourceExcerpt: 'Zwei Handel is a distributor for garden tools in southern Germany.' }, 'req-qualified-import-2');
  const deDraft = await f.service.createDraft(second.id, { requestId: 'req-draft-de', language: 'de' }, OPERATOR);
  assert.ok(deDraft.draft.body.includes('Hallo [Ansprechpartner],'));
  assert.ok(deDraft.draft.body.includes('Mit freundlichen Grüßen'));
  const rejected = await f.service.rejectDraft(deDraft.draft.id, { requestId: 'req-draft-reject-3', reason: '语气需要调整' }, OPERATOR);
  assert.equal(rejected.draft.status, 'rejected');
  assert.equal(rejected.draft.rejectReason, '语气需要调整');
  const regenerated = await f.service.createDraft(second.id, { requestId: 'req-draft-de-2', language: 'de' }, OPERATOR);
  assert.equal(regenerated.draft.revision, 2);

  const reopened = await f.reopen();
  const restored = reopened.listDrafts(delegation.id).drafts;
  assert.equal(restored.length, 2);
  assert.equal(restored.find(item => item.candidateId === candidate.id).status, 'approved');
  assert.equal(restored.find(item => item.candidateId === second.id).revision, 2);
  assert.equal(reopened.status().approvedDrafts, 1);
  assert.equal(reopened.status().draftDrafts, 1);
});

test('draft creation and approval are blocked when the candidate is not qualified', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-draft-guard');
  await f.service.importCandidates(delegation.id, importBody([importedRow({ country: '美国', buyerType: '进口商', sourceExcerpt: 'A US importer of hand tools.' })], 'req-draft-guard-import'), OPERATOR);
  const [pending] = f.service.listCandidates(delegation.id).candidates;
  await assert.rejects(f.service.createDraft(pending.id, { requestId: 'req-draft-guard-1', language: 'en' }, OPERATOR), { code: 'CANDIDATE_NOT_QUALIFIED' });

  const candidate = await qualifiedCandidate(f, delegation, { companyName: 'Guard Tools GmbH', website: 'https://guard-tools.example.com', sourceUrl: 'https://guard-tools.example.com/about', sourceExcerpt: 'Guard Tools imports hand tools.' }, 'req-guard-import');
  const draft = (await f.service.createDraft(candidate.id, { requestId: 'req-draft-guard-2', language: 'en' }, OPERATOR)).draft;
  await f.store.update(state => {
    const row = state.aiWorks.candidates.find(item => item.id === candidate.id);
    row.status = 'rejected';
    row.review = { requestId: 'req-revoke', decision: 'rejected', reason: '复核后剔除', reviewer: 'ops-1', at: new Date().toISOString() };
    row.updatedAt = new Date().toISOString();
  });
  await assert.rejects(f.service.approveDraft(draft.id, { requestId: 'req-draft-guard-approve', confirmed: true }, ADMIN), { code: 'CANDIDATE_NOT_QUALIFIED' });
});

test('CSV exports contain real candidate/draft/event rows', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-export', { targetCountry: '德国', buyerType: '分销商' });
  const candidate = await qualifiedCandidate(f, delegation);
  await f.service.createDraft(candidate.id, { requestId: 'req-export-draft', language: 'en' }, OPERATOR);
  const candidates = f.service.exportCandidates(delegation.id).export;
  assert.equal(candidates.rows, 1);
  assert.ok(candidates.content.startsWith('companyName,websiteDomain'));
  assert.ok(candidates.content.includes('Best Tools GmbH'));
  assert.ok(candidates.content.includes('best-tools.example.com'));
  assert.equal(candidates.filename.endsWith('-candidates.csv'), true);
  const drafts = f.service.exportDrafts(delegation.id).export;
  assert.equal(drafts.rows, 1);
  assert.ok(drafts.content.startsWith('draftId,companyName'));
  assert.ok(drafts.content.includes('Best Tools GmbH'));
  const events = f.service.exportEvents(delegation.id).export;
  assert.ok(events.rows > 0);
  assert.ok(events.content.startsWith('eventId,type,at,actor,detail'));
  assert.ok(events.content.includes('draft_created'));
  const eventList = f.service.listEvents(delegation.id).events;
  assert.ok(eventList.length > 0);
  assert.ok(eventList.some(item => item.type === 'draft_created'));
  assert.ok(eventList.every(item => item.delegationId === delegation.id));
  assert.throws(() => f.service.listEvents('missing-delegation'), { code: 'DELEGATION_NOT_FOUND' });
  assert.throws(() => f.service.exportCandidates('missing-delegation'), { code: 'DELEGATION_NOT_FOUND' });
});

const OUTREACH_ENV = { OUTREACH_PROVIDER: 'resend', RESEND_API_KEY: 'test-send-key', OUTREACH_FROM_EMAIL: 'sales@acme.example.com', OUTREACH_FROM_NAME: 'Acme Tools', OUTREACH_REPLY_TO: 'reply@acme.example.com' };
function filledDraftBody(draft) {
  return draft.body
    .replaceAll('[Contact name / Purchasing team]', 'Anna Weber')
    .replaceAll('[Your name]', 'Alice')
    .replaceAll('[Your company]', 'Acme Tools')
    .replaceAll('[Physical address]', 'Musterstrasse 1, Berlin')
    .replaceAll('[Unsubscribe link]', 'https://acme.example.com/unsubscribe');
}
async function readyToSendDraft(f, delegation, { requestId, rowOverrides }) {
  const candidate = await qualifiedCandidate(f, delegation, rowOverrides, `import-${requestId}`);
  const draft = (await f.service.createDraft(candidate.id, { requestId: `${requestId}-draft`, language: 'en' }, OPERATOR)).draft;
  const edited = (await f.service.updateDraftContent(draft.id, { requestId: `${requestId}-edit`, subject: draft.subject, body: filledDraftBody(draft) }, OPERATOR)).draft;
  await f.service.approveDraft(edited.id, { requestId: `${requestId}-approve`, confirmed: true }, ADMIN);
  return { candidate, draft: f.service.getDraft(edited.id).draft };
}

test('outreach sending is fail-closed when the provider is not configured', async t => {
  const f = await fixture(t);
  const delegation = await approvedDelegation(f, 'req-send-off', { targetCountry: '德国', buyerType: '分销商' });
  const candidate = await qualifiedCandidate(f, delegation);
  const draft = (await f.service.createDraft(candidate.id, { requestId: 'req-send-off-draft', language: 'en' }, OPERATOR)).draft;
  const readiness = f.service.status().outreach;
  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, 'unconfigured');
  await assert.rejects(f.service.sendDraft(draft.id, { requestId: 'req-send-off-1', confirmed: true }, ADMIN), { code: 'OUTREACH_NOT_CONFIGURED' });
  assert.equal(f.service.getDraft(draft.id).draft.sent, false);
});

test('approved draft sends through the configured Resend transport exactly once, with consent recorded', async t => {
  const calls = [];
  const outreachFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ id: 'msg_123' }) };
  };
  const f = await fixture(t, { sourceEnvironment: OUTREACH_ENV, outreachFetch });
  const delegation = await approvedDelegation(f, 'req-send-1', { targetCountry: '德国', buyerType: '分销商' });
  const candidate = await qualifiedCandidate(f, delegation);
  const created = (await f.service.createDraft(candidate.id, { requestId: 'req-send-draft-1', language: 'en' }, OPERATOR)).draft;
  await assert.rejects(f.service.sendDraft(created.id, { requestId: 'req-send-early', confirmed: true, consentConfirmed: true, consentBasis: '客户 2026-10-20 邮件同意' }, ADMIN), { code: 'DRAFT_NOT_APPROVED' });
  await assert.rejects(f.service.sendDraft(created.id, { requestId: 'req-send-placeholder', confirmed: true }, ADMIN), { code: 'DRAFT_NOT_APPROVED' });

  const edited = await f.service.updateDraftContent(created.id, { requestId: 'req-send-edit-1', subject: created.subject, body: filledDraftBody(created) }, OPERATOR);
  assert.equal(edited.draft.revision, created.revision + 1);
  assert.notEqual(edited.draft.contentHash, created.contentHash);
  await assert.rejects(f.service.sendDraft(edited.draft.id, { requestId: 'req-send-unapproved', confirmed: true }, ADMIN), { code: 'DRAFT_NOT_APPROVED' });
  await assert.rejects(f.service.approveDraft(edited.draft.id, { requestId: 'req-send-approve-0', confirmed: true }, OPERATOR), { code: 'ROLE_REQUIRED' });
  await f.service.approveDraft(edited.draft.id, { requestId: 'req-send-approve-1', confirmed: true }, ADMIN);
  await assert.rejects(f.service.sendDraft(edited.draft.id, { requestId: 'req-send-no-consent', confirmed: true }, ADMIN), { code: 'CONSENT_REQUIRED' });

  const sent = await f.service.sendDraft(edited.draft.id, { requestId: 'req-send-2', confirmed: true, consentConfirmed: true, consentBasis: '客户 2026-10-20 邮件明确同意接收报价' }, ADMIN);
  assert.equal(sent.draft.sent, true);
  assert.equal(sent.draft.sentAt, NOW);
  assert.equal(sent.draft.externalSend, 'provider:resend');
  assert.equal(sent.draft.sendReceipt.provider, 'resend');
  assert.equal(sent.draft.sendReceipt.messageId, 'msg_123');
  assert.equal(sent.draft.sendReceipt.to, 'anna@best-tools.example.com');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-send-key');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.from, 'Acme Tools <sales@acme.example.com>');
  assert.deepEqual(payload.to, ['anna@best-tools.example.com']);
  assert.ok(payload.text.includes('https://acme.example.com/unsubscribe'));
  assert.ok(!payload.text.includes('[Your name]'));
  assert.equal(payload.reply_to, 'reply@acme.example.com');

  const duplicate = await f.service.sendDraft(edited.draft.id, { requestId: 'req-send-2', confirmed: true, consentConfirmed: true, consentBasis: '客户 2026-10-20 邮件明确同意接收报价' }, ADMIN);
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls.length, 1);
  await assert.rejects(f.service.sendDraft(edited.draft.id, { requestId: 'req-send-3', confirmed: true, consentConfirmed: true, consentBasis: '重复发送' }, ADMIN), { code: 'ALREADY_SENT' });

  const reopened = await f.reopen();
  assert.equal(reopened.status().sentDrafts, 1);
  assert.equal(reopened.status().outreach.configured, true);
  assert.equal(reopened.getDraft(edited.draft.id).draft.sent, true);
});

test('outreach provider failures are recorded and can be retried', async t => {
  const calls = [];
  let failing = true;
  const outreachFetch = async () => {
    calls.push(1);
    return failing ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: 'msg_retry' }) };
  };
  const f = await fixture(t, { sourceEnvironment: OUTREACH_ENV, outreachFetch });
  const delegation = await approvedDelegation(f, 'req-send-fail', { targetCountry: '德国', buyerType: '分销商' });
  const { draft } = await readyToSendDraft(f, delegation, { requestId: 'req-send-fail' });
  await assert.rejects(f.service.sendDraft(draft.id, { requestId: 'req-send-fail-1', confirmed: true, consentConfirmed: true, consentBasis: '客户同意记录' }, ADMIN), { code: 'OUTREACH_PROVIDER_ERROR' });
  assert.equal(calls.length, 1);
  const failed = f.service.getDraft(draft.id).draft;
  assert.equal(failed.sent, false);
  assert.equal(failed.status, 'approved');
  assert.equal(failed.sentAt, null);
  assert.equal(failed.sendAttempts.length, 1);
  assert.equal(failed.sendAttempts[0].outcome, 'failed');
  assert.ok(failed.sendAttempts[0].error.includes('HTTP 500'));
  assert.ok(failed.lastSendError.message.includes('HTTP 500'));
  assert.equal(f.service.outreach().stats.failedAttempts, 1);
  assert.equal(f.service.outreach().failedDrafts.length, 1);
  assert.equal(f.service.outreach().failedDrafts[0].draftId, draft.id);
  assert.equal(f.service.outreach().failedDrafts[0].companyName, 'Best Tools GmbH');

  failing = false;
  const retried = await f.service.sendDraft(draft.id, { requestId: 'req-send-fail-2', confirmed: true, consentConfirmed: true, consentBasis: '客户同意记录' }, ADMIN);
  assert.equal(retried.draft.sent, true);
  assert.equal(retried.draft.sendReceipt.messageId, 'msg_retry');
  assert.equal(retried.draft.sendAttempts.length, 2);
  assert.equal(retried.draft.sendAttempts[1].outcome, 'sent');
  assert.equal(retried.draft.lastSendError, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(f.service.outreach().stats, { sent: 1, attempts: 2, failedAttempts: 1, suppressions: 0, lastError: null, providers: { resend: 2 } });
  assert.equal(f.service.outreach().failedDrafts.length, 0);
});

test('suppression list blocks sending until explicitly removed', async t => {
  const calls = [];
  const outreachFetch = async () => { calls.push(1); return { ok: true, status: 200, json: async () => ({ id: 'msg_suppression' }) }; };
  const f = await fixture(t, { sourceEnvironment: OUTREACH_ENV, outreachFetch });
  const delegation = await approvedDelegation(f, 'req-send-sup', { targetCountry: '德国', buyerType: '分销商' });
  const { candidate, draft } = await readyToSendDraft(f, delegation, { requestId: 'req-send-sup' });
  await assert.rejects(f.service.addSuppression({ requestId: 'req-sup-0', email: candidate.contact.email, reason: '客户退订' }, OPERATOR), { code: 'ROLE_REQUIRED' });
  const added = await f.service.addSuppression({ requestId: 'req-sup-1', email: candidate.contact.email, reason: '客户退订' }, ADMIN);
  assert.equal(added.duplicate, false);
  assert.equal((await f.service.addSuppression({ requestId: 'req-sup-2', email: candidate.contact.email, reason: '重复登记' }, ADMIN)).duplicate, true);
  await assert.rejects(f.service.sendDraft(draft.id, { requestId: 'req-send-sup-1', confirmed: true, consentConfirmed: true, consentBasis: '客户同意记录' }, ADMIN), { code: 'SUPPRESSED' });
  assert.equal(calls.length, 0);
  const removed = await f.service.removeSuppression(added.suppression.id, { requestId: 'req-sup-remove' }, ADMIN);
  assert.equal(removed.duplicate, false);
  const sent = await f.service.sendDraft(draft.id, { requestId: 'req-send-sup-2', confirmed: true, consentConfirmed: true, consentBasis: '客户同意记录' }, ADMIN);
  assert.equal(sent.draft.sent, true);
  assert.equal(calls.length, 1);
});

test('dual approval requires a different admin to send an approved draft', async t => {
  const calls = [];
  const outreachFetch = async () => { calls.push(1); return { ok: true, status: 200, json: async () => ({ id: 'msg_dual' }) }; };
  const f = await fixture(t, { sourceEnvironment: { ...OUTREACH_ENV, AI_WORK_DUAL_APPROVAL: 'true' }, outreachFetch });
  assert.equal(f.service.status().outreach.dualApproval, true);
  const delegation = await approvedDelegation(f, 'req-send-dual', { targetCountry: '德国', buyerType: '分销商' });
  const { draft } = await readyToSendDraft(f, delegation, { requestId: 'req-send-dual' });
  await assert.rejects(
    f.service.sendDraft(draft.id, { requestId: 'req-send-dual-1', confirmed: true, consentConfirmed: true, consentBasis: '客户同意记录' }, ADMIN),
    { code: 'DUAL_APPROVAL_REQUIRED' },
  );
  assert.equal(calls.length, 0);
  const sent = await f.service.sendDraft(draft.id, { requestId: 'req-send-dual-2', confirmed: true, consentConfirmed: true, consentBasis: '客户同意记录' }, ADMIN2);
  assert.equal(sent.draft.sent, true);
  assert.equal(sent.draft.reviewedBy, ADMIN.subject);
  assert.equal(calls.length, 1);
});
