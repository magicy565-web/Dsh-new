import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';

test('Workspace HTTP stages two real reviewed Worker task drafts without dispatch or charge',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'cloud-team-stage-http-'));
  t.after(async()=>rm(directory,{recursive:true,force:true}));
  let remoteSends=0;
  const makeWorker=serviceId=>({
    displayName:serviceId+' reviewed runner',services:[serviceId],ready:true,budgetEnforced:true,
    async submit(){remoteSends++;return {jobId:'should-not-run'};},
    async get(jobId){return {jobId,status:'working'};},
    async cancel(){return {status:'cancel_requested'};},
  });
  const options={dataDirectory:directory,workerAdapters:{
    channel:makeWorker('channel-validation'),
    buyer:makeWorker('buyer-discovery'),
  }};
  let app=await createApp(options);
  let address=await app.listen(0);
  const post=async(route,body)=>{
    const response=await fetch('http://127.0.0.1:'+address.port+'/api'+route,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
    });
    return {status:response.status,data:await response.json()};
  };
  const get=async route=>{
    const response=await fetch('http://127.0.0.1:'+address.port+'/api'+route);
    return {status:response.status,data:await response.json()};
  };
  const hire=async(templateId,serviceId,workerId,requestId)=>{
    const result=await post('/cloud-experts',{
      templateId,serviceId,workerId,requestId,alias:templateId,
      mission:'Public research with traceable evidence only',skills:[],
      maxCredits:20,publicDataConfirmed:true,
    });
    assert.equal(result.status,201);
    return result.data.expert;
  };
  try{
    const lead=await hire('growth-lead','channel-validation','channel','team-http-lead');
    const buyer=await hire('buyer-hunter','buyer-discovery','buyer','team-http-buyer');
    const teamResult=await post('/cloud-teams',{
      templateId:'overseas-growth',requestId:'real-team-http',name:'Export research project',
      mission:'Investigate US wholesale distribution for public products',
      leadId:lead.id,memberIds:[buyer.id],budgetCredits:46,taskCeilingCredits:20,
    });
    assert.equal(teamResult.status,201);
    const id=teamResult.data.team.id;
    const deadline=new Date(Date.now()+7*86_400_000).toISOString();
    const request={requestId:'batch-http-one',confirmed:true,publicDataConfirmed:true,
      product:'Printed rayon fabric',market:'United States',
      stages:[
        {expertId:lead.id,objective:'Analyze US wholesale market channels',budgetCredits:18,deadlineAt:deadline},
        {expertId:buyer.id,objective:'Find sourced US distributor candidates',budgetCredits:18,deadlineAt:deadline},
      ],
    };
    const staged=await post('/cloud-teams/'+id+'/stage',request);
    assert.equal(staged.status,201);
    assert.equal(staged.data.plan.status,'awaiting_approval');
    assert.equal(staged.data.approvalRequired,true);
    assert.equal(staged.data.externalWorkStarted,false);
    const orders=(await get('/worker-orders')).data.orders;
    assert.equal(orders.length,2);
    assert.ok(orders.every(order=>order.status==='draft'&&order.remoteJobId===null));
    assert.ok(orders.every(order=>order.objective.includes('必须交付与验收')));
    assert.equal(remoteSends,0);
    const replay=await post('/cloud-teams/'+id+'/stage',request);
    assert.equal(replay.status,201);
    assert.equal(replay.data.duplicate,true);
    assert.equal((await get('/worker-orders')).data.orders.length,2);
    const over=await post('/cloud-teams/'+id+'/stage',{
      ...request,requestId:'different-batch',
    });
    assert.equal(over.status,409);
    assert.equal(over.data.error.code,'TEAM_ALREADY_STAGED');
    await app.close();
    app=await createApp(options);
    address=await app.listen(0);
    const restored=(await get('/cloud-teams/'+id)).data.team;
    assert.equal(restored.workPlans[0].status,'awaiting_approval');
    assert.equal(restored.workPlans[0].reservedCredits,36);
    assert.equal((await get('/worker-orders')).data.orders.length,2);
    assert.equal(remoteSends,0);
  } finally {await app.close();}
});
