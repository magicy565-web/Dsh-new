import { createBusinessBrain } from '../plugins/workspace-goal-intelligence/src/brain.mjs';
import { createArtifactBrainRepository } from '../plugins/workspace-goal-intelligence/src/artifact-repository.mjs';
import { clone, digest, fail, same } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { libraryReadHash, libraryRecipientForModel } from './library-model-read-contract.mjs';
import { looksLikeCredential } from './security.mjs';
import { assertEnterpriseMemoryFactReader } from './workspace-enterprise-context-host.mjs';

const own = (value, allowed) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key));
const writable = role => ['admin', 'operator'].includes(role);
const originalGoalStatuses = new Set(['draft', 'running', 'paused', 'completed', 'failed', 'cancelled']);
const businessCapabilities = new Set(['analysis', 'draft', 'none']);
const documentReferenceFields = ['documentId', 'documentRevision', 'documentVersion', 'artifactId', 'artifactVersion', 'artifactSha256'];
const memoryFactFields = ['memoryId', 'subjectType', 'subjectId', 'factKey', 'statement', 'source'];

/**
 * Original Host ONLY: bind the existing enterprise Session, reviewed Library
 * field selection and original Artifact/Store to one logical Business Brain.
 * The optional reviewed goal policy is an explicit management assertion, never
 * inferred from a model, an execution Goal title or an HTTP request body.
 * No second Agent, provider, queue, task ledger or database is created.
 */
export function createGoalBrainHost({ store, artifacts, access, libraryModelRead,
  originalReceiver, reviewedGoals = [], sourceAdapter = null, clock = Date.now } = {}) {
  if (!store?.read || !artifacts?.read || !artifacts?.create || !access?.nativeSessionById
    || !libraryModelRead?.businessBrainForSession || !originalReceiver || typeof clock !== 'function'
    || !Array.isArray(reviewedGoals)
    || sourceAdapter !== null && (!own(sourceAdapter, ['list', 'read', 'current']) || typeof sourceAdapter.list !== 'function' || typeof sourceAdapter.read !== 'function' || typeof sourceAdapter.current !== 'function')) fail('BRAIN_HOST_UNCONFIGURED');
  const exactReceiverHash = libraryReadHash(libraryRecipientForModel(originalReceiver));
  const goalRules = new Map();
  for (const entry of reviewedGoals) {
    if (!own(entry, ['id', 'originalRevision', 'currency', 'businessStatus', 'capabilities', 'budgetRemainingMinor', 'perTaskCapMinor', 'reviewed'])
      || entry.reviewed !== true || typeof entry.id !== 'string' || !/^[a-f0-9-]{36}$/iu.test(entry.id)
      || !Number.isSafeInteger(entry.originalRevision) || entry.originalRevision < 0
      || !/^[A-Z]{3}$/u.test(entry.currency || '') || !['active','paused','closed'].includes(entry.businessStatus)
      || !Array.isArray(entry.capabilities) || entry.capabilities.some(capability => !businessCapabilities.has(capability))
      || entry.budgetRemainingMinor !== null || entry.perTaskCapMinor !== null
      || goalRules.has(entry.id)) fail('BRAIN_GOAL_POLICY_INVALID');
    goalRules.set(entry.id, clone(entry));
  }
  function checkIdentity(identity, conversationId, needWrite = false) {
    if (!identity || !identity.sessionId || !identity.subject || !identity.workspaceId || !identity.role || typeof conversationId !== 'string') fail('BRAIN_SESSION_REQUIRED');
    if (access.mode !== 'enterprise') fail('BRAIN_ENTERPRISE_SESSION_REQUIRED');
    const session = access.nativeSessionById(identity.sessionId);
    if (!session || ['workspaceId','subject','role'].some(k => session[k] !== identity[k])) fail('BRAIN_SESSION_EXPIRED');
    const conversation = store.read().conversations.find(c => c.id === conversationId && c.workspaceId === identity.workspaceId);
    if (!conversation || (conversation.createdBy !== identity.subject && !(conversation.businessAgentOwner?.subject === identity.subject && conversation.businessAgentOwner.workspaceId === identity.workspaceId))) fail('BRAIN_CONVERSATION_NOT_OWNED');
    if (needWrite && !writable(identity.role)) fail('BRAIN_ROLE_REFUSED');
    return session;
  }
  function goalProjection(state, id, workspaceId, subject) {
    const policy = goalRules.get(id);
    if (!policy) fail('BRAIN_GOAL_NOT_REVIEWED');
    const goal = state.goals.find(g => g.id === id);
    if (!goal || !originalGoalStatuses.has(goal.status) || goal.revision !== policy.originalRevision
      || (policy.businessStatus === 'active' && ['completed','cancelled','failed'].includes(goal.status))) fail('BRAIN_GOAL_CHANGED');
    const ownerConversation = state.conversations.find(c => c.id === goal.conversationId && c.workspaceId === workspaceId &&
      (c.createdBy === subject || (c.businessAgentOwner?.subject === subject && c.businessAgentOwner.workspaceId === workspaceId)));
    if (!ownerConversation) fail('BRAIN_GOAL_NOT_OWNED');
    return {
      workspaceId, id, revision: String(goal.revision),
      objective: goal.description ? `${goal.title}: ${goal.description}` : goal.title,
      status: policy.businessStatus,
      currency: policy.currency,
      budgetRemainingMinor: policy.budgetRemainingMinor,
      perTaskCapMinor: policy.perTaskCapMinor,
      capabilities: clone(policy.capabilities), deadline: null,
    };
  }
  function bind({ identity, conversationId, runId = null, canSubmit = false, uiWrite = false, memoryFacts = null, nativeSessionId = null, signal } = {}) {
    checkIdentity(identity, conversationId, uiWrite === true);
    const selection = libraryModelRead.businessBrainForSession({ identity, recipientHash: exactReceiverHash, signal });
    if (!selection?.assertCurrent || !selection?.scope) fail('BRAIN_ORIGINAL_LIBRARY_POLICY_REQUIRED');
    const scope = selection.scope;
    if (memoryFacts !== null) {
      assertEnterpriseMemoryFactReader(memoryFacts);
      memoryFacts.assertBinding({ identity, conversationId, runId, nativeSessionId, receiver: originalReceiver }, signal);
    }
    const factQueries = new Map((memoryFacts?.queries() || []).map(query => [`fact:${libraryReadHash(query)}`, query]));
    const factSnapshots = new Map();
    const binding = {
      workspaceId: identity.workspaceId, subject: identity.subject, sessionId: identity.sessionId,
      conversationId, scopeVersion: libraryReadHash(memoryFacts ? { ...scope, memoryFacts: memoryFacts.scopeHash } : scope),
      receiver: { provider: originalReceiver.provider, id: originalReceiver.id },
    };
    function assertLive(state, write = false, operation = '') {
      signal?.throwIfAborted();
      checkIdentity(identity, conversationId, write);
      selection.assertCurrent();
      memoryFacts?.assertBinding({ identity, conversationId, runId, nativeSessionId, receiver: originalReceiver }, signal);
      if (write) {
        const memoryWrite = ['context.save', 'decision.save', 'review.save', 'feedback.save', 'brain.repository.write'].includes(operation);
        const uiMemoryWrite = ['review.save', 'feedback.save'].includes(operation);
        // Only owner outcome-review/feedback writes are exposed to the human
        // Brain UI. Context and decision authoring remain Agent-run gated.
        if (!(uiWrite && uiMemoryWrite)) {
          if (typeof runId !== 'string') fail('BRAIN_EXECUTION_INTENT_REQUIRED');
          const run = (state || store.read()).runs?.find(r => r.id === runId && r.conversationId === conversationId && r.status === 'running');
          if (!run || run.businessAgentContext?.subject !== identity.subject || run.businessAgentContext?.workspaceId !== identity.workspaceId)
            fail('BRAIN_EXECUTION_INTENT_REQUIRED');
          // Model-authored Brain memory writes require the current Run but do
          // not inherit businessSubmit approval. External actions remain behind
          // the original Workspace execution gates.
          if (!memoryWrite && canSubmit !== true)
            fail('BRAIN_EXECUTION_INTENT_REQUIRED');
        }
      }
      if (state && (!Array.isArray(state.artifacts) || !Array.isArray(state.goals) || !state.businessLibrary)) fail('BRAIN_ORIGINAL_STORE_REQUIRED');
    }
    const readSelected = (state, reference) => {
      assertLive(state);
      const policy = reference.kind === 'company' ? scope.company && { id: 'company', revision: scope.company.revision, fields: scope.company.fields }
        : reference.kind === 'product' && scope.products.find(row => row.id === reference.id)
          ? { ...scope.products.find(row => row.id === reference.id), fields: scope.productFields } : null;
      if (!policy) fail('BRAIN_SOURCE_NOT_SELECTED');
      if (reference.id !== policy.id || reference.revision !== String(policy.revision)
        || !same(reference.fields, policy.fields)) fail('BRAIN_SOURCE_NOT_SELECTED');
      const record = reference.kind === 'company' ? state.businessLibrary.company
        : state.businessLibrary.products.find(item => item.id === reference.id);
      if (!record || record.revision !== policy.revision || !record.updatedAt) fail('BRAIN_SOURCE_CHANGED');
      const values = Object.fromEntries(policy.fields.map(field => [field, record[field]]));
      if (policy.fields.some(field => typeof values[field] !== 'string') || looksLikeCredential(JSON.stringify(values))) fail('BRAIN_SOURCE_UNSAFE');
      if (digest(values) !== reference.sha256) fail('BRAIN_SOURCE_CHANGED');
      return { workspaceId: identity.workspaceId, reference: clone(reference), observedAt: record.updatedAt,
        validUntil: scope.expiresAt, values };
    };
    const readDocumentReference = (state, pin, reference = null) => {
      assertLive(state);
      if (!pin || reference && (reference.id !== pin.id || reference.revision !== String(pin.revision)
        || !same(reference.fields, documentReferenceFields))) fail('BRAIN_SOURCE_NOT_SELECTED');
      // Reuse the original live Session/receiver/exact-document authority. This
      // projects reference metadata only; it never downloads or extracts bytes.
      const source = libraryModelRead.factoryDocumentForSession({ identity, recipientHash: exactReceiverHash, asset: pin.asset, signal });
      if (source.documentId !== pin.id || source.revision !== pin.revision || source.documentVersion !== pin.documentVersion
        || !same(source.asset, pin.asset)) fail('BRAIN_SOURCE_CHANGED');
      const record = state.businessLibrary.documents?.find(row => row.id === source.documentId);
      if (!record?.updatedAt || record.revision !== source.revision || record.currentVersion !== source.documentVersion
        || record.status !== 'active' || !same(record.versions?.find(row => row.version === source.documentVersion)?.asset, source.asset))
        fail('BRAIN_SOURCE_CHANGED');
      const values = { documentId: source.documentId, documentRevision: source.revision, documentVersion: source.documentVersion,
        artifactId: source.asset.artifactId, artifactVersion: source.asset.version, artifactSha256: source.asset.sha256 };
      const selected = { kind: 'artifact', id: pin.id, revision: String(pin.revision), sha256: digest(values), fields: clone(documentReferenceFields) };
      if (reference && !same(reference, selected)) fail('BRAIN_SOURCE_CHANGED');
      return { workspaceId: identity.workspaceId, reference: selected, observedAt: record.updatedAt, validUntil: scope.expiresAt, values };
    };
    const documentPin = reference => scope.documentReferences?.find(row => row.id === reference.id);
    const factProjection = (id, memory) => {
      const values = { memoryId: memory.id, subjectType: memory.subjectType, subjectId: memory.subjectId, factKey: memory.factKey,
        statement: memory.statement, source: clone(memory.source) };
      if (looksLikeCredential(JSON.stringify(values))) fail('BRAIN_SOURCE_UNSAFE');
      return { workspaceId: identity.workspaceId,
        reference: { kind: 'memory-fact', id, revision: String(memory.revision), sha256: digest(values), fields: clone(memoryFactFields) },
        observedAt: memory.updatedAt, validUntil: memory.expiresAt && memory.expiresAt < scope.expiresAt ? memory.expiresAt : scope.expiresAt, values };
    };
    const readMemoryFact = async (id, reference, signal) => {
      const query = factQueries.get(id);
      if (!query || reference && !same(reference.fields, memoryFactFields)) fail('BRAIN_SOURCE_NOT_SELECTED');
      const result = await memoryFacts.lookup(query, signal, originalReceiver);
      if (!result.found) { if (reference) fail('BRAIN_SOURCE_CHANGED'); return null; }
      const row = factProjection(id, result.memory);
      if (reference && !same(row.reference, reference)) fail('BRAIN_SOURCE_CHANGED');
      factSnapshots.set(id, clone(result.memory)); return row;
    };
    const readSource = async (reference, receiver, signal) => {
      assertLive(store.read());
      signal?.throwIfAborted();
      if (reference.kind === 'company' || reference.kind === 'product') return readSelected(store.read(), reference);
      if (reference.kind === 'artifact' && documentPin(reference)) return readDocumentReference(store.read(), documentPin(reference), reference);
      if (reference.kind === 'memory-fact') return readMemoryFact(reference.id, reference, signal);
      if (!sourceAdapter) fail('BRAIN_SOURCE_NOT_SELECTED');
      const row = clone(await sourceAdapter.read({ identity: clone(identity), binding: clone(binding), reference: clone(reference), receiver, signal }));
      if (!row || row.workspaceId !== identity.workspaceId || !same(row.reference, reference)
        || Object.keys(row).some(key => !['workspaceId','reference','observedAt','validUntil','values'].includes(key))
        || looksLikeCredential(JSON.stringify(row.values)))
        fail('BRAIN_SOURCE_SCOPE_MISMATCH');
      assertLive(store.read()); signal?.throwIfAborted();
      return row;
    };
    const catalog = async (signal = null) => {
      assertLive();
      signal?.throwIfAborted();
      const state = store.read(), entries = [];
      const add = (kind, id, fields, revision) => {
        const record = kind === 'company' ? state.businessLibrary.company : state.businessLibrary.products.find(r => r.id === id);
        if (!record || record.revision !== revision) fail('BRAIN_SOURCE_CHANGED');
        const values = Object.fromEntries(fields.map(field => [field, record[field]]));
        if (fields.some(field => typeof values[field] !== 'string') || looksLikeCredential(JSON.stringify(values))) fail('BRAIN_SOURCE_UNSAFE');
        const reference = { kind, id, revision: String(revision), sha256: digest(values), fields: clone(fields) };
        entries.push(reference);
      };
      if (scope.company) add('company', 'company', scope.company.fields, scope.company.revision);
      for (const row of scope.products) add('product', row.id, scope.productFields, row.revision);
      if (sourceAdapter) {
        const extra = clone(await sourceAdapter.list({ identity: clone(identity), binding: clone(binding), receiver: binding.receiver, signal }));
        if (!Array.isArray(extra)) fail('BRAIN_SOURCE_CATALOG_INVALID');
        entries.push(...extra);
      }
      for (const pin of scope.documentReferences || []) entries.push(readDocumentReference(store.read(), pin).reference);
      for (const id of factQueries.keys()) { const row = await readMemoryFact(id, null, signal); if (row) entries.push(row.reference); }
      assertLive();
      return entries;
    };
    const authorizeRecord = ({ operation, workspaceId }) => {
      // The Brain artifact repository is exclusively for private Brain memory.
      // A human-owned UI write is already role/session gated, so it does not
      // need an unrelated running Agent turn. Model-authored writes still do.
      assertLive(undefined, operation.endsWith('.save') || operation === 'brain.write', operation);
      return workspaceId === identity.workspaceId;
    };
    const repository = createArtifactBrainRepository({ store, artifacts, workspaceId: identity.workspaceId, authorizeRecord });
    const currentSource = (state, ref, expected) => {
      const next = (ref.kind === 'company' || ref.kind === 'product')
        ? readSelected(state, ref)
        : ref.kind === 'artifact' && documentPin(ref) ? readDocumentReference(state, documentPin(ref), ref)
        : ref.kind === 'memory-fact' && factQueries.has(ref.id) ? factProjection(ref.id,
          memoryFacts.current(factQueries.get(ref.id), factSnapshots.get(ref.id), { state, receiver: originalReceiver, signal }))
        : sourceAdapter?.current({ identity: clone(identity), binding: clone(binding), reference: clone(ref), expected: clone(expected), receiver: binding.receiver });
      if (!next || !same(next, { workspaceId: expected.workspaceId, reference: expected.reference,
        observedAt: expected.observedAt, validUntil: expected.validUntil, values: expected.values })) fail('BRAIN_SOURCE_CHANGED');
    };
    const current = ({ binding: b, sourceRefs, goalIds, sources, goals, signal: subSignal, operation, state }) => {
      subSignal?.throwIfAborted();
      if (!same(b, binding)) fail('BRAIN_IDENTITY_CHANGED');
      assertLive(state, !!operation, operation);
      const snapshot = state || store.read();
      for (let i = 0; i < sourceRefs.length; i++) currentSource(snapshot, sourceRefs[i], sources[i]);
      goalIds.forEach((id, i) => { if (!same(goalProjection(snapshot, id, identity.workspaceId, identity.subject), goals[i])) fail('BRAIN_GOAL_CHANGED'); });
      return true;
    };
    const brain = createBusinessBrain({ binding, repository, now: clock,
      authorize: ({ action, receiver }) => {
        assertLive(undefined, action.endsWith('.save'), action);
        return same({provider:receiver?.provider,id:receiver?.id},binding.receiver) && (!receiver?.baseUrl || libraryReadHash(libraryRecipientForModel(receiver))===exactReceiverHash);
      },
      readSource: ({ reference, receiver, signal }) => readSource(reference, receiver, signal),
      readGoal: ({ goalId }) => goalProjection(store.read(), goalId, identity.workspaceId, identity.subject),
      assertCurrent: current, assertCommit: current,
      listAuthorizedSources: ({ signal }) => catalog(signal),
      listAuthorizedGoals: () => [...goalRules.keys()].filter(id => {
        try { goalProjection(store.read(), id, identity.workspaceId, identity.subject); return true; } catch { return false; }
      }),
      authorizeHumanFeedback: () => ['admin', 'operator'].includes(identity.role),
    });
    return Object.freeze({ brain, binding: clone(binding), sourceCatalog: catalog,
      goalCatalog: () => [...goalRules.keys()], assertLive: () => assertLive(),
      revalidateReceipt: brain.revalidateReceipt });
  }
  return Object.freeze({ bind });
}
