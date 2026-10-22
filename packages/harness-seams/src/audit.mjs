// ctx.audit: one durable, queryable audit trail for harness plugins.
//
// Entries live in `state.harnessAudit` (the same array the tools seam has been
// writing since P0). This provider adds a unified schema for new events and a
// reader that normalises the legacy tool entries, so operators see one stream
// without rewriting history. Entries never carry message bodies or customer data.
import { randomUUID } from 'node:crypto';
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';
import { provideService, serviceFromContext } from './ctx.mjs';

const KIND = /^[a-z][a-z0-9_.-]{0,63}$/u;
const ACTION = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const MAX_DETAIL_BYTES = 2048;
const MAX_ENTRIES = 1000;
const DEFAULT_LIMIT = 100;

const fail = (message) => { throw new HarnessError(ERROR.manifestInvalid, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function normalizeActor(actor) {
  if (actor === undefined || actor === null) return null;
  if (typeof actor === 'object' && typeof actor.subject === 'string' && actor.subject) {
    return { subject: actor.subject.slice(0, 200), role: typeof actor.role === 'string' ? actor.role.slice(0, 40) : null };
  }
  if (typeof actor === 'string' && actor) return { subject: actor.slice(0, 200), role: null };
  fail('audit actor must be a subject string or {subject, role}.');
}

function normalizeDetail(detail) {
  if (detail === undefined || detail === null) return null;
  if (!isPlain(detail)) fail('audit detail must be a plain object.');
  const text = JSON.stringify(detail);
  if (Buffer.byteLength(text, 'utf8') > MAX_DETAIL_BYTES) fail(`audit detail must be at most ${MAX_DETAIL_BYTES} bytes.`);
  return structuredClone(detail);
}

export function createAudit({ storage, clock = Date.now, limit = MAX_ENTRIES } = {}) {
  if (!storage?.read || !storage?.update) throw new TypeError('The audit service requires ctx.storage.');
  if (typeof clock !== 'function') throw new TypeError('audit.clock must be a function.');
  const capacity = Number.isSafeInteger(limit) && limit > 0 ? limit : MAX_ENTRIES;
  let closed = false;

  const database = state => {
    state.harnessAudit ??= [];
    if (!Array.isArray(state.harnessAudit)) fail('state.harnessAudit must be an array.');
    return state.harnessAudit;
  };

  const service = {
    /** Append one metadata-only audit event. Rejects malformed fields before writing. */
    async record(entry) {
      if (closed) throw new HarnessError(ERROR.manifestInvalid, 'The audit service is closed.');
      if (!isPlain(entry)) fail('audit.record requires an object.');
      for (const key of Object.keys(entry)) {
        if (!['kind', 'action', 'actor', 'ok', 'code', 'detail', 'ref'].includes(key)) fail(`audit entry has an unsupported field ${key}.`);
      }
      if (typeof entry.kind !== 'string' || !KIND.test(entry.kind)) fail('audit kind must be a bounded identifier.');
      if (typeof entry.action !== 'string' || !ACTION.test(entry.action)) fail('audit action must be a bounded identifier.');
      const ok = entry.ok === undefined ? true : entry.ok;
      if (typeof ok !== 'boolean') fail('audit ok must be a boolean.');
      const code = entry.code === undefined || entry.code === null ? null : String(entry.code);
      if (code !== null && (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(code))) fail('audit code must be an upper-case error code.');
      let ref = null;
      if (entry.ref !== undefined && entry.ref !== null) {
        if (typeof entry.ref !== 'string' || !entry.ref.trim() || entry.ref.length > 200) fail('audit ref must be bounded text.');
        ref = entry.ref;
      }
      const record = {
        id: randomUUID(), at: new Date(Number(clock())).toISOString(),
        kind: entry.kind, action: entry.action, actor: normalizeActor(entry.actor),
        ok, code, detail: normalizeDetail(entry.detail), ref,
      };
      return await storage.update(state => {
        const log = database(state);
        log.push(record);
        if (log.length > capacity) log.splice(0, log.length - capacity);
        return structuredClone(record);
      });
    },

    /** Unified view over new entries and the legacy tool entries. */
    list({ kind, actor, since, limit: requested } = {}) {
      const size = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, capacity) : DEFAULT_LIMIT;
      const sinceMs = since === undefined ? null : Date.parse(since);
      if (since !== undefined && !Number.isFinite(sinceMs)) fail('audit since must be an ISO timestamp.');
      const subject = actor && typeof actor === 'object' ? actor.subject : actor;
      const entries = (storage.read().harnessAudit ?? []).map(entry => normalizeEntry(entry)).filter(Boolean);
      return entries
        .filter(entry => (kind === undefined || entry.kind === kind))
        .filter(entry => (subject === undefined || entry.actor?.subject === subject))
        .filter(entry => (sinceMs === null || Date.parse(entry.at) >= sinceMs))
        .slice(-size)
        .reverse();
    },

    summary() {
      const counts = { byKind: {}, total: 0, failed: 0 };
      for (const entry of (storage.read().harnessAudit ?? []).map(normalizeEntry).filter(Boolean)) {
        counts.total += 1;
        counts.byKind[entry.kind] = (counts.byKind[entry.kind] ?? 0) + 1;
        if (!entry.ok) counts.failed += 1;
      }
      return counts;
    },

    close() { closed = true; },
  };
  return Object.freeze(service);
}

/** Accept both the unified schema and the P0 tool-entry schema. */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.kind === 'string') {
    return {
      id: entry.id, at: entry.at, kind: entry.kind, action: entry.action,
      actor: entry.actor ?? null, ok: entry.ok !== false, code: entry.code ?? null,
      detail: entry.detail ?? null, ref: entry.ref ?? null,
    };
  }
  if (typeof entry.tool === 'string') {
    return {
      id: entry.id, at: entry.at, kind: 'tool', action: entry.tool,
      actor: entry.actor ? normalizeActor(entry.actor) : null,
      ok: entry.ok !== false, code: entry.errorCode ?? null,
      detail: entry.approvalId ? { approvalId: entry.approvalId } : null, ref: null,
    };
  }
  return null;
}

export const manifest = Object.freeze({
  id: 'audit', version: '0.1.0', kind: 'provider', entry: './src/audit.mjs', provides: ['audit'], requires: ['storage'],
  configSchema: { type: 'object', properties: { limit: { type: 'integer' } }, additionalProperties: false },
});

export function createAuditProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  return {
    id: 'audit', manifest,
    async apply(ctx, config = {}) {
      if (!ctx || typeof ctx !== 'object') throw new TypeError('The audit provider requires a kernel context object.');
      if (!registration) {
        const existing = serviceFromContext(ctx, SERVICE.audit);
        if (existing !== undefined) throw new HarnessError(ERROR.pluginDuplicate, 'ctx.audit is already registered by another provider.', { service: SERVICE.audit });
      }
      if (!service) {
        const storage = options.storage ?? (options.bindContext === false ? null : serviceFromContext(ctx, SERVICE.storage));
        if (!storage) throw new HarnessError(ERROR.pluginMissingDependency, 'The audit provider requires ctx.storage.');
        service = createAudit({ storage, clock: options.clock, limit: options.limit ?? config?.limit });
      }
      if (!registration) registration = provideService(ctx, SERVICE.audit, service);
      if (!disposer) {
        let disposed = false;
        disposer = async () => {
          if (disposed) return;
          disposed = true;
          try { service.close(); } finally { await registration?.dispose?.(); }
        };
      }
      return disposer;
    },
  };
}

export async function apply(ctx, config = {}) {
  return createAuditProvider(config).apply(ctx, config);
}
