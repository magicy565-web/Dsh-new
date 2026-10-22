import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-ai-works-http-'));
  const options = {
    dataDirectory: directory,
    provider: { kind: 'test-provider', configured: false, complete: async () => { throw Error('Model must not be called'); } },
    capabilityEnvironment: {},
    ...overrides,
  };
  let app = await createApp(options);
  let address = await app.listen(0);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, text };
  };
  const raw = async route => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`);
    return { status: response.status, text: await response.text() };
  };
  const restart = async () => { await app.close(); app = await createApp(options); address = await app.listen(0); };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, raw, restart };
}

const libraryProductBody = () => ({
  requestId: randomUUID(),
  name: '工业级手动工具套装',
  description: '面向维修与装配场景的手动工具套装，含扳手、套筒与收纳箱。',
  category: '手工具',
  skus: [{
    id: randomUUID(), code: 'HT-001', unit: 'set', moq: 100,
    specs: [{ key: '材质', value: '铬钒钢' }, { key: '件数', value: '48 件' }],
  }],
  supply: { packaging: '纸箱 + 收纳盒', samplePolicy: '付费样品', paymentTerms: 'T/T 30% 定金', shippingTerms: 'FOB 上海', capacityNote: '月产能 5 万套' },
});

const delegationBody = productId => ({
  requestId: 'http-delegation-1',
  productId,
  targetCountry: '美国',
  buyerType: '进口商',
  targetCount: 30,
  deadlineDays: 21,
  notes: '首批优先联系有进口记录的经销商。',
});

async function approvedDelegation(f, { country = '美国', buyerType = '进口商', requestId = 'http-approved-1' } = {}) {
  const product = await f.request('/api/library/products', 'POST', libraryProductBody());
  assert.equal(product.status, 201, JSON.stringify(product.body));
  const delegation = await f.request('/api/ai-works/lead-discovery/delegations', 'POST', {
    ...delegationBody(product.body.product.id), requestId, targetCountry: country, buyerType,
  });
  assert.equal(delegation.status, 201, JSON.stringify(delegation.body));
  const id = delegation.body.delegation.id;
  const approved = await f.request(`/api/ai-work-delegations/${id}/approve`, 'POST', { requestId: `approve-${requestId}`, confirmed: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return id;
}

function serperFetch(results) {
  return async () => ({ ok: true, status: 200, json: async () => ({ organic: results }) });
}

test('the first AI-work is published on startup and reachable through real HTTP', async t => {
  const f = await fixture(t);
  const catalog = await f.request('/api/ai-works');
  assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
  assert.equal(catalog.body.products.length, 1);
  assert.equal(catalog.body.status.publishedProducts, 1);
  assert.equal(catalog.body.status.productLibraryAvailable, true);
  assert.equal(catalog.body.products[0].name, '客户线索挖掘');
  assert.equal(catalog.body.products[0].inputSchema.fields[0].type, 'product_ref');

  const one = await f.request('/api/ai-works/lead-discovery');
  assert.equal(one.status, 200);
  const status = await f.request('/api/ai-works/status');
  assert.equal(status.status, 200);
  assert.ok(Array.isArray(status.body.sourceReadiness));
  const sources = await f.request('/api/ai-work-sources');
  const byId = Object.fromEntries(sources.body.sources.map(item => [item.id, item]));
  assert.equal(byId.authorized_import.status, 'available');
  assert.equal(byId.serper.status, 'unconfigured');
  assert.equal(byId.companies_house.status, 'unconfigured');
});

test('product-library product -> development-plan delegation -> artifact -> approval, durable across restart', async t => {
  const f = await fixture(t);
  const product = await f.request('/api/library/products', 'POST', libraryProductBody());
  assert.equal(product.status, 201, JSON.stringify(product.body));
  const productId = product.body.product.id;

  const delegation = await f.request('/api/ai-works/lead-discovery/delegations', 'POST', delegationBody(productId));
  assert.equal(delegation.status, 201, JSON.stringify(delegation.body));
  const record = delegation.body.delegation;
  assert.equal(record.execution.status, 'not_started');
  assert.equal(record.plan.productFacts.productId, productId);
  assert.equal(record.plan.productFacts.name, '工业级手动工具套装');
  assert.equal(record.plan.market.country.code, 'US');
  assert.match(record.planHash, /^[a-f0-9]{64}$/u);
  assert.ok(record.artifactId);
  assert.match(record.artifactSha256, /^[a-f0-9]{64}$/u);

  const planDownload = await f.raw(`/api/artifacts/${record.artifactId}/download`);
  assert.equal(planDownload.status, 200);
  assert.ok(planDownload.text.includes('工业级手动工具套装'));
  assert.ok(planDownload.text.includes(record.plan.productFacts.sha256));

  const retried = await f.request('/api/ai-works/lead-discovery/delegations', 'POST', delegationBody(productId));
  assert.equal(retried.status, 201);
  assert.equal(retried.body.duplicate, true);
  assert.equal(retried.body.delegation.id, record.id);

  const approved = await f.request(`/api/ai-work-delegations/${record.id}/approve`, 'POST', { requestId: 'http-approve-1', confirmed: true, note: '计划已确认' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.delegation.status, 'approved');
  assert.equal(approved.body.delegation.approvedBy, 'local-operator');

  await f.restart();
  const restored = await f.request(`/api/ai-work-delegations/${record.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.delegation.status, 'approved');
  assert.equal(restored.body.delegation.plan.productFacts.productId, productId);
  assert.equal((await f.request('/api/ai-works')).body.products.length, 1, 'a restart must not republish the built-in AI-work');
  assert.ok((await f.request('/api/artifacts')).body.artifacts.some(item => item.id === record.artifactId));
});

test('invalid AI-work and delegation inputs are refused with stable codes over HTTP', async t => {
  const f = await fixture(t);
  const missing = await f.request('/api/ai-works/lead-discovery/delegations', 'POST', { requestId: 'http-missing-product', targetCountry: '美国', buyerType: '进口商' });
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
  assert.equal(missing.body.error.code, 'INVALID_INPUT');

  const unknown = await f.request('/api/ai-works/lead-discovery/delegations', 'POST', { requestId: 'http-unknown-product', productId: '99999999-9999-4999-8999-999999999999', targetCountry: '美国', buyerType: '进口商' });
  assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
  assert.equal(unknown.body.error.code, 'PRODUCT_NOT_FOUND');

  const notPublished = await f.request('/api/ai-works/not-published/delegations', 'POST', { requestId: 'http-not-published', targetCountry: '美国', buyerType: '进口商' });
  assert.equal(notPublished.status, 404);
  assert.equal(notPublished.body.error.code, 'PRODUCT_NOT_PUBLISHED');

  const published = await f.request('/api/ai-works', 'POST', { requestId: 'http-publish-bad', id: 'bad', playbook: 'unknown', name: 'x', summary: 'x', inputSchema: { fields: [] }, workflow: [], deliverables: [], acceptance: [] });
  assert.equal(published.status, 400, JSON.stringify(published.body));
});

test('an administrator can publish another AI-work product into the platform product registry', async t => {
  const f = await fixture(t);
  const body = {
    requestId: 'http-publish-1', id: 'market-scan', playbook: 'lead-discovery',
    name: '海外市场扫描', summary: '扫描目标国家的采购客户结构与渠道机会。', category: '市场研究',
    inputSchema: { fields: [{ name: 'targetCountry', label: '目标国家', type: 'string', required: true, maxLength: 80 }] },
    workflow: [{ id: 'scan', title: '市场扫描', owner: 'agent', output: '市场扫描报告' }],
    deliverables: ['市场扫描报告'], acceptance: ['每条结论必须带来源'],
  };
  const published = await f.request('/api/ai-works', 'POST', body);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.product.id, 'market-scan');
  assert.equal(published.body.product.revision, 1);
  const duplicate = await f.request('/api/ai-works', 'POST', body);
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal((await f.request('/api/ai-works')).body.products.length, 2);
});

test('execution pipeline over real HTTP: import -> execute -> review -> restart', async t => {
  const f = await fixture(t);
  const product = await f.request('/api/library/products', 'POST', libraryProductBody());
  const delegation = await f.request('/api/ai-works/lead-discovery/delegations', 'POST', { ...delegationBody(product.body.product.id), requestId: 'http-exec-delegation', targetCountry: '德国', buyerType: '分销商' });
  const delegationId = delegation.body.delegation.id;

  const tooEarly = await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', { requestId: 'http-exec-import-early', format: 'json', content: JSON.stringify({ candidates: [] }) });
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.error.code, 'DELEGATION_NOT_APPROVED');
  await f.request(`/api/ai-work-delegations/${delegationId}/approve`, 'POST', { requestId: 'http-exec-approve', confirmed: true });

  const empty = await f.request(`/api/ai-work-delegations/${delegationId}/execute`, 'POST', { requestId: 'http-exec-empty' });
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.equal(empty.body.awaitingSource, true);
  assert.equal(empty.body.delegation.execution.status, 'awaiting_source');
  assert.equal((await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates.length, 0);

  const csv = [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Best Tools GmbH","https://best-tools.example.com","德国","分销商","Anna Weber","Purchasing Manager","anna@best-tools.example.com","https://best-tools.example.com/about","We distribute hand tools and garden hardware across Germany.","2026-10-15","首批优先"',
  ].join('\n');
  const importBody = { requestId: 'http-exec-import-1', format: 'csv', content: csv };
  const imported = await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', importBody);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.import.imported, 1);
  assert.equal(imported.body.delegation.execution.status, 'not_started');
  assert.equal((await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', importBody)).body.duplicate, true);
  const conflict = await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', { ...importBody, content: `${csv}\n` });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const candidate = (await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates[0];
  assert.equal(candidate.status, 'needs_review');
  const executed = await f.request(`/api/ai-work-delegations/${delegationId}/execute`, 'POST', { requestId: 'http-exec-1' });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.delegation.execution.status, 'completed');
  assert.deepEqual(executed.body.delegation.execution.sources, ['authorized_import']);

  const reviewed = await f.request(`/api/ai-work-candidates/${candidate.id}/review`, 'POST', { requestId: 'http-exec-review-1', decision: 'qualified', reason: '产品/市场/买家类型与证据齐全' });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.delegation.execution.counts.qualified, 1);
  assert.equal((await f.request(`/api/ai-work-candidates/${candidate.id}/review`, 'POST', { requestId: 'http-exec-review-2', decision: 'maybe', reason: '随便' })).status, 400);

  const candidatesCsv = await f.request(`/api/ai-work-delegations/${delegationId}/export/candidates`);
  assert.equal(candidatesCsv.status, 200, JSON.stringify(candidatesCsv.body));
  assert.equal(candidatesCsv.body.export.contentType, 'text/csv; charset=utf-8');
  assert.equal(candidatesCsv.body.export.rows, 1);
  assert.ok(candidatesCsv.body.export.content.startsWith('companyName,websiteDomain'));
  assert.ok(candidatesCsv.body.export.content.includes('Best Tools GmbH'));
  const draftsCsv = await f.request(`/api/ai-work-delegations/${delegationId}/export/drafts`);
  assert.equal(draftsCsv.status, 200);
  assert.equal(draftsCsv.body.export.rows, 0);
  assert.ok(draftsCsv.body.export.content.startsWith('draftId,companyName'));
  const eventsCsv = await f.request(`/api/ai-work-delegations/${delegationId}/export/events`);
  assert.equal(eventsCsv.status, 200);
  assert.ok(eventsCsv.body.export.rows > 0);
  assert.ok(eventsCsv.body.export.content.startsWith('eventId,type,at,actor,detail'));
  const eventList = await f.request(`/api/ai-work-delegations/${delegationId}/events`);
  assert.equal(eventList.status, 200, JSON.stringify(eventList.body));
  assert.ok(Array.isArray(eventList.body.events) && eventList.body.events.length > 0);
  assert.ok(eventList.body.events.some(item => item.type === 'execution_completed'));
  assert.ok(eventList.body.events.every(item => item.delegationId === delegationId));
  assert.equal((await f.request('/api/ai-work-delegations/not-a-delegation/events')).status, 404);
  assert.equal((await f.request('/api/ai-work-delegations/not-a-delegation/export/candidates')).status, 404);

  await f.restart();
  const restored = await f.request(`/api/ai-work-delegations/${delegationId}`);
  assert.equal(restored.body.delegation.execution.status, 'completed');
  assert.equal(restored.body.delegation.execution.counts.qualified, 1);
  assert.equal((await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates[0].status, 'qualified');
  assert.equal((await f.request('/api/ai-works/status')).body.candidatesQualified, 1);
});

test('configured auto search runs through real HTTP and stores only source-backed candidates', async t => {
  const fetchImpl = serperFetch([
    { title: 'Best Tools GmbH', link: 'https://best-tools.example.com/about', snippet: 'We distribute hand tools and garden hardware across Germany.' },
    { title: 'No snippet', link: 'https://no-snippet.example.com', snippet: '' },
  ]);
  const f = await fixture(t, { capabilityEnvironment: { SERPER_API_KEY: 'test-serper-key' }, aiWorkSourceFetch: fetchImpl });
  const delegationId = await approvedDelegation(f, { country: '德国', buyerType: '分销商', requestId: 'http-auto-1' });
  const executed = await f.request(`/api/ai-work-delegations/${delegationId}/execute`, 'POST', { requestId: 'http-auto-exec' });
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.delegation.execution.status, 'completed');
  assert.deepEqual(executed.body.delegation.execution.sources, ['serper']);
  const candidates = (await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].companyName, 'Best Tools GmbH');
  assert.equal(candidates[0].source.kind, 'serper');
  assert.equal(candidates[0].evidence[0].sourceUrl, 'https://best-tools.example.com/about');
  const sources = await f.request('/api/ai-work-sources');
  assert.equal(Object.fromEntries(sources.body.sources.map(item => [item.id, item])).serper.status, 'available');
});

test('qualified candidates produce UNSENT outreach drafts over HTTP, with approval gate and restart persistence', async t => {
  const f = await fixture(t);
  const delegationId = await approvedDelegation(f, { country: '德国', buyerType: '分销商', requestId: 'http-draft-delegation' });
  const csv = [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Best Tools GmbH","https://best-tools.example.com","德国","分销商","Anna Weber","Purchasing Manager","anna@best-tools.example.com","https://best-tools.example.com/about","We distribute hand tools and garden hardware across Germany.","2026-10-15","首批优先"',
  ].join('\n');
  await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', { requestId: 'http-draft-import', format: 'csv', content: csv });
  await f.request(`/api/ai-work-delegations/${delegationId}/execute`, 'POST', { requestId: 'http-draft-execute' });
  const candidate = (await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates[0];
  await f.request(`/api/ai-work-candidates/${candidate.id}/review`, 'POST', { requestId: 'http-draft-review', decision: 'qualified', reason: '证据与匹配度符合清单要求' });

  assert.equal((await f.request(`/api/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: 'http-draft-invalid', language: 'fr' })).status, 400);
  const created = await f.request(`/api/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: 'http-draft-1', language: 'en' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const draft = created.body.draft;
  assert.equal(draft.sent, false);
  assert.equal(draft.externalSend, 'not_implemented');
  assert.equal(draft.compliance.consentRequired, true);
  assert.ok(draft.subject.includes('Best Tools GmbH'));
  assert.ok(draft.body.includes('[Unsubscribe link]'));
  assert.equal((await f.request(`/api/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: 'http-draft-1', language: 'en' })).body.duplicate, true);
  assert.equal((await f.request(`/api/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: 'http-draft-2', language: 'en' })).body.error.code, 'DRAFT_EXISTS');

  assert.equal((await f.request(`/api/ai-work-delegations/${delegationId}/drafts`)).body.drafts.length, 1);
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}`)).body.draft.status, 'draft');
  const approved = await f.request(`/api/ai-work-drafts/${draft.id}/approve`, 'POST', { requestId: 'http-draft-approve', confirmed: true, note: '内容与证据已审核' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.draft.status, 'approved');
  assert.equal(approved.body.draft.sent, false);

  await f.restart();
  const restored = await f.request(`/api/ai-work-delegations/${delegationId}/drafts`);
  assert.equal(restored.body.drafts.length, 1);
  assert.equal(restored.body.drafts[0].status, 'approved');
  assert.equal(restored.body.drafts[0].sent, false);
  assert.equal((await f.request('/api/ai-works/status')).body.approvedDrafts, 1);
});

function fillDraftForSend(draft) {
  return draft.body
    .replaceAll('[Contact name / Purchasing team]', 'Anna Weber')
    .replaceAll('[Your name]', 'Alice')
    .replaceAll('[Your company]', 'Acme Tools')
    .replaceAll('[Physical address]', 'Musterstrasse 1, Berlin')
    .replaceAll('[Unsubscribe link]', 'https://acme.example.com/unsubscribe');
}

test('outreach sending over real HTTP: configured provider, consent gate, one-shot send and restart', async t => {
  const calls = [];
  const outreachFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ id: 'msg_http_1' }) };
  };
  const f = await fixture(t, {
    capabilityEnvironment: { OUTREACH_PROVIDER: 'resend', RESEND_API_KEY: 'test-http-key', OUTREACH_FROM_EMAIL: 'sales@acme.example.com' },
    aiWorkOutreachFetch: outreachFetch,
  });
  const delegationId = await approvedDelegation(f, { country: '德国', buyerType: '分销商', requestId: 'http-send-1' });
  const csv = [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Best Tools GmbH","https://best-tools.example.com","德国","分销商","Anna Weber","Purchasing Manager","anna@best-tools.example.com","https://best-tools.example.com/about","We distribute hand tools and garden hardware across Germany.","2026-10-15","首批优先"',
  ].join('\n');
  await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', { requestId: 'http-send-import', format: 'csv', content: csv });
  await f.request(`/api/ai-work-delegations/${delegationId}/execute`, 'POST', { requestId: 'http-send-exec' });
  const candidate = (await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates[0];
  await f.request(`/api/ai-work-candidates/${candidate.id}/review`, 'POST', { requestId: 'http-send-review', decision: 'qualified', reason: '证据与匹配度符合清单要求' });
  const draft = (await f.request(`/api/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: 'http-send-draft', language: 'en' })).body.draft;

  const outreach = await f.request('/api/ai-work-outreach');
  assert.equal(outreach.status, 200);
  assert.equal(outreach.body.outreach.configured, true);
  assert.equal(outreach.body.outreach.provider, 'resend');
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}/send`, 'POST', { requestId: 'http-send-early', confirmed: true })).body.error.code, 'DRAFT_NOT_APPROVED');

  const edited = await f.request(`/api/ai-work-drafts/${draft.id}`, 'PATCH', { requestId: 'http-send-edit', subject: draft.subject, body: fillDraftForSend(draft) });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.draft.revision, 2);
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}/approve`, 'POST', { requestId: 'http-send-approve', confirmed: true, note: '发送内容已人工复核' })).status, 200);
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}/send`, 'POST', { requestId: 'http-send-no-consent', confirmed: true })).body.error.code, 'CONSENT_REQUIRED');
  const sent = await f.request(`/api/ai-work-drafts/${draft.id}/send`, 'POST', { requestId: 'http-send-1', confirmed: true, consentConfirmed: true, consentBasis: '客户 2026-10-20 邮件明确同意接收报价' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.draft.sent, true);
  assert.equal(sent.body.draft.externalSend, 'provider:resend');
  assert.equal(sent.body.draft.sendReceipt.messageId, 'msg_http_1');
  assert.equal(sent.body.draft.sendAttempts.length, 1);
  assert.equal(sent.body.draft.sendAttempts[0].outcome, 'sent');
  assert.equal((await f.request('/api/ai-work-outreach')).body.stats.sent, 1);
  assert.equal((await f.request('/api/ai-work-outreach')).body.stats.failedAttempts, 0);
  const outreachInfo = await f.request('/api/ai-work-outreach');
  assert.ok(Array.isArray(outreachInfo.body.failedDrafts));
  assert.equal(outreachInfo.body.failedDrafts.length, 0);
  assert.equal(outreachInfo.body.stats.suppressions, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}/send`, 'POST', { requestId: 'http-send-1', confirmed: true, consentConfirmed: true, consentBasis: '客户 2026-10-20 邮件明确同意接收报价' })).body.duplicate, true);
  assert.equal(calls.length, 1);
  assert.equal((await f.request('/api/ai-works/status')).body.sentDrafts, 1);

  const suppression = await f.request('/api/ai-work-suppressions', 'POST', { requestId: 'http-suppression-1', email: 'anna@best-tools.example.com', reason: '客户退订' });
  assert.equal(suppression.status, 201, JSON.stringify(suppression.body));
  assert.equal((await f.request('/api/ai-work-suppressions')).body.suppressions.length, 1);
  const removed = await f.request(`/api/ai-work-suppressions/${suppression.body.suppression.id}/remove`, 'POST', { requestId: 'http-suppression-remove' });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((await f.request('/api/ai-work-suppressions')).body.suppressions.length, 0);

  await f.restart();
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}`)).body.draft.sent, true);
  assert.equal((await f.request('/api/ai-works/status')).body.sentDrafts, 1);
  assert.equal((await f.request('/api/ai-work-outreach')).body.outreach.configured, true);
});

test('dual approval is surfaced over HTTP and blocks the approving admin from sending', async t => {
  const calls = [];
  const outreachFetch = async () => { calls.push(1); return { ok: true, status: 200, json: async () => ({ id: 'msg_dual_http' }) }; };
  const f = await fixture(t, {
    capabilityEnvironment: { OUTREACH_PROVIDER: 'resend', RESEND_API_KEY: 'test-http-key', OUTREACH_FROM_EMAIL: 'sales@acme.example.com', AI_WORK_DUAL_APPROVAL: 'true' },
    aiWorkOutreachFetch: outreachFetch,
  });
  assert.equal((await f.request('/api/ai-work-outreach')).body.outreach.dualApproval, true);
  const delegationId = await approvedDelegation(f, { country: '德国', buyerType: '分销商', requestId: 'http-dual-1' });
  const csv = [
    'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes',
    '"Best Tools GmbH","https://best-tools.example.com","德国","分销商","Anna Weber","Purchasing Manager","anna@best-tools.example.com","https://best-tools.example.com/about","We distribute hand tools and garden hardware across Germany.","2026-10-15","首批优先"',
  ].join('\n');
  await f.request(`/api/ai-work-delegations/${delegationId}/candidates`, 'POST', { requestId: 'http-dual-import', format: 'csv', content: csv });
  await f.request(`/api/ai-work-delegations/${delegationId}/execute`, 'POST', { requestId: 'http-dual-exec' });
  const candidate = (await f.request(`/api/ai-work-delegations/${delegationId}/candidates`)).body.candidates[0];
  await f.request(`/api/ai-work-candidates/${candidate.id}/review`, 'POST', { requestId: 'http-dual-review', decision: 'qualified', reason: '证据与匹配度符合清单要求' });
  const draft = (await f.request(`/api/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: 'http-dual-draft', language: 'en' })).body.draft;
  await f.request(`/api/ai-work-drafts/${draft.id}`, 'PATCH', { requestId: 'http-dual-edit', subject: draft.subject, body: fillDraftForSend(draft) });
  await f.request(`/api/ai-work-drafts/${draft.id}/approve`, 'POST', { requestId: 'http-dual-approve', confirmed: true });
  const blocked = await f.request(`/api/ai-work-drafts/${draft.id}/send`, 'POST', { requestId: 'http-dual-send', confirmed: true, consentConfirmed: true, consentBasis: '客户 2026-10-20 邮件同意' });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, 'DUAL_APPROVAL_REQUIRED');
  assert.equal(calls.length, 0);
  assert.equal((await f.request(`/api/ai-work-drafts/${draft.id}`)).body.draft.sent, false);
});
