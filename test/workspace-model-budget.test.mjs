import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openStore} from '../server/store.mjs';
import {createRuntime} from '../server/runtime.mjs';
import {createWorkspaceModelBudget,WORKSPACE_MODEL_BUDGET} from '../server/workspace-model-budget.mjs';
import {LOCAL_DEEPSEEK_LIMITS} from '../server/workspace-omp-local-deepseek.mjs';
import {DEEPSEEK_PRICES,deepseekUsageUpperCny} from '../server/deepseek-acceptance-policy.mjs';
const configuration={providerId:'workspace-deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',cost:DEEPSEEK_PRICES.ompUsdPerMillion};
const selection=()=>({kind:WORKSPACE_MODEL_BUDGET,reviewed:true,budgetId:'synthetic-budget',workspaceId:'workspace',subject:'owner',expiresAt:'2099-01-01T00:00:00.000Z',limitCny:5,historicalUpperCny:0.139804,receiver:{provider:configuration.providerId,id:configuration.model,baseUrl:configuration.baseUrl}});
const report=(count=1)=>{const inputTokens=100*count,outputTokens=20*count,cost=deepseekUsageUpperCny(inputTokens,outputTokens);return {actualProviderRequests:count,confirmedResponses:count,confirmedUsage:{inputTokens,outputTokens,totalTokens:inputTokens+outputTokens},confirmedUsageUpperCny:cost,chargeUpperCny:cost,billingUncertain:false,stoppedReason:null,accountChargedCny:null,limits:LOCAL_DEEPSEEK_LIMITS};};
async function fixture(t,override={}){
 const directory=await fs.mkdtemp('/tmp/workspace-model-budget-');let store=await openStore(directory);
 t.after(async()=>{await store.close();await fs.rm(directory,{recursive:true,force:true});});
 const config={...selection(),...override};
 const adapter=()=>createWorkspaceModelBudget({store,selection:config,configuration});
 const add=async id=>store.update(state=>{state.conversations.push({id:'c-'+id,activeRunId:id});state.runs.push({id,conversationId:'c-'+id,status:'running',businessAgentContext:{workspaceId:config.workspaceId,subject:config.subject}});});
 return {get store(){return store;},config,adapter,add,reopen:async()=>{await store.close();store=await openStore(directory);},done:async id=>store.update(state=>{state.runs.find(r=>r.id===id).status='succeeded';state.conversations.find(c=>c.id==='c-'+id).activeRunId=null;})};
}
test('three normal Runs share durable confirmed usage and a reopened Store retains the same budget',async t=>{
 const f=await fixture(t);
 for(const id of ['first','second','third']){await f.add(id);const budget=f.adapter();await budget.begin(id);assert.equal(budget.assertCurrent(id),true);const result=await budget.finish(id,{report:report(),modelCalls:1,successful:true});assert.equal(result.status,'confirmed');await f.done(id);}
 const before=f.store.read().runs.map(r=>r.modelBudgetReceipt);assert.equal(before.length,3);assert.ok(before.every(r=>r.phase==='confirmed'&&r.chargedMicros===360));
 await f.reopen();assert.deepEqual(f.store.read().runs.map(r=>r.modelBudgetReceipt),before);
 await f.add('fourth');await f.adapter().begin('fourth');assert.equal(f.store.read().runs.at(-1).modelBudgetReceipt.chargedMicros,2700000);
});
test('serialized original Store transactions reserve once across concurrent adapter instances',async t=>{
 const f=await fixture(t);await f.add('a');await f.add('b');
 const results=await Promise.allSettled([f.adapter().begin('a'),f.adapter().begin('b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'MODEL_BUDGET_EXHAUSTED');
 const admitted=f.store.read().runs.find(r=>r.modelBudgetReceipt);assert.ok(admitted);await assert.rejects(f.adapter().begin(admitted.id),{code:'MODEL_BUDGET_RUN_ALREADY_RESERVED'});
 assert.equal(f.store.read().runs.filter(r=>r.modelBudgetReceipt).length,1);
});
test('prior usage and historical allowance cannot be reset by recreating the adapter or reopening Store',async t=>{
 const f=await fixture(t,{limitCny:2.8401});await f.add('a');await f.adapter().begin('a');await f.adapter().finish('a',{report:report(),modelCalls:1,successful:true});await f.done('a');await f.reopen();await f.add('b');
 await assert.rejects(f.adapter().begin('b'),{code:'MODEL_BUDGET_EXHAUSTED'});
 const changed=createWorkspaceModelBudget({store:f.store,selection:{...f.config,historicalUpperCny:0},configuration});await assert.rejects(changed.begin('b'),{code:'MODEL_BUDGET_POLICY_CHANGED'});
});
test('missing usage holds full reservation across restart and blocks the next Run',async t=>{
 const f=await fixture(t);await f.add('unknown');const budget=f.adapter();await budget.begin('unknown');const settled=await budget.finish('unknown',{report:null,modelCalls:1,successful:false});assert.equal(settled.status,'unconfirmed');assert.equal(settled.reservedUpperCny,2.7);await f.done('unknown');await f.reopen();await f.add('next');
 await assert.rejects(f.adapter().begin('next'),{code:'MODEL_BUDGET_UNCONFIRMED'});assert.equal(f.store.read().runs[0].modelBudgetReceipt.chargedMicros,2700000);
});
test('an interrupted pre-settlement Run stays fully reserved after original runtime startup',async t=>{
 const f=await fixture(t);await f.add('interrupted');await f.adapter().begin('interrupted');await f.reopen();
 const runtime=await createRuntime({store:f.store,provider:{kind:'synthetic',configured:false},autoStart:false});
 assert.equal(f.store.read().runs[0].status,'interrupted');await f.add('next');await assert.rejects(f.adapter().begin('next'),{code:'MODEL_BUDGET_UNCONFIRMED'});
 assert.equal(f.store.read().runs[0].modelBudgetReceipt.phase,'reserved');await runtime.close();
});
test('stale, malformed or incomplete provider reports settle conservatively rather than freeing allowance',async t=>{
 for(const invalid of [null,{...report(),extra:true},{...report(),confirmedUsage:{inputTokens:100.5,outputTokens:20,totalTokens:120.5}},report(2)]){
  const f=await fixture(t);await f.add('run');await f.adapter().begin('run');const result=await f.adapter().finish('run',{report:invalid,modelCalls:1,successful:false});assert.equal(result.status,'unconfirmed');assert.equal(result.report,null);assert.equal(f.store.read().runs[0].modelBudgetReceipt.chargedMicros,2700000);
 }
});
test('complete known usage after a failed Run is still charged exactly and settlement cannot be duplicated',async t=>{
 const f=await fixture(t);await f.add('run');const budget=f.adapter();await budget.begin('run');await f.done('run');const result=await budget.finish('run',{report:report(),modelCalls:1,successful:false});assert.equal(result.status,'confirmed');assert.equal(result.reservedUpperCny,0.00036);await assert.rejects(budget.finish('run',{report:report(),modelCalls:1,successful:false}),{code:'MODEL_BUDGET_SETTLEMENT_CHANGED'});
});
test('budget expiry, receiver, Run identity and live cancellation retain their original fail-closed gates',async t=>{
 const f=await fixture(t);await f.add('run');
 assert.throws(()=>createWorkspaceModelBudget({store:f.store,selection:f.config,configuration:{...configuration,baseUrl:'https://other.example'}}),{code:'MODEL_BUDGET_RECEIVER_CHANGED'});
 const expired=createWorkspaceModelBudget({store:f.store,selection:f.config,configuration,clock:()=>Date.parse(f.config.expiresAt)});await assert.rejects(expired.begin('run'),{code:'MODEL_BUDGET_EXPIRED'});
 const budget=f.adapter();await assert.rejects(budget.begin('run',()=>{throw Error('Original Session revoked');}),/Session revoked/);assert.equal(f.store.read().runs[0].modelBudgetReceipt,undefined);
 await budget.begin('run');await f.store.update(state=>{state.conversations[0].activeRunId=null;});assert.throws(()=>budget.assertCurrent('run'),{code:'MODEL_BUDGET_RUN_CHANGED'});
});
test('original Store validation rejects mutated or fabricated durable accounting instead of trusting receipt flags',async t=>{
 const f=await fixture(t);await f.add('run');await f.adapter().begin('run');
 for(const mutate of [r=>r.chargedMicros=0,r=>r.scopeHash='0'.repeat(64),r=>r.phase='confirmed',r=>r.selection.limitCny=100])await assert.rejects(f.store.update(state=>mutate(state.runs[0].modelBudgetReceipt)));
 assert.equal(f.store.read().runs[0].modelBudgetReceipt.chargedMicros,2700000);
});
