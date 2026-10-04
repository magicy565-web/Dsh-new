import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../server/store.mjs';
import { createArtifactService } from '../server/artifacts.mjs';
import { createRunOutputService } from '../server/run-output.mjs';
import { createWorkspaceLibraryAdapter } from '../server/workspace-library.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-output-'));
  const store = await openStore(directory), artifacts = await createArtifactService({ store });
  await store.update(state => {
    state.conversations.push({ id: 'c1', status: 'running', activeRunId: 'r1' });
    state.runs.push({ id: 'r1', status: 'running', conversationId: 'c1', goalId: 'g1' });
    state.goals.push({ id: 'g1', status: 'running', runId: 'r1', conversationId: 'c1' });
  });
  t.after(async () => { await artifacts.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { store, artifacts, saveOutput: createRunOutputService({ store, artifacts }), adapter: createWorkspaceLibraryAdapter({ artifacts }) };
}
const output = { runId: 'r1', conversationId: 'c1', goalId: 'g1', requestId: 'step-1', artifact: { filename: 'deliverable.md', content: '# Real local bytes\nA useful draft.' } };

test('generated deliverable has immutable bytes, source provenance, and idempotent step identity', async t => {
  const { saveOutput, artifacts } = await fixture(t);
  const first = await saveOutput(output), retry = await saveOutput(output);
  assert.equal(retry.artifact.id, first.artifact.id); assert.equal(retry.duplicate, true);
  assert.equal(artifacts.list().artifacts.length, 1);
  assert.equal(first.artifact.sourceConversationId, 'c1'); assert.equal(first.artifact.sourceGoalId, 'g1'); assert.equal(first.artifact.sourceRunId, 'r1');
  assert.equal(first.artifact.metadata.reviewed, false);
  assert.equal((await artifacts.read(first.artifact.id)).content, output.artifact.content);
  await assert.rejects(saveOutput({ ...output, artifact: { ...output.artifact, content: 'changed' } }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('generated deliverable cannot publish for a canceled or replaced run and never accepts executable/binary output', async t => {
  const { saveOutput, store, artifacts } = await fixture(t);
  for (const artifact of [{ filename: 'bad.html', content: 'no' }, { filename: 'binary.png', content: 'no' }, { filename: '../outside.txt', content: 'no' }, { filename: 'bad.json', content: '{invalid' }]) await assert.rejects(saveOutput({ ...output, artifact }));
  await assert.rejects(saveOutput({ ...output, conversationId: 'other' }), { code: 'OUTPUT_RUN_RETIRED' });
  await store.update(state => { state.runs[0].status = 'cancelled'; });
  await assert.rejects(saveOutput(output), { code: 'OUTPUT_RUN_RETIRED' });
  assert.equal(artifacts.list().artifacts.length, 0);
});

test('atomic artifact guard rechecks cancellation after bytes are staged and removes uncommitted blob', async t => {
  const { artifacts } = await fixture(t); let checks = 0;
  await assert.rejects(artifacts.create({ filename: 'retired.txt', content: 'do not publish' }, { check() { checks++; if (checks === 2) throw Object.assign(new Error('retired'), { code: 'RETIRED' }); } }), { code: 'RETIRED' });
  assert.equal(checks, 2); assert.equal(artifacts.list().artifacts.length, 0);
  assert.throws(() => artifacts.create({ filename: 'no.txt', content: 'no' }, { check: 'injected' }), TypeError);
});

test('local library adapter executes real read/create/update text operations with exact revisions', async t => {
  const { adapter, artifacts } = await fixture(t);
  const created = await adapter.execute({ action: 'create_file', resource: 'library:new', payload: { filename: 'notes.txt', content: 'version one' }, idempotencyKey: 'approved-1' });
  assert.equal(created.saved, true); assert.equal(created.version, 1);
  const read = await adapter.execute({ action: 'read_file', resource: `artifact:${created.artifactId}`, payload: { version: 1 } });
  assert.equal(read.content, 'version one'); assert.equal(read.sha256, created.sha256);
  const update = await adapter.execute({ action: 'update_file', resource: `artifact:${created.artifactId}`, payload: { expectedRevision: 1, content: 'version two' } });
  assert.equal(update.version, 2);
  assert.equal((await artifacts.read(created.artifactId, { version: 1 })).content, 'version one');
  await assert.rejects(adapter.execute({ action: 'update_file', resource: `artifact:${created.artifactId}`, payload: { expectedRevision: 1, content: 'stale' } }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(adapter.execute({ action: 'read_file', resource: `artifact:${created.artifactId}`, payload: {} }));
  await assert.rejects(adapter.execute({ action: 'create_file', resource: '/tmp/file', payload: { filename: 'x.txt', content: 'no' }, idempotencyKey: 'bad' }));
  await assert.rejects(adapter.execute({ action: 'create_file', resource: 'library:new', payload: { filename: 'x.txt', content: 'no', command: 'ignored' }, idempotencyKey: 'bad' }));
});

test('local library connector keeps bound run provenance and rejects stopped run before writes', async t => {
  const { adapter, store, artifacts } = await fixture(t);
  const input = { action: 'create_file', resource: 'library:new', payload: { filename: 'bound.txt', content: 'safe' }, idempotencyKey: 'approved-bound', binding: { runId: 'r1', conversationId: 'c1', goalId: 'g1' } };
  const result = await adapter.execute(input);
  assert.equal(artifacts.get(result.artifactId).artifact.sourceRunId, 'r1');
  await store.update(state => { state.runs[0].status = 'cancelled'; });
  await assert.rejects(adapter.execute({ ...input, idempotencyKey: 'cancelled' }), { code: 'OUTPUT_RUN_RETIRED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.execute({ ...input, signal: controller.signal }), { code: 'CANCELLED' });
});
