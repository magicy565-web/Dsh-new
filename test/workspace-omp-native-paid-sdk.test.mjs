// Actual pinned Bun/OMP SDK + production worker/Node fd bridge. Only provider
// HTTP is finite via Bun's documented preload option. No paid request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setup,send,mapping,messages,QUERY,STATEMENT,UNSELECTED} from './fixtures/brain-native-facts-host.mjs';
import {createWorkspaceOmpEngineAdapter,workspaceOmpPaths} from '../server/workspace-omp-bridge.mjs';
import {verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';
import {acceptanceConfiguration} from '../server/deepseek-acceptance-policy.mjs';
import {NATIVE_FACTS_PAID_ACCEPTANCE} from '../server/workspace-omp-local-deepseek.mjs';
import {decisionSetup} from './fixtures/brain-decision-input.mjs';
const options={timeout:100000},model={provider:'workspace-deepseek',id:'deepseek-flash',api:'openai-completions',baseUrl:'https://api.deepseek.com'};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const accounting=f=>f.trace.filter(e=>e.phase==='provider-accounting');
async function awaitWorkerExit(f,count=1){
 const deadline=Date.now()+5000;
 while(f.trace.filter(e=>e.phase==='exit').length<count&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.ok(f.trace.filter(e=>e.phase==='exit').length>=count,'Original worker exit must precede final provider-summary assertions');
}
async function fixture(t,{mode='control',onDisclosure=null,onLifecycle=null}={}){
 const originalPaths=workspaceOmpPaths(process.env);await verifyWorkspaceOmpRuntime(originalPaths);
 const directory=await fs.mkdtemp('/tmp/native-paid-provider-'),configFile=path.join(directory,'finite.json'),reportFile=path.join(directory,'summary.json'),wrapper=path.join(directory,'bun-finite');
 const preload=fileURLToPath(new URL('./fixtures/native-paid-provider-preload.mjs',import.meta.url));
 await fs.writeFile(wrapper,'#!/bin/sh\nexport WORKSPACE_NATIVE_PAID_FIXTURE='+quote(configFile)+'\nexec '+quote(originalPaths.bun)+' --no-install --preload '+quote(preload)+' "$@"\n',{mode:0o700});
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const f=await setup(t,{model,onDisclosure,onLifecycle,engineFactory:args=>createWorkspaceOmpEngineAdapter({...args,paths:{...originalPaths,bun:wrapper},
  configuration:acceptanceConfiguration({DEEPSEEK_API_KEY:'synthetic-unused-offline'}),syntheticResponses:null,
  paidAcceptance:{kind:NATIVE_FACTS_PAID_ACCEPTANCE,historicalUpperCny:0.139804}})});
 const writeFixture=async turn=>fs.writeFile(configFile,JSON.stringify({mode,turn,goalId:f.goal.id,inputs:decisionSetup(f.goal.id,[]),statement:STATEMENT,unselected:UNSELECTED,reportFile}),{mode:0o600});
 await writeFixture(1);return Object.assign(f,{writeFixture,readProvider:async()=>JSON.parse(await fs.readFile(reportFile,'utf8'))});
}
function assertOrder(trace){const p=['sdk-ready','bound','saved'].map(k=>trace.findIndex(x=>x.phase===k));const request=trace.findIndex(x=>x.phase==='host-event'&&x.event==='pi.agent-session.request');assert.ok(p[0]>=0&&p[0]<p[1]&&p[1]<p[2]&&p[2]<request);}
async function changedDocument(f){await f.app.businessLibrary.updateDocument(f.document.id,{requestId:randomUUID(),expectedRevision:f.document.revision,changes:{title:'Changed ordinary synthetic dependency'}},f.actor);}

test('paid selector finite SDK worker binds before send and keeps two-Run native facts, drafts and accounting',options,async t=>{
 const f=await fixture(t),goals=structuredClone(f.app.store.read().goals);
 const first=await send(f,[]);assert.equal(first.status,'succeeded',JSON.stringify(first));assertOrder(f.trace);const firstMapping={...mapping(f)},offset=f.trace.length;
 const one=await f.readProvider();assert.equal(one.externalModelRequests,0);assert.equal(one.requests.length,4);assert.ok(one.requests[2].bodyWithFact);
 await f.writeFixture(2);const second=await send(f,[]);assert.equal(second.status,'succeeded',JSON.stringify(second));assertOrder(f.trace.slice(offset));
 assert.deepEqual(mapping(f),firstMapping);assert.deepEqual(f.app.store.read().goals,goals);assert.deepEqual(second.executionRefs||[],[]);
 const two=await f.readProvider();assert.equal(two.externalModelRequests,0);assert.equal(two.requests.length,4);assert.ok(two.requests.every(r=>r.normalized));
 const events=accounting(f);assert.equal(events.length,2);for(const e of events){assert.equal(e.status,'confirmed');assert.equal(e.report.actualProviderRequests,4);assert.equal(e.report.confirmedResponses,4);assert.equal(e.report.billingUncertain,false);}
 assert.ok(Math.abs(events[1].carriedUpperCny-(0.139804+events[0].report.chargeUpperCny+events[1].report.chargeUpperCny))<1e-10);
 const receipts=(await messages(f)).filter(m=>m.role==='toolResult'),decision=receipts.findLast(m=>m.toolName==='workspace_brain_decision_save');
 assert.equal(decision.details.persisted,true);assert.equal(decision.details.humanReviewed,false);assert.equal(decision.details.executable,false);assert.equal(decision.details.data.decision.payload.goalId,f.goal.id);
 assert.equal(decision.details.data.decision.revision,2);assert.equal(decision.details.data.decision.payload.contextRevision,1);
 assert.equal(receipts.filter(m=>m.toolName==='workspace_brain_context_save').length,1);
 const reread=receipts.findLast(m=>m.toolName==='workspace_brain_context');assert.equal(reread.details.recordRef.recordRevision,1);
 assert.equal(reread.details.data.sources[0].values.statement,STATEMENT);
 const third=await send(f,[]);assert.equal(third.status,'failed');assert.equal(accounting(f).length,2);assert.equal(f.state.parserCalls,0);
});
for(const mode of ['dependency','receiver','cancel'])test('final normalized wire original Node gate refuses '+mode+' before finite provider disclosure',options,async t=>{
 let changed=false;const f=await fixture(t,{onDisclosure:async({f,payload,receiver})=>{
  if(changed||!payload.wireBody?.includes(STATEMENT))return;changed=true;
  const b=JSON.parse(payload.wireBody);assert.deepEqual(b.thinking,{type:'disabled'});assert.ok(b.max_tokens<=512);
  if(mode==='dependency')await changedDocument(f);
  if(mode==='receiver')receiver.id='unselected-receiver';
  if(mode==='cancel'){const r=await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}});assert.equal(r.status,200,r.text);}
 }});
 const run=await send(f,[]);assert.equal(changed,true);assert.equal(run.status,mode==='cancel'?'cancelled':'failed',JSON.stringify(run));
 await awaitWorkerExit(f);const summary=await f.readProvider();assert.equal(summary.externalModelRequests,0);assert.equal(summary.requests.length,2);assert.ok(summary.requests.every(r=>!r.bodyWithFact));
 assert.equal(f.app.store.read().messages.some(m=>m.runId===run.id&&m.role==='assistant'&&m.status==='complete'),false);
 for(let i=0;i<500&&!accounting(f).length;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(accounting(f).length,1);const settlement=accounting(f)[0];
 // Cancellation races the HTTP response against worker accounting. A full
 // 2/2 report can establish the known charge; an incomplete terminal exchange
 // must retain the full reserve. Neither state authorizes a third send/retry.
 if(mode==='cancel'&&settlement.status==='unconfirmed'){assert.equal(settlement.report,null);assert.equal(settlement.reservedUpperCny,2.70);}
 else {assert.equal(settlement.status,'confirmed');assert.equal(settlement.report.actualProviderRequests,2);assert.equal(settlement.report.confirmedResponses,2);assert.equal(settlement.report.billingUncertain,false);assert.equal(settlement.reservedUpperCny,settlement.report.chargeUpperCny);}
 if(mode==='dependency'){
  // The exact reviewed document revision changed. Original Host admission must
  // reject before creating another Run, rather than reaching paid admission.
  const runCount=f.app.store.read().runs.length;
  const refused=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content:'Use only the explicitly selected synthetic fact; keep conclusions unreviewed.',requestId:randomUUID(),workspaceExecution:false,inputContext:{artifacts:[],skills:[],memoryIds:[],connectorActions:[]}}});
  assert.equal(refused.status,409,refused.text);assert.equal(refused.json.error.code,'FACTORY_DOCUMENT_REVISION_CHANGED');
  assert.equal(f.app.store.read().runs.length,runCount);
 }else {const retry=await send(f,[]);assert.equal(retry.status,'failed');}
 assert.equal(accounting(f).length,1);assert.deepEqual(await f.readProvider(),summary);
});
for(const mode of ['no-usage','crash-no-report','late-model-request','duplicate-accounting','error-then-late-dispatch','error-then-late-accounting'])test('production fd/transport '+mode+' reserves uncertainty and cannot start a second Run',options,async t=>{
 const f=await fixture(t,{mode});const first=await send(f,[]);assert.equal(first.status,'failed',JSON.stringify(first));
 const events=accounting(f);assert.equal(events.length,1);assert.equal(events[0].status,'unconfirmed');assert.equal(events[0].reservedUpperCny,2.70);
 if(mode!=='no-usage')assert.equal(events[0].report,null);
 await awaitWorkerExit(f);const summary=await f.readProvider();assert.equal(summary.externalModelRequests,0);assert.equal(summary.requests.length,1);
 const second=await send(f,[]);assert.equal(second.status,'failed');assert.equal(accounting(f).length,1);assert.equal((await f.readProvider()).requests.length,1);
});
test('paid two-Run adapter does not authorize changing the initial exact fact selection',options,async t=>{
 const f=await fixture(t);const first=await send(f,[]);assert.equal(first.status,'succeeded',JSON.stringify(first));const original={...mapping(f)};
 f.state.keys=[{...QUERY,factKey:'unselected'}];const second=await send(f,[]);assert.equal(second.status,'failed');assert.deepEqual(mapping(f),original);
 const events=accounting(f);assert.equal(events.length,2);assert.equal(events[1].status,'confirmed');assert.equal(events[1].report.actualProviderRequests,0);assert.equal(events[1].report.confirmedResponses,0);assert.equal(events[1].reservedUpperCny,0);assert.equal((await f.readProvider()).requests.length,4);
});

for(const mode of ['post-report-final-wire','lost-dispatch','late-dispatch','duplicate-dispatch','out-of-order-dispatch'])test('terminal fd accounting refuses '+mode+' without trusting an incomplete dispatch count',options,async t=>{
 const f=await fixture(t,{mode});const first=await send(f,[]);assert.equal(first.status,'failed',JSON.stringify(first));
 const events=accounting(f);assert.equal(events.length,1);assert.equal(events[0].status,'unconfirmed');assert.equal(events[0].report,null);assert.equal(events[0].reservedUpperCny,2.70);
 await awaitWorkerExit(f);const summary=await f.readProvider();assert.equal(summary.externalModelRequests,0);assert.ok(summary.injected);
 if(mode==='post-report-final-wire')assert.equal(summary.requests.length,0);
 else {assert.ok(summary.requests.length<=1);assert.ok(summary.requests.every(r=>!r.bodyWithFact));}
 assert.equal(f.app.store.read().messages.some(m=>m.runId===first.id&&m.role==='assistant'&&m.status==='complete'),false);
 const second=await send(f,[]);assert.equal(second.status,'failed');assert.equal(accounting(f).length,1);assert.deepEqual(await f.readProvider(),summary);
});
