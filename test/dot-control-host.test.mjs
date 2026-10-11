import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerServiceDesk} from '../server/worker-desk.mjs';
import {createDotWorkerBridge} from '../server/dot-worker-bridge.mjs';
import {createRuntime} from '../server/runtime.mjs';
import {adaptWorkspaceControlSource,createWorkspaceControlReader} from '../server/dot-control-plane-host.mjs';
import {projectControlSnapshot,createControlJournal,advanceControlJournal} from '../server/dot-control-plane.mjs';

const who={workspaceId:'original-workspace',userId:'requester',policyVersion:'policy-1',
  grants:[{sourceId:'workspace-host',scope:'workspace',kinds:['goal','order','task','attempt']}]};
const now=()=>Date.now();
// Serialized copy-on-write fixture matching original store V2 metadata.
// No fsync, ACL, genuine native Host or live provider is claimed.
function fixture() {
  const at=new Date().toISOString();
  let state={version:2,meta:{sequence:0,createdAt:at,updatedAt:at},
    workerOrders:[],conversations:[],messages:[],goals:[],runs:[],activity:[],memories:[],artifacts:[],
    settings:{name:'Fixture',language:'en',model:'fixture'},capabilities:{version:1,
      skills:[],connectors:[],approvals:[],schedules:[],scheduleRuns:[],connectorRuns:[]}};
  const store={read:()=>structuredClone(state),async update(callback){
    const next=structuredClone(state),result=callback(next);
    next.meta={...state.meta,sequence:state.meta.sequence+1,updatedAt:new Date().toISOString()};
    state=next;return structuredClone(result);
  }};
  const bridge=createDotWorkerBridge({store,artifacts:{download(){throw Error('No file requested');},create(){throw Error('No upload requested');}},
    workerId:'original-dot',ownerId:'xy',enabled:true,scopeReviewed:true,externalBudgetVerified:true});
  const desk=createWorkerServiceDesk({store,adapters:{'original-dot':bridge.adapter}});
  const reader=createWorkspaceControlReader({readContext:()=>({principal:who,sharedWorkspace:true}),
    readState:store.read,now});
  const input=requestId=>({requestId,workerId:'original-dot',serviceId:'channel-validation',
    product:'Synthetic public product',market:'US',objective:'Offline record-shape contract only',
    budgetCredits:5,deadlineAt:new Date(Date.now()+86400_000).toISOString(),publicDataConfirmed:true});
  return {store,bridge,desk,reader,input};
}
const taskOf=snapshot=>snapshot.records.find(row=>row.kind==='task');

test('actual WorkerDesk and Dot bridge records preserve original order/request/worker and lease stages',async()=>{
  const f=fixture(),{order}=await f.desk.create(f.input('original-request'),'requester');
  const read=await f.reader.read();
  assert.equal(read.records[0].status,'draft');assert.equal(read.sources[0].sequence,f.store.read().meta.sequence);
  const before=f.store.read(); await f.reader.read();assert.deepEqual(f.store.read(),before);
  await f.desk.approve(order.id,'requester',{confirmed:true,workerId:'original-dot'});
  assert.equal((await f.reader.read()).records[0].status,'awaiting_dispatch');
  await f.desk.dispatch(order.id);
  assert.equal(taskOf(await f.reader.read()).status,'queued');
  const claim=await f.bridge.claimTask({taskRef:order.id,requestId:'claim-1'});
  const snapshot=await f.reader.read(),task=taskOf(snapshot);
  assert.equal(task.status,'claimed');assert.equal(task.active,true);
  assert.equal(task.orderId,order.id);assert.equal(task.taskRef,order.id);
  assert.equal(task.requestId,'original-request');assert.equal(task.workerId,'original-dot');
  assert.equal(task.attemptId,claim.attemptId);assert.equal(task.fence,claim.fence);
  assert.equal(task.linkage.task,'verified');assert.equal(task.origin.collection,'dotTasks');
  assert.equal(task.taskUpdatedAt,f.store.read().dotTasks[0].updatedAt);
  assert.equal(JSON.stringify(snapshot).includes('Synthetic public product'),false);
});

test('actual cancellation and stop acknowledgment stay on the original attempt; query never polls or dispatches',async()=>{
  const f=fixture(),{order}=await f.desk.create(f.input('cancel-request'),'requester');
  await f.desk.approve(order.id,'requester',{confirmed:true,workerId:'original-dot'});await f.desk.dispatch(order.id);
  const attempt=await f.bridge.claimTask({taskRef:order.id,requestId:'cancel-claim'});
  await f.desk.cancel(order.id);
  const snapshot=await f.reader.read(),before=f.store.read();
  assert.equal(taskOf(snapshot).status,'cancel_requested');assert.equal(taskOf(snapshot).active,false);
  await f.reader.read();assert.deepEqual(f.store.read(),before);
  await f.bridge.confirmStop({taskRef:order.id,attemptId:attempt.attemptId,fence:attempt.fence,requestId:'stop'});
  await f.desk.refresh(order.id); // Explicit fixture lifecycle action, never performed by reader.
  assert.equal(taskOf(await f.reader.read()).status,'cancelled');
});

test('real runtime-created Goal/run shapes use recorded timestamps without assuming active counts prove a live attempt',async t=>{
  const f=fixture();
  const runtime=await createRuntime({store:f.store,provider:{kind:'fixture',configured:false,
    complete(){throw Error('This test authorizes no model call');}},autoStart:false});
  t.after(()=>runtime.close());
  const {goal}=await runtime.createGoal({title:'Fixture Goal',description:'Offline shape'});
  await runtime.updateGoal(goal.id,{action:'start',requestId:'goal-start'});
  const raw=f.store.read(),snapshot=await f.reader.read();
  const projected=snapshot.records.find(row=>row.kind==='goal'&&row.id===goal.id);
  const attempt=snapshot.records.find(row=>row.kind==='attempt'&&row.goalId===goal.id);
  assert.equal(projected.status,'blocked');assert.equal(projected.conversationId,raw.goals[0].conversationId);
  assert.equal(attempt.id,raw.runs[0].id);assert.equal(attempt.attemptId,raw.runs[0].id);
  assert.equal(Object.hasOwn(raw.runs[0],'updatedAt'),false);
  // A blocked run records finishedAt before addRun records createdAt. Either
  // timestamp may be later; the projection must retain the latest saved fact.
  const recordedTimes=[raw.runs[0].createdAt,raw.runs[0].finishedAt].sort();
  assert.equal(attempt.updatedAt,recordedTimes.at(-1));assert.equal(attempt.updatedAtOrigin,'run-timestamps');
  assert.equal(attempt.active,false);assert.equal(attempt.linkage.conversation,'verified');
});

test('orphan/foreign tasks cannot be adopted; a mismatched task binding is unknown and cannot become active',async()=>{
  const f=fixture(),{order}=await f.desk.create(f.input('shape-bind'),'requester');
  await f.desk.approve(order.id,'requester',{confirmed:true,workerId:'original-dot'});await f.desk.dispatch(order.id);
  await f.bridge.claimTask({taskRef:order.id,requestId:'claim-bind'});
  await f.store.update(state=>{
    state.dotTasks.push({...state.dotTasks[0],id:'orphan',orderId:'missing-order'});
    state.dotTasks[0].attemptId='different';state.dotTasks[0].deadlineAt=new Date(Date.now()+1000).toISOString();
  });
  const snapshot=await f.reader.read(),tasks=snapshot.records.filter(row=>row.kind==='task');
  assert.equal(tasks.length,1);assert.equal(tasks[0].status,'unknown');assert.equal(tasks[0].active,false);
  assert.equal(tasks[0].linkage.task,'mismatch');
});

test('legacy shared Goal records require the explicit existing workspace grant, never inferred private ownership',async()=>{
  const f=fixture();
  const state=f.store.read();state.goals=[{id:'legacy-goal',status:'draft',revision:0,updatedAt:new Date().toISOString()}];
  const privateWho={...who,grants:[{...who.grants[0],scope:'self'}]};
  const source=adaptWorkspaceControlSource({state,principal:privateWho,observedAt:now()});
  assert.equal(source.records.length,0);
});

test('missing native metadata remains unknown ordering; no hash/read count is invented as persistent sequence',()=>{
  const f=fixture(),state=f.store.read();delete state.meta;
  state.workerOrders=[{id:'order-1',createdBy:'requester',requestId:'request-1',status:'draft',updatedAt:new Date().toISOString()}];
  const source=adaptWorkspaceControlSource({state,principal:who,observedAt:now(),sharedWorkspace:true});
  const snapshot=projectControlSnapshot({principal:who,sources:[source],now:now()});
  assert.equal(snapshot.sources[0].ordering,'unknown');assert.equal(snapshot.sources[0].sequence,null);
  assert.throws(()=>advanceControlJournal(createControlJournal(who,'journal-1'),snapshot),{code:'CONTROL_ORDER_UNKNOWN'});
});

test('unavailable/torn source is explicit and reconnect replay preserves its cursor rather than dropping events',async()=>{
  const f=fixture(),{order}=await f.desk.create(f.input('replay'),'requester');
  const initial=await f.reader.read();
  let journal=advanceControlJournal(createControlJournal(who,'journal-1'),initial);
  await f.desk.approve(order.id,'requester',{confirmed:true,workerId:'original-dot'});
  const next=await f.reader.read();journal=advanceControlJournal(journal,next);
  const reader=createWorkspaceControlReader({readContext:()=>({principal:who,sharedWorkspace:true}),
    readState:()=>{throw Object.assign(Error('Private path must not leave the host'),{code:'STORAGE_UNAVAILABLE'});},now});
  const unavailable=await reader.read();
  assert.equal(unavailable.sources[0].freshness.availability,'unavailable');
  assert.equal(unavailable.sources[0].freshness.state,'unknown');
  assert.equal(unavailable.sources[0].freshness.reason,'STORAGE_UNAVAILABLE');
  const replay=await reader.replay(journal,{epoch:'journal-1',after:0});
  assert.equal(replay.unavailable,true);assert.equal(replay.cursor,0);assert.deepEqual(replay.events,[]);
  const resumed=await f.reader.replay(journal,{epoch:'journal-1',after:0});
  assert.equal(resumed.events.length,1);assert.equal(resumed.events[0].to,'awaiting_dispatch');
  let reads=0;
  const torn=createWorkspaceControlReader({readContext:()=>({principal:who,sharedWorkspace:true}),
    readState:()=>({...f.store.read(),tornRead:++reads}),now});
  assert.equal((await torn.read()).sources[0].freshness.reason,'CONTROL_HOST_SNAPSHOT_CHANGED');
});

test('original authorization/epoch failure propagates and cannot produce cached or cross-owner data',async()=>{
  const f=fixture();
  const reader=createWorkspaceControlReader({readContext:()=>{
    throw Object.assign(Error('Original scope revoked'),{code:'WORKSPACE_PLUGIN_STALE'});
  },readState:f.store.read,now});
  await assert.rejects(reader.read(),{code:'WORKSPACE_PLUGIN_STALE'});
  assert.throws(()=>adaptWorkspaceControlSource({state:f.store.read(),principal:who,observedAt:now(),
    binding:{actor:{subject:'foreign-user',nativeAgentId:'session'},workerId:'worker'}}),{code:'CONTROL_HOST_OWNER_MISMATCH'});
});

test('original native owner/session syntax is preserved without renaming identities or widening task IDs',()=>{
  const f=fixture(),state=f.store.read(),actor={subject:'requester@example',nativeAgentId:'session/original'};
  const principal={...who,userId:actor.subject,grants:[{...who.grants[0],scope:'self'}]};
  state.conversations=[{id:actor.nativeAgentId,...actor}];
  state.goals=[{id:'goal-1',createdBy:actor.subject,conversationId:actor.nativeAgentId,status:'draft',updatedAt:new Date().toISOString()}];
  const source=adaptWorkspaceControlSource({state,principal,binding:{actor,workerId:'original-worker'},observedAt:now()});
  const snapshot=projectControlSnapshot({principal,sources:[source],now:now()});
  assert.equal(snapshot.records[0].conversationId,actor.nativeAgentId);
  source.records[0].id='task/unreviewed';
  assert.throws(()=>projectControlSnapshot({principal,sources:[source],now:now()}),{code:'CONTROL_RECORD_INVALID'});
});

test('mismatched original conversation cannot certify completed Goal or accepted order; cancellation still wins',()=>{
  const f=fixture(),state=f.store.read();
  state.goals=[{id:'goal-1',createdBy:'requester',conversationId:'missing',status:'completed',updatedAt:new Date().toISOString()}];
  state.workerOrders=[{id:'order-1',createdBy:'requester',conversationId:'missing',status:'accepted',
    acceptedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
  const read=()=>projectControlSnapshot({principal:who,sources:[adaptWorkspaceControlSource({state,principal:who,
    observedAt:now(),sharedWorkspace:true})],now:now()});
  assert.deepEqual(read().records.map(row=>row.status),['unknown','unknown']);
  assert.equal(read().records.find(row=>row.kind==='order').acceptance,'not_verified');
  state.workerOrders[0].status='cancelled';assert.equal(read().records.find(row=>row.kind==='order').status,'cancelled');
});
