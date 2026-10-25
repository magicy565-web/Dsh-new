import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRecoveryService, createStorageAdapter, validateRoot } from '../service.js';
import { createHttpHandler, registerTools, API_PREFIX } from '../index.js';

const AT = () => Date.parse('2026-10-26T12:00:00Z');
const row = (changes = {}) => ({ leadId: 'alpha', sourceId: 'crm-export', revision: 1,
  companyName: 'Synthetic buyer', companyUrl: 'https://buyer.example', contactEmail: 'buyer@buyer.example', customerName: 'Sam',
  productId: 'prd_fixture', product: 'Linen', quantity: 500, unit: 'pieces', lastContactAt: '2026-10-01', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-10-01', body: 'Please send details for 500 pieces of linen.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: '500 pieces of linen' }], ...changes });
function csv(rows) {
  const columns = Object.keys(rows[0]);
  const cell = value => '"' + String(typeof value === 'object' ? JSON.stringify(value) : value ?? '').replaceAll('"', '""') + '"';
  return columns.join(',') + '\n' + rows.map(row => columns.map(key => cell(row[key])).join(',')).join('\n') + '\n';
}
function fixture(t) {
  let saved = {}, failCommit = false, failAttachment = false;
  const alpha = randomUUID(), beta = randomUUID();
  const workspaces = [{ id: alpha, title: 'Alpha', sessionIds: ['session-alpha'] }, { id: beta, title: 'Beta', sessionIds: ['session-beta'] }];
  const blobs = new Map();
  const attachments = {
    async saveFile({ data, name }) { if (failAttachment) throw new Error('fixture attachment failure'); const attachmentId = 'sha256:' + createHash('sha256').update(data).digest('hex'); blobs.set(attachmentId, Buffer.from(data)); return { attachmentId, name, bytes: data.length }; },
    async *readFileStream(ref) { if (!blobs.has(ref.attachmentId)) throw new Error('missing'); yield blobs.get(ref.attachmentId); },
  };
  const global = { get: () => saved, async set(value) { if (failCommit) throw new Error('fixture commit failure'); saved = structuredClone(value); } };
  const options = { storage: createStorageAdapter(global), registry: { list: () => workspaces, get: id => workspaces.find(row => row.id === id) }, attachments, clock: AT };
  const service = createRecoveryService(options);
  t.after(() => service.close());
  const execution = (session = 'session-alpha', callId = 'native-call-1') => ({ agent: { session: { id: session } }, callId });
  const importRows = (rows, id = alpha, requestId = randomUUID()) => service.import(id, { requestId, format: 'csv', sourceName: 'synthetic-inquiries.csv', dataBase64: Buffer.from(csv(rows)).toString('base64'), authorized: true });
  async function approve(leadId = 'alpha', id = alpha, changes = {}) {
    const context = await service.read(id, leadId);
    return service.review(id, leadId, { requestId: randomUUID(), sourceHash: context.card.sourceHash, expectedReviewRevision: context.identity.reviewRevision ?? 0,
      status: 'confirmed', basis: [{ sourceId: context.card.sourceId, quote: 'Synthetic operator identity check' }], ...changes });
  }
  const proposal = (context, changes = {}) => ({ requestId: randomUUID(), leadId: context.card.leadId, expectedRevision: context.card.revision, sourceHash: context.card.sourceHash,
    content: 'Sam, are you still evaluating the linen mentioned in your message m1? Unsent synthetic draft.', ...changes });
  return { service, options, alpha, beta, blobs, attachments, global, execution, importRows, approve, proposal, saved: () => saved,
    failCommit: value => { failCommit = value; }, failAttachment: value => { failAttachment = value; } };
}

test('native import preserves original bytes and row hash; model draft remains unreviewed with host provenance', async t => {
  const f = fixture(t), imported = await f.importRows([row()]);
  assert.equal(imported.inserted, 1);
  const initial = await f.service.read(f.alpha, 'alpha');
  assert.equal(initial.source.rawBytesVerified, true); assert.equal(initial.source.normalizedRowMatched, true);
  assert.equal(initial.source.independentlyVerified, false); assert.equal(initial.card.decision, 'need_evidence');
  await f.approve();
  const context = await f.service.toolRead({ action: 'read', leadId: 'alpha' }, f.execution());
  const command = f.proposal(context), selected = await f.service.proposeDraft(command, f.execution());
  assert.equal(selected.draft.content, command.content); assert.equal(selected.draft.generation, 'proposed-text');
  assert.equal(selected.draft.sent, false); assert.equal(selected.draft.humanReviewed, false); assert.equal(selected.draft.humanReviewRequired, true);
  assert.equal(selected.nativeOrigin.sessionId, 'session-alpha'); assert.equal(selected.nativeOrigin.callId, 'native-call-1');
  assert.equal('goalDraft' in selected, false);
  const file = await f.service.draftFile(f.alpha, selected.id); assert.equal(file.data.toString(), command.content);
  assert.equal((await f.service.sourceFile(f.alpha, imported.importId)).data.toString(), csv([row()]));
  assert.equal(f.saved().workspaces[f.alpha].inquiryRecovery.selections.length, 1);
  assert.equal((await f.service.toolRead({ action: 'drafts', leadId: 'other' }, f.execution())).items.length, 0);
  assert.equal((await f.service.toolRead({ action: 'drafts', leadId: 'alpha' }, f.execution())).historyOnly, true);
  assert.equal((await f.service.toolRead({}, f.execution('session-beta'))).items.length, 0);
  assert.throws(() => f.service.toolRead({ workspaceId: f.alpha }, f.execution('session-beta')), { code: 'INQUIRY_INPUT' });
  assert.throws(() => f.service.toolRead({}, f.execution('session-foreign')), { code: 'INQUIRY_WORKSPACE_REQUIRED' });
});

test('unconfirmed, held and stale-source records cannot produce drafts or self-approve', async t => {
  const f = fixture(t); await f.importRows([row(), row({ leadId: 'optout', status: 'opted_out' })]);
  const initial = await f.service.read(f.alpha, 'alpha');
  await assert.rejects(() => f.service.proposeDraft(f.proposal(initial), f.execution()), { code: 'INQUIRY_NOT_ELIGIBLE' });
  await f.approve(); await f.approve('optout');
  const optout = await f.service.read(f.alpha, 'optout');
  await assert.rejects(() => f.service.proposeDraft(f.proposal(optout), f.execution()), { code: 'INQUIRY_NOT_ELIGIBLE' });
  const old = await f.service.read(f.alpha, 'alpha');
  await f.importRows([row({ revision: 2, quantity: 700 })]);
  assert.equal((await f.service.read(f.alpha, 'alpha')).identity.status, 'unknown');
  await assert.rejects(() => f.service.proposeDraft(f.proposal(old), f.execution()), { code: 'INQUIRY_SOURCE_CHANGED' });
  assert.throws(() => f.service.proposeDraft({ ...f.proposal(old), actor: 'admin' }, f.execution()), { code: 'INQUIRY_INPUT' });
  assert.throws(() => f.service.proposeDraft({ ...f.proposal(old), content: undefined }, f.execution()), { code: 'INQUIRY_INPUT' });
});

test('identity review has an exact review revision and request replay does not overwrite newer decisions', async t => {
  const f = fixture(t); await f.importRows([row()]);
  const context = await f.service.read(f.alpha, 'alpha');
  const input = { requestId: randomUUID(), sourceHash: context.card.sourceHash, expectedReviewRevision: 0, status: 'confirmed', basis: [{ sourceId: 'human-check', quote: 'Operator checked identity' }] };
  const first = await f.service.review(f.alpha, 'alpha', input);
  assert.equal(first.identity.reviewRevision, 1);
  assert.deepEqual(await f.service.review(f.alpha, 'alpha', input), first);
  await assert.rejects(() => f.service.review(f.alpha, 'alpha', { ...input, requestId: randomUUID() }), { code: 'INQUIRY_REVIEW_CHANGED' });
  await f.service.review(f.alpha, 'alpha', { ...input, requestId: randomUUID(), expectedReviewRevision: 1, status: 'conflicting' });
  assert.deepEqual(await f.service.review(f.alpha, 'alpha', input), first);
  assert.equal((await f.service.read(f.alpha, 'alpha')).identity.status, 'conflicting');
});

test('draft request replay is scoped to the lead and repairs an attachment failure after commit', async t => {
  const f = fixture(t); await f.importRows([row(), row({ leadId: 'other' })]); await f.approve(); await f.approve('other');
  const context = await f.service.read(f.alpha, 'alpha'), command = f.proposal(context);
  f.failAttachment(true);
  await assert.rejects(() => f.service.proposeDraft(command, f.execution()), /attachment failure/u);
  assert.equal(f.saved().workspaces[f.alpha].inquiryRecovery.selections.length, 1);
  f.failAttachment(false);
  const repaired = await f.service.proposeDraft(command, f.execution('session-alpha', 'retry-call'));
  assert.ok(repaired.nativeAttachment); assert.equal(repaired.nativeOrigin.callId, 'native-call-1');
  assert.equal((await f.service.proposeDraft(command, f.execution())).id, repaired.id);
  await assert.rejects(() => f.service.proposeDraft({ ...command, content: 'different text' }, f.execution()), { code: 'INQUIRY_IDEMPOTENCY_CONFLICT' });
  const other = await f.service.read(f.alpha, 'other');
  await assert.rejects(() => f.service.proposeDraft(f.proposal(other, { requestId: command.requestId }), f.execution()), { code: 'INQUIRY_IDEMPOTENCY_CONFLICT' });
  assert.equal(f.saved().workspaces[f.alpha].inquiryRecovery.selections.length, 1);
});

test('original-byte corruption and normalized-row tampering are refused before draft or approval', async t => {
  const f = fixture(t); const imported = await f.importRows([row()]);
  const original = f.blobs.get(imported.nativeSource.attachment.attachmentId);
  f.blobs.set(imported.nativeSource.attachment.attachmentId, Buffer.from('corrupt'));
  await assert.rejects(() => f.service.read(f.alpha, 'alpha'), { code: 'INQUIRY_SOURCE_CHANGED' });
  f.blobs.set(imported.nativeSource.attachment.attachmentId, original);
  const lead = f.saved().workspaces[f.alpha].inquiryRecovery.leads[0];
  const quantity = lead.quantity; lead.quantity = 9999;
  await assert.rejects(() => f.service.read(f.alpha, 'alpha'), { code: 'INQUIRY_SOURCE_CHANGED' });
  lead.quantity = quantity;
  f.saved().workspaces[f.alpha].inquiryRecovery.leads[0].sourceHash = 'a'.repeat(64);
  await assert.rejects(() => f.service.read(f.alpha, 'alpha'), { code: 'INQUIRY_SOURCE_CHANGED' });
});

test('carried-forward history remains visible but cannot produce a new draft until a complete import', async t => {
  const f = fixture(t); await f.importRows([row()]); await f.approve();
  await f.importRows([row({ revision: 2, history: [], facts: [] })]); await f.approve();
  const context = await f.service.read(f.alpha, 'alpha');
  assert.ok(context.source.carriedForward.includes('history'));
  await assert.rejects(() => f.service.proposeDraft(f.proposal(context), f.execution()), { code: 'INQUIRY_CARRIED_FIELDS' });
  await f.importRows([row({ revision: 3 })]); await f.approve();
  const complete = await f.service.read(f.alpha, 'alpha');
  assert.deepEqual(complete.source.carriedForward, []);
  assert.equal((await f.service.proposeDraft(f.proposal(complete), f.execution())).draft.sent, false);
});

test('native storage failures retain state; parallel workspace imports persist both partitions and restart', async t => {
  const f = fixture(t); await f.importRows([row()]); const before = structuredClone(f.saved());
  f.failCommit(true); await assert.rejects(() => f.importRows([row({ revision: 2 })]), /commit failure/u); assert.deepEqual(f.saved(), before);
  f.failCommit(false);
  await Promise.all([f.importRows([row({ revision: 2 })]), f.importRows([row({ leadId: 'beta' })], f.beta)]);
  const restarted = createRecoveryService({ ...f.options, storage: createStorageAdapter(f.global) }); t.after(() => restarted.close());
  assert.equal((await restarted.read(f.alpha, 'alpha')).card.revision, 2); assert.equal((await restarted.read(f.beta, 'beta')).card.revision, 1);
  const bad = structuredClone(f.saved()); bad.workspaces[f.alpha].inquiryRecovery.leads[0].identity = null;
  assert.throws(() => validateRoot(bad), { code: 'INQUIRY_STORE_INVALID' });
});

test('cancellation interrupts a native source stream and a concurrent import invalidates the read', async t => {
  const f = fixture(t); await f.importRows([row()]);
  const original = f.attachments.readFileStream;
  const abort = new AbortController();
  // The adapter owns a combined lifetime signal; abort during a stream read must return no partial context.
  f.attachments.readFileStream = async function* (ref) { yield f.blobs.get(ref.attachmentId); abort.abort(); };
  await assert.rejects(() => f.service.read(f.alpha, 'alpha', abort.signal), { code: 'INQUIRY_CANCELLED' });
  f.attachments.readFileStream = async function* (ref) { yield f.blobs.get(ref.attachmentId); f.attachments.readFileStream = original; await f.importRows([row({ revision: 2 })]); };
  await assert.rejects(() => f.service.read(f.alpha, 'alpha'), { code: 'INQUIRY_SOURCE_CHANGED' });
  f.attachments.readFileStream = async function* (ref) { yield f.blobs.get(ref.attachmentId); f.options.registry.get(f.alpha).sessionIds = []; };
  await assert.rejects(() => f.service.toolRead({ action: 'read', leadId: 'alpha' }, f.execution()), { code: 'INQUIRY_WORKSPACE_REQUIRED' });
});

test('HTTP and tools preserve native authentication, strict inputs and user-only identity review', async t => {
  const f = fixture(t), server = createServer(createHttpHandler(f.service, { authorize: req => req.headers.cookie === 'fixture=yes' ? undefined : 401 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, path = origin + API_PREFIX + `/workspaces/${f.alpha}/import`;
  assert.equal((await fetch(origin + API_PREFIX + '/workspaces')).status, 401);
  const headers = { cookie: 'fixture=yes', origin, 'content-type': 'application/json' };
  const input = { requestId: randomUUID(), authorized: true, format: 'csv', sourceName: 'fixture.csv', dataBase64: Buffer.from(csv([row()])).toString('base64') };
  assert.equal((await fetch(path, { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' }, body: JSON.stringify(input) })).status, 403);
  assert.equal((await fetch(path, { method: 'POST', headers, body: JSON.stringify(input) })).status, 200);
  const tools = new Map(); registerTools({ effect: fn => fn(), tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } } }, f.service);
  assert.deepEqual([...tools.keys()], ['inquiry_recovery_read', 'inquiry_recovery_propose_draft']);
  assert.equal((await tools.get('inquiry_recovery_read').execute({ action: 'list' }, f.execution())).items.length, 1);
  assert.throws(() => f.service.import(f.alpha, { ...input, dataBase64: Buffer.from([0xff]).toString('base64') }), { code: 'INQUIRY_INPUT' });
  const module = { value: null }; vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load({ factory }) { module.value = factory(() => ({})); } } } });
  assert.deepEqual(Object.keys(module.value.dictionaries.zh).sort(), Object.keys(module.value.dictionaries.en).sort());
});
