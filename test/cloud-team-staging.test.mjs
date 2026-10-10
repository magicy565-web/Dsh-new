import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createCloudExpertService } from '../server/cloud-experts.mjs';

test('a staffed expert team stages REAL idempotent WorkerDesk draft orders with aggregate credits fenced',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'real-cloud-team-stage-'));
  const store=await openStore(directory);
  t.after(async()=>{await store.close();await rm(directory,{recursive:true,force:true})});
  const catalog=()=>[
    {id:'channel-validation',minimumCredits:5,workers:[{id:'market-agent',name:'Market worker',budgetEnforced:true}]},
    {id:'buyer-discovery',minimumCredits:5,workers:[{id:'buyer-agent',name:'Buyer worker',budgetEnforced:true}]},
  ];
  const orders=new Map;
  let calls=0;
  const workerDesk={
    async create(task,actor){
      calls++;
      const key=actor+':'+task.requestId;
      const prior=orders.get(key);
      if(prior){
        assert.equal(prior.task.objective,task.objective);
        assert.equal(prior.task.budgetCredits,task.budgetCredits);
        return {order:prior.order,duplicate:true};
      }
      const order={id:'test-order-'+orders.size,status:'draft',remoteJobId:null};
      orders.set(key,{order,task});return {order,duplicate:false};
    },
  };
  const experts=createCloudExpertService({store,workerCatalog:catalog,workerDesk});
  async function hire(templateId,serviceId,workerId,requestId){
    return (await experts.hire({
      templateId,serviceId,workerId,requestId,alias:templateId,
      mission:'Research only public buyer and market evidence',
      skills:[],maxCredits:20,publicDataConfirmed:true,
    },'admin')).expert;
  }
  const lead=await hire('growth-lead','channel-validation','market-agent','hire-lead');
  const hunter=await hire('buyer-hunter','buyer-discovery','buyer-agent','hire-hunter');
  const team=(await experts.formTeam({
    templateId:'overseas-growth',requestId:'team-stage-test',name:'US Growth Experts',
    mission:'Find actual wholesale market opportunities using public sources',
    leadId:lead.id,memberIds:[hunter.id],budgetCredits:38,taskCeilingCredits:20,
  },'admin')).team;
  const assignment=(expertId,objective,budgetCredits)=>({
    expertId,objective,budgetCredits,deadlineAt:new Date(Date.now()+8*86_400_000).toISOString(),
  });
  const body={requestId:'team-batch-001',confirmed:true,publicDataConfirmed:true,
    product:'Printed rayon',market:'United States',
    stages:[
      assignment(lead.id,'Assess product channel feasibility using public evidence',16),
      assignment(hunter.id,'Find US wholesale distributors with original public URLs',17),
    ],
  };
  assert.equal(experts.planTeam(team.id).runnable,false,'planning view cannot execute');
  const first=await experts.stageTeamWork(team.id,body,'admin');
  assert.equal(first.plan.status,'awaiting_approval');
  assert.equal(first.plan.reservedCredits,33);
  assert.equal(first.approvalRequired,true);
  assert.equal(first.externalWorkStarted,false);
  assert.equal(first.plan.steps.length,2);
  assert.equal(new Set(first.plan.steps.map(x=>x.orderId)).size,2);
  assert.equal(orders.size,2);
  for(const record of orders.values()){
    assert.equal(record.order.status,'draft');
    assert.equal(record.order.remoteJobId,null);
    assert.equal(record.task.publicDataConfirmed,true);
    assert.ok(record.task.objective.includes('具体执行方法'));
    assert.ok(record.task.objective.includes('必须交付与验收'));
  }
  const repeat=await experts.stageTeamWork(team.id,body,'admin');
  assert.equal(repeat.duplicate,true);
  assert.equal(calls,2,'existing completed stages must not be submitted again');
  await assert.rejects(experts.stageTeamWork(team.id,{...body,requestId:'other-batch'},'admin'),{code:'TEAM_ALREADY_STAGED'});
  await assert.rejects(experts.stageTeamWork(team.id,{
    ...body,requestId:'overflow',stages:body.stages.map(x=>({...x,budgetCredits:20})),
  },'admin'),{code:'TEAM_BUDGET_EXCEEDED'});
  await assert.rejects(experts.configureTeam(team.id,{
    budgetCredits:30,expectedRevision:1,
  },'admin'),{code:'TEAM_RESERVATION_LOCKED'});
  assert.equal(experts.getTeam(team.id).workPlans[0].reservedCredits,33);
});

test('team staging cannot pass without public consent or an approved cloud executor',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'team-stage-no-executor-'));
  const store=await openStore(directory);
  t.after(async()=>{await store.close();await rm(directory,{recursive:true,force:true})});
  let sends=0;
  const experts=createCloudExpertService({store,workerCatalog:()=>[],workerDesk:{async create(){sends++;return {order:{id:'bad'}};}}});
  const input=(templateId,serviceId,requestId)=>({
    templateId,alias:templateId,mission:'Research only public company sources',
    serviceId,workerId:null,skills:[],maxCredits:20,requestId,publicDataConfirmed:true,
  });
  const lead=(await experts.hire(input('growth-lead','buyer-discovery','lead'),'admin')).expert;
  const hunter=(await experts.hire(input('buyer-hunter','buyer-discovery','hunter'),'admin')).expert;
  const team=(await experts.formTeam({
    templateId:'overseas-growth',requestId:'team-no-exec',name:'No executor team',
    mission:'Research public US buyer sources',leadId:lead.id,memberIds:[hunter.id],
    budgetCredits:50,taskCeilingCredits:20,
  },'admin')).team;
  const due=new Date(Date.now()+3*86_400_000).toISOString();
  const body={requestId:'no-run',confirmed:true,publicDataConfirmed:true,product:'Textiles',market:'USA',
    stages:[{expertId:lead.id,objective:'Research US market',budgetCredits:10,deadlineAt:due},
            {expertId:hunter.id,objective:'Find buyers',budgetCredits:10,deadlineAt:due}]};
  await assert.rejects(experts.stageTeamWork(team.id,body,'admin'),{code:'WORKER_UNAVAILABLE'});
  await assert.rejects(experts.stageTeamWork(team.id,{...body,publicDataConfirmed:false},'admin'),{code:'INVALID_TEAM_STAGE'});
  assert.equal(sends,0);
  assert.equal(experts.getTeam(team.id).workPlans,undefined);
});
