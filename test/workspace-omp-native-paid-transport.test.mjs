// Pure finite transport/accounting tests. No provider or SDK network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceConfiguration,boundedDeepseekFetch} from '../server/deepseek-acceptance-policy.mjs';
import {createLocalDeepseekTransport,createNativeDeepseekAcceptance,validateLocalDeepseekReport,
 NATIVE_FACTS_PAID_ACCEPTANCE,LOCAL_DEEPSEEK_LIMITS as limits} from '../server/workspace-omp-local-deepseek.mjs';
import {createWorkspaceOmpSession} from '../server/workspace-omp-session.mjs';
const configuration=acceptanceConfiguration({DEEPSEEK_API_KEY:'synthetic-unused-offline'});
const body=()=>({model:'deepseek-flash',messages:[{role:'developer',content:[{type:'text',text:'SYNTHETIC fact exact text'}]}],
 tools:[{type:'function',function:{name:'workspace_brain_context',strict:true}}],max_tokens:9999,max_completion_tokens:9999,reasoning_effort:'high',store:true});
const request=(value=body(),signal)=>new Request('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify(value),signal});
function confirm(transport,input=100,output=20){
 transport.onSseEvent({data:JSON.stringify({usage:{prompt_tokens:input,completion_tokens:output,total_tokens:input+output}})});
 transport.complete({role:'assistant',content:[{type:'text',text:'Finite synthetic response.'}],stopReason:'stop',usage:{input,output,cacheRead:0,cacheWrite:0,totalTokens:input+output}});
}
function transportWith(fetchImpl){const t=createLocalDeepseekTransport({configuration,fetchImpl});t.configureTools(['workspace_brain_context']);return t;}
const hook=()=>({authorize:async()=>{},assertCurrent:()=>{}});
async function confirmedReport(){const t=transportWith(async()=>new Response('finite'));await t.fetch(request());confirm(t);t.finish();return t.report();}
const selection=()=>({kind:NATIVE_FACTS_PAID_ACCEPTANCE,historicalUpperCny:0.139804});
const costNear=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('final disclosure sees exactly the normalized bytes and precedes one actual send',async()=>{
 const order=[];let projected;
 const t=transportWith(async r=>{order.push('fetch');assert.equal(await r.text(),projected.body);assert.equal(r.redirect,'error');return new Response('finite');});
 await t.fetchWithDisclosure(request(),undefined,{
  authorize:async wire=>{order.push('authorize');projected=wire;assert.ok(Object.isFrozen(wire));assert.deepEqual(Object.keys(wire).sort(),['body','method','url']);
   const sent=JSON.parse(wire.body);assert.equal(sent.messages[0].role,'system');assert.equal(sent.messages[0].content,'SYNTHETIC fact exact text');assert.equal(sent.max_tokens,512);
   assert.deepEqual(sent.thinking,{type:'disabled'});assert.equal(sent.max_completion_tokens,undefined);assert.equal(sent.reasoning_effort,undefined);assert.equal(sent.store,undefined);assert.equal(sent.tools[0].function.strict,undefined);},
  assertCurrent:wire=>{order.push('current');assert.equal(wire,projected);},
 });
 assert.deepEqual(order,['authorize','current','fetch']);confirm(t);t.finish();assert.equal(t.report().actualProviderRequests,1);
});
for(const mode of ['source','receiver','cancel-after-await','cancel-at-current'])test(mode+' refuses before finite send',async()=>{
 let sends=0,current=0;const controller=new AbortController(),t=transportWith(async()=>{sends++;return new Response('unreachable');});
 await assert.rejects(t.fetchWithDisclosure(request(body(),controller.signal),undefined,{
  authorize:async()=>{await Promise.resolve();if(mode==='source')throw Object.assign(Error('synthetic current refusal'),{code:'OSS_CACHE_RECEIPT_CHANGED'});if(mode==='cancel-after-await')controller.abort();},
  assertCurrent:()=>{current++;if(mode==='receiver')throw Error('receiver changed');if(mode==='cancel-at-current')controller.abort();},
 }));
 assert.equal(sends,0);assert.equal(t.report().actualProviderRequests,0);assert.equal(t.report().billingUncertain,false);
 if(mode==='source'||mode==='cancel-after-await')assert.equal(current,0);
});
test('missing hook and async final assertion are refused without sending',async()=>{
 for(const disclosure of [undefined,{authorize:async()=>{},assertCurrent:async()=>{}}]){
  let sends=0;const t=transportWith(async()=>{sends++;return new Response('unreachable');});
  await assert.rejects(t.fetchWithDisclosure(request(),undefined,disclosure));assert.equal(sends,0);assert.equal(t.report().actualProviderRequests,0);
 }
});
test('bounded helper rechecks its request limit after concurrent async authorization',async()=>{
 let release,sends=0,entered=0;const latch=new Promise(r=>release=r);
 const bounded=boundedDeepseekFetch(async()=>{sends++;return new Response('finite');},{maxModelCalls:1,allowedToolNames:['workspace_brain_context']});
 const disclosure={authorize:async()=>{entered++;if(entered===2)release();await latch;},assertCurrent:()=>{}};
 const one=bounded.fetch(request(),undefined,disclosure),two=bounded.fetch(request(),undefined,disclosure);
 const results=await Promise.allSettled([one,two]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sends,1);assert.equal(bounded.requests(),1);
});
test('unknown actual request retains original reserve and refuses another send',async()=>{
 let sends=0;const t=transportWith(async()=>{sends++;throw Error('finite unknown outcome');});
 await assert.rejects(t.fetchWithDisclosure(request(),undefined,hook()));
 const report=validateLocalDeepseekReport(t.report(),{modelCalls:1});assert.equal(report.actualProviderRequests,1);assert.equal(report.billingUncertain,true);
 costNear(report.chargeUpperCny,2.204096);await assert.rejects(t.fetchWithDisclosure(request(),undefined,hook()));assert.equal(sends,1);
});
test('missing or contradictory usage never becomes confirmed',async()=>{
 for(const mode of ['missing','contradictory']){
  const t=transportWith(async()=>new Response('finite'));await t.fetchWithDisclosure(request(),undefined,hook());
  if(mode==='contradictory')t.onSseEvent({data:JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20,total_tokens:999}})});
  assert.throws(()=>t.complete({role:'assistant',content:[{type:'text',text:'finite'}],stopReason:'stop',usage:{input:100,output:20,cacheRead:0,cacheWrite:0,totalTokens:120}}));
  assert.throws(()=>validateLocalDeepseekReport(t.report(),{modelCalls:1,requireConfirmed:true}));assert.equal(t.report().billingUncertain,true);
 }
});
test('report whitelist refuses extra keys, missing usage, nonfinite or inconsistent tokens/costs',async()=>{
 const valid=await confirmedReport();assert.equal(validateLocalDeepseekReport(valid,{modelCalls:1,requireConfirmed:true}).confirmedResponses,1);
 for(const mutate of [r=>r.extra='not permitted',r=>delete r.confirmedUsage,r=>r.confirmedUsage.inputTokens=Infinity,r=>r.confirmedUsage.outputTokens=-1,
  r=>r.confirmedUsage.totalTokens=1,r=>r.confirmedUsage.inputTokens=1.5,r=>r.confirmedUsageUpperCny=3,r=>r.chargeUpperCny=NaN,
  r=>r.actualProviderRequests=9,r=>r.confirmedResponses=2,r=>r.limits.maxRequests=99,r=>r.accountChargedCny=0,r=>r.stoppedReason='arbitrary error text']){
  const candidate=structuredClone(valid);mutate(candidate);assert.throws(()=>validateLocalDeepseekReport(candidate,{modelCalls:1,requireConfirmed:true}));
 }
 assert.throws(()=>validateLocalDeepseekReport(valid,{modelCalls:2,requireConfirmed:true}));
});
test('two sequential original Runs carry history and then close finite admission',async()=>{
 const a=createNativeDeepseekAcceptance(selection()),report=await confirmedReport();a.begin('run-one');assert.throws(()=>a.begin('run-concurrent'));
 const first=a.finish('run-one',{report,modelCalls:1,successful:true});assert.equal(first.status,'confirmed');costNear(first.carriedUpperCny,0.139804+report.chargeUpperCny);
 a.begin('run-two');const second=a.finish('run-two',{report,modelCalls:1,successful:true});costNear(second.carriedUpperCny,0.139804+2*report.chargeUpperCny);
 assert.throws(()=>a.begin('different-conversation-run-three'));
});
test('a stale final report with fewer actual calls cannot reduce the failed-Run reservation',async()=>{
 const report=await confirmedReport();assert.throws(()=>validateLocalDeepseekReport(report,{modelCalls:2}));
 const a=createNativeDeepseekAcceptance(selection());a.begin('run-one');const event=a.finish('run-one',{report,modelCalls:2,successful:false});
 assert.equal(event.status,'unconfirmed');assert.equal(event.report,null);assert.equal(event.reservedUpperCny,2.70);assert.throws(()=>a.begin('run-two'));
});
for(const mode of ['absent','uncertain','malformed','business-failed'])test(mode+' report prevents a second original Run',async()=>{
 const a=createNativeDeepseekAcceptance(selection());let report=null;
 if(mode==='uncertain'){const t=transportWith(async()=>{throw Error('finite');});await t.fetch(request()).catch(()=>{});report=t.report();}
 if(mode==='malformed')report={actualProviderRequests:0};
 if(mode==='business-failed')report=await confirmedReport();
 a.begin('run-one');const outcome=a.finish('run-one',{report,modelCalls:1,successful:mode!=='business-failed'});
 if(mode!=='business-failed'){assert.equal(outcome.status,'unconfirmed');assert.equal(outcome.reservedUpperCny,2.70);costNear(outcome.carriedUpperCny,2.839804);}
 assert.throws(()=>a.begin('new-native-session-run-two'));
});
test('published provider-limit violation stops without claiming a guaranteed cost upper bound',async()=>{
 const t=transportWith(async()=>new Response('finite'));await t.fetch(request());
 t.onSseEvent({data:JSON.stringify({usage:{prompt_tokens:1100001,completion_tokens:1,total_tokens:1100002}})});
 const a=createNativeDeepseekAcceptance(selection());a.begin('run-one');const event=a.finish('run-one',{report:t.report(),modelCalls:1,successful:false});
 assert.equal(event.report.chargeUpperCny,null);assert.equal(event.reservedUpperCny,2.70);assert.equal(event.carriedUpperCny,null);assert.throws(()=>a.begin('run-two'));
});
test('trusted selector rejects unknown fields, unbounded history and insufficient original allowance',()=>{
 for(const s of [null,{}, {...selection(),kind:'other'}, {...selection(),maxTurns:99}, {...selection(),historicalUpperCny:-1}, {...selection(),historicalUpperCny:Infinity}, {...selection(),historicalUpperCny:2}])assert.throws(()=>createNativeDeepseekAcceptance(s));
 const a=createNativeDeepseekAcceptance(selection());a.begin('run-one');a.finish('run-one',{report:null,modelCalls:1,successful:false});a.stop();assert.throws(()=>a.begin('run-two'));
});
test('new transport does not turn on another profile or default native paid path',async()=>{
 const native={nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true};
 const callbacks={onNativeSessionReady:async()=>{},onBusinessFactsDisclosure:async()=>{}};
 await assert.rejects(()=>createWorkspaceOmpSession({...native,...callbacks,providerTransport:{},configuration}),/requires the local factory profile/);
 await assert.rejects(()=>createWorkspaceOmpSession({...native,...callbacks,paidAcceptance:NATIVE_FACTS_PAID_ACCEPTANCE,providerTransport:{},configuration}),/NATIVE_FACTS_PAID_ACCEPTANCE_REQUIRED/);
 await assert.rejects(()=>createWorkspaceOmpSession({...native,...callbacks,paidAcceptance:NATIVE_FACTS_PAID_ACCEPTANCE,providerTransport:{fetchWithDisclosure(){}},configuration,syntheticResponses:[]}),/NATIVE_FACTS_PAID_ACCEPTANCE_REQUIRED/);
 await assert.rejects(()=>createWorkspaceOmpSession({...native,...callbacks,paidAcceptance:NATIVE_FACTS_PAID_ACCEPTANCE,providerTransport:{fetchWithDisclosure(){}},configuration:{...configuration,baseUrl:'https://other.invalid'}}),/NATIVE_FACTS_PAID_ACCEPTANCE_REQUIRED/);
});

test('terminal transport seal rejects an awaiting authorization before provider send',async()=>{
 let sends=0,release,entered;const waiting=new Promise(r=>entered=r),latch=new Promise(r=>release=r);
 const t=transportWith(async()=>{sends++;return new Response('unreachable');});
 const pending=t.fetchWithDisclosure(request(),undefined,{authorize:async()=>{entered();await latch;},assertCurrent:()=>{}});
 await waiting;t.seal();release();await assert.rejects(pending);
 assert.equal(sends,0);assert.equal(t.report().actualProviderRequests,0);
 await assert.rejects(t.fetchWithDisclosure(request(),undefined,hook()));assert.equal(sends,0);
});
