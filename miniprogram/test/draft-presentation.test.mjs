import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { draftPresentation } = createRequire(import.meta.url)('../../release/miniprogram/shared/muse-draft-view.js');
test('draft view only shows received fields; a missing budget/deadline never becomes an invented permission', () => {
  const value = draftPresentation({ id: 'dto-fixture', conversationId: 'original-fixture', revision: 1, hash: 'a'.repeat(64), state: 'needs_input', scope: { product: 'Received product', objective: 'Received objective' }, questions: ['请明确额度上限。'], suggestions: [] });
  assert.equal(value.budget, '预算待明确'); assert.equal(value.deadline, '期限待明确'); assert.equal(value.ready, false); assert.equal(value.questions.length, 1); assert.ok(!value.scope.market);
});
test('draft view requires actual fields and presents a model suggestion separately from explicit user confirmation', () => {
  const value = draftPresentation({ id: 'dto-fixture', conversationId: 'original-fixture', revision: 2, hash: 'b'.repeat(64), state: 'review', scope: { product: 'Received product', budgetCredits: 5, deadlineAt: '2026-11-12T00:00:00.000Z' }, questions: [], suggestions: ['此值是模型建议，尚未授权。'] });
  assert.equal(value.ready, true); assert.equal(value.suggestions.length, 1); assert.equal('confirmed' in value, false); assert.equal('publicDataConfirmed' in value, false);
  assert.equal(draftPresentation({ ...value, state: 'rejected' }).ready, false);
});
