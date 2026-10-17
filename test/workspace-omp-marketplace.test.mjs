import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {nativeMarketplace,sendMarketplace,tool,journal,mapping} from './fixtures/marketplace-native.mjs';

test('original signed Host/Store/WorkerDesk two native Session rounds discover, draft, exact retry and private status',{timeout:60000},async t=>{
 const f=await nativeMarketplace(t);f.proposal.requestId=' native-proposal '; // Original API normalizes bounded request text.
 const first=await sendMarketplace(f,[tool('find'),tool('propose',f.proposal),{text:'Internal unconfirmed draft only.'}]);assert.equal(first.status,'succeeded',JSON.stringify(first));
 const original=mapping(f),before=await fs.readFile(original.sessionFile),orders=f.app.store.read().workerOrders;assert.equal(orders.length,1);assert.equal(orders[0].status,'draft');
 const second=await sendMarketplace(f,[tool('find'),tool('propose',f.proposal),tool('order',{orderId:orders[0].id}),{text:'Original local draft remains unapproved.'}]);assert.equal(second.status,'succeeded',JSON.stringify(second));assert.equal(mapping(f).agentSessionId,original.agentSessionId);
 assert.equal((f.app.store.read().workerOrders||[]).length,1);assert.equal(f.app.store.read().marketplace.contracts.length,1);assert.equal(f.app.store.read().marketplace.contracts[0].consent,null);
 assert.deepEqual((await fs.readFile(original.sessionFile)).subarray(0,before.length),before);
 const receipts=(await journal(f)).filter(e=>e.message?.toolName?.startsWith('workspace_marketplace_')).map(e=>e.message);assert.ok(receipts.every(x=>!x.isError),JSON.stringify(receipts));assert.equal(receipts.at(-1).details.view.status,'draft');
 assert.deepEqual(f.remoteMarketplace.stats,{submits:0,checkouts:0,transfers:0,refunds:0});
});

async function seed(f){const run=await sendMarketplace(f,[tool('find'),tool('propose',f.proposal),{text:'Local unconfirmed draft.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));return f.app.store.read().workerOrders[0];}
for(const change of ['grant','fields','source','disabled','purpose','expiry','listing'])test('native Marketplace restored proof refuses '+change+' before another model request',{timeout:45000},async t=>{
 const pluginConfiguration={},f=await nativeMarketplace(t,{pluginConfiguration});const order=await seed(f);
 if(change==='grant')f.controls.granted=false;
 if(change==='fields')f.controls.fields=['orderId','status'];
 if(change==='purpose')f.controls.purpose='unreviewed-other-purpose';
 if(change==='expiry')f.controls.expiresAt='2000-01-01T00:00:00Z';
 if(change==='listing')await f.marketplace.unpublish(f.providerActor,{id:f.listing.id,revision:f.listing.revision});
 if(change==='source')await f.app.store.update(s=>{s.workerOrders.find(x=>x.id===order.id).objective='Changed original private body';});
 if(change==='disabled')pluginConfiguration.disabled=['workspace-marketplace'];
 const run=await sendMarketplace(f,[{text:'Must not reach model.'}]);assert.equal(run.status,'failed');assert.equal(run.events.filter(e=>e.type==='pi.agent-session.request').length,0);assert.equal(f.remoteMarketplace.stats.submits,0);
});
test('missing Host scope is unconfigured; public discovery does not grant private status or draft rights even with execution intent',{timeout:60000},async t=>{
 const f=await nativeMarketplace(t,{configured:false});
 assert.equal((await sendMarketplace(f,[tool('status'),{text:'Explicitly unconfigured.'}])).status,'succeeded');
 let results=(await journal(f)).filter(e=>e.message?.toolName==='workspace_marketplace_status');assert.equal(results[0].message.details.status,'unconfigured');
 const g=await nativeMarketplace(t);g.controls.allowDrafts=false;g.controls.allowOwnedOrderStatus=false;g.controls.fields=[];
 const created=await g.marketplace.createOrder({kind:'buyer',...g.actor,human:true},{...g.proposal,objective:'UNSELECTED_PRIVATE_BODY',requestId:'human-seeded-only'});
 const run=await sendMarketplace(g,[tool('find'),tool('order',{orderId:created.id}),tool('propose',g.proposal),{text:'Discovery never approves private access or execution.'}],{execution:true});assert.equal(run.status,'succeeded',JSON.stringify(run));
 results=(await journal(g)).filter(e=>e.message?.toolName?.startsWith('workspace_marketplace_')).map(e=>e.message.details);assert.equal(results[0].status,'available');assert.equal(results[1].code,'MARKETPLACE_SCOPE_REQUIRED');assert.equal(results[2].code,'MARKETPLACE_SCOPE_REQUIRED');assert.ok(!JSON.stringify(results).includes('UNSELECTED_PRIVATE_BODY'));assert.equal(g.app.store.read().workerOrders.length,1);
});
test('another buyer order and foreign enterprise identity cannot inherit discovery or private owner access',{timeout:45000},async t=>{
 const {MODEL}=await import('./fixtures/shopify-product.mjs');const {RECIPIENT}=await import('./fixtures/marketplace-native.mjs');let f,verified=false;
 const wrapEngineAdapter=engine=>({scope:engine.scope,complete:async args=>{
  const bad=f.marketplaceHost.bind({identity:{...f.actor,workspaceId:'foreign-enterprise',sessionId:args.run.businessAgentContext.sessionId},conversationId:f.cid,runId:args.run.id,recipient:RECIPIENT,authorize:async()=>{}});
  await assert.rejects(bad.order({orderId:f.foreignOrder.id},args.input.signal,MODEL),e=>e.code==='MARKETPLACE_SCOPE_REQUIRED');verified=true;return engine.complete(args);
 }});
 f=await nativeMarketplace(t,{wrapEngineAdapter});f.foreignOrder=await f.marketplace.createOrder({kind:'buyer',subject:'member-b',workspaceId:f.actor.workspaceId,role:'operator',human:false},{...f.proposal,objective:'OTHER_BUYER_PRIVATE_BODY',requestId:'another-buyer'});
 const run=await sendMarketplace(f,[tool('find'),tool('order',{orderId:f.foreignOrder.id}),{text:'No other buyer context.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(verified,true);
 const details=(await journal(f)).find(e=>e.message?.toolName==='workspace_marketplace_order').message.details;assert.equal(details.status,'blocked');assert.ok(!JSON.stringify(details).includes('OTHER_BUYER_PRIVATE_BODY'));
});
test('unknown draft acknowledgement retries the original request without a new WorkerDesk order',{timeout:60000},async t=>{
 const f=await nativeMarketplace(t),update=f.app.store.update;let lost=false;
 f.app.store.update=async callback=>{const before=(f.app.store.read().workerOrders||[]).length,result=await update(callback);if(!lost&&before===0&&(f.app.store.read().workerOrders||[]).length===1){lost=true;throw Error('Synthetic post-commit acknowledgement loss');}return result;};
 const first=await sendMarketplace(f,[tool('propose',f.proposal),{text:'Unknown write outcome, use exact request.'}]);assert.equal(first.status,'succeeded',JSON.stringify(first));assert.equal((f.app.store.read().workerOrders||[]).length,1);
 const receipt=(await journal(f)).find(e=>e.message?.toolName==='workspace_marketplace_propose').message.details;assert.equal(receipt.writeOutcome,'unknown');assert.equal(receipt.retryWithNewRequest,false);
 const retry=await sendMarketplace(f,[tool('propose',f.proposal),{text:'Original draft confirmed.'}]);assert.equal(retry.status,'succeeded',JSON.stringify(retry));assert.equal((f.app.store.read().workerOrders||[]).length,1);assert.equal(f.app.store.read().marketplace.contracts.length,1);assert.equal(f.remoteMarketplace.stats.submits,0);
});
test('original Node final delivery rechecks Marketplace grant after official worker exit',{timeout:45000},async t=>{
 let armed=false,revoked=false;const f=await nativeMarketplace(t,{onWorkerLifecycle:(e,value)=>{if(armed&&e.phase==='exit'&&e.code===0){value.controls.granted=false;revoked=true;}}});await seed(f);armed=true;
 const run=await sendMarketplace(f,[tool('status'),{text:'Must be withheld.'}]);assert.equal(revoked,true);assert.equal(run.status,'failed');assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');
});

test('scope withdrawal at original Store admission blocks a local draft before commit',{timeout:45000},async t=>{
 const f=await nativeMarketplace(t);f.controls.onScopeRead=count=>{if(count===2)f.controls.granted=false;};
 const run=await sendMarketplace(f,[tool('propose',f.proposal),{text:'Draft admission refused.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(f.controls.scopeReads,2);assert.equal((f.app.store.read().workerOrders||[]).length,0);assert.equal(f.app.store.read().marketplace.contracts.length,0);
 const receipt=(await journal(f)).find(e=>e.message?.toolName==='workspace_marketplace_propose').message.details;assert.equal(receipt.code,'MARKETPLACE_SCOPE_REQUIRED');assert.equal(f.remoteMarketplace.stats.submits,0);
});
test('original Run cancellation stops delivery and retains only the already committed draft',{timeout:45000},async t=>{
 const f=await nativeMarketplace(t),pending=sendMarketplace(f,[tool('propose',f.proposal),{wait:5000,text:'Must be cancelled.'}]);let reached=false;
 for(let i=0;i<1000;i++){const run=f.app.store.read().runs.at(-1);if((f.app.store.read().workerOrders||[]).length===1&&run.events.filter(e=>e.type==='pi.agent-session.request').length>=2){reached=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(reached,true);const cancelled=await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}});assert.equal(cancelled.status,200,cancelled.text);assert.equal((await pending).status,'cancelled');assert.equal(f.app.store.read().workerOrders[0].status,'draft');assert.equal(f.remoteMarketplace.stats.submits,0);
});
