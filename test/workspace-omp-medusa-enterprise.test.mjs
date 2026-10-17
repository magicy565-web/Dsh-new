import test from 'node:test';
import assert from 'node:assert/strict';
import {combinedFixture,sendCombined,mapping,journal,tool,requests} from './fixtures/medusa-enterprise-readonly.mjs';
import {MEDUSA_ENTERPRISE_SCOPE,MEDUSA_ENTERPRISE_TOOLS} from '../server/workspace-omp-medusa-enterprise.mjs';
const finish={text:'SYNTHETIC_COMBINED_READONLY_ANSWER'};
for(const wire of [false,true])test('combined original native Session reads both authorized sources and continues: '+(wire?'actual wire':'finite choices'),{timeout:60000},async t=>{
 const f=await combinedFixture(t,{wire});
 const run=await sendCombined(f,[{...tool('workspace_medusa_preview',{productId:f.product.id}),expectedToolNames:MEDUSA_ENTERPRISE_TOOLS},tool('workspace_enterprise_context_parse_upload',f.asset),finish]);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(requests(run),3);assert.equal(f.state.parserCalls,1);
 const original=mapping(f);assert.equal(original.engineScope,MEDUSA_ENTERPRISE_SCOPE);
 const entries=await journal(f),results=entries.filter(e=>e.message?.role==='toolResult').map(e=>e.message);
 for(const name of ['workspace_medusa_preview','workspace_enterprise_context_parse_upload'])assert.ok(results.some(m=>m.toolName===name&&m.isError!==true),name);
 assert.ok(JSON.stringify(results).includes(f.product.name));assert.ok(JSON.stringify(results).includes('SYNTHETIC_PRIVATE_PARSED_DOCUMENT'));
 const next=await sendCombined(f,[{...finish,expectedContextText:'SYNTHETIC_PRIVATE_PARSED_DOCUMENT'}]);assert.equal(next.status,'succeeded',JSON.stringify(next.error));
 assert.equal(mapping(f).agentSessionId,original.agentSessionId);assert.equal(f.state.parserCalls,1);
 if(wire){assert.equal(f.state.wireCalls,4);assert.ok(JSON.stringify(f.state.wireBodies.at(-1)).includes(f.product.name));assert.ok(JSON.stringify(f.state.wireBodies.at(-1)).includes('SYNTHETIC_PRIVATE_PARSED_DOCUMENT'));}
});

async function seedBoth(f){const r=await sendCombined(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);assert.equal(r.status,'succeeded',JSON.stringify(r.error));return mapping(f).agentSessionId;}
async function mutate(f,kind){await f.app.store.update(state=>{
 const p=state.businessLibrary.products.find(x=>x.id===f.product.id),d=state.businessLibrary.documents.find(x=>x.id===f.document.id);
 if(kind==='product-version')p.revision++;
 if(kind==='product-revoke')p.status='archived';
 if(kind==='document-version')d.currentVersion++;
 if(kind==='document-revoke')d.status='archived';
 if(kind==='artifact-sha')state.artifacts.find(x=>x.id===f.asset.artifactId).versions[0].sha256='e'.repeat(64);
});}
function assertWithheld(r){assert.ok(r.status==='failed'||[403,409].includes(r.status),JSON.stringify(r.error||r.json));assert.equal(r.events?requests(r):0,0);}
for(const kind of ['product-version','product-revoke','document-version','document-revoke','artifact-sha','receiver'])test('either original authority refuses same-Session continuation: '+kind,{timeout:60000},async t=>{
 const f=await combinedFixture(t);await seedBoth(f);if(kind==='receiver')f.state.recipientChanged=true;else await mutate(f,kind);
 const r=await sendCombined(f,[finish]);assertWithheld(r);assert.equal(f.state.parserCalls,1);
});
for(const kind of ['missingEnterprise','missingMedusa','missingParser','transfer'])test('missing binding/service/transfer is honest and cannot grant data: '+kind,{timeout:60000},async t=>{
 const f=await combinedFixture(t,{...(kind==='transfer'?{transfer:false}:{[kind]:true})});
 const r=await sendCombined(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);
 if(kind==='missingEnterprise'){assert.equal(r.status,409);assert.equal(r.json.error.code,'BUSINESS_AGENT_UNCONFIGURED');}
 else{
  assert.equal(r.status,'succeeded',JSON.stringify(r.error));const rows=(await journal(f)).filter(x=>x.message?.role==='toolResult').map(x=>x.message);
  const name=kind==='missingMedusa'?'workspace_medusa_preview':'workspace_enterprise_context_parse_upload',result=rows.find(x=>x.toolName===name);
  assert.equal(result.isError,true);assert.ok(['unconfigured','blocked'].includes(result.details.status));
  if(kind!=='missingMedusa')assert.equal(f.state.parserCalls,0);else assert.equal(result.details.status,'unconfigured');
 }
});
for(const kind of ['medusa-to-enterprise','enterprise-to-medusa'])test('cross-plugin forged receipt refuses before another model: '+kind,{timeout:60000},async t=>{
 const f=await combinedFixture(t);await seedBoth(f);const fs=await import('node:fs/promises'),entries=await journal(f);
 const product=entries.find(e=>e.message?.toolName==='workspace_medusa_preview').message,document=entries.find(e=>e.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 const target=kind==='medusa-to-enterprise'?document:product,other=target===product?document:product;target.details=other.details;target.content=other.content;
 await fs.writeFile(mapping(f).sessionFile,entries.map(JSON.stringify).join('\n')+'\n');assertWithheld(await sendCombined(f,[finish]));
});
async function compact(f){const {spawn}=await import('node:child_process'),{workspaceOmpPaths}=await import('../server/workspace-omp-runtime.mjs');
 const c=spawn(workspaceOmpPaths({}).bun,['test/fixtures/medusa-enterprise-compact.mjs',mapping(f).sessionFile],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'}});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);assert.equal(await new Promise(r=>c.on('exit',r)),0,err);assert.equal(JSON.parse(out).compacted,true);}
for(const kind of ['control','product-version','document-revoke'])test('native compaction keeps both original source obligations: '+kind,{timeout:60000},async t=>{
 const f=await combinedFixture(t,{wire:kind==='control'}),id=await seedBoth(f);await compact(f);if(kind!=='control')await mutate(f,kind);
 const r=await sendCombined(f,[{...finish,expectedContextText:'SYNTHETIC_BOTH_SOURCE_SUMMARY'}]);
 if(kind==='control'){assert.equal(r.status,'succeeded',JSON.stringify(r.error));assert.equal(mapping(f).agentSessionId,id);assert.equal(f.state.wireCalls,4);assert.ok(JSON.stringify(f.state.wireBodies.at(-1)).includes('SYNTHETIC_BOTH_SOURCE_SUMMARY'));}
 else assertWithheld(r);
 assert.equal(f.state.parserCalls,1);
});
for(const id of ['workspace-medusa-catalog','workspace-enterprise-context'])for(const action of ['disabled','uninstalled'])test('compacted private history cannot inherit '+action+' '+id,{timeout:60000},async t=>{
 const fs=await import('node:fs/promises'),root=await fs.mkdtemp('/tmp/medusa-enterprise-plugins-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of ['workspace-medusa-catalog','workspace-enterprise-context'])await fs.cp('plugins/'+name,root+'/'+name,{recursive:true});
 const file=root+'/config.medusa-enterprise-readonly.json',extensions=['./workspace-medusa-catalog','./workspace-enterprise-context'];await fs.writeFile(file,JSON.stringify({extensions,disabledExtensions:[]}));
 const f=await combinedFixture(t,{pluginConfiguration:{root}});await seedBoth(f);await compact(f);
 await fs.writeFile(file,JSON.stringify({extensions,disabledExtensions:[id]}));if(action==='uninstalled')await fs.rm(root+'/'+id,{recursive:true});
 assertWithheld(await sendCombined(f,[finish]));
});
test('original cancellation aborts the combined Session in-flight parser without retry',{timeout:60000},async t=>{
 const f=await combinedFixture(t);let entered;const pending=new Promise(resolve=>entered=resolve);f.state.held=entered;
 const work=sendCombined(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);
 await pending;assert.equal((await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:'member-a',body:{}})).status,200);
 const r=await work;assert.equal(r.status,'cancelled');assert.equal(f.state.parserCalls,1);
 for(let i=0;i<100&&!f.state.closed;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.state.closed,true);
});
test('original readonly admission refuses write intent without a model or parser',{timeout:15000},async t=>{
 const f=await combinedFixture(t),r=await sendCombined(f,[finish],{write:true});assert.equal(r.status,403);assert.equal(r.json.error.code,'SESSION_READONLY_EXECUTION_REFUSED');assert.equal(f.state.parserCalls,0);
});

for(const source of ['product','document'])test('actual model wire admission rechecks '+source+' after SDK serialization',{timeout:60000},async t=>{
 const f=await combinedFixture(t,{wire:true,life:(event,state)=>{if(event.phase==='medusaEnterpriseWireCheck'&&state.parserCalls===1)state.wireMutation=true;}});
 if(source==='product'){
  const get=f.app.businessLibrary.getProduct;f.app.businessLibrary.getProduct=(...args)=>{const result=get(...args);return f.state.wireMutation?{...result,product:{...result.product,revision:result.product.revision+1}}:result;};
 }else{
  const read=f.app.store.read;f.app.store.read=()=>{const state=structuredClone(read());if(f.state.wireMutation)state.artifacts.find(x=>x.id===f.asset.artifactId).versions[0].sha256='e'.repeat(64);return state;};
 }
 const r=await sendCombined(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);
 assert.equal(f.state.wireMutation,true);assert.equal(r.status,'failed');assert.equal(f.state.wireCalls,2,'the final actual HTTP request body must be withheld');assert.equal(requests(r),2);
});
for(const source of ['product-version','artifact-sha'])test('Node final gate rechecks '+source+' after worker exit and last awaited authorization',{timeout:60000},async t=>{
 const f=await combinedFixture(t,{life:(event,state)=>{if(event.phase==='exit'&&event.code===0)state.exited=true;},beforeModel:(args,state,fixture)=>{
  const original=args.authorize;args.authorize=async(...values)=>{await original(...values);if(state.exited&&++state.finalAuthorizations===2){await mutate(fixture,source);state.finalMutation=true;}};state.finalAuthorizations=0;
 }});
 const r=await sendCombined(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);
 assert.equal(f.state.exited,true);assert.equal(f.state.finalMutation,true);assert.equal(f.state.finalAuthorizations,2);assert.equal(r.status,'failed');assert.equal(r.error.code,'OMP_DISCLOSURE_REFUSED');
 assert.ok(!f.app.store.read().messages.some(m=>m.role==='assistant'&&m.status==='complete'&&m.content?.includes(finish.text)));
});
test('old engine scope cannot inherit the new combined binding',{timeout:60000},async t=>{
 const f=await combinedFixture(t);await seedBoth(f);await f.app.store.update(state=>{state.conversations.find(x=>x.id===f.cid).businessAgentSession.engineScope='omp:18.10.4:enterprise-context-v1';});
 const r=await sendCombined(f,[finish]);assert.equal(r.status,403);assert.equal(r.json.error.code,'BUSINESS_AGENT_ENGINE_CHANGED');
});

test('original Store pins the combined source binding across native compaction',{timeout:60000},async t=>{
 const f=await combinedFixture(t);await seedBoth(f);await compact(f);assert.match(mapping(f).sourceBindingFingerprint,/^[a-f0-9]{64}$/);
 f.state.customer='different-synthetic-customer';const r=await sendCombined(f,[finish]);assert.equal(r.status,403);assert.equal(r.json.error.code,'BUSINESS_AGENT_BINDING_CHANGED');
});
for(const missing of ['missingMedusa','missingEnterprise'])test('compacted private history refuses a removed original binding: '+missing,{timeout:60000},async t=>{
 const f=await combinedFixture(t);await seedBoth(f);await compact(f);f.state[missing]=true;assertWithheld(await sendCombined(f,[finish]));
});
test('Run cancellation during the last Node authorization after worker exit withholds delivery',{timeout:60000},async t=>{
 const f=await combinedFixture(t,{life:(event,state)=>{if(event.phase==='exit'&&event.code===0)state.exited=true;},beforeModel:(args,state,fixture)=>{
  const original=args.authorize;state.finalAuthorizations=0;args.authorize=async(...values)=>{await original(...values);if(state.exited&&++state.finalAuthorizations===2){await fixture.app.runtime.cancelConversation(fixture.cid);state.cancelledAfterExit=true;}};
 }});
 const r=await sendCombined(f,[tool('workspace_medusa_preview',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);assert.equal(f.state.cancelledAfterExit,true);assert.equal(r.status,'cancelled');
});
test('configured Medusa GET and Docling POST use finite loopback stand-ins in one actual-wire Session',{timeout:60000},async t=>{
 const f=await combinedFixture(t,{wire:true,medusaConfigured:true});
 const r=await sendCombined(f,[tool('workspace_medusa_reconcile',{productId:f.product.id}),tool('workspace_enterprise_context_parse_upload',f.asset),finish]);
 assert.equal(r.status,'succeeded',JSON.stringify(r.error));assert.equal(f.state.wireCalls,3);assert.ok(f.state.medusaCalls>0);assert.equal(f.state.parserCalls,1);
 const receipt=(await journal(f)).find(e=>e.message?.toolName==='workspace_medusa_reconcile').message.details;
 assert.equal(receipt.view.medusa.configured,true);assert.equal(receipt.view.medusa.connection,'configured_unverified');assert.equal(receipt.view.remote.status,'missing');assert.equal(receipt.view.remote.product,null);
});
