// Operations domain: what the harness knows about itself, and how a reviewed
// backup is restored. Pure over a storage snapshot; file I/O lives in index.
export const OPS_LIMITS = Object.freeze({ backupBytes: 8 * 1024 * 1024, backups: 100 });

export class OpsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'OpsError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new OpsError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

export function summarize(state = {}) {
  const workspaces = isPlain(state.workspaces) ? state.workspaces : {};
  const total = { workspaces: Object.keys(workspaces).length, conversations: 0, messages: 0, runs: 0, approvals: 0, goals: 0, schedules: 0, inbox: 0, sessions: 0 };
  for (const workspace of Object.values(workspaces)) {
    if (!isPlain(workspace)) continue;
    const chat = workspace.harnessChat;
    if (isPlain(chat)) {
      total.conversations += Array.isArray(chat.conversations) ? chat.conversations.length : 0;
      total.messages += Array.isArray(chat.messages) ? chat.messages.length : 0;
      total.runs += Array.isArray(chat.runs) ? chat.runs.length : 0;
      total.approvals += Array.isArray(chat.approvals) ? chat.approvals.length : 0;
    }
    if (isPlain(workspace.harnessGoals) && Array.isArray(workspace.harnessGoals.goals)) total.goals += workspace.harnessGoals.goals.length;
    if (isPlain(workspace.harnessSchedules) && Array.isArray(workspace.harnessSchedules.schedules)) total.schedules += workspace.harnessSchedules.schedules.length;
    if (isPlain(workspace.harnessInbox) && Array.isArray(workspace.harnessInbox.items)) total.inbox += workspace.harnessInbox.items.length;
    if (isPlain(workspace.harnessAccess) && Array.isArray(workspace.harnessAccess.sessions)) total.sessions += workspace.harnessAccess.sessions.length;
  }
  return total;
}

/** A backup must look like the storage state this harness writes. */
export function validateBackup(value, { bytes = 0 } = {}) {
  if (bytes > OPS_LIMITS.backupBytes) fail(413, 'OPS_BACKUP_TOO_LARGE', 'The backup exceeds the size limit.');
  if (!isPlain(value)) fail(400, 'OPS_BACKUP_INVALID', 'The backup is not a JSON object.');
  if (!isPlain(value.workspaces)) fail(400, 'OPS_BACKUP_INVALID', 'The backup has no workspaces.');
  for (const [id, workspace] of Object.entries(value.workspaces)) {
    if (!id) fail(400, 'OPS_BACKUP_INVALID', 'The backup has an empty workspace id.');
    if (!isPlain(workspace)) fail(400, 'OPS_BACKUP_INVALID', 'The backup has an invalid workspace.');
  }
  return true;
}

export function createOpsService({ storage, version = '0.0.0', clock = Date.now, startedAt = Date.now() } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Ops require the harness storage seam.');

  function requireAdmin(context) {
    const actor = context?.actor;
    if (!actor || typeof actor.subject !== 'string' || !actor.subject)
      fail(401, 'OPS_SESSION_REQUIRED', 'A current harness actor is required.');
    if (actor.role !== 'admin') fail(403, 'OPS_FORBIDDEN', 'Only an administrator can use this surface.');
    return actor;
  }

  return Object.freeze({
    /** Operational snapshot: versions, counts, storage footprint. */
    status(context) {
      requireAdmin(context);
      const state = storage.read() ?? {};
      const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
      return {
        version,
        node: process.version,
        pid: process.pid,
        uptimeSeconds: Math.max(0, Math.round((clock() - startedAt) / 1_000)),
        storage: {
          directory: typeof storage.directory === 'string' ? storage.directory : null,
          bytes,
          counts: summarize(state),
        },
      };
    },

    /**
     * Replace the durable state with a validated backup. The caller must echo
     * the backup id, so restoring is always deliberate.
     */
    async restore(context, { backupId, confirm, value } = {}) {
      const actor = requireAdmin(context);
      if (typeof backupId !== 'string' || !backupId) fail(400, 'OPS_INPUT', 'backupId is required.');
      if (confirm !== backupId) fail(409, 'OPS_CONFIRM_REQUIRED', 'confirm must repeat the backup id.');
      const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
      validateBackup(value, { bytes });
      await storage.update(root => {
        for (const key of Object.keys(root)) delete root[key];
        Object.assign(root, structuredClone(value));
        return null;
      });
      return { restored: true, backupId, actor: actor.subject, counts: summarize(storage.read()) };
    },
  });
}
