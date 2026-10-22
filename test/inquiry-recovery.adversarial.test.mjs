// Independent adversarial verification tests for the "historical inquiry recovery" feature.
// Written by a reviewer, not the feature author. Production source is NOT modified here.
//
// Passing tests assert behaviour the implementation genuinely satisfies now.
// Defect reproductions from the as-found baseline (commit 7fb08c2) were fixed in
// c51ece9/e8d4358/1d92a57 and are un-skipped and green here. Tests still skipped
// assert expected behaviour for residual/open findings and keep their reason
// explicit, so open defects are never silently dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createInquiryRecoveryService, inquiryRecoveryHttp, parseCsv } from '../server/inquiry-recovery.mjs';
import { createApp } from '../server/index.mjs';

const AT = Date.parse('2026-10-21T00:00:00.000Z');
const actor = { subject: 'owner-a', role: 'admin' };
const operator = { subject: 'op-a', role: 'operator' };
const viewer = { subject: 'viewer-a', role: 'viewer' };
const sha256 = value => createHash('sha256').update(value).digest('hex');
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
const importJson = (recovery, inquiries, extra = {}) =>
  recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope(inquiries), ...extra }, actor);
const confirmIdentity = (recovery, leadId, quote = 'We need 500 pcs hydraulic cylinder', state = 'confirmed') => {
  const detail = recovery.lead(leadId, actor);
  return recovery.reviewIdentity(leadId, {
    requestId: randomUUID(), sourceHash: detail.card.sourceHash, status: state,
    basis: state === 'confirmed' ? [{ sourceId: detail.card.sourceId, quote }] : [],
  }, actor);
};

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-adversarial-'));
  const store = await openStore(directory);
  const recovery = createInquiryRecoveryService({ store, workspaceId: 'ws-1', clock: () => AT, ...options });
  t.after(async () => { await store.close().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, store, recovery };
}

// ---------------------------------------------------------------------------
// CSV / import data integrity
// ---------------------------------------------------------------------------
test('CSV parser keeps quoted commas, embedded newlines, BOM and CRLF and rejects column drift', async t => {
  // RFC-4180-ish handling through the exported parser.
  const csv = '\uFEFFleadId,sourceId,revision,companyName,body\r\n' +
    'lead-csv-1,src-1,1,"Alpha, Inc.","line1\nline2"\r\n' +
    'lead-csv-2,src-1,1,Beta LLC,\r\n' +
    '\r\n';
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].companyName, 'Alpha, Inc.');
  assert.equal(parsed[0].body, 'line1\nline2');
  assert.equal(parsed[1].body, '');

  // A JSON cell inside a CSV field still round-trips through doubled quotes.
  const historyCell = '"[{""id"":""m1"",""direction"":""inbound"",""sentAt"":""2026-09-20"",""body"":""hi, there""}]"';
  const withHistory = parseCsv(`leadId,sourceId,revision,history\nlead-csv-3,src-1,1,${historyCell}\n`);
  assert.equal(JSON.parse(withHistory[0].history)[0].body, 'hi, there');

  const { recovery } = await fixture(t);
  const imported = await recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: csv }, actor);
  assert.equal(imported.inserted, 2);
  assert.equal(imported.rejected.length, 0);
  const card = recovery.opportunities({ asOfDate: '2026-10-21' }, actor).cards.find(item => item.leadId === 'lead-csv-1');
  assert.equal(card.company.name, 'Alpha, Inc.');

  const csvWithHistory = await recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: `leadId,sourceId,revision,history\nlead-csv-3,src-1,1,${historyCell}\n` }, actor);
  assert.equal(csvWithHistory.inserted, 1);
  assert.equal(recovery.lead('lead-csv-3', actor).history[0].body, 'hi, there');

  // Column drift, duplicate columns, unknown columns, extra non-empty cells, bad quoting.
  await assert.rejects(recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: 'leadId,sourceId,revision,notes\nla,src,1,x\n' }, actor), code('INQUIRY_IMPORT_COLUMNS'));
  assert.throws(() => parseCsv('leadId,sourceId,revision,leadId\nla,src,1,x\n'), code('INQUIRY_IMPORT_COLUMNS'));
  assert.throws(() => parseCsv('leadId,sourceId,revision\nla,src,1,extra\n'), code('INQUIRY_IMPORT_COLUMNS'));
  assert.throws(() => parseCsv('leadId,sourceId,revision\nle"ad,src,1\n'), code('INQUIRY_IMPORT_INVALID'));
  assert.throws(() => parseCsv('leadId,sourceId,revision\n"la,src,1\n'), code('INQUIRY_IMPORT_INVALID'));
  await assert.rejects(recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: 'leadId,sourceId,revision\n' }, actor), code('INQUIRY_IMPORT_EMPTY'));

  // 64 KiB boundary is measured in UTF-8 bytes; at most 50 rows per import.
  const base = 'leadId,sourceId,revision\nla,src,';
  const padded = size => base + '1' + '0'.repeat(size - Buffer.byteLength(base) - 2) + '\n';
  assert.equal(Buffer.byteLength(padded(64 * 1024), 'utf8'), 64 * 1024);
  assert.equal(parseCsv(padded(64 * 1024)).length, 1);
  assert.throws(() => parseCsv(padded(64 * 1024 + 1)), code('INQUIRY_IMPORT_TOO_LARGE'));
  await assert.rejects(recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: padded(64 * 1024 + 1) }, actor), code('INQUIRY_IMPORT_TOO_LARGE'));
  const rows51 = 'leadId,sourceId,revision\n' + Array.from({ length: 51 }, (_, index) => `lead-${index},src,1`).join('\n');
  await assert.rejects(recovery.importInquiries({ format: 'csv', requestId: randomUUID(), content: rows51 }, actor), code('INQUIRY_IMPORT_TOO_LARGE'));
});

test('JSON import requires the authorised envelope and reports every rejected row', async t => {
  const { recovery } = await fixture(t);
  const content = (overrides = {}) => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries: [row()], ...overrides });
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: content({ synthetic: undefined }) }, actor), code('INQUIRY_IMPORT_SYNTHETIC'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: content({ synthetic: true }) }, actor), code('INQUIRY_IMPORT_SYNTHETIC'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: JSON.stringify({ schema: 'wrong', synthetic: false, inquiries: [] }) }, actor), code('INQUIRY_IMPORT_INVALID'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: 'not json' }, actor), code('INQUIRY_IMPORT_INVALID'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: content({ inquiries: [] }) }, actor), code('INQUIRY_IMPORT_EMPTY'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: content({ inquiries: Array.from({ length: 51 }, () => row()) }) }, actor), code('INQUIRY_IMPORT_TOO_LARGE'));
  await assert.rejects(recovery.importInquiries({ format: 'xml', requestId: randomUUID(), content: content() }, actor), code('INQUIRY_IMPORT_FORMAT'));
  await assert.rejects(recovery.importInquiries({ format: 'json', content: content() }, actor), code('INQUIRY_REQUEST_ID_REQUIRED'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: 'nope', content: content() }, actor), code('INQUIRY_REQUEST_ID_REQUIRED'));

  // Row-level failures are surfaced with row numbers, never silently dropped.
  const mixed = await recovery.importInquiries({
    format: 'json', requestId: randomUUID(),
    content: envelope([row({ quantity: 0 }), row({ leadId: 'lead-ok', sourceId: 'src-ok' })]),
  }, actor);
  assert.equal(mixed.inserted, 1);
  assert.equal(mixed.rejected.length, 1);
  assert.deepEqual(mixed.rejected[0].row, 1);
  assert.equal(mixed.rejected[0].code, 'INQUIRY_FIELD_INVALID');

  for (const bad of [
    row({ leadId: 'lead-bad', sourceId: 's', notes: 'unsupported' }),
    row({ leadId: 'lead-bad', sourceId: 's', quantity: 1.5 }),
    row({ leadId: 'lead-bad', sourceId: 's', quantity: '500pcs' }),
    row({ leadId: 'lead-bad', sourceId: 's', revision: 0 }),
    row({ leadId: 'lead-bad', sourceId: 's', status: 'hot' }),
    row({ leadId: 'lead bad', sourceId: 's' }),
    row({ leadId: 'lead-bad', sourceId: 's', history: [{ id: 'm1', direction: 'sideways', body: 'x' }] }),
    row({ leadId: 'lead-bad', sourceId: 's', facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'invented' }] }),
    row({ leadId: 'lead-bad', sourceId: 's', facts: [{ kind: 'rfq', sourceMessageId: 'missing', quote: 'x' }] }),
  ]) {
    await assert.rejects(importJson(recovery, [bad]), error => error?.code === 'INQUIRY_IMPORT_REJECTED' && error.rejected.length === 1);
  }

  // The same envelope as an already-parsed object is accepted, and CSV-style numeric strings normalise.
  const objectImport = await recovery.importInquiries({
    format: 'json', requestId: randomUUID(),
    content: { schema: 'historical-inquiry.input.v1', synthetic: false, inquiries: [row({ leadId: 'lead-obj', sourceId: 's', revision: '2', quantity: '17' })] },
  }, actor);
  assert.equal(objectImport.inserted, 1);
  assert.equal(recovery.lead('lead-obj', actor).card.revision, 2);
  assert.equal(recovery.lead('lead-obj', actor).card.request.quantity, 17);
});

// ---------------------------------------------------------------------------
// Conflict / dedupe semantics
// ---------------------------------------------------------------------------
test('same-revision content changes conflict without overwrite; lower revisions and cross-source reuse conflict', async t => {
  const { recovery } = await fixture(t);
  assert.equal((await importJson(recovery, [row()])).inserted, 1);
  assert.equal((await importJson(recovery, [row()])).duplicate, 1);

  const changed = await importJson(recovery, [row({ lastContactAt: '2026-10-10' })]);
  assert.equal(changed.conflict, 1);
  assert.equal(recovery.lead('lead-alpha', actor).card.lastContactAt, '2026-10-01T00:00:00.000Z');
  assert.equal(recovery.conflicts(actor).conflicts[0].kind, 'REVISION_CONTENT_CHANGED');

  assert.equal((await importJson(recovery, [row({ revision: 3, history: [], facts: [] })])).updated, 1);
  const lower = await importJson(recovery, [row({ revision: 2, history: [], facts: [] })]);
  assert.equal(lower.conflict, 1);
  assert.ok(recovery.conflicts(actor).conflicts.some(item => item.kind === 'REVISION_NOT_NEWER'));

  // A leadId already owned by one source cannot be re-used by another source.
  assert.equal((await importJson(recovery, [row({ leadId: 'lead-x', sourceId: 'src-a', history: [], facts: [] })])).inserted, 1);
  const cross = await importJson(recovery, [row({ leadId: 'lead-x', sourceId: 'src-b', history: [], facts: [] })]);
  assert.equal(cross.conflict, 1);
  assert.equal(recovery.conflicts(actor).conflicts[0].kind, 'LEAD_ID_REUSED');

  // A non-empty company rename on a newer revision is a conflict, not an overwrite.
  const company = await importJson(recovery, [row({ revision: 4, companyName: 'Rename Corp', history: [], facts: [] })]);
  assert.equal(company.conflict, 1);
  assert.ok(recovery.conflicts(actor).conflicts.some(item => item.kind === 'COMPANY_CHANGED'));
  assert.equal(recovery.lead('lead-alpha', actor).card.company.name, 'Alpha Trading LLC');

  // A newer revision updates in place, records revision history and invalidates the identity review.
  await confirmIdentity(recovery, 'lead-alpha');
  assert.equal(recovery.lead('lead-alpha', actor).identity.status, 'confirmed');
  const newer = await importJson(recovery, [row({ revision: 5, lastContactAt: '2026-10-11', history: [], facts: [] })]);
  assert.equal(newer.updated, 1);
  const detail = recovery.lead('lead-alpha', actor);
  assert.equal(detail.card.revision, 5);
  assert.equal(detail.identity.status, 'unknown');
  assert.equal(detail.identity.reviewerConfirmed, false);
  assert.deepEqual(detail.revisionHistory.map(entry => entry.revision), [1, 3]);
});

// ---------------------------------------------------------------------------
// Authority boundaries
// ---------------------------------------------------------------------------
test('viewers cannot mutate, missing actors are rejected, and a foreign workspace fails closed', async t => {
  const { store, recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, viewer), code('INQUIRY_ROLE_REQUIRED'));
  await assert.rejects(recovery.selectLead('lead-alpha', { requestId: randomUUID() }, viewer), code('INQUIRY_ROLE_REQUIRED'));
  await assert.rejects(recovery.reviewIdentity('lead-alpha', { requestId: randomUUID() }, viewer), code('INQUIRY_ROLE_REQUIRED'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, { subject: 'buyer-a', role: 'buyer' }), code('INQUIRY_ROLE_REQUIRED'));

  for (const missing of [undefined, null, {}, { subject: '   ', role: 'admin' }]) {
    assert.throws(() => recovery.status(missing), code('INQUIRY_ACTOR_REQUIRED'));
    assert.throws(() => recovery.opportunities({}, missing), code('INQUIRY_ACTOR_REQUIRED'));
    assert.throws(() => recovery.lead('lead-alpha', missing), code('INQUIRY_ACTOR_REQUIRED'));
    assert.throws(() => recovery.selections(missing), code('INQUIRY_ACTOR_REQUIRED'));
    assert.throws(() => recovery.conflicts(missing), code('INQUIRY_ACTOR_REQUIRED'));
    await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, missing), code('INQUIRY_ACTOR_REQUIRED'));
  }
  // Read access is intentionally available to viewers.
  assert.equal(recovery.opportunities({}, viewer).cards.length, 1);
  assert.equal(recovery.lead('lead-alpha', viewer).card.leadId, 'lead-alpha');
  assert.equal(recovery.selections(viewer).selections.length, 0);

  // A service instance bound to a different workspace must never read or write this store.
  const before = JSON.stringify(store.read().inquiryRecovery);
  const foreign = createInquiryRecoveryService({ store, workspaceId: 'ws-2', clock: () => AT });
  await assert.rejects(foreign.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row({ leadId: 'lead-foreign', sourceId: 'src-f' })]) }, actor), code('INQUIRY_WORKSPACE_CHANGED'));
  assert.throws(() => foreign.status(actor), code('INQUIRY_WORKSPACE_CHANGED'));
  assert.throws(() => foreign.opportunities({}, actor), code('INQUIRY_WORKSPACE_CHANGED'));
  await assert.rejects(foreign.selectLead('lead-alpha', { requestId: randomUUID() }, actor), code('INQUIRY_WORKSPACE_CHANGED'));
  assert.equal(JSON.stringify(store.read().inquiryRecovery), before);
  assert.equal(store.read().inquiryRecovery.leads.length, 1);
});

// ---------------------------------------------------------------------------
// requestId idempotency / receipts
// ---------------------------------------------------------------------------
test('requestId is idempotent for identical replay and conflicts for changed scope', async t => {
  const { store, recovery } = await fixture(t);
  const body = { format: 'json', requestId: randomUUID(), content: envelope([row()]) };
  const first = await recovery.importInquiries(body, actor);
  const replay = await recovery.importInquiries(body, actor);
  assert.deepEqual(replay, first);
  assert.equal(store.read().inquiryRecovery.imports.length, 1);
  assert.equal(store.read().inquiryRecovery.leads.length, 1);

  await assert.rejects(recovery.importInquiries({ ...body, content: envelope([row({ lastContactAt: '2026-10-10' })]) }, actor), code('INQUIRY_IDEMPOTENCY_CONFLICT'));

  const identityBody = { requestId: randomUUID(), sourceHash: recovery.lead('lead-alpha', actor).card.sourceHash, status: 'confirmed', basis: [{ sourceId: 'src', quote: 'We need 500 pcs hydraulic cylinder' }] };
  const identity = await recovery.reviewIdentity('lead-alpha', identityBody, actor);
  assert.deepEqual(await recovery.reviewIdentity('lead-alpha', identityBody, actor), identity);
  await assert.rejects(recovery.reviewIdentity('lead-alpha', { ...identityBody, basis: [{ sourceId: 'src', quote: 'other' }] }, actor), code('INQUIRY_IDEMPOTENCY_CONFLICT'));

  const card = recovery.lead('lead-alpha', actor).card;
  // Re-using an eligible import requestId for a different action must conflict, not silently return the import receipt.
  await assert.rejects(
    recovery.selectLead('lead-alpha', { requestId: body.requestId, expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21' }, actor),
    code('INQUIRY_IDEMPOTENCY_CONFLICT'));

  const selectBody = { requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21' };
  const selection = await recovery.selectLead('lead-alpha', selectBody, actor);
  assert.equal((await recovery.selectLead('lead-alpha', selectBody, actor)).id, selection.id);
  await assert.rejects(recovery.selectLead('lead-alpha', { ...selectBody, asOf: '2026-10-22' }, actor), code('INQUIRY_IDEMPOTENCY_CONFLICT'));

  // commandReceipt is scoped by action + exact input digest.
  assert.deepEqual(recovery.commandReceipt('inquiry.import', body, actor), first);
  assert.equal(recovery.commandReceipt('inquiry.import', { requestId: randomUUID(), format: 'json' }, actor), null);
  await assert.rejects(async () => recovery.commandReceipt('inquiry.select', body, actor), code('INQUIRY_IDEMPOTENCY_CONFLICT'));
  await assert.rejects(async () => recovery.commandReceipt('inquiry.import', { ...body, sourceName: 'changed.csv' }, actor), code('INQUIRY_IDEMPOTENCY_CONFLICT'));
  await assert.rejects(async () => recovery.commandReceipt('inquiry.import', { requestId: 'bad' }, actor), code('INQUIRY_REQUEST_ID_REQUIRED'));
});

// ---------------------------------------------------------------------------
// Selection fences and decision eligibility
// ---------------------------------------------------------------------------
test('selection requires the exact revision+sourceHash and rejects non-eligible decisions', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [
    row({ leadId: 'lead-stale', sourceId: 'src-stale' }),
    row({ leadId: 'lead-recent', sourceId: 'src-recent', lastContactAt: '2026-10-19' }),
    row({ leadId: 'lead-won', sourceId: 'src-won', status: 'won' }),
  ]);
  const stale = recovery.lead('lead-stale', actor).card;
  // Identity must still be unreviewed: selecting is refused before any draft is produced.
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID(), expectedRevision: stale.revision, sourceHash: stale.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_NOT_ELIGIBLE'));
  await assert.rejects(recovery.selectLead('lead-recent', { requestId: randomUUID(), expectedRevision: 1, sourceHash: recovery.lead('lead-recent', actor).card.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_NOT_ELIGIBLE'));
  await assert.rejects(recovery.selectLead('lead-won', { requestId: randomUUID(), expectedRevision: 1, sourceHash: recovery.lead('lead-won', actor).card.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_NOT_ELIGIBLE'));

  await confirmIdentity(recovery, 'lead-stale');
  const current = recovery.lead('lead-stale', actor).card;
  assert.equal(current.decision, 'follow_up');
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID(), expectedRevision: current.revision + 1, sourceHash: current.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_REVISION_CONFLICT'));
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID(), expectedRevision: current.revision, sourceHash: 'f'.repeat(64), asOf: '2026-10-21' }, actor), code('INQUIRY_SOURCE_CHANGED'));
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID() }, actor), code('INQUIRY_REVISION_CONFLICT'));
  await assert.rejects(recovery.selectLead('missing-lead', { requestId: randomUUID(), expectedRevision: 1, sourceHash: 'x' }, actor), code('INQUIRY_NOT_FOUND'));

  // A new revision invalidates both fences and the identity review.
  const revision = await importJson(recovery, [row({ leadId: 'lead-stale', sourceId: 'src-stale', revision: 2, lastContactAt: '2026-10-11', history: [], facts: [] })]);
  assert.equal(revision.updated, 1);
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID(), expectedRevision: current.revision, sourceHash: current.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_REVISION_CONFLICT'));
  const bumped = recovery.lead('lead-stale', actor).card;
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID(), expectedRevision: bumped.revision, sourceHash: current.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_SOURCE_CHANGED'));
  await assert.rejects(recovery.selectLead('lead-stale', { requestId: randomUUID(), expectedRevision: bumped.revision, sourceHash: bumped.sourceHash, asOf: '2026-10-21' }, actor), code('INQUIRY_NOT_ELIGIBLE'));
});

// ---------------------------------------------------------------------------
// Draft / Goal safety and content honesty
// ---------------------------------------------------------------------------
test('selection produces an unsent draft and a non-enabled Goal draft with no invented commercial terms', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row({
    history: [
      { id: 'm1', direction: 'inbound', sentAt: '2026-09-20', body: 'We need 500 pcs hydraulic cylinder for our line.' },
      { id: 'm2', direction: 'inbound', sentAt: '2026-09-21', body: 'We already purchased 200 pcs from another vendor last year.' },
    ],
    facts: [
      { kind: 'rfq', sourceMessageId: 'm1', quote: 'We need 500 pcs hydraulic cylinder', occurredAt: '2026-09-20' },
      { kind: 'purchase', sourceMessageId: 'm2', quote: 'We already purchased 200 pcs from another vendor last year.', occurredAt: '2026-09-21' },
    ],
  })]);
  await confirmIdentity(recovery, 'lead-alpha', 'We already purchased 200 pcs');
  const card = recovery.lead('lead-alpha', actor).card;
  assert.equal(card.decision, 'follow_up');
  assert.equal(card.draft.sent, false);
  assert.equal(card.draft.humanReviewRequired, true);

  const selection = await recovery.selectLead('lead-alpha', {
    requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21',
  }, actor);
  assert.equal(selection.draft.sent, false);
  assert.equal(selection.draft.humanReviewRequired, true);
  assert.equal(selection.draft.humanReviewed, false);
  assert.equal(selection.draft.filename, 'followup-lead-alpha.md');
  assert.equal(sha256(selection.draft.content), selection.draft.sha256);
  assert.ok(selection.draft.content.startsWith('<!-- 未发送'));

  // Goal draft is inert: not enabled, not written, no fabricated Goal id.
  assert.equal(selection.goalDraft.draft, true);
  assert.equal(selection.goalDraft.enabled, false);
  assert.equal(selection.goalDraft.notWritten, true);
  assert.equal(Object.hasOwn(selection.goalDraft, 'id'), false);
  assert.equal(Object.hasOwn(selection.goalDraft, 'goalId'), false);
  assert.ok(selection.goalDraft.authorityRequired.includes('人工审批'));

  // No invented price / MOQ / lead time / certification / stock numbers or currencies.
  assert.ok(!/(?:USD|EUR|CNY|RMB|\$)\s*[0-9]/u.test(selection.draft.content));
  assert.ok(!/MOQ\s*[:：=]?\s*\d/u.test(selection.draft.content));
  assert.ok(!/交期\s*[:：=]?\s*\d/u.test(selection.draft.content));
  assert.ok(selection.draft.content.includes('价格、MOQ、交期、认证与库存均未在此草稿中承诺'));
  assert.ok(selection.draft.content.includes('客户当前采购意向未知'));
  // Imported identifiers only.
  assert.ok(selection.draft.content.includes('leadId: lead-alpha'));
  assert.ok(selection.draft.content.includes(card.sourceHash));

  // Card evidence marks every claim unverified and explicitly frames purchase claims.
  assert.ok(card.evidence.length >= 2);
  for (const item of card.evidence) assert.equal(item.independentlyVerified, false);
  const purchase = card.evidence.find(item => item.kind === 'purchase');
  assert.ok(purchase.note.includes('未经独立核实'));
  assert.ok(purchase.note.includes('不能当作订单'));
  assert.ok(card.evidence.find(item => item.kind === 'rfq').note.includes('逐字'));

  // Static guarantee: no sending / Goal-enabling / model call exists in the module.
  const source = await fs.readFile(new URL('../server/inquiry-recovery.mjs', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(/u.test(source));
  assert.ok(!/createGoal|goalBrain|enabled:\s*true|notWritten:\s*false/u.test(source));
  assert.ok(!/\bsend(?:Mail|Email|Message)\b|\bSMTP\b/iu.test(source));
});

// ---------------------------------------------------------------------------
// Persistence / restart / malformed sections
// ---------------------------------------------------------------------------
test('state survives a store restart and malformed recovery sections are refused', async t => {
  const { directory, store, recovery } = await fixture(t);
  await importJson(recovery, [row(), row({ leadId: 'lead-beta', sourceId: 'src-b', history: [], facts: [] })]);
  await importJson(recovery, [row({ lastContactAt: '2026-10-09' })]); // same-revision conflict persists
  await confirmIdentity(recovery, 'lead-alpha');
  const card = recovery.lead('lead-alpha', actor).card;
  const selection = await recovery.selectLead('lead-alpha', { requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21' }, actor);
  await store.close();

  const reopened = await openStore(directory);
  t.after(async () => { await reopened.close().catch(() => {}); });
  const service = createInquiryRecoveryService({ store: reopened, workspaceId: 'ws-1', clock: () => AT });
  const cards = service.opportunities({ asOfDate: '2026-10-21' }, actor);
  assert.equal(cards.cards.length, 2);
  assert.equal(service.lead('lead-alpha', actor).identity.status, 'confirmed');
  const restored = service.selections(actor).selections[0];
  assert.equal(restored.id, selection.id);
  assert.equal(restored.draft.content, selection.draft.content);
  assert.equal(restored.draft.sha256, selection.draft.sha256);
  assert.equal(restored.draft.sent, false);
  assert.equal(service.status(actor).counts.conflicts, 1);
  assert.equal(reopened.read().inquiryRecovery.commands.length, 4);

  // Top-level shape damage fails closed before any write.
  await reopened.close();
  const filename = path.join(directory, 'workspace.json');
  const state = JSON.parse(await fs.readFile(filename, 'utf8'));
  state.inquiryRecovery = { version: 1, workspaceId: 'ws-1', leads: 'not-an-array' };
  await fs.writeFile(filename, JSON.stringify(state, null, 2) + '\n', 'utf8');
  const damaged = await openStore(directory);
  t.after(async () => { await damaged.close().catch(() => {}); });
  const damagedService = createInquiryRecoveryService({ store: damaged, workspaceId: 'ws-1', clock: () => AT });
  await assert.rejects(async () => damagedService.status(actor), code('INQUIRY_STORE_INVALID'));
  await assert.rejects(damagedService.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, actor), code('INQUIRY_STORE_INVALID'));
  assert.deepEqual(damaged.read().inquiryRecovery, { version: 1, workspaceId: 'ws-1', leads: 'not-an-array' });
});

// ---------------------------------------------------------------------------
// HTTP surface (real createApp + listen + fetch)
// ---------------------------------------------------------------------------
test('HTTP surface maps status codes, rejects bad input and never leaks internals', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-adversarial-http-'));
  const options = {
    dataDirectory: directory,
    provider: { kind: 'test-provider', configured: false, complete: async () => { throw new Error('Model must not be called'); } },
    capabilityEnvironment: {},
  };
  const app = await createApp(options);
  const address = await app.listen(0);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, raw: text };
  };
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });

  assert.equal((await request('/api/inquiry-recovery/status')).status, 200);
  const imported = await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: envelope([row()]) });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);

  const listed = await request('/api/inquiry-recovery/opportunities?asOf=2026-10-21');
  assert.equal(listed.status, 200);
  const card = listed.body.cards[0];
  const reviewed = await request('/api/inquiry-recovery/leads/lead-alpha/identity', 'POST', {
    requestId: randomUUID(), sourceHash: card.sourceHash, status: 'confirmed', basis: [{ sourceId: 'alibaba-2023', quote: 'We need 500 pcs hydraulic cylinder' }],
  });
  assert.equal(reviewed.status, 200);
  const selected = await request('/api/inquiry-recovery/leads/lead-alpha/select', 'POST', {
    requestId: randomUUID(), expectedRevision: 1, sourceHash: card.sourceHash, asOf: '2026-10-21',
  });
  assert.equal(selected.status, 201);
  assert.equal(selected.body.draft.sent, false);
  assert.equal(selected.body.goalDraft.enabled, false);

  assert.equal((await request('/api/inquiry-recovery/leads/lead-alpha')).status, 200);
  assert.equal((await request('/api/inquiry-recovery/selections')).status, 200);
  assert.equal((await request('/api/inquiry-recovery/conflicts')).status, 200);

  // Unknown routes / leads are 404; oversized and non-JSON bodies are refused.
  assert.equal((await request('/api/inquiry-recovery/unknown')).status, 404);
  assert.equal((await request('/api/inquiry-recovery/unknown', 'POST', {})).status, 404);
  assert.equal((await request('/api/inquiry-recovery/leads/nope')).status, 404);
  const huge = await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: 'x'.repeat(120_000) });
  assert.equal(huge.status, 413);
  const oversizedCsv = await request('/api/inquiry-recovery/import', 'POST', { format: 'csv', requestId: randomUUID(), content: 'leadId,sourceId,revision\nla,src,1\n' + 'x'.repeat(65 * 1024) });
  assert.equal(oversizedCsv.status, 413);
  assert.equal(oversizedCsv.body.error.code, 'INQUIRY_IMPORT_TOO_LARGE');
  const noJson = await fetch(`http://127.0.0.1:${address.port}/api/inquiry-recovery/import`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(noJson.status, 415);
  assert.equal((await request('/api/inquiry-recovery/import', 'POST', { format: 'json' })).status, 400);

  // Malformed percent-encoding on the GET detail route is a 400, not a crash.
  const badGet = await fetch(`http://127.0.0.1:${address.port}/api/inquiry-recovery/leads/%E0%A4%A`);
  assert.equal(badGet.status, 400);
  assert.equal((await badGet.json()).error.code, 'INQUIRY_PATH_INVALID');

  // Error bodies expose only a code and a human message: no stacks, paths or secrets.
  for (const response of [huge, oversizedCsv, await request('/api/inquiry-recovery/leads/nope'), noJson]) {
    const serialized = JSON.stringify(response.body);
    assert.ok(!/node:internal|\bat\s+\w+\s+\(|\/server\/|workspace\.json/iu.test(serialized), serialized);
  }
});

// ===========================================================================
// Reproductions for every reported defect.
// These were failing on commit 7fb08c2 (as-found baseline). The feature was
// fixed in c51ece9 / e8d4358 / 1d92a57 (frozen target), so the reproductions
// below are un-skipped and green. Anything still asserting unfixed residual
// behaviour is kept skipped with an explicit reason: open findings stay honest.
// ===========================================================================

async function httpFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-adversarial-http-'));
  const app = await createApp({
    dataDirectory: directory,
    provider: { kind: 'test-provider', configured: false, complete: async () => { throw new Error('Model must not be called'); } },
    capabilityEnvironment: {},
  });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };
  return { request, address };
}

test('P1 (fixed): missing evidence fields force need_evidence and block follow-up selection', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row({ contactEmail: '', customerName: '', companyUrl: '', productId: '' })]);
  await confirmIdentity(recovery, 'lead-alpha');
  const card = recovery.lead('lead-alpha', actor).card;
  assert.deepEqual(card.missing.sort(), ['company_url', 'contact_channel', 'product_binding']);
  assert.equal(card.decision, 'need_evidence');
  assert.equal(card.draft, null);
  assert.ok(card.reasons.length === 0 || card.reasons.includes('IDENTITY_UNCONFIRMED') === false);
  await assert.rejects(
    recovery.selectLead('lead-alpha', { requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21' }, actor),
    code('INQUIRY_NOT_ELIGIBLE'));

  // Only when the evidence is complete does the same lead become eligible.
  await importJson(recovery, [row({ leadId: 'lead-full', sourceId: 'src-full' })]);
  await confirmIdentity(recovery, 'lead-full');
  const full = recovery.lead('lead-full', actor).card;
  assert.deepEqual(full.missing, []);
  assert.equal(full.decision, 'follow_up');
});

test('P2 (fixed): ambiguous or impossible calendar dates stay unknown instead of being coerced', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [
    row({ leadId: 'lead-rollover', sourceId: 's1', lastContactAt: '2026-02-30', facts: [] }),
    row({ leadId: 'lead-nozone', sourceId: 's2', lastContactAt: '2026-09-19T08:00', facts: [] }),
    row({ leadId: 'lead-zone', sourceId: 's3', lastContactAt: '2026-09-19T08:00+08:00', facts: [] }),
    row({ leadId: 'lead-leap', sourceId: 's4', lastContactAt: '2024-02-29', facts: [] }),
  ]);
  const cards = recovery.opportunities({ asOfDate: '2026-10-21' }, actor).cards;
  for (const leadId of ['lead-rollover', 'lead-nozone']) {
    const card = cards.find(item => item.leadId === leadId);
    assert.equal(card.lastContactAt, null, leadId);
    assert.ok(card.dateUnknown.includes('lastContactAt'), leadId);
  }
  assert.equal(cards.find(item => item.leadId === 'lead-zone').lastContactAt, '2026-09-19T00:00:00.000Z');
  assert.equal(cards.find(item => item.leadId === 'lead-leap').lastContactAt, '2024-02-29T00:00:00.000Z');
  assert.ok(!cards.find(item => item.leadId === 'lead-leap').dateUnknown.includes('lastContactAt'));
});

test('P2 (fixed): impossible calendar days inside offset datetimes stay unknown', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [
    row({ leadId: 'lead-offset-rollover', sourceId: 's1', lastContactAt: '2026-02-30T00:00:00Z', facts: [] }),
    row({ leadId: 'lead-offset-rollover2', sourceId: 's2', lastContactAt: '2026-04-31T10:00:00+08:00', facts: [] }),
    row({ leadId: 'lead-offset-valid', sourceId: 's3', lastContactAt: '2026-09-19T08:00+08:00', facts: [] }),
  ]);
  const cards = recovery.opportunities({ asOfDate: '2026-10-21' }, actor).cards;
  for (const leadId of ['lead-offset-rollover', 'lead-offset-rollover2']) {
    const card = cards.find(item => item.leadId === leadId);
    assert.equal(card.lastContactAt, null, leadId);
    assert.ok(card.dateUnknown.includes('lastContactAt'), leadId);
  }
  assert.equal(cards.find(item => item.leadId === 'lead-offset-valid').lastContactAt, '2026-09-19T00:00:00.000Z');
});

test('P2 (fixed): the documented 64 KiB import limit covers JSON imports too', async t => {
  const { recovery } = await fixture(t);
  const history = Array.from({ length: 20 }, (_, index) => ({ id: `m${index}`, direction: 'inbound', sentAt: '2026-09-20', body: 'x'.repeat(4000) }));
  const content = envelope([row({ history, facts: [] })]);
  assert.ok(Buffer.byteLength(content, 'utf8') > 64 * 1024);
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content }, actor), code('INQUIRY_IMPORT_TOO_LARGE'));
  // The already-parsed object form is measured too, and a small JSON import still works.
  await assert.rejects(recovery.importInquiries({
    format: 'json', requestId: randomUUID(),
    content: { schema: 'historical-inquiry.input.v1', synthetic: false, inquiries: [row({ history, facts: [] })] },
  }, actor), code('INQUIRY_IMPORT_TOO_LARGE'));
  const small = await importJson(recovery, [row({ history: [], facts: [] })]);
  assert.equal(small.inserted, 1);
});

test('P2 (fixed): malformed per-lead records inside state.inquiryRecovery fail closed', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-adversarial-malformed-'));
  const initial = await openStore(directory);
  await initial.close();
  const filename = path.join(directory, 'workspace.json');
  const state = JSON.parse(await fs.readFile(filename, 'utf8'));
  state.inquiryRecovery = { version: 1, workspaceId: 'ws-1', leads: [42], imports: [], conflicts: [], selections: [], commands: [], events: [] };
  await fs.writeFile(filename, JSON.stringify(state, null, 2) + '\n', 'utf8');
  const store = await openStore(directory);
  t.after(async () => { await store.close().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  const recovery = createInquiryRecoveryService({ store, workspaceId: 'ws-1', clock: () => AT });
  await assert.rejects(async () => recovery.status(actor), code('INQUIRY_STORE_INVALID'));
  await assert.rejects(async () => recovery.opportunities({}, actor), code('INQUIRY_STORE_INVALID'));
  await assert.rejects(recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, actor), code('INQUIRY_STORE_INVALID'));
  assert.deepEqual(store.read().inquiryRecovery.leads, [42]);
});

test('P2 (fixed): stored conflicts respect the 500-entry cap on every path', async t => {
  const { store, recovery } = await fixture(t);
  await importJson(recovery, [row({ leadId: 'lead-x', sourceId: 'src-0', history: [], facts: [] })]);
  for (let round = 0; round < 12; round++) {
    await importJson(recovery, Array.from({ length: 50 }, (_, index) => row({ leadId: 'lead-x', sourceId: `src-${round}-${index}`, history: [], facts: [] })));
  }
  assert.ok(store.read().inquiryRecovery.conflicts.length <= 500);
  assert.equal(recovery.status(actor).counts.conflicts, store.read().inquiryRecovery.conflicts.length);
});

test('P2 (fixed): POST detail routes map malformed percent-encoding to 400', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-adversarial-encode-'));
  const options = {
    dataDirectory: directory,
    provider: { kind: 'test-provider', configured: false, complete: async () => { throw new Error('Model must not be called'); } },
    capabilityEnvironment: {},
  };
  const app = await createApp(options);
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  for (const suffix of ['identity', 'select']) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/inquiry-recovery/leads/%E0%A4%A/${suffix}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 400, suffix);
    assert.equal((await response.json()).error.code, 'INQUIRY_PATH_INVALID', suffix);
  }
});

test('P2 (fixed): a newer revision carries forward omitted identity/request fields', async t => {
  const { store, recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  assert.equal(recovery.lead('lead-alpha', actor).card.company.name, 'Alpha Trading LLC');
  const bump = await importJson(recovery, [{ leadId: 'lead-alpha', sourceId: 'alibaba-2023', revision: 2 }]);
  assert.equal(bump.updated, 1);
  const after = recovery.lead('lead-alpha', actor).card;
  assert.equal(after.revision, 2);
  assert.equal(after.company.name, 'Alpha Trading LLC');
  assert.equal(after.company.url, 'https://alpha.example.com');
  assert.equal(after.company.email, 'buyer@alpha.example.com');
  assert.equal(after.company.contact, 'Sam');
  assert.equal(after.request.productId, 'prod-1');
  assert.equal(after.request.product, 'Hydraulic cylinder');
  const raw = store.read().inquiryRecovery.leads.find(item => item.leadId === 'lead-alpha');
  for (const field of ['companyName', 'companyUrl', 'contactEmail', 'customerName', 'productId', 'product']) {
    assert.ok(raw.carriedForward.includes(field), field);
  }
  // A non-empty company rename on a newer revision is still a conflict.
  const rename = await importJson(recovery, [{ leadId: 'lead-alpha', sourceId: 'alibaba-2023', revision: 3, companyName: 'Rename Corp' }]);
  assert.equal(rename.conflict, 1);
  assert.ok(recovery.conflicts(actor).conflicts.some(item => item.kind === 'COMPANY_CHANGED'));
});

test('P2 (fixed): a minimal newer revision carries forward quantity/body/certifications and evidence arrays', async t => {
  const { store, recovery } = await fixture(t);
  await importJson(recovery, [row({ requestedCertifications: ['ISO 9001'], body: 'original body text' })]);
  assert.equal(recovery.lead('lead-alpha', actor).card.request.quantity, 500);
  await importJson(recovery, [{ leadId: 'lead-alpha', sourceId: 'alibaba-2023', revision: 2 }]);
  const raw = store.read().inquiryRecovery.leads.find(item => item.leadId === 'lead-alpha');
  assert.equal(raw.quantity, 500);
  assert.equal(raw.body, 'original body text');
  assert.deepEqual(raw.requestedCertifications, ['ISO 9001']);
  assert.equal(raw.facts.length, 1);
  assert.equal(raw.history.length, 1);
  assert.equal(recovery.lead('lead-alpha', actor).card.evidence[0].quote, 'We need 500 pcs hydraulic cylinder');
});

test('P2 residual (still open): carried facts can reference history that the new revision replaced', {
  skip: 'P2 residual still open after 41c5b66: a newer revision that supplies a new history but omits facts keeps the old facts, so the stored lead can contain facts whose sourceMessageId/quote are absent from the stored history (breaks the import-time verbatim-evidence invariant); needs a rule (carry history too, or drop/re-validate facts)',
}, async t => {
  const { store, recovery } = await fixture(t);
  await importJson(recovery, [row()]);
  await importJson(recovery, [row({
    revision: 2,
    history: [{ id: 'm9', direction: 'inbound', sentAt: '2026-10-05', body: 'A completely different replacement message.' }],
    facts: [],
  })]);
  const detail = recovery.lead('lead-alpha', actor);
  const stored = store.read().inquiryRecovery.leads.find(item => item.leadId === 'lead-alpha');
  for (const fact of stored.facts) {
    assert.ok(stored.history.some(entry => entry.id === fact.sourceMessageId && entry.body.includes(fact.quote)),
      `fact ${fact.sourceMessageId} is not backed by the stored history`);
  }
  assert.equal(detail.card.evidence.length, stored.facts.length);
});

test('P2 (fixed): nextStep text uses the configured stale threshold', async t => {
  const { recovery } = await fixture(t, { staleDays: 14 });
  await importJson(recovery, [row({ lastContactAt: '2026-10-12' })]);
  await confirmIdentity(recovery, 'lead-alpha', 'q');
  const card = recovery.lead('lead-alpha', actor).card;
  assert.equal(card.decision, 'nurture');
  assert.equal(card.daysStale, 9);
  assert.ok(card.nextStep.why.includes('14'), card.nextStep.why);
  assert.ok(!card.nextStep.why.includes('7 天'), card.nextStep.why);
});

test('P2 (fixed): malformed CSV quoting that leaves text after a closing quote is refused', async t => {
  assert.throws(() => parseCsv('leadId,sourceId,revision,companyName\nla,src,1,"Alpha"LLC\n'), code('INQUIRY_IMPORT_INVALID'));
  // Valid quoted fields still parse, including quoted commas and quoted newlines.
  assert.equal(parseCsv('leadId,sourceId,revision,companyName\nla,src,1,"Alpha, LLC"\n')[0].companyName, 'Alpha, LLC');
});

test('P2 (fixed): the generated draft carries the unverified framing for purchase claims', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row({
    history: [
      { id: 'm1', direction: 'inbound', sentAt: '2026-09-20', body: 'We need 500 pcs hydraulic cylinder for our line.' },
      { id: 'm2', direction: 'inbound', sentAt: '2026-09-21', body: 'We already purchased 200 pcs from another vendor last year.' },
    ],
    facts: [
      { kind: 'rfq', sourceMessageId: 'm1', quote: 'We need 500 pcs hydraulic cylinder', occurredAt: '2026-09-20' },
      { kind: 'purchase', sourceMessageId: 'm2', quote: 'We already purchased 200 pcs from another vendor last year.', occurredAt: '2026-09-21' },
    ],
  })]);
  await confirmIdentity(recovery, 'lead-alpha', 'We already purchased 200 pcs');
  const card = recovery.lead('lead-alpha', actor).card;
  const selection = await recovery.selectLead('lead-alpha', { requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21' }, actor);
  const evidenceLines = selection.draft.content.split('\n').filter(line => line.startsWith('- ['));
  assert.equal(evidenceLines.length, 2);
  for (const line of evidenceLines) assert.ok(line.includes('独立核实：否'), line);
  const purchaseLine = evidenceLines.find(line => line.includes('[purchase]'));
  assert.ok(purchaseLine, 'purchase evidence line missing from the draft');
  assert.ok(purchaseLine.includes('采购说法未经核实，不是订单'), purchaseLine);
  assert.ok(/未(?:经)?(?:独立)?核实|不能当作订单|unverified/iu.test(purchaseLine), purchaseLine);
});

test('P2 (fixed): a lead without verbatim evidence can never become follow_up', async t => {
  const { recovery } = await fixture(t);
  await importJson(recovery, [row({ history: [], facts: [] })]);
  await confirmIdentity(recovery, 'lead-alpha', 'any');
  const card = recovery.lead('lead-alpha', actor).card;
  assert.equal(card.decision, 'need_evidence');
  assert.ok(card.reasons.includes('NO_VERBATIM_EVIDENCE'));
  assert.equal(card.draft, null);
  await assert.rejects(recovery.selectLead('lead-alpha', {
    requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21',
  }, actor), code('INQUIRY_NOT_ELIGIBLE'));
});

// ===========================================================================
// Post-commit working-tree drift (artifact staging, commits e8d4358 + 1d92a57).
// Re-verified after 41c5b66; D-C2/D-C3 are fixed, D-C1 remains open and skipped.
// ===========================================================================

test('D-C1 (still open): a failed select must not leave an orphan draft artifact', {
  skip: 'D-C1 still open after 41c5b66: selectLead stages the artifact before the idempotency/fence transaction; a select rejected with 409 leaves an extra artifact in /api/artifacts (observed count 1 -> 2 on 41c5b66)',
}, async t => {
  const { request } = await httpFixture(t);
  await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: envelope([row(), row({ leadId: 'lead-second', sourceId: 'src-second' })]) });
  for (const leadId of ['lead-alpha', 'lead-second']) {
    const card = (await request('/api/inquiry-recovery/opportunities?asOf=2026-10-21')).body.cards.find(item => item.leadId === leadId);
    await request(`/api/inquiry-recovery/leads/${leadId}/identity`, 'POST', {
      requestId: randomUUID(), sourceHash: card.sourceHash, status: 'confirmed', basis: [{ sourceId: 'x', quote: 'q' }],
    });
  }
  const second = (await request('/api/inquiry-recovery/opportunities?asOf=2026-10-21')).body.cards.find(item => item.leadId === 'lead-second');
  const importRequestId = randomUUID();
  await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: importRequestId, content: envelope([row({ leadId: 'lead-third', sourceId: 'src-third' })]) });
  const before = (await request('/api/artifacts')).body.artifacts.length;
  const conflict = await request('/api/inquiry-recovery/leads/lead-second/select', 'POST', {
    requestId: importRequestId, expectedRevision: second.revision, sourceHash: second.sourceHash, asOf: '2026-10-21',
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'INQUIRY_IDEMPOTENCY_CONFLICT');
  assert.equal((await request('/api/artifacts')).body.artifacts.length, before);
});

test('D-C2 (fixed): conversationId binds the caller\'s own real Workspace conversation', async t => {
  const { request } = await httpFixture(t);
  const conversation = await request('/api/conversations', 'POST', { title: 'mine' });
  assert.equal(conversation.status, 201);
  await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: envelope([row()]) });
  const card = (await request('/api/inquiry-recovery/opportunities?asOf=2026-10-21')).body.cards[0];
  await request(`/api/inquiry-recovery/leads/${card.leadId}/identity`, 'POST', {
    requestId: randomUUID(), sourceHash: card.sourceHash, status: 'confirmed', basis: [{ sourceId: 'x', quote: 'q' }],
  });
  const selected = await request(`/api/inquiry-recovery/leads/${card.leadId}/select`, 'POST', {
    requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21', conversationId: conversation.body.conversation.id,
  });
  assert.equal(selected.status, 201);
  const artifact = (await request('/api/artifacts')).body.artifacts.find(item => item.id === selected.body.artifact.artifactId);
  assert.equal(artifact.sourceConversationId, conversation.body.conversation.id);
  // A missing / foreign conversation is still refused.
  const refused = await request(`/api/inquiry-recovery/leads/${card.leadId}/select`, 'POST', {
    requestId: randomUUID(), expectedRevision: card.revision, sourceHash: card.sourceHash, asOf: '2026-10-21', conversationId: randomUUID(),
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'INQUIRY_CONVERSATION_REFUSED');
});

test('D-C3 (fixed): leadId may not contain a slash because it is a route segment', async t => {
  const { request } = await httpFixture(t);
  const rejected = await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: envelope([row({ leadId: 'vendor/acme', sourceId: 'src-slash' })]) });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'INQUIRY_IMPORT_REJECTED');
  assert.equal(rejected.body.error.rejected[0].code, 'INQUIRY_FIELD_INVALID');
  // Non-slash punctuation remains legal.
  const accepted = await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: envelope([row({ leadId: 'vendor.acme@2024:de', sourceId: 'src-ok' })]) });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.inserted, 1);
});

test('P2-10 (fixed): enterprise ingress admits the operator role the service contract allows', async t => {
  const { generateKeyPairSync, sign, randomBytes } = await import('node:crypto');
  const { validateAccessConfig, createAccessControl } = await import('../server/access.mjs');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const config = validateAccessConfig({
    mode: 'enterprise', publicOrigin: 'https://workspace.example.com', workspaceId: 'ws-1',
    issuer: 'ingress', keyId: 'k1', publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    members: [{ subject: 'admin-1', role: 'admin' }, { subject: 'op-1', role: 'operator' }, { subject: 'viewer-1', role: 'viewer' }],
  });
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-inquiry-adversarial-enterprise-'));
  const access = await createAccessControl({ config, dataDirectory });
  t.after(async () => { await access.close(); await fs.rm(dataDirectory, { recursive: true, force: true }); });
  const b64 = value => Buffer.from(value).toString('base64url');
  const sha = value => createHash('sha256').update(value).digest('hex');
  const makeRequest = (method, url, subject, bodyText = '') => {
    const body = Buffer.from(bodyText, 'utf8');
    const seconds = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'EdDSA', typ: 'workspace-ingress+jwt', kid: 'k1' }));
    const claims = b64(JSON.stringify({
      iss: 'ingress', aud: 'https://workspace.example.com', workspace: 'ws-1', sub: subject, method, target: url,
      iat: seconds, exp: seconds + 20, jti: randomBytes(16).toString('base64url'), bodySha256: sha(body),
    }));
    const signature = sign(null, Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
    const headers = { host: 'workspace.example.com', origin: 'https://workspace.example.com', 'x-workspace-assertion': `${header}.${claims}.${signature}` };
    const rawHeaders = [];
    for (const [name, value] of Object.entries(headers)) rawHeaders.push(name, value);
    return { method, url, headers, rawHeaders, socket: { remoteAddress: '127.0.0.1' } };
  };
  const makeResponse = () => { const headers = {}; return { headers, setHeader(name, value) { headers[name.toLowerCase()] = value; }, writeHead() {}, end() {} }; };
  const login = async subject => {
    const request = makeRequest('POST', '/api/session/login', subject, '{}');
    request.headers['x-workspace-login'] = '1';
    request.rawHeaders.push('x-workspace-login', '1');
    const context = await access.begin(request, makeResponse(), '/api/session/login');
    const response = makeResponse();
    const view = await access.login(context, response);
    const cookie = response.headers['set-cookie'].split(';')[0];
    return { cookie, csrf: view.csrfToken };
  };
  const { cookie, csrf } = await login('op-1');
  const body = JSON.stringify({ format: 'json', requestId: randomUUID(), content: envelope([row()]) });
  const request = makeRequest('POST', '/api/inquiry-recovery/import', 'op-1', body);
  request.headers.cookie = cookie; request.headers['x-csrf-token'] = csrf;
  request.rawHeaders.push('cookie', cookie, 'x-csrf-token', csrf);
  const admitted = await access.begin(request, makeResponse(), '/api/inquiry-recovery/import');
  assert.equal(admitted.subject, 'op-1');
  assert.equal(admitted.role, 'operator');
  // Viewer is still blocked from writes at the ingress.
  const viewer = await login('viewer-1');
  const viewerRequest = makeRequest('POST', '/api/inquiry-recovery/import', 'viewer-1', body);
  viewerRequest.headers.cookie = viewer.cookie; viewerRequest.headers['x-csrf-token'] = viewer.csrf;
  viewerRequest.rawHeaders.push('cookie', viewer.cookie, 'x-csrf-token', viewer.csrf);
  await assert.rejects(async () => access.begin(viewerRequest, makeResponse(), '/api/inquiry-recovery/import'), error => error?.status === 403);
});
