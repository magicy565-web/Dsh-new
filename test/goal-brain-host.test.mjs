import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalBrainHost } from '../server/goal-brain-host.mjs';
import { openFixture } from './fixtures/goal-brain-fixture.mjs';
import { digest } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { libraryReadHash, libraryRecipientForModel } from '../plugins/workspace-procurement/src/library-model-read-contract.mjs';

const model = { provider: 'workspace-agent-test-faux', id: 'workspace-agent-test', api: 'faux' };
const now = Date.parse('2026-10-16T10:00:00Z');
const workspaceId = 'enterprise-A';
const sessionId = 'original-session-a';
const goalId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce11';
const productId = 'abb85140-d87d-428d-bdd9-eb74f5b8ce12';
const convo1 = 'conversation-a', convo2 = 'conversation-b';

function setup() {
  const fixture = openFixture();
  const persisted = {
    businessLibrary: { version:1, company: {
      id:'company', revision:1, legalName:'Manufacturer A', displayName:'Factory A',
      description:'Printed textile production', updatedAt:new Date(now-5000).toISOString()
    }, products:[{ id:productId, revision:1, name:'Printed rayon', description:'120 GSM',
      category:'fabric', status:'active', updatedAt:new Date(now-5000).toISOString() }] },
    goals:[{id:goalId,conversationId:convo1,title:'Investigate US distributors',
      description:'No external contact until approval',status:'draft',revision:1}],
    conversations:[convo1,convo2].map(id=>({id,workspaceId,createdBy:'owner',
      businessAgentOwner:{subject:'owner',workspaceId}})),
    runs:[{id:'native-run-a',conversationId:convo1,status:'running',
      businessAgentContext:{subject:'owner',workspaceId,allowBusinessSubmit:true}}],
  };
  const store={read:()=>({...fixture.store.read(),...persisted})};
  // TEST ONLY. Production uses the original serialized Artifact transaction
  // with synchronous, validated admission.check inside Store.update().
  const artifacts={
    read:fixture.artifacts.read,
    create:(body,admission)=>fixture.artifacts.create(body,{...admission,check:()=>admission.check(store.read())}),
    update:(id,body,admission)=>fixture.artifacts.update(id,body,{...admission,check:()=>admission.check(store.read())}),
  };
  const sessions=new Map([[sessionId,{subject:'owner',workspaceId,role:'admin'}]]);
  const access={mode:'enterprise',nativeSessionById:id=>sessions.get(id)};
  const scope={workspaceId,subject:'owner',expiresAt:'2027-01-01T00:00:00Z',
    company:{revision:1,fields:['legalName','displayName','description']},
    products:[{id:productId,revision:1}],productFields:['name','description','category','status']};
  const libraryModelRead={businessBrainForSession:({identity,recipientHash,signal})=>{
    const assertCurrent=()=>{
      signal?.throwIfAborted();
      if(!sessions.has(identity.sessionId)||identity.workspaceId!==scope.workspaceId||identity.subject!==scope.subject
        ||recipientHash!==libraryReadHash(libraryRecipientForModel(model))||Date.parse(scope.expiresAt)<=now)
        throw Object.assign(new Error('Original library authority revoked'),{code:'BRAIN_LIBRARY_REVOKED'});
    };
    assertCurrent();return {scope,assertCurrent};
  }};
  const reviewedGoals=[{id:goalId,originalRevision:1,currency:'USD',businessStatus:'active',
    capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}];
  const original=()=>createGoalBrainHost({
    store,artifacts,access,libraryModelRead,originalReceiver:model,reviewedGoals,clock:()=>now
  });
  const identity={sessionId,subject:'owner',workspaceId,role:'admin'};
  return {fixture,persisted,store,artifacts,scope,sessions,identity,goalId,original,
    reviewedGoals,access,libraryModelRead,close:()=>fixture.close()};
}
function newContext(refs,goalIds=[goalId]){
  return {requestId:'trusted-context-initial',expectedRevision:0,goalIds,sourceRefs:refs,
    businessModel:{valueProposition:'Supplier of textiles',customerSegments:['US wholesale buyers'],revenueModel:'Wholesale supply'},
    operatingFocus:['Determine why qualified enquiries do not convert'],unknowns:['Profit and cash flow unavailable'],notes:[]};
}
test('original company/product selection lists only field-masked pinned source references',async t=>{
  const f=setup();t.after(f.close);
  const client=f.original().bind({identity:f.identity,conversationId:convo1,runId:'native-run-a',canSubmit:true});
  const result=await client.brain.sourceCatalog({},undefined,client.binding.receiver);
  assert.equal(result.kind,'catalog');assert.equal(result.data.status,'available');
  assert.deepEqual(result.data.goalIds,[goalId]);
  assert.deepEqual(result.data.sourceRefs.map(r=>r.kind),['company','product']);
  assert.deepEqual(result.data.sourceRefs[0].fields,['legalName','displayName','description']);
  assert.equal(result.data.sourceRefs[0].sha256,digest({
    legalName:'Manufacturer A',displayName:'Factory A',description:'Printed textile production'
  }));
  assert.equal(await client.revalidateReceipt(result,undefined,client.binding.receiver),true);
});
test('same-enterprise second conversation reads first conversation original Artifact context',async t=>{
  const f=setup();t.after(f.close);const host=f.original();
  const a=host.bind({identity:f.identity,conversationId:convo1,runId:'native-run-a',canSubmit:true});
  const catalog=await a.brain.sourceCatalog({},undefined,a.binding.receiver);
  const saved=await a.brain.contextSave(newContext(catalog.data.sourceRefs),undefined,a.binding.receiver);
  assert.equal(saved.persisted,true);assert.equal(saved.data.sources.length,2);
  const b=host.bind({identity:f.identity,conversationId:convo2,canSubmit:false});
  const found=await b.brain.contextRead({},undefined,b.binding.receiver);
  assert.equal(found.recordRef.artifactId,saved.recordRef.artifactId);
  assert.equal(found.data.context.payload.businessModel.valueProposition,'Supplier of textiles');
  await assert.rejects(()=>b.brain.contextSave(newContext(catalog.data.sourceRefs),undefined,b.binding.receiver),
    e=>e.code==='BRAIN_EXECUTION_INTENT_REQUIRED');
});
test('revoking original Session prevents every business read even with cached reference',async t=>{
  const f=setup();t.after(f.close);const host=f.original();
  const a=host.bind({identity:f.identity,conversationId:convo1,runId:'native-run-a',canSubmit:true});
  const catalog=await a.brain.sourceCatalog({},undefined,a.binding.receiver);
  f.sessions.delete(sessionId);
  await assert.rejects(()=>a.brain.contextRead({},undefined,a.binding.receiver),e=>e.code==='BRAIN_SESSION_EXPIRED');
  await assert.rejects(()=>a.brain.revalidateReceipt(catalog,undefined,a.binding.receiver),e=>e.code==='BRAIN_SESSION_EXPIRED');
});
test('original product revision change invalidates existing saved context on revisit',async t=>{
  const f=setup();t.after(f.close);const host=f.original();
  const a=host.bind({identity:f.identity,conversationId:convo1,runId:'native-run-a',canSubmit:true});
  const catalog=await a.brain.sourceCatalog({},undefined,a.binding.receiver);
  await a.brain.contextSave(newContext(catalog.data.sourceRefs),undefined,a.binding.receiver);
  f.persisted.businessLibrary.products[0].revision++;
  await assert.rejects(()=>host.bind({identity:f.identity,conversationId:convo2}).brain.contextRead({},undefined,a.binding.receiver),
    e=>e.code==='BRAIN_SOURCE_CHANGED');
});
test('other original members or workspaces cannot read enterprise context',t=>{
  const f=setup();t.after(f.close);const host=f.original();
  f.sessions.set('member-b',{subject:'other',workspaceId:'enterprise-B',role:'admin'});
  assert.throws(()=>host.bind({identity:{sessionId:'member-b',subject:'other',workspaceId:'enterprise-B',role:'admin'},conversationId:convo1}),
    e=>e.code==='BRAIN_CONVERSATION_NOT_OWNED');
  f.sessions.set('employee',{subject:'employee',workspaceId:'enterprise-A',role:'viewer'});
  assert.throws(()=>host.bind({identity:{sessionId:'employee',subject:'employee',workspaceId:'enterprise-A',role:'viewer'},conversationId:convo1}),
    e=>e.code==='BRAIN_CONVERSATION_NOT_OWNED');
});
test('no reviewed Goals implies no asserted spend or automatic execution',async t=>{
  const f=setup();t.after(f.close);
  const host=createGoalBrainHost({store:f.store,artifacts:f.artifacts,access:f.access,
    libraryModelRead:f.libraryModelRead,originalReceiver:model,reviewedGoals:[],clock:()=>now});
  const b=host.bind({identity:f.identity,conversationId:convo1});
  const catalog=await b.brain.sourceCatalog({},undefined,b.binding.receiver);
  assert.deepEqual(catalog.data.goalIds,[]);
  await assert.rejects(()=>b.brain.contextSave(newContext(catalog.data.sourceRefs,[goalId]),undefined,b.binding.receiver),
    e=>e.code==='BRAIN_EXECUTION_INTENT_REQUIRED');
});
test('unreviewed goal policy cannot promise spending or external Worker capabilities',t=>{
  const f=setup();t.after(f.close);
  for(const invalid of [
    {...f.reviewedGoals[0],budgetRemainingMinor:1000},
    {...f.reviewedGoals[0],currency:'???'},
    {...f.reviewedGoals[0],reviewed:false},
    {...f.reviewedGoals[0],capabilities:['worker-order']},
  ]) assert.throws(()=>createGoalBrainHost({store:f.store,artifacts:f.artifacts,access:f.access,
    libraryModelRead:f.libraryModelRead,originalReceiver:model,reviewedGoals:[invalid],clock:()=>now}),
    e=>e.code==='BRAIN_GOAL_POLICY_INVALID');
});
