import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudJobState, jobNeedsAttention, selectCurrentJob } from '../src/experience/cloudActivity.ts';
import { museFileUrl, museMessageFiles, museOrderLabel, museState } from '../src/experience/museControl.ts';

const now = Date.now(), iso = n => new Date(n).toISOString(), sha = 'a'.repeat(64);
const dot = { id: 'dot-job', prompt: 'Original Dot', state: 'running', attemptId: 'original-attempt', fence: 2, leaseUntil: iso(now + 60000), deadlineAt: iso(now + 120000) };
const muse = status => ({ id: 'muse-order', prompt: 'Original Muse', state: status === 'running' ? 'leased' : 'preparing', muse: {
  agentKind: 'muse', orderId: 'muse-order', taskRef: status === 'running' ? 'muse-task' : null, attemptId: status === 'running' ? 'muse-attempt' : null,
  fence: status === 'running' ? 1 : 0, leaseUntil: iso(now + 60000), deadlineAt: iso(now + 120000), status, executionStatus: status === 'running' ? 'claimed' : 'pending',
  receipt: null, receiptHash: null, returnedHash: null, acceptedAt: null } });

test('queued/draft Muse never masks a live fenced Dot, independent of array order', () => {
  for (const status of ['queued', 'draft', 'approved', 'dispatching']) {
    const pending = muse(status), jobs = [pending, dot];
    assert.equal(selectCurrentJob(jobs, now), dot); assert.equal(selectCurrentJob([...jobs].reverse(), now), dot);
    assert.equal(cloudJobState(pending, now).active, false); assert.deepEqual(jobs, [pending, dot]);
  }
});
test('live Muse precedes queued Dot and deterministic selection survives reversed arrays', () => {
  const active = muse('running'), pending = { ...dot, state: 'queued', updatedAt: iso(now + 1) };
  assert.equal(selectCurrentJob([pending, active], now), active);
  assert.equal(selectCurrentJob([active, pending], now), active);
  const newer = { ...dot, updatedAt: iso(now + 10) };
  assert.equal(selectCurrentJob([active, newer], now), newer);
  assert.equal(selectCurrentJob([newer, active], now), newer);
});
test('missing, malformed, stale or conflicting attempt/lease/deadline evidence never animates', () => {
  for (const invalid of [{ attemptId: null }, { attemptId: {} }, { fence: 0 }, { fence: 1.5 }, { fence: Number.MAX_SAFE_INTEGER + 1 },
    { leaseUntil: null }, { leaseUntil: 'bad' }, { leaseUntil: iso(now) }, { deadlineAt: null }, { deadlineAt: iso(now) },
    { reconciliationRequired: true }, { leaseExpiresAt: now + 1 }]) {
    const item = { ...dot, ...invalid };
    assert.equal(cloudJobState(item, now).active, false, JSON.stringify(invalid));
    assert.equal(cloudJobState(item, now).state, 'uncertain');
    assert.equal(jobNeedsAttention(item, now), true);
  }
  assert.equal(cloudJobState({ ...dot, leaseUntil: undefined, leaseExpiresAt: now + 60000, deadlineAt: now + 120000 }, now).active, true);
  const expired = muse('running'); expired.muse.deadlineAt = iso(now);
  assert.equal(cloudJobState(expired, now).active, false);
});
test('blocked/cancel/uncertain and unclosed outcomes remain attention ahead of the queue', () => {
  for (const state of ['blocked', 'cancel_requested', 'uncertain', 'failed']) {
    const item = { ...dot, state };
    assert.equal(cloudJobState(item, now).active, false);
    assert.equal(jobNeedsAttention(item, now), true);
    assert.equal(selectCurrentJob([muse('draft'), item], now), item);
    assert.equal(selectCurrentJob([item, { ...dot, id: 'another-live-task' }], now).id, 'another-live-task');
  }
  assert.equal(jobNeedsAttention({ ...dot, state: 'cancelled', nativeRequestId: 'original-request', returnedHash: sha }, now), true);
  assert.equal(jobNeedsAttention({ ...dot, state: 'cancelled', nativeRequestId: 'original-request', returnedHash: sha, closedHash: sha }, now), false);
  assert.equal(cloudJobState({ ...dot, state: 'return_pending' }, now).active, false);
});
test('Muse file URLs fail closed for malformed IDs, versions, hashes and filenames', () => {
  const file = { id: 'original-file', version: 1, sha256: sha, filename: 'result.csv' };
  assert.equal(museFileUrl(file), '/api/muse-worker-files/original-file?version=1&sha256=' + sha);
  for (const invalid of [null, [], {}, { ...file, id: {} }, { ...file, id: '../foreign' }, { ...file, id: 'file?x=1' }, { ...file, version: '1' },
    { ...file, version: 2 }, { ...file, sha256: sha.toUpperCase() }, { ...file, sha256: {} }, { ...file, filename: {} }, { ...file, filename: '../report' }]) assert.equal(museFileUrl(invalid), null);
});
test('legacy text remains readable; malformed or cross-session receipt metadata cannot make links', () => {
  const receipt = { schema: 'workspace.muse.session-receipt.v1', nativeAgentId: 'original-session', workerId: 'original-worker',
    orderId: 'original-order', requestId: 'original-request', taskRef: 'original-task', attemptId: 'original-attempt', fence: 1,
    submitRequestId: 'original-submit', submitHash: sha, reportSha256: sha, independentlyVerified: false,
    files: [{ id: 'original-file', version: 1, sha256: sha }] };
  const message = { conversationId: 'original-session', museOrderId: receipt.orderId, museReceiptHash: sha, museReceipt: receipt };
  assert.deepEqual(museMessageFiles(message), receipt.files);
  assert.equal(museMessageFiles({ conversationId: 'legacy' }), undefined);
  for (const invalid of [null, [], {}, { ...receipt, nativeAgentId: 'foreign-session' }, { ...receipt, files: {} },
    { ...receipt, files: [] }, { ...receipt, fence: 0 }, { ...receipt, independentlyVerified: true }]) assert.equal(museMessageFiles({ ...message, museReceipt: invalid }), null);
  assert.equal(museMessageFiles({ ...message, museOrderId: 'different-order' }), null);
});
test('invalid receipt hashes or acceptance dates do not invent delivery or acceptance', () => {
  const task = { ...muse('running').muse, status: 'review_required', executionStatus: 'submitted', receipt: { files: [{ id: 'file', version: 1, sha256: sha }] }, receiptHash: sha, returnedHash: sha };
  assert.equal(museState(task, now).delivered, true);
  assert.equal(museState({ ...task, receiptHash: 'invalid', returnedHash: 'invalid' }, now).delivered, false);
  assert.equal(museState({ ...task, returnedHash: 'b'.repeat(64) }, now).delivered, false);
  for (const acceptedAt of [null, {}, 'invalid', iso(now + 10000)]) {
    const invalid = { ...task, status: 'accepted', acceptedAt };
    assert.equal(museState(invalid, now).accepted, false); assert.equal(museOrderLabel(invalid), '验收记录待核对');
  }
  assert.equal(museState({ ...task, status: 'accepted', acceptedAt: iso(now) }, now).accepted, true);
  assert.equal(museState({ ...muse('running').muse, status: 'draft' }, now).active, false);
});
