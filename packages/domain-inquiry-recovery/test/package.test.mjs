// Package acceptance test: imports ONLY the published package entry point
// (self-reference through the package name). No server/** path is imported here,
// so this suite proves the extracted domain is usable outside the historical
// server module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createInquiryRecoveryService,
  inquiryRecoveryHttp,
  parseCsv,
  InquiryError,
} from '@workspace/domain-inquiry-recovery';

const AT = Date.parse('2026-10-21T00:00:00.000Z');
const actor = { subject: 'owner-a', role: 'admin' };

const row = (overrides = {}) => ({
  leadId: 'lead-alpha', sourceId: 'canton-2024', revision: 1,
  companyName: 'Alpha Trading LLC', companyUrl: 'https://alpha.example.com', contactEmail: 'buyer@alpha.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  lastContactAt: '2026-10-01', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-20', body: 'We need 500 pcs hydraulic cylinder for our line.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'We need 500 pcs hydraulic cylinder', occurredAt: '2026-09-20' }],
  ...overrides,
});
const envelope = inquiries => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries });

/**
 * Minimal file-backed temporary store implementing the two-method store seam.
 * It mirrors the real store's contract: reads are decoupled copies and
 * transactions receive a working copy that is committed synchronously.
 */
async function tempStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'domain-inquiry-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'workspace.json');
  const load = async () => JSON.parse(await fs.readFile(filename, 'utf8'));
  let state = { conversations: [] };
  await fs.writeFile(filename, JSON.stringify(state), 'utf8');
  return {
    directory,
    read: () => structuredClone(state),
    async update(callback) {
      const next = structuredClone(state);
      const result = callback(next);
      if (result && typeof result.then === 'function') throw new Error('Store transactions must be synchronous.');
      const output = structuredClone(result);
      await fs.writeFile(filename, JSON.stringify(next), 'utf8');
      state = next;
      return output;
    },
    /** Re-read the persisted state, as a store restart would. */
    async reload() {
      state = await load();
      return this;
    },
  };
}

const identityReview = card => ({
  requestId: randomUUID(), sourceHash: card.sourceHash, status: 'confirmed',
  basis: [{ sourceId: card.sourceId, quote: 'We need 500 pcs hydraulic cylinder' }],
});

test('the package entry point runs an import -> decide -> select flow against a temp store', async t => {
  // Documented public surface.
  assert.equal(typeof createInquiryRecoveryService, 'function');
  assert.equal(typeof inquiryRecoveryHttp, 'function');
  assert.equal(typeof parseCsv, 'function');
  assert.equal(typeof InquiryError, 'function');
  assert.ok(new InquiryError(400, 'INQUIRY_TEST', 'message') instanceof Error);
  assert.equal(new InquiryError(400, 'INQUIRY_TEST', 'message').status, 400);
  assert.equal(new InquiryError(400, 'INQUIRY_TEST', 'message').code, 'INQUIRY_TEST');

  const store = await tempStore(t);
  const written = [];
  const artifacts = {
    create: async input => {
      written.push(input);
      return { artifact: { id: 'artifact-1', currentVersion: 1, sha256: 'a'.repeat(64), filename: input.filename } };
    },
  };
  const recovery = createInquiryRecoveryService({ store, artifacts, workspaceId: 'ws-1', clock: () => AT });

  // import
  const imported = await recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, actor);
  assert.equal(imported.inserted, 1);
  assert.equal(imported.rejected.length, 0);

  // decide: an unreviewed identity can never produce a follow-up draft
  const pending = recovery.opportunities({ asOfDate: '2026-10-21' }, actor).cards.find(card => card.leadId === 'lead-alpha');
  assert.equal(pending.decision, 'need_evidence');
  assert.ok(pending.reasons.includes('IDENTITY_UNCONFIRMED'));

  // human identity review, then decide again
  const reviewed = await recovery.reviewIdentity('lead-alpha', identityReview(pending), actor);
  assert.equal(reviewed.identity.status, 'confirmed');
  const ready = recovery.opportunities({ asOfDate: '2026-10-21' }, actor).cards.find(card => card.leadId === 'lead-alpha');
  assert.equal(ready.decision, 'follow_up');
  assert.equal(ready.daysStale, 20);

  // select: unsent draft + inert Goal draft, staged through the artifacts seam
  const selection = await recovery.selectLead('lead-alpha', {
    requestId: randomUUID(), expectedRevision: ready.revision, sourceHash: ready.sourceHash, asOf: '2026-10-21',
  }, actor);
  assert.equal(selection.decision, 'follow_up');
  assert.equal(selection.draft.sent, false);
  assert.equal(selection.draft.humanReviewRequired, true);
  assert.equal(selection.goalDraft.enabled, false);
  assert.equal(selection.goalDraft.notWritten, true);
  assert.equal(Object.hasOwn(selection.goalDraft, 'goalId'), false);
  assert.equal(Object.hasOwn(selection.goalDraft, 'id'), false);
  assert.equal(selection.artifact.artifactId, 'artifact-1');
  assert.equal(written.length, 1);
  assert.equal(written[0].filename, `followup-lead-alpha.md`);
  assert.equal(written[0].metadata.inquiryRecovery.sent, false);
  assert.equal(written[0].metadata.inquiryRecovery.humanReviewed, false);

  // the temp store persisted the selection, and a restarted service sees it
  const persisted = JSON.parse(await fs.readFile(path.join(store.directory, 'workspace.json'), 'utf8'));
  assert.equal(persisted.inquiryRecovery.selections.length, 1);
  assert.equal(persisted.inquiryRecovery.selections[0].draft.sent, false);
  await store.reload();
  const restarted = createInquiryRecoveryService({ store, artifacts, workspaceId: 'ws-1', clock: () => AT });
  assert.equal(restarted.status(actor).counts.leads, 1);
  assert.equal(restarted.status(actor).counts.selections, 1);
  assert.equal(restarted.selections(actor).selections[0].id, selection.id);
  assert.equal(restarted.selections(actor).selections[0].draft.sha256, selection.draft.sha256);
});

test('a caller-injected ApiError class is exactly what callers receive', async t => {
  class HostApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const store = await tempStore(t);
  const recovery = createInquiryRecoveryService({ store, workspaceId: 'ws-1', clock: () => AT, ApiError: HostApiError });

  // synchronous throws are bridged
  assert.throws(() => recovery.status(null), error =>
    error instanceof HostApiError && error.constructor === HostApiError
    && error.status === 401 && error.code === 'INQUIRY_ACTOR_REQUIRED');

  // async rejections are bridged too
  await assert.rejects(
    recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: 'not json' }, actor),
    error => error instanceof HostApiError && error.code === 'INQUIRY_IMPORT_INVALID');

  // extra domain fields survive the bridge (per-row rejections through HTTP depend on this)
  const rejected = await recovery.importInquiries({
    format: 'json', requestId: randomUUID(), content: envelope([row({ quantity: 0 })]),
  }, actor).then(() => assert.fail('expected a rejected import'), error => error);
  assert.ok(rejected instanceof HostApiError);
  assert.equal(rejected.code, 'INQUIRY_IMPORT_REJECTED');
  assert.equal(rejected.rejected[0].code, 'INQUIRY_FIELD_INVALID');

  // the mapper's own path-decoding errors honour the injection as well
  await assert.rejects(
    inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/inquiry-recovery/leads/%E0%A4%A', actor, ApiError: HostApiError }),
    error => error instanceof HostApiError && error.code === 'INQUIRY_PATH_INVALID');

  // without an injection the package throws its own default class
  const plain = createInquiryRecoveryService({ store, workspaceId: 'ws-1', clock: () => AT });
  assert.throws(() => plain.status(null), error => error instanceof InquiryError && !(error instanceof HostApiError));
});

test('the package re-exports inquiryRecoveryHttp and parseCsv on its public entry', async t => {
  const store = await tempStore(t);
  const recovery = createInquiryRecoveryService({ store, workspaceId: 'ws-1', clock: () => AT });

  // parseCsv is the real parser, not a stub
  assert.deepEqual(parseCsv('leadId,sourceId,revision\nlead-csv,src-1,1\n'), [{ leadId: 'lead-csv', sourceId: 'src-1', revision: '1' }]);
  assert.throws(() => parseCsv('leadId,sourceId,revision,notes\nla,src,1,x\n'),
    error => error instanceof InquiryError && error.code === 'INQUIRY_IMPORT_COLUMNS');

  // inquiryRecoveryHttp maps real routes to the service and declines foreign paths
  const empty = await inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/inquiry-recovery/status', actor });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.counts.leads, 0);
  assert.equal(await inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/not-inquiry-recovery', actor }), null);

  const imported = await inquiryRecoveryHttp({
    recovery, method: 'POST', pathname: '/api/inquiry-recovery/import', actor,
    body: { format: 'csv', requestId: randomUUID(), content: 'leadId,sourceId,revision,companyName\nlead-http,src-1,1,Http Ltd\n' },
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);
  const listed = await inquiryRecoveryHttp({ recovery, method: 'GET', pathname: '/api/inquiry-recovery/opportunities', query: { asOf: '2026-10-21' }, actor });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.cards[0].leadId, 'lead-http');
});
