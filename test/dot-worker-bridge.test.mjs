import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { createArtifactService } from '../server/artifacts.mjs';
import { createDotWorkerBridge, createDotWorkerAuth } from '../server/dot-worker-bridge.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const token = 'this-is-an-authorized-32-byte-dot-worker-credential-01';
const task = (orderId='dot-order-001') => ({
  orderId, idempotencyKey:orderId, serviceId:'buyer-discovery',
  inputs:{product:'Printed fabric',market:'USA',objective:'Find sourced public B2B wholesalers'},
  acceptance:['company website and original sources'],deadlineAt:new Date(Date.now()+5*86400_000).toISOString(),
  maxCredits:20,dataScope:'public',
});
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(),'dot-worker-bridge-'));
  const store = await openStore(dir);
  const artifacts = await createArtifactService({store,directory:path.join(dir,'artifacts')});
  t.after(async()=>{await artifacts.close();await store.close();await rm(dir,{recursive:true,force:true});});
  return {store,artifacts,bridge:createDotWorkerBridge({
    store,artifacts,workerId:'chatgpt-dot-xy',ownerId:'xy',
    enabled:true,scopeReviewed:true,externalBudgetVerified:true,
  })};
}
const report = orderId => ({
  schema:'workspace.worker.delivery.v1',orderId,
  deliverables:[{name:'US distributor shortlist',type:'table',summary:'One publicly sourced test company'}],
  evidence:[{title:'Published catalog',url:'https://buyer.example.org/catalog',detail:'Public company catalog'}],
  prospects:[{name:'Test Distributor',country:'United States',website:'https://buyer.example.org',fitReason:'Wholesale textile assortment',sourceUrl:'https://buyer.example.org/catalog'}],
});

test('dot authentication is off without a reviewed hash and rejects non-worker/browser credentials', () => {
  assert.equal(createDotWorkerAuth({tokenDigest:null}),null);
  const authorize=createDotWorkerAuth({tokenDigest:hash(token)});
  assert.equal(authorize({headers:{authorization:'Bearer '+token}}),true);
  assert.throws(()=>authorize({headers:{authorization:'Bearer '+'wrong-'.repeat(8)}}),{code:'DOT_AUTH_FAILED'});
  assert.throws(()=>authorize({headers:{authorization:'Bearer '+token,origin:'https://evil.example'}}),{code:'DOT_BROWSER_FORBIDDEN'});
  assert.throws(()=>authorize({headers:{authorization:'Bearer '+token,cookie:'session=stolen'}}),{code:'DOT_BROWSER_FORBIDDEN'});
});

test('dot queue, atomic one-attempt claim, upload, sources, tool receipt and reviewable structured result',async t=>{
  const {bridge}=await fixture(t);
  assert.equal(bridge.adapter.ready,true);
  const queued=await bridge.adapter.submit(task());
  assert.equal(queued.jobId,'dot-order-001');
  assert.equal(queued.queued,true);
  assert.deepEqual(bridge.inbox().tasks.map(x=>x.taskRef),['dot-order-001']);
  const fetched=bridge.readTask('dot-order-001');
  assert.equal(fetched.inputs.product,'Printed fabric');
  assert.equal(fetched.dataScope,'public');
  assert.equal(Object.hasOwn(fetched,'credentials'),false);
  const claim=await bridge.claimTask({taskRef:'dot-order-001',requestId:'claim-durable-1'});
  assert.equal(claim.claimed,true);
  assert.equal(claim.fence,1);
  assert.equal(bridge.status('dot-order-001').canExecute,true);
  const replay=await bridge.claimTask({taskRef:'dot-order-001',requestId:'claim-durable-1'});
  assert.equal(replay.attemptId,claim.attemptId);
  assert.equal(replay.duplicate,true);
  await assert.rejects(bridge.claimTask({taskRef:'dot-order-001',requestId:'another-claim'}),{code:'DOT_TASK_UNAVAILABLE'});
  const renew=await bridge.heartbeat({taskRef:'dot-order-001',attemptId:claim.attemptId,fence:1,requestId:'heartbeat-original'});
  assert.equal(renew.duplicate,false);
  const heartbeatRetry=await bridge.heartbeat({taskRef:'dot-order-001',attemptId:claim.attemptId,fence:1,requestId:'heartbeat-original'});
  assert.equal(heartbeatRetry.duplicate,true);
  assert.equal(renew.leaseUntil,heartbeatRetry.leaseUntil);
  const raw=Buffer.from(JSON.stringify(report('dot-order-001')));
  const upload=await bridge.uploadFile({
    taskRef:'dot-order-001',attemptId:claim.attemptId,fence:1,uploadId:'artifact-original',
    filename:'distributor-research.json',base64:raw.toString('base64'),sha256:hash(raw),
  });
  assert.equal(upload.duplicate,false);
  const same=await bridge.uploadFile({
    taskRef:'dot-order-001',attemptId:claim.attemptId,fence:1,uploadId:'artifact-original',
    filename:'distributor-research.json',base64:raw.toString('base64'),sha256:hash(raw),
  });
  assert.equal(same.duplicate,true);
  const finished={taskRef:'dot-order-001',attemptId:claim.attemptId,fence:1,requestId:'result-original',
    summary:'Found one publicly sourced test business; not verified by the platform.',
    sources:['https://buyer.example.org/catalog'],
    toolEvidence:[{tool:'web-search',receiptId:'search-receipt-2026'}]};
  const sent=await bridge.submitResult(finished);
  assert.equal(sent.reviewRequired,true);
  assert.equal(sent.independentlyVerified,false);
  assert.equal((await bridge.submitResult(finished)).duplicate,true);
  await assert.rejects(bridge.submitResult({...finished,summary:'Different summary'}),{code:'DOT_RESULT_CONFLICT'});
  const outcome=await bridge.adapter.get('dot-order-001','dot-order-001');
  assert.equal(outcome.status,'completed');
  assert.equal(outcome.deliverables[0].type,'table');
  assert.equal(outcome.prospects.length,1);
  assert.equal(outcome.evidence[0].url,'https://buyer.example.org/catalog');
  assert.equal(bridge.info().completed,1);
});

test('one unfinished personal dot attempt is enforced; expiry never triggers a new attempt',async t=>{
  const {store,bridge}=await fixture(t);
  await bridge.adapter.submit(task('first-dot-task'));
  await bridge.adapter.submit(task('second-dot-task'));
  const original=await bridge.claimTask({taskRef:'first-dot-task',requestId:'single-slot-claim'});
  await assert.rejects(bridge.claimTask({taskRef:'second-dot-task',requestId:'second-slot-claim'}),{code:'DOT_SLOT_BUSY'});
  await store.update(state=>{
    state.dotTasks.find(x=>x.id==='first-dot-task').leaseUntil=new Date(Date.now()-120_000).toISOString();
  });
  assert.equal(bridge.status('first-dot-task').canExecute,false);
  await assert.rejects(bridge.heartbeat({
    taskRef:'first-dot-task',attemptId:original.attemptId,fence:original.fence,requestId:'late-heartbeat',
  }),{code:'DOT_LEASE_EXPIRED'});
  await assert.rejects(bridge.claimTask({taskRef:'first-dot-task',requestId:'new-attempt'}),{code:'DOT_TASK_UNAVAILABLE'});
  await assert.rejects(bridge.claimTask({taskRef:'second-dot-task',requestId:'other-attempt'}),{code:'DOT_SLOT_BUSY'});
});

test('a claimed task cancellation is not successful until the original dot confirms stop',async t=>{
  const {bridge}=await fixture(t);
  await bridge.adapter.submit(task('cancel-dot-task'));
  const current=await bridge.claimTask({taskRef:'cancel-dot-task',requestId:'cancel-claim'});
  const canceled=await bridge.adapter.cancel('cancel-dot-task');
  assert.equal(canceled.status,'cancel_requested');
  assert.equal(bridge.status('cancel-dot-task').canExecute,false);
  await assert.rejects(bridge.heartbeat({taskRef:'cancel-dot-task',attemptId:current.attemptId,fence:1,requestId:'should-stop'}),{code:'DOT_LEASE_EXPIRED'});
  const stopped=await bridge.confirmStop({taskRef:'cancel-dot-task',attemptId:current.attemptId,fence:1,requestId:'stop-ack'});
  assert.equal(stopped.status,'stopped');
  assert.equal((await bridge.adapter.get('cancel-dot-task','cancel-dot-task')).status,'cancelled');
  assert.equal((await bridge.confirmStop({taskRef:'cancel-dot-task',attemptId:current.attemptId,fence:1,requestId:'stop-ack'})).status,'stopped');
});

test('disabled dot worker is not advertised as executable even when files and plugin are present',async t=>{
  const {store,artifacts}=await fixture(t);
  const offline=createDotWorkerBridge({store,artifacts,enabled:true,scopeReviewed:true,externalBudgetVerified:false});
  assert.equal(offline.adapter.ready,false);
  assert.equal(offline.adapter.budgetEnforced,false);
  await assert.rejects(offline.adapter.submit(task('denied-task')),{code:'DOT_NOT_APPROVED'});
});


test('revoking the dot invitation blocks continued execution even with a previously valid lease',async t=>{
  const {store,artifacts,bridge}=await fixture(t);
  await bridge.adapter.submit(task('revoked-dot-task'));
  const original=await bridge.claimTask({taskRef:'revoked-dot-task',requestId:'first-authorized-claim'});
  const revoked=createDotWorkerBridge({store,artifacts,workerId:'chatgpt-dot-xy',ownerId:'xy',
    enabled:false,scopeReviewed:true,externalBudgetVerified:true});
  assert.equal(revoked.adapter.ready,false);
  assert.equal(revoked.status('revoked-dot-task').canExecute,false);
  assert.deepEqual(revoked.inbox().tasks,[]);
  assert.throws(()=>revoked.readTask('revoked-dot-task'),{code:'DOT_NOT_APPROVED'});
  await assert.rejects(revoked.heartbeat({taskRef:'revoked-dot-task',
    attemptId:original.attemptId,fence:1,requestId:'revoke-pulse'}),{code:'DOT_NOT_APPROVED'});
  const stopRequested=await revoked.adapter.cancel('revoked-dot-task');
  assert.equal(stopRequested.status,'cancel_requested');
  const stopped=await revoked.confirmStop({taskRef:'revoked-dot-task',
    attemptId:original.attemptId,fence:1,requestId:'revoke-stop-ack'});
  assert.equal(stopped.status,'stopped');
  assert.equal((await revoked.adapter.get('revoked-dot-task','revoked-dot-task')).status,'cancelled');
});


test('dot cannot receive enterprise private RFQ data or unreviewed secret-bearing payloads',async t=>{
  const {bridge}=await fixture(t);
  await assert.rejects(bridge.adapter.submit({
    ...task('private-dispatch'),serviceId:'rfq-recovery',dataScope:'private',
  }),{code:'DOT_TASK_SCOPE_INVALID'});
  await assert.rejects(bridge.adapter.submit({
    ...task('secret-payload'),inputs:{...task().inputs,privateFile:'/enterprise/rfq.csv'},
  }),{code:'DOT_TASK_SCOPE_INVALID'});
  assert.equal(bridge.inbox().tasks.length,0);
});
