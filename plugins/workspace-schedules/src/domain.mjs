// Schedule domain: turn a goal into work that happens on its own.
//
// A schedule never invents a second execution path. A due schedule posts a
// message into the bound conversation, and the existing chat → runner pipeline
// does the rest. The dispatch requestId derives from (schedule, dueAt), so a
// restart or a repeated tick replays the same run instead of duplicating it.
import { randomUUID } from 'node:crypto';

export const SCHEDULE_STATE_VERSION = 1;
const STATE_KEY = 'harnessSchedules';

export const SCHEDULE_STATUSES = Object.freeze(['enabled', 'disabled', 'done', 'blocked']);
export const SCHEDULE_KINDS = Object.freeze(['at', 'every']);
const MIN_EVERY_SECONDS = 60;
const MAX_EVERY_SECONDS = 31_536_000;

export const SCHEDULE_LIMITS = Object.freeze({
  schedules: 200, receipts: 2_000, title: 200, prompt: 2_000, note: 500, id: 200,
});

export class ScheduleError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ScheduleError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new ScheduleError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function text(value, max, name, { empty = false } = {}) {
  if (typeof value !== 'string') fail(400, 'SCHEDULE_INPUT', `${name} must be a string.`);
  if (!empty && !value.trim()) fail(400, 'SCHEDULE_INPUT', `${name} must not be empty.`);
  if (value.length > max) fail(400, 'SCHEDULE_INPUT', `${name} exceeds ${max} characters.`);
  return value;
}

const defaultState = () => ({ version: SCHEDULE_STATE_VERSION, schedules: [], receipts: [] });

function validateState(value) {
  if (!isPlain(value) || value.version !== SCHEDULE_STATE_VERSION
    || !Array.isArray(value.schedules) || !Array.isArray(value.receipts)
    || value.schedules.length > SCHEDULE_LIMITS.schedules || value.receipts.length > SCHEDULE_LIMITS.receipts)
    fail(500, 'SCHEDULE_INVALID', 'Stored schedules are invalid or full.');
  const ids = new Set();
  for (const schedule of value.schedules) {
    if (!isPlain(schedule) || typeof schedule.id !== 'string' || !UUID.test(schedule.id)
      || typeof schedule.workspaceId !== 'string' || !schedule.workspaceId
      || typeof schedule.title !== 'string' || !schedule.title || schedule.title.length > SCHEDULE_LIMITS.title
      || typeof schedule.prompt !== 'string' || !schedule.prompt || schedule.prompt.length > SCHEDULE_LIMITS.prompt
      || typeof schedule.conversationId !== 'string' || !UUID.test(schedule.conversationId)
      || (schedule.goalId !== null && !UUID.test(schedule.goalId))
      || !SCHEDULE_KINDS.includes(schedule.kind) || !SCHEDULE_STATUSES.includes(schedule.status)
      || !isIso(schedule.createdAt) || !isIso(schedule.updatedAt)
      || (schedule.nextAt !== null && !isIso(schedule.nextAt))
      || (schedule.at !== null && !isIso(schedule.at))
      || (schedule.everySeconds !== null && (!Number.isInteger(schedule.everySeconds) || schedule.everySeconds < MIN_EVERY_SECONDS)))
      fail(500, 'SCHEDULE_INVALID', 'Stored schedule is invalid.');
    if (ids.has(schedule.id)) fail(500, 'SCHEDULE_INVALID', 'Duplicate schedule id.');
    ids.add(schedule.id);
  }
  for (const receipt of value.receipts) {
    if (!isPlain(receipt) || typeof receipt.scheduleId !== 'string' || !isIso(receipt.at)
      || typeof receipt.dispatchId !== 'string' || !receipt.dispatchId || receipt.dispatchId.length > 200
      || (receipt.dueAt !== null && receipt.dueAt !== undefined && !isIso(receipt.dueAt))
      || (receipt.runId !== undefined && receipt.runId !== null && typeof receipt.runId !== 'string')
      || (receipt.requestId !== undefined && typeof receipt.requestId !== 'string'))
      fail(500, 'SCHEDULE_INVALID', 'Stored schedule receipt is invalid.');
  }
  return true;
}

function withDefaults(value) {
  if (!isPlain(value) || value.version !== SCHEDULE_STATE_VERSION) return value;
  return { ...value, receipts: value.receipts ?? [] };
}

function view(schedule) {
  return { ...structuredClone(schedule) };
}

/**
 * @param {object} options
 * @param {object} options.storage harness storage seam
 * @param {object} options.chat chat service, used to dispatch a due schedule
 * @param {string} [options.workspaceId]
 * @param {Function|null} [options.resolveWorkspace]
 * @param {Function} [options.clock]
 * @param {object|null} [options.audit]
 */
export function createScheduleService({ storage, chat, workspaceId = 'local', resolveWorkspace = null, clock = Date.now, audit = null } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Schedules require the harness storage seam.');
  if (!chat || typeof chat.postMessage !== 'function')
    throw new TypeError('Schedules require the chat service to dispatch work.');
  const at = () => new Date(clock()).toISOString();
  let ticking = false;

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'SCHEDULE_SESSION_REQUIRED', 'A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
        fail(403, 'SCHEDULE_WORKSPACE_REQUIRED', 'The workspace could not be resolved.');
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    const id = input.workspaceId ?? workspaceId;
    if (id !== workspaceId) fail(403, 'SCHEDULE_FORBIDDEN', 'These schedules belong to another workspace.');
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
          if (draft.receipts.length > SCHEDULE_LIMITS.receipts) draft.receipts.splice(0, draft.receipts.length - SCHEDULE_LIMITS.receipts);
          validateState(draft);
          workspace[STATE_KEY] = draft;
          return result;
        });
      },
    };
  }

  function requireSchedule(state, actor, id) {
    const schedule = state.schedules.find(item => item.id === id && item.workspaceId === actor.workspaceId);
    if (!schedule) fail(404, 'SCHEDULE_NOT_FOUND', 'No such schedule in this workspace.');
    return schedule;
  }

  return Object.freeze({
    resolveActor,

    status(context) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const byStatus = Object.fromEntries(SCHEDULE_STATUSES.map(status => [status, 0]));
      for (const schedule of state.schedules) byStatus[schedule.status] = (byStatus[schedule.status] ?? 0) + 1;
      return { workspaceId: actor.workspaceId, total: state.schedules.length, byStatus };
    },

    async create(context, body = {}) {
      const actor = resolveActor(context);
      if (!isPlain(body)) fail(400, 'SCHEDULE_INPUT', 'A schedule must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'title', 'prompt', 'conversationId', 'goalId', 'kind', 'at', 'everySeconds'].includes(key)))
        fail(400, 'SCHEDULE_INPUT', 'A schedule has an unsupported field.');
      if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > SCHEDULE_LIMITS.id)
        fail(400, 'SCHEDULE_INPUT', 'requestId is required.');
      const title = text(body.title, SCHEDULE_LIMITS.title, 'title');
      const prompt = text(body.prompt, SCHEDULE_LIMITS.prompt, 'prompt');
      if (typeof body.conversationId !== 'string' || !UUID.test(body.conversationId))
        fail(400, 'SCHEDULE_INPUT', 'conversationId must be a conversation id.');
      const goalId = body.goalId === undefined || body.goalId === null ? null : body.goalId;
      if (goalId !== null && (typeof goalId !== 'string' || !UUID.test(goalId)))
        fail(400, 'SCHEDULE_INPUT', 'goalId must be a goal id.');
      if (!SCHEDULE_KINDS.includes(body.kind)) fail(400, 'SCHEDULE_INPUT', 'kind must be at or every.');
      const now = clock();
      let scheduleAt = null;
      let everySeconds = null;
      let nextAt = null;
      if (body.kind === 'at') {
        if (typeof body.at !== 'string' || !isIso(body.at)) fail(400, 'SCHEDULE_INPUT', 'at must be an ISO instant.');
        if (Date.parse(body.at) <= now) fail(400, 'SCHEDULE_INPUT', 'at must be in the future.');
        scheduleAt = new Date(Date.parse(body.at)).toISOString();
        nextAt = scheduleAt;
      } else {
        if (!Number.isInteger(body.everySeconds) || body.everySeconds < MIN_EVERY_SECONDS || body.everySeconds > MAX_EVERY_SECONDS)
          fail(400, 'SCHEDULE_INPUT', `everySeconds must be an integer between ${MIN_EVERY_SECONDS} and ${MAX_EVERY_SECONDS}.`);
        everySeconds = body.everySeconds;
        nextAt = new Date(now + everySeconds * 1_000).toISOString();
      }
      const store = partition(actor.workspaceId);
      let schedule = null;
      let replayed = false;
      await store.update(state => {
        const previous = state.receipts.find(item => item.requestId === body.requestId && item.scheduleId);
        if (previous) {
          schedule = view(requireSchedule(state, actor, previous.scheduleId));
          replayed = true;
          return null;
        }
        if (state.schedules.length >= SCHEDULE_LIMITS.schedules) fail(409, 'SCHEDULE_FULL', 'This workspace has too many schedules.');
        const timestamp = at();
        const created = {
          id: randomUUID(), workspaceId: actor.workspaceId, title, prompt, conversationId: body.conversationId, goalId,
          kind: body.kind, at: scheduleAt, everySeconds, nextAt,
          status: 'disabled', createdBy: actor.subject, createdAt: timestamp, updatedAt: timestamp,
          lastRunAt: null, lastRunId: null,
        };
        state.schedules.push(created);
        state.receipts.push({ requestId: body.requestId, scheduleId: created.id, kind: 'create', dueAt: null, dispatchId: timestamp, at: timestamp });
        schedule = view(created);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'schedules', action: 'schedules.create', actor: actor.subject, ref: schedule.id });
      return { schedule, replayed };
    },

    list(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'all' : query.status;
      if (!['all', ...SCHEDULE_STATUSES].includes(status)) fail(400, 'SCHEDULE_INPUT', 'status is invalid.');
      const state = partition(actor.workspaceId).read();
      const items = state.schedules
        .filter(item => item.workspaceId === actor.workspaceId)
        .filter(item => status === 'all' || item.status === status)
        .sort((a, b) => (a.nextAt ?? '9999').localeCompare(b.nextAt ?? '9999'))
        .map(view);
      return { workspaceId: actor.workspaceId, status, total: items.length, items };
    },

    get(context, id) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const schedule = requireSchedule(state, actor, id);
      const receipts = state.receipts.filter(item => item.scheduleId === id && item.kind === 'dispatch').slice(-20).map(item => structuredClone(item));
      return { schedule: view(schedule), receipts };
    },

    async setStatus(context, id, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'SCHEDULE_FORBIDDEN', 'A viewer cannot change a schedule.');
      if (!isPlain(body) || Object.keys(body).some(key => !['status', 'note'].includes(key)))
        fail(400, 'SCHEDULE_INPUT', 'A status change has an unsupported field.');
      if (!['enabled', 'disabled'].includes(body.status))
        fail(400, 'SCHEDULE_INPUT', 'status must be enabled or disabled.');
      const note = body.note === undefined ? null : text(body.note, SCHEDULE_LIMITS.note, 'note', { empty: true });
      const store = partition(actor.workspaceId);
      let schedule = null;
      await store.update(state => {
        const current = requireSchedule(state, actor, id);
        if (current.status === 'done' || current.status === 'blocked')
          fail(409, 'SCHEDULE_TRANSITION', `A schedule in ${current.status} cannot be re-enabled.`);
        current.status = body.status;
        current.updatedAt = at();
        if (note !== null) current.note = note;
        schedule = view(current);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'schedules', action: 'schedules.status', actor: actor.subject, ref: id, detail: { status: body.status } });
      return { schedule };
    },

    /**
     * Dispatch every due schedule. Safe to call at any time: the deterministic
     * requestId means a repeated tick replays the same run, never a second one.
     */
    async tick() {
      if (ticking) return { dispatched: 0, skipped: 'busy' };
      ticking = true;
      try {
        const now = clock();
        const store = partition(workspaceId);
        const state = store.read();
        const due = state.schedules.filter(item => item.status === 'enabled' && item.nextAt !== null && Date.parse(item.nextAt) <= now);
        let dispatched = 0;
        for (const schedule of due) {
          const dueAt = schedule.nextAt;
          const dispatchId = `${schedule.id}:${dueAt}`;
          let run = null;
          try {
            const posted = await chat.postMessage(
              { actor: { subject: 'service:scheduler', role: 'operator', workspaceId }, trustedService: true },
              schedule.conversationId,
              { requestId: `schedule:${dispatchId}`, content: schedule.prompt, ...(schedule.goalId ? { goalId: schedule.goalId } : {}) },
            );
            run = posted.run;
          } catch (error) {
            await store.update(draft => {
              const current = draft.schedules.find(item => item.id === schedule.id);
              if (current) { current.status = 'blocked'; current.updatedAt = at(); current.note = `DISPATCH_FAILED:${error?.code ?? 'UNKNOWN'}`; }
              return null;
            });
            continue;
          }
          await store.update(draft => {
            const current = draft.schedules.find(item => item.id === schedule.id);
            if (!current) return null;
            current.lastRunAt = at();
            current.lastRunId = run.id;
            current.updatedAt = current.lastRunAt;
            if (current.kind === 'at') { current.status = 'done'; current.nextAt = null; }
            else {
              // Latest-missed only: jump to the next future instant, never a backlog.
              const step = current.everySeconds * 1_000;
              let next = Date.parse(dueAt) + step;
              while (next <= now) next += step;
              current.nextAt = new Date(next).toISOString();
            }
            draft.receipts.push({ scheduleId: schedule.id, kind: 'dispatch', dueAt, runId: run.id, dispatchId, at: at(), requestId: `schedule:${dispatchId}` });
            return null;
          });
          dispatched += 1;
        }
        return { dispatched };
      } finally {
        ticking = false;
      }
    },
  });
}
