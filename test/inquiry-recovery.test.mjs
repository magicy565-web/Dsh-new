import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createInquiryRecoveryService, inquiryRecoveryHttp, parseCsv } from '../server/inquiry-recovery.mjs';

const AT = Date.parse('2026-10-21T00:00:00.000Z');
const actor = { subject: 'owner-a', role: 'admin' };
const viewer = { subject: 'viewer-a', role: 'viewer' };
const code = expected => error => error?.code === expected;

const row = (overrides = {}) => ({
  leadId: 'lead-alpha', sourceId: 'alibaba-2023', revision: 1,
  companyName: 'Alpha Trading LLC', companyUrl: 'https://alpha.example.com', contactEmail: 'buyer@alpha.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  lastContactAt: '2026-10-01', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-20', body: 'We need 500 pcs hydraulic cylinder for our line.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'We need 500 pcs hydraulic cylinder', occurredAt: '2026-09-20' }],
  ...overrides,
});

const envelope = inquiries => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries });

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-recovery-'));
  const store = await openStore(directory);
  const recovery = createInquiryRecoveryService({ store, workspaceId: 'ws-1', clock: () => AT, ...options });
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, store, recovery };
}

const importJson = (recovery, inquiries, extra = {}) => recovery.importInquiries({
  format: 'json', requestId: randomUUID(), content: envelope(inquiries), ...extra,
}, actor);

test('CSV import rejects column drift, keeps quoted commas and reports every rejected row', async t => {
  const { recovery } = await fixture(t);
  const drifting = 'leadId,sourceId,revision,companyName,notes\n' +
    'lead-alpha,src-1,1,"Alpha, Inc.",ignored\n';
  await assert.rejects(recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: drifting }, actor), code('INQUIRY_IMPORT_COLUMNS'));

  const good = 'leadId,sourceId,revision,companyName,lastContactAt\n' +
    'lead-alpha,src-1,1,"Alpha, Inc.",2026-10-01\n' +
    'lead-beta,src-1,1,Beta LLC,not-a-date\n' +
    'lead-gamma,src-1,1,Gamma,2026-10-01\n';
  const result = await recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: good }, actor);
  assert.equal(result.inserted, 3);
  assert.equal(result.rejected.length, 0);
  const cards = recovery.opportunities({}, actor).cards;
  assert.equal(cards.find(card => card.leadId === 'lead-alpha').company.name, 'Alpha, Inc.');
  const beta = cards.find(card => card.leadId === 'lead-beta');
  assert.deepEqual(beta.dateUnknown.sort(), ['lastContactAt', 'receivedAt', 'requestedAt']);
  assert.equal(beta.decision, 'need_evidence');
  assert.ok(beta.reasons.includes('LAST_CONTACT_UNKNOWN'));
});

test('imports are idempotent per row, report conflicts and never overwrite a changed revision silently', async t => {
  const { recovery } = await fixture(t);
  const first = await importJson(recovery, [row()]);
  assert.equal(first.inserted, 1);

  const again = await importJson(recovery, [row()]);
  assert.equal(again.duplicate, 1);
  assert.equal(again.inserted, 0);

  const changed = await importJson(recovery, [row({ lastContactAt: '2026-10-10' })]);
  assert.equal(changed.conflict, 1);
  const conflicts = recovery.conflicts(actor).conflicts;
  assert.equal(conflicts[0].kind, 'REVISION_CONTENT_CHANGED');
  assert.equal(recovery.opportunities({}, actor).cards[0].lastContactAt, '2026-10-01T00:00:00.000Z');

  const newer = await importJson(recovery, [row({ revision: 2, lastContactAt: '2026-10-10' })]);
  assert.equal(newer.updated, 1);
  const detail = recovery.lead('lead-alpha', actor);
  assert.equal(detail.card.revision, 2);
  assert.equal(detail.revisionHistory.length, 1);
  assert.equal(detail.identity.status, 'unknown');
});

test('facts must quote the imported history verbatim and dates stay explicit', async t => {
  const { recovery } = await fixture(t);
  await assert.rejects(
    importJson(recovery, [row({ facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'invented text', occurredAt: null }] })]),
    error => error?.code === 'INQUIRY_IMPORT_REJECTED' && error.rejected[0].code === 'INQUIRY_FACT_UNSUPPORTED');

  const imported = await importJson(recovery, [row({ lastContactAt: 'approx September', requestedAt: '2026-09-19T08:00:00+08:00' })]);
  assert.equal(imported.inserted, 1);
  const card = recovery.lead('lead-alpha', actor).card;
  assert.deepEqual(card.dateUnknown.sort(), ['lastContactAt', 'receivedAt']);
  assert.equal(card.evidence[0].quote, 'We need 500 pcs hydraulic cylinder');
  assert.equal(card.evidence[0].independentlyVerified, false);
});

test('recovery decisions separate stale follow-up, missing evidence and hold states', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [
    row({ leadId: 'lead-stale', sourceId: 'src-a' }),
    row({ leadId: 'lead-recent', sourceId: 'src-b', lastContactAt: '2026-10-19' }),
    row({ leadId: 'lead-won', sourceId: 'src-c', status: 'won' }),
    row({ leadId: 'lead-no-contact', sourceId: 'src-d', contactEmail: '', customerName: '' }),
  ]);
  const { summary, cards } = recovery.opportunities({ asOfDate: '2026-10-21' }, actor);
  assert.equal(summary.follow_up, 0); // identity is unconfirmed until a human review
  assert.equal(summary.need_evidence, 3);
  assert.equal(summary.hold, 1);
  const recent = cards.find(card => card.leadId === 'lead-recent');
  assert.equal(recent.decision, 'need_evidence');
  assert.ok(recent.reasons.includes('IDENTITY_UNCONFIRMED'));

  for (const leadId of ['lead-stale', 'lead-recent']) {
    const detail = recovery.lead(leadId, actor);
    await recovery.reviewIdentity(leadId, {
      requestId: randomUUID(), sourceHash: detail.card.sourceHash, status: 'confirmed',
      basis: [{ sourceId: detail.card.sourceId, quote: detail.facts[0].quote, officialUrl: 'https://alpha.example.com' }],
    }, actor);
  }
  const reviewed = recovery.opportunities({ asOfDate: '2026-10-21' }, actor);
  assert.equal(reviewed.summary.follow_up, 1);
  const stale = reviewed.cards.find(card => card.leadId === 'lead-stale');
  assert.equal(stale.decision, 'follow_up');
  assert.equal(stale.daysStale, 20);
  assert.ok(stale.draft);
  assert.equal(stale.draft.sent, false);
  assert.equal(stale.draft.humanReviewRequired, true);

  const recentCard = reviewed.cards.find(card => card.leadId === 'lead-recent');
  assert.equal(recentCard.decision, 'nurture');
  assert.equal(recentCard.draft, null);

  assert.equal(reviewed.cards.find(card => card.leadId === 'lead-won').decision, 'hold');
  assert.equal(reviewed.cards.find(card => card.leadId === 'lead-no-contact').decision, 'need_evidence');
});

test('identity review is bound to the exact imported source hash', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  const detail = recovery.lead('lead-alpha', actor);
  await assert.rejects(recovery.reviewIdentity('lead-alpha', {
    requestId: randomUUID(), sourceHash: 'f'.repeat(64), status: 'confirmed', basis: [{ sourceId: 'm1', quote: 'x' }],
  }, actor), code('INQUIRY_SOURCE_CHANGED'));
  await assert.rejects(recovery.reviewIdentity('lead-alpha', {
    requestId: randomUUID(), sourceHash: detail.card.sourceHash, status: 'confirmed', basis: [],
  }, actor), code('INQUIRY_IDENTITY_BASIS'));
});

test('selection returns an unsent draft and a non-enabled Goal draft, idempotently', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  const detail = recovery.lead('lead-alpha', actor);
  await recovery.reviewIdentity('lead-alpha', {
    requestId: randomUUID(), sourceHash: detail.card.sourceHash, status: 'confirmed', basis: [{ sourceId: 'm1', quote: detail.facts[0].quote }],
  }, actor);
  const card = recovery.lead('lead-alpha', actor).card;
  assert.equal(card.decision, 'follow_up');

  const body = { requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21' };
  const selection = await recovery.selectLead('lead-alpha', body, actor);
  assert.equal(selection.decision, 'follow_up');
  assert.equal(selection.draft.sent, false);
  assert.equal(selection.draft.humanReviewed, false);
  assert.equal(selection.goalDraft.enabled, false);
  assert.equal(selection.goalDraft.notWritten, true);
  assert.equal(selection.goalDraft.id, undefined);
  assert.ok(selection.draft.content.includes('未发送'));
  assert.ok(selection.draft.content.includes('Hydraulic cylinder'));

  const replay = await recovery.selectLead('lead-alpha', body, actor);
  assert.equal(replay.id, selection.id);
  await assert.rejects(recovery.selectLead('lead-alpha', { ...body, requestId: randomUUID(), expectedRevision: 99 }, actor), code('INQUIRY_REVISION_CONFLICT'));
  await assert.rejects(recovery.selectLead('lead-alpha', { ...body, requestId: randomUUID(), sourceHash: 'a'.repeat(64) }, actor), code('INQUIRY_SOURCE_CHANGED'));

  await recovery.reviewIdentity('lead-alpha', {
    requestId: randomUUID(), sourceHash: card.sourceHash, status: 'unknown', basis: [],
  }, actor);
  await assert.rejects(recovery.selectLead('lead-alpha', { ...body, requestId: randomUUID() }, actor), code('INQUIRY_NOT_ELIGIBLE'));
});

test('imported leads and selections survive a restart and stay workspace scoped', async t => {
  const { directory, store, recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  await store.close();
  const reopened = await openStore(directory);
  t.after(async () => { await reopened.close(); });
  const service = createInquiryRecoveryService({ store: reopened, workspaceId: 'ws-1', clock: () => AT });
  assert.equal(service.opportunities({}, actor).cards.length, 1);
  assert.equal(service.status(actor).counts.leads, 1);
  const foreign = createInquiryRecoveryService({ store: reopened, workspaceId: 'ws-2', clock: () => AT });
  await assert.rejects(foreign.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, actor),
    code('INQUIRY_WORKSPACE_CHANGED'));
});

test('viewers can read but cannot import, select or review', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row({ leadId: 'lead-viewer', sourceId: 'src-v' })]) },
    viewer), code('INQUIRY_ROLE_REQUIRED'));
  await assert.rejects(recovery.selectLead('lead-alpha', { requestId: randomUUID(), expectedRevision: 1, sourceHash: 'x' }, viewer), code('INQUIRY_ROLE_REQUIRED'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, undefined), code('INQUIRY_ACTOR_REQUIRED'));
  assert.equal(recovery.opportunities({}, viewer).cards.length, 1);
});

test('HTTP mapping exposes the recovery contract and rejects unknown routes', async t => {
  const { recovery } = await fixture(t);
  const imported = await inquiryRecoveryHttp({
    recovery, method: 'POST', pathname: '/api/inquiry-recovery/import', actor,
    body: { format: 'json', requestId: randomUUID(), content: envelope([row()]) },
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);
  const opportunities = await inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/inquiry-recovery/opportunities', query: { asOf: '2026-10-21' }, actor });
  assert.equal(opportunities.status, 200);
  assert.equal(opportunities.body.cards.length, 1);
  assert.equal(await inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/inquiry-recovery/nope', actor }), null);
  await assert.rejects(inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/inquiry-recovery/status' }), code('INQUIRY_ACTOR_REQUIRED'));
});

test('synthetic or demo imports must be labelled and oversized imports are refused', async t => {
  const { recovery } = await fixture(t);
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(),
    content: JSON.stringify({ schema: 'historical-inquiry.input.v1', inquiries: [row()] }) }, actor), code('INQUIRY_IMPORT_SYNTHETIC'));
  const many = Array.from({ length: 51 }, (_, index) => row({ leadId: `lead-${index}`, sourceId: 'src-bulk' }));
  await assert.rejects(importJson(recovery, many), code('INQUIRY_IMPORT_TOO_LARGE'));
  assert.equal(parseCsv('leadId,sourceId,revision\r\nla,src,1\r\n').length, 1);
});

test('a fully rejected import returns the per-row reasons through HTTP', async t => {
  const { recovery } = await fixture(t);
  const response = await inquiryRecoveryHttp({
    recovery, method: 'POST', pathname: '/api/inquiry-recovery/import', actor,
    body: { format: 'json', requestId: randomUUID(), content: envelope([row({ facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'invented', occurredAt: null }] })]) },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INQUIRY_IMPORT_REJECTED');
  assert.equal(response.body.error.rejected.length, 1);
  assert.equal(response.body.error.rejected[0].row, 1);
  assert.equal(response.body.error.rejected[0].code, 'INQUIRY_FACT_UNSUPPORTED');
  assert.equal(recovery.status(actor).counts.leads, 0);
});
