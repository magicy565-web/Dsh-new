// Inbox domain: one place where autonomous work becomes visible to a person.
//
// Producers (scheduler, chat approvals) push items behind a trusted service
// context. The inbox owns only notification state — it never copies a run, a
// goal or an artifact, only a reference to them.
import { randomUUID } from 'node:crypto';

export const INBOX_STATE_VERSION = 1;
const STATE_KEY = 'harnessInbox';

export const INBOX_STATUSES = Object.freeze(['unread', 'read']);
export const INBOX_LIMITS = Object.freeze({ items: 1_000, title: 200, body: 2_000, key: 200, refs: 10 });

export class InboxError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'InboxError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new InboxError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const KIND = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1_000;

const defaultState = () => ({ version: INBOX_STATE_VERSION, items: [] });

function validateState(value) {
  if (!isPlain(value) || value.version !== INBOX_STATE_VERSION || !Array.isArray(value.items)
    || value.items.length > INBOX_LIMITS.items)
    fail(500, 'INBOX_INVALID', 'Stored inbox is invalid or full.');
  const ids = new Set();
  for (const item of value.items) {
    if (!isPlain(item) || typeof item.id !== 'string' || !UUID.test(item.id)
      || typeof item.workspaceId !== 'string' || !item.workspaceId
      || typeof item.kind !== 'string' || !KIND.test(item.kind)
      || typeof item.title !== 'string' || !item.title || item.title.length > INBOX_LIMITS.title
      || typeof item.body !== 'string' || item.body.length > INBOX_LIMITS.body
      || !INBOX_STATUSES.includes(item.status) || !isIso(item.createdAt)
      || (item.readAt !== null && !isIso(item.readAt)) || !isPlain(item.refs))
      fail(500, 'INBOX_INVALID', 'Stored inbox item is invalid.');
    if (ids.has(item.id)) fail(500, 'INBOX_INVALID', 'Duplicate inbox item id.');
    ids.add(item.id);
  }
  return true;
}

export function createInboxService({ storage, workspaceId = 'local', resolveWorkspace = null, clock = Date.now } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Inbox requires the harness storage seam.');
  const at = () => new Date(clock()).toISOString();

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'INBOX_SESSION_REQUIRED', 'A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
        fail(403, 'INBOX_WORKSPACE_REQUIRED', 'The workspace could not be resolved.');
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    const id = input.workspaceId ?? workspaceId;
    if (id !== workspaceId) fail(403, 'INBOX_FORBIDDEN', 'This inbox belongs to another workspace.');
    return { workspaceId: id, subject: input.subject, role: input.role };
  }

  function partition(id) {
    return {
      read() {
        const state = storage.read() ?? {};
        const value = state.workspaces?.[id]?.[STATE_KEY];
        if (value === undefined) return defaultState();
        validateState(value);
        return value;
      },
      async update(mutator) {
        return storage.update(root => {
          const workspaces = (root.workspaces ??= {});
          const workspace = (workspaces[id] ??= {});
          const current = workspace[STATE_KEY] === undefined ? defaultState() : workspace[STATE_KEY];
          validateState(current);
          const draft = structuredClone(current);
          const result = mutator(draft);
          if (draft.items.length > INBOX_LIMITS.items) draft.items.splice(0, draft.items.length - INBOX_LIMITS.items);
          validateState(draft);
          workspace[STATE_KEY] = draft;
          return result;
        });
      },
    };
  }

  return Object.freeze({
    resolveActor,

    /** Internal producers only: a person must not fabricate their own inbox. */
    async push(context, body = {}) {
      if (context?.trustedService !== true)
        fail(403, 'INBOX_PRODUCER_ONLY', 'Only an internal service may push an inbox item.');
      if (context?.actor?.workspaceId && context.actor.workspaceId !== workspaceId)
        fail(403, 'INBOX_FORBIDDEN', 'This producer belongs to another workspace.');
      if (!isPlain(body)) fail(400, 'INBOX_INPUT', 'An inbox item must be an object.');
      if (Object.keys(body).some(key => !['kind', 'title', 'body', 'refs', 'dedupeKey'].includes(key)))
        fail(400, 'INBOX_INPUT', 'An inbox item has an unsupported field.');
      if (typeof body.kind !== 'string' || !KIND.test(body.kind)) fail(400, 'INBOX_INPUT', 'kind is invalid.');
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > INBOX_LIMITS.title)
        fail(400, 'INBOX_INPUT', 'title must be non-empty text of at most 200 characters.');
      const text = body.body === undefined ? '' : body.body;
      if (typeof text !== 'string' || text.length > INBOX_LIMITS.body) fail(400, 'INBOX_INPUT', 'body is invalid.');
      const refs = body.refs === undefined ? {} : body.refs;
      if (!isPlain(refs) || Object.keys(refs).length > INBOX_LIMITS.refs
        || Object.values(refs).some(value => typeof value !== 'string' || value.length > 200))
        fail(400, 'INBOX_INPUT', 'refs must be bounded text pairs.');
      const dedupeKey = body.dedupeKey === undefined ? null : body.dedupeKey;
      if (dedupeKey !== null && (typeof dedupeKey !== 'string' || !dedupeKey || dedupeKey.length > INBOX_LIMITS.key))
        fail(400, 'INBOX_INPUT', 'dedupeKey must be bounded text.');
      const store = partition(workspaceId);
      let item = null;
      let created = false;
      await store.update(state => {
        const now = clock();
        if (dedupeKey !== null) {
          const existing = state.items.find(entry => entry.dedupeKey === dedupeKey
            && now - Date.parse(entry.createdAt) < DEDUPE_WINDOW_MS);
          if (existing) { item = structuredClone(existing); created = false; return null; }
        }
        item = {
          id: randomUUID(), workspaceId, kind: body.kind, title: body.title, body: text,
          refs: structuredClone(refs), dedupeKey, status: 'unread', createdAt: at(), readAt: null,
        };
        state.items.push(item);
        created = true;
        return null;
      });
      return { item: structuredClone(item), created };
    },

    list(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'unread' : query.status;
      if (!['all', ...INBOX_STATUSES].includes(status)) fail(400, 'INBOX_INPUT', 'status is invalid.');
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail(400, 'INBOX_INPUT', 'limit must be 1-200.');
      const state = partition(actor.workspaceId).read();
      const items = state.items
        .filter(item => item.workspaceId === actor.workspaceId)
        .filter(item => status === 'all' || item.status === status)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(item => structuredClone(item));
      const unread = state.items.filter(item => item.workspaceId === actor.workspaceId && item.status === 'unread').length;
      return { workspaceId: actor.workspaceId, status, total: items.length, unread, items };
    },

    async markRead(context, id) {
      const actor = resolveActor(context);
      const store = partition(actor.workspaceId);
      let item = null;
      await store.update(state => {
        const current = state.items.find(entry => entry.id === id && entry.workspaceId === actor.workspaceId);
        if (!current) fail(404, 'INBOX_NOT_FOUND', 'No such inbox item in this workspace.');
        if (current.status === 'unread') { current.status = 'read'; current.readAt = at(); }
        item = structuredClone(current);
        return null;
      });
      return { item };
    },

    async markAllRead(context) {
      const actor = resolveActor(context);
      const store = partition(actor.workspaceId);
      let changed = 0;
      await store.update(state => {
        for (const item of state.items) {
          if (item.workspaceId !== actor.workspaceId || item.status !== 'unread') continue;
          item.status = 'read';
          item.readAt = at();
          changed += 1;
        }
        return null;
      });
      return { changed };
    },

    status(context) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const mine = state.items.filter(item => item.workspaceId === actor.workspaceId);
      return { workspaceId: actor.workspaceId, total: mine.length, unread: mine.filter(item => item.status === 'unread').length };
    },
  });
}
