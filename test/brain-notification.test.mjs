import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrainNotification, shouldNotifyBrain } from '../server/brain-notification.mjs';

const workspaceId = 'ws';
function store(inquiries) {
  return {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: { inquiries },
    businessLibrary: { products: [] }
  };
}
const replied = day => ({ workspaceId, createdAt: `${day}T00:00:00.000Z`, updatedAt: `${day}T00:00:00.000Z`, status: 'replied', replies: [{ id: `r-${day}` }] });
const open = day => ({ workspaceId, createdAt: `${day}T00:00:00.000Z`, updatedAt: `${day}T00:00:00.000Z`, status: 'shared', replies: [] });

test('a notification carries the same bounded cards as the Brain home', () => {
  let now = Date.parse('2026-10-16T06:00:00.000Z');
  const state = store([open('2026-09-20'), open('2026-09-21'), open('2026-09-22'), replied('2026-09-23')]);
  const notification = buildBrainNotification({ state, workspaceId, clock: () => now });
  assert.ok(notification);
  assert.ok(notification.cards.length >= 1 && notification.cards.length <= 3);
  assert.equal(notification.channel, 'brain-brief');
  assert.equal(notification.messageId, 'brain-brief:ws');
  assert.match(notification.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(notification.startAt, '2026-08-25T00:00:00.000Z');
  assert.equal(notification.endAt, '2026-09-24T00:00:00.000Z');
  assert.equal(notification.executable, false);
  assert.equal(notification.businessGoalVerified, false);
  assert.ok(notification.cards.every(card => card.executable === false));
  assert.ok(notification.evidence.every(item => item.reference.kind === 'metric'));
});

test('the same observations always produce the same content hash', () => {
  let now = Date.parse('2026-10-16T06:00:00.000Z');
  const state = store([open('2026-09-20'), replied('2026-09-23')]);
  const first = buildBrainNotification({ state, workspaceId, clock: () => now });
  now = Date.parse('2026-10-17T23:00:00.000Z');
  const second = buildBrainNotification({ state, workspaceId, clock: () => now });
  assert.equal(second.contentHash, first.contentHash);
  assert.equal(second.endAt, first.endAt);
});

test('a new observation changes the notification identity', () => {
  let now = Date.parse('2026-10-16T06:00:00.000Z');
  const inquiries = [open('2026-09-20')];
  const state = store(inquiries);
  const first = buildBrainNotification({ state, workspaceId, clock: () => now });
  inquiries.push(open('2026-10-10'));
  const second = buildBrainNotification({ state, workspaceId, clock: () => now });
  assert.notEqual(second.contentHash, first.contentHash);
  assert.ok(Date.parse(second.endAt) > Date.parse(first.endAt));
});

test('an empty enterprise produces no notification at all', () => {
  const state = store([]);
  assert.equal(buildBrainNotification({ state, workspaceId, clock: () => Date.parse('2026-10-16T06:00:00.000Z') }), null);
});

test('a retry with identical content is not a second notification', () => {
  const state = store([open('2026-09-20')]);
  const notification = buildBrainNotification({ state, workspaceId, clock: () => Date.parse('2026-10-16T06:00:00.000Z') });
  assert.equal(shouldNotifyBrain({ notification }), true);
  assert.equal(shouldNotifyBrain({ notification, previousContentHash: notification.contentHash }), false);
  assert.equal(shouldNotifyBrain({ notification, previousContentHash: 'f'.repeat(64) }), true);
  assert.equal(shouldNotifyBrain({ notification: null, previousContentHash: 'f'.repeat(64) }), false);
});
