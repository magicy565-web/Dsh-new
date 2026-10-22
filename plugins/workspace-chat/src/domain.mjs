// Conversation and run domain for the Harness-hosted product.
//
// This module owns the four durable collections that every later capability
// hangs off: conversations, messages, runs and an append-only event log. It
// deliberately contains no model call and no tool execution: a run is created
// in `prepared` and only a future runner may move it forward. Everything a run
// will need later (context snapshot, approval tickets, artifacts) is addressable
// by run id, so those domains never have to store a second conversation copy.
import { randomUUID } from 'node:crypto';

export const STATE_VERSION = 1;
const STATE_KEY = 'harnessChat';

export const RUN_STATUSES = Object.freeze(['prepared', 'running', 'blocked', 'completed', 'failed', 'cancelled']);
export const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);
const TERMINAL = new Set(TERMINAL_STATUSES);
const TRANSITIONS = Object.freeze({
  prepared: Object.freeze(['running', 'cancelled']),
  running: Object.freeze(['blocked', 'completed', 'failed', 'cancelled']),
  blocked: Object.freeze(['running', 'failed', 'cancelled']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export const CHAT_LIMITS = Object.freeze({
  conversations: 500, messages: 20_000, messagesPerConversation: 2_000,
  runs: 5_000, events: 20_000, receipts: 10_000,
  title: 200, content: 20_000, id: 128, query: 200, limit: 100,
});

export class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new ChatError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= CHAT_LIMITS.id;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function text(value, max, name, { empty = false } = {}) {
  if (typeof value !== 'string') fail(400, 'CHAT_INPUT', `${name} must be a string.`);
  const trimmed = value.trim();
  if (!empty && !trimmed) fail(400, 'CHAT_INPUT', `${name} must not be empty.`);
  if (value.length > max) fail(400, 'CHAT_INPUT', `${name} exceeds ${max} characters.`);
  return value;
}

const defaultState = () => ({
  version: STATE_VERSION, seq: 0,
  conversations: [], messages: [], runs: [], events: [], receipts: [],
});

function validateRun(run) {
  if (!isPlain(run) || !isId(run.id) || !isId(run.conversationId) || !isId(run.workspaceId)
    || !RUN_STATUSES.includes(run.status) || !isIso(run.createdAt) || typeof run.requestedBy !== 'string'
    || (run.startedAt !== null && !isIso(run.startedAt))
    || (run.endedAt !== null && !isIso(run.endedAt))
    || (run.cancelRequestedAt !== null && !isIso(run.cancelRequestedAt))
    || (run.error !== null && !isPlain(run.error))
    || !isPlain(run.snapshot))
    fail(500, 'CHAT_INVALID', 'Stored chat run is invalid.');
}

function validateState(value) {
  if (!isPlain(value) || value.version !== STATE_VERSION
    || !Array.isArray(value.conversations) || !Array.isArray(value.messages)
    || !Array.isArray(value.runs) || !Array.isArray(value.events) || !Array.isArray(value.receipts)
    || !Number.isSafeInteger(value.seq) || value.seq < 0
    || value.conversations.length > CHAT_LIMITS.conversations
    || value.messages.length > CHAT_LIMITS.messages
    || value.runs.length > CHAT_LIMITS.runs
    || value.events.length > CHAT_LIMITS.events
    || value.receipts.length > CHAT_LIMITS.receipts)
    fail(500, 'CHAT_INVALID', 'Stored chat state is invalid or full.');
  const conversationIds = new Set(), messageIds = new Set(), runIds = new Set(), eventSeqs = new Set();
  for (const conversation of value.conversations) {
    if (!isPlain(conversation) || !isId(conversation.id) || !isId(conversation.workspaceId)
      || typeof conversation.title !== 'string' || !isIso(conversation.createdAt)
      || !isIso(conversation.updatedAt) || !['open', 'closed'].includes(conversation.status))
      fail(500, 'CHAT_INVALID', 'Stored conversation is invalid.');
    if (conversationIds.has(conversation.id)) fail(500, 'CHAT_INVALID', 'Duplicate conversation id.');
    conversationIds.add(conversation.id);
  }
  for (const message of value.messages) {
    if (!isPlain(message) || !isId(message.id) || !conversationIds.has(message.conversationId)
      || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string'
      || !isIso(message.createdAt))
      fail(500, 'CHAT_INVALID', 'Stored message is invalid.');
    if (messageIds.has(message.id)) fail(500, 'CHAT_INVALID', 'Duplicate message id.');
    messageIds.add(message.id);
  }
  for (const run of value.runs) {
    validateRun(run);
    if (!conversationIds.has(run.conversationId)) fail(500, 'CHAT_INVALID', 'Stored run points at a missing conversation.');
    if (runIds.has(run.id)) fail(500, 'CHAT_INVALID', 'Duplicate run id.');
    runIds.add(run.id);
  }
  for (const event of value.events) {
    if (!isPlain(event) || !Number.isSafeInteger(event.seq) || event.seq < 1 || !runIds.has(event.runId)
      || typeof event.type !== 'string' || !event.type || !isIso(event.at) || !isPlain(event.data))
      fail(500, 'CHAT_INVALID', 'Stored chat event is invalid.');
    if (eventSeqs.has(event.seq)) fail(500, 'CHAT_INVALID', 'Duplicate chat event sequence.');
    eventSeqs.add(event.seq);
  }
  return true;
}

function withDefaults(value) {
  if (!isPlain(value) || value.version !== STATE_VERSION) return value;
  return {
    ...value,
    seq: value.seq ?? 0,
    receipts: value.receipts ?? [],
  };
}

function viewRun(run) {
  return { ...structuredClone(run), terminal: TERMINAL.has(run.status) };
}

function conversationView(conversation, state) {
  const messages = state.messages.filter(message => message.conversationId === conversation.id);
  const runs = state.runs.filter(run => run.conversationId === conversation.id);
  return {
    ...structuredClone(conversation),
    messageCount: messages.length,
    runCount: runs.length,
    lastRunId: runs.length ? runs[runs.length - 1].id : null,
  };
}

/**
 * @param {object} options
 * @param {{read():object, update(fn):Promise<any>}} options.storage
 * @param {string} [options.workspaceId]
 * @param {(actor:object)=>{workspaceId:string,subject:string,role:string}} [options.resolveWorkspace]
 * @param {() => number} [options.clock]
 * @param {{record(entry:object):Promise<any>}} [options.audit]
 */
export function createChatService({ storage, workspaceId = 'local', resolveWorkspace = null, clock = Date.now, audit = null } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Chat requires the harness storage seam.');
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('Chat requires an exact workspace id.');
  if (resolveWorkspace !== null && typeof resolveWorkspace !== 'function') throw new TypeError('resolveWorkspace must be a function.');

  const at = () => new Date(clock()).toISOString();
  const listeners = new Map();

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'CHAT_SESSION_REQUIRED', 'A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
        fail(403, 'CHAT_WORKSPACE_REQUIRED', 'The workspace could not be resolved.');
      return {
        workspaceId: resolved.workspaceId,
        subject: typeof resolved.subject === 'string' && resolved.subject ? resolved.subject : input.subject,
        role: ['admin', 'operator', 'viewer'].includes(resolved.role) ? resolved.role : input.role,
      };
    }
    const id = input.workspaceId ?? workspaceId;
    if (id !== workspaceId) fail(403, 'CHAT_FORBIDDEN', 'This chat belongs to another workspace.');
    return { workspaceId: id, subject: input.subject, role: input.role };
  }

  function partition(id) {
    return {
      read() {
        const state = storage.read() ?? {};
        const value = state.workspaces?.[id]?.[STATE_KEY];
        if (value === undefined) return defaultState();
        const normalized = withDefaults(value);
        validateState(normalized);
        return normalized;
      },
      async update(mutator) {
        return storage.update(root => {
          const workspaces = (root.workspaces ??= {});
          const workspace = (workspaces[id] ??= {});
          const current = workspace[STATE_KEY] === undefined ? defaultState() : withDefaults(workspace[STATE_KEY]);
          validateState(current);
          const draft = structuredClone(current);
          const result = mutator(draft);
          if (draft.events.length > CHAT_LIMITS.events) draft.events.splice(0, draft.events.length - CHAT_LIMITS.events);
          validateState(draft);
          workspace[STATE_KEY] = draft;
          return result;
        });
      },
    };
  }

  function requireConversation(state, actor, id) {
    const conversation = state.conversations.find(item => item.id === id && item.workspaceId === actor.workspaceId);
    if (!conversation) fail(404, 'CHAT_CONVERSATION_NOT_FOUND', 'No such conversation in this workspace.');
    return conversation;
  }

  function requireRun(state, actor, id) {
    const run = state.runs.find(item => item.id === id && item.workspaceId === actor.workspaceId);
    if (!run) fail(404, 'CHAT_RUN_NOT_FOUND', 'No such run in this workspace.');
    return run;
  }

  function appendEvent(state, run, type, data = {}) {
    state.seq += 1;
    const event = { seq: state.seq, runId: run.id, conversationId: run.conversationId, type, at: at(), data };
    state.events.push(event);
    return event;
  }

  function emit(event) {
    for (const listener of listeners.get(event.runId) ?? []) {
      try { listener(event); } catch { /* a dead subscriber must not fail the write */ }
    }
  }

  function transition(state, run, next, { error = null } = {}) {
    const allowed = TRANSITIONS[run.status] ?? [];
    if (!allowed.includes(next))
      fail(409, 'CHAT_RUN_TRANSITION', `A run in ${run.status} cannot become ${next}.`);
    run.status = next;
    if (next === 'running' && run.startedAt === null) run.startedAt = at();
    if (TERMINAL.has(next)) run.endedAt = at();
    if (error) run.error = { code: String(error.code ?? 'CHAT_RUN_FAILED'), message: String(error.message ?? 'The run failed.').slice(0, 500) };
  }

  return Object.freeze({
    resolveActor,

    status(context) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      return {
        workspaceId: actor.workspaceId,
        conversations: state.conversations.length,
        openConversations: state.conversations.filter(item => item.status === 'open').length,
        runs: state.runs.length,
        activeRuns: state.runs.filter(item => !TERMINAL.has(item.status)).length,
        events: state.events.length,
      };
    },

    async createConversation(context, body = {}) {
      const actor = resolveActor(context);
      if (!isPlain(body)) fail(400, 'CHAT_INPUT', 'A conversation must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'title'].includes(key)))
        fail(400, 'CHAT_INPUT', 'A conversation has an unsupported field.');
      const requestId = isId(body.requestId) ? body.requestId : fail(400, 'CHAT_INPUT', 'requestId is required.');
      const title = body.title === undefined ? '\u65b0\u4f1a\u8bdd' : text(body.title, CHAT_LIMITS.title, 'title');
      const store = partition(actor.workspaceId);
      let result = null;
      await store.update(state => {
        const replay = state.receipts.find(item => item.id === requestId);
        if (replay) { result = { conversation: conversationView(requireConversation(state, actor, replay.conversationId), state), replayed: true }; return null; }
        if (state.conversations.length >= CHAT_LIMITS.conversations) fail(409, 'CHAT_FULL', 'This workspace has too many conversations.');
        const now = at();
        const conversation = {
          id: randomUUID(), workspaceId: actor.workspaceId, title, status: 'open',
          createdBy: actor.subject, createdAt: now, updatedAt: now,
        };
        state.conversations.push(conversation);
        state.receipts.push({ id: requestId, kind: 'conversation', conversationId: conversation.id, at: now });
        if (state.receipts.length > CHAT_LIMITS.receipts) state.receipts.splice(0, state.receipts.length - CHAT_LIMITS.receipts);
        result = { conversation: conversationView(conversation, state), replayed: false };
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'chat.conversation', action: 'chat.conversation.create', actor: actor.subject, ref: result.conversation.id });
      return result;
    },

    listConversations(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'open' : query.status;
      if (!['open', 'closed', 'all'].includes(status)) fail(400, 'CHAT_INPUT', 'status must be open, closed or all.');
      const limit = query.limit === undefined ? 20 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > CHAT_LIMITS.limit) fail(400, 'CHAT_INPUT', `limit must be 1-${CHAT_LIMITS.limit}.`);
      const state = partition(actor.workspaceId).read();
      const items = state.conversations
        .filter(item => item.workspaceId === actor.workspaceId)
        .filter(item => status === 'all' || item.status === status)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit)
        .map(item => conversationView(item, state));
      return { workspaceId: actor.workspaceId, status, total: items.length, items };
    },

    readConversation(context, id, query = {}) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const conversation = requireConversation(state, actor, id);
      const limit = query.messageLimit === undefined ? 100 : Number(query.messageLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail(400, 'CHAT_INPUT', 'messageLimit must be 1-500.');
      const messages = state.messages
        .filter(item => item.conversationId === conversation.id)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(-limit);
      return {
        conversation: conversationView(conversation, state),
        messages: messages.map(message => structuredClone(message)),
      };
    },

    async postMessage(context, conversationId, body = {}) {
      const actor = resolveActor(context);
      if (!isPlain(body)) fail(400, 'CHAT_INPUT', 'A message must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'content'].includes(key)))
        fail(400, 'CHAT_INPUT', 'A message has an unsupported field.');
      const requestId = isId(body.requestId) ? body.requestId : fail(400, 'CHAT_INPUT', 'requestId is required.');
      const content = text(body.content, CHAT_LIMITS.content, 'content');
      const store = partition(actor.workspaceId);
      let result = null;
      let emitted = null;
      await store.update(state => {
        const conversation = requireConversation(state, actor, conversationId);
        const replay = state.receipts.find(item => item.id === requestId);
        if (replay) {
          result = {
            message: structuredClone(state.messages.find(item => item.id === replay.messageId)),
            run: viewRun(state.runs.find(item => item.id === replay.runId)),
            replayed: true,
          };
          return null;
        }
        if (conversation.status !== 'open') fail(409, 'CHAT_CONVERSATION_CLOSED', 'This conversation is closed.');
        if (state.messages.filter(item => item.conversationId === conversationId).length >= CHAT_LIMITS.messagesPerConversation)
          fail(409, 'CHAT_FULL', 'This conversation has too many messages.');
        if (state.messages.length >= CHAT_LIMITS.messages) fail(409, 'CHAT_FULL', 'This workspace has too many messages.');
        if (state.runs.length >= CHAT_LIMITS.runs) fail(409, 'CHAT_FULL', 'This workspace has too many runs.');
        const now = at();
        const message = {
          id: randomUUID(), conversationId, workspaceId: actor.workspaceId,
          role: 'user', content, runId: null, createdBy: actor.subject, createdAt: now,
        };
        const run = {
          id: randomUUID(), conversationId, workspaceId: actor.workspaceId,
          status: 'prepared', requestedBy: actor.subject,
          createdAt: now, startedAt: null, endedAt: null, cancelRequestedAt: null,
          error: null, usage: null, model: null,
          snapshot: { messageId: message.id, memory: null, artifacts: [], skills: [] },
        };
        message.runId = run.id;
        state.messages.push(message);
        state.runs.push(run);
        const event = appendEvent(state, run, 'run.prepared', { messageId: message.id });
        state.receipts.push({ id: requestId, kind: 'message', conversationId, messageId: message.id, runId: run.id, at: now });
        if (state.receipts.length > CHAT_LIMITS.receipts) state.receipts.splice(0, state.receipts.length - CHAT_LIMITS.receipts);
        conversation.updatedAt = now;
        result = { message: structuredClone(message), run: viewRun(run), replayed: false };
        emitted = event;
        return null;
      });
      if (emitted) emit(emitted);
      if (audit?.record) await audit.record({ kind: 'chat.message', action: 'chat.message.post', actor: actor.subject, ref: result.run.id, detail: { conversationId } });
      return result;
    },

    readRun(context, id) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      return viewRun(requireRun(state, actor, id));
    },

    async cancelRun(context, id, body = {}) {
      const actor = resolveActor(context);
      if (!isPlain(body) || Object.keys(body).some(key => !['requestId', 'reason'].includes(key)))
        fail(400, 'CHAT_INPUT', 'A cancellation has an unsupported field.');
      const reason = body.reason === undefined ? null : text(body.reason, 500, 'reason', { empty: true });
      const store = partition(actor.workspaceId);
      let result = null;
      let emitted = null;
      await store.update(state => {
        const run = requireRun(state, actor, id);
        if (TERMINAL.has(run.status)) { result = { run: viewRun(run), replayed: true }; return null; }
        run.cancelRequestedAt = at();
        transition(state, run, 'cancelled');
        const event = appendEvent(state, run, 'run.cancelled', { reason });
        result = { run: viewRun(run), replayed: false };
        emitted = event;
        return null;
      });
      if (emitted) emit(emitted);
      if (audit?.record) await audit.record({ kind: 'chat.run', action: 'chat.run.cancel', actor: actor.subject, ref: id });
      return result;
    },

    /**
     * Runner-facing transitions. The runner is a separate module mounted on
     * this service; it may start, block, resume, complete or fail a run, but it
     * goes through the same transition table and event log as cancellation.
     */
    async advance(context, id, next, { error = null, usage = null, model = null } = {}) {
      const actor = resolveActor(context);
      const store = partition(actor.workspaceId);
      let result = null;
      let emitted = null;
      await store.update(state => {
        const run = requireRun(state, actor, id);
        transition(state, run, next, { error });
        if (usage !== null) run.usage = usage;
        if (model !== null) run.model = model;
        const event = appendEvent(state, run, `run.${next}`, error ? { code: error.code } : {});
        result = { run: viewRun(run), replayed: false };
        emitted = event;
        return null;
      });
      if (emitted) emit(emitted);
      return result;
    },

    /** Append an assistant/system message produced by a run. */
    async appendMessage(context, runId, { role = 'assistant', content } = {}) {
      const actor = resolveActor(context);
      if (!['assistant', 'system'].includes(role)) fail(400, 'CHAT_INPUT', 'Only assistant and system messages may be appended.');
      const value = text(content, CHAT_LIMITS.content, 'content');
      const store = partition(actor.workspaceId);
      let message = null;
      await store.update(state => {
        const run = requireRun(state, actor, runId);
        message = {
          id: randomUUID(), conversationId: run.conversationId, workspaceId: actor.workspaceId,
          role, content: value, runId, createdBy: 'run', createdAt: at(),
        };
        state.messages.push(message);
        const conversation = state.conversations.find(item => item.id === run.conversationId);
        if (conversation) conversation.updatedAt = message.createdAt;
        return null;
      });
      return structuredClone(message);
    },

    readEvents(context, runId, after = 0) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const run = requireRun(state, actor, runId);
      const events = state.events.filter(event => event.runId === runId && event.seq > after);
      return { run: viewRun(run), events: events.map(event => structuredClone(event)) };
    },

    /** Subscribe to live events for one run; returns an unsubscribe function. */
    subscribe(runId, listener) {
      if (!listeners.has(runId)) listeners.set(runId, new Set());
      listeners.get(runId).add(listener);
      return () => {
        const set = listeners.get(runId);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) listeners.delete(runId);
      };
    },
  });
}
