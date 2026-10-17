/** TEST ONLY: synthetic authority/business records and an SQLite artifact API
 * facade. This is NOT the original Workspace Store, a production adapter, a
 * real model, or an alternate product memory database. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createBusinessBrain } from '../../plugins/workspace-goal-intelligence/src/brain.mjs';
import { createArtifactBrainRepository } from '../../plugins/workspace-goal-intelligence/src/artifact-repository.mjs';
import { bytesHash, clone, digest, fail, same, sourceId } from '../../plugins/workspace-goal-intelligence/src/contracts.mjs';

export const model = { provider: 'synthetic-no-provider', id: 'no-model' };
export function openFixture(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blobs (id TEXT, version INTEGER, content TEXT, PRIMARY KEY(id,version))');
  const state = { revoked: false, sourceRevoked: false, human: true, writesAllowed: true, allowedEnterprise: null, beforeCommit: null, afterRead: null, afterSource: null, clock: Date.parse('2026-10-16T06:00:00.000Z'), sources: new Map(), goals: new Map(), commitCount: 0, readers: 0 };
  const store = { read: () => ({ artifacts: db.prepare('SELECT record FROM records ORDER BY id').all().map(r => JSON.parse(r.record)) }) };
  function find(id) { const r = db.prepare('SELECT record FROM records WHERE id=?').get(id); if (!r) fail('BRAIN_NOT_FOUND'); return JSON.parse(r.record); }
  const artifacts = {
    async create(body, admission) {
      await state.beforeCommit?.();
      db.exec('BEGIN IMMEDIATE');
      try {
        admission.check(store.read());
        if (store.read().artifacts.some(r => r.requestId === body.requestId)) fail('BRAIN_REVISION_CONFLICT');
        const row = { id: randomUUID(), filename: body.filename, metadata: body.metadata, sourceConversationId: body.sourceConversationId, sha256: bytesHash(body.content), revision: 1, currentVersion: 1, requestId: body.requestId };
        db.prepare('INSERT INTO records VALUES(?,?)').run(row.id, JSON.stringify(row));
        db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(row.id, 1, body.content);
        db.exec('COMMIT'); state.commitCount++; return { artifact: clone(row) };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async update(id, body, admission) {
      await state.beforeCommit?.();
      db.exec('BEGIN IMMEDIATE');
      try {
        admission.check(store.read()); const current = find(id);
        if (current.revision !== body.expectedRevision) fail('BRAIN_REVISION_CONFLICT');
        const row = { ...current, metadata: body.metadata, sourceConversationId: body.sourceConversationId, sha256: bytesHash(body.content), revision: current.revision + 1, currentVersion: current.currentVersion + 1 };
        db.prepare('UPDATE records SET record=? WHERE id=?').run(JSON.stringify(row), id);
        db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(id, row.currentVersion, body.content);
        db.exec('COMMIT'); state.commitCount++; return { artifact: clone(row) };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async read(id, { version }) {
      state.readers++; const row = find(id);
      const blob = db.prepare('SELECT content FROM blobs WHERE id=? AND version=?').get(id, version);
      if (!blob) fail('BRAIN_NOT_FOUND');
      await state.afterRead?.();
      return { artifact: row, version: { version }, content: blob.content, encoding: 'utf8' };
    },
  };
  function addSource(workspaceId, kind, id, values, extra = {}) {
    const reference = { kind, id, revision: '1', sha256: digest(values), fields: Object.keys(values) };
    const row = { workspaceId, reference, observedAt: new Date(state.clock - 1000).toISOString(), validUntil: null, values, ...extra };
    state.sources.set(JSON.stringify([workspaceId, sourceId(reference)]), row); return clone(reference);
  }
  function addGoal(workspaceId, changes = {}) {
    const goal = { workspaceId, id: 'overseas', revision: '1', objective: 'Obtain qualified distributor opportunities without unapproved spending', status: 'active', currency: 'USD', budgetRemainingMinor: 10000, perTaskCapMinor: 2000, capabilities: ['analysis','draft','none'], deadline: null, ...changes };
    state.goals.set(JSON.stringify([workspaceId,goal.id]), goal); return goal;
  }
  function source(workspaceId, reference) { return state.sources.get(JSON.stringify([workspaceId,sourceId(reference)])); }
  function current({ operation, binding, sourceRefs, goalIds, sources, goals }) {
    if (state.revoked || state.sourceRevoked || operation && !state.writesAllowed || operation === 'feedback.save' && !state.human) return false;
    return sourceRefs.every((ref,i) => {
      const row = source(binding.workspaceId,ref);
      return row && same(row.reference,ref) && row.workspaceId === binding.workspaceId && same(row.values,sources[i].values)
        && (row.validUntil === null || Date.parse(row.validUntil) > state.clock);
    }) && goalIds.every((id,i) => same(state.goals.get(JSON.stringify([binding.workspaceId,id])),goals[i]));
  }
  function makeBrain(workspaceId, changes = {}) {
    const binding = { workspaceId, subject: 'owner', conversationId: `conversation-${workspaceId}`, sessionId: `session-${workspaceId}`, scopeVersion: '1', receiver: model, ...changes };
    const repository = createArtifactBrainRepository({ store, artifacts, workspaceId,
      authorizeRecord: () => !state.revoked && (!state.allowedEnterprise || state.allowedEnterprise === workspaceId) });
    const options = { binding, repository, now: () => state.clock,
      authorize: ({ action }) => !state.revoked && (!state.allowedEnterprise || state.allowedEnterprise === workspaceId) && (!action.endsWith('.save') || state.writesAllowed) && (action !== 'source.read' || !state.sourceRevoked),
      readSource: async ({ reference }) => { const row = clone(source(workspaceId,reference)); await state.afterSource?.(); return row; },
      readGoal: ({goalId}) => clone(state.goals.get(JSON.stringify([workspaceId,goalId]))),
      assertCurrent: current, assertCommit: current,
      authorizeHumanFeedback: () => state.human && !state.revoked,
    };
    return { brain: createBusinessBrain(options), options, repository };
  }
  return { db, store, artifacts, state, addSource, addGoal, makeBrain, source, close: () => db.close() };
}
export function contextInput(refs, changes = {}) {
  return { requestId: 'context-1', expectedRevision: 0, goalIds: ['overseas'], sourceRefs: refs,
    businessModel: { valueProposition: 'Owner-confirmed sources must be checked before use.', customerSegments: ['Candidate overseas distributors'], revenueModel: 'Product supply; model draft, not an authoritative policy.' },
    operatingFocus: ['Investigate existing inquiry blockers before increasing acquisition spend.'], unknowns: ['Actual small-batch production costs are unknown.'],
    notes: [{ kind: 'hypothesis', text: 'MOQ may be one obstacle; it is not a proven cause.', evidenceIds: refs.map(sourceId) }], ...changes };
}
export function decisionInput(id = 'decision-1', changes = {}) {
  return { id, requestId: `${id}-save`, expectedRevision: 0, contextRevision: 1, goalId: 'overseas', sourceRefs: [], problem: `Inquiry conversion needs investigation: ${id}`,
    hypotheses: [ { id: 'moq', explanation: 'Trial quantity mismatch may matter.', supportingEvidence: ['product:cloth'], contradictingEvidence: [], missingEvidence: ['Buyer confirmation and contribution cost calculation.'] } ],
    options: [
      { id: 'investigate', title: '核查试单门槛与小单成本', kind: 'investigate', capability: 'analysis', description: 'Prepare an evidence-backed diagnosis; do not change MOQ or contact customers.', evidenceIds: ['product:cloth'], risk: 'low', estimate: { currency: 'USD', costMinor: { min: 0, max: 600 }, incrementalContributionMinor: null, assumptions: ['Research cost is an unverified planning range, not a quote.'] }, requirements: ['Owner review before any external action.'] },
      { id: 'wait', title: '暂不调整供货政策', kind: 'wait', capability: 'none', description: 'Wait for missing cost/intent evidence.', evidenceIds: [], risk: 'low', estimate: { currency: 'USD', costMinor: { min: 0, max: 0 }, incrementalContributionMinor: { min: 0, max: 0 }, assumptions: ['Illustrative do-nothing incremental scenario.'] }, requirements: [] },
    ],
    recommendation: { optionId: 'investigate', rationale: 'Investigate before buying more acquisition services; causal explanation is unverified.', verification: { metricId: 'net-paid-orders', observationDays: 7, stopConditions: ['Stop if cost exceeds the approved cap.'] } },
    ...changes };
}
export async function prepared(fixture, workspaceId = 'enterprise-A') {
  const ref = fixture.addSource(workspaceId,'product','cloth',{ name: `${workspaceId} product`, moqMeters: 1000 });
  fixture.addGoal(workspaceId);
  const env = fixture.makeBrain(workspaceId);
  await env.brain.contextSave(contextInput([ref]), undefined, model);
  return { ...env, ref };
}
