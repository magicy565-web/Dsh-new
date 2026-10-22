import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrainNotificationHost, BRAIN_NOTIFICATION_ACTIVITY_TYPE } from '../server/brain-notification-host.mjs';

function memoryStore() {
  let state = { activity: [] };
  return {
    read: () => structuredClone(state),
    update: mutate => { mutate(state); return structuredClone(state); },
    snapshot: () => structuredClone(state)
  };
}

const notification = (hash = 'a'.repeat(64)) => ({
  channel: 'brain-brief', messageId: 'brain-brief:ws', revision: 1, contentHash: hash,
  startAt: '2026-08-25T00:00:00.000Z', endAt: '2026-09-24T00:00:00.000Z', provisional: false, notificationCount: 1,
  title: '经营观察 2026-08-25 至 2026-09-24',
  cards: [{ id: 'c1', title: '有 3 条询盘待跟进', reason: '超过 7 天未回复', evidenceIds: ['metric:supply-inquiry-aging'], action: { kind: 'open-business-context' }, executable: false }],
  evidence: [], executable: false, businessGoalVerified: false
});

test('in-app delivery appends one activity record and never executes anything', async () => {
  const store = memoryStore();
  const host = createBrainNotificationHost({ store, clock: () => Date.parse('2026-10-16T06:00:00.000Z') });
  const result = await host.deliver({ notification: notification() });
  assert.equal(result.status, 'delivered');
  const entries = host.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, BRAIN_NOTIFICATION_ACTIVITY_TYPE);
  assert.equal(entries[0].delivery.channel, 'in-app');
  assert.equal(entries[0].delivery.status, 'delivered');
  assert.equal(entries[0].contentHash, notification().contentHash);
  assert.deepEqual(entries[0].evidenceIds, ['metric:supply-inquiry-aging']);
  assert.equal(entries[0].cards[0].executable, false);
  assert.equal(entries[0].windowEnd, '2026-09-24T00:00:00.000Z');
});

test('the same content is recorded once, however often delivery is retried', async () => {
  const store = memoryStore();
  const host = createBrainNotificationHost({ store });
  await host.deliver({ notification: notification() });
  const retry = await host.deliver({ notification: notification() });
  assert.equal(retry.status, 'duplicate');
  assert.equal(host.list().length, 1);
  // A genuinely different observation is a new entry.
  const changed = await host.deliver({ notification: notification('b'.repeat(64)) });
  assert.equal(changed.status, 'delivered');
  assert.equal(host.list().length, 2);
});

test('a push channel is a pointer: the record keeps the full card body, the channel gets the template', async () => {
  const store = memoryStore();
  let sent = null;
  const channel = {
    channel: 'wechat_subscription',
    async send(args) {
      sent = args;
      await args.beforeSend();
      return { status: 'sent', code: 'WECHAT_ACCEPTED' };
    }
  };
  const host = createBrainNotificationHost({ store });
  const result = await host.deliver({ notification: notification(), channel, recipient: { openid: 'o-1' }, subscription: { id: 's-1' } });
  assert.equal(result.status, 'sent');
  assert.equal(sent.summary.phase, 'brain_brief');
  assert.equal(sent.summary.endAt, '2026-09-24T00:00:00.000Z');
  const entry = host.list()[0];
  assert.equal(entry.delivery.channel, 'wechat_subscription');
  assert.equal(entry.delivery.status, 'sent');
  assert.equal(entry.delivery.code, 'WECHAT_ACCEPTED');
  assert.equal(entry.cards.length, 1, 'the in-app copy still has the cards');
  // A retried push must not send twice.
  const retry = await host.deliver({ notification: notification(), channel, recipient: { openid: 'o-1' }, subscription: { id: 's-1' } });
  assert.equal(retry.status, 'duplicate');
});

test('a failing channel is recorded honestly and never loses the in-app copy', async () => {
  const store = memoryStore();
  const host = createBrainNotificationHost({ store });
  const thrown = await host.deliver({ notification: notification('c'.repeat(64)), channel: { channel: 'wechat_subscription', send: async () => { throw new Error('network down'); } }, recipient: { openid: 'o-1' } });
  assert.equal(thrown.status, 'blocked');
  assert.equal(thrown.delivery.code, 'NOTIFICATION_TRANSPORT_FAILED');
  assert.equal(host.list().length, 1);
  assert.equal(host.list()[0].delivery.status, 'blocked');
  const blocked = await host.deliver({ notification: notification('d'.repeat(64)), channel: { channel: 'wechat_subscription', send: async () => ({ status: 'blocked', code: 'WECHAT_SUBSCRIPTION_REQUIRED' }) }, recipient: { openid: 'o-1' } });
  assert.equal(blocked.status, 'blocked');
  assert.equal(host.list().find(item => item.contentHash === 'd'.repeat(64)).delivery.code, 'WECHAT_SUBSCRIPTION_REQUIRED');
});

test('a push without a recipient is refused instead of silently going in-app only', async () => {
  const host = createBrainNotificationHost({ store: memoryStore() });
  await assert.rejects(() => host.deliver({ notification: notification(), channel: { channel: 'x', send: async () => ({ status: 'sent' }) } }), /recipient/);
});

test('the offline feed returns only what happened after the cursor', async () => {
  let clock = Date.parse('2026-10-16T06:00:00.000Z');
  const store = memoryStore();
  const host = createBrainNotificationHost({ store, clock: () => clock });
  await host.deliver({ notification: notification('1'.repeat(64)) });
  clock += 3600000;
  await host.deliver({ notification: notification('2'.repeat(64)) });
  clock += 3600000;
  await host.deliver({ notification: notification('3'.repeat(64)) });
  assert.equal(host.list().length, 3);
  assert.equal(host.list({ since: new Date(clock - 7200000).toISOString() }).length, 2);
  assert.equal(host.list({ since: new Date(clock - 7200000).toISOString(), limit: 1 }).length, 1);
  assert.equal(host.list()[0].contentHash, '3'.repeat(64), 'newest first');
});

test('the activity feed is capped so it cannot grow without bound', async () => {
  const store = memoryStore();
  const host = createBrainNotificationHost({ store, maxEntries: 10 });
  for (let i = 0; i < 14; i += 1) await host.deliver({ notification: notification(String(i).padStart(64, '0')) });
  assert.equal(store.snapshot().activity.length, 10);
  assert.equal(host.list({ limit: 200 }).length, 10);
});
