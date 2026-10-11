import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { controlScopeKey, projectControlSnapshot, createControlJournal, advanceControlJournal,
  replayControlEvents, acknowledgeControlCursor, recommendGoalSteps } from '../server/dot-control-plane.mjs';
import { museState } from '../src/experience/museControl.ts';
import { cloudJobState, jobNeedsAttention } from '../src/experience/cloudActivity.ts';

const now = Date.parse('2026-10-11T18:00:00Z');
const at = offset => new Date(now + offset).toISOString();
const hash = 'a'.repeat(64);
const principal = (userId = 'buyer-a', workspaceId = 'enterprise-a') => ({
  userId, workspaceId, policyVersion: 'policy-1',
  grants: [{ sourceId: 'original-host', scope: 'self', kinds: ['goal', 'order', 'task', 'attempt'] }],
});
const record = (status, extra = {}) => ({ kind: 'task', domain: 'dot', id: 'task-1', state: status,
  updatedAt: at(-1000), deadlineAt: at(600_000), ...extra });
const source = (records, sequence = 1, extra = {}) => ({ id: 'original-host', workspaceId: 'enterprise-a',
  visibility: 'private', userId: 'buyer-a', epoch: 'store-created-1', sequence,
  observedAt: at(0), updatedAt: at(-500), complete: true, records, ...extra });
const snapshot = (records, sequence = 1, extra = {}, who = principal()) => projectControlSnapshot({
  principal: who, sources: [source(records, sequence, extra)], now,
});
const leased = extra => record('leased', { attemptId: 'original-attempt', fence: 1, leaseUntil: at(60_000), ...extra });
const journal = snap => advanceControlJournal(createControlJournal(principal(), 'journal-1'), snap);
const replay = (state, snap, extra = {}) => replayControlEvents(state, { principal: principal(), snapshot: snap, epoch: state.epoch, ...extra });
const code = expected => error => error.code === expected;

test('private source is isolated across buyers and enterprises before metadata projection', () => {
  for (const who of [principal('buyer-b'), principal('buyer-a', 'enterprise-b')]) {
    const result = snapshot([record('queued', { privateBudget: 100, supplierFloor: 20 })], 1, {}, who);
    assert.deepEqual(result.records, []); assert.deepEqual(result.sources, []);
    assert.equal(result.counts.total, 0);
  }
});

test('workspace sharing is explicit; private rows cannot widen source or tenant permission', () => {
  const who = principal();
  who.grants[0].scope = 'workspace';
  const result = snapshot([
    record('queued', { id: 'shared' }),
    record('queued', { id: 'foreign-user', visibility: 'private', userId: 'buyer-b' }),
    record('queued', { id: 'foreign-enterprise', workspaceId: 'enterprise-b' }),
    record('queued', { id: 'unknown-scope', visibility: 'unreviewed' }),
  ], 1, { visibility: 'workspace', userId: undefined }, who);
  assert.deepEqual(result.records.map(row => row.id), ['shared']);
  assert.equal(snapshot([record('queued', { visibility: 'workspace' })], 1, {userId: 'buyer-b'}, who).records.length, 0);
});

test('self grants on shared legacy stores only expose explicitly owned private rows', () => {
  const result = snapshot([record('queued', { visibility: 'private', userId: 'buyer-a' }),
    record('queued', { id: 'legacy-shared' })], 1, { visibility: 'workspace', userId: undefined });
  assert.equal(result.records.length, 1); assert.equal(result.records[0].id, 'task-1');
});

test('query is pure and allowlists away budgets, prices, prompts, receipts and blocker text', () => {
  const sources = [source([record('blocked', { budgetCredits: 999, privateBudget: 'secret-budget',
    supplierFloor: 'secret-floor', title: 'secret-budget', prompt: 'secret-prompt',
    receipt: { report: 'secret-report' }, blocker: { code: 'INPUT_REQUIRED', message: 'secret-blocker' } })])];
  const before = structuredClone(sources);
  const output = projectControlSnapshot({ principal: principal(), sources, now });
  assert.deepEqual(sources, before);
  assert.equal(output.records[0].blockerCode, 'INPUT_REQUIRED');
  assert.equal(JSON.stringify(output).includes('secret-'), false);
  assert.deepEqual(output.executedActions, []);
});

test('snapshot has source and fact update times; stale and invalid observation disable activity', () => {
  const fresh = snapshot([leased()]);
  assert.equal(fresh.records[0].active, true);
  assert.equal(fresh.records[0].source.sequence, 1);
  assert.equal(fresh.records[0].updatedAt, at(-1000));
  assert.equal(fresh.records[0].freshness.observedAt, at(0));
  for (const extra of [
    { observedAt: at(-60_000), updatedAt: at(-61_000) },
    { observedAt: null }, { observedAt: at(1) }, { updatedAt: at(1) },
  ]) {
    const row = snapshot([leased()], 1, extra).records[0];
    assert.equal(row.active, false); assert.equal(row.status, 'unknown');
    assert.notEqual(row.freshness.state, 'fresh');
  }
  assert.equal(snapshot([leased({ updatedAt: at(1) })]).records[0].active, false);
});

test('draft, approval, dispatch, queue, claim, execution, blocker, return and acceptance stay separate', () => {
  const cases = [
    [record('draft'), 'draft'], [record('draft', { approvalRequired: true }), 'awaiting_approval'],
    [record('awaiting_approval'), 'awaiting_approval'], [record('approved'), 'awaiting_dispatch'],
    [record('dispatching'), 'dispatching'], [record('pending'), 'queued'], [leased(), 'claimed'],
    [leased({ state: 'running' }), 'running'], [record('blocked'), 'blocked'],
    [record('cancel_requested'), 'cancel_requested'], [record('cancelled'), 'cancelled'],
    [record('submitted'), 'return_pending'],
    [record('succeeded', { receiptHash: hash, returnedHash: hash }), 'returned'],
    [record('accepted', { status: 'accepted', acceptedAt: at(-1) }), 'accepted'],
    [record('accepted', { status: 'accepted' }), 'unknown'],
    [record('new-undocumented-status'), 'unknown'],
  ];
  for (const [input, expected] of cases) assert.equal(snapshot([input]).records[0].status, expected);
});

test('Muse parity with PR22: claim is not completed work, invalid lease is uncertain, cancellation wins', () => {
  const original = { agentKind: 'muse', orderId: 'order-1', taskRef: 'task-1', attemptId: 'attempt-1',
    fence: 1, status: 'running', executionStatus: 'claimed', updatedAt: at(-1000),
    deadlineAt: at(600_000), leaseUntil: at(30_000), acceptedAt: null, receipt: null };
  assert.equal(museState(original, now).state, 'leased');
  assert.equal(snapshot([{ ...original, kind: 'task', domain: 'muse' }]).records[0].status, 'claimed');
  const expired = { ...original, leaseUntil: at(0) };
  assert.equal(museState(expired, now).active, false);
  assert.equal(snapshot([{ ...expired, kind: 'task', domain: 'muse' }]).records[0].status, 'unknown');
  const late = { ...original, status: 'cancelled', receiptHash: hash, returnedHash: hash,
    receipt: {files: [{id: 'file-1'}]} };
  assert.equal(museState(late, now).state, 'cancelled');
  assert.equal(snapshot([{ ...late, kind: 'task', domain: 'muse' }]).records[0].status, 'cancelled');
});

test('lease/fence/deadline consistency is required; persisted goal status requires its original live run', () => {
  for (const input of [
    leased({attemptId: null}), leased({fence: 0}), leased({leaseUntil: at(0)}),
    leased({deadlineAt: at(0)}), leased({leaseExpiresAt: now + 9000}),
  ]) assert.equal(snapshot([input]).records[0].active, false);
  const goal = { kind: 'goal', id: 'goal-1', status: 'running', runId: 'run-1', updatedAt: at(-1000) };
  const run = { kind: 'attempt', domain: 'runtime', id: 'run-1', goalId: 'goal-1', status: 'running',
    startedAt: at(-2000), updatedAt: at(-1000) };
  assert.equal(snapshot([goal, run]).records.find(row => row.kind === 'goal').active, false);
  assert.equal(snapshot([goal, run], 1, { executionVerified: true }).records.find(row => row.kind === 'goal').active, true);
  assert.equal(snapshot([goal, { ...run, goalId: 'different' }], 1, { executionVerified: true }).records.find(row => row.kind === 'goal').active, false);
});

test('original closed failure remains failed history and no longer requires attention', () => {
  const original = {id:'task-1', state:'failed', nativeRequestId:'request-1', receiptHash:hash, returnedHash:hash, closedHash:hash};
  assert.equal(jobNeedsAttention(original, now), false);
  assert.equal(cloudJobState(original, now).state, 'failed');
  const row = snapshot([record('failed', original)]).records[0];
  assert.equal(row.status, 'failed'); assert.equal(row.closed, true); assert.equal(row.needsAttention, false);
  assert.equal(snapshot([record('failed', { ...original, closedHash: 'b'.repeat(64) })]).records[0].needsAttention, true);
});

test('first observation establishes baseline; duplicates, out of order and heartbeat do not notify', () => {
  const first = snapshot([record('queued')], 10);
  let state = journal(first);
  assert.equal(state.cursor, 0);
  const second = snapshot([leased()], 11);
  state = advanceControlJournal(state, second);
  assert.equal(state.cursor, 1); assert.equal(state.events[0].to, 'claimed');
  assert.deepEqual(advanceControlJournal(state, second), state);
  assert.deepEqual(advanceControlJournal(state, snapshot([record('failed')], 9)), state);
  state = advanceControlJournal(state, snapshot([leased({leaseUntil:at(90_000), updatedAt:at(-100)})], 12));
  assert.equal(state.cursor, 1); assert.equal(state.sources['original-host'].sequence, 12);
});

test('duplicate source sequence cannot rewrite facts or fabricate notification progress', () => {
  const state = journal(snapshot([record('queued')], 3));
  assert.deepEqual(advanceControlJournal(state, snapshot([record('running')], 3)), state);
});

test('late higher-sequence callbacks never reopen cancelled, accepted or closed original records', () => {
  for (const input of [record('cancelled'), record('accepted', {status:'accepted',acceptedAt:at(-1)}),
    record('failed', {receiptHash:hash,returnedHash:hash,closedHash:hash})]) {
    const state = journal(snapshot([input], 1));
    const next = advanceControlJournal(state, snapshot([leased({state:'running'})], 2));
    assert.equal(next.records[Object.keys(next.records)[0]].status, Object.values(state.records)[0].status);
    assert.equal(next.cursor, 0);
  }
  const cancelled = journal(snapshot([record('cancelled')], 1));
  assert.equal(advanceControlJournal(cancelled, snapshot([record('accepted',{status:'accepted',acceptedAt:at(-1)})],2)).cursor,0);
  assert.equal(snapshot([record('submitted', {cancelledAt:at(-1),receiptHash:hash,returnedHash:hash})]).records[0].status,'cancelled');
});

test('incomplete/stale reads do not remove records; complete disappearance is not task completion', () => {
  const baseline = journal(snapshot([record('queued')], 1));
  assert.equal(Object.keys(advanceControlJournal(baseline, snapshot([], 2, {complete:false})).records).length,1);
  assert.equal(Object.keys(advanceControlJournal(baseline, snapshot([], 2, {observedAt:at(-60_000),updatedAt:at(-61_000)})).records).length,1);
  const removed = advanceControlJournal(baseline, snapshot([], 2));
  assert.equal(removed.events[0].type,'removed'); assert.equal(removed.events[0].to,null);
  assert.equal(removed.events[0].sourceSequence,2);
});

test('persistent JSON replay/ack survives process-like restart without a new task or notification ID', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'tt041-journal-test-'));
  try {
    const first = snapshot([record('queued')],1), second = snapshot([leased()],2);
    const original = advanceControlJournal(journal(first),second);
    const filename = path.join(directory,'fixture-journal.json');
    await writeFile(filename,JSON.stringify(original));
    const restored = JSON.parse(await readFile(filename,'utf8'));
    assert.equal(replay(restored,second).events[0].id,'journal-1:1');
    const acknowledged = acknowledgeControlCursor(restored,{principal:principal(),consumerId:'mini-program',epoch:'journal-1',cursor:1});
    await writeFile(filename,JSON.stringify(acknowledged));
    const again = JSON.parse(await readFile(filename,'utf8'));
    assert.equal(replay(again,second,{after:again.consumers['mini-program']}).events.length,0);
    assert.equal(advanceControlJournal(again,second).cursor,1);
    assert.equal(acknowledgeControlCursor(again,{principal:principal(),consumerId:'mini-program',epoch:'journal-1',cursor:0}).consumers['mini-program'],1);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.equal(path.basename(directory).startsWith('tt041-journal-test-'),true);
    await rm(directory,{recursive:true,force:true});
  }
});

test('replay validates actor/policy/epoch/cursor and reauthorizes each record; extra event data is stripped', () => {
  const first = snapshot([record('queued')],1), second = snapshot([leased()],2);
  const state = advanceControlJournal(journal(first),second);
  const other = principal('buyer-b');
  assert.throws(()=>replayControlEvents(state,{principal:other,snapshot:second,epoch:state.epoch}),code('CONTROL_SCOPE_MISMATCH'));
  const changed = {...principal(),policyVersion:'policy-2'};
  assert.notEqual(controlScopeKey(changed),state.scopeKey);
  assert.throws(()=>replayControlEvents(state,{principal:changed,snapshot:second,epoch:state.epoch}),code('CONTROL_SCOPE_MISMATCH'));
  assert.equal(replay(state,second,{epoch:'old-epoch'}).resetRequired,true);
  assert.equal(replay(state,second,{after:2}).resetRequired,true);
  assert.throws(()=>replay(state,second,{after:-1}),code('CONTROL_CURSOR_INVALID'));
  assert.equal(replay(state,{...second,records:[]}).events.length,0);
  const tampered = structuredClone(state); tampered.events[0].privateBudget='secret';
  assert.equal(JSON.stringify(replay(tampered,second)).includes('secret'),false);
  tampered.events[0].id='forged';
  assert.throws(()=>replay(tampered,second),code('CONTROL_JOURNAL_INVALID'));
});

test('bounded replay preserves page cursor and signals a retained-history gap honestly', () => {
  let state = journal(snapshot([record('queued')],1)), snap;
  for (let sequence=2;sequence<=5;sequence++) {
    snap=snapshot([record(sequence%2?'queued':'blocked')],sequence);
    state=advanceControlJournal(state,snap,{retain:2});
  }
  assert.equal(state.floor,2);
  assert.equal(replay(state,snap,{after:0}).resetRequired,true);
  const page=replay(state,snap,{after:2,limit:1});
  assert.equal(page.cursor,3); assert.equal(page.hasMore,true);
  assert.equal(replay(state,snap,{after:page.cursor}).events[0].cursor,4);
});

test('source epoch changes and absent source ordering require explicit resync, never a guessed order', () => {
  const state=journal(snapshot([record('queued')],1));
  assert.throws(()=>advanceControlJournal(state,snapshot([leased()],2,{epoch:'replacement-store'})),code('CONTROL_SOURCE_EPOCH_CHANGED'));
  assert.throws(()=>journal(snapshot([record('queued')],1,{sequence:null})),code('CONTROL_ORDER_UNKNOWN'));
  assert.throws(()=>acknowledgeControlCursor(state,{principal:principal(),consumerId:'web',epoch:'journal-1',cursor:1}),code('CONTROL_CURSOR_INVALID'));
});

const goal = extra => ({kind:'goal',id:'procurement-goal',status:'draft',revision:3,updatedAt:at(-1000),deadlineAt:at(600_000),...extra});
const goalFacts = snap => ({goalKey:snap.records.find(row=>row.kind==='goal').key,
  sourceEpoch:'store-created-1',sourceSequence:1,revision:3,dependencies:[],missingMaterials:[],
  approvedRevision:3,budgetAuthorized:true,shareRequested:false,
  evidenceRefs:['dependencies','materials','authorization','budget','sharing'].map(category=>({
    category,recordId:'original-'+category,version:3,sourceId:'original-host',
    sourceEpoch:'store-created-1',sourceSequence:1,
  }))});
test('Goal advice states missing evidence, revision invalidation, budget and material requirements', () => {
  const snap=snapshot([goal()]);
  assert.deepEqual(recommendGoalSteps(snap,{now})[0].missingEvidence,['dependencies','materials','authorization','budget','sharing_scope']);
  const facts=goalFacts(snap);
  assert.equal(recommendGoalSteps(snap,{facts:[{...facts,revision:2}],now})[0].action,'gather_goal_evidence');
  assert.equal(recommendGoalSteps(snap,{facts:[{...facts,approvedRevision:2}],now})[0].action,'review_current_version');
  assert.equal(recommendGoalSteps(snap,{facts:[{...facts,budgetAuthorized:false}],now})[0].action,'review_budget_authority');
  assert.equal(recommendGoalSteps(snap,{facts:[{...facts,evidenceRefs:facts.evidenceRefs.filter(ref=>ref.category!=='budget')}],now})[0].action,'review_budget_authority');
  assert.equal(recommendGoalSteps(snap,{facts:[{...facts,missingMaterials:['quantity','delivery-date']}],now})[0].action,'provide_materials');
  const proposed=recommendGoalSteps(snap,{facts:[facts],now})[0];
  assert.equal(proposed.action,'review_next_step'); assert.equal(proposed.executable,false); assert.equal(proposed.executed,false);
});

test('Goal dependency evidence must be visible, fresh and business accepted; provider completion is insufficient', () => {
  const snap=snapshot([goal(),record('completed',{kind:'attempt',id:'dependency-1'})]);
  const dependency=snap.records.find(row=>row.kind==='attempt');
  const facts={...goalFacts(snap),dependencies:[dependency.key]};
  assert.equal(recommendGoalSteps(snap,{facts:[facts],now})[0].action,'resolve_dependencies');
  const accepted=snapshot([goal(),record('accepted',{status:'accepted',acceptedAt:at(-1),kind:'order',id:'dependency-1'})]);
  const ready={...goalFacts(accepted),dependencies:[accepted.records.find(row=>row.kind==='order').key]};
  assert.equal(recommendGoalSteps(accepted,{facts:[ready],now})[0].action,'review_next_step');
  assert.equal(recommendGoalSteps(accepted,{facts:[{...ready,dependencies:['foreign-secret-reference']}],now})[0].action,'resolve_dependencies');
});

test('procurement profile delivery requires exact recipient, explicit scope and approval of the current profile version', () => {
  const snap=snapshot([goal()]);
  const facts={...goalFacts(snap),shareRequested:true,recipientId:'merchant-a',scopeConfirmed:true,
    profileVersion:4,approvedProfileVersion:4,privateBudget:'secret',supplierFloor:'secret'};
  facts.evidenceRefs[0].privateBudget='secret-ref';
  for (const missing of [{recipientId:null},{scopeConfirmed:false},{approvedProfileVersion:3}]) {
    const advice=recommendGoalSteps(snap,{facts:[{...facts,...missing}],now})[0];
    assert.equal(advice.action,'review_sharing_scope'); assert.equal(advice.executed,false);
  }
  const ready=recommendGoalSteps(snap,{facts:[facts],now})[0];
  assert.equal(ready.action,'review_profile_delivery'); assert.equal(ready.requiresApproval,true);
  assert.equal(JSON.stringify(ready).includes('secret'),false);
});

test('stale, expired, blocked, result review and cancellation advice never starts or resends work', () => {
  const cases=[
    [snapshot([goal()],1,{observedAt:at(-60_000),updatedAt:at(-61_000)}),'refresh_source'],
    [snapshot([goal({deadlineAt:at(0)})]),'review_expired_scope'],
    [snapshot([goal({status:'blocked'})]),'inspect_blocker'],
    [snapshot([goal({status:'review_required'})]),'review_result'],
    [snapshot([goal({status:'cancel_requested'})]),'verify_original_stop'],
  ];
  for (const [snap,expected] of cases) {
    const advice=recommendGoalSteps(snap,{now})[0];
    assert.equal(advice.action,expected); assert.equal(advice.executable,false);
  }
});
