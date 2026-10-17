// Original signed Host, Store, Library/Artifact, WorkerDesk, fd3 and pinned SDK.
// Business identities/reviewed scopes/Worker/model are explicit local stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {nativeMarketplace,sendMarketplace,resetBusiness,tool,mapping,journal,buyerActor,RECIPIENT,appendLateUsage} from './fixtures/marketplace-native.mjs';
import {decisionSetup} from './fixtures/brain-decision-input.mjs';
import {readBusinessContext} from '../server/workspace-omp-business-journal.mjs';
const call=(name,arguments_={})=>({tool:name,arguments:arguments_});
const order=f=>f.app.store.read().workerOrders.find(x=>x.requestId.startsWith('mp-'));
const requests=run=>run.events.filter(e=>e.type==='pi.agent-session.request').length;

test('one original business Session reads product, saves decision, discovers Worker, drafts, queries and explicitly continues after legal status change',{timeout:90000},async t=>{
 let foreignProbe=false,foreignRejected=false;
 const f=await nativeMarketplace(t,{productOptions:{brainGoal:true,policy:p=>({...p,products:p.factoryMaterials.products,productFields:['name','description']})},wrapEngineAdapter:engine=>({scope:engine.scope,complete:async args=>{
  if(foreignProbe){const bad=f.marketplaceHost.bind({identity:{...f.actor,workspaceId:'foreign-enterprise',sessionId:args.run.businessAgentContext.sessionId},conversationId:f.cid,runId:args.run.id,recipient:RECIPIENT,authorize:async()=>{}});
   await assert.rejects(bad.order({orderId:order(f).id},args.input.signal,args.binding.model),e=>e.code==='MARKETPLACE_SCOPE_REQUIRED');foreignRejected=true;}
  return engine.complete(args);
 }})});
 const catalog=await f.workspace(`/api/conversations/${f.cid}/brain/sources`,{subject:f.actor.subject});assert.equal(catalog.status,200,catalog.text);
 const input=decisionSetup(f.goal.id,catalog.json.data.sourceRefs);
 const first=await sendMarketplace(f,[call('workspace_shopify_product_read',{productId:f.product.id}),call('workspace_brain_context_save',input.context),call('workspace_brain_decision_save',input.first),{text:'PRE_RESET_PRIVATE_SYNTHETIC_NOTE'}]);assert.equal(first.status,'succeeded',JSON.stringify(first));
 const original=mapping(f);
 const prepared=await sendMarketplace(f,[tool('find'),tool('propose',f.proposal),{text:'Internal unconfirmed draft.'}]);assert.equal(prepared.status,'succeeded',JSON.stringify(prepared));
 const id=order(f).id;
 const second=await sendMarketplace(f,[tool('order',{orderId:id}),{text:'Original reviewed draft status.'}]);assert.equal(second.status,'succeeded',JSON.stringify(second));
 assert.equal(mapping(f).agentSessionId,original.agentSessionId);
 await f.marketplace.cancel({...buyerActor(f),human:true},id);assert.equal(order(f).status,'cancelled');
 const stale=await sendMarketplace(f,[{text:'Must not reach a model.'}]);assert.equal(stale.status,'failed');assert.equal(requests(stale),0);assert.equal(stale.error.code,'OMP_CONTEXT_REFRESH_REQUIRED',JSON.stringify(stale.error));
 const before=await fs.readFile(original.sessionFile);
 const clearBody={operation:'resetContext',confirmed:true,requestId:randomUUID()};
 const cleared=await resetBusiness(f,clearBody);assert.equal(cleared.status,'succeeded',JSON.stringify(cleared));assert.equal(requests(cleared),0);assert.equal(cleared.usage.completionTokens,0);
 assert.equal((await resetBusiness(f,clearBody)).id,cleared.id,'Exact human-control retry returns the original Run without clearing again');
 f.advanceReviewMinute();const alias=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content:f.app.store.read().messages.find(m=>m.requestId===clearBody.requestId&&m.role==='user').content,requestId:clearBody.requestId,workspaceExecution:false}});assert.equal(alias.status,409,alias.text);
 assert.equal(mapping(f).agentSessionId,original.agentSessionId);assert.equal(mapping(f).sessionFile,original.sessionFile);
 const after=await fs.readFile(original.sessionFile);assert.deepEqual(after.subarray(0,before.length),before,'Original journal/proofs are never rewritten');
 assert.equal((await journal(f)).filter(e=>e.type==='reset_boundary').length,1);
 assert.equal((await readBusinessContext(await journal(f))).length,0,'The SDK context boundary contains no old model message');
 foreignProbe=true;
 const continued=await sendMarketplace(f,[{...call('workspace_shopify_product_read',{productId:f.product.id}),forbiddenContextText:'PRE_RESET_PRIVATE_SYNTHETIC_NOTE'},call('workspace_brain_decision',{id:'synthetic-case'}),tool('order',{orderId:id}),{text:'Current cancelled state reread with unchanged authority.',expectedContextText:'cancelled',forbiddenContextText:'PRE_RESET_PRIVATE_SYNTHETIC_NOTE'}]);assert.equal(continued.status,'succeeded',JSON.stringify(continued));assert.equal(foreignRejected,true);
 assert.equal(mapping(f).agentSessionId,original.agentSessionId);assert.equal(f.app.store.read().artifacts.filter(a=>a.metadata?.businessBrain?.key==='decision:synthetic-case').length,1);
 assert.deepEqual(f.remoteMarketplace.stats,{submits:0,checkouts:0,transfers:0,refunds:0});assert.equal(f.remote.calls.length,0);
 console.log(JSON.stringify({scenario:'combined-business-reset',sameNativeSession:true,journalPrefixUnchanged:true,resetModelRequests:requests(cleared),currentStatus:order(f).status,crossEnterpriseRejected:foreignRejected,commercialActions:f.remoteMarketplace.stats}));
});

test('reset is an explicit original human control; model/message flags and another owner cannot invoke it',{timeout:45000},async t=>{
 const f=await nativeMarketplace(t);
 const runtime=await f.workspace('/api/conversations/runtime',{subject:f.actor.subject});assert.equal(runtime.json.contextReset,'confirmed-original-human-control');
 const empty=await f.workspace(`/api/conversations/${f.cid}/terminal-controls`,{subject:f.actor.subject,body:{operation:'resetContext',confirmed:true,requestId:randomUUID()}});assert.equal(empty.status,409,empty.text);
 assert.equal((await sendMarketplace(f,[tool('status'),{text:'Configured.'}])).status,'succeeded');
 for(const body of [{operation:'resetContext',confirmed:false,requestId:randomUUID()},{operation:'resetContext',confirmed:true,requestId:randomUUID(),fields:['objective']}]){
  const r=await f.workspace(`/api/conversations/${f.cid}/terminal-controls`,{subject:f.actor.subject,body});assert.equal(r.status,400,r.text);
 }
 const foreign=await f.workspace(`/api/conversations/${f.cid}/terminal-controls`,{subject:'member-b',body:{operation:'resetContext',confirmed:true,requestId:randomUUID()}});assert.equal(foreign.status,404,foreign.text);
 const flag=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content:'Reset please',resetContext:true,requestId:randomUUID()}});assert.equal(flag.status,400,flag.text);
 assert.equal((await journal(f)).some(e=>e.type==='reset_boundary'),false);
});

test('clearing context cannot restore withdrawn Marketplace authority or disclose old private data',{timeout:45000},async t=>{
 const f=await nativeMarketplace(t);assert.equal((await sendMarketplace(f,[tool('propose',f.proposal),{text:'PRIVATE_BEFORE_SCOPE_WITHDRAWAL'}])).status,'succeeded');const id=order(f).id;
 f.controls.granted=false;
 const blocked=await sendMarketplace(f,[{text:'Forbidden old context.'}]);assert.equal(blocked.status,'failed');assert.equal(requests(blocked),0);
 assert.equal((await resetBusiness(f)).status,'succeeded');
 const next=await sendMarketplace(f,[{...tool('order',{orderId:id}),forbiddenContextText:'PRIVATE_BEFORE_SCOPE_WITHDRAWAL'},{text:'Original authority is unconfigured.',expectedContextText:'MARKETPLACE_UNCONFIGURED',forbiddenContextText:'PRIVATE_BEFORE_SCOPE_WITHDRAWAL'}]);assert.equal(next.status,'succeeded',JSON.stringify(next));
 const result=(await readBusinessContext(await journal(f))).findLast(m=>m.toolName==='workspace_marketplace_order');
 assert.equal(result.isError,true);assert.equal(result.details.status,'unconfigured');assert.equal(result.details.view,undefined);
 assert.deepEqual(f.remoteMarketplace.stats,{submits:0,checkouts:0,transfers:0,refunds:0});
});

test('disabled required plugin cannot be bypassed by a human context reset',{timeout:45000},async t=>{
 const pluginConfiguration={},f=await nativeMarketplace(t,{pluginConfiguration});assert.equal((await sendMarketplace(f,[tool('find'),{text:'Published Worker.'}])).status,'succeeded');
 const before=await fs.readFile(mapping(f).sessionFile);pluginConfiguration.disabled=['workspace-marketplace'];
 const run=await resetBusiness(f);assert.equal(run.status,'failed');assert.equal(requests(run),0);assert.deepEqual((await fs.readFile(mapping(f).sessionFile)).subarray(0,before.length),before);assert.equal((await journal(f)).some(e=>e.type==='reset_boundary'),false);
});

test('original Run cancellation after reset boundary still withholds completion',{timeout:45000},async t=>{
 let armed=false,exited=false,f;
 f=await nativeMarketplace(t,{onWorkerLifecycle:e=>{if(armed&&e.phase==='exit'&&e.code===0)exited=true;},wrapEngineAdapter:engine=>({scope:engine.scope,complete:args=>engine.complete({...args,authorize:async()=>{if(exited){exited=false;await f.app.runtime.cancelConversation(f.cid);}await args.authorize();}})})});
 assert.equal((await sendMarketplace(f,[tool('status'),{text:'Original Session.'}])).status,'succeeded');armed=true;
 const run=await resetBusiness(f);assert.equal(run.status,'cancelled',JSON.stringify(run));assert.equal(requests(run),0);assert.equal((await journal(f)).some(e=>e.type==='reset_boundary'),true,'Cancellation does not fabricate rollback of a committed context boundary');
});

test('reset cannot race an active original Run',{timeout:45000},async t=>{
 const f=await nativeMarketplace(t);assert.equal((await sendMarketplace(f,[tool('status'),{text:'Original Session.'}])).status,'succeeded');
 const pending=sendMarketplace(f,[{wait:5000,text:'Wait for cancellation.'}]);
 for(let i=0;i<300&&!f.app.store.read().runs.some(r=>r.status==='running');i++)await new Promise(resolve=>setTimeout(resolve,20));
 const r=await f.workspace(`/api/conversations/${f.cid}/terminal-controls`,{subject:f.actor.subject,body:{operation:'resetContext',confirmed:true,requestId:randomUUID()}});assert.equal(r.status,409,r.text);
 assert.equal((await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}})).status,200);assert.equal((await pending).status,'cancelled');
});

test('original Node final validation retains current receipt after SDK late usage selects an earlier parent',{timeout:60000},async t=>{
 let armed=false,exited=false,injected=false,hostSourceRefusal=false,f;
 f=await nativeMarketplace(t,{onWorkerLifecycle:e=>{if(armed&&e.phase==='exit'&&e.code===0)exited=true;},wrapEngineAdapter:engine=>({scope:engine.scope,complete:args=>engine.complete({...args,marketplaceClient:{...args.marketplaceClient,revalidateReceipt:async(...values)=>{try{return await args.marketplaceClient.revalidateReceipt(...values);}catch(error){if(injected&&error.code==='MARKETPLACE_SOURCE_CHANGED')hostSourceRefusal=true;throw error;}}},authorize:async()=>{
  if(exited&&!injected){injected=true;await appendLateUsage(f);await f.app.store.update(state=>{state.workerOrders.find(o=>o.id===order(f).id).objective='Source changed at Node boundary after native late usage';});}
  await args.authorize();
 }})})});
 assert.equal((await sendMarketplace(f,[tool('propose',f.proposal),{text:'Original draft.'}])).status,'succeeded');
 assert.equal((await resetBusiness(f)).status,'succeeded');
 assert.equal((await sendMarketplace(f,[tool('order',{orderId:order(f).id}),{text:'Current original status.'}])).status,'succeeded');
 armed=true;const run=await sendMarketplace(f,[{text:'Must be withheld at final Node boundary.'}]);assert.equal(injected,true);assert.equal(run.status,'failed');assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');assert.equal(hostSourceRefusal,true,'The original Host must revalidate and reject the current B source');assert.deepEqual(f.remoteMarketplace.stats,{submits:0,checkouts:0,transfers:0,refunds:0});
});
