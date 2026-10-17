import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalBrainHost } from '../server/goal-brain-host.mjs';
import { openFixture } from './fixtures/goal-brain-fixture.mjs';
import { libraryReadHash, libraryRecipientForModel } from '../plugins/workspace-procurement/src/library-model-read-contract.mjs';
import { digest } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
const receiver={provider:'workspace-agent-test-faux',id:'workspace-agent-test',api:'faux'};
const goalId='abb85140-d87d-428d-bdd9-eb74f5b8ce11', productId='abb85140-d87d-428d-bdd9-eb74f5b8ce12';
function fixture(){
  const f=openFixture(), workspaceId='enterprise-A', now=Date.parse('2026-10-16T10:00:00Z');
  const state={ businessLibrary:{company:{id:'company',revision:1,legalName:'Factory A',description:'Textiles',updatedAt:new Date(now-1000).toISOString()},products:[{id:productId,revision:1,name:'Rayon',description:'120gsm',updatedAt:new Date(now-1000).toISOString()}]},
    goals:[{id:goalId,conversationId:'c1',title:'Develop distributors',description:'No unapproved contact',status:'draft',revision:1}],
    conversations:['c1','c2'].map(id=>({id,workspaceId,createdBy:'owner'})),
    runs:[{id:'native-run-a',conversationId:'c1',status:'running',businessAgentContext:{subject:'owner',workspaceId,allowBusinessSubmit:true}}] };
  const store={read:()=>({...f.store.read(),...state})};
  const artifacts={read:f.artifacts.read,create:(v,a)=>f.artifacts.create(v,{check:()=>a.check(store.read())}),update:(id,v,a)=>f.artifacts.update(id,v,{check:()=>a.check(store.read())})};
  const identity={workspaceId,subject:'owner',sessionId:'session-a',role:'admin'};
  const sessions=new Map([['session-a',{workspaceId,subject:'owner',role:'admin'}]]);
  const access={mode:'enterprise',nativeSessionById:id=>sessions.get(id)};
  const scope={workspaceId,subject:'owner',expiresAt:'2027-01-01T00:00:00Z',company:{revision:1,fields:['legalName','description']},products:[{id:productId,revision:1}],productFields:['name','description']};
  const libraryModelRead={businessBrainForSession:({identity:who,recipientHash})=>{
    const assertCurrent=()=>{if(!sessions.has(who.sessionId)||recipientHash!==libraryReadHash(libraryRecipientForModel(receiver)))throw Error('original grant revoked')};
    assertCurrent();return {scope,assertCurrent};
  }};
  const policy=[{id:goalId,originalRevision:1,currency:'USD',businessStatus:'active',capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}];
  const host=(reviewedGoals=policy)=>createGoalBrainHost({store,artifacts,access,libraryModelRead,originalReceiver:receiver,reviewedGoals,clock:()=>now});
  return {now,store,artifacts,f,state,identity,sessions,host,close:()=>f.close()};
}
test('original Host: source catalog is versioned and limited to reviewed company/product field masks',async t=>{
  const d=fixture();t.after(d.close);const a=d.host().bind({identity:d.identity,conversationId:'c1'});
  const r=await a.brain.sourceCatalog({},null,a.binding.receiver);
  assert.deepEqual(r.data.sourceRefs.map(x=>x.fields),[['legalName','description'],['name','description']]);
  assert.deepEqual(r.data.goalIds,[goalId]);assert.equal(await a.revalidateReceipt(r,null,a.binding.receiver),true);
});
test('original Host: second same-enterprise conversation restores saved context; old member or revoked source fails closed',async t=>{
  const d=fixture();t.after(d.close);const h=d.host();const a=h.bind({identity:d.identity,conversationId:'c1',runId:'native-run-a',canSubmit:true});
  const catalog=await a.brain.sourceCatalog({},null,a.binding.receiver);
  const input={requestId:'original-context-1',expectedRevision:0,goalIds:[goalId],sourceRefs:catalog.data.sourceRefs,
    businessModel:{valueProposition:'Textiles',customerSegments:['US buyers'],revenueModel:'B2B'},operatingFocus:['Diagnose inquiries'],unknowns:['Margins'],notes:[]};
  const saved=await a.brain.contextSave(input,null,a.binding.receiver);
  const b=h.bind({identity:d.identity,conversationId:'c2'});const restored=await b.brain.contextRead({},null,b.binding.receiver);
  assert.equal(saved.recordRef.artifactId,restored.recordRef.artifactId);
  await assert.rejects(()=>b.brain.contextSave(input,null,b.binding.receiver),e=>e.code==='BRAIN_EXECUTION_INTENT_REQUIRED');
  d.state.businessLibrary.products[0].revision++;
  await assert.rejects(()=>b.brain.contextRead({},null,b.binding.receiver),e=>e.code==='BRAIN_SOURCE_CHANGED');
  d.sessions.delete('session-a');
  await assert.rejects(()=>a.brain.contextRead({},null,a.binding.receiver),e=>e.code==='BRAIN_SESSION_EXPIRED');
});
test('original Host: approved fields that contain credential-looking content are not disclosed',async t=>{
  const d=fixture();t.after(d.close);d.state.businessLibrary.company.description='api_key=secret1234567890';
  const a=d.host().bind({identity:d.identity,conversationId:'c1'});
  await assert.rejects(()=>a.brain.sourceCatalog({},null,a.binding.receiver),e=>e.code==='BRAIN_SOURCE_UNSAFE');
});
test('original Host: a stopped or unapproved original Run cannot save memory',async t=>{
  const d=fixture();t.after(d.close);const a=d.host().bind({identity:d.identity,conversationId:'c1',runId:'native-run-a',canSubmit:true});
  const c=await a.brain.sourceCatalog({},null,a.binding.receiver);
  d.state.runs[0].status='cancelled';
  const input={requestId:'refused-run',expectedRevision:0,goalIds:[],sourceRefs:c.data.sourceRefs,
    businessModel:{valueProposition:'Textiles',customerSegments:[],revenueModel:'B2B'},operatingFocus:[],unknowns:[],notes:[]};
  await assert.rejects(()=>a.brain.contextSave(input,null,a.binding.receiver),e=>e.code==='BRAIN_EXECUTION_INTENT_REQUIRED');
});
test('original Host: business policy cannot invent money or enable Worker execution',t=>{
  const d=fixture();t.after(d.close);const previous=d.host([]).bind({identity:d.identity,conversationId:'c1'});
  assert.ok(previous);for(const bad of [{budgetRemainingMinor:1000},{capabilities:['worker-order']},{reviewed:false}]){
    const policy={id:goalId,originalRevision:1,currency:'USD',businessStatus:'active',capabilities:['analysis'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true,...bad};
    assert.throws(()=>d.host([policy]),e=>e.code==='BRAIN_GOAL_POLICY_INVALID');
  }
});

test('original Host never borrows another tenant Goal even if reviewed policy lists its UUID',async t=>{
  const d=fixture();t.after(d.close);
  d.state.conversations.push({id:'foreign-goal-conversation',workspaceId:'enterprise-B',createdBy:'other'});
  d.state.goals[0].conversationId='foreign-goal-conversation';
  const a=d.host().bind({identity:d.identity,conversationId:'c1'});
  const list=await a.brain.sourceCatalog({},null,a.binding.receiver);
  assert.deepEqual(list.data.goalIds,[]);
});

test('original Host: Brain memory can be saved inside the current Run without external business-submit approval',async t=>{
  const d=fixture();t.after(d.close);
  const h=d.host(), a=h.bind({identity:d.identity,conversationId:'c1',runId:'native-run-a',canSubmit:false});
  const catalog=await a.brain.sourceCatalog({},null,a.binding.receiver);
  const input={requestId:'memory-without-execution',expectedRevision:0,goalIds:[goalId],sourceRefs:catalog.data.sourceRefs,
    businessModel:{valueProposition:'Textiles',customerSegments:['US buyers'],revenueModel:'B2B'},operatingFocus:['Diagnose inquiries'],unknowns:[],notes:[]};
  const saved=await a.brain.contextSave(input,null,a.binding.receiver);
  assert.equal(saved.persisted,true);assert.equal(saved.businessAuthority,false);assert.equal(saved.executable,false);
});

test('original Host: a reviewed source adapter can expose live metric evidence without becoming a second data store',async t=>{
  const d=fixture();t.after(d.close);
  const values={metricType:'inquiry-funnel-v1',windowStart:'2026-09-01T00:00:00Z',windowEnd:'2026-10-01T00:00:00Z',
    eligible:100,converted:10,pending:5,unknown:5,segment:{productId:productId,market:'US',channel:'inbound-rfq'},
    baseline:{windowStart:'2026-08-01T00:00:00Z',windowEnd:'2026-08-31T00:00:00Z',eligible:100,converted:15,pending:0,unknown:0}};
  const reference={kind:'metric',id:'rfq-funnel',revision:'1',sha256:digest(values),fields:Object.keys(values)};
  const row={workspaceId:'enterprise-A',reference,observedAt:'2026-10-16T09:59:00Z',validUntil:'2027-01-01T00:00:00Z',values};
  const sourceAdapter={async list(){return [reference];},async read(){return structuredClone(row);},current(){return structuredClone(row);}};
  const dHost=d.host();
  const host=createGoalBrainHost({
    store:d.store,
    artifacts:d.artifacts,
    access:{mode:'enterprise',nativeSessionById:id=>d.sessions.get(id)},
    libraryModelRead:{businessBrainForSession:({identity:who,recipientHash})=>{
      const assertCurrent=()=>{if(!d.sessions.has(who.sessionId)||recipientHash!==libraryReadHash(libraryRecipientForModel(receiver)))throw Error('original grant revoked');};
      assertCurrent();
      return {scope:{workspaceId:'enterprise-A',subject:'owner',expiresAt:'2027-01-01T00:00:00Z',
        company:{revision:1,fields:['legalName','description']},products:[{id:productId,revision:1}],productFields:['name','description']},assertCurrent};
    }},
    originalReceiver:receiver,
    reviewedGoals:[{id:goalId,originalRevision:1,currency:'USD',businessStatus:'active',capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}],
    sourceAdapter,
    clock:()=>d.now
  });
  assert.ok(dHost);
  const a=host.bind({identity:d.identity,conversationId:'c1',runId:'native-run-a',canSubmit:false});
  const catalog=await a.brain.sourceCatalog({},null,a.binding.receiver);
  const metricRef=catalog.data.sourceRefs.find(ref=>ref.kind==='metric');
  assert.ok(metricRef);
  const input={requestId:'metric-context',expectedRevision:0,goalIds:[goalId],sourceRefs:[metricRef],
    businessModel:{valueProposition:'Textiles',customerSegments:['US buyers'],revenueModel:'B2B'},
    operatingFocus:['Diagnose inquiry conversion'],unknowns:[],notes:[]};
  await a.brain.contextSave(input,null,a.binding.receiver);
  const diagnosis=await a.brain.diagnose({},null,a.binding.receiver);
  assert.equal(diagnosis.data.signals[0].descriptiveRateDelta,null);
  assert.equal(diagnosis.data.signals[0].comparisonStatus,'incomplete-or-unmeasurable-cohorts');
  assert.ok(diagnosis.data.signals[0].gaps.includes('PENDING_COHORT_MEMBERS'));
});
