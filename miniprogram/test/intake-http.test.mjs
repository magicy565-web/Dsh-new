import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, until } from './support.mjs';
import { actor, intakeFixture, blankScope, readyScope, scopeText } from './intake-http-support.mjs';
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
async function open(t, f) { const client = f.client(), { page } = loadPage(client, f.platform); t.after(() => page.onUnload()); page.onShow(); await until(() => page.data.readAt); return { client, page }; }
const target = draft => ({ id: draft.id, revision: draft.revision, draftHash: draft.draftHash, budgetConfirmed: true, deadlineConfirmed: true, publicDataConfirmed: true });
async function sendReady(f, pair) { const scope = readyScope(); f.respond(scope); pair.page.draft({ detail: { value: scopeText(scope) } }); await pair.page.send(); await f.settle(pair.client); await pair.page.refresh(); return pair.page.data.museDrafts.at(-1); }

test('actual Page -> signed HTTP/Pi tool -> one clarified original draft -> separate prepare/approve/dispatch -> real SHA file', async t => {
  const f = await intakeFixture(t), pair = await open(t, f); f.respond(blankScope()); pair.page.draft({ detail: { value: '请先整理一份委托草案，我还没有决定预算和期限。' } });
  await Promise.all([pair.page.send(), pair.page.send()]); let draft = await f.settle(pair.client); await pair.page.refresh();
  assert.equal(draft.phase, 'needs_information'); assert.equal(pair.page.data.draftCards.at(-1).questions.length, 6); assert.equal((f.app.store.read().workerOrders || []).length, 0); assert.equal(f.faux.state.callCount, 1);
  const originalId = draft.id, scope = readyScope(); f.respond(scope); pair.page.draft({ detail: { value: scopeText(scope) } }); await pair.page.send(); draft = await f.settle(pair.client); await pair.page.refresh();
  assert.equal(draft.id, originalId); assert.equal(draft.revision, 2); assert.equal(draft.phase, 'ready_for_review'); assert.equal(draft.scope.publicDataConfirmed, false);
  for (const field of ['budgetConfirmed', 'deadlineConfirmed', 'publicDataConfirmed']) { await pair.page.prepareDraft({ detail: { ...target(draft), [field]: false } }); assert.equal((f.app.store.read().workerOrders || []).length, 0); }
  await Promise.all([pair.page.prepareDraft({ detail: target(draft) }), pair.page.prepareDraft({ detail: target(draft) })]); assert.equal((f.app.store.read().workerOrders || []).length, 1); assert.equal((f.app.store.read().museTasks || []).length, 0);
  let card = pair.page.data.cards.find(item => item.muse && item.operation === 'approve'); assert.ok(card); await pair.page.card(event(card.id)); await pair.page.confirmCard(event(null));
  assert.equal((f.app.store.read().museTasks || []).length, 0); card = pair.page.data.cards.find(item => item.muse && item.operation === 'dispatch'); assert.ok(card); await pair.page.card(event(card.id)); await pair.page.confirmCard(event(null)); assert.equal((f.app.store.read().museTasks || []).length, 1);
  const orderId = pair.page.data.museDrafts.at(-1).orderId, delivered = await f.deliver(orderId);
  card = pair.page.data.cards.find(item => item.muse && item.operation === 'refresh'); await pair.page.card(event(card.id)); await pair.page.confirmCard(event(null));
  const file = pair.page.data.cards.find(item => item.file?.id === delivered.artifactId); assert.ok(file); f.corrupt(); await pair.page.card(event(file.id)); assert.match(pair.page.data.error, /不一致/); assert.equal(pair.page.data.preview, null);
  f.corrupt(false); await pair.page.card(event(file.id)); assert.equal(pair.page.data.preview.verified, true); assert.equal(pair.page.data.preview.content, delivered.bytes.toString()); pair.page.closePreview();
  card = pair.page.data.cards.find(item => item.muse && item.operation === 'accept'); await pair.page.card(event(card.id)); await pair.page.confirmCard(event(null)); assert.ok(pair.page.data.cards.some(item => item.file?.id === delivered.artifactId));
  assert.equal(f.faux.state.callCount, 2); assert.ok(f.requests.every(item => !item.path.endsWith(`/conversations/${actor.nativeAgentId}/messages`)));
});

test('actual HTTP first 202 and prepare acknowledgment loss reopen same original draft/body/order without another model call', async t => {
  const f = await intakeFixture(t), pair = await open(t, f), scope = readyScope(); f.respond(scope); pair.page.draft({ detail: { value: scopeText(scope) } }); f.loseNext(); await pair.page.send();
  const initial = structuredClone(f.journal.read().pending.body); await f.settle(pair.client); pair.page.onUnload(); await f.reopen(); const cold = await open(t, f); assert.equal(cold.page.data.uncertain, true); await cold.page.retry();
  assert.deepEqual(f.requests.filter(item => item.method === 'POST' && item.path.endsWith('/muse-drafts')).at(-1).body, initial); assert.equal(f.app.store.read().workspaceMuseDrafts.drafts.length, 1); assert.equal(f.faux.state.callCount, 1);
  const draft = cold.page.data.museDrafts.at(-1); f.loseNext(); await cold.page.prepareDraft({ detail: target(draft) }); const command = structuredClone(f.journal.read().pending); const orderId = f.app.store.read().workerOrders[0].id;
  assert.equal(command.kind, 'prepare'); cold.page.onUnload(); await f.reopen(); const restored = await open(t, f); await Promise.all([restored.page.retry(), restored.page.retry()]);
  assert.deepEqual(f.requests.filter(item => item.path.endsWith('/prepare')).at(-1).body, command.body); assert.equal((f.app.store.read().workerOrders || []).length, 1); assert.equal(restored.page.data.museDrafts.at(-1).orderId, orderId); assert.equal(f.faux.state.callCount, 1);
});

test('actual HTTP edits retire old revision; explicit reject of prepared draft retires old review and lost rejection reuses original body', async t => {
  const f = await intakeFixture(t), pair = await open(t, f), old = await sendReady(f, pair); const revised = { ...readyScope(), budgetCredits: 6 }; f.respond(revised); pair.page.draft({ detail: { value: scopeText(revised) } }); await pair.page.send(); const current = await f.settle(pair.client); await pair.page.refresh();
  assert.equal(current.id, old.id); assert.equal(current.revision, old.revision + 1); assert.notEqual(current.draftHash, old.draftHash);
  await assert.rejects(pair.client.prepareMuseDraft(old, true, true, true), { code: 'MUSE_DRAFT_STALE_SCOPE' }); assert.equal((f.app.store.read().workerOrders || []).length, 0);
  await pair.page.prepareDraft({ detail: target(current) }); const prepared = pair.page.data.museDrafts.at(-1), orderId = prepared.orderId, hash = prepared.reviewHash; f.loseNext(); await pair.page.rejectDraft({ detail: target(prepared) }); const command = structuredClone(f.journal.read().pending);
  pair.page.onUnload(); await f.reopen(); const cold = await open(t, f); await cold.page.retry(); assert.deepEqual(f.requests.filter(item => item.path.endsWith('/reject')).at(-1).body, command.body); assert.equal(cold.page.data.museDrafts.at(-1).phase, 'rejected');
  for (const operation of ['approve', 'dispatch']) { const result = await f.raw(`/conversations/${actor.nativeAgentId}/muse-delegations/${orderId}/${operation}`, 'POST', { confirmed: true, expectedReviewHash: hash }); assert.equal(result.data.error.code, 'MUSE_DRAFT_REJECTED'); }
  assert.equal((f.app.store.read().museTasks || []).length, 0); assert.equal((f.app.store.read().workerOrders || []).length, 1);
});
