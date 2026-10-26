import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDraft, failure } from '../src/core.js';
import { generateInSession } from '../src/native-files.js';
import { memoryHost } from './native-fixture.mjs';
import { issueFixture, json } from './fixture.mjs';

const code = expected => error => failure(error).code === expected;
const input = () => json(issueFixture());
test('requires current Agent Session workspace, never ambient directory', async () => {
  const host = memoryHost();
  for (const exec of [undefined, {}, { signal: host.exec.signal }, { ...host.exec, agent: { ctx: {}, session: { header: {} } } }]) {
    await assert.rejects(generateInSession(host.ctx, input(), exec), code('MAGAZINE_SESSION_REQUIRED'));
  }
  assert.equal(host.state.writes, 0);
});
test('create uses native intent, observation actor, and unchanged Session policy', async () => {
  const host = memoryHost(); const result = await generateInSession(host.ctx, input(), host.exec);
  assert.equal(result.reused, false); assert.equal(host.state.writes, 1); assert.equal(host.state.intentCalls, 1);
  assert.deepEqual(host.state.policies, [{ mode: 'workspace-write', workspaceRoot: host.state.root }]);
  assert.deepEqual(host.state.observations.map(x => x.observation.kind), ['absent', 'present']);
  assert.ok(host.state.observations.every(x => x.actor === host.exec));
  assert.deepEqual(host.files.get(result.path).data, compileDraft(input()).data);
  assert.equal(result.presentation, 'pending-official-present');
});
test('same content reuses without mutation or write-intent, preserving version', async () => {
  const host = memoryHost(); const first = await generateInSession(host.ctx, input(), host.exec);
  const version = host.files.get(first.path).version;
  const second = await generateInSession(host.ctx, input(), host.exec);
  assert.equal(second.path, first.path); assert.equal(second.reused, true); assert.equal(host.state.writes, 1);
  assert.equal(host.state.intentCalls, 1); assert.equal(host.files.get(first.path).version, version);
});
test('same filename with different bytes never overwrites', async () => {
  const host = memoryHost(), draft = compileDraft(input());
  const original = Buffer.alloc(draft.data.length, 88); const path = host.state.root + '/' + draft.name;
  host.files.set(path, { type: 'file', data: original, version: 'existing-v1' });
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_TARGET_CONFLICT'));
  assert.equal(host.state.writes, 0); assert.deepEqual(host.files.get(path).data, original);
});
test('read-only current Session policy denies all generation writes', async () => {
  const host = memoryHost(); host.state.mode = 'read-only';
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_WORKSPACE_DENIED'));
  assert.equal(host.state.writes, 0); assert.equal(host.state.intentCalls, 0);
});
test('changed cwd outside original Session workspace is refused', async () => {
  const host = memoryHost(); host.state.cwd = '/outside-synthetic';
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_WORKSPACE_DENIED'));
  assert.equal(host.state.writes, 0);
});
test('final symlinks and directories are refused, not followed or replaced', async () => {
  for (const entry of [{ type: 'symlink', target: '/outside-synthetic/secret' }, { type: 'directory', version: 'dir' }]) {
    const host = memoryHost(); const path = host.state.root + '/' + compileDraft(input()).name;
    host.files.set(path, entry);
    await assert.rejects(generateInSession(host.ctx, input(), host.exec), e => ['MAGAZINE_TARGET_CONFLICT', 'MAGAZINE_WORKSPACE_DENIED'].includes(failure(e).code));
    assert.equal(host.state.writes, 0); assert.equal(host.files.get(path), entry);
  }
});
test('native waterfall replacement intent is refused instead of overriding policy', async () => {
  const host = memoryHost(); host.state.intent = { kind: 'replaceIfVersion', version: 'wrong' };
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_WRITE_DENIED'));
  assert.equal(host.state.writes, 0);
});
test('policy or cwd changing during awaited intent is checked before write', async () => {
  for (const mutate of [host => { host.state.mode = 'read-only'; }, host => { host.state.cwd = '/outside-synthetic'; }]) {
    const host = memoryHost(); host.state.intentHook = () => mutate(host);
    await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_WORKSPACE_DENIED'));
    assert.equal(host.state.writes, 0);
  }
});
test('cancellation after publication may retain a file but never implies presentation', async () => {
  const host = memoryHost(); host.state.afterWrite = () => host.controller.abort(new Error('synthetic cancellation'));
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_CANCELLED'));
  assert.equal(host.state.writes, 1); assert.equal(host.files.size, 2);
});
test('observation failure after publication is safe and is not reported as zero writes', async () => {
  const host = memoryHost(); host.ctx.emit = (_name, _target, observation) => { if (observation.kind === 'present') throw new Error('/private-synthetic-token'); };
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), e => failure(e).code === 'MAGAZINE_WRITE_FAILED' && !e.message.includes('private-synthetic-token'));
  assert.equal(host.state.writes, 1);
});
test('corrupt backend output is never reported as generated successfully', async () => {
  const host = memoryHost(); host.state.afterWrite = () => { for (const entry of host.files.values()) if (entry.data) entry.data.fill(88); };
  await assert.rejects(generateInSession(host.ctx, input(), host.exec), code('MAGAZINE_TARGET_CONFLICT'));
  assert.equal(host.state.writes, 1);
});
