import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { draftPresentation, DraftReview } = createRequire(import.meta.url)('../../release/miniprogram/shared/muse-draft-view.js');
test('draft view only shows received fields; a missing budget/deadline never becomes an invented permission', () => {
  const value = draftPresentation({ id: 'dto-fixture', conversationId: 'original-fixture', revision: 1, draftHash: 'a'.repeat(64), phase: 'needs_information', scope: { product: 'Received product', objective: 'Received objective' }, questions: ['请明确额度上限。'], suggestions: [] });
  assert.equal(value.budget, '预算待明确'); assert.equal(value.deadline, '期限待明确'); assert.equal(value.ready, false); assert.equal(value.questions.length, 1); assert.ok(!value.scope.market);
});

test('amount, deadline and public scope require three explicit confirmations and reset on return or changed revision/draftHash', () => {
  const value = { id: 'dto-fixture', conversationId: 'original-fixture', revision: 2, draftHash: 'b'.repeat(64), phase: 'ready_for_review', scope: { product: 'Received product', budgetCredits: 5, deadlineAt: '2026-11-12T00:00:00.000Z' }, questions: [], suggestions: [] };
  const review = new DraftReview(); review.open(value);
  assert.throws(() => review.validate(value), /明确确认/);
  review.confirm(['budget']); assert.throws(() => review.validate(value), /明确确认/);
  review.confirm(['budget', 'public']); assert.throws(() => review.validate(value), /明确确认/);
  review.confirm(['public']); assert.throws(() => review.validate(value), /明确确认/);
  review.confirm(['budget', 'deadline', 'public']); assert.deepEqual(review.validate(value), { id: value.id, conversationId: value.conversationId, revision: value.revision, draftHash: value.draftHash });
  assert.throws(() => review.validate({ ...value, revision: 3, draftHash: 'c'.repeat(64) }), /已变更/); assert.equal(review.budgetConfirmed, false); assert.equal(review.publicDataConfirmed, false);
  review.open(value); review.confirm(['budget', 'deadline', 'public']); review.close(); assert.equal(review.value, null);
  review.open(value); assert.equal(review.publicDataConfirmed, false); assert.throws(() => review.validate({ ...value, conversationId: 'another' }), /已变更/);
});
test('draft view requires actual fields and presents a model suggestion separately from explicit user confirmation', () => {
  const value = draftPresentation({ id: 'dto-fixture', conversationId: 'original-fixture', revision: 2, draftHash: 'b'.repeat(64), phase: 'ready_for_review', scope: { product: 'Received product', budgetCredits: 5, deadlineAt: '2026-11-12T00:00:00.000Z' }, questions: [], suggestions: ['此值是模型建议，尚未授权。'] });
  assert.equal(value.ready, true); assert.equal(value.suggestions.length, 1); assert.equal('confirmed' in value, false); assert.equal('publicDataConfirmed' in value, false);
  assert.equal(draftPresentation({ ...value, phase: 'rejected' }).ready, false);
});

test('shipped Muse goal mode rejects missing original binding and never substitutes a Pi send or creates a generic conversation', async () => {
  const { WorkspaceClient } = createRequire(import.meta.url)('../../release/miniprogram/shared/client.js');
  const calls = [], client = new WorkspaceClient({ request(options) { calls.push(options); } }, { baseUrl: 'https://workspace.example', goalMode: 'muse' });
  assert.equal(client.requiresOriginalMuse, true);
  await assert.rejects(client.mainConversation({ conversations: [], museBinding: { originalBinding: false } }), { code: 'MUSE_ORIGINAL_BINDING_REQUIRED' });
  await assert.rejects(client.send('original', 'Goal text cannot authorize an ordinary Pi replacement'), { code: 'MUSE_ORIGINAL_BINDING_REQUIRED' });
  assert.equal(calls.length, 0);
});
