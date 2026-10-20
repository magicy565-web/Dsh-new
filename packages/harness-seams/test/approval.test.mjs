// Approval seam tests: fake clock, one-shot TTL tickets, actor binding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TTL_MS,
  createApproval,
  createApprovalProvider,
} from '../src/approval.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { ACTOR_A, ACTOR_B, LOCAL_ADMIN, fakeClock, harnessError, stubApproval } from './helpers.mjs';

const pendingApproval = (t, options = {}) => {
  const clock = options.clock ?? fakeClock();
  const approval = createApproval({ clock, ttlMs: options.ttlMs });
  return { approval, clock };
};

test('request returns a pending ticket with requestedAt and expiresAt', () => {
  const clock = fakeClock(1_700_000_000_000);
  const approval = createApproval({ clock, ttlMs: 60_000 });
  const requested = approval.request({ actor: ACTOR_A, tool: 'demo_write', args: { value: 'x' }, reason: 'why not' });
  assert.equal(requested.status, 'pending');
  assert.equal(typeof requested.id, 'string');
  assert.ok(requested.id.length >= 8);

  const [item] = approval.list({ status: 'pending' });
  assert.equal(item.id, requested.id);
  assert.equal(item.tool, 'demo_write');
  assert.equal(item.status, 'pending');
  assert.equal(item.requestedAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(item.expiresAt, new Date(1_700_000_000_000 + 60_000).toISOString());
  assert.equal(item.reason, 'why not');
  assert.deepEqual(item.args, { value: 'x' });
  assert.deepEqual(item.actor, { subject: 'actor-a', role: 'user', workspaceId: 'local' });
  assert.equal(item.consumedAt, null);
  assert.deepEqual(approval.list({ status: 'approved' }), []);
  assert.equal(DEFAULT_TTL_MS, 60_000);
});

test('approve -> consume is one-shot; a second consume and re-decide fail closed', () => {
  const { approval } = pendingApproval();
  const { id } = approval.request({ actor: ACTOR_A, tool: 'demo_write', args: {} });
  assert.deepEqual(approval.decide(id, 'approve', ACTOR_A), { id, status: 'approved' });
  assert.equal(approval.consume(id, ACTOR_A), true);
  assert.throws(() => approval.consume(id, ACTOR_A), harnessError(ERROR.approvalRequired));
  assert.throws(() => approval.decide(id, 'approve', ACTOR_A), harnessError(ERROR.approvalRefused));
  const [item] = approval.list({ status: 'consumed' });
  assert.equal(item.id, id);
  assert.equal(typeof item.consumedAt, 'string');
});

test('pending or denied tickets cannot be consumed; decisions are immutable', () => {
  const { approval } = pendingApproval();
  const pending = approval.request({ actor: ACTOR_A, tool: 'demo_write' }).id;
  assert.throws(() => approval.consume(pending, ACTOR_A), harnessError(ERROR.approvalRequired));
  assert.deepEqual(approval.decide(pending, 'deny', ACTOR_A), { id: pending, status: 'denied' });
  assert.throws(() => approval.consume(pending, ACTOR_A), harnessError(ERROR.approvalRequired));
  assert.throws(() => approval.decide(pending, 'approve', ACTOR_A), harnessError(ERROR.approvalRefused));
});

test('TTL expiry auto-denies pending tickets; expired ids fail closed for consume and decide', () => {
  const clock = fakeClock(1_000_000);
  const approval = createApproval({ clock, ttlMs: 60_000 });
  const { id } = approval.request({ actor: ACTOR_A, tool: 'demo_write' });
  clock.advance(59_999);
  assert.equal(approval.list({ status: 'pending' })[0].status, 'pending');
  clock.advance(1);
  const [expired] = approval.list({ status: 'denied' });
  assert.equal(expired.id, id);
  assert.equal(expired.expired, true);
  assert.throws(() => approval.consume(id, ACTOR_A), harnessError(ERROR.approvalRequired));
  assert.throws(() => approval.decide(id, 'approve', ACTOR_A), harnessError(ERROR.approvalRefused));
});

test('ttlMs is configurable', () => {
  const clock = fakeClock();
  const approval = createApproval({ clock, ttlMs: 50 });
  approval.request({ actor: ACTOR_A, tool: 'demo_write' });
  clock.advance(49);
  assert.equal(approval.list({ status: 'pending' }).length, 1);
  clock.advance(1);
  assert.equal(approval.list({ status: 'pending' }).length, 0);
  assert.equal(approval.list({ status: 'denied' }).length, 1);
});

test('actor binding: another actor cannot decide or consume; an admin may decide', () => {
  const { approval } = pendingApproval();
  const { id } = approval.request({ actor: ACTOR_A, tool: 'demo_write' });
  assert.throws(() => approval.decide(id, 'approve', ACTOR_B), harnessError(ERROR.approvalRefused));
  assert.deepEqual(approval.decide(id, 'approve', LOCAL_ADMIN), { id, status: 'approved' });
  assert.throws(() => approval.consume(id, ACTOR_B), harnessError(ERROR.approvalRefused));
  assert.equal(approval.list({ status: 'approved' }).length, 1, 'a refused consume does not burn the ticket');
  assert.equal(approval.consume(id, ACTOR_A), true);
});

test('unknown and malformed ids are refused fail-closed', () => {
  const { approval } = pendingApproval();
  for (const id of ['does-not-exist', '', null, 42]) {
    assert.throws(() => approval.consume(id, ACTOR_A), harnessError(ERROR.approvalRequired));
    assert.throws(() => approval.decide(id, 'approve', ACTOR_A), harnessError(ERROR.approvalRefused));
  }
});

test('request/decide validate their inputs', () => {
  const { approval } = pendingApproval();
  assert.throws(() => approval.request({ actor: { role: 'user' }, tool: 'x' }), harnessError(ERROR.approvalRefused));
  assert.throws(() => approval.request({ actor: ACTOR_A }), harnessError(ERROR.approvalRefused));
  assert.throws(() => approval.request({ actor: ACTOR_A, tool: 'x', args: { big: 1n } }), harnessError(ERROR.approvalRefused));
  const circular = {};
  circular.self = circular;
  assert.throws(() => approval.request({ actor: ACTOR_A, tool: 'x', args: circular }), harnessError(ERROR.approvalRefused));
  const { id } = approval.request({ actor: ACTOR_A, tool: 'x' });
  assert.throws(() => approval.decide(id, 'maybe', ACTOR_A), harnessError(ERROR.approvalRefused));
  assert.throws(() => approval.list({ status: 'bogus' }), harnessError(ERROR.approvalRefused));
});

test('apply(ctx) registers ctx.approval and honours ttl from config', async () => {
  const clock = fakeClock();
  const ctx = {};
  const provider = createApprovalProvider({ clock, ttlMs: 1_000 });
  const dispose = await provider.apply(ctx, { ttlMs: 1_000 });
  const { id } = ctx.approval.request({ actor: ACTOR_A, tool: 'demo_write' });
  clock.advance(1_000);
  assert.equal(ctx.approval.list({})[0].status, 'denied');
  assert.equal(ctx.approval.list({})[0].id, id);
  await dispose();
  assert.equal(ctx.approval, undefined);
});

test('a second approval provider refuses to overwrite ctx.approval', async () => {
  const ctx = { approval: stubApproval() };
  const provider = createApprovalProvider();
  await assert.rejects(provider.apply(ctx, {}), harnessError(ERROR.pluginDuplicate));
});
