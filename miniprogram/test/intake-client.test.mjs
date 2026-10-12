// Frozen-contract transport fixtures. These are not backend HTTP/model/Muse
// execution evidence; real HTTP integration follows the backend implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, memoryJournal, WorkspaceClient, until } from './support.mjs';
const event = id => ({ currentTarget: { dataset: { id } } });
function fixture() {
  const requests = [], journal = memoryJournal(), receipts = new Map(); let drafts = [], lost = false, orders = 0;
  const conversationId = 'original:fixture/conversation';
  const platform = { request(options) {
    requests.push({ path: new URL(options.url).pathname, method: options.method, body: structuredClone(options.data) });
    const path = new URL(options.url).pathname, body = options.data;
    if (path.endsWith('/session')) { options.success({ statusCode: 200, data: { authenticated: true, user: { id: 'owner-fixture', role: 'admin' }, mode: 'enterprise', csrfToken: 'fixture-csrf' } }); return; }
    if (path.endsWith('/bootstrap')) { options.success({ statusCode: 200, data: { conversations: [{ id: conversationId, title: 'Original fixture' }], messages: [], runs: [], artifacts: [], museBinding: { originalBinding: true, conversationId }, runtime: { configured: true } } }); return; }
    if (path.endsWith('/muse-delegations')) { options.success({ statusCode: 200, data: { delegations: [] } }); return; }
    if (options.method === 'GET' && path.endsWith('/muse-drafts')) { options.success({ statusCode: 200, data: { drafts: structuredClone(drafts) } }); return; }
    if (options.method !== 'POST') throw Error('Unexpected fixture route ' + path);
    let result = receipts.get(body.requestId);
    if (!result && path.endsWith('/muse-drafts')) {
      const draft = { id: 'draft-unit-fixture', conversationId, requestId: body.requestId, scopeVersion: 1, scopeHash: 'a'.repeat(64), runId: 'run-unit-fixture-1', phase: 'needs_information', scope: { serviceId: 'channel-validation', product: 'Received public product', market: 'US', objective: body.content, budgetCredits: null, deadlineAt: null, publicDataConfirmed: false }, productReference: null, missingFields: ['budgetCredits', 'deadlineAt'], questions: [{ field: 'budgetCredits', question: '请明确额度上限。' }, { field: 'deadlineAt', question: '请明确截止日期与时间。' }], error: null, prepareRequestId: null, orderId: null, reviewHash: null, executionStarted: false, wakeVerified: false };
      drafts.push(draft); result = { draftId: draft.id, scopeVersion: 1, run: { id: draft.runId, status: 'running' } };
    } else if (!result && path.endsWith('/messages')) {
      assert.equal(body.expectedScopeVersion, drafts[0].scopeVersion); drafts[0] = { ...drafts[0], scopeVersion: 2, scopeHash: 'b'.repeat(64), phase: 'ready_for_review', scope: { ...drafts[0].scope, budgetCredits: 5, deadlineAt: '2026-11-12T00:00:00.000Z' }, missingFields: [], questions: [], runId: 'run-unit-fixture-2' }; result = { draftId: drafts[0].id, scopeVersion: 2, run: { id: drafts[0].runId, status: 'running' } };
    } else if (!result && path.endsWith('/prepare')) {
      assert.deepEqual(Object.keys(body).sort(), ['budgetConfirmed', 'confirmed', 'expectedScopeHash', 'expectedScopeVersion', 'publicDataConfirmed', 'requestId']); assert.equal(body.expectedScopeHash, drafts[0].scopeHash); assert.equal(body.expectedScopeVersion, drafts[0].scopeVersion);
      orders++; drafts[0] = { ...drafts[0], phase: 'prepared', prepareRequestId: body.requestId, orderId: 'order-unit-fixture', reviewHash: 'c'.repeat(64) }; result = { draft: structuredClone(drafts[0]), delegation: { orderId: drafts[0].orderId, reviewHash: drafts[0].reviewHash } };
    }
    assert.ok(result, 'Fixture must use a frozen contract route'); receipts.set(body.requestId, result);
    if (lost) { lost = false; options.fail({ errMsg: 'Lost response fixture' }); } else options.success({ statusCode: path.endsWith('/prepare') ? 200 : 202, data: structuredClone(result) });
  } };
  const client = () => new WorkspaceClient(platform, { baseUrl: 'https://workspace.example', goalMode: 'muse', journal });
  return { requests, journal, platform, conversationId, client, loseNext() { lost = true; }, get drafts() { return drafts; }, get orders() { return orders; } };
}
async function pageFixture(t, f, client = f.client()) { const { page } = loadPage(client, f.platform); t.after(() => page.onUnload()); page.onShow(); await until(() => page.data.readAt); return { page, client }; }

test('actual Page goal/reply uses frozen Muse routes/version and only server missing questions; zero ordinary Pi sends', async t => {
  const f = fixture(), { page } = await pageFixture(t, f);
  page.draft({ detail: { value: '帮我验证这款公开产品在美国的渠道。' } }); await Promise.all([page.send(), page.send()]);
  const first = f.requests.filter(value => value.method === 'POST'); assert.equal(first.length, 1); assert.ok(first[0].path.endsWith('/muse-drafts')); assert.deepEqual(first[0].body.inputContext.connectorActions, []);
  assert.equal(page.data.draftCards[0].questions.length, 2); assert.equal(page.data.draftCards[0].scope.budgetCredits, undefined); assert.equal(page.data.draftCards[0].ready, false);
  page.draft({ detail: { value: '上限5 credits，截止2026-11-12 00:00 UTC。' } }); await page.send();
  const reply = f.requests.filter(value => value.method === 'POST').at(-1); assert.ok(reply.path.endsWith('/muse-drafts/draft-unit-fixture/messages')); assert.equal(reply.body.expectedScopeVersion, 1); assert.equal(page.data.draftCards[0].scopeVersion, 2); assert.equal(page.data.draftCards[0].ready, true);
  assert.ok(f.requests.every(value => !value.body?.provider)); assert.equal(f.orders, 0);
  await page.openDraft(event('draft-unit-fixture')); page.editDraft(); assert.equal(page.data.selectedDraft, null); assert.equal(f.orders, 0);
});

test('lost intake and prepare responses survive cold client restart and reuse original body without another order', async t => {
  const f = fixture(), { page } = await pageFixture(t, f);
  page.draft({ detail: { value: 'Original goal fixture' } }); f.loseNext(); await page.send(); const original = structuredClone(f.requests.at(-1).body);
  assert.equal(page.data.uncertain, true); page.onUnload(); const { page: cold } = await pageFixture(t, f); assert.equal(cold.data.draft, original.content); await cold.retry();
  assert.deepEqual(f.requests.filter(value => value.method === 'POST').at(-1).body, original); assert.equal(f.drafts.length, 1);
  cold.draft({ detail: { value: '5 credits, 2026-11-12T00:00:00Z' } }); await cold.send(); const draft = cold.data.museDrafts[0];
  const target = { id: draft.id, scopeVersion: draft.scopeVersion, scopeHash: draft.scopeHash, budgetConfirmed: false, publicDataConfirmed: true };
  await cold.prepareDraft({ detail: target }); assert.equal(f.orders, 0); assert.equal(cold.data.uncertain, false);
  f.loseNext(); await cold.prepareDraft({ detail: { ...target, budgetConfirmed: true } }); assert.equal(f.orders, 1); const command = structuredClone(f.journal.read().pending); assert.equal(command.kind, 'prepare');
  cold.onUnload(); const { page: restored } = await pageFixture(t, f); await Promise.all([restored.retry(), restored.retry()]);
  assert.deepEqual(f.requests.filter(value => value.path.endsWith('/prepare')).at(-1).body, command.body); assert.equal(f.orders, 1); assert.equal(restored.data.draftCards[0].orderId, 'order-unit-fixture');
});

test('stale selected scope cannot prepare through actual Page callback; no client body can override order values', async t => {
  const f = fixture(), { page } = await pageFixture(t, f); page.draft({ detail: { value: 'Original goal' } }); await page.send(); page.draft({ detail: { value: 'Explicit budget/deadline' } }); await page.send();
  const current = page.data.museDrafts[0], count = f.requests.filter(value => value.method === 'POST').length;
  await page.prepareDraft({ detail: { id: current.id, scopeVersion: 1, scopeHash: 'a'.repeat(64), budgetConfirmed: true, publicDataConfirmed: true } });
  assert.equal(f.requests.filter(value => value.method === 'POST').length, count); assert.equal(f.orders, 0); assert.match(page.data.error, /已变更/);
});
