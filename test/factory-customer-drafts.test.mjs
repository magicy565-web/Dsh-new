// Original taskFixture Store/artifact service. readJournal and source Run records
// below are explicit synthetic association fixtures, NOT a worker/model/network test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { taskFixture } from './fixtures/pi-task-helpers.mjs';
import { createFactoryCustomerDraftClient } from '../server/factory-customer-drafts.mjs';
import { libraryReadHash } from '../server/library-model-read-contract.mjs';
const observedAt = '2026-10-15T05:00:00.000Z';
const search = { status: 'sources_observed', observedAt, sources: [{ url: 'https://example.com/synthetic-catalog', title: 'Synthetic catalog', excerpt: 'Source-reported product category; buyer intent unknown.' }] };
const browser = { status: 'page_observed', observedAt, url: 'https://example.com/synthetic-catalog', httpStatus: 200, excerpt: 'Synthetic page text; not an independently verified customer.' };
const row = (toolCallId, toolName, receipt, isError = false) => ({ message: { role: 'toolResult', toolCallId, toolName, isError, content: [{ type: 'text', text: JSON.stringify(receipt) }] } });
const journal = () => [row('source-search', 'workspace_public_search', search), row('source-browser', 'workspace_public_browser', browser)];
const input = (requestId = 'user-requested-drafts', count = 1) => ({ requestId, sourceToolCallIds: ['source-search', 'source-browser'], documents: [
  { name: 'candidate-notes.md', content: 'Model-written source comparison. Identity, fit and permission remain pending human review.' },
  ...(count === 2 ? [{ name: 'questions.md', content: 'Which public product specification and target region should be compared?' }] : []),
] });
async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/factory-customer-drafts-'); let f;
  t.after(async () => { await f?.app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  f = await taskFixture(t, { directory, enterprise: true });
  const created = await f.app.runtime.createConversation({ title: 'Synthetic public customer draft associations', requestId: randomUUID() }, { subject: 'member-a', workspaceId: 'pi-enterprise-test' });
  const cid = created.conversation.id, runIds = [randomUUID(), randomUUID()];
  await f.app.store.update(state => { for (const id of runIds) state.runs.push({ id, conversationId: cid, status: 'succeeded' }); });
  const flags = { admitted: true, active: true }, state = { entries: journal(), reads: 0 };
  const make = (runId = runIds[0]) => createFactoryCustomerDraftClient({ artifacts: f.app.artifacts, store: f.app.store,
    identity: { subject: 'member-a', workspaceId: 'pi-enterprise-test' }, conversationId: cid, runId,
    authorize: async () => { if (!flags.active) throw Object.assign(Error('Synthetic current authority refused'), { status: 403 }); },
    canSave: () => flags.admitted && flags.active, readJournal: async () => { state.reads++; return structuredClone(state.entries); } });
  return { get f() { return f; }, cid, runIds, flags, state, make, async restart() {
    const directory = f.directory; await f.app.close(); f = await taskFixture(t, { directory, enterprise: true });
  } };
}
async function blobs(f) { return (await fs.readdir(path.join(f.directory, 'artifacts'))).filter(name => name.endsWith('.blob') || name.endsWith('.upload')); }
const drafts = f => f.app.store.read().artifacts.filter(a => a.metadata?.factoryCustomerDraft);
async function assertExact(f, receipt, original) {
  assert.equal(receipt.status, 'saved-draft'); assert.equal(receipt.artifacts.length, original.documents.length);
  assert.equal(receipt.sent, false); assert.equal(receipt.humanReviewed, false); assert.equal(receipt.humanReviewRequired, true);
  assert.deepEqual(receipt.sources.map(s => [s.toolCallId, s.originalTool, s.observedAt, s.receiptHash]), [
    ['source-search', 'workspace_public_search', observedAt, libraryReadHash(search)], ['source-browser', 'workspace_public_browser', observedAt, libraryReadHash(browser)],
  ]);
  for (const ref of receipt.artifacts) {
    const stored = await f.app.artifacts.download(ref.artifactId, { version: ref.version });
    const content = original.documents.find(d => d.name === ref.name).content;
    assert.equal(stored.bytes.toString(), 'Human review required. NOT SENT. Unverified model draft; candidates are not verified buyers.\n\n' + content
      + '\n\n---\nOriginal public source receipts (not approval):\n' + JSON.stringify(receipt.sources, null, 2) + '\n');
    assert.equal(createHash('sha256').update(stored.bytes).digest('hex'), ref.sha256);
    assert.equal(stored.artifact.metadata.factoryCustomerDraft.sent, false);
    assert.deepEqual(stored.artifact.metadata.factoryCustomerDraft.sources, receipt.sources);
  }
}
test('readonly refuses with zero blobs; variable one/two model-written drafts use original artifacts and exact sources', async t => {
  const s = await fixture(t), one = input(); s.flags.admitted = false;
  await assert.rejects(s.make().save(one), e => e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED' && e.status === 403);
  assert.equal(s.state.reads, 0); assert.equal(drafts(s.f).length, 0); assert.deepEqual(await blobs(s.f), []);
  s.flags.admitted = true; const first = await s.make().save(one); await assertExact(s.f, first, one);
  const two = input('two-variable-documents', 2), second = await s.make().save(two); await assertExact(s.f, second, two);
  assert.equal(drafts(s.f).length, 3); assert.equal(s.f.faux.state.callCount, 0);
  assert.ok(drafts(s.f).every(a => a.sourceConversationId === s.cid && a.sourceRunId === s.runIds[0]));
});
test('same request replays original artifact across Run association; changed body or file set cannot replace it', async t => {
  const s = await fixture(t), value = input(), first = await s.make().save(value);
  const replay = await s.make(s.runIds[1]).save(value); assert.equal(replay.artifacts[0].artifactId, first.artifacts[0].artifactId); assert.equal(replay.artifacts[0].duplicate, true);
  assert.equal(drafts(s.f)[0].sourceRunId, s.runIds[0]);
  for (const documents of [[{ ...value.documents[0], content: 'Changed model-written body.' }], [...value.documents, { name: 'extra.md', content: 'Different file set.' }], [{ name: 'renamed.md', content: value.documents[0].content }]])
    await assert.rejects(s.make().save({ ...value, documents }), e => e.code === 'PUBLIC_DRAFT_REQUEST_CHANGED');
  s.state.entries = [row('source-search', 'workspace_public_search', { ...search, sources: [{ ...search.sources[0], excerpt: 'Changed original source receipt.' }] }), journal()[1]];
  await assert.rejects(s.make().save(value), e => e.code === 'PUBLIC_DRAFT_REQUEST_CHANGED');
  assert.equal(drafts(s.f).length, 1); assert.equal((await blobs(s.f)).length, 1);
});
test('failed, forged, duplicate, missing-time and missing source references refuse without artifacts', async t => {
  const s = await fixture(t), good = journal();
  const invalid = [[], [good[0], good[0], good[1]], [row('source-search', 'workspace_factory_customers_research', search), good[1]],
    [row('source-search', 'workspace_public_search', search, true), good[1]],
    [row('source-search', 'workspace_public_search', { ...search, status: 'unavailable' }), good[1]],
    [row('source-search', 'workspace_public_search', { ...search, sources: [] }), good[1]],
    [row('source-search', 'workspace_public_search', { ...search, observedAt: undefined }), good[1]],
    [good[0], row('source-browser', 'workspace_public_browser', { ...browser, observedAt: 'not-a-time' })],
    [row('source-search', 'workspace_public_search', { ...search, sources: [{ url: 'https://user:secret@example.com/' }] }), good[1]],
    [good[0], row('source-browser', 'workspace_public_browser', { ...browser, status: 'unavailable' })],
    [good[0], { message: { ...good[1].message, content: [{ type: 'text', text: 'not JSON' }] } }],
  ];
  for (const entries of invalid) { s.state.entries = entries; await assert.rejects(s.make().save(input())); }
  s.state.entries = good;
  await assert.rejects(s.make().save({ ...input(), sourceToolCallIds: ['source-search', 'source-search'] }));
  await assert.rejects(s.make().save({ ...input(), sources: [{ url: 'https://forged.invalid' }] }));
  assert.equal(drafts(s.f).length, 0); assert.deepEqual(await blobs(s.f), []);
  await assertExact(s.f, await s.make().save(input()), input());
});
test('partial save survives actual original app/Store reload and exact replay fills only the missing artifact', async t => {
  const s = await fixture(t), value = input('restart-partial', 2), original = s.f.app.artifacts.create; let calls = 0;
  s.f.app.artifacts.create = (...args) => ++calls === 2 ? Promise.reject(Object.assign(Error('Synthetic service outage'), { status: 503 })) : original(...args);
  const partial = await s.make().save(value); assert.equal(partial.status, 'partial'); assert.equal(partial.artifacts.length, 1); assert.equal(drafts(s.f).length, 1);
  s.f.app.artifacts.create = original; await s.restart();
  const recovered = await s.make(s.runIds[1]).save(value); await assertExact(s.f, recovered, value);
  assert.equal(recovered.artifacts[0].artifactId, partial.artifacts[0].artifactId); assert.equal(recovered.artifacts[0].duplicate, true);
  assert.equal(recovered.artifacts[1].duplicate, false); assert.equal(drafts(s.f).length, 2); assert.equal((await blobs(s.f)).length, 2);
});
test('already cancelled, revoked authority and cancellation or intent revocation at original commit gate persist no bytes', async t => {
  const s = await fixture(t), value = input(), cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(s.make().save(value, cancelled.signal), e => e.name === 'AbortError');
  s.flags.active = false; await assert.rejects(s.make().save(value), e => e.status === 403); s.flags.active = true;
  const original = s.f.app.artifacts.create;
  for (const mode of ['cancel', 'permission']) {
    const controller = new AbortController(); s.flags.admitted = true;
    s.f.app.artifacts.create = async (...args) => { if (mode === 'cancel') controller.abort(); else s.flags.admitted = false; return original(...args); };
    await assert.rejects(s.make().save(value, controller.signal), e => mode === 'cancel' ? e.name === 'AbortError' : e.code === 'BUSINESS_EXECUTION_INTENT_REQUIRED');
    assert.equal(drafts(s.f).length, 0); assert.deepEqual(await blobs(s.f), []);
  }
  s.f.app.artifacts.create = original; s.flags.admitted = true;
  await assertExact(s.f, await s.make().save(value), value);
});
test('concurrent exact saves persist one original artifact; mutated artifact cannot be reported as an exact replay', async t => {
  const s = await fixture(t), value = input();
  const results = await Promise.all(Array.from({ length: 6 }, () => s.make().save(value)));
  assert.equal(new Set(results.map(r => r.artifacts[0].artifactId)).size, 1);
  assert.equal(results.filter(r => !r.artifacts[0].duplicate).length, 1);
  const id = results[0].artifacts[0].artifactId;
  await s.f.app.artifacts.update(id, { content: 'Subsequently edited content.' });
  await assert.rejects(s.make().save(value), e => e.code === 'PUBLIC_DRAFT_ARTIFACT_CHANGED' && e.status === 409);
  assert.equal(drafts(s.f).length, 1); assert.equal(s.f.app.artifacts.get(id).artifact.currentVersion, 2);
});
