import test from 'node:test';
import assert from 'node:assert/strict';
import {openFixture,prepared,contextInput,model} from './fixtures/goal-brain-fixture.mjs';
for(const change of ['none','source','goal','session','other-binding'])test('immutable context succession retains authority: '+change,async t=>{
 const f=openFixture();t.after(()=>f.close());const {brain,ref}=await prepared(f);const old=await brain.contextRead({},undefined,model),bytes=JSON.stringify(old);
 const input=contextInput([ref],{requestId:'context-2',expectedRevision:1});
 const writer=change==='other-binding'?f.makeBrain('enterprise-A',{conversationId:'different',sessionId:'different'}).brain:brain;
 await writer.contextSave(input,undefined,model);
 if(change==='source')f.source('enterprise-A',ref).reference.revision='2';
 if(change==='goal')f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).revision='2';
 if(change==='session')f.state.revoked=true;
 if(change==='none'){assert.equal(await brain.revalidateReceipt(old,undefined,model),true);await brain.contextSave(input,undefined,model);assert.equal(f.state.commitCount,2);}
 else await assert.rejects(brain.revalidateReceipt(old,undefined,model));
 assert.equal(JSON.stringify(old),bytes,'Old receipt bytes must not be rewritten');
});
test('empty context receipt can precede first same-binding save',async t=>{const f=openFixture();t.after(()=>f.close());f.addGoal('A');const {brain}=f.makeBrain('A');const empty=await brain.contextRead({},undefined,model);await brain.contextSave(contextInput([]),undefined,model);assert.equal(await brain.revalidateReceipt(empty,undefined,model),true);});
test('historical removed source must remain authorized after context succession',async t=>{const f=openFixture();t.after(()=>f.close());const {brain,ref}=await prepared(f);const old=await brain.contextRead({},undefined,model);await brain.contextSave(contextInput([],{requestId:'remove-source',expectedRevision:1}),undefined,model);f.source('enterprise-A',ref).reference.revision='2';await assert.rejects(brain.revalidateReceipt(old,undefined,model));});

test('lost save acknowledgement reports unknown; exact retry confirms one persisted original version',async t=>{
 const {businessBrainExtension}=await import('../plugins/workspace-goal-intelligence/src/extension.mjs');
 const {isBrainGapReceipt}=await import('../server/workspace-omp-business-journal.mjs');
 const f=openFixture();t.after(()=>f.close());f.addGoal('A');const {brain}=f.makeBrain('A'),input=contextInput([]),tools=[];
 businessBrainExtension({brain:{...brain,contextSave:async(...args)=>{await brain.contextSave(...args);throw Error('Synthetic lost post-commit acknowledgement');}},registerContextGuard:()=>true})({registerTool:tool=>tools.push(tool)});
 const response=await tools.find(x=>x.name==='workspace_brain_context_save').execute('save',input,undefined,undefined,{model});
 assert.equal(response.isError,true);assert.equal(response.details.writeOutcome,'unknown');assert.equal(response.details.retryWithNewRequest,false);assert.equal(isBrainGapReceipt(response.details),true);assert.equal(f.state.commitCount,1);
 const confirmed=await brain.contextSave(input,undefined,model);assert.equal(confirmed.persisted,true);assert.equal(confirmed.recordRef.recordRevision,1);assert.equal(f.state.commitCount,1);
 assert.equal(isBrainGapReceipt({...response.details,writeOutcome:'PRIVATE_BODY'}),false);
});
