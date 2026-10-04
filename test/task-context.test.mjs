import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createArtifactService } from '../server/artifacts.mjs';
import { emptyInputContext, normalizeInputContext, prepareInputContext, assertInputContextSnapshot, inputContextMessages } from '../server/task-context.mjs';

const code = expected => error => error.code === expected;
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-input-context-'));
  const store = await openStore(directory); const artifacts = await createArtifactService({ store });
  t.after(async () => { await artifacts.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  await store.update(state => { state.conversations.push({ id: 'conversation-one' }, { id: 'conversation-two' }); });
  return { store, artifacts };
}
test('task context distinguishes legacy defaults from explicit empty least-privilege selections', () => {
  assert.equal(normalizeInputContext(undefined), undefined);
  assert.deepEqual(normalizeInputContext({}), emptyInputContext());
  for (const value of [null, [], { tools: ['shell'] }, { artifacts: null }, { skills: [{ id: 'skill', revision: 0 }] }, { artifacts: [{ id: '../escape', version: '1' }] }, { memoryIds: ['one', 'one'] }, { connectorActions: [{ connectorId: 'c', action: 'read', approved: true }] }, { artifacts: Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, version: 1 })) }]) assert.throws(() => normalizeInputContext(value), code('INVALID_INPUT_CONTEXT'));
});
test('task context loads pinned UTF-8 artifact versions without silently using newer content', async t => {
  const { store, artifacts } = await fixture(t);
  const { artifact } = await artifacts.create({ filename: 'source.md', content: 'VERSION_ONE_SOURCE' });
  await artifacts.update(artifact.id, { content: 'VERSION_TWO_SOURCE', filename: 'new-name.md' });
  const snapshot = await prepareInputContext({ state: store.read(), conversationId: 'conversation-one', inputContext: { artifacts: [{ id: artifact.id, version: 1 }] }, artifacts });
  assertInputContextSnapshot(store.read(), 'conversation-one', snapshot);
  assert.equal(snapshot.artifacts[0].content, 'VERSION_ONE_SOURCE'); assert.equal(snapshot.artifacts[0].filename, 'source.md');
  await artifacts.delete(artifact.id);
  assert.throws(() => assertInputContextSnapshot(store.read(), 'conversation-one', snapshot), code('INPUT_ARTIFACT_CHANGED'));
  assert.equal(snapshot.artifacts[0].content, 'VERSION_ONE_SOURCE', 'admitted snapshot is independent of live storage');
  assert.match(inputContextMessages(snapshot)[0].content, /untrusted source content/);
  assert.match(inputContextMessages(snapshot)[0].content, /VERSION_ONE_SOURCE/);
  assert.doesNotMatch(inputContextMessages(snapshot)[0].content, /VERSION_TWO_SOURCE/);
  await assert.rejects(prepareInputContext({ state: store.read(), inputContext: snapshot.selection, artifacts }), code('INPUT_ARTIFACT_MISSING'));
});
test('skills require explicit enabled reviewed revisions; memory selection is scoped and excludes unrelated content', async t => {
  const { store, artifacts } = await fixture(t);
  await store.update(state => {
    state.capabilities.skills.push({ id: 'skill-one', name: 'Reviewed skill', instructions: 'REVIEWED_SKILL_ONLY', enabled: true, revision: 3 }, { id: 'skill-other', name: 'Unselected', instructions: 'DO_NOT_SEND_SKILL', enabled: true, revision: 1 });
    state.memories.push({ id: 'm1', content: 'EXPLICIT_SAVED_NOTE', category: 'saved', enabled: true }, { id: 'm2', content: 'OTHER_CONVERSATION', conversationId: 'conversation-two', enabled: true }, { id: 'm3', content: 'DO_NOT_SEND_MEMORY', enabled: true });
  });
  const prepare = inputContext => prepareInputContext({ state: store.read(), conversationId: 'conversation-one', inputContext, artifacts });
  const empty = await prepare(emptyInputContext()); assert.equal(inputContextMessages(empty).length, 0);
  const selected = await prepare({ skills: [{ id: 'skill-one', revision: 3 }], memoryIds: ['m1'] });
  assertInputContextSnapshot(store.read(), 'conversation-one', selected);
  const messages = inputContextMessages(selected); assert.match(JSON.stringify(messages), /REVIEWED_SKILL_ONLY/); assert.match(JSON.stringify(messages), /EXPLICIT_SAVED_NOTE/); assert.doesNotMatch(JSON.stringify(messages), /DO_NOT_SEND|OTHER_CONVERSATION/);
  await assert.rejects(prepare({ skills: [{ id: 'skill-one', revision: 2 }] }), code('INPUT_SKILL_CHANGED'));
  await assert.rejects(prepare({ memoryIds: ['m2'] }), code('INPUT_MEMORY_UNAVAILABLE'));
  await store.update(state => { state.capabilities.skills[0].enabled = false; state.memories[0].enabled = false; });
  assert.throws(() => assertInputContextSnapshot(store.read(), 'conversation-one', selected), code('INPUT_SKILL_CHANGED'));
  assert.throws(() => assertInputContextSnapshot(store.read(), 'conversation-one', { ...selected, skills: [] }), code('INPUT_MEMORY_CHANGED'));
  await assert.rejects(prepare({ skills: [{ id: 'skill-one', revision: 3 }] }), code('INPUT_SKILL_UNAVAILABLE'));
  await assert.rejects(prepare({ memoryIds: ['m1'] }), code('INPUT_MEMORY_UNAVAILABLE'));
});
test('task context rejects unsupported binary files, credentials and over-budget text rather than truncating', async t => {
  const { store, artifacts } = await fixture(t);
  const binary = (await artifacts.create({ filename: 'source.pdf', base64: Buffer.from('%PDF-fixture').toString('base64') })).artifact;
  const large = (await artifacts.create({ filename: 'large.txt', content: 'x'.repeat(32001) })).artifact;
  const secret = (await artifacts.create({ filename: 'secret.txt', content: 'sk-proj-' + 'a'.repeat(60) })).artifact;
  const prepare = artifact => prepareInputContext({ state: store.read(), inputContext: { artifacts: [{ id: artifact.id, version: 1 }] }, artifacts });
  await assert.rejects(prepare(binary), code('INPUT_ARTIFACT_UNSUPPORTED')); await assert.rejects(prepare(large), code('INPUT_CONTEXT_TOO_LARGE')); await assert.rejects(prepare(secret), code('RAW_CREDENTIAL_REJECTED'));
});
