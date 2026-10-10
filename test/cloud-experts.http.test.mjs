import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';

const baseline = {
  templateId:'buyer-hunter',alias:'美国渠道开发专家',
  mission:'Find public US distributor candidates and explain evidence',
  serviceId:'buyer-discovery',workerId:null,skills:['buyer-screening'],
  maxCredits:20,publicDataConfirmed:true,requestId:'hire-buyer-001',
};

test('real Workspace HTTP: hire expert, configure, assemble team, retrieve safe delegation draft, restart',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cloud-experts-http-'));
  t.after(async()=>rm(dir,{recursive:true,force:true}));
  let app=await createApp({dataDirectory:dir});
  let address=await app.listen(0);
  async function action(method,path,body){
    const response=await fetch('http://127.0.0.1:'+address.port+'/api'+path,{
      method,headers:body?{'content-type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,
    });
    return {status:response.status,result:await response.json()};
  }
  try{
    const catalog=await action('GET','/cloud-expert-catalog');
    assert.equal(catalog.status,200);
    assert.ok(catalog.result.experts.some(x=>x.id==='growth-lead'));
    const hire=await action('POST','/cloud-experts',baseline);
    assert.equal(hire.status,201);
    const buyer=hire.result.expert;
    assert.equal(buyer.runnerStatus,'not_connected');
    assert.equal(buyer.runtimeReady,false);
    const retry=await action('POST','/cloud-experts',baseline);
    assert.equal(retry.result.duplicate,true);
    const hijack=await action('POST','/cloud-experts',{...baseline,workerId:'attacker-agent',requestId:'hijack'});
    assert.equal(hijack.status,409);
    assert.equal(hijack.result.error.code,'WORKER_UNAVAILABLE');
    const leadResponse=await action('POST','/cloud-experts',{
      ...baseline,templateId:'growth-lead',alias:'增长负责人',requestId:'hire-lead-001',
      serviceId:'channel-validation',workerId:null,skills:['delivery-review'],
    });
    assert.equal(leadResponse.status,201);
    const lead=leadResponse.result.expert;
    const teamResult=await action('POST','/cloud-teams',{
      templateId:'overseas-growth',name:'美国增长项目组',
      mission:'Find validated US wholesaler channels through documented research',
      leadId:lead.id,memberIds:[buyer.id],
      budgetCredits:120,taskCeilingCredits:20,requestId:'team-http-001',
    });
    assert.equal(teamResult.status,201);
    const team=teamResult.result.team;
    assert.equal(team.runAvailable,false);
    const plan=await action('GET','/cloud-teams/'+team.id+'/plan');
    assert.equal(plan.status,200);
    assert.equal(plan.result.plan.planningOnly,true);
    assert.equal(plan.result.plan.steps.length,2);
    const update=await action('PATCH','/cloud-experts/'+buyer.id,{
      mission:'Find public, verifiable candidates with original sources',expectedRevision:1,
    });
    assert.equal(update.status,200);
    assert.equal(update.result.expert.revision,2);
    assert.equal((await action('PATCH','/cloud-experts/'+buyer.id,{alias:'Stale',expectedRevision:1})).status,409);
    await app.close();
    app=await createApp({dataDirectory:dir});
    address=await app.listen(0);
    assert.equal((await action('GET','/cloud-experts')).result.experts.length,2);
    assert.equal((await action('GET','/cloud-teams')).result.teams.length,1);
    assert.equal((await action('GET','/cloud-teams/'+team.id)).result.team.name,'美国增长项目组');
  }finally{await app.close();}
});
