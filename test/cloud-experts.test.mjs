import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createCloudExpertService } from '../server/cloud-experts.mjs';

const workers = () => [
  { id: 'buyer-discovery', workers: [{ id: 'reviewed-worker', name: 'Reviewed remote agent', budgetEnforced: true }] },
  { id: 'channel-validation', workers: [] },
  { id: 'sales-assets', workers: [] },
];
const hire = (templateId, requestId, options={}) => ({
  templateId, requestId, publicDataConfirmed: true, alias: templateId + ' - expert',
  mission: 'Only research public buyer and market information with sourced evidence',
  serviceId: templateId === 'growth-lead' ? 'channel-validation' : 'buyer-discovery',
  workerId: null, skills: [], maxCredits: 20, ...options,
});
async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-expert-team-'));
  const store = await openStore(dir);
  const service = createCloudExpertService({ store, workerCatalog: workers });
  t.after(async () => { await store.close(); await rm(dir,{ recursive:true, force:true }); });
  return { dir, store, service };
}
test('eight predefined expert roles have bounded skills, scoped services and a private RFQ lock', async t => {
  const { service } = await setup(t);
  const catalog = service.catalog();
  assert.ok(catalog.experts.length >= 8);
  assert.ok(catalog.teams.length >= 3);
  assert.equal(catalog.experts.find(x=>x.id==='rfq-analyst').serviceIds.length,0);
  assert.equal(catalog.experts.find(x=>x.id==='buyer-hunter').workerOptions[0].workerId,'reviewed-worker');
  assert.equal(service.experts().length,0);
  assert.equal(service.teams().length,0);
});
test('hiring a cloud expert persists settings but does not start an unverified remote Worker', async t => {
  const { service } = await setup(t);
  const draft = await service.hire(hire('buyer-hunter','buyer-hire'), 'admin');
  assert.equal(draft.expert.runnerStatus,'not_connected');
  assert.equal(draft.expert.runtimeReady,false);
  assert.equal(draft.expert.externalActions,'separate_approval_required');
  assert.equal(draft.expert.dataScope,'public_only');
  assert.equal(service.experts().length,1);
  const again = await service.hire(hire('buyer-hunter','buyer-hire'), 'admin');
  assert.equal(again.duplicate,true);
  assert.equal(again.expert.id,draft.expert.id);
  await assert.rejects(service.hire(hire('buyer-hunter','buyer-hire',{ alias:'different' }), 'admin'), { code:'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.hire(hire('buyer-hunter','no-consent',{ publicDataConfirmed:false }), 'admin'), { code:'EXPLICIT_CONFIRMATION_REQUIRED' });
  await assert.rejects(service.hire(hire('rfq-analyst','private',{serviceId:'rfq-recovery'}), 'admin'), { code:'SERVICE_SCOPE_INVALID' });
  await assert.rejects(service.hire(hire('buyer-hunter','unsafe',{credentials:'secret'}), 'admin'), { code:'INVALID_INPUT' });
});
test('only reviewed registered task executors can be bound; revision guard prevents stale overwrite', async t => {
  const { service } = await setup(t);
  const created = await service.hire(hire('buyer-hunter','bound',{
    serviceId:'buyer-discovery',workerId:'reviewed-worker',skills:['buyer-screening'],
  }), 'admin');
  assert.equal(created.expert.runtimeReady,true);
  await assert.rejects(service.configure(created.expert.id,{
    workerId:'unreviewed-agent', expectedRevision:1,
  },'admin'),{code:'WORKER_UNAVAILABLE'});
  const updated = await service.configure(created.expert.id,{
    maxCredits:17, mission:'Find ten public buyer companies with original sources',
    expectedRevision:1,
  },'admin');
  assert.equal(updated.expert.maxCredits,17);
  assert.equal(updated.expert.revision,2);
  await assert.rejects(service.configure(created.expert.id,{
    maxCredits:6, expectedRevision:1,
  },'admin'), {code:'REVISION_CONFLICT'});
});
test('expert teams require two distinct configured positions, budget bounds and never fake orchestration', async t => {
  const { service } = await setup(t);
  const lead=(await service.hire(hire('growth-lead','lead'), 'admin')).expert;
  const buyer=(await service.hire(hire('buyer-hunter','buyer'), 'admin')).expert;
  const created=await service.formTeam({
    requestId:'team-alpha',templateId:'overseas-growth',name:'Overseas growth team',
    mission:'Validate the distributor market with evidence and an approved total budget',
    leadId:lead.id,memberIds:[buyer.id],budgetCredits:100,taskCeilingCredits:20,
  },'admin');
  assert.equal(created.team.runAvailable,false);
  assert.equal(created.team.registeredMembers,0);
  const preview=service.planTeam(created.team.id);
  assert.equal(preview.planningOnly,true);
  assert.equal(preview.runnable,false);
  assert.equal(preview.steps.length,2);
  assert.ok(preview.blockers.some(x=>x.includes('DAG')));
  const replay=await service.formTeam({
    requestId:'team-alpha',templateId:'overseas-growth',name:'Overseas growth team',
    mission:'Validate the distributor market with evidence and an approved total budget',
    leadId:lead.id,memberIds:[buyer.id],budgetCredits:100,taskCeilingCredits:20,
  },'admin');
  assert.equal(replay.duplicate,true);
  const edited=await service.configureTeam(created.team.id,{
    name:'US wholesale growth',budgetCredits:150,expectedRevision:1,
  },'admin');
  assert.equal(edited.team.name,'US wholesale growth');
  assert.equal(edited.team.revision,2);
  await assert.rejects(service.configureTeam(created.team.id,{expectedRevision:1,budgetCredits:120},'admin'),{code:'REVISION_CONFLICT'});
  await assert.rejects(service.formTeam({
    requestId:'bad-budget',templateId:'overseas-growth',name:'Invalid team',
    mission:'Research outside markets',leadId:lead.id,memberIds:[buyer.id],
    budgetCredits:10,taskCeilingCredits:30,
  },'admin'),{code:'INVALID_BUDGET'});
});
test('client cannot pass arbitrary connector URLs, credentials or private tool entitlements', async t=>{
  const { service }=await setup(t);
  await assert.rejects(service.hire(hire('buyer-hunter','url',{endpoint:'https://evil.example'}),'admin'),{code:'INVALID_INPUT'});
  await assert.rejects(service.hire(hire('buyer-hunter','forbidden',{skills:['send-email']}),'admin'),{code:'SKILL_SCOPE_INVALID'});
  await assert.rejects(service.hire(hire('buyer-hunter','unauthorized',{workerId:'my-personal-dot'}),'admin'),{code:'WORKER_UNAVAILABLE'});
});


test('a staffed expert delegates only to the existing reviewed work-order interface, with exact public scope and ceiling', async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cloud-expert-delegation-'));
  const store=await openStore(dir);
  t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
  let submitted=null;
  const service=createCloudExpertService({
    store,workerCatalog:workers,
    workerDesk:{ async create(input,actor){submitted={input,actor};return {order:{id:'real-draft-order',status:'draft'},duplicate:false};} },
  });
  const bound=(await service.hire(hire('buyer-hunter','buyer-bound',{
    workerId:'reviewed-worker',serviceId:'buyer-discovery',
  }),'admin')).expert;
  const payload={product:'Textile fabrics',market:'USA',objective:'Discover sourced public wholesalers',
    budgetCredits:15,deadlineAt:new Date(Date.now()+86400000*3).toISOString(),
    publicDataConfirmed:true,requestId:'assignment-001'};
  const assigned=await service.delegateExpert(bound.id,payload,'admin');
  assert.equal(assigned.order.status,'draft');
  assert.equal(assigned.dispatchRequiresAdminApproval,true);
  assert.equal(submitted.input.workerId,'reviewed-worker');
  assert.equal(submitted.input.serviceId,'buyer-discovery');
  assert.equal(submitted.input.publicDataConfirmed,true);
  assert.deepEqual(Object.keys(submitted.input).sort(),['budgetCredits','deadlineAt','market','objective','product','publicDataConfirmed','requestId','serviceId','workerId']);
  assert.equal(store.read().cloudExperts[0].delegations[0].orderId,'real-draft-order');
  await assert.rejects(service.delegateExpert(bound.id,{...payload,budgetCredits:21},'admin'),{code:'INVALID_BUDGET'});
  await assert.rejects(service.delegateExpert(bound.id,{...payload,privateFile:'/etc/secrets'},'admin'),{code:'INVALID_DELEGATION'});
  const unbound=(await service.hire(hire('market-analyst','unbound',{
    serviceId:'channel-validation',workerId:null,
  }),'admin')).expert;
  await assert.rejects(service.delegateExpert(unbound.id,payload,'admin'),{code:'WORKER_UNAVAILABLE'});
});
