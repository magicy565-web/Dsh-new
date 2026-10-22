// Goal domain: a durable, inspectable objective that groups runs.
//
// A goal is not a second run engine: it records intent, state and the runs the
// chat substrate already owns. Status changes are explicit, audited and
// one-way where the product says so (done/cancelled are terminal).
import { randomUUID } from 'node:crypto';

export const GOAL_STATE_VERSION = 1;
const STATE_KEY = 'harnessGoals';

export const GOAL_STATUSES = Object.freeze(['open', 'active', 'blocked', 'done', 'cancelled']);
const TERMINAL = new Set(['done', 'cancelled']);
const TRANSITIONS = Object.freeze({
  open: Object.freeze(['active', 'cancelled']),
  active: Object.freeze(['blocked', 'done', 'cancelled']),
  blocked: Object.freeze(['active', 'cancelled']),
  done: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export const GOAL_LIMITS = Object.freeze({
  goals: 1_000, receipts: 2_000, title: 200, description: 4_000, note: 500, id: 128,
});

export class GoalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'GoalError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new GoalError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function text(value, max, name, { empty = false } = {}) {
  if (typeof value !== 'string') fail(400, 'GOAL_INPUT', `${name} must be a string.`);
  if (!empty && !value.trim()) fail(400, 'GOAL_INPUT', `${name} must not be empty.`);
  if (value.length > max) fail(400, 'GOAL_INPUT', `${name} exceeds ${max} characters.`);
  return value;
}

const defaultState = () => ({ version: GOAL_STATE_VERSION, goals: [], receipts: [] });

function validateState(value) {
  if (!isPlain(value) || value.version !== GOAL_STATE_VERSION
    || !Array.isArray(value.goals) || !Array.isArray(value.receipts)
    || value.goals.length > GOAL_LIMITS.goals || value.receipts.length > GOAL_LIMITS.receipts)
    fail(500, 'GOAL_INVALID', 'Stored goals are invalid or full.');
  const ids = new Set();
  for (const goal of value.goals) {
    if (!isPlain(goal) || typeof goal.id !== 'string' || !UUID.test(goal.id)
      || typeof goal.workspaceId !== 'string' || !goal.workspaceId
      || typeof goal.title !== 'string' || !goal.title || goal.title.length > GOAL_LIMITS.title
      || typeof goal.description !== 'string' || goal.description.length > GOAL_LIMITS.description
      || !GOAL_STATUSES.includes(goal.status)
      || typeof goal.createdBy !== 'string' || !isIso(goal.createdAt) || !isIso(goal.updatedAt)
      || (goal.closedAt !== null && !isIso(goal.closedAt)))
      fail(500, 'GOAL_INVALID', 'Stored goal is invalid.');
    if (ids.has(goal.id)) fail(500, 'GOAL_INVALID', 'Duplicate goal id.');
    ids.add(goal.id);
  }
  return true;
}

function withDefaults(value) {
  if (!isPlain(value) || value.version !== GOAL_STATE_VERSION) return value;
  return { ...value, receipts: value.receipts ?? [] };
}

function view(goal) {
  return { ...structuredClone(goal), terminal: TERMINAL.has(goal.status) };
}

/**
 * @param {object} options
 * @param {object} options.storage harness storage seam
 * @param {string} [options.workspaceId]
 * @param {Function|null} [options.resolveWorkspace]
 * @param {object|null} [options.chat] chat service, used to list a goal's runs
 * @param {Function} [options.clock]
 * @param {object|null} [options.audit]
 */
export function createGoalService({ storage, workspaceId = 'local', resolveWorkspace = null, chat = null, clock = Date.now, audit = null } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Goals require the harness storage seam.');
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('Goals require an exact workspace id.');

  const at = () => new Date(clock()).toISOString();

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'GOAL_SESSION_REQUIRED', 'A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
        fail(403, 'GOAL_WORKSPACE_REQUIRED', 'The workspace could not be resolved.');
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    const id = input.workspaceId ?? workspaceId;
    if (id !== workspaceId) fail(403, 'GOAL_FORBIDDEN', 'These goals belong to another workspace.');
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
          validateState(draft);
          workspace[STATE_KEY] = draft;
          return result;
        });
      },
    };
  }

  function requireGoal(state, actor, id) {
    const goal = state.goals.find(item => item.id === id && item.workspaceId === actor.workspaceId);
    if (!goal) fail(404, 'GOAL_NOT_FOUND', 'No such goal in this workspace.');
    return goal;
  }

  function runsFor(goal) {
    if (!chat || typeof chat.listRunsByGoal !== 'function') return { total: 0, items: [] };
    try {
      const result = chat.listRunsByGoal({ actor: { subject: 'service:goals', role: 'operator', workspaceId }, trustedService: true }, goal.id, { limit: 50 });
      return {
        total: result.total,
        items: result.items.map(run => ({
          id: run.id, status: run.status, createdAt: run.createdAt, endedAt: run.endedAt,
          error: run.error ? run.error.code : null,
        })),
      };
    } catch {
      return { total: 0, items: [], warning: 'GOAL_RUNS_UNAVAILABLE' };
    }
  }

  return Object.freeze({
    resolveActor,

    status(context) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const byStatus = Object.fromEntries(GOAL_STATUSES.map(status => [status, 0]));
      for (const goal of state.goals) byStatus[goal.status] = (byStatus[goal.status] ?? 0) + 1;
      return { workspaceId: actor.workspaceId, total: state.goals.length, byStatus };
    },

    async create(context, body = {}) {
      const actor = resolveActor(context);
      if (!isPlain(body)) fail(400, 'GOAL_INPUT', 'A goal must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'title', 'description'].includes(key)))
        fail(400, 'GOAL_INPUT', 'A goal has an unsupported field.');
      if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > GOAL_LIMITS.id)
        fail(400, 'GOAL_INPUT', 'requestId is required.');
      const title = text(body.title, GOAL_LIMITS.title, 'title');
      const description = body.description === undefined ? '' : text(body.description, GOAL_LIMITS.description, 'description', { empty: true });
      const store = partition(actor.workspaceId);
      let goal = null;
      let replayed = false;
      await store.update(state => {
        const previous = state.receipts.find(item => item.id === body.requestId);
        if (previous) {
          goal = view(requireGoal(state, actor, previous.goalId));
          replayed = true;
          return null;
        }
        if (state.goals.length >= GOAL_LIMITS.goals) fail(409, 'GOAL_FULL', 'This workspace has too many goals.');
        const now = at();
        const created = {
          id: randomUUID(), workspaceId: actor.workspaceId, title, description,
          status: 'open', createdBy: actor.subject, createdAt: now, updatedAt: now, closedAt: null,
        };
        state.goals.push(created);
        state.receipts.push({ id: body.requestId, goalId: created.id, at: now });
        if (state.receipts.length > GOAL_LIMITS.receipts) state.receipts.splice(0, state.receipts.length - GOAL_LIMITS.receipts);
        goal = view(created);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'goals', action: 'goals.create', actor: actor.subject, ref: goal.id });
      return { goal, replayed };
    },

    list(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'all' : query.status;
      if (!['all', ...GOAL_STATUSES].includes(status)) fail(400, 'GOAL_INPUT', 'status is invalid.');
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail(400, 'GOAL_INPUT', 'limit must be 1-200.');
      const state = partition(actor.workspaceId).read();
      const items = state.goals
        .filter(goal => goal.workspaceId === actor.workspaceId)
        .filter(goal => status === 'all' || goal.status === status)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit)
        .map(view);
      return { workspaceId: actor.workspaceId, status, total: items.length, items };
    },

    get(context, id) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const goal = requireGoal(state, actor, id);
      return { goal: view(goal), runs: runsFor(goal) };
    },

    async setStatus(context, id, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'GOAL_FORBIDDEN', 'A viewer cannot change a goal.');
      if (!isPlain(body)) fail(400, 'GOAL_INPUT', 'A status change must be an object.');
      if (Object.keys(body).some(key => !['status', 'note'].includes(key)))
        fail(400, 'GOAL_INPUT', 'A status change has an unsupported field.');
      const next = body.status;
      if (!GOAL_STATUSES.includes(next)) fail(400, 'GOAL_INPUT', 'status is invalid.');
      const note = body.note === undefined ? null : text(body.note, GOAL_LIMITS.note, 'note', { empty: true });
      const store = partition(actor.workspaceId);
      let goal = null;
      await store.update(state => {
        const current = requireGoal(state, actor, id);
        const allowed = TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(next))
          fail(409, 'GOAL_TRANSITION', `A goal in ${current.status} cannot become ${next}.`);
        current.status = next;
        current.updatedAt = at();
        if (TERMINAL.has(next)) current.closedAt = current.updatedAt;
        if (note !== null) current.note = note;
        goal = view(current);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'goals', action: 'goals.status', actor: actor.subject, ref: id, detail: { status: next } });
      return { goal };
    },
  });
}
