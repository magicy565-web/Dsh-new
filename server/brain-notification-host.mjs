import { randomUUID } from 'node:crypto';

const ACTIVITY_TYPE = 'brain_notification';
const MAX_ENTRIES = 500;

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * Delivers a business notification and keeps the in-app copy.
 *
 * The in-app channel is the `activity` feed the app already exposes, so no new
 * collection or second database is created. A push channel (WeChat subscription)
 * only carries a pointer: the adapter deliberately sends a fixed template with a
 * title, a status and an end date, never the cards or any metric detail.
 *
 * Transport failures are recorded, never thrown and never reported as delivered.
 */
export function createBrainNotificationHost({ store, clock = Date.now, maxEntries = MAX_ENTRIES } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') throw new TypeError('The original Workspace store is required.');
  if (typeof clock !== 'function') throw new TypeError('A clock is required.');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 10 || maxEntries > 2000) throw new TypeError('maxEntries must be between 10 and 2000.');

  const entries = state => (Array.isArray(state.activity) ? state.activity : []).filter(item => item?.type === ACTIVITY_TYPE);
  const iso = () => new Date(clock()).toISOString();

  function list({ since = null, limit = 20 } = {}) {
    const after = since === null ? null : Date.parse(since);
    if (since !== null && !Number.isFinite(after)) throw new TypeError('since must be an ISO timestamp.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError('limit must be between 1 and 200.');
    return entries(store.read())
      .filter(item => after === null || Date.parse(item.createdAt) > after)
      .slice(-limit)
      .reverse();
  }

  async function deliver({ notification, channel = null, recipient = null, subscription = null, signal = null } = {}) {
    if (!notification || typeof notification.contentHash !== 'string' || typeof notification.title !== 'string')
      throw new TypeError('A built notification is required.');
    const previous = entries(store.read()).find(item => item.contentHash === notification.contentHash);
    if (previous) return { status: 'duplicate', record: previous };
    if (channel && (typeof channel.send !== 'function' || !recipient)) throw new TypeError('A push channel needs send() and a recipient.');

    const record = {
      id: randomUUID(),
      type: ACTIVITY_TYPE,
      title: text(notification.title, 160),
      detail: text(notification.cards?.[0]?.title, 200),
      createdAt: iso(),
      contentHash: notification.contentHash,
      windowStart: notification.startAt,
      windowEnd: notification.endAt,
      provisional: notification.provisional === true,
      evidenceIds: [...new Set((notification.cards ?? []).flatMap(card => card.evidenceIds ?? []))].slice(0, 12),
      cards: (notification.cards ?? []).map(card => ({ id: card.id, title: card.title, reason: card.reason, evidenceIds: card.evidenceIds, action: card.action, executable: false })),
      delivery: { channel: 'in-app', status: 'delivered', attemptedAt: iso() }
    };
    store.update(state => {
      state.activity ??= [];
      state.activity.push(record);
      const overflow = state.activity.length - maxEntries;
      if (overflow > 0) state.activity = state.activity.slice(overflow);
    });
    if (!channel) return { status: 'delivered', record };

    // Persist the attempt before any provider I/O, then record what actually
    // happened. The push is a pointer, so its payload is the template summary.
    const attempt = { channel: String(channel.channel ?? 'push'), status: 'attempting', attemptedAt: iso() };
    store.update(state => {
      const saved = (state.activity ?? []).find(item => item.id === record.id);
      if (saved) saved.delivery = attempt;
    });
    let outcome;
    try {
      outcome = await channel.send({
        recipient, subscription, signal,
        summary: { ...notification, phase: 'brain_brief' },
        // The durable attempt record above is the pre-send reservation.
        beforeSend: async () => {}
      });
    } catch {
      outcome = { status: 'blocked', code: 'NOTIFICATION_TRANSPORT_FAILED' };
    }
    const status = ['sent', 'blocked', 'failed', 'cancelled', 'unknown'].includes(outcome?.status) ? outcome.status : 'unknown';
    const delivery = { channel: attempt.channel, status, ...(typeof outcome?.code === 'string' ? { code: text(outcome.code, 80) } : {}), attemptedAt: attempt.attemptedAt };
    store.update(state => {
      const saved = (state.activity ?? []).find(item => item.id === record.id);
      if (saved) saved.delivery = delivery;
    });
    return { status, delivery, record: { ...record, delivery } };
  }

  return Object.freeze({ deliver, list });
}

export const BRAIN_NOTIFICATION_ACTIVITY_TYPE = ACTIVITY_TYPE;
