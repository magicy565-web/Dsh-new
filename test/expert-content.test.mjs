import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERT_BRIEFS, TEAM_BRIEFS } from '../server/expert-library.mjs';
import { EXPERT_TEMPLATES, TEAM_TEMPLATES, createCloudExpertService } from '../server/cloud-experts.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';

test('every specialist has actual methods, bounded inputs and independently auditable deliverables',()=>{
  assert.equal(EXPERT_TEMPLATES.length,8);
  const ids=new Set(EXPERT_TEMPLATES.map(role=>role.id));
  assert.equal(ids.size,EXPERT_TEMPLATES.length);
  for(const role of EXPERT_TEMPLATES){
    assert.deepEqual(role.brief,EXPERT_BRIEFS[role.id]);
    assert.ok(role.brief.headline.length>12,role.id+' must have a meaningful headline');
    assert.ok(role.brief.inputs.length>=3,role.id+' must have required company inputs');
    assert.equal(role.brief.steps.length,3);
    assert.equal(role.brief.deliverables.length,3);
    assert.ok(role.brief.toolNeeds.length>=3);
    assert.ok(role.brief.boundaries.length>=2);
    for(const step of role.brief.steps){
      assert.ok(step.name.length>=4);
      assert.ok(step.detail.length>=20);
    }
    for(const delivered of role.brief.deliverables){
      assert.ok(delivered.name.length>=4);
      assert.ok(delivered.format.length>=2);
      assert.ok(delivered.acceptance.length>=20);
    }
  }
  const privateRole=EXPERT_TEMPLATES.find(x=>x.id==='rfq-analyst');
  assert.deepEqual(privateRole.serviceIds,[]);
  assert.ok(privateRole.brief.boundaries.some(x=>x.includes('私有')||x.includes('隔离')));
});

test('curated enterprise team templates have role-specific deliverables and approval bounds',()=>{
  assert.equal(TEAM_TEMPLATES.length,3);
  for(const team of TEAM_TEMPLATES){
    assert.deepEqual(team.brief,TEAM_BRIEFS[team.id]);
    assert.equal(team.brief.workflow.length,4);
    assert.ok(team.brief.inputs.length>=3);
    assert.ok(team.brief.acceptance.length>20);
    const roles=team.brief.workflow.map(stage=>stage.role);
    assert.deepEqual(new Set(roles),new Set(team.members),'recommended team workflow must match actual configured roles');
    assert.ok(team.brief.workflow.every(stage=>stage.task.length>=8&&stage.output.length>=5));
  }
});

test('staffed teams show real per-role work steps while remaining non-executable until reviewed native DAG',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'work-expert-role-content-'));
  const store=await openStore(dir);
  t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
  const service=createCloudExpertService({store,workerCatalog:()=>[]});
  const create=(templateId,serviceId,requestId)=>service.hire({
    templateId,requestId,alias:'Professional '+templateId,
    mission:'Assess public market and B2B buyer evidence using company data',
    serviceId,workerId:null,skills:[],maxCredits:18,publicDataConfirmed:true,
  },'admin');
  const lead=(await create('growth-lead','buyer-discovery','lead-expert-001')).expert;
  const analyst=(await create('market-analyst','channel-validation','analyst-expert-001')).expert;
  const team=(await service.formTeam({
    templateId:'overseas-growth',requestId:'team-content-001',name:'US Growth Experts',
    mission:'Investigate US distribution channels with sourced evidence',
    leadId:lead.id,memberIds:[analyst.id],budgetCredits:80,taskCeilingCredits:12,
  },'admin')).team;
  const plan=service.planTeam(team.id);
  assert.equal(plan.runnable,false);
  assert.equal(plan.planningOnly,true);
  assert.equal(plan.steps.length,2);
  assert.ok(plan.steps[0].instructions.length>10);
  assert.equal(plan.steps[0].output,'项目范围与分工');
  assert.equal(plan.steps[1].output,'有证据的市场分析');
  assert.ok(plan.steps.every(step=>step.reviewCriteria.length>15));
  assert.equal(plan.projectBudgetCredits,80);
  assert.ok(plan.blockers.some(x=>x.includes('DAG')));
});
