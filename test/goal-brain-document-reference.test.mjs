import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalBrainHost } from '../server/goal-brain-host.mjs';
import { createLibraryModelRead } from '../server/library-model-read.mjs';
import { libraryReadHash, libraryRecipientForModel } from '../server/library-model-read-contract.mjs';
import { digest, sourceId } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { openFixture, contextInput, decisionInput } from './fixtures/goal-brain-fixture.mjs';

const model = { provider: 'workspace-agent-test-faux', id: 'workspace-agent-test', api: 'faux' };
const now = Date.parse('2026-10-17T10:00:00Z');
const workspaceId = 'synthetic-enterprise', conversationId = 'synthetic-business', sessionId = 'synthetic-session';
const goalId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce11';
const documentId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce12';
const otherDocumentId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce13';
const artifactId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce14';
const asset = { artifactId, version: 2, sha256: 'a'.repeat(64) };
const fields = ['documentId', 'documentRevision', 'documentVersion', 'artifactId', 'artifactVersion', 'artifactSha256'];
const values = { documentId, documentRevision: 3, documentVersion: 2, artifactId, artifactVersion: 2, artifactSha256: asset.sha256 };
const code = expected => error => error.code === expected;

function setup({ selected = true, role = 'operator', enabled = true, alias = false, sourceAdapter = null } = {}) {
  const fixture = openFixture();
  const state = { now, downloads: 0, sourceChecks: 0 };
  const document = { id: documentId, revision: 3, currentVersion: 2, status: 'active',
    updatedAt: new Date(now - 5000).toISOString(), title: 'PRIVATE_TITLE_NOT_SELECTED',
    description: 'PRIVATE_BODY_NOT_SELECTED', versions: [{ version: 2, asset: structuredClone(asset) }] };
  const persisted = {
    businessLibrary: { version: 1, company: null, products: [], documents: [document,
      { ...structuredClone(document), id: otherDocumentId, title: 'UNSELECTED_DOCUMENT' }] },
    goals: [{ id: goalId, conversationId, title: 'Review the already selected document reference', status: 'draft', revision: 1 }],
    conversations: [{ id: conversationId, workspaceId, createdBy: 'owner' }],
    runs: [{ id: 'synthetic-run', conversationId, status: 'running',
      businessAgentContext: { subject: 'owner', workspaceId, allowBusinessSubmit: false } }],
  };
  const store = { read: () => ({ ...fixture.store.read(), ...persisted }) };
  const admissionState = () => {
    const snapshot = store.read();
    return state.commitDocumentOverride ? { ...snapshot, businessLibrary: { ...snapshot.businessLibrary,
      documents: snapshot.businessLibrary.documents.map(row => row.id === documentId ? state.commitDocumentOverride : row) } } : snapshot;
  };
  // Existing test-only SQLite Artifact facade; production retains its original
  // serialized Store/Artifact admission. No alternative production memory.
  const artifacts = {
    read: fixture.artifacts.read,
    download: () => { state.downloads++; throw new Error('Document byte reads are outside this test scope'); },
    create: (body, admission) => fixture.artifacts.create(body, { ...admission, check: () => admission.check(admissionState()) }),
    update: (id, body, admission) => fixture.artifacts.update(id, body, { ...admission, check: () => admission.check(admissionState()) }),
  };
  const sessions = new Map([[sessionId, { subject: 'owner', workspaceId, role }]]);
  const access = { mode: 'enterprise', nativeSessionById: id => sessions.get(id) };
  const policy = { enabled, reviewed: true, workspaceId, subject: 'owner', expiresAt: '2026-10-18T00:00:00Z',
    recipient: libraryRecipientForModel(model), company: null, products: [], productFields: ['name'],
    ...(selected ? { factoryMaterials: { products: [], productFields: ['name'],
      documents: [{ id: documentId, revision: 3, documentVersion: 2, asset: structuredClone(asset) }] } } : {}) };
  if (alias) policy.factoryMaterials.documents.push({ ...structuredClone(policy.factoryMaterials.documents[0]), id: otherDocumentId });
  const library = { getDocument(id) {
    state.sourceChecks++;
    return { document: structuredClone(persisted.businessLibrary.documents.find(row => row.id === id)) };
  } };
  const libraryModelRead = createLibraryModelRead({ library, artifacts, access, policy, clock: () => state.now });
  const host = createGoalBrainHost({ store, artifacts, access, libraryModelRead, originalReceiver: model, sourceAdapter, clock: () => state.now,
    reviewedGoals: [{ id: goalId, originalRevision: 1, currency: 'USD', businessStatus: 'active',
      capabilities: ['analysis', 'draft', 'none'], budgetRemainingMinor: null, perTaskCapMinor: null, reviewed: true }] });
  const identity = { sessionId, subject: 'owner', workspaceId, role };
  const bind = () => host.bind({ identity, conversationId, runId: 'synthetic-run' });
  return { fixture, state, document, persisted, sessions, policy, libraryModelRead, identity, bind, close: () => fixture.close() };
}
async function select(client) {
  const result = await client.brain.sourceCatalog({}, undefined, client.binding.receiver);
  assert.equal(result.data.sourceRefs.length, 1);
  return result.data.sourceRefs[0];
}
const context = refs => contextInput(refs, { goalIds: [goalId] });
function decision(ref) {
  const input = decisionInput('document-reference-decision', { goalId, sourceRefs: [ref] });
  input.problem = 'Confirm the selected document reference before drawing a business conclusion';
  input.hypotheses[0].supportingEvidence = [sourceId(ref)];
  input.options[0].evidenceIds = [sourceId(ref)];
  return input;
}

test('selected document reference follows same-business Context to Decision to existing Goal without reading bytes', async t => {
  const f = setup(); t.after(f.close);
  const originalGoals = structuredClone(f.persisted.goals), client = f.bind(), ref = await select(client);
  assert.deepEqual(ref, { kind: 'artifact', id: documentId, revision: '3', sha256: digest(values), fields });
  assert.notEqual(ref.sha256, asset.sha256);
  const saved = await client.brain.contextSave(context([ref]), undefined, client.binding.receiver);
  assert.equal(saved.persisted, true);
  assert.deepEqual(saved.data.sources[0].values, values);
  assert.equal(saved.data.sources[0].observedAt, f.document.updatedAt);
  assert.equal(saved.data.sources[0].validUntil, f.policy.expiresAt);
  const decided = await client.brain.decisionSave(decision(ref), undefined, client.binding.receiver);
  assert.equal(decided.data.decision.payload.goalId, goalId);
  assert.deepEqual(decided.data.sources[0].reference, ref);
  assert.equal(decided.data.goals[0].budgetRemainingMinor, null);
  assert.equal(decided.executable, false);
  assert.equal(decided.humanReviewed, false);
  assert.ok(decided.data.evaluations.every(row => row.executable === false && row.spentMinor === 0));
  const continued = await f.bind().brain.decisionRead({ id: 'document-reference-decision' }, undefined, client.binding.receiver);
  assert.equal(continued.recordRef.artifactId, decided.recordRef.artifactId);
  assert.deepEqual(continued.data.sources[0].values, values);
  assert.deepEqual(f.persisted.goals, originalGoals);
  assert.equal(f.fixture.state.commitCount, 2);
  assert.equal(f.state.downloads, 0);
  assert.ok(f.state.sourceChecks > 3);
  assert.doesNotMatch(JSON.stringify([saved, decided, continued]), /PRIVATE_|UNSELECTED_DOCUMENT/);
});

test('unselected or disabled document scope creates no default read or changed empty-scope binding', async t => {
  const f = setup({ selected: false }); t.after(f.close);
  const client = f.bind();
  const result = await client.brain.sourceCatalog({}, undefined, client.binding.receiver);
  assert.deepEqual(result.data.sourceRefs, []);
  assert.equal(f.state.sourceChecks, 0);
  assert.equal(client.binding.scopeVersion, libraryReadHash({ workspaceId, subject: 'owner', expiresAt: f.policy.expiresAt,
    company: null, products: [], productFields: ['name'] }));
  const disabled = setup({ enabled: false }); t.after(disabled.close);
  assert.throws(disabled.bind, code('BRAIN_ORIGINAL_LIBRARY_POLICY_REQUIRED'));
});

test('reference IDs, field masks and metadata digest remain exact', async t => {
  const f = setup(); t.after(f.close); const client = f.bind(), ref = await select(client);
  for (const changes of [{ id: otherDocumentId }, { revision: '4' }, { fields: [...fields, 'title'] }]) {
    await assert.rejects(() => client.brain.contextSave(context([{ ...ref, ...changes }]), undefined, client.binding.receiver), code('BRAIN_SOURCE_NOT_SELECTED'));
  }
  await assert.rejects(() => client.brain.contextSave(context([{ ...ref, sha256: 'b'.repeat(64) }]), undefined, client.binding.receiver), code('BRAIN_SOURCE_CHANGED'));
  assert.equal(f.fixture.state.commitCount, 0);
  assert.equal(f.state.downloads, 0);
});

test('ordinary document updates invalidate catalog and current Context through the original source authority', async t => {
  for (const [name, mutate, expected] of [
    ['revision', d => d.revision++, 'FACTORY_DOCUMENT_REVISION_CHANGED'],
    ['document version', d => d.currentVersion++, 'FACTORY_DOCUMENT_REVISION_CHANGED'],
    ['archive', d => d.status = 'archived', 'FACTORY_DOCUMENT_REVISION_CHANGED'],
    ['asset version', d => d.versions[0].asset.version++, 'FACTORY_DOCUMENT_ASSET_CHANGED'],
    ['asset SHA', d => d.versions[0].asset.sha256 = 'b'.repeat(64), 'FACTORY_DOCUMENT_ASSET_CHANGED'],
  ]) await t.test(name, async t => {
    const f = setup(); t.after(f.close); const client = f.bind(), ref = await select(client);
    await client.brain.contextSave(context([ref]), undefined, client.binding.receiver);
    mutate(f.document);
    await assert.rejects(() => client.brain.sourceCatalog({}, undefined, client.binding.receiver), code(expected));
    await assert.rejects(() => client.brain.contextRead({}, undefined, client.binding.receiver), code(expected));
    assert.equal(f.fixture.state.commitCount, 1);
    assert.equal(f.state.downloads, 0);
  });
});

test('original live session, role, expiry and receiver gates apply to document metadata', async t => {
  for (const [name, mutate, expected] of [
    ['revoked session', f => f.sessions.delete(sessionId), 'BRAIN_SESSION_EXPIRED'],
    ['changed role', f => f.sessions.get(sessionId).role = 'viewer', 'BRAIN_SESSION_EXPIRED'],
    ['expired policy', f => f.state.now = Date.parse(f.policy.expiresAt), 'LIBRARY_READ_SCOPE_EXPIRED'],
  ]) await t.test(name, async t => {
    const f = setup(); t.after(f.close); const client = f.bind(), ref = await select(client);
    mutate(f);
    await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver), code(expected));
    await assert.rejects(() => client.brain.sourceCatalog({}, undefined, client.binding.receiver), code(expected));
    assert.equal(f.fixture.state.commitCount, 0);
  });
  const f = setup(); t.after(f.close); const client = f.bind();
  await assert.rejects(() => client.brain.sourceCatalog({}, undefined, { provider: 'different-model', id: 'different' }), code('BRAIN_RECEIVER_MISMATCH'));
  await assert.rejects(() => client.brain.sourceCatalog({}, undefined, { ...client.binding.receiver, baseUrl: 'https://different.invalid' }), code('BRAIN_AUTHORIZATION_REFUSED'));
  assert.equal(f.state.sourceChecks, 0);
  const viewer = setup({ role: 'viewer' }); t.after(viewer.close); const view = viewer.bind();
  await assert.rejects(() => view.brain.sourceCatalog({}, undefined, view.binding.receiver), code('LIBRARY_SESSION_SCOPE_REQUIRED'));
});

test('ordinary document update and session revocation are rechecked at original Artifact commit admission', async t => {
  for (const [name, mutate, expected] of [
    ['document update', f => f.document.revision++, 'FACTORY_DOCUMENT_REVISION_CHANGED'],
    ['session revocation', f => f.sessions.delete(sessionId), 'BRAIN_SESSION_EXPIRED'],
  ]) await t.test(name, async t => {
    const f = setup(); t.after(f.close); const client = f.bind(), ref = await select(client);
    f.fixture.state.beforeCommit = () => mutate(f);
    await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver), code(expected));
    assert.equal(f.fixture.state.commitCount, 0);
    assert.equal(f.fixture.store.read().artifacts.length, 0);
    assert.equal(f.state.downloads, 0);
  });
});

test('existing adapter artifact references keep their read/current route with and without selected documents', async t => {
  for (const selected of [false, true]) {
    const adapterValues = { referenceLabel: 'Synthetic already configured adapter reference' };
    const ref = { kind: 'artifact', id: 'existing-adapter-reference', revision: '1', sha256: digest(adapterValues), fields: ['referenceLabel'] };
    const row = { workspaceId, reference: ref, observedAt: new Date(now - 5000).toISOString(), validUntil: null, values: adapterValues };
    let reads = 0, currents = 0;
    const f = setup({ selected, sourceAdapter: {
      list: () => [ref], read: () => { reads++; return row; }, current: () => { currents++; return row; },
    } }); t.after(f.close); const client = f.bind();
    const catalog = await client.brain.sourceCatalog({}, undefined, client.binding.receiver);
    assert.deepEqual(catalog.data.sourceRefs[0], ref);
    assert.equal(catalog.data.sourceRefs.length, selected ? 2 : 1);
    await client.brain.contextSave(context(catalog.data.sourceRefs), undefined, client.binding.receiver);
    const found = await client.brain.contextRead({}, undefined, client.binding.receiver);
    assert.deepEqual(found.data.sources[0].values, adapterValues);
    assert.ok(reads > 0 && currents > 0);
    assert.equal(f.state.downloads, 0);
  }
});

test('same-asset document aliases are refused rather than substituting the first selected document', async t => {
  const f = setup({ alias: true }); t.after(f.close); const client = f.bind();
  await assert.rejects(() => client.brain.sourceCatalog({}, undefined, client.binding.receiver), code('BRAIN_SOURCE_CHANGED'));
  assert.equal(f.fixture.state.commitCount, 0);
  assert.equal(f.state.downloads, 0);
});

test('document metadata must also match the original Artifact commit snapshot', async t => {
  const f = setup(); t.after(f.close); const client = f.bind(), ref = await select(client);
  f.fixture.state.beforeCommit = () => { f.state.commitDocumentOverride = { ...structuredClone(f.document), revision: 4 }; };
  await assert.rejects(() => client.brain.contextSave(context([ref]), undefined, client.binding.receiver), code('BRAIN_SOURCE_CHANGED'));
  assert.equal(f.document.revision, 3);
  assert.equal(f.fixture.state.commitCount, 0);
  assert.equal(f.fixture.store.read().artifacts.length, 0);
  assert.equal(f.state.downloads, 0);
});
