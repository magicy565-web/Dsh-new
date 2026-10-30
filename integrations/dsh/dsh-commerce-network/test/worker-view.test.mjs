import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dotFor, formatTime, groupTasks, lastActivity, needsYou, presence, runtimeOf, skillLabel, taskStatus, verificationLabel, workerNo, workerStats,
} from '../src/work/model.mjs';

const order = (status, extra = {}) => ({ id: `o-${status}`, agentServiceId: 'w1', status, ...extra });

test('needsYou covers approval, acceptance, stop and unknown hand-off only', () => {
  for (const status of ['proposed', 'delivered', 'stop_requested']) assert.equal(needsYou(order(status)), true, status);
  for (const status of ['running', 'queued', 'accepted', 'rejected', 'failed', 'cancelled']) assert.equal(needsYou(order(status)), false, status);
  assert.equal(needsYou(order('running', { grokHandoff: { state: 'unknown' } })), true);
  assert.equal(needsYou(order('failed', { grokHandoff: { state: 'unknown' } })), false, 'terminal orders never demand action');
});

test('dots use only the three allowed tones', () => {
  const tones = new Set(['proposed', 'running', 'queued', 'accepted', 'rejected', 'failed'].map((s) => dotFor(order(s))));
  assert.deepEqual([...tones].sort(), ['attention', 'done', 'idle', 'live', 'queued']);
});

test('statuses never claim a Worker is online', () => {
  assert.equal(presence([{ status: 'connected' }], []).label, '网关已认证');
  assert.equal(presence([], []).label, '状态待同步');
  assert.equal(presence([{ status: 'revoked' }], []).label, '已撤销');
  assert.equal(presence([{ status: 'connected' }], [order('running')]).label, '执行中');
  for (const sample of [presence([{ status: 'connected' }], []), presence([], []), presence([{ status: 'pending' }], [])]) {
    assert.doesNotMatch(sample.label, /在线/);
  }
});

test('hand-off states override the generic status label', () => {
  assert.equal(taskStatus(order('running', { grokHandoff: { state: 'unknown' } })), '派送结果待核对');
  assert.equal(taskStatus(order('delivered')), '等待验收');
});

test('acceptance rate stays hidden below five samples', () => {
  const worker = { id: 'w1' };
  const few = workerStats(worker, [order('accepted'), order('accepted'), order('rejected'), order('running')]);
  assert.deepEqual({ accepted: few.accepted, rejected: few.rejected, active: few.active, sample: few.sample, rate: few.rate }, { accepted: 2, rejected: 1, active: 1, sample: 3, rate: null });
  const enough = workerStats(worker, [...Array(4).fill(0).map(() => order('accepted')), order('rejected')]);
  assert.equal(enough.rate, 80);
  assert.equal(workerStats(worker, [{ ...order('accepted'), agentServiceId: 'other' }]).accepted, 0, 'other Workers never leak in');
});

test('badge number is the traceable tail of the record id', () => {
  assert.equal(workerNo('a1'), '00A1');
  assert.equal(workerNo('3f2c9e8a-1111-4222-8333-0123456789ab'), '89AB');
  assert.equal(workerNo(undefined), '0000');
});

test('runtime, skill and verification labels stay honest', () => {
  assert.equal(runtimeOf('grokbot').name, 'Grok Bot');
  assert.equal(runtimeOf(undefined).id, 'other', 'unmarked history is not guessed from names');
  assert.equal(skillLabel('summarize_rfq'), '汇总询盘');
  assert.equal(skillLabel('unknown_skill'), 'unknown_skill');
  assert.equal(verificationLabel({ verification: 'unverified' }), '未核验');
  assert.equal(verificationLabel(undefined), '未核验');
});

test('tasks group into current, queued and recent', () => {
  const groups = groupTasks([order('running'), order('queued'), order('accepted'), order('delivered')]);
  assert.deepEqual(groups.map(([name, rows]) => [name, rows.length]), [['当前任务', 2], ['排队中', 1], ['最近', 1]]);
  assert.deepEqual(groupTasks([]), []);
});

test('times are numeric so a monospaced face never needs CJK glyphs', () => {
  assert.match(formatTime('2026-10-30T09:05:00Z'), /^\d{2}\/\d{2} \d{2}:\d{2}$/);
  assert.equal(formatTime(''), '');
  assert.equal(formatTime('not a date'), '');
});

test('last activity is the newest recorded gateway contact', () => {
  assert.equal(lastActivity([{ lastSeenAt: '2026-10-29T00:00:00Z' }, { lastSeenAt: '2026-10-30T00:00:00Z' }, {}]), '2026-10-30T00:00:00Z');
  assert.equal(lastActivity([{}]), '');
});
