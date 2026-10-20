// Approval seam: one-shot, actor-bound approval tickets, fail-closed.
//
// Frozen contract (packages/harness-contracts/CONTRACT.md §5):
//   ctx.approval.request({ actor, tool, args, reason }) -> { id, status: 'pending' }
//   ctx.approval.decide(id, 'approve'|'deny', actor)    -> { id, status }
//   ctx.approval.consume(id, actor)                      -> true | throw HARNESS_APPROVAL_REQUIRED
//   ctx.approval.list({ status })                        -> items (each carries requestedAt)
//
// Rules implemented:
//   * one-shot: a consumed ticket is dead; double consume fails closed;
//   * TTL (default 60_000 ms, injectable clock): a pending ticket auto-denies at
//     `requestedAt + ttlMs`; expired/unknown ids are always refused;
//   * actor-bound: only the requesting actor or an admin may decide; only the
//     requesting actor may consume (another actor's consume is refused);
//   * decisions are immutable: an approved/denied/consumed ticket cannot be
//     decided again.
//
// Error mapping (reported to the Lead): consume failures are
// HARNESS_APPROVAL_REQUIRED (contract), except an actor mismatch which is
// HARNESS_APPROVAL_REFUSED; every decide-side violation (unknown id, invalid
// decision, expired, already decided, unauthorized actor) is
// HARNESS_APPROVAL_REFUSED. Tickets live in memory: they are one-shot and
// short-lived, and no durable secret is written.

import { randomUUID } from 'node:crypto';
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';
import { provideService, serviceFromContext } from './ctx.mjs';

export const DEFAULT_TTL_MS = 60_000;
const MAX_RECORDS = 4096;
const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'denied', 'consumed']);

/** Lightweight provider manifest (optional for the kernel; used for topo/list if honoured). */
export const manifest = Object.freeze({
  id: 'approval',
  version: '0.1.0',
  kind: 'provider',
  description: 'One-shot, actor-bound approval tickets (fail-closed)',
  entry: './src/approval.mjs',
  requires: Object.freeze([]),
  provides: Object.freeze([SERVICE.approval]),
});

const iso = milliseconds => new Date(milliseconds).toISOString();

function jsonCopy(value, label) {
  let text;
  try {
    text = JSON.stringify(value === undefined ? null : value);
  } catch (cause) {
    throw new HarnessError(ERROR.approvalRefused, `${label} must be JSON-serializable.`, { cause: String(cause?.message ?? cause) });
  }
  if (text === undefined) throw new HarnessError(ERROR.approvalRefused, `${label} must be JSON-serializable.`);
  return JSON.parse(text);
}

function readActor(actor, code = ERROR.approvalRefused, label = 'actor') {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor))
    throw new HarnessError(code, `${label} is required.`);
  if (typeof actor.subject !== 'string' || !actor.subject.trim())
    throw new HarnessError(code, `${label}.subject must be a non-empty string.`);
  return {
    subject: actor.subject,
    role: typeof actor.role === 'string' && actor.role ? actor.role : 'user',
    workspaceId: typeof actor.workspaceId === 'string' && actor.workspaceId ? actor.workspaceId : null,
  };
}

/** Cross-actor comparison: same subject, and the same workspace when the ticket scoped one. */
const sameActor = (left, right) =>
  left.subject === right.subject && (right.workspaceId === null || left.workspaceId === right.workspaceId);

const snapshot = record => structuredClone({
  id: record.id,
  tool: record.tool,
  args: record.args,
  reason: record.reason,
  actor: record.actor,
  status: record.status,
  requestedAt: record.requestedAt,
  expiresAt: record.expiresAt,
  decidedAt: record.decidedAt,
  decidedBy: record.decidedBy,
  consumedAt: record.consumedAt,
  expired: record.expired,
});

/**
 * Construct the approval service directly (tests/embedders).
 * @param {{clock?: () => number, ttlMs?: number}} [options]
 */
export function createApproval({ clock = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof clock !== 'function') throw new TypeError('approval.clock must be a function returning epoch milliseconds.');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('approval.ttlMs must be a positive finite number of milliseconds.');
  const ttl = Math.floor(ttlMs);
  const records = new Map();

  const now = () => {
    const at = clock();
    if (!Number.isFinite(at))
      throw new HarnessError(ERROR.approvalRefused, 'The approval clock returned a non-finite timestamp.');
    return at;
  };

  function expire(record, at) {
    if (record.status === 'pending' && at >= record.expiresAtMs) {
      record.status = 'denied';
      record.decidedAt = iso(record.expiresAtMs);
      record.decidedBy = null;
      record.expired = true;
    }
    return record;
  }

  function lookup(id, code) {
    if (typeof id !== 'string' || !id.trim()) throw new HarnessError(code, 'An approval id is required.');
    const record = records.get(id);
    if (!record) throw new HarnessError(code, `Unknown approval ${JSON.stringify(id)}; approvals fail closed.`);
    return record;
  }

  // Bound memory: terminal tickets are short-lived; drop the oldest when the
  // registry grows past MAX_RECORDS. Pending tickets are never dropped early.
  function prune(at) {
    if (records.size < MAX_RECORDS) return;
    for (const [id, record] of records) {
      expire(record, at);
      if (record.status !== 'pending') records.delete(id);
      if (records.size <= Math.floor(MAX_RECORDS * 0.75)) break;
    }
  }

  function request(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new HarnessError(ERROR.approvalRefused, 'approval.request requires { actor, tool, args?, reason? }.');
    const actor = readActor(payload.actor);
    if (typeof payload.tool !== 'string' || !payload.tool.trim())
      throw new HarnessError(ERROR.approvalRefused, 'approval.request requires a non-empty tool name.');
    if (payload.reason !== undefined && typeof payload.reason !== 'string')
      throw new HarnessError(ERROR.approvalRefused, 'approval.reason must be a string when provided.');
    const at = now();
    prune(at);
    const record = {
      id: randomUUID(),
      tool: payload.tool,
      args: jsonCopy(payload.args ?? {}, 'approval args'),
      reason: payload.reason ?? null,
      actor,
      status: 'pending',
      requestedAt: iso(at),
      expiresAt: iso(at + ttl),
      expiresAtMs: at + ttl,
      decidedAt: null,
      decidedBy: null,
      consumedAt: null,
      expired: false,
    };
    records.set(record.id, record);
    return { id: record.id, status: 'pending' };
  }

  function decide(id, decision, actor) {
    if (decision !== 'approve' && decision !== 'deny')
      throw new HarnessError(ERROR.approvalRefused, `approval.decide accepts 'approve' or 'deny'; got ${JSON.stringify(decision)}.`);
    const record = lookup(id, ERROR.approvalRefused);
    const at = now();
    expire(record, at);
    const who = readActor(actor);
    if (record.status !== 'pending')
      throw new HarnessError(
        ERROR.approvalRefused,
        `Approval ${id} is ${record.status}${record.expired ? ' (expired)' : ''}; decisions are one-shot and immutable.`,
      );
    if (who.role !== 'admin' && !sameActor(who, record.actor))
      throw new HarnessError(ERROR.approvalRefused, 'Only the requesting actor or an admin may decide this approval.');
    record.status = decision === 'approve' ? 'approved' : 'denied';
    record.decidedAt = iso(at);
    record.decidedBy = who;
    return { id, status: record.status };
  }

  function consume(id, actor) {
    const record = lookup(id, ERROR.approvalRequired);
    const at = now();
    expire(record, at);
    if (record.status !== 'approved')
      throw new HarnessError(
        ERROR.approvalRequired,
        `Approval ${id} cannot be consumed (status ${record.status}${record.expired ? ', expired' : ''}).`,
      );
    const who = readActor(actor);
    if (!sameActor(who, record.actor))
      throw new HarnessError(ERROR.approvalRefused, 'An approval ticket may only be consumed by the actor that requested it.');
    record.status = 'consumed';
    record.consumedAt = iso(at);
    return true;
  }

  function list(options = {}) {
    const status = options?.status;
    if (status !== undefined && !APPROVAL_STATUSES.includes(status))
      throw new HarnessError(
        ERROR.approvalRefused,
        `Unknown approval status ${JSON.stringify(status)}; expected one of ${APPROVAL_STATUSES.join('/')}.`,
      );
    const at = now();
    for (const record of records.values()) expire(record, at);
    return [...records.values()]
      .filter(record => status === undefined || record.status === status)
      .map(snapshot);
  }

  return Object.freeze({ request, decide, consume, list });
}

/**
 * Mountable provider: `createApprovalProvider({ clock, ttlMs }).apply(ctx)`.
 * Registers `ctx.approval` (via `ctx.provide` on Cordis) and returns a disposer.
 */
export function createApprovalProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  const apply = async (ctx, config = {}) => {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('The approval provider requires a kernel context object.');
    if (!registration) {
      const existing = serviceFromContext(ctx, SERVICE.approval);
      if (existing !== undefined)
        throw new HarnessError(ERROR.pluginDuplicate, 'ctx.approval is already registered by another provider.', { service: SERVICE.approval });
    }
    if (!service) service = createApproval({ clock: options.clock, ttlMs: options.ttlMs ?? config?.ttlMs });
    if (!registration) registration = provideService(ctx, SERVICE.approval, service);
    if (!disposer) {
      let disposed = false;
      disposer = async () => {
        if (disposed) return;
        disposed = true;
        await registration.dispose();
      };
    }
    return disposer;
  };
  return { apply };
}

// Fallback for loaders that import the module instead of calling the factory.
const providers = new WeakMap();
export async function apply(ctx, config = {}) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('The approval provider requires a kernel context object.');
  let provider = providers.get(ctx);
  if (!provider) {
    provider = createApprovalProvider(config ?? {});
    providers.set(ctx, provider);
  }
  return provider.apply(ctx, config);
}

export default { createApproval, createApprovalProvider, apply, manifest, DEFAULT_TTL_MS };
