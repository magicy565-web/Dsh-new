// New initial fact selection and ordinary native lifecycle only. No receipt
// restoration/compaction/forgery/migration test and no external provider call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,send,wireTurn,mapping,messages,tool,MODEL,QUERY,STATEMENT,UNSELECTED} from './fixtures/brain-native-facts-host.mjs';
import {decisionSetup} from './fixtures/brain-decision-input.mjs';
const options={timeout:90000};
const requests=run=>run.events.filter(e=>e.type==='pi.agent-session.request').length;
async function catalog(f){const run=await send(f,[tool('workspace_brain_sources'),{text:'Selected source references obtained.',forbiddenContextText:UNSELECTED}]);assert.equal(run.status,'succeeded',JSON.stringify(run));return (await messages(f)).findLast(m=>m.toolName==='workspace_brain_sources').details;}
function order(trace){const positions=['sdk-ready','bound','saved'].map(phase=>trace.findIndex(e=>e.phase===phase));const request=trace.findIndex(e=>e.phase==='host-event'&&e.event==='pi.agent-session.request');assert.ok(positions.every(x=>x>=0));assert.ok(positions[0]<positions[1]&&positions[1]<positions[2]&&positions[2]<request);}
async function changeDocument(f){await f.app.businessLibrary.updateDocument(f.document.id,{requestId:randomUUID(),expectedRevision:f.document.revision,changes:{title:'Changed synthetic dependency'}},f.actor);}

test('actual SDK ID binds Node facts before save/model; ordinary second turn saves Context and Decision against the existing Goal',options,async t=>{
 const f=await setup(t),goals=structuredClone(f.app.store.read().goals),first=await catalog(f),original={...mapping(f)};
 order(f.trace);assert.match(original.brainMemoryFactsScopeHash,/^[a-f0-9]{64}$/);
 const refs=first.data.sourceRefs.filter(r=>r.kind==='memory-fact');assert.equal(refs.length,1);assert.equal(first.data.goalIds.includes(f.goal.id),true);
 const inputs=decisionSetup(f.goal.id,refs),offset=f.trace.length;
 const second=await send(f,[tool('workspace_brain_context_save',inputs.context),tool('workspace_brain_decision_save',inputs.first),{text:'SYNTHETIC source-backed draft saved for owner review.',expectedContextText:STATEMENT,forbiddenContextText:UNSELECTED}]);
 assert.equal(second.status,'succeeded',JSON.stringify(second));assert.equal(requests(second),3);order(f.trace.slice(offset));
 assert.deepEqual(mapping(f),original);assert.deepEqual(f.app.store.read().goals,goals);assert.deepEqual(second.executionRefs||[],[]);
 const receipts=(await messages(f)).filter(m=>m.role==='toolResult');const context=receipts.findLast(m=>m.toolName==='workspace_brain_context_save'),decision=receipts.findLast(m=>m.toolName==='workspace_brain_decision_save');
 assert.equal(context.details.persisted,true);assert.equal(context.details.data.sources[0].values.statement,STATEMENT);
 assert.equal(context.details.data.sources[0].values.source.dependencies[0].sha256,f.asset.sha256);
 assert.equal(decision.details.persisted,true);assert.equal(decision.details.data.decision.payload.goalId,f.goal.id);assert.equal(decision.details.executable,false);assert.equal(decision.details.humanReviewed,false);
 assert.ok(receipts.every(m=>!m.toolName.startsWith('workspace_enterprise_context_')));assert.doesNotMatch(JSON.stringify(receipts),/synthetic-only-docling-screen-value|credentialScreening|SYNTHETIC_UNSELECTED/);
 for(const e of f.trace.filter(e=>['disclose','final-check'].includes(e.phase)))assert.deepEqual(e.receiver,{provider:MODEL.provider,id:MODEL.id,baseUrl:MODEL.baseUrl});
 assert.equal(new Set(f.trace.filter(e=>e.phase==='bound').map(e=>e.scopeHash)).size,1);assert.equal(new Set(f.trace.filter(e=>e.nativeSessionId).map(e=>e.nativeSessionId)).size,1);assert.equal(f.state.parserCalls,0);
});

test('no fact selection keeps the original native default mapping and tool path',options,async t=>{
 const f=await setup(t,{facts:false}),receipt=await catalog(f);assert.equal(mapping(f).brainMemoryFactsScopeHash,undefined);assert.ok(receipt.data.sourceRefs.every(r=>r.kind!=='memory-fact'));
 assert.equal(f.trace.some(e=>['sdk-ready','bound','disclose','final-check'].includes(e.phase)),false);assert.equal(f.state.parserCalls,0);
});

for(const mode of ['added','removed','changed'])test('initial trusted selection cannot be '+mode+' on the same native Session',options,async t=>{
 const f=await setup(t,{facts:mode!=='added'});await catalog(f);const original={...mapping(f)},offset=f.trace.length;
 if(mode==='added')f.state.facts=true;if(mode==='removed')f.state.facts=false;if(mode==='changed')f.state.keys=[{...QUERY,factKey:'unselected'}];
 const run=await send(f,[{text:'MUST_NOT_REACH_FINITE_MODEL'}]);assert.equal(run.status,'failed');assert.equal(requests(run),0);assert.deepEqual(mapping(f),original);
 assert.equal(f.trace.slice(offset).some(e=>e.phase==='host-event'&&e.event==='pi.agent-session.request'),false);
});

test('original allowMemoryRead=false rejects before native save and first request',options,async t=>{
 const f=await setup(t,{allowMemoryRead:false}),run=await send(f,[tool('workspace_brain_sources'),{text:'MUST_NOT_DISCLOSE'}]);assert.equal(run.status,'failed');assert.equal(requests(run),0);assert.equal(mapping(f),undefined);
 assert.equal(f.trace.some(e=>e.phase==='bound'||e.phase==='saved'),false);
});

test('ordinary dependency change at model disclosure withholds the answer',options,async t=>{
 let checks=0,changed=false;const f=await setup(t,{onDisclosure:async({f})=>{if(++checks===2){await changeDocument(f);changed=true;}}});
 const run=await send(f,[tool('workspace_brain_sources'),{text:'MUST_NOT_DISCLOSE_STALE_FACT'}]);assert.equal(changed,true);assert.equal(run.status,'failed');
 assert.ok(!(await messages(f)).some(m=>m.role==='assistant'&&m.content?.some(b=>b.text==='MUST_NOT_DISCLOSE_STALE_FACT')));assert.equal(f.state.parserCalls,0);
});

test('Node final current check withholds output after a normal dependency change',options,async t=>{
 let changed=false;const f=await setup(t,{onFinalCheck:async({f})=>{await changeDocument(f);changed=true;}});
 const run=await send(f,[tool('workspace_brain_sources'),{text:'UNDELIVERED_FINAL_SYNTHETIC_ANSWER'}]);assert.equal(changed,true);assert.equal(run.status,'failed');assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');
 const reply=f.app.store.read().messages.find(m=>m.runId===run.id&&m.role==='assistant'&&m.status==='complete');assert.equal(reply,undefined);
});

test('cancelling the original active Run stops the same native fact Session without delivery',options,async t=>{
 const f=await setup(t);const pending=send(f,[tool('workspace_brain_sources'),{wait:8000,text:'MUST_NOT_DELIVER_CANCELLED_FACT'}]);
 for(let i=0;i<2500&&!f.trace.some(e=>e.phase==='nativeModelWaiting');i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(f.trace.some(e=>e.phase==='nativeModelWaiting'),true);
 const c=await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}});assert.equal(c.status,200,c.text);
 const run=await pending;assert.equal(run.status,'cancelled');assert.deepEqual(run.executionRefs||[],[]);assert.equal(f.trace.some(e=>e.phase==='final-check'),false);
});

for(const mode of ['control','dependency','cancel'])test('fresh official SDK finite SSE exercises actual wire gate: '+mode,options,async t=>{
 const f=await setup(t,{engineComplete:(args,context)=>wireTurn(args,context,mode)});
 const run=await send(f,[]);assert.equal(run.status,mode==='control'?'succeeded':mode==='cancel'?'cancelled':'failed',JSON.stringify(run));
 for(let i=0;i<3000&&!f.state.wireSummary;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(f.state.wireSummary,'Original cancelled provider must finish its finite SDK fixture.');
 assert.equal(f.state.wireSummary.actualSdk,true);assert.equal(f.state.wireSummary.externalModelRequests,0);assert.equal(f.state.wireSummary.wireChecks,3);
 assert.equal(f.state.wireSummary.changed,mode!=='control');assert.equal(f.state.wireSummary.modelFetches,mode==='control'?3:2);
 assert.equal(f.state.parserCalls,0);
});
