// SQLite Artifact facade only; actual Store/Host/OMP coverage is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openFixture,prepared,contextInput,decisionInput,model} from './fixtures/goal-brain-fixture.mjs';

async function fixture(t){const f=openFixture();t.after(()=>f.close());return {f,...await prepared(f)};}
const save=(brain,input)=>brain.decisionSave(input,undefined,model);
const validate=(brain,receipt,signal)=>brain.revalidateReceipt(receipt,signal,model);

test('same-binding decision edits validate exact immutable receipts; retry creates no new version',async t=>{
 const {f,brain}=await fixture(t),first=await save(brain,decisionInput()),bytes=JSON.stringify(first);
 const input=decisionInput('decision-1',{requestId:'second',expectedRevision:1,problem:'Revised synthetic investigation'});
 const second=await save(brain,input);assert.equal(await validate(brain,first),true);
 const retry=await save(brain,input);assert.deepEqual(retry,second);assert.equal(f.state.commitCount,3);
 assert.equal(JSON.stringify(first),bytes);assert.equal(second.recordRef.recordRevision,2);
 await assert.rejects(save(brain,{...input,problem:'Changed request body'}),e=>e.code==='BRAIN_REQUEST_CHANGED');
});
for(const change of ['source','goal','revoked','other-binding','context'])test('historical decision remains refused after '+change,async t=>{
 const {f,brain,ref}=await fixture(t),first=await save(brain,decisionInput());
 const writer=change==='other-binding'?f.makeBrain('enterprise-A',{conversationId:'other-conversation',sessionId:'other-session'}).brain:brain;
 await save(writer,decisionInput('decision-1',{requestId:'second',expectedRevision:1}));
 if(change==='source')f.source('enterprise-A',ref).reference.revision='2';
 if(change==='goal')f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).revision='2';
 if(change==='revoked')f.state.revoked=true;
 if(change==='context')await brain.contextSave(contextInput([ref],{requestId:'new-context',expectedRevision:1}),undefined,model);
 await assert.rejects(validate(brain,first));
});
test('decision source removed in successor still needs current original authority',async t=>{
 const {f,brain}=await fixture(t),extra=f.addSource('enterprise-A','metric','extra',{observation:'Synthetic only'});
 const first=await save(brain,decisionInput('decision-1',{sourceRefs:[extra]}));
 await save(brain,decisionInput('decision-1',{requestId:'second',expectedRevision:1}));
 assert.equal(await validate(brain,first),true);f.source('enterprise-A',extra).reference.revision='2';
 await assert.rejects(validate(brain,first));
});
test('foreign enterprise and cancelled signal cannot validate a saved decision',async t=>{
 const {f,brain}=await fixture(t),first=await save(brain,decisionInput()),foreign=await prepared(f,'enterprise-B');
 await assert.rejects(validate(foreign.brain,first),e=>e.code==='BRAIN_CACHE_REFUSED');
 const controller=new AbortController();controller.abort();await assert.rejects(validate(brain,first,controller.signal),e=>e.code==='BRAIN_CANCELLED');
});
test('changing historical receipt body, hash, version, id or binding fails closed',async t=>{
 const {brain}=await fixture(t),first=await save(brain,decisionInput());await save(brain,decisionInput('decision-1',{requestId:'second',expectedRevision:1}));
 for(const mutate of [x=>x.data.decision.payload.problem='Forged body',x=>x.recordRef.sha256='0'.repeat(64),x=>x.recordRef.version++,x=>x.id='another',x=>x.bindingHash='0'.repeat(64)]){
  const forged=structuredClone(first);mutate(forged);await assert.rejects(validate(brain,forged));
 }
});
test('revocation during original Artifact read is refused',async t=>{
 const {f,brain}=await fixture(t),first=await save(brain,decisionInput());await save(brain,decisionInput('decision-1',{requestId:'second',expectedRevision:1}));
 let once=false;f.state.afterRead=()=>{if(!once){once=true;f.state.revoked=true;}};
 await assert.rejects(validate(brain,first));assert.equal(once,true);
});

test('removed historical source changing during final current-decision read is still refused',async t=>{
 const {f,brain}=await fixture(t),extra=f.addSource('enterprise-A','metric','extra',{observation:'Synthetic only'});
 const first=await save(brain,decisionInput('decision-1',{sourceRefs:[extra]}));
 await save(brain,decisionInput('decision-1',{requestId:'second',expectedRevision:1}));
 let reads=0;f.state.afterRead=()=>{if(++reads===7)f.source('enterprise-A',extra).reference.revision='2';};
 await assert.rejects(validate(brain,first));assert.ok(reads>=7,'Reach final decision-state read after historical capture');
});

test('concurrent original decision write while reading an Artifact version invalidates validation',async t=>{
 const {f,brain}=await fixture(t),first=await save(brain,decisionInput());await save(brain,decisionInput('decision-1',{requestId:'second',expectedRevision:1}));
 let raced=false,reads=0;f.state.afterRead=async()=>{if(++reads!==4)return;f.state.afterRead=null;raced=true;await save(brain,decisionInput('decision-1',{requestId:'third',expectedRevision:2}));};
 await assert.rejects(validate(brain,first));assert.equal(raced,true);
});
