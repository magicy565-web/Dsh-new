import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';

const credential = 'dot-test-only-authorization-token-01-extended';
const hash = value => createHash('sha256').update(value).digest('hex');

test('approved Workspace to dot-xy public research via the actual scoped worker routes',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'workspace-dot-contract-'));
  t.after(async()=>rm(directory,{recursive:true,force:true}));
  const config={dataDirectory:directory,dotWorkerConfig:{
    workerId:'chatgpt-dot-xy',ownerId:'xy',enabled:true,scopeReviewed:true,
    externalBudgetVerified:true,tokenDigest:hash(credential),
  }};
  let app=await createApp(config);
  let address=await app.listen(0);
  const base=()=>('http://127.0.0.1:'+address.port+'/api');
  const call=async (path,method='GET',body=null,dot=false)=>{
    const response=await fetch(base()+path,{
      method,headers:{...(dot?{Authorization:'Bearer '+credential}:{}),
        ...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,
    });
    return {status:response.status,payload:await response.json()};
  };
  try{
    const catalog=await call('/worker-services');
    assert.ok(catalog.payload.services.find(x=>x.id==='buyer-discovery').workers.some(x=>x.id==='chatgpt-dot-xy'));
    const order=(await call('/worker-orders','POST',{
      requestId:'dot-worker-test-001',serviceId:'buyer-discovery',
      product:'Public textile catalog',market:'United States',
      objective:'Find publicly sourced distributors',budgetCredits:15,
      deadlineAt:new Date(Date.now()+4*86400_000).toISOString(),
      publicDataConfirmed:true,workerId:'chatgpt-dot-xy',
    })).payload.order;
    assert.equal((await call('/worker-orders/'+order.id+'/approve','POST',{confirmed:true,workerId:'chatgpt-dot-xy'})).status,200);
    assert.equal((await call('/worker-orders/'+order.id+'/dispatch','POST',{})).payload.order.status,'queued');
    assert.equal((await call('/dot-worker/v1/identity','GET',null,true)).payload.dot,'xy');
    assert.equal((await call('/dot-worker/v1/inbox','GET',null,true)).payload.tasks.length,1);
    const claim=(await call('/dot-worker/v1/tasks/'+order.id+'/claim','POST',{requestId:'claim-original'},true)).payload;
    assert.equal(claim.claimed,true);
    const result={
      schema:'workspace.worker.delivery.v1',orderId:order.id,
      deliverables:[{name:'Sourced buyer table',type:'table',summary:'One public fixture result'}],
      evidence:[{title:'Company catalog',url:'https://buyer.example.org/catalog',detail:'Published public product catalog'}],
      prospects:[{name:'B2B Fixture',country:'United States',website:'https://buyer.example.org',
        fitReason:'Company publishes textile wholesale catalog',sourceUrl:'https://buyer.example.org/catalog'}],
    };
    const bytes=Buffer.from(JSON.stringify(result));
    const uploaded=await call('/dot-worker/v1/tasks/'+order.id+'/upload-file','POST',{
      attemptId:claim.attemptId,fence:claim.fence,uploadId:'original-file',
      filename:'buyers.json',base64:bytes.toString('base64'),sha256:hash(bytes),
    },true);
    assert.equal(uploaded.status,201);
    const receipt=await call('/dot-worker/v1/tasks/'+order.id+'/submit-result','POST',{
      attemptId:claim.attemptId,fence:claim.fence,requestId:'original-result',
      summary:'One sourced candidate for human review',
      sources:['https://buyer.example.org/catalog'],
      toolEvidence:[{tool:'web-search',receiptId:'search-fixture-001'}],
    },true);
    assert.equal(receipt.status,200);
    assert.equal(receipt.payload.reviewRequired,true);
    const review=await call('/worker-orders/'+order.id+'/refresh','POST',{});
    assert.equal(review.payload.order.status,'review_required');
    assert.equal(review.payload.order.workerReport.prospects.length,1);
    assert.equal(review.payload.order.workerReport.independentlyVerified,false);
    const accepted=await call('/worker-orders/'+order.id+'/accept','POST',{confirmed:true});
    assert.equal(accepted.payload.order.status,'accepted');
    assert.ok(accepted.payload.order.deliveryArtifactId);
    await app.close();
    app=await createApp(config);
    address=await app.listen(0);
    assert.equal((await call('/worker-orders/'+order.id)).payload.order.status,'accepted');
    assert.equal((await call('/dot-worker-connection')).payload.completed,1);
  } finally { await app.close(); }
});
