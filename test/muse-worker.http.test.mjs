import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const dotKey = 'unit-test-dot-credential-1234567890_ABCDEF';
const museKey = 'unit-test-muse-credential-1234567890_ABCDEF';
const doc = 'https://www.loc.gov/about/';
const role = (workerId, requestId) => ({
  serviceId:'buyer-discovery', workerId, requestId,
  product:'Test public textile catalog', market:'United States',
  objective:'Test the authenticated external worker order lifecycle',
  budgetCredits:10, deadlineAt:new Date(Date.now()+2*86400_000).toISOString(),
  publicDataConfirmed:true,
});
const report = id => ({
  schema:'workspace.worker.delivery.v1', orderId:id,
  deliverables:[{name:'Test sourced candidates',type:'table',summary:'Test fixture only; no independent sourcing or outreach'}],
  evidence:[{title:'Public source fixture',url:doc,detail:'Used to exercise the schema, not a verified commercial buyer'}],
  prospects:[{name:'Synthetic Test Prospect',country:'United States',website:'https://www.loc.gov',
    fitReason:'Unit fixture only',sourceUrl:doc}],
});
async function setup(t, opts={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'workspace-muse-http-'));
  const config={ dataDirectory:directory,
    dotWorkerConfig:{workerId:'chatgpt-dot-xy',ownerId:'xy',tokenDigest:hash(dotKey),
      enabled:true,scopeReviewed:true,externalBudgetVerified:true},
    museWorkerConfig:{workerId:'muse-personal-alpha',ownerId:'alpha',tokenDigest:hash(museKey),
      enabled:true,scopeReviewed:true,externalBudgetVerified:true},
    ...opts,
  };
  let app=await createApp(config);
  let address=await app.listen(0);
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  async function restart() {
    await app.close();
    app=await createApp(config);
    address=await app.listen(0);
  }
  async function call(endpoint,method='GET',body,credential) {
    const headers={};
    if(credential)headers.Authorization='Bearer '+credential;
    if(body !== undefined)headers['Content-Type']='application/json';
    const response=await fetch('http://127.0.0.1:'+address.port+endpoint,{
      method,headers,body:body === undefined ? undefined :JSON.stringify(body),
    });
    return {status:response.status,data:await response.json()};
  }
  return {app:()=>app,call,restart};
}
async function dispatch(call,workerId,requestId) {
  const draft=await call('/api/worker-orders','POST',role(workerId,requestId));
  assert.equal(draft.status,201);
  const id=draft.data.order.id;
  assert.equal((await call('/api/worker-orders/'+id+'/approve','POST',
    {confirmed:true,workerId})).status,200);
  assert.equal((await call('/api/worker-orders/'+id+'/dispatch','POST',{})).status,200);
  return id;
}

test('Muse is separately authenticated, has its own task queue, and cannot view Dot tasks',async t=>{
  const {call,restart}=await setup(t);
  const museBase='/api/muse-worker/v1';
  const identity=await call(museBase+'/identity','GET',undefined,museKey);
  assert.equal(identity.status,200);
  assert.equal(identity.data.muse,'alpha');
  assert.equal(identity.data.workerId,'muse-personal-alpha');
  assert.equal(identity.data.connected,false);
  assert.equal((await call(museBase+'/identity','GET',undefined,dotKey)).status,401);
  assert.equal((await call(museBase+'/identity')).status,401);
  const dotOrder=await dispatch(call,'chatgpt-dot-xy','dot-fixture-order-001');
  const museOrder=await dispatch(call,'muse-personal-alpha','muse-fixture-order-001');
  const inbox=await call(museBase+'/inbox','GET',undefined,museKey);
  assert.deepEqual(inbox.data.tasks.map(x=>x.taskRef),[museOrder]);
  const dotInbox=await call('/api/dot-worker/v1/inbox','GET',undefined,dotKey);
  assert.deepEqual(dotInbox.data.tasks.map(x=>x.taskRef),[dotOrder]);
  assert.equal((await call(museBase+'/tasks/'+dotOrder,'GET',undefined,museKey)).status,404);
  assert.equal((await call('/api/dot-worker/v1/tasks/'+museOrder,'GET',undefined,dotKey)).status,404);
  assert.equal((await call(museBase+'/tasks/'+museOrder+'/status','GET',undefined,dotKey)).status,401);
  const claim=await call(museBase+'/tasks/'+museOrder+'/claim','POST',{requestId:'stable-claim-01'},museKey);
  assert.equal(claim.status,200);
  assert.equal(claim.data.fence,1);
  const replay=await call(museBase+'/tasks/'+museOrder+'/claim','POST',{requestId:'stable-claim-01'},museKey);
  assert.equal(replay.data.duplicate,true);
  assert.equal(replay.data.attemptId,claim.data.attemptId);
  assert.equal(replay.data.fence,claim.data.fence);
  await restart();
  assert.equal((await call(museBase+'/tasks/'+museOrder+'/status','GET',undefined,museKey)).data.attemptId,claim.data.attemptId);
  assert.equal((await call(museBase+'/inbox','GET',undefined,museKey)).data.tasks.length,0);
  assert.equal((await call('/api/dot-worker/v1/inbox','GET',undefined,dotKey)).data.tasks.length,1);
});

test('Muse REST rejects unknown fields and enforces the approved task deadline across heartbeats',async t=>{
  const {call,app}=await setup(t);
  const base='/api/muse-worker/v1';
  const first=await dispatch(call,'muse-personal-alpha','muse-deadline-order-004');
  const ignored=await call(base+'/tasks/'+first+'/claim','POST',
    {requestId:'claim-004',workerId:'chatgpt-dot-xy'},museKey);
  assert.equal(ignored.status,400);
  assert.equal(ignored.data.error.code,'MW_INPUT_INVALID');
  const claim=(await call(base+'/tasks/'+first+'/claim','POST',{requestId:'claim-004'},museKey)).data;
  assert.equal(claim.claimed,true);
  const invalidPulse=await call(base+'/tasks/'+first+'/heartbeat','POST',{
    attemptId:claim.attemptId,fence:claim.fence,requestId:'heartbeat-004',extraPrivilege:true,
  },museKey);
  assert.equal(invalidPulse.status,400);
  assert.equal(invalidPulse.data.error.code,'MW_INPUT_INVALID');

  // Force a real expired deadline in the durable test store; the original
  // server-issued attempt/fence must not restore execution authority.
  await app().store.update(state=>{
    const row=state.museTasks.find(task=>task.id===first);
    row.deadlineAt=new Date(Date.now()-1000).toISOString();
  });
  const status=await call(base+'/tasks/'+first+'/status','GET',undefined,museKey);
  assert.equal(status.data.canExecute,false);
  const heartbeat=await call(base+'/tasks/'+first+'/heartbeat','POST',{
    attemptId:claim.attemptId,fence:claim.fence,requestId:'heartbeat-expired-004',
  },museKey);
  assert.equal(heartbeat.status,409);
  assert.equal(heartbeat.data.error.code,'MW_LEASE_EXPIRED');
  const replay=await call(base+'/tasks/'+first+'/claim','POST',{requestId:'claim-004'},museKey);
  assert.equal(replay.status,409);

  // Test-only server-side closure after validating the stale lease; otherwise
  // the one-attempt slot intentionally prevents any second claim.
  await app().store.update(state=>{
    state.museTasks.find(task=>task.id===first).status='stopped';
  });
  const second=await dispatch(call,'muse-personal-alpha','muse-pending-deadline-004');
  await app().store.update(state=>{
    state.museTasks.find(task=>task.id===second).deadlineAt=new Date(Date.now()-1000).toISOString();
  });
  const inbox=await call(base+'/inbox','GET',undefined,museKey);
  assert.equal(inbox.data.tasks.some(task=>task.taskRef===second),false);
  const late=await call(base+'/tasks/'+second+'/claim','POST',{requestId:'late-claim-004'},museKey);
  assert.equal(late.status,409);
  assert.equal(late.data.error.code,'MW_DEADLINE_EXPIRED');
});

test('Muse can submit actual file bytes with sources and an explicit non-verifiable receipt note',async t=>{
  const {call}=await setup(t);
  const base='/api/muse-worker/v1';
  const id=await dispatch(call,'muse-personal-alpha','muse-evidence-order-002');
  const claim=(await call(base+'/tasks/'+id+'/claim','POST',{requestId:'claim-evidence-02'},museKey)).data;
  const invalid=await call(base+'/tasks/'+id+'/submit-result','POST',{
    attemptId:claim.attemptId,fence:claim.fence,requestId:'result-before-file',
    summary:'Fixture',sources:[doc],toolEvidence:[],
  },museKey);
  assert.equal(invalid.status,400);
  assert.equal(invalid.data.error.code,'MW_EVIDENCE_REQUIRED');
  const blob=Buffer.from(JSON.stringify(report(id)));
  const upload=await call(base+'/tasks/'+id+'/upload-file','POST',{
    attemptId:claim.attemptId,fence:claim.fence,uploadId:'evidence-upload-01',
    filename:'buyers.json',base64:blob.toString('base64'),sha256:hash(blob),
  },museKey);
  assert.equal(upload.status,201);
  const mutuallyExclusive=await call(base+'/tasks/'+id+'/submit-result','POST',{
    attemptId:claim.attemptId,fence:claim.fence,requestId:'invalid-double-evidence',
    summary:'Mixed evidence must be rejected',sources:[doc],
    toolEvidence:[{tool:'search',receiptId:'real-only-if-proven'}],
    evidenceNote:'Unverified tool evidence was also supplied.',
  },museKey);
  assert.equal(mutuallyExclusive.status,400);
  assert.equal(mutuallyExclusive.data.error.code,'MW_EVIDENCE_REQUIRED');
  const placeholder=await call(base+'/tasks/'+id+'/submit-result','POST',{
    attemptId:claim.attemptId,fence:claim.fence,requestId:'muse-placeholder-02',
    summary:'Unverified source fixture',sources:[doc],
    toolEvidence:[],evidenceNote:'TODO',
  },museKey);
  assert.equal(placeholder.status,400);
  assert.equal(placeholder.data.error.code,'MW_EVIDENCE_INVALID');
  const resultPayload={
    attemptId:claim.attemptId,fence:claim.fence,requestId:'muse-submit-02',
    summary:'Synthetic candidate, unit-test data only',sources:[doc],
    toolEvidence:[],evidenceNote:'Muse tool receipts are not server-verifiable; manual review required.',
  };
  const result=await call(base+'/tasks/'+id+'/submit-result','POST',resultPayload,museKey);
  assert.equal(result.status,200);
  assert.equal(result.data.reviewRequired,true);
  assert.equal(result.data.independentlyVerified,false);
  const replay=await call(base+'/tasks/'+id+'/submit-result','POST',resultPayload,museKey);
  assert.equal(replay.status,200);
  assert.equal(replay.data.duplicate,true);
  const refreshed=await call('/api/worker-orders/'+id+'/refresh','POST',{});
  assert.equal(refreshed.data.order.status,'review_required');
  assert.equal(refreshed.data.order.workerReport.independentlyVerified,false);
  const accepted=await call('/api/worker-orders/'+id+'/accept','POST',{confirmed:true});
  assert.equal(accepted.data.order.status,'accepted');
});

test('Muse cancellation requires actual stop acknowledgment; claim cannot silently migrate',async t=>{
  const {call}=await setup(t);
  const base='/api/muse-worker/v1';
  const first=await dispatch(call,'muse-personal-alpha','muse-cancel-order-003');
  const second=await dispatch(call,'muse-personal-alpha','muse-next-order-003');
  const attempt=(await call(base+'/tasks/'+first+'/claim','POST',{requestId:'claim-cancel-03'},museKey)).data;
  const busy=await call(base+'/tasks/'+second+'/claim','POST',{requestId:'claim-next-03'},museKey);
  assert.equal(busy.status,409);
  assert.equal(busy.data.error.code,'MW_SLOT_BUSY');
  const cancelled=await call('/api/worker-orders/'+first+'/cancel','POST',{});
  assert.equal(cancelled.data.order.status,'cancel_requested');
  assert.equal((await call(base+'/tasks/'+first+'/status','GET',undefined,museKey)).data.canExecute,false);
  const stop=await call(base+'/tasks/'+first+'/confirm-stop','POST',{
    attemptId:attempt.attemptId,fence:attempt.fence,requestId:'stop-03',
  },museKey);
  assert.equal(stop.status,200);
  assert.equal(stop.data.status,'stopped');
  const other=await call(base+'/tasks/'+first+'/claim','POST',{requestId:'new-claim-after-cancel'},museKey);
  assert.equal(other.status,409);
});

test('Muse remains non-executable without reviewed external hard budget',async t=>{
  const {call}=await setup(t,{museWorkerConfig:{
    workerId:'muse-personal-alpha',ownerId:'alpha',tokenDigest:hash(museKey),
    enabled:true,scopeReviewed:true,externalBudgetVerified:false,
  }});
  const base='/api/muse-worker/v1';
  assert.equal((await call(base+'/identity','GET',undefined,museKey)).data.approved,false);
  assert.deepEqual((await call(base+'/inbox','GET',undefined,museKey)).data.tasks,[]);
  const catalog=await call('/api/worker-services');
  const buyer=catalog.data.services.find(x=>x.id==='buyer-discovery');
  assert.ok(!buyer.workers.some(x=>x.id==='muse-personal-alpha'));
  assert.equal((await call(base+'/tasks/missing/claim','POST',{requestId:'not-authorized'},museKey)).status,403);
});

test('Muse cancellation after submission remains requested until the original attempt acknowledges stop',async t=>{
  const {call}=await setup(t);
  const base='/api/muse-worker/v1';
  const id=await dispatch(call,'muse-personal-alpha','muse-submit-cancel-005');
  const attempt=(await call(base+'/tasks/'+id+'/claim','POST',{requestId:'claim-submit-cancel-005'},museKey)).data;
  const bytes=Buffer.from(JSON.stringify(report(id)));
  assert.equal((await call(base+'/tasks/'+id+'/upload-file','POST',{
    attemptId:attempt.attemptId,fence:attempt.fence,uploadId:'cancel-upload-005',
    filename:'synthetic-candidates.json',base64:bytes.toString('base64'),sha256:hash(bytes),
  },museKey)).status,201);
  assert.equal((await call(base+'/tasks/'+id+'/submit-result','POST',{
    attemptId:attempt.attemptId,fence:attempt.fence,requestId:'submit-cancel-005',
    summary:'Synthetic test data; no research was performed.',sources:[doc],
    evidenceNote:'Local HTTP fixture only; there is no real Muse execution or tool receipt.',
  },museKey)).status,200);
  assert.equal((await call('/api/worker-orders/'+id+'/cancel','POST',{})).data.order.status,'cancel_requested');
  const status=(await call(base+'/tasks/'+id+'/status','GET',undefined,museKey)).data;
  assert.equal(status.cancellationRequested,true);
  assert.equal(status.canExecute,false);
  assert.equal((await call('/api/worker-orders/'+id+'/refresh','POST',{})).data.order.status,'cancel_requested');
  assert.equal((await call(base+'/tasks/'+id+'/confirm-stop','POST',{
    attemptId:attempt.attemptId,fence:attempt.fence,requestId:'stop-after-submit-005',
  },museKey)).data.status,'stopped');
  assert.equal((await call('/api/worker-orders/'+id+'/refresh','POST',{})).data.order.status,'cancelled');
});

test('Muse malformed persisted lease or deadline cannot authorize a heartbeat or file upload',async t=>{
  const {call,app}=await setup(t);
  const base='/api/muse-worker/v1';
  const id=await dispatch(call,'muse-personal-alpha','muse-corrupt-lease-006');
  const attempt=(await call(base+'/tasks/'+id+'/claim','POST',{requestId:'claim-corrupt-006'},museKey)).data;
  for(const field of ['leaseUntil','deadlineAt']) {
    await app().store.update(state=>{
      const task=state.museTasks.find(item=>item.id===id);
      task.leaseUntil=new Date(Date.now()+60_000).toISOString();
      task.deadlineAt=new Date(Date.now()+3600_000).toISOString();
      task[field]='invalid-persisted-date';
    });
    assert.equal((await call(base+'/tasks/'+id+'/status','GET',undefined,museKey)).data.canExecute,false);
    const heartbeat=await call(base+'/tasks/'+id+'/heartbeat','POST',{
      attemptId:attempt.attemptId,fence:attempt.fence,requestId:'corrupt-heartbeat-'+field,
    },museKey);
    assert.equal(heartbeat.status,409);
    assert.equal(heartbeat.data.error.code,'MW_LEASE_EXPIRED');
    const bytes=Buffer.from('Synthetic test file');
    assert.equal((await call(base+'/tasks/'+id+'/upload-file','POST',{
      attemptId:attempt.attemptId,fence:attempt.fence,uploadId:'corrupt-upload-'+field,
      filename:'fixture.txt',base64:bytes.toString('base64'),sha256:hash(bytes),
    },museKey)).status,409);
  }
  assert.equal(app().store.read().museTasks.find(item=>item.id===id).files.length,0);
});

test('local synthetic 20-row Muse delivery requires approval and acceptance before durable opportunity import',async t=>{
  const {call,restart}=await setup(t);
  const base='/api/muse-worker/v1';
  const id=await dispatch(call,'muse-personal-alpha','muse-20-fixture-007');
  const attempt=(await call(base+'/tasks/'+id+'/claim','POST',{requestId:'claim-20-007'},museKey)).data;
  assert.equal((await call(base+'/tasks/'+id+'/heartbeat','POST',{
    attemptId:attempt.attemptId,fence:attempt.fence,requestId:'heartbeat-20-007',
  },museKey)).status,200);
  const fixture=report(id);
  fixture.prospects=Array.from({length:20},(_,index)=>({
    ...fixture.prospects[0],name:'Synthetic candidate '+(index+1),
    fitReason:'Only a local test row; not a sourced distributor or commercial opportunity.',
  }));
  const bytes=Buffer.from(JSON.stringify(fixture));
  const payload={attemptId:attempt.attemptId,fence:attempt.fence,uploadId:'upload-20-007',
    filename:'synthetic-20-candidates.json',base64:bytes.toString('base64'),sha256:hash(bytes)};
  assert.equal((await call(base+'/tasks/'+id+'/upload-file','POST',payload,museKey)).status,201);
  assert.equal((await call(base+'/tasks/'+id+'/upload-file','POST',payload,museKey)).data.duplicate,true);
  assert.equal((await call(base+'/tasks/'+id+'/submit-result','POST',{
    attemptId:attempt.attemptId,fence:attempt.fence,requestId:'submit-20-007',
    summary:'20 synthetic rows for local protocol verification only. No real Muse or research.',
    sources:[doc],evidenceNote:'These are test fixtures; there is no native Muse tool execution or receipt.',
  },museKey)).status,200);
  const refreshed=await call('/api/worker-orders/'+id+'/refresh','POST',{});
  assert.equal(refreshed.data.order.status,'review_required');
  assert.equal(refreshed.data.order.workerReport.prospects.length,20);
  const importPayload={indices:Array.from({length:20},(_,index)=>index),requestId:'import-20-007',confirmed:true};
  assert.equal((await call('/api/worker-orders/'+id+'/promote','POST',importPayload)).status,409);
  const accepted=await call('/api/worker-orders/'+id+'/accept','POST',{confirmed:true});
  assert.equal(accepted.data.order.status,'accepted');
  assert.ok(accepted.data.order.deliveryArtifactId);
  const promoted=await call('/api/worker-orders/'+id+'/promote','POST',importPayload);
  assert.equal(promoted.status,200);
  assert.equal(promoted.data.createdCount,20);
  await restart();
  assert.equal((await call('/api/worker-orders/'+id+'/promote','POST',importPayload)).data.duplicate,true);
  const pool=await call('/api/worker-opportunities');
  assert.equal(pool.data.opportunities.length,20);
  assert.ok(pool.data.opportunities.every(row=>row.verification==='external_unverified'));
});

test('Muse API authenticated read rate limit is enforced with MW_ error namespace',async t=>{
  const {call}=await setup(t);
  // Unknown task status is intentionally side-effect-free; it still consumes
  // the authenticated GET quota without 120 durable identity heartbeat writes.
  const base='/api/muse-worker/v1/tasks/nonexistent/status';
  for(let i=0;i<120;i++) assert.equal((await call(base,'GET',undefined,museKey)).status,404);
  const limited=await call(base,'GET',undefined,museKey);
  assert.equal(limited.status,429);
  assert.equal(limited.data.error.code,'MW_RATE_LIMIT');
});

test('Muse and Dot cannot reuse the same credential even if configured',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'workspace-muse-key-collision-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(createApp({dataDirectory:directory,
    dotWorkerConfig:{tokenDigest:hash(dotKey),workerId:'chatgpt-dot-xy'},
    museWorkerConfig:{tokenDigest:hash(dotKey),workerId:'muse-personal-alpha'},
  }),/never share a Bearer credential/);
});
