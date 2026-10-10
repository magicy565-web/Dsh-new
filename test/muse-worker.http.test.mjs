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

test('Muse API authenticated read rate limit is enforced with MW_ error namespace',async t=>{
  const {call}=await setup(t);
  const base='/api/muse-worker/v1/identity';
  for(let i=0;i<120;i++) assert.equal((await call(base,'GET',undefined,museKey)).status,200);
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
