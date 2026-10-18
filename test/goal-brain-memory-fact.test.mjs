// Original Host, Library permission class and memory ledger; synthetic Store,
// document bytes, identities and existing test-only SQLite Artifact facade.
// No provider/Docling HTTP, enterprise data or receipt-restoration test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGoalBrainHost } from '../server/goal-brain-host.mjs';
import { createLibraryModelRead } from '../server/library-model-read.mjs';
import { createEnterpriseMemoryLedger } from '../server/enterprise-memory-ledger.mjs';
import { createEnterpriseContextSessionBinding } from '../server/workspace-enterprise-context-host.mjs';
import { libraryReadHash, libraryRecipientForModel } from '../server/library-model-read-contract.mjs';
import { sourceId } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { openFixture, contextInput, decisionInput } from './fixtures/goal-brain-fixture.mjs';

const model = { provider: 'workspace-agent-test-faux', id: 'workspace-agent-test', api: 'faux' };
const now = Date.parse('2026-10-17T10:00:00Z'), workspaceId = 'synthetic-facts', conversationId = 'synthetic-conversation';
const sessionId = 'synthetic-session', nativeSessionId = 'synthetic-native-session', runId = 'synthetic-run', requestId = 'synthetic-request';
const goalId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce21';
const query = { subjectType: 'product', subjectId: 'synthetic-bottle', factKey: 'moq' };
const otherQuery = { ...query, factKey: 'unselected' };
const statement = 'SYNTHETIC selected MOQ is 120 units; source observation only.';
const code = expected => error => error.code === expected;

async function setup(t, { allowMemoryRead = true, configured = true } = {}) {
  const fixture = openFixture(); t.after(() => fixture.close());
  const state = { now, downloads: 0, parserCalls: 0, commitOverride: null };
  const docs = [0, 1].map(i => {
    const bytes = Buffer.from(`SYNTHETIC document ${i}; no actual enterprise content.`);
    const id = `abb85140-d87d-428d-bdd9-eb74f5b8ce3${i}`, artifactId = `abb85140-d87d-428d-bdd9-eb74f5b8ce4${i}`;
    const asset = { artifactId, version: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
    return { id, bytes, asset, revision: 1, currentVersion: 1, status: 'active', updatedAt: new Date(now - 1000).toISOString(), versions: [{ version: 1, asset }] };
  });
  const persisted = {
    businessLibrary: { version: 1, company: null, products: [], documents: docs, enterpriseMemories: [] },
    artifacts: docs.map(d => ({ id: d.asset.artifactId, metadata: { businessLibrary: { visibility: 'internal' } }, versions: [{ version: 1, sha256: d.asset.sha256 }] })),
    goals: [{ id: goalId, conversationId, title: 'Review an explicitly selected synthetic fact', status: 'draft', revision: 1 }],
    conversations: [{ id: conversationId, workspaceId, createdBy: 'owner', activeRunId: runId, businessAgentOwner: { subject: 'owner', workspaceId } }],
    runs: [{ id: runId, conversationId, requestId, status: 'running', businessAgentContext: { subject: 'owner', workspaceId, sessionId, role: 'operator' } }],
    messages: [{ id: 'synthetic-user-message', conversationId, requestId, role: 'user', status: 'complete', content: 'SYNTHETIC user-selected facts for this isolated test.' }],
  };
  const store = { read: () => ({ ...persisted, artifacts: [...persisted.artifacts, ...fixture.store.read().artifacts] }), update: async fn => fn(persisted) };
  const admissionState = () => state.commitOverride ? state.commitOverride(structuredClone(store.read())) : store.read();
  const artifacts = { read: fixture.artifacts.read,
    async download(id, { version }) { state.downloads++; const d = docs.find(d => d.asset.artifactId === id); assert.equal(version, 1); return { bytes: Buffer.from(d.bytes), version: { sha256: d.asset.sha256 } }; },
    create: (body, admission) => fixture.artifacts.create(body, { ...admission, check: () => admission.check(admissionState()) }),
    update: (id, body, admission) => fixture.artifacts.update(id, body, { ...admission, check: () => admission.check(admissionState()) }),
  };
  const identity = { sessionId, subject: 'owner', workspaceId, role: 'operator' };
  const sessions = new Map([[sessionId, { ...identity }]]), access = { mode: 'enterprise', nativeSessionById: id => sessions.get(id) };
  const policy = { enabled: true, reviewed: true, workspaceId, subject: 'owner', expiresAt: '2026-10-18T00:00:00Z',
    recipient: libraryRecipientForModel(model), company: null, products: [], productFields: ['name'],
    factoryMaterials: { products: [], productFields: ['name'], documents: docs.map(d => ({ id: d.id, revision: 1, documentVersion: 1, asset: structuredClone(d.asset) })) } };
  const library = { getProduct: () => ({ product: null }), getDocument: id => ({ document: structuredClone(docs.find(d => d.id === id)) }) };
  const libraryModelRead = createLibraryModelRead({ library, artifacts, access, policy, clock: () => state.now });
  const ledger = createEnterpriseMemoryLedger({ store, library, workspaceId, clock: () => state.now });
  const connection = { reviewed: true, baseURL: 'https://synthetic-docling.invalid', apiKey: 'synthetic-only-docling-screen-value',
    fetchImpl: async () => { state.parserCalls++; throw Error('No Docling request is authorized in this test'); } };
  const makeControl = async ({ read = allowMemoryRead, write = false, configuredConnection = configured, nativeId = nativeSessionId } = {}) => {
    const binding = await createEnterpriseContextSessionBinding({ identity, access, instanceId: 'synthetic-instance', store, artifacts, libraryModelRead,
      sessionClient: { readOnlySession: true, bindingIdentity: async () => ({ ...identity, instanceId: 'synthetic-instance' }) },
      recipient: policy.recipient, selection: { enabled: true, reviewed: true, customerId: 'synthetic-customer',
        sources: docs.map(d => ({ documentId: d.id, asset: structuredClone(d.asset) })), allowMemoryRead: read, allowMemoryWrite: write },
      connection: configuredConnection ? connection : {}, memoryLedger: ledger, clock: () => state.now });
    return binding.open(nativeId, { conversationId, runId, requestId });
  };
  // Synthetic preparation uses the existing explicitly authorized write path.
  // The capability under test is subsequently opened with allowMemoryWrite=false.
  const writer = await makeControl({ read: true, write: true, configuredConnection: true });
  await writer.structuredMemoryRemember({ ...query, statement }, undefined, model);
  await writer.structuredMemoryRemember({ ...otherQuery, statement: 'SYNTHETIC_UNSELECTED_FACT_MUST_NOT_LEAVE_HOST' }, undefined, model);
  const control = await makeControl();
  const host = createGoalBrainHost({ store, artifacts, access, libraryModelRead, originalReceiver: model, clock: () => state.now,
    reviewedGoals: [{ id: goalId, originalRevision: 1, currency: 'USD', businessStatus: 'active',
      capabilities: ['analysis', 'draft', 'none'], budgetRemainingMinor: null, perTaskCapMinor: null, reviewed: true }] });
  const bind = (memoryFacts = control.readOnlyFacts([query])) => host.bind({ identity, conversationId, runId, nativeSessionId, memoryFacts });
  return { fixture, state, docs, persisted, store, artifacts, identity, sessions, policy, ledger, control, writer, host, bind, makeControl };
}
async function selected(client) {
  const result = await client.brain.sourceCatalog({}, undefined, client.binding.receiver);
  const refs = result.data.sourceRefs.filter(ref => ref.kind === 'memory-fact');
  assert.equal(refs.length, 1); return refs[0];
}
const context = refs => contextInput(refs, { goalIds: [goalId] });
function decision(ref) {
  const value = decisionInput('memory-fact-decision', { goalId, sourceRefs: [ref] });
  value.hypotheses[0].supportingEvidence = [sourceId(ref)]; value.options[0].evidenceIds = [sourceId(ref)]; return value;
}

test('original read-only fact authority feeds Context, Decision and an existing Goal with exact complete provenance', async t => {
  const f = await setup(t), client = f.bind(), ref = await selected(client), goals = structuredClone(f.persisted.goals);
  const saved = await client.brain.contextSave(context([ref]), undefined, client.binding.receiver);
  assert.equal(saved.persisted, true); assert.equal(ref.kind, 'memory-fact');
  const values = saved.data.sources[0].values;
  assert.equal(values.statement, statement); assert.equal(values.factKey, query.factKey);
  assert.equal(values.source.dependencies.length, 2);
  assert.deepEqual(values.source.dependencies.map(d => d.sha256), f.docs.map(d => d.asset.sha256));
  assert.equal(values.memoryId, f.persisted.businessLibrary.enterpriseMemories.find(row => row.factKey === query.factKey).id);
  const decided = await client.brain.decisionSave(decision(ref), undefined, client.binding.receiver);
  assert.equal(decided.data.decision.payload.goalId, goalId); assert.equal(decided.executable, false); assert.equal(decided.humanReviewed, false);
  assert.deepEqual(f.persisted.goals, goals); assert.equal(f.fixture.state.commitCount, 2);
  assert.ok(f.state.downloads >= 4); assert.equal(f.state.parserCalls, 0);
  assert.doesNotMatch(JSON.stringify([saved, decided]), /credentialScreening|synthetic-only-docling|SYNTHETIC_UNSELECTED|"history"/);
});

test('no capability leaves the original Brain scope hash and metadata-only behavior unchanged', async t => {
  const f = await setup(t), client = f.bind(null);
  const result = await client.brain.sourceCatalog({}, undefined, client.binding.receiver);
  assert.ok(result.data.sourceRefs.every(ref => ref.kind === 'artifact'));
  const scope = f.policy;
  assert.equal(client.binding.scopeVersion, libraryReadHash({ workspaceId, subject: 'owner', expiresAt: scope.expiresAt,
    company: null, products: [], productFields: ['name'], documentReferences: scope.factoryMaterials.documents }));
  assert.equal(f.state.downloads, 0);
});

test('only original branded read-only authority and explicit bounded exact keys are accepted', async t => {
  const f = await setup(t);
  assert.throws(() => f.bind({ lookup() {}, current() {} }), code('OSS_ORIGINAL_MEMORY_READER_REQUIRED'));
  for (const keys of [[], [query, query], [{ ...query, wildcard: true }], Array.from({ length: 9 }, (_, i) => ({ ...query, factKey: `key-${i}` }))])
    assert.throws(() => f.control.readOnlyFacts(keys), code('OSS_MEMORY_FACT_SELECTION_REQUIRED'));
  const reader = f.control.readOnlyFacts([query]);
  assert.equal(reader.structuredMemoryRemember, undefined); assert.equal(reader.parseUpload, undefined);
  await assert.rejects(() => reader.lookup(otherQuery, undefined, model), code('OSS_MEMORY_FACT_NOT_SELECTED'));
  assert.throws(() => f.host.bind({ identity: f.identity, conversationId, runId: 'different-run', nativeSessionId, memoryFacts: reader }), code('OSS_ORIGINAL_RUN_CHANGED'));
  assert.throws(() => f.host.bind({ identity: f.identity, conversationId, runId, memoryFacts: reader }), code('OSS_NATIVE_SESSION_REQUIRED'));
  assert.throws(() => f.host.bind({ identity: f.identity, conversationId, runId, nativeSessionId: 'different-native-session', memoryFacts: reader }), code('OSS_NATIVE_SESSION_REQUIRED'));
  const otherNative = (await f.makeControl({ nativeId: 'different-native-session' })).readOnlyFacts([query]);
  assert.notEqual(reader.scopeHash, otherNative.scopeHash);
});

test('original allowMemoryRead and configured screening prerequisites are not defaulted on', async t => {
  for (const options of [{ allowMemoryRead: false }, { configured: false }]) {
    const f = await setup(t, options);
    assert.throws(() => f.bind(), code('OSS_STRUCTURED_MEMORY_NOT_AUTHORIZED'));
    assert.equal(f.fixture.state.commitCount, 0); assert.equal(f.state.parserCalls, 0);
  }
});

test('missing exact-key fact is absent from catalog and cannot be invented by source reference', async t => {
  const f = await setup(t), missing = { ...query, factKey: 'missing' };
  const client = f.bind(f.control.readOnlyFacts([missing]));
  const catalog = await client.brain.sourceCatalog({}, undefined, client.binding.receiver);
  assert.equal(catalog.data.sourceRefs.filter(ref => ref.kind === 'memory-fact').length, 0);
  const other = f.bind(), ref = await selected(other);
  await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver), code('BRAIN_SOURCE_NOT_SELECTED'));
  assert.equal(f.fixture.state.commitCount, 0);
});

test('fact reference IDs, fields, revisions and projection hashes remain exact', async t => {
  const f = await setup(t), client = f.bind(), ref = await selected(client);
  for (const [change, error] of [[{ id: 'fact:unselected' }, 'BRAIN_SOURCE_NOT_SELECTED'], [{ fields: [...ref.fields, 'history'] }, 'BRAIN_SOURCE_NOT_SELECTED'],
    [{ revision: '999' }, 'BRAIN_SOURCE_CHANGED'], [{ sha256: 'f'.repeat(64) }, 'BRAIN_SOURCE_CHANGED']])
    await assert.rejects(() => client.brain.contextSave(context([{ ...ref, ...change }]), undefined, client.binding.receiver), code(error));
  assert.equal(f.fixture.state.commitCount, 0);
});

test('ordinary fact update and revocation invalidate previously captured source evidence', async t => {
  for (const action of ['update', 'revoke']) await t.test(action, async t => {
    const f = await setup(t), client = f.bind(), ref = await selected(client);
    await client.brain.contextSave(context([ref]), undefined, client.binding.receiver);
    const row = f.persisted.businessLibrary.enterpriseMemories.find(row => row.factKey === query.factKey && row.status === 'active');
    if (action === 'update') await f.writer.structuredMemoryRemember({ ...query, statement: 'SYNTHETIC updated MOQ is 150.' }, undefined, model);
    else await f.ledger.revoke(row.id, {}, f.identity);
    await assert.rejects(() => client.brain.contextRead({}, undefined, client.binding.receiver), code('BRAIN_SOURCE_CHANGED'));
    assert.equal(f.fixture.state.commitCount, 1);
  });
});

test('fact proof belongs to its original reader and a stale transaction snapshot cannot override live revocation', async t => {
  const f = await setup(t), reader = f.control.readOnlyFacts([query]);
  const result = await reader.lookup(query, undefined, model), oldState = structuredClone(f.store.read());
  assert.throws(() => reader.current(query, { ...result.memory, statement: 'SYNTHETIC forged projection' }, { receiver: model }), code('OSS_MEMORY_FACT_CHANGED'));
  const other = (await f.makeControl()).readOnlyFacts([query]);
  assert.throws(() => other.current(query, result.memory, { receiver: model }), code('OSS_MEMORY_FACT_CHANGED'));
  await f.ledger.revoke(result.memory.id, {}, f.identity);
  assert.throws(() => reader.current(query, result.memory, { state: oldState, receiver: model }), code('MEMORY_SOURCE_REVOKED'));
  assert.equal(f.fixture.state.commitCount, 0);
});

test('explicitly reopening the original control allows a new binding to read and save the current fact revision', async t => {
  const f = await setup(t), previous = f.bind(), oldRef = await selected(previous);
  const first = await previous.brain.contextSave(context([oldRef]), undefined, previous.binding.receiver);
  await f.writer.structuredMemoryRemember({ ...query, statement: 'SYNTHETIC current MOQ is 150 units.' }, undefined, model);
  await assert.rejects(() => previous.brain.contextRead({}, undefined, previous.binding.receiver), code('BRAIN_SOURCE_CHANGED'));
  // Open the original Host again for the same authorized native Session/Run;
  // do not reuse the earlier control or merely rebind the old reader.
  const reopenedControl = await f.makeControl(); assert.notEqual(reopenedControl, f.control);
  const reopenedReader = reopenedControl.readOnlyFacts([query]), next = f.bind(reopenedReader), currentRef = await selected(next);
  assert.equal(currentRef.revision, '2'); assert.notEqual(currentRef.sha256, oldRef.sha256);
  const input = { ...context([currentRef]), requestId: 'context-current-fact', expectedRevision: 1 };
  const saved = await next.brain.contextSave(input, undefined, next.binding.receiver);
  assert.equal(saved.persisted, true); assert.equal(saved.data.context.revision, 2);
  assert.equal(saved.data.sources[0].values.statement, 'SYNTHETIC current MOQ is 150 units.');
  assert.notEqual(saved.data.sources[0].values.memoryId, first.data.sources[0].values.memoryId);
  assert.equal(saved.data.sources[0].values.source.dependencies.length, 2);
  assert.equal(saved.recordRef.artifactId, first.recordRef.artifactId);
  assert.equal(f.fixture.state.commitCount, 2); assert.equal(f.state.parserCalls, 0);
  await assert.rejects(() => previous.brain.contextSave({ ...context([oldRef]), requestId: 'stale-fact-ref', expectedRevision: 2 }, undefined, previous.binding.receiver), code('BRAIN_SOURCE_CHANGED'));
  assert.equal(f.fixture.state.commitCount, 2);
});

test('every selected document dependency and original source message must still be current', async t => {
  for (const [name, mutate] of [
    ['second document revision', f => f.docs[1].revision++], ['second document archive', f => f.docs[1].status = 'archived'],
    ['second artifact SHA', f => f.persisted.artifacts[1].versions[0].sha256 = 'e'.repeat(64)],
    ['second document bytes', f => f.docs[1].bytes = Buffer.from('SYNTHETIC changed bytes')],
    ['source user message', f => f.persisted.messages[0].content = 'SYNTHETIC changed user message'],
  ]) await t.test(name, async t => {
    const f = await setup(t), client = f.bind(), ref = await selected(client); mutate(f);
    await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver));
    assert.equal(f.fixture.state.commitCount, 0); assert.equal(f.state.parserCalls, 0);
  });
});

test('live Session, role, Run, policy expiry and exact model destination remain fenced', async t => {
  for (const [name, mutate] of [
    ['session revoked', f => f.sessions.delete(sessionId)], ['role changed', f => f.sessions.get(sessionId).role = 'viewer'],
    ['run ended', f => f.persisted.runs[0].status = 'succeeded'], ['policy expired', f => f.state.now = Date.parse(f.policy.expiresAt)],
  ]) await t.test(name, async t => {
    const f = await setup(t), client = f.bind(), ref = await selected(client); mutate(f);
    await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver));
    assert.equal(f.fixture.state.commitCount, 0);
  });
  const f = await setup(t), client = f.bind(), before = f.state.downloads;
  await assert.rejects(() => client.brain.sourceCatalog({}, undefined, { provider: 'other', id: 'other' }), code('BRAIN_RECEIVER_MISMATCH'));
  await assert.rejects(() => client.brain.sourceCatalog({}, undefined, { ...client.binding.receiver, baseUrl: 'https://unselected.invalid' }), code('BRAIN_AUTHORIZATION_REFUSED'));
  assert.equal(f.state.downloads, before);
});

test('original Artifact commit snapshot revalidates memory, all dependencies and current turn', async t => {
  for (const [name, mutate] of [
    ['fact revoked', state => state.businessLibrary.enterpriseMemories.find(row => row.factKey === query.factKey).status = 'revoked'],
    ['second document revision', state => state.businessLibrary.documents[1].revision++],
    ['second artifact visibility', state => state.artifacts[1].metadata.businessLibrary.visibility = 'public'],
    ['run request', state => state.runs[0].requestId = 'different-request'],
    ['conversation owner', state => state.conversations[0].businessAgentOwner.subject = 'different-owner'],
  ]) await t.test(name, async t => {
    const f = await setup(t), client = f.bind(), ref = await selected(client);
    f.fixture.state.beforeCommit = () => { f.state.commitOverride = state => { mutate(state); return state; }; };
    await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver));
    assert.equal(f.fixture.state.commitCount, 0); assert.equal(f.fixture.store.read().artifacts.length, 0);
    assert.equal(f.persisted.runs[0].requestId, requestId); assert.equal(f.docs[1].revision, 1);
  });
});

test('document capability discovery exposes only current selected tuples without reading fact bodies',async t=>{
 const f=await setup(t),facade=f.writer.documentTools([query]),downloads=f.state.downloads;
 const visible=await facade.describe(undefined,model);
 assert.deepEqual(visible.methods,['structuredMemoryLookup','structuredMemoryRemember']);
 assert.deepEqual(visible.queries,[query]);assert.equal(visible.sources.length,2);
 assert.deepEqual(visible.sources.map(s=>s.asset),f.docs.map(d=>d.asset));
 assert.equal(visible.schema,'workspace.native-document-capabilities.v1');
 assert.ok(!JSON.stringify(visible).includes(statement));assert.ok(!JSON.stringify(visible).includes('SYNTHETIC_UNSELECTED_FACT'));
 assert.equal(f.state.downloads,downloads);assert.equal(f.state.parserCalls,0);
});
test('document capability discovery retains original receiver, source revision and revoked Session gates',async t=>{
 const f=await setup(t),facade=f.writer.documentTools([query]);
 await assert.rejects(facade.describe(undefined,{...model,id:'different-model'}),code('OSS_MODEL_RECEIVER_CHANGED'));
 f.docs[1].revision=2;
 await assert.rejects(facade.describe(undefined,model),code('FACTORY_DOCUMENT_REVISION_CHANGED'));
 f.docs[1].revision=1;f.sessions.delete(sessionId);
 await assert.rejects(facade.describe(undefined,model),code('OSS_SESSION_REVOKED'));
});
