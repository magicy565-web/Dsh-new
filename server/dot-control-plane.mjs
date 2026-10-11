/**
 * Read-only control projection and durable notification reducers.
 * Host adapters provide authorized, versioned source envelopes. No transport,
 * model, worker dispatch, timer, credentials or independently owned store exists here.
 */
const kinds = new Set(['goal', 'order', 'task', 'attempt']);
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value
  : typeof value === 'string' ? Date.parse(value) : NaN;
const timestamp = value => Number.isFinite(time(value)) ? new Date(time(value)).toISOString() : null;
const error = code => Object.assign(new Error(code), { code });
const fail = code => { throw error(code); };
const done = new Set(['accepted', 'completed', 'cancelled', 'expired']);
const clone = value => structuredClone(value);
const bounded = (value, fallback, max) => integer(value) && value > 0 && value <= max ? value : fallback;

/** Principal and grants must come from the original authenticated host, never a request body. */
export function controlScopeKey(principal) {
  if (!object(principal) || !id(principal.workspaceId) || !id(principal.userId)
    || !id(principal.policyVersion) || !Array.isArray(principal.grants)) fail('CONTROL_SCOPE_REQUIRED');
  const grants = principal.grants.map(grant => {
    if (!object(grant) || !id(grant.sourceId) || !['self', 'workspace'].includes(grant.scope)
      || !Array.isArray(grant.kinds) || grant.kinds.some(kind => !kinds.has(kind))) fail('CONTROL_SCOPE_INVALID');
    return { sourceId: grant.sourceId, scope: grant.scope, kinds: [...new Set(grant.kinds)].sort() };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([principal.workspaceId, principal.userId, principal.policyVersion, grants]);
}

function visible(source, row, principal, kind) {
  if (source.workspaceId !== principal.workspaceId || (row.workspaceId !== undefined && row.workspaceId !== principal.workspaceId)) return false;
  const visibility = row.visibility ?? source.visibility;
  const userId = row.userId ?? source.userId;
  if (!['workspace', 'private'].includes(visibility)) return false;
  if (visibility === 'private' && userId !== principal.userId) return false;
  // A record cannot widen an explicitly private source.
  if (source.visibility === 'private' && source.userId !== principal.userId) return false;
  return principal.grants.some(grant => grant.sourceId === source.id && grant.kinds.includes(kind)
    && (grant.scope === 'workspace' || visibility === 'private' && userId === principal.userId));
}

function freshness(source, now, maxAgeMs) {
  const observed = time(source.observedAt), changed = time(source.updatedAt);
  const valid = Number.isFinite(observed) && observed <= now && Number.isFinite(changed) && changed <= observed;
  return { state: !valid ? 'unknown' : now - observed >= maxAgeMs ? 'stale' : 'fresh',
    observedAt: timestamp(source.observedAt), updatedAt: timestamp(source.updatedAt),
    expiresAt: valid ? new Date(observed + maxAgeMs).toISOString() : null };
}

function lifecycle(row, kind, domain, source, now, freshnessState) {
  const raw = typeof row.status === 'string' ? row.status : row.state;
  const execution = row.executionStatus ?? (kind === 'task' ? row.state ?? raw : null);
  const accepted = raw === 'accepted' && time(row.acceptedAt) <= now;
  const delivered = sha(row.receiptHash) && row.returnedHash === row.receiptHash;
  const nativeAccepted = delivered && row.acceptedHash === row.receiptHash;
  const closed = delivered && row.closedHash === row.receiptHash;
  const validFence = id(row.attemptId) && integer(row.fence) && row.fence > 0;
  const lease = time(row.leaseUntil ?? row.leaseExpiresAt);
  const consistentLease = row.leaseUntil == null || row.leaseExpiresAt == null || lease === time(row.leaseExpiresAt);
  const leaseValid = validFence && consistentLease && lease > now && time(row.deadlineAt) > now;
  let status = 'unknown', active = false;
  const unknowns = [];
  if (['cancelled', 'expired', 'failed', 'completed'].includes(raw)) status = raw;
  else if (time(row.cancelledAt) <= now) status = 'cancelled';
  else if (raw === 'cancel_requested' || execution === 'cancel_requested' || row.cancellationRequested === true) status = 'cancel_requested';
  else if (raw === 'accepted') { status = accepted ? 'accepted' : 'unknown'; if (!accepted) unknowns.push('acceptance_evidence'); }
  else if (nativeAccepted) status = 'accepted';
  else if (['blocked', 'input_required', 'result_incomplete', 'budget_dispute'].includes(raw) || execution === 'blocked') status = 'blocked';
  else if (raw === 'dispatch_uncertain' || row.reconciliationRequired === true) status = 'unknown';
  else if (delivered) status = 'returned';
  else if (raw === 'review_required') status = kind === 'order' || kind === 'goal' ? 'awaiting_acceptance' : 'return_pending';
  else if (raw === 'submitted' || execution === 'submitted' || raw === 'return_pending' || raw === 'succeeded') status = 'return_pending';
  else if (['claimed', 'leased'].includes(execution)) {
    status = leaseValid ? 'claimed' : 'unknown'; active = leaseValid;
    if (!leaseValid) unknowns.push('execution_lease');
  } else if (raw === 'running' && kind === 'attempt' && domain === 'runtime') {
    active = source.executionVerified === true && id(row.id) && time(row.startedAt) <= now;
    status = active ? 'running' : 'unknown';
    if (!active) unknowns.push('runtime_execution');
  } else if (raw === 'running' && kind === 'task' && domain === 'dot') {
    status = leaseValid ? 'running' : 'unknown'; active = leaseValid;
    if (!leaseValid) unknowns.push('execution_lease');
  } else if (raw === 'running') {
    status = kind === 'goal' || kind === 'order' ? 'running' : 'unknown';
    if (kind === 'task') unknowns.push('execution_evidence');
  } else if (raw === 'awaiting_approval') status = 'awaiting_approval';
  else if (raw === 'approved') status = 'awaiting_dispatch';
  else if (raw === 'draft') status = row.approvalRequired === true ? 'awaiting_approval' : 'draft';
  else if (raw === 'dispatching') status = 'dispatching';
  else if (raw === 'pending' || raw === 'queued' || execution === 'pending') status = 'queued';
  else if (raw === 'paused') status = 'paused';
  else unknowns.push('unsupported_status');
  if (freshnessState !== 'fresh') {
    active = false;
    if (['running', 'claimed'].includes(status)) status = 'unknown';
    unknowns.push('source_' + freshnessState);
  }
  return { status, active, closed, acceptance: accepted || nativeAccepted ? 'accepted' : 'not_verified',
    returnStatus: delivered ? 'returned' : ['return_pending', 'awaiting_acceptance'].includes(status) ? 'pending' : 'not_verified',
    needsAttention: ['blocked', 'unknown', 'cancel_requested', 'awaiting_approval', 'awaiting_acceptance', 'returned'].includes(status)
      || status === 'failed' && !closed || ['cancelled', 'expired'].includes(status) && delivered && !closed,
    unknowns };
}

/**
 * sources: [{id, workspaceId, visibility, userId?, epoch, sequence,
 * observedAt, updatedAt, complete, executionVerified?, records:[{kind,domain,...}]}]
 * IDs/status evidence are allowlisted. Prompts, prices, budgets, blocker text,
 * customer profiles, receipts, files and credentials never leave this projection.
 */
export function projectControlSnapshot({ principal, sources, now = Date.now(), maxAgeMs = 60_000 } = {}) {
  const scopeKey = controlScopeKey(principal);
  if (!Array.isArray(sources) || !Number.isFinite(now) || !integer(maxAgeMs) || maxAgeMs < 1) fail('CONTROL_INPUT_INVALID');
  const records = [], versions = [], seen = new Set(), recordKeys = new Set();
  for (const source of sources) {
    if (!object(source) || !id(source.id) || !Array.isArray(source.records)) fail('CONTROL_SOURCE_INVALID');
    // Do not disclose inaccessible source metadata, errors or record counts.
    if (source.workspaceId !== principal.workspaceId || !['workspace', 'private'].includes(source.visibility)
      || source.visibility === 'private' && source.userId !== principal.userId
      || !principal.grants.some(grant => grant.sourceId === source.id)
      || ![...kinds].some(kind => visible(source, {}, principal, kind))
        && !source.records.some(row => object(row) && kinds.has(row.kind) && visible(source, row, principal, row.kind))) continue;
    if (seen.has(source.id)) fail('CONTROL_SOURCE_DUPLICATE');
    seen.add(source.id);
    const fresh = freshness(source, now, maxAgeMs);
    const orderingKnown = id(source.epoch) && integer(source.sequence);
    versions.push({ id: source.id, epoch: orderingKnown ? source.epoch : null, sequence: orderingKnown ? source.sequence : null,
      complete: source.complete === true, ordering: orderingKnown ? 'known' : 'unknown', freshness: fresh });
    for (const row of source.records) {
      if (!object(row) || !kinds.has(row.kind) || !visible(source, row, principal, row.kind)) continue;
      const identifier = row.id ?? row.orderId ?? row.requestId ?? row.taskRef;
      const domain = id(row.domain) ? row.domain : 'workspace';
      if (!id(identifier)) fail('CONTROL_RECORD_INVALID');
      const key = JSON.stringify([source.id, row.kind, domain, identifier]);
      if (recordKeys.has(key)) fail('CONTROL_RECORD_DUPLICATE');
      recordKeys.add(key);
      const state = lifecycle(row, row.kind, domain, source, now, fresh.state);
      if (!Number.isFinite(time(row.updatedAt)) || time(row.updatedAt) > time(source.observedAt)) {
        state.active = false; state.unknowns.push('record_updated_at');
        if (['running', 'claimed'].includes(state.status)) state.status = 'unknown';
      }
      records.push({ key, id: identifier, kind: row.kind, domain,
        goalId: id(row.goalId) ? row.goalId : null, orderId: id(row.orderId) ? row.orderId : null,
        taskRef: id(row.taskRef) ? row.taskRef : null, attemptId: id(row.attemptId) ? row.attemptId : null,
        runId: id(row.runId) ? row.runId : null, fence: integer(row.fence) ? row.fence : null,
        revision: integer(row.revision) ? row.revision : null,
        blockerCode: id(row.error?.code ?? row.lastError?.code ?? row.blocker?.code)
          ? row.error?.code ?? row.lastError?.code ?? row.blocker?.code : null,
        reportedStatus: id(row.status ?? row.state) ? row.status ?? row.state : 'unknown', ...state,
        updatedAt: timestamp(row.updatedAt), deadlineAt: timestamp(row.deadlineAt),
        source: { id: source.id, epoch: orderingKnown ? source.epoch : null, sequence: orderingKnown ? source.sequence : null },
        freshness: fresh });
    }
  }
  // A Goal's persisted "running" alone is not evidence of a live attempt.
  for (const goal of records.filter(record => record.kind === 'goal' && record.status === 'running')) {
    goal.active = records.some(record => record.kind === 'attempt' && record.id === goal.runId
      && record.goalId === goal.id && record.source.id === goal.source.id && record.active);
    if (!goal.active) { goal.status = 'unknown'; goal.needsAttention = true; goal.unknowns.push('goal_attempt'); }
  }
  records.sort((a, b) => a.key.localeCompare(b.key));
  versions.sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 'workspace.control.snapshot.v1', scopeKey, generatedAt: new Date(now).toISOString(),
    sources: versions, records, counts: { total: records.length, byKind: Object.fromEntries([...kinds].map(kind => [kind, records.filter(row => row.kind === kind).length])),
      active: records.filter(row => row.active).length,
      attention: records.filter(row => row.needsAttention).length },
    executedActions: [] };
}

export function createControlJournal(principal, epoch) {
  if (!id(epoch)) fail('CONTROL_EPOCH_REQUIRED');
  return { schema: 'workspace.control.journal.v1', scopeKey: controlScopeKey(principal), epoch,
    cursor: 0, floor: 0, sources: {}, records: {}, events: [], consumers: {} };
}

function validateJournal(journal, scopeKey) {
  if (!object(journal) || journal.schema !== 'workspace.control.journal.v1' || journal.scopeKey !== scopeKey) fail('CONTROL_SCOPE_MISMATCH');
  if (!id(journal.epoch) || !integer(journal.cursor) || !integer(journal.floor) || journal.floor > journal.cursor
    || !object(journal.sources) || !object(journal.records) || !object(journal.consumers) || !Array.isArray(journal.events)) fail('CONTROL_JOURNAL_INVALID');
  let previous = journal.floor;
  for (const event of journal.events) {
    if (!object(event) || !integer(event.cursor) || event.cursor <= previous || event.cursor > journal.cursor
      || event.id !== journal.epoch + ':' + event.cursor || typeof event.key !== 'string'
      || !kinds.has(event.kind) || !id(event.sourceId) || !['added', 'changed', 'removed'].includes(event.type))
      fail('CONTROL_JOURNAL_INVALID');
    previous = event.cursor;
  }
}
const substance = row => JSON.stringify([row.status, row.reportedStatus, row.blockerCode, row.active, row.closed, row.acceptance, row.returnStatus, row.attemptId, row.fence, row.revision]);
const barrier = row => done.has(row.status) || row.closed;

/** Pure reducer. Persist its return in the existing authoritative transaction before publishing. */
export function advanceControlJournal(journal, snapshot, { retain = 256 } = {}) {
  validateJournal(journal, snapshot?.scopeKey);
  if (snapshot.schema !== 'workspace.control.snapshot.v1' || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.records)) fail('CONTROL_SNAPSHOT_INVALID');
  retain = bounded(retain, 256, 10_000);
  const next = clone(journal);
  const emit = (type, row, previous = null, sourceSequence = row.source.sequence) => {
    next.cursor++;
    next.events.push({ id: next.epoch + ':' + next.cursor, cursor: next.cursor, type, key: row.key,
      kind: row.kind, sourceId: row.source.id, from: previous?.status ?? null, to: type === 'removed' ? null : row.status,
      active: type === 'removed' ? false : row.active, closed: row.closed,
      at: snapshot.generatedAt, sourceSequence });
  };
  for (const source of snapshot.sources) {
    if (source.ordering !== 'known' || !id(source.epoch) || !integer(source.sequence)) fail('CONTROL_ORDER_UNKNOWN');
    const previous = next.sources[source.id];
    if (previous && previous.epoch !== source.epoch) fail('CONTROL_SOURCE_EPOCH_CHANGED');
    if (previous && source.sequence <= previous.sequence) continue;
    // A failed/stale fetch must not tombstone or regress previously observed work.
    if (source.freshness.state !== 'fresh') continue;
    const current = snapshot.records.filter(row => row.source.id === source.id);
    for (const row of current) {
      const old = next.records[row.key];
      // Late callbacks never reopen the original closed/cancelled work.
      if (old && barrier(old) && row.status !== old.status
        && !(old.status === 'returned' && row.status === 'accepted')) continue;
      if (!old) { next.records[row.key] = clone(row); if (previous) emit('added', row); }
      else { if (substance(old) !== substance(row)) emit('changed', row, old); next.records[row.key] = clone(row); }
    }
    if (source.complete) {
      const present = new Set(current.map(row => row.key));
      for (const [key, old] of Object.entries(next.records)) {
        if (old.source.id === source.id && !present.has(key)) { emit('removed', old, old, source.sequence); delete next.records[key]; }
      }
    }
    next.sources[source.id] = { epoch: source.epoch, sequence: source.sequence };
  }
  if (next.events.length > retain) {
    const removed = next.events.splice(0, next.events.length - retain);
    next.floor = removed.at(-1).cursor;
  }
  return next;
}

/** Recheck current permission projection on every reconnect and page. Never replay raw payloads. */
export function replayControlEvents(journal, { principal, snapshot, epoch, after = 0, limit = 100 } = {}) {
  const scopeKey = controlScopeKey(principal);
  validateJournal(journal, scopeKey);
  if (snapshot?.scopeKey !== scopeKey || snapshot.schema !== 'workspace.control.snapshot.v1') fail('CONTROL_SCOPE_MISMATCH');
  if (!integer(after)) fail('CONTROL_CURSOR_INVALID');
  if (epoch !== journal.epoch || after < journal.floor || after > journal.cursor)
    return { resetRequired: true, epoch: journal.epoch, cursor: journal.cursor, events: [] };
  limit = bounded(limit, 100, 1000);
  const page = journal.events.filter(event => event.cursor > after).slice(0, limit);
  const visibleKeys = new Set(snapshot.records.map(row => row.key));
  return { resetRequired: false, epoch: journal.epoch, cursor: page.at(-1)?.cursor ?? after,
    events: page.filter(event => visibleKeys.has(event.key)).map(event => Object.fromEntries(
      ['id', 'cursor', 'type', 'key', 'kind', 'sourceId', 'from', 'to', 'active', 'closed', 'at', 'sourceSequence'].map(key => [key, clone(event[key])]))),
    hasMore: (page.at(-1)?.cursor ?? after) < journal.cursor };
}

/** Ack means application consumption, not HTTP receipt or business acceptance. Persist atomically. */
export function acknowledgeControlCursor(journal, { principal, consumerId, epoch, cursor } = {}) {
  validateJournal(journal, controlScopeKey(principal));
  if (!id(consumerId) || epoch !== journal.epoch || !integer(cursor) || cursor > journal.cursor) fail('CONTROL_CURSOR_INVALID');
  const next = clone(journal);
  next.consumers[consumerId] = Math.max(next.consumers[consumerId] ?? 0, cursor);
  return next;
}

/**
 * Host-resolved facts point at visible Goal keys and exact source/revision.
 * Missing evidence is explicit. Suggestions never grant execution or share data.
 */
export function recommendGoalSteps(snapshot, { facts = [], now = Date.now() } = {}) {
  if (snapshot?.schema !== 'workspace.control.snapshot.v1' || !Array.isArray(facts) || !Number.isFinite(now)) fail('CONTROL_SNAPSHOT_INVALID');
  const output = [];
  for (const goal of snapshot.records.filter(row => row.kind === 'goal' && !done.has(row.status))) {
    const evidence = [{ key: goal.key, source: goal.source, revision: goal.revision, status: goal.status }];
    const suggestion = (action, missing = [], refs = evidence) => output.push({
      goalKey: goal.key, action, evidence: clone(refs), missingEvidence: missing,
      requiresApproval: true, executable: false, executed: false });
    if (goal.freshness.state !== 'fresh') { suggestion('refresh_source', ['fresh_source']); continue; }
    if (goal.deadlineAt && time(goal.deadlineAt) <= now) { suggestion('review_expired_scope'); continue; }
    if (['awaiting_acceptance', 'returned'].includes(goal.status)) { suggestion('review_result'); continue; }
    if (goal.status === 'cancel_requested') { suggestion('verify_original_stop'); continue; }
    if (goal.status === 'blocked') { suggestion('inspect_blocker'); continue; }
    const fact = facts.find(item => item.goalKey === goal.key && item.sourceEpoch === goal.source.epoch
      && item.sourceSequence === goal.source.sequence && item.revision === goal.revision);
    if (!fact) { suggestion('gather_goal_evidence', ['dependencies', 'materials', 'authorization', 'budget', 'sharing_scope']); continue; }
    // Host-resolved provenance is required even when a dependency/material list is empty.
    const evidenceFor = category => {
      const ref = Array.isArray(fact.evidenceRefs) ? fact.evidenceRefs.find(ref =>
        object(ref) && ref.category === category && id(ref.recordId) && integer(ref.version)
        && (category !== 'authorization' || ref.version === goal.revision)
        && snapshot.sources.some(source => source.id === ref.sourceId && source.epoch === ref.sourceEpoch
          && source.sequence === ref.sourceSequence && source.freshness.state === 'fresh')) : null;
      return ref ? { category, recordId: ref.recordId, version: ref.version,
        source: { id: ref.sourceId, epoch: ref.sourceEpoch, sequence: ref.sourceSequence } } : null;
    };
    if (!Array.isArray(fact.dependencies) || !evidenceFor('dependencies')) { suggestion('verify_dependencies', ['dependencies']); continue; }
    evidence.push(clone(evidenceFor('dependencies')));
    const dependencies = fact.dependencies.map(key => snapshot.records.find(row => row.key === key));
    if (dependencies.some(row => !row || row.freshness.state !== 'fresh'
      || !(row.status === 'accepted' || row.kind === 'goal' && row.status === 'completed'))) {
      suggestion('resolve_dependencies', dependencies.map((row, index) => !row ? 'dependency:' + index : null).filter(Boolean),
        [...evidence, ...dependencies.filter(Boolean).map(row => ({ key: row.key, source: row.source, status: row.status }))]); continue;
    }
    if (!Array.isArray(fact.missingMaterials) || !evidenceFor('materials')) { suggestion('verify_materials', ['materials']); continue; }
    evidence.push(clone(evidenceFor('materials')));
    if (fact.missingMaterials.length) { suggestion('provide_materials', fact.missingMaterials.filter(id)); continue; }
    if (!integer(goal.revision) || fact.approvedRevision !== goal.revision || !evidenceFor('authorization')) { suggestion('review_current_version', ['current_version_approval']); continue; }
    evidence.push(clone(evidenceFor('authorization')));
    if (fact.budgetAuthorized !== true || !evidenceFor('budget')) { suggestion('review_budget_authority', ['authorized_budget']); continue; }
    evidence.push(clone(evidenceFor('budget')));
    if (fact.shareRequested === true && (!id(fact.recipientId) || fact.scopeConfirmed !== true
      || !integer(fact.profileVersion) || fact.approvedProfileVersion !== fact.profileVersion || !evidenceFor('sharing'))) {
      suggestion('review_sharing_scope', ['exact_recipient', 'current_profile_version', 'explicit_share_scope']); continue;
    }
    if (fact.shareRequested === true) evidence.push(clone(evidenceFor('sharing')));
    suggestion(goal.active ? 'observe_original_attempt' : fact.shareRequested === true ? 'review_profile_delivery' : 'review_next_step');
  }
  return output;
}
