// Session domain: the harness' own sign-in, for a loopback single-operator
// deployment. The workspace seam stays the authority on membership and roles;
// a session only proves which member is talking.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const ACCESS_STATE_VERSION = 2;
const STATE_KEY = 'harnessAccess';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
export const SESSION_COOKIE = 'dsh_session';
export const ACCESS_LIMITS = Object.freeze({ sessions: 500, subject: 200 });

export class AccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new AccessError(status, code, message); };

/** Opaque, non-replayable handle for a session id (used by admin listings). */
export function sessionHandle(sessionId) {
  return createHash('sha256').update(`session:${sessionId}`).digest('hex').slice(0, 24);
}
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const SESSION_ID = /^[a-f0-9]{64}$/u;

const defaultState = () => ({ version: ACCESS_STATE_VERSION, sessions: [] });

function validateState(value) {
  if (!isPlain(value) || value.version !== ACCESS_STATE_VERSION || !Array.isArray(value.sessions)
    || value.sessions.length > ACCESS_LIMITS.sessions)
    fail(500, 'ACCESS_INVALID', 'Stored sessions are invalid or full.');
  const ids = new Set();
  for (const session of value.sessions) {
    if (!isPlain(session) || typeof session.id !== 'string' || !SESSION_ID.test(session.id)
      || typeof session.workspaceId !== 'string' || !session.workspaceId
      || typeof session.subject !== 'string' || !session.subject
      || !['admin', 'operator', 'viewer'].includes(session.role)
      || !isIso(session.createdAt) || !isIso(session.expiresAt)
      || (session.revokedAt !== null && !isIso(session.revokedAt))
      || !isIso(session.lastSeenAt)
      || typeof session.csrfToken !== 'string' || !/^[a-f0-9]{32}$/u.test(session.csrfToken))
      fail(500, 'ACCESS_INVALID', 'Stored session is invalid.');
    if (ids.has(session.id)) fail(500, 'ACCESS_INVALID', 'Duplicate session id.');
    ids.add(session.id);
  }
  return true;
}

export function createAccessService({ storage, workspaceId = 'local', resolveWorkspace = null, clock = Date.now } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Access requires the harness storage seam.');
  const at = () => new Date(clock()).toISOString();

  function partition(id) {
    return {
      read() {
        const state = storage.read() ?? {};
        const value = state.workspaces?.[id]?.[STATE_KEY];
        // A version bump drops sessions rather than failing the whole surface.
        if (value === undefined || !isPlain(value) || value.version !== ACCESS_STATE_VERSION) return defaultState();
        validateState(value);
        return value;
      },
      async update(mutator) {
        return storage.update(root => {
          const workspaces = (root.workspaces ??= {});
          const workspace = (workspaces[id] ??= {});
          const raw = workspace[STATE_KEY];
          const current = (raw === undefined || !isPlain(raw) || raw.version !== ACCESS_STATE_VERSION) ? defaultState() : raw;
          validateState(current);
          const draft = structuredClone(current);
          const result = mutator(draft);
          const now = clock();
          draft.sessions = draft.sessions.filter(session => session.revokedAt === null && Date.parse(session.expiresAt) > now - 24 * 60 * 60 * 1_000);
          if (draft.sessions.length > ACCESS_LIMITS.sessions) draft.sessions.splice(0, draft.sessions.length - ACCESS_LIMITS.sessions);
          validateState(draft);
          workspace[STATE_KEY] = draft;
          return result;
        });
      },
    };
  }

  function membership(subject) {
    if (!resolveWorkspace)
      return { workspaceId, subject, role: 'admin' };
    const resolved = resolveWorkspace({ subject, role: 'viewer', workspaceId });
    if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
      fail(403, 'ACCESS_NOT_MEMBER', 'This subject is not a member of the workspace.');
    return { workspaceId: resolved.workspaceId, subject: resolved.subject ?? subject, role: resolved.role };
  }

  const service = {
    /** Sign one workspace member in. The caller decides who may reach this. */
    async login(body = {}) {
      if (!isPlain(body) || Object.keys(body).some(key => !['subject'].includes(key)))
        fail(400, 'ACCESS_INPUT', 'A sign-in has an unsupported field.');
      const subject = body.subject;
      if (typeof subject !== 'string' || !subject.trim() || subject.length > ACCESS_LIMITS.subject)
        fail(400, 'ACCESS_INPUT', 'subject must be non-empty text of at most 200 characters.');
      let member;
      try { member = membership(subject.trim()); }
      catch { fail(403, 'ACCESS_NOT_MEMBER', 'This subject is not a member of the workspace.'); }
      const store = partition(member.workspaceId);
      const session = {
        id: randomBytes(32).toString('hex'), workspaceId: member.workspaceId, subject: member.subject,
        role: member.role, csrfToken: randomBytes(16).toString('hex'), createdAt: at(), lastSeenAt: at(),
        expiresAt: new Date(clock() + SESSION_TTL_MS).toISOString(), revokedAt: null,
      };
      await store.update(state => { state.sessions.push(session); return null; });
      return { session: { ...session }, ttlSeconds: Math.floor(SESSION_TTL_MS / 1_000) };
    },

    /**
     * Resolve a cookie value into the authoritative actor, or null.
     * Mutating requests must also present the session's CSRF token.
     */
    async resolveSession(sessionId, { mutating = false, csrfToken = null } = {}) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
      const store = partition(workspaceId);
      const state = store.read();
      const session = state.sessions.find(item => item.id === sessionId);
      if (!session || session.revokedAt !== null || Date.parse(session.expiresAt) <= clock()) return null;
      if (mutating && (typeof csrfToken !== 'string' || csrfToken !== session.csrfToken)) return null;
      if (clock() - Date.parse(session.lastSeenAt) > 60_000) {
        await store.update(draft => {
          const current = draft.sessions.find(item => item.id === sessionId);
          if (current) current.lastSeenAt = at();
          return null;
        }).catch(() => {});
      }
      return { workspaceId: session.workspaceId, subject: session.subject, role: session.role };
    },

    /** Non-mutating membership lookup for signed ingress: actor or null. */
    actorFor(subject) {
      if (typeof subject !== 'string' || !subject.trim()) return null;
      try {
        const member = membership(subject.trim());
        return { workspaceId: member.workspaceId, subject: member.subject, role: member.role };
      } catch { return null; }
    },
    /** Session details for the current caller (never exposed for other sessions). */
    sessionInfo(sessionId) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
      const state = partition(workspaceId).read();
      const session = state.sessions.find(item => item.id === sessionId);
      if (!session || session.revokedAt !== null || Date.parse(session.expiresAt) <= clock()) return null;
      return {
        actor: { workspaceId: session.workspaceId, subject: session.subject, role: session.role },
        csrfToken: session.csrfToken,
      };
    },

    async logout(sessionId) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { revoked: false };
      const store = partition(workspaceId);
      let revoked = false;
      await store.update(state => {
        const session = state.sessions.find(item => item.id === sessionId);
        if (session && session.revokedAt === null) { session.revokedAt = at(); revoked = true; }
        return null;
      });
      return { revoked };
    },

    listSessions(context) {
      const actor = context?.actor;
      if (!actor || actor.role !== 'admin') fail(403, 'ACCESS_FORBIDDEN', 'Only an administrator can list sessions.');
      const state = partition(workspaceId).read();
      const now = clock();
      const items = state.sessions
        .filter(session => session.revokedAt === null && Date.parse(session.expiresAt) > now)
        .map(session => ({
          handle: sessionHandle(session.id), subject: session.subject, role: session.role,
          createdAt: session.createdAt, expiresAt: session.expiresAt, lastSeenAt: session.lastSeenAt,
        }));
      return { workspaceId, total: items.length, items };
    },

    /**
     * Revoke another session by its opaque handle (admin only). Raw session ids
     * never leave the server, so a leaked list cannot be replayed as cookies.
     */
    async revokeSession(context, handle) {
      const actor = context?.actor;
      if (!actor || actor.role !== 'admin') fail(403, 'ACCESS_FORBIDDEN', 'Only an administrator can revoke a session.');
      if (typeof handle !== 'string' || !/^[a-f0-9]{16,64}$/u.test(handle)) fail(400, 'ACCESS_INPUT', 'handle is invalid.');
      const store = partition(workspaceId);
      let revoked = false;
      await store.update(state => {
        const session = state.sessions.find(item => sessionHandle(item.id) === handle && item.revokedAt === null);
        if (session) { session.revokedAt = at(); revoked = true; }
        return null;
      });
      if (!revoked) fail(404, 'ACCESS_NOT_FOUND', 'No such active session.');
      return { revoked: true, handle };
    },

    /** Test/診断 helper: mint a session without going through HTTP. */
    async createForTest(subject = 'local-operator') { return service.login({ subject }); },
  };
  return Object.freeze(service);
}

export { randomUUID };
