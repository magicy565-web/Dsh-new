import { PLUGIN, BrainError, fail, clone, digest, same, safeJson, timestamp, validate, validateSources, validateEvidence, unique, sourceId, INPUTS, FEEDBACK_SCHEMA } from './contracts.mjs';
import { evaluateOption, assessOutcome } from './economics.mjs';
import { analyzeBusinessSources } from './diagnostics.mjs';
import { buildBusinessPulse } from './pulse.mjs';
import { draftDecisionFromDiagnosis } from './decision-planner.mjs';

const flags = Object.freeze({ modelAuthored: true, humanReviewed: false, businessAuthority: false, executable: false, businessGoalVerified: false });
const kinds = ['context', 'decision', 'review', 'feedback'];
const keyFor = (kind, id = '') => kind === 'context' ? 'context' : `${kind}:${id}`;
const mergeSources = (...groups) => {
  const refs = new Map();
  for (const ref of groups.flat()) {
    const key = sourceId(ref);
    if (refs.has(key) && !same(refs.get(key), ref)) fail('BRAIN_SOURCE_CONFLICT');
    refs.set(key, ref);
  }
  const result = [...refs.values()]; validateSources(result); return result;
};
const receiverKey = receiver => ({ provider: receiver?.provider, id: receiver?.id });

/** One trusted binding per native conversation. No model calls, timer or queue. */
export function createBusinessBrain(options = {}) {
  const { repository, authorize, readSource, readGoal, assertCurrent, assertCommit, authorizeHumanFeedback, listAuthorizedSources, listAuthorizedGoals } = options;
  const now = options.now ?? Date.now;
  const binding = clone(options.binding);
  if (!binding || ['workspaceId', 'subject', 'conversationId', 'sessionId', 'scopeVersion'].some(k => typeof binding[k] !== 'string' || !binding[k].trim())
    || !binding.receiver?.provider || !binding.receiver?.id
    || !repository?.get || !repository?.commit || !repository?.listKeys
    || [authorize, readSource, readGoal, assertCurrent, assertCommit].some(f => typeof f !== 'function')) fail('BRAIN_HOST_UNCONFIGURED');
  safeJson(binding, 4096);
  const bindingHash = digest(binding);
  function cancelled(signal) { if (signal?.aborted) fail('BRAIN_CANCELLED'); }
  async function gate(action, receiver, signal, extra = {}) {
    cancelled(signal);
    if (!same(receiverKey(receiver), binding.receiver)) fail('BRAIN_RECEIVER_MISMATCH');
    if (await authorize({ action, binding: clone(binding), receiver, signal, ...extra }) !== true) fail('BRAIN_AUTHORIZATION_REFUSED');
    cancelled(signal);
  }
  function validateGoal(goal, id) {
    safeJson(goal, 16 * 1024);
    if (goal.workspaceId !== binding.workspaceId || goal.id !== id || typeof goal.revision !== 'string'
      || Object.keys(goal).some(k => !['workspaceId','id','revision','objective','status','currency','budgetRemainingMinor','perTaskCapMinor','capabilities','deadline'].includes(k))
      || typeof goal.objective !== 'string' || !goal.objective.trim()
      || !['active', 'paused', 'closed'].includes(goal.status) || !/^[A-Z]{3}$/u.test(goal.currency)
      || !Array.isArray(goal.capabilities) || goal.capabilities.some(c => !['analysis','draft','worker-order','external-contact','price-change','none'].includes(c))
      || ['budgetRemainingMinor','perTaskCapMinor'].some(k => goal[k] !== null && (!Number.isSafeInteger(goal[k]) || goal[k] < 0))) fail('BRAIN_GOAL_INVALID');
    if (goal.deadline !== null) timestamp(goal.deadline);
    return goal;
  }
  async function capture(sourceRefs, goalIds, receiver, signal) {
    validateSources(sourceRefs); unique(goalIds);
    const sources = [], goals = [];
    for (const reference of sourceRefs) {
      await gate('source.read', receiver, signal, { reference });
      const row = safeJson(await readSource({ binding: clone(binding), reference: clone(reference), receiver, signal }));
      if (row.workspaceId !== binding.workspaceId || !same(row.reference, reference)
        || Object.keys(row).some(k => !['workspaceId','reference','observedAt','validUntil','values'].includes(k))
        || !row.values || Array.isArray(row.values) || typeof row.values !== 'object'
        || !same(Object.keys(row.values).sort(), [...reference.fields].sort())) fail('BRAIN_SOURCE_SCOPE_MISMATCH');
      if (timestamp(row.observedAt) > now() || row.validUntil !== null && timestamp(row.validUntil) <= now()) fail('BRAIN_SOURCE_STALE');
      sources.push({ evidenceId: sourceId(reference), ...row, authority: 'source-observation-not-causal-proof' });
      await gate('source.read', receiver, signal, { reference });
    }
    for (const id of goalIds) {
      await gate('goal.read', receiver, signal, { goalId: id });
      goals.push(validateGoal(await readGoal({ binding: clone(binding), goalId: id, receiver, signal }), id));
    }
    await gate('context.validate', receiver, signal);
    if (await assertCurrent({ binding: clone(binding), sourceRefs: clone(sourceRefs), goalIds: [...goalIds], sources: clone(sources), goals: clone(goals), receiver, signal }) !== true) fail('BRAIN_SOURCE_STALE');
    cancelled(signal);
    safeJson({ sources, goals }, 96 * 1024);
    return { sources, goals };
  }
  function validateEnvelope(row, kind) {
    if (!row || !kinds.includes(kind)) fail('BRAIN_NOT_FOUND');
    const e = row.value;
    if (e.schema !== 1 || e.workspaceId !== binding.workspaceId || e.kind !== kind || e.key !== row.key
      || !Number.isSafeInteger(e.revision) || e.revision < 1 || !same(e.flags, flags)
      || Object.keys(e).some(k => !['schema','workspaceId','kind','key','revision','createdAt','updatedAt','authoredBy','originConversationId','lastRequest','payload','flags'].includes(k))) fail('BRAIN_RECORD_INVALID');
    timestamp(e.createdAt); timestamp(e.updatedAt);
    validate(kind === 'feedback' ? FEEDBACK_SCHEMA : INPUTS[`${kind}Save`], e.payload);
    if (typeof e.lastRequest?.id !== 'string' || e.lastRequest.fingerprint !== digest(e.payload)) fail('BRAIN_RECORD_INVALID');
    return e;
  }
  async function load(kind, id, receiver, signal) {
    await gate(`${kind}.read`, receiver, signal, { id });
    const row = await repository.get(keyFor(kind, id));
    if (row) validateEnvelope(row, kind);
    await gate(`${kind}.read`, receiver, signal, { id });
    return row;
  }
  async function contextState(receiver, signal) {
    const row = await load('context', '', receiver, signal);
    const captured = row ? await capture(row.value.payload.sourceRefs, row.value.payload.goalIds, receiver, signal) : { sources: [], goals: [] };
    return { row, captured };
  }
  async function decisionState(id, receiver, signal) {
    const context = await contextState(receiver, signal);
    const row = await load('decision', id, receiver, signal);
    if (!row) fail('BRAIN_NOT_FOUND');
    const d = row.value.payload;
    if (!context.row || d.contextRevision !== context.row.value.revision || !context.row.value.payload.goalIds.includes(d.goalId)) fail('BRAIN_CONTEXT_CHANGED');
    const captured = await capture(mergeSources(context.row.value.payload.sourceRefs, d.sourceRefs), [d.goalId], receiver, signal);
    const evaluations = d.options.map(option => evaluateOption(option, captured.goals[0]));
    return { context, row, captured, evaluations };
  }
  function receipt(kind, id, row, data) {
    const result = { plugin: PLUGIN, schema: 1, kind, id, bindingHash,
      status: row ? 'available' : 'empty', persisted: !!row,
      recordRef: row ? { key: row.key, ...row.ref, recordRevision: row.value.revision } : null,
      data, ...flags };
    return safeJson(result, 112 * 1024);
  }
  async function contextRead(_input = {}, signal, receiver) {
    validate(INPUTS.contextRead, _input);
    const { row, captured } = await contextState(receiver, signal);
    return receipt('context', '', row, { context: row?.value ?? null, ...captured, unknowns: row?.value.payload.unknowns ?? ['No business context has been saved. Ask for the business goal and approved sources.'] });
  }
  async function sourceCatalog(input = {}, signal, receiver) {
    validate(INPUTS.sourceCatalog, input);
    await gate('source.catalog', receiver, signal);
    if (typeof listAuthorizedSources !== 'function' || typeof listAuthorizedGoals !== 'function')
      return receipt('catalog', '', null, { status: 'unconfigured', sourceRefs: [], goalIds: [] });
    const sourceRefs = safeJson(await listAuthorizedSources({ binding: clone(binding), receiver, signal }), 24 * 1024);
    const goalIds = safeJson(await listAuthorizedGoals({ binding: clone(binding), receiver, signal }), 8 * 1024);
    validateSources(sourceRefs); unique(goalIds);
    if (!Array.isArray(goalIds) || goalIds.some(id => typeof id !== 'string' || !id.trim())) fail('BRAIN_GOAL_INVALID');
    await gate('source.catalog', receiver, signal);
    return receipt('catalog', '', null, { status: 'available', sourceRefs, goalIds });
  }
  async function diagnose(input = {}, signal, receiver) {
    validate(INPUTS.diagnose, input);
    await gate('diagnosis.read', receiver, signal);
    const { row, captured: savedCaptured } = await contextState(receiver, signal);
    let captured = savedCaptured;
    if (!row) {
      const catalog = await sourceCatalog({}, signal, receiver);
      const metricRefs = catalog.data.sourceRefs.filter(reference => reference.kind === 'metric');
      captured = metricRefs.length ? await capture(metricRefs, [], receiver, signal) : { sources: [], goals: [] };
    }
    const results = analyzeBusinessSources(captured.sources, now());
    await gate('diagnosis.read', receiver, signal);
    return receipt('diagnosis', '', row, { ...results, coldStart: !row });
  }
  async function decisionRead(input, signal, receiver) {
    validate(INPUTS.decisionRead, input);
    const state = await decisionState(input.id, receiver, signal);
    return receipt('decision', input.id, state.row, { decision: state.row.value, ...state.captured, evaluations: state.evaluations });
  }
  async function save(kind, input, receiver, signal, { refs, goals, dependencies = [] } = {}) {
    await gate(`${kind}.save`, receiver, signal);
    const key = keyFor(kind, input.id ?? input.decisionId);
    const existing = await repository.get(key);
    if (existing) validateEnvelope(existing, kind);
    if (input.expectedRevision >= Number.MAX_SAFE_INTEGER) fail('BRAIN_REVISION_CONFLICT');
    const fingerprint = digest(input);
    if (existing?.value.lastRequest.id === input.requestId) {
      if (existing.value.lastRequest.fingerprint !== fingerprint) fail('BRAIN_REQUEST_CHANGED');
      return existing;
    }
    if ((existing?.value.revision ?? 0) !== input.expectedRevision) fail('BRAIN_REVISION_CONFLICT');
    const captured = await capture(refs, goals, receiver, signal);
    if (kind === 'decision') {
      const selected = input.options.find(o => o.id === input.recommendation.optionId);
      if (evaluateOption(selected, captured.goals[0]).status === 'blocked') fail('BRAIN_RECOMMENDATION_BLOCKED');
    }
    const time = new Date(now()).toISOString();
    const value = { schema: 1, workspaceId: binding.workspaceId, kind, key,
      revision: input.expectedRevision + 1, createdAt: existing?.value.createdAt ?? time, updatedAt: time,
      authoredBy: binding.subject, originConversationId: binding.conversationId,
      lastRequest: { id: input.requestId, fingerprint }, payload: input, flags };
    await gate(`${kind}.save`, receiver, signal);
    const row = await repository.commit({ key, expectedRef: existing?.ref ?? null, value, dependencies,
      check(state) {
        cancelled(signal);
        const valid = assertCommit({ state, operation: `${kind}.save`, recordKey: key, requestId: input.requestId, binding: clone(binding), sourceRefs: clone(refs), goalIds: [...goals], sources: clone(captured.sources), goals: clone(captured.goals), receiver, signal });
        if (valid !== true) fail('BRAIN_COMMIT_REFUSED');
        return true;
      } });
    await gate(`${kind}.read`, receiver, signal);
    return row;
  }
  async function contextSave(raw, signal, receiver) {
    const input = validate(INPUTS.contextSave, raw);
    validateSources(input.sourceRefs); unique(input.goalIds);
    input.notes.forEach(n => validateEvidence(n.evidenceIds, input.sourceRefs));
    const saved = await save('context', input, receiver, signal, { refs: input.sourceRefs, goals: input.goalIds });
    const result = await contextRead({}, signal, receiver);
    if (result.recordRef.sha256 !== saved.ref.sha256) fail('BRAIN_REVISION_CONFLICT');
    return result;
  }
  async function decisionSave(raw, signal, receiver) {
    const input = validate(INPUTS.decisionSave, raw);
    const context = await contextState(receiver, signal);
    if (!context.row || context.row.value.revision !== input.contextRevision || !context.row.value.payload.goalIds.includes(input.goalId)) fail('BRAIN_CONTEXT_CHANGED');
    const refs = mergeSources(context.row.value.payload.sourceRefs, input.sourceRefs);
    unique(input.hypotheses.map(h => h.id)); unique(input.options.map(o => o.id));
    for (const h of input.hypotheses) {
      validateEvidence(h.supportingEvidence, refs); validateEvidence(h.contradictingEvidence, refs);
      if (!h.supportingEvidence.length && !h.missingEvidence.length) fail('BRAIN_HYPOTHESIS_UNGROUNDED');
      if (h.supportingEvidence.some(id => h.contradictingEvidence.includes(id))) fail('BRAIN_EVIDENCE_CONTRADICTION');
    }
    input.options.forEach(o => { validateEvidence(o.evidenceIds, refs); if (o.kind === 'wait' ? o.capability !== 'none' : o.capability === 'none') fail('BRAIN_OPTION_INVALID'); });
    if (!input.options.some(o => ['wait','investigate'].includes(o.kind))) fail('BRAIN_ALTERNATIVE_REQUIRED');
    const selected = input.options.find(o => o.id === input.recommendation.optionId);
    if (!selected) fail('BRAIN_OPTION_INVALID');
    const captureResult = await capture(refs, [input.goalId], receiver, signal);
    input.options.forEach(o => evaluateOption(o, captureResult.goals[0]));
    if (evaluateOption(selected, captureResult.goals[0]).status === 'blocked') fail('BRAIN_RECOMMENDATION_BLOCKED');
    const saved = await save('decision', input, receiver, signal, { refs, goals: [input.goalId], dependencies: [{ key: 'context', ref: context.row.ref }] });
    const result = await decisionRead({ id: input.id }, signal, receiver);
    if (result.recordRef.sha256 !== saved.ref.sha256) fail('BRAIN_REVISION_CONFLICT');
    return result;
  }
  async function reviewRead(id, signal, receiver) {
    const state = await decisionState(id, receiver, signal);
    const row = await load('review', id, receiver, signal);
    if (!row || row.value.payload.decisionRevision !== state.row.value.revision) fail('BRAIN_DECISION_CHANGED');
    const refs = mergeSources(state.context.row.value.payload.sourceRefs, state.row.value.payload.sourceRefs, row.value.payload.sourceRefs);
    const captured = await capture(refs, [state.row.value.payload.goalId], receiver, signal);
    const metric = captured.sources.find(s => s.evidenceId === row.value.payload.metricEvidenceId);
    if (!metric || metric.reference.kind !== 'metric') fail('BRAIN_METRIC_INVALID');
    const assessment = assessOutcome(metric.values, state.row.value.payload.recommendation.verification, state.row.value.updatedAt, now());
    return receipt('review', id, row, { review: row.value, ...captured, assessment });
  }
  async function reviewSave(raw, signal, receiver) {
    const input = validate(INPUTS.reviewSave, raw);
    const state = await decisionState(input.decisionId, receiver, signal);
    if (input.decisionRevision !== state.row.value.revision) fail('BRAIN_DECISION_CHANGED');
    const refs = mergeSources(state.context.row.value.payload.sourceRefs, state.row.value.payload.sourceRefs, input.sourceRefs);
    validateEvidence([input.metricEvidenceId], input.sourceRefs);
    const captured = await capture(refs, [state.row.value.payload.goalId], receiver, signal);
    const metric = captured.sources.find(s => s.evidenceId === input.metricEvidenceId);
    if (!metric || metric.reference.kind !== 'metric') fail('BRAIN_METRIC_INVALID');
    const assessment = assessOutcome(metric.values, state.row.value.payload.recommendation.verification, state.row.value.updatedAt, now());
    if (!assessment.sufficientEvidence && input.interpretation !== 'inconclusive') fail('BRAIN_INSUFFICIENT_EVIDENCE');
    const saved = await save('review', input, receiver, signal, { refs, goals: [state.row.value.payload.goalId], dependencies: [{ key: 'context', ref: state.context.row.ref }, { key: state.row.key, ref: state.row.ref }] });
    const result = await reviewRead(input.decisionId, signal, receiver);
    if (result.recordRef.sha256 !== saved.ref.sha256) fail('BRAIN_REVISION_CONFLICT');
    return result;
  }
  // Trusted human UI only. This is never registered as an LLM tool and is NOT
  // commercial approval, acceptance, or a source of execution permission.
  async function feedbackSave(raw, signal, receiver) {
    const input = validate(FEEDBACK_SCHEMA, raw);
    if (typeof authorizeHumanFeedback !== 'function' || await authorizeHumanFeedback({ binding: clone(binding), input: clone(input), signal }) !== true) fail('BRAIN_HUMAN_REQUIRED');
    if (input.disposition === 'snoozed' ? input.until === null || timestamp(input.until) <= now() : input.until !== null) fail('BRAIN_TIME_INVALID');
    const state = await decisionState(input.decisionId, receiver, signal);
    if (input.decisionRevision !== state.row.value.revision) fail('BRAIN_DECISION_CHANGED');
    await save('feedback', input, receiver, signal, { refs: mergeSources(state.context.row.value.payload.sourceRefs, state.row.value.payload.sourceRefs), goals: [state.row.value.payload.goalId], dependencies: [{ key: 'context', ref: state.context.row.ref }, { key: state.row.key, ref: state.row.ref }] });
    return { status: 'recorded', appliedTo: 'homepage-only', approvalGranted: false, executable: false };
  }
  async function brief(input = {}, signal, receiver) {
    validate(INPUTS.brief, input);
    await gate('brief.read', receiver, signal);
    const context = await contextRead({}, signal, receiver);
    if (!context.persisted) {
      const catalog = await sourceCatalog({}, signal, receiver);
      const metricRefs = catalog.data.sourceRefs.filter(reference => reference.kind === 'metric');
      const captured = metricRefs.length ? await capture(metricRefs, [], receiver, signal) : { sources: [], goals: [] };
      const diagnosis = analyzeBusinessSources(captured.sources, now());
      const decisionDrafts = diagnosis.signals.slice(0, 6).map(signal => draftDecisionFromDiagnosis({ diagnosis: { signals: [signal] }, context: null }));
      const pulse = buildBusinessPulse({
        context: { context: null, sources: captured.sources },
        diagnosis,
        decisionCards: [],
        decisionDrafts
      });
      return receipt('brief', '', null, {
        cards: pulse,
        savedDecisionCards: [],
        coldStart: true,
        gaps: context.data.unknowns,
        diagnosisStatus: diagnosis.status,
        sourceCount: captured.sources.length,
        decisionDrafts,
        truncated: catalog.data.sourceRefs.length > metricRefs.length,
        unavailableEntries: false
      });
    }
    const listing = await repository.listKeys('decision:', 200), cards = [];
    let unavailable = false;
    for (const key of listing.keys) {
      cancelled(signal);
      const id = key.slice('decision:'.length);
      try {
        const state = await decisionState(id, receiver, signal);
        const d = state.row.value.payload, goal = state.captured.goals[0];
        const evaluation = state.evaluations.find(e => e.optionId === d.recommendation.optionId);
        if (evaluation.status === 'blocked') continue;
        const feedback = await load('feedback', id, receiver, signal);
        const f = feedback?.value.payload;
        if (f && f.decisionRevision === state.row.value.revision && (f.disposition === 'dismissed' || f.disposition === 'snoozed' && timestamp(f.until) > now())) continue;
        const review = await load('review', id, receiver, signal);
        const hasOutcomeReview = review?.value.payload.decisionRevision === state.row.value.revision;
        const selected = d.options.find(o => o.id === d.recommendation.optionId);
        cards.push({ decisionId: id, decisionRevision: state.row.value.revision, goalId: d.goalId,
          title: selected.title, problem: d.problem, rationale: d.recommendation.rationale,
          mode: selected.kind, hasOutcomeReview, outcomeStatus: hasOutcomeReview ? 'awaiting-owner-review' : 'not-observed', evaluation, deadline: goal.deadline, updatedAt: state.row.value.updatedAt,
          evidence: state.captured.sources.map(s => ({ evidenceId: s.evidenceId, reference: s.reference, observedAt: s.observedAt })),
          decisionDraft: {
            status: 'persisted',
            revision: state.row.value.revision,
            goalId: d.goalId,
            businessGoalVerified: false,
            sourceRefs: d.sourceRefs,
            problem: d.problem,
            hypotheses: d.hypotheses,
            options: d.options,
            recommendation: d.recommendation
          },
          action: { kind: 'open-original-goal', goalId: d.goalId, decisionId: id }, executable: false });
      } catch (error) {
        if (!(error instanceof BrainError) || !['BRAIN_SOURCE_STALE','BRAIN_CONTEXT_CHANGED','BRAIN_AUTHORIZATION_REFUSED','BRAIN_NOT_FOUND'].includes(error.code)) throw error;
        unavailable = true;
      }
    }
    cards.sort((a,b) => (a.deadline === null ? Infinity : timestamp(a.deadline)) - (b.deadline === null ? Infinity : timestamp(b.deadline)) || b.updatedAt.localeCompare(a.updatedAt) || a.decisionId.localeCompare(b.decisionId));
    const seen = new Set(), uniqueCards = cards.filter(c => { const key = digest([c.goalId,c.problem]); if (seen.has(key)) return false; seen.add(key); return true; });
    const diagnosis = analyzeBusinessSources(context.data.sources || [], now());
    const decisionDrafts = diagnosis.signals.slice(0, 6).map(signal => draftDecisionFromDiagnosis({ diagnosis: { signals: [signal] }, context: context.data }));
    const pulse = buildBusinessPulse({ context: context.data, diagnosis, decisionCards: uniqueCards, decisionDrafts });
    await gate('brief.read', receiver, signal);
    return receipt('brief', '', { key: context.recordRef.key, ref: { artifactId: context.recordRef.artifactId, revision: context.recordRef.revision, version: context.recordRef.version, sha256: context.recordRef.sha256 }, value: { revision: context.recordRef.recordRevision } },
      { cards: pulse, savedDecisionCards: uniqueCards.slice(0,3), coldStart: false, gaps: context.data.unknowns, diagnosisStatus: diagnosis.status, decisionDrafts, truncated: listing.truncated || uniqueCards.length > 3 || pulse.length < uniqueCards.length, unavailableEntries: unavailable });
  }
  /** The original Host MUST run this before provider sends, after restore and
   * compaction, and before final delivery. An extension event alone is not a
   * security boundary: some SDKs catch extension exceptions. */
  async function revalidateReceipt(received, signal, receiver) {
    safeJson(received, 112 * 1024);
    if (received.plugin !== PLUGIN || received.bindingHash !== bindingHash) fail('BRAIN_CACHE_REFUSED');
    let actual;
    if (received.kind === 'context') actual = await contextRead({}, signal, receiver);
    else if (received.kind === 'decision') actual = await decisionRead({ id: received.id }, signal, receiver);
    else if (received.kind === 'diagnosis') actual = await diagnose({}, signal, receiver);
    else if (received.kind === 'catalog') actual = await sourceCatalog({}, signal, receiver);
    else if (received.kind === 'review') actual = await reviewRead(received.id, signal, receiver);
    else if (received.kind === 'brief') actual = await brief({}, signal, receiver);
    else fail('BRAIN_CACHE_REFUSED');
    if (!same(received, actual)) fail('BRAIN_CACHE_REFUSED');
    return true;
  }
  return Object.freeze({ sourceCatalog, contextRead, contextSave, diagnose, decisionRead, decisionSave, reviewSave, reviewRead, feedbackSave, brief, revalidateReceipt });
}
