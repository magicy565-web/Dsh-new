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
export const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'denied', 'expired']);
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
  runs: 5_000, events: 20_000, receipts: 10_000, approvals: 2_000,
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
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function text(value, max, name, { empty = false } = {}) {
  if (typeof value !== 'string') fail(400, 'CHAT_INPUT', `${name} must be a string.`);
  const trimmed = value.trim();
  if (!empty && !trimmed) fail(400, 'CHAT_INPUT', `${name} must not be empty.`);
  if (value.length > max) fail(400, 'CHAT_INPUT', `${name} exceeds ${max} characters.`);
  return value;
}

const defaultState = () => ({
  version: STATE_VERSION, seq: 0,
  conversations: [], messages: [], runs: [], events: [], receipts: [], approvals: [],
});

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

/** Bound what a single message may attach as run context. */
function validateSelection(selection) {
  if (selection === undefined) return { skills: [], artifacts: [] };
  if (!isPlain(selection)) fail(400, 'CHAT_INPUT', 'selection must be an object.');
  if (Object.keys(selection).some(key => !['skills', 'artifacts'].includes(key)))
    fail(400, 'CHAT_INPUT', 'selection has an unsupported field.');
  const skills = selection.skills === undefined ? [] : selection.skills;
  if (!Array.isArray(skills) || skills.length > 8)
    fail(400, 'CHAT_INPUT', 'selection.skills must be an array of at most 8 names.');
  const seen = new Set();
  for (const name of skills) {
    if (typeof name !== 'string' || !SKILL_NAME.test(name))
      fail(400, 'CHAT_INPUT', 'A selected skill name is invalid.');
    if (seen.has(name)) fail(400, 'CHAT_INPUT', 'A skill is selected more than once.');
    seen.add(name);
  }
  const artifacts = selection.artifacts === undefined ? [] : selection.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length > 4)
    fail(400, 'CHAT_INPUT', 'selection.artifacts must be an array of at most 4 ids.');
  const artifactSeen = new Set();
  for (const id of artifacts) {
    if (typeof id !== 'string' || !UUID.test(id))
      fail(400, 'CHAT_INPUT', 'A selected artifact id is invalid.');
    if (artifactSeen.has(id)) fail(400, 'CHAT_INPUT', 'A file is selected more than once.');
    artifactSeen.add(id);
  }
  return { skills: [...skills], artifacts: [...artifacts] };
}

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
    || !Array.isArray(value.approvals)
    || !Number.isSafeInteger(value.seq) || value.seq < 0
    || value.conversations.length > CHAT_LIMITS.conversations
    || value.messages.length > CHAT_LIMITS.messages
    || value.runs.length > CHAT_LIMITS.runs
    || value.events.length > CHAT_LIMITS.events
    || value.receipts.length > CHAT_LIMITS.receipts
    || value.approvals.length > CHAT_LIMITS.approvals)
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
  const approvalIds = new Set();
  for (const approval of value.approvals) {
    if (!isPlain(approval) || !isId(approval.id) || !runIds.has(approval.runId)
      || !conversationIds.has(approval.conversationId)
      || typeof approval.action !== 'string' || !approval.action || approval.action.length > 120
      || typeof approval.resource !== 'string' || approval.resource.length > 300
      || !isPlain(approval.payload) || !APPROVAL_STATUSES.includes(approval.status)
      || typeof approval.requestedBy !== 'string' || !isIso(approval.requestedAt)
      || (approval.decidedBy !== null && typeof approval.decidedBy !== 'string')
      || (approval.decidedByRole !== null && typeof approval.decidedByRole !== 'string')
      || (approval.decidedAt !== null && !isIso(approval.decidedAt))
      || (approval.note !== null && typeof approval.note !== 'string')
      || (approval.expiresAt !== null && !isIso(approval.expiresAt))
      || (approval.ticketId !== null && typeof approval.ticketId !== 'string'))
      fail(500, 'CHAT_INVALID', 'Stored chat approval is invalid.');
    if (approvalIds.has(approval.id)) fail(500, 'CHAT_INVALID', 'Duplicate chat approval id.');
    approvalIds.add(approval.id);
  }
  return true;
}

function withDefaults(value) {
  if (!isPlain(value) || value.version !== STATE_VERSION) return value;
  return {
    ...value,
    seq: value.seq ?? 0,
    receipts: value.receipts ?? [],
    approvals: value.approvals ?? [],
  };
}

function viewRun(run) {
  return { ...structuredClone(run), terminal: TERMINAL.has(run.status) };
}

function viewApproval(approval, now = Date.now()) {
  const expired = approval.status === 'pending' && approval.expiresAt !== null && Date.parse(approval.expiresAt) <= now;
  return { ...structuredClone(approval), status: expired ? 'expired' : approval.status, expired };
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
  const preparedListeners = new Set();

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'CHAT_SESSION_REQUIRED', 'A current harness actor is required.');
    // The runner is an in-process service authenticated by the plugin graph,
    // not a user session. It is still bound to this exact workspace.
    if (context?.trustedService === true) {
      if (input.workspaceId !== workspaceId)
        fail(403, 'CHAT_FORBIDDEN', 'This service is bound to another workspace.');
      return { workspaceId, subject: input.subject, role: input.role };
    }
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
      if (Object.keys(body).some(key => !['requestId', 'content', 'selection'].includes(key)))
        fail(400, 'CHAT_INPUT', 'A message has an unsupported field.');
      const requestId = isId(body.requestId) ? body.requestId : fail(400, 'CHAT_INPUT', 'requestId is required.');
      const content = text(body.content, CHAT_LIMITS.content, 'content');
      const selection = validateSelection(body.selection);
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
          snapshot: { messageId: message.id, memory: null, artifacts: selection.artifacts, skills: selection.skills },
          selection,
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
      for (const listener of preparedListeners) {
        try { listener({ runId: result.run.id, conversationId, messageId: result.message.id }); } catch { /* a runner must not fail the write */ }
      }
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

    /**
     * Runner-only: pin exactly what the model received (skill names + body
     * hashes, memory revision, artifact versions) onto the run. This is the
     * audit record of the context, not a second copy of its content.
     */
    async recordContext(context, runId, patch = {}) {
      if (context?.trustedService !== true)
        fail(403, 'CHAT_CONTEXT_RUNNER_ONLY', 'Only the run executor may record run context.');
      if (!isPlain(patch)) fail(400, 'CHAT_INPUT', 'A context record must be an object.');
      if (Object.keys(patch).some(key => !['skills', 'memory', 'artifacts', 'contextChars', 'warnings'].includes(key)))
        fail(400, 'CHAT_INPUT', 'A context record has an unsupported field.');
      if (patch.skills !== undefined && (!Array.isArray(patch.skills) || patch.skills.length > 8
        || patch.skills.some(item => !isPlain(item) || typeof item.name !== 'string' || !SKILL_NAME.test(item.name)
          || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256))))
        fail(400, 'CHAT_INPUT', 'context.skills must be pinned name + sha256 entries.');
      const store = partition(workspaceId);
      let emitted = null;
      await store.update(state => {
        const run = requireRun(state, { workspaceId, subject: 'service:runner', role: 'operator' }, runId);
        run.snapshot = { ...run.snapshot, ...structuredClone(patch) };
        emitted = appendEvent(state, run, 'run.context_ready', { skills: patch.skills?.length ?? 0 });
        return null;
      });
      if (emitted) emit(emitted);
      return structuredClone(emitted?.data ?? {});
    },

    /**
     * Runner-only: attach the files a run produced to the run, so the answer,
     * the artifact and the download link stay one record.
     */
    async recordOutputs(context, runId, outputs) {
      if (context?.trustedService !== true)
        fail(403, 'CHAT_OUTPUT_RUNNER_ONLY', 'Only the run executor may record run outputs.');
      if (!Array.isArray(outputs) || outputs.length === 0 || outputs.length > 10
        || outputs.some(item => !isPlain(item) || typeof item.id !== 'string' || !UUID.test(item.id)
          || typeof item.filename !== 'string' || !item.filename || item.filename.length > 200
          || !Number.isSafeInteger(item.version) || item.version < 1
          || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)))
        fail(400, 'CHAT_INPUT', 'outputs must be bounded artifact records (id, filename, version, sha256).');
      const store = partition(workspaceId);
      let emitted = null;
      await store.update(state => {
        const run = requireRun(state, { workspaceId, subject: 'service:runner', role: 'operator' }, runId);
        const existing = Array.isArray(run.snapshot.outputs) ? run.snapshot.outputs : [];
        const merged = [...existing];
        for (const output of outputs) {
          if (!merged.some(item => item.id === output.id)) merged.push(structuredClone(output));
        }
        run.snapshot = { ...run.snapshot, outputs: merged.slice(-10) };
        emitted = appendEvent(state, run, 'run.output_created', { outputs: structuredClone(outputs) });
        return null;
      });
      if (emitted) emit(emitted);
      return structuredClone(emitted?.data ?? {});
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

    /** Append a runner-owned observation (a warning, a tool note) to the run log. */
    async note(context, runId, type, data = {}) {
      const actor = resolveActor(context);
      if (typeof type !== 'string' || !/^run\.[a-z][a-z0-9_.-]{0,59}$/u.test(type))
        fail(400, 'CHAT_INPUT', 'A run event type must look like run.<name>.');
      if (!isPlain(data)) fail(400, 'CHAT_INPUT', 'Run event data must be an object.');
      const store = partition(actor.workspaceId);
      let emitted = null;
      await store.update(state => {
        const run = requireRun(state, actor, runId);
        if (TERMINAL.has(run.status)) return null;
        emitted = appendEvent(state, run, type, data);
        return null;
      });
      if (!emitted) return null;
      emit(emitted);
      return structuredClone(emitted);
    },

    /**
     * Runner-only: block the run and ask a human to approve one exact action.
     * The scope (action, resource, payload) is what the human sees; the run
     * cannot continue until this approval is decided.
     */
    async requestApproval(context, runId, body = {}) {
      const actor = resolveActor(context);
      if (context?.trustedService !== true)
        fail(403, 'CHAT_APPROVAL_RUNNER_ONLY', 'Only the run executor may request an approval.');
      if (!isPlain(body)) fail(400, 'CHAT_INPUT', 'An approval request must be an object.');
      if (Object.keys(body).some(key => !['action', 'resource', 'payload', 'ticketId', 'reason', 'ttlSeconds'].includes(key)))
        fail(400, 'CHAT_INPUT', 'An approval request has an unsupported field.');
      const action = text(body.action, 120, 'action');
      const resource = text(body.resource, 300, 'resource');
      if (!isPlain(body.payload)) fail(400, 'CHAT_INPUT', 'payload must be an object.');
      if (JSON.stringify(body.payload).length > 8_000) fail(400, 'CHAT_INPUT', 'payload is too large.');
      const ticketId = body.ticketId === undefined ? null : text(body.ticketId, 128, 'ticketId', { empty: true });
      const reason = body.reason === undefined ? null : text(body.reason, 500, 'reason', { empty: true });
      const ttlSeconds = body.ttlSeconds === undefined ? 300 : body.ttlSeconds;
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3_600)
        fail(400, 'CHAT_INPUT', 'ttlSeconds must be an integer between 30 and 3600.');
      const store = partition(actor.workspaceId);
      let result = null;
      let emitted = null;
      const now = clock();
      await store.update(state => {
        const run = requireRun(state, actor, runId);
        if (run.status !== 'running')
          fail(409, 'CHAT_RUN_STATE', `A run in ${run.status} cannot request an approval.`);
        if (state.approvals.length >= CHAT_LIMITS.approvals) fail(409, 'CHAT_FULL', 'This workspace has too many approvals.');
        const approval = {
          id: randomUUID(), runId, conversationId: run.conversationId, workspaceId: actor.workspaceId,
          action, resource, payload: structuredClone(body.payload), ticketId, reason,
          status: 'pending', requestedBy: actor.subject, requestedAt: at(),
          decidedBy: null, decidedByRole: null, decidedAt: null, note: null,
          expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
        };
        state.approvals.push(approval);
        transition(state, run, 'blocked');
        emitted = appendEvent(state, run, 'run.approval_requested', {
          approvalId: approval.id, action, resource, expiresAt: approval.expiresAt,
        });
        result = viewApproval(approval, now);
        return null;
      });
      if (emitted) emit(emitted);
      if (audit?.record) await audit.record({ kind: 'chat.approval', action: 'chat.approval.request', actor: actor.subject, ref: result.id });
      return result;
    },

    /** Human decision. Approving resumes the run; denying fails it. */
    async decideApproval(context, approvalId, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'CHAT_APPROVAL_FORBIDDEN', 'A viewer cannot decide an approval.');
      if (!isPlain(body)) fail(400, 'CHAT_INPUT', 'An approval decision must be an object.');
      if (Object.keys(body).some(key => !['decision', 'note'].includes(key)))
        fail(400, 'CHAT_INPUT', 'An approval decision has an unsupported field.');
      if (!['approve', 'deny'].includes(body.decision))
        fail(400, 'CHAT_INPUT', 'decision must be approve or deny.');
      const note = body.note === undefined ? null : text(body.note, 500, 'note', { empty: true });
      const store = partition(actor.workspaceId);
      let result = null;
      let emitted = null;
      const now = clock();
      await store.update(state => {
        const approval = state.approvals.find(item => item.id === approvalId && item.workspaceId === actor.workspaceId);
        if (!approval) fail(404, 'CHAT_APPROVAL_NOT_FOUND', 'No such approval in this workspace.');
        if (approval.status !== 'pending') fail(409, 'CHAT_APPROVAL_CLOSED', 'This approval is already decided.');
        if (approval.expiresAt !== null && Date.parse(approval.expiresAt) <= now) {
          approval.status = 'expired';
          fail(409, 'CHAT_APPROVAL_EXPIRED', 'This approval expired before a decision.');
        }
        const run = state.runs.find(item => item.id === approval.runId);
        approval.status = body.decision === 'approve' ? 'approved' : 'denied';
        approval.decidedBy = actor.subject;
        approval.decidedByRole = actor.role;
        approval.decidedAt = at();
        approval.note = note;
        if (body.decision === 'approve') {
          if (run && run.status === 'blocked') transition(state, run, 'running');
          emitted = appendEvent(state, run, 'run.approval_decided', { approvalId, approved: true });
        } else {
          if (run && run.status === 'blocked')
            transition(state, run, 'failed', { error: { code: 'APPROVAL_DENIED', message: 'A required action was denied.' } });
          emitted = appendEvent(state, run, 'run.approval_decided', { approvalId, approved: false });
        }
        result = viewApproval(approval, now);
        return null;
      });
      if (emitted) emit(emitted);
      if (audit?.record) await audit.record({ kind: 'chat.approval', action: 'chat.approval.decide', actor: actor.subject, ref: approvalId, ok: body.decision === 'approve' });
      return result;
    },

    listApprovals(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'pending' : query.status;
      if (!['pending', 'approved', 'denied', 'expired', 'all'].includes(status))
        fail(400, 'CHAT_INPUT', 'status must be pending, approved, denied, expired or all.');
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail(400, 'CHAT_INPUT', 'limit must be 1-200.');
      const conversationId = query.conversationId === undefined ? null : text(query.conversationId, CHAT_LIMITS.id, 'conversationId');
      const now = clock();
      const state = partition(actor.workspaceId).read();
      const items = state.approvals
        .filter(item => item.workspaceId === actor.workspaceId)
        .filter(item => conversationId === null || item.conversationId === conversationId)
        .map(item => viewApproval(item, now))
        .filter(item => status === 'all' || item.status === status)
        .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
        .slice(0, limit);
      return { workspaceId: actor.workspaceId, status, total: items.length, items };
    },

    readApproval(context, id) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const approval = state.approvals.find(item => item.id === id && item.workspaceId === actor.workspaceId);
      if (!approval) fail(404, 'CHAT_APPROVAL_NOT_FOUND', 'No such approval in this workspace.');
      return viewApproval(approval, clock());
    },

    /**
     * Runner-side wait. Resolves with the decided (or expired) approval; a run
     * cancellation aborts the wait so the executor stops holding a slot.
     */
    async waitForApproval(approvalId, { timeoutMs = 300_000, signal = null } = {}) {
      const store = partition(workspaceId);
      const deadline = clock() + timeoutMs;
      for (;;) {
        if (signal?.aborted) fail(409, 'CHAT_APPROVAL_ABORTED', 'The run was stopped while waiting for a decision.');
        const state = store.read();
        const approval = state.approvals.find(item => item.id === approvalId);
        if (!approval) fail(404, 'CHAT_APPROVAL_NOT_FOUND', 'No such approval in this workspace.');
        const view = viewApproval(approval, clock());
        if (view.status !== 'pending') return view;
        if (clock() >= deadline) fail(409, 'CHAT_APPROVAL_TIMEOUT', 'The approval was not decided in time.');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
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

    /**
     * In-process hook for the runner: every prepared run is announced once.
     * The listener runs after the commit, so it can read the run immediately.
     */
    onPrepared(listener) {
      if (typeof listener !== 'function') throw new TypeError('onPrepared requires a function.');
      preparedListeners.add(listener);
      return () => preparedListeners.delete(listener);
    },
  });
}
