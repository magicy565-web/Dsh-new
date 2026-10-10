import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { createBackup, restoreBackup } from '../scripts/recovery.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const future = () => new Date(Date.now() + 24*60*60*1000).toISOString();
const task = id => ({
  orderId:id,idempotencyKey:id,serviceId:'buyer-discovery',
  inputs:{product:'Public fixture',market:'US',objective:'Use public sites only'},
  acceptance:['Original public source required'], deadlineAt:future(),maxCredits:5,dataScope:'public',
});

test('a restored snapshot fences out prior Muse and Dot leases and pauses all worker orders', async t => {
  const base=await mkdtemp(path.join(tmpdir(),'workspace-restored-workers-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const data=path.join(base,'source'), backup=path.join(base,'backup'), restored=path.join(base,'restored');
  const opts={
    dotWorkerConfig:{ workerId:'chatgpt-dot-xy',ownerId:'xy',
      tokenDigest:hash('test-only-dot-credential-32characters---'),enabled:true,
      scopeReviewed:true,externalBudgetVerified:true },
    museWorkerConfig:{ workerId:'muse-personal-alpha',ownerId:'alpha',
      tokenDigest:hash('test-only-muse-credential-32characters---'),enabled:true,
      scopeReviewed:true,externalBudgetVerified:true },
  };
  let app=await createApp({dataDirectory:data,...opts});
  const dotId='dot-old-lease-001', museId='muse-old-lease-001';
  await app.dotBridge.adapter.submit(task(dotId));
  await app.museBridge.adapter.submit(task(museId));
  const dotClaim=await app.dotBridge.claimTask({taskRef:dotId,requestId:'dot-old-claim'});
  const museClaim=await app.museBridge.claimTask({taskRef:museId,requestId:'muse-old-claim'});
  assert.equal(app.museBridge.status(museId).canExecute,true);
  await app.store.update(state=>{
    state.workerOrders=[
      {id:'approved-order',status:'approved',approvedBy:'operator-1',approvedAt:new Date().toISOString()},
      {id:'queued-order',status:'queued',workerId:'muse-personal-alpha'},
      {id:'accepted-order',status:'accepted',workerId:'chatgpt-dot-xy'},
    ];
  });
  await app.close();

  const result=await createBackup(data,backup);
  assert.equal(result.verified,true);
  const receipt=await restoreBackup(backup,restored);
  assert.equal(receipt.queuedWorkResumed,false);
  app=await createApp({dataDirectory:restored,...opts});
  try{
    const museStatus=app.museBridge.status(museId);
    const dotStatus=app.dotBridge.status(dotId);
    assert.equal(museStatus.status,'blocked');
    assert.equal(dotStatus.status,'blocked');
    assert.equal(museStatus.canExecute,false);
    assert.equal(dotStatus.canExecute,false);
    assert.equal(museStatus.leaseUntil,null);
    assert.equal(museStatus.fence,museClaim.fence+1);
    assert.equal(dotStatus.fence,dotClaim.fence+1);
    assert.deepEqual(app.museBridge.inbox().tasks,[]);
    assert.deepEqual(app.dotBridge.inbox().tasks,[]);
    await assert.rejects(app.museBridge.heartbeat({
      taskRef:museId,attemptId:museClaim.attemptId,
      fence:museClaim.fence,requestId:'stale-muse-heartbeat',
    }),{code:'STALE_DOT_LEASE'});
    await assert.rejects(app.dotBridge.heartbeat({
      taskRef:dotId,attemptId:dotClaim.attemptId,
      fence:dotClaim.fence,requestId:'stale-dot-heartbeat',
    }),{code:'STALE_DOT_LEASE'});
    const orders=app.store.read().workerOrders;
    assert.equal(orders.find(x=>x.id==='approved-order').status,'draft');
    assert.equal(orders.find(x=>x.id==='queued-order').status,'dispatch_uncertain');
    assert.equal(orders.find(x=>x.id==='accepted-order').status,'accepted');
    assert.equal(orders.find(x=>x.id==='queued-order').error.code,'RESTORE_REVIEW_REQUIRED');
  }finally{await app.close();}
});
