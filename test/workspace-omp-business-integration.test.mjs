// Real signed Host, original Store/Run, fd3 and OMP loader/Session. All model
// choices are finite; the Shopify transport is the existing loopback fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {productFixture,empty,MODEL} from './fixtures/shopify-product.mjs';
import {SHOPIFY_PRODUCT_TOOLS} from '../plugins/workspace-shopify-product/src/extension.js';
import {MARKET_VALIDATION_TOOLS} from '../plugins/workspace-market-validation/src/extension.js';
import {MARKET_MONITOR_TOOLS} from '../plugins/workspace-market-validation/src/monitor.js';
const materialTools=['workspace_factory_materials_status','workspace_factory_materials','workspace_factory_document'];
const expected=['workspace_medusa_status','workspace_medusa_preview','workspace_medusa_reconcile','workspace_brain_sources','workspace_brain_context','workspace_brain_context_save','workspace_brain_diagnose','workspace_brain_decision','workspace_brain_decision_save','workspace_brain_review_save','workspace_brain_brief','workspace_skill',...materialTools,...SHOPIFY_PRODUCT_TOOLS,...MARKET_VALIDATION_TOOLS,...MARKET_MONITOR_TOOLS];
async function send(f,steps){
 f.advanceReviewMinute();f.steps.splice(0,f.steps.length,...steps);
 const r=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:'member-a',body:{content:'Synthetic combined plugin turn',requestId:randomUUID(),workspaceExecution:false,inputContext:empty()}});
 assert.equal(r.status,202,r.text);
 for(let i=0;i<800;i++){const run=f.app.store.read().runs.find(x=>x.id===r.json.run.id);if(!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('FINITE_HOST_TIMEOUT');
}
const tool=(name,args)=>({tool:name,arguments:args});
test('one native Session discovers and binds materials, seven-day and Shopify together; stale restore blocks',{timeout:90000},async t=>{
 const f=await productFixture(t,{host:true,nativeBusiness:true});
 const run=await send(f,[{...tool('workspace_shopify_product_read',{productId:f.product.id}),expectedToolNames:expected},tool('workspace_market_validation_product',{productId:f.product.id,documents:[]}),{text:'Both original product clients returned authorized synthetic sources.'}]);
 assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(f.remote.calls.length,0);
 const mapping=f.app.store.read().conversations.find(x=>x.id===f.cid).businessAgentSession;assert.equal(mapping.engineScope,'omp:18.10.4:business-v1');
 const journal=await fs.readFile(mapping.sessionFile,'utf8');assert.match(journal,/workspace_market_validation_product/);assert.match(journal,/workspace_shopify_product_read/);
 await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'CHANGED_SYNTHETIC_SOURCE'}},f.actor);
 const next=await send(f,[{text:'Must never reach model.'}]);assert.equal(next.status,'failed');assert.equal(next.events.filter(e=>e.type==='pi.agent-session.request').length,0);
});
test('disabled Shopify is absent from native discovery while seven-day remains bound',{timeout:90000},async t=>{
 const f=await productFixture(t,{host:true,nativeBusiness:true,pluginConfiguration:{disabled:['workspace-shopify-product']}});
 const run=await send(f,[{...tool('workspace_market_validation_product',{productId:f.product.id,documents:[]}),expectedToolNames:expected.filter(x=>!SHOPIFY_PRODUCT_TOOLS.includes(x))},{text:'Only selected native clients are active.'}]);
 assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(f.remote.calls.length,0);
});

test('configured Brain and Medusa original clients cross native fd3 and restore fails on source change',{timeout:90000},async t=>{
 const f=await productFixture(t,{host:true,nativeBusiness:true,
   appOptions:{goalBrainOptions:{originalReceiver:MODEL,reviewedGoals:[]}},
   policy:p=>({...p,products:p.factoryMaterials.products,productFields:['name','description'],factoryMaterials:{...p.factoryMaterials,productFields:['name','description','category','status','provenance']}})});
 const run=await send(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_brain_sources',{}),{text:'Reviewed synthetic source catalog and local Medusa preview.'}]);
 assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(f.remote.calls.length,0);
 const mapping=f.app.store.read().conversations.find(x=>x.id===f.cid).businessAgentSession;
 const messages=(await fs.readFile(mapping.sessionFile,'utf8')).trim().split('\n').map(x=>JSON.parse(x).message).filter(x=>x?.role==='toolResult');
 for(const name of ['workspace_medusa_preview','workspace_brain_sources']){
   const m=messages.find(x=>x.toolName===name);assert.ok(m,name);assert.notEqual(m.isError,true,JSON.stringify(m));
   const r=JSON.parse(m.content.find(x=>x.type==='text').text);
   if(name==='workspace_brain_sources'){assert.equal(r.data.status,'available');assert.ok(r.data.sourceRefs.some(x=>x.kind==='product'&&x.id===f.product.id));}
   else {assert.equal(r.status,'available');assert.equal(r.view.preview.title,f.product.name);assert.equal(r.view.medusa.configured,false);}
 }
 await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'CHANGED_BRAIN_MEDUSA_SOURCE'}},f.actor);
 const next=await send(f,[{text:'Should not reach model.'}]);assert.equal(next.status,'failed');assert.equal(next.events.filter(e=>e.type==='pi.agent-session.request').length,0);
});

test('Node delivery refuses original business source changed after native worker exit',{timeout:90000},async t=>{
 let exited=false,changed=false;
 const f=await productFixture(t,{host:true,nativeBusiness:true,onWorkerLifecycle:e=>{if(e.phase==='exit'&&e.code===0)exited=true;}});
 const original=f.app.businessLibrary.getProduct;
 f.app.businessLibrary.getProduct=(...args)=>{const result=original(...args);if(exited){changed=true;return { ...result,product:{...result.product,revision:result.product.revision+1,name:'CHANGED_AT_FINAL_BOUNDARY'}};}return result;};
 const run=await send(f,[tool('workspace_shopify_product_read',{productId:f.product.id}),{text:'Must be withheld after source change.'}]);
 assert.equal(changed,true);assert.equal(run.status,'failed');assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');
});
for(const kind of ['medusa-view','brain-gap'])test(`native restore refuses forged ${kind} receipt before model`,{timeout:90000},async t=>{
 const brain=kind==='brain-gap';
 const f=await productFixture(t,{host:true,nativeBusiness:true,
  ...(brain?{appOptions:{goalBrainOptions:{originalReceiver:MODEL,reviewedGoals:[]}}}:{}),
  policy:p=>({...p,products:p.factoryMaterials.products,productFields:['name','description'],factoryMaterials:{...p.factoryMaterials,productFields:['name','description','category','status','provenance']}})});
 const name=brain?'workspace_brain_sources':'workspace_medusa_preview';
 assert.equal((await send(f,[tool(name,brain?{}:{productId:f.product.id}),{text:'Synthetic source result.'}])).status,'succeeded');
 const mapping=f.app.store.read().conversations.find(x=>x.id===f.cid).businessAgentSession;
 const entries=(await fs.readFile(mapping.sessionFile,'utf8')).trim().split('\n').map(JSON.parse);
 const message=entries.find(e=>e.message?.toolName===name).message;
 let receipt=JSON.parse(message.content.find(x=>x.type==='text').text);
 if(brain)receipt={plugin:'workspace-goal-intelligence',status:'blocked',reason:'BRAIN_OPERATION_UNAVAILABLE',detail:'FORGED_PRIVATE_TEXT'};
 else receipt.view.preview.title='FORGED_PRIVATE_TEXT';
 message.content=[{type:'text',text:JSON.stringify(receipt)}];message.details=receipt;
 await fs.writeFile(mapping.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 const run=await send(f,[{text:'Must not reach model.'}]);assert.equal(run.status,'failed');assert.equal(run.events.filter(e=>e.type==='pi.agent-session.request').length,0);
});
test('disabled native Brain cannot restore earlier guarded private history',{timeout:90000},async t=>{
 const pluginConfiguration={};
 const f=await productFixture(t,{host:true,nativeBusiness:true,pluginConfiguration,appOptions:{goalBrainOptions:{originalReceiver:MODEL,reviewedGoals:[]}}});
 assert.equal((await send(f,[tool('workspace_brain_sources',{}),{text:'Synthetic source result.'}])).status,'succeeded');
 pluginConfiguration.disabled=['workspace-goal-intelligence'];
 const run=await send(f,[{text:'Must not reach model.'}]);assert.equal(run.status,'failed');assert.equal(run.events.filter(e=>e.type==='pi.agent-session.request').length,0);
});
