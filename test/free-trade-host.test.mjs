// Original Node24 Host/signed Sessions/Run, owned Bun OMP worker and loopback
// ERP-shaped source. All accounts/grants/records/model responses are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {taskFixture} from './fixtures/pi-task-helpers.mjs';
import {createWorkspaceOmpEngineAdapter,workspaceOmpPaths} from '../server/workspace-omp-bridge.mjs';
import {acceptanceConfiguration} from '../server/deepseek-acceptance-policy.mjs';
const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
const fields=['name','currency','grand_total','modified'];
const erpInput={doctype:'Quotation',name:'Q-SYNTHETIC',fields};
const tools=['workspace_free_trade_status','workspace_tender_search','workspace_erpnext_read','workspace_erpnext_prepare_quotation'];
// JSON object order is not authority; restore normalizes an equivalent request.
const responses=[{tool:'workspace_erpnext_read',arguments:{fields,name:erpInput.name,doctype:erpInput.doctype},expectedToolNames:tools},{text:'Synthetic authorized projection; not a real ERP quote.'}];
async function fixture(t,{script=responses,life=()=>{},missing=false,publicAllowed=false,pluginConfiguration={}}={}){
 const state={allowed:true,fields:new Set(fields),erpCalls:0,row:{name:'Q-SYNTHETIC',currency:'USD',grand_total:321,modified:'2026-10-16 00:00:00'}};
 const server=createServer((req,res)=>{
  state.erpCalls++;const u=new URL(req.url,'http://fixture');
  assert.equal(req.method,'GET');assert.equal(u.pathname,'/api/resource/Quotation');assert.equal(u.searchParams.get('limit_page_length'),'1');
  assert.deepEqual(JSON.parse(u.searchParams.get('filters')),[['Quotation','name','=','Q-SYNTHETIC']]);
  const selected=JSON.parse(u.searchParams.get('fields'));assert.ok(selected.every(field=>fields.includes(field)));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[Object.fromEntries(selected.map(field=>[field,state.row[field]]))]}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const origin='http://127.0.0.1:'+server.address().port;
 const configuration=acceptanceConfiguration({DEEPSEEK_API_KEY:'explicit-finite-model-not-network'});
 const model={provider:configuration.providerId,id:configuration.model,api:'openai-completions',baseUrl:configuration.baseUrl};
 const recipient={kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl},expiresAt=new Date(Date.now()+180000).toISOString();
 let f;const lifecycle=[];
 const options={recipient,engineAdapter:createWorkspaceOmpEngineAdapter({paths:workspaceOmpPaths({}),configuration,freeTrade:true,pluginConfiguration,syntheticResponses:script,onWorkerLifecycle:event=>{lifecycle.push(event);life(event,state);}}),
  resolveBinding:async({actor,sessionReadonlyClient})=>({client:sessionReadonlyClient(actor),model,
   freeTradeHost:await f.app.freeTradeSessionBinding(actor,{policy:{enabled:true,reviewed:true,workspaceId:actor.workspaceId,subject:actor.subject,recipient,expiresAt,origin,records:[erpInput]},
    connection:missing?{}:{baseUrl:origin,apiKey:'fixture-erp-read-only',apiSecret:'fixture-erp-secret-only',allowLoopbackHttpForTests:true},
    authorizeRecord:async scope=>state.allowed&&scope.origin===origin&&scope.doctype===erpInput.doctype&&scope.name===erpInput.name&&scope.fields.every(field=>state.fields.has(field)),
    authorizeTool:async()=>publicAllowed})})};
 f=await taskFixture(t,{enterprise:true,businessAgentOptions:options});
 return {...f,state,lifecycle};
}
async function conversation(f){const r=await f.workspace('/api/conversations',{body:{title:'Synthetic free-trade Host',inputContext:empty()}});assert.equal(r.status,201,r.text);return r.json.conversation.id;}
let nextRequest=0;
async function send(f,cid){
 const r=await f.workspace(`/api/conversations/${cid}/messages`,{body:{content:'Use the exact authorized synthetic ERP projection; no writes.',requestId:'free-trade-'+(++nextRequest),workspaceExecution:false,inputContext:empty()}});
 assert.equal(r.status,202,r.text);const runId=r.json.run.id,until=Date.now()+40000;
 while(Date.now()<until){const run=f.app.store.read().runs.find(row=>row.id===runId);if(run&&!['queued','running'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,30));}
 throw Error('Original free-trade Run did not settle.');
}
async function journal(f,cid){const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;assert.ok(map);return (await fs.readFile(map.sessionFile,'utf8')).trim().split('\n').map(JSON.parse);}
const modelCalls=run=>run.events.filter(event=>event.type==='pi.agent-session.request').length;
test('original Host actual Bun SDK reads exact ERP projection, seals receipts and restores that Session', {timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f),first=await send(f,cid);assert.equal(first.status,'succeeded',JSON.stringify(first.error));
 let entries=await journal(f,cid);const receipt=entries.find(e=>e.message?.toolName==='workspace_erpnext_read').message;
 assert.equal(receipt.isError,false,JSON.stringify(receipt));assert.equal(receipt.details.record.grand_total,321);assert.ok(receipt.details.authorization.scopeHash);
 assert.equal(modelCalls(first),2);assert.ok(f.state.erpCalls>=4&&f.state.erpCalls<=16);const nativeId=receipt.details.authorization.nativeSessionId;
 const second=await send(f,cid);assert.equal(second.status,'succeeded',JSON.stringify({error:second.error,lifecycle:f.lifecycle}));entries=await journal(f,cid);
 assert.equal(entries.filter(e=>e.message?.toolName==='workspace_erpnext_read').at(-1).message.details.authorization.nativeSessionId,nativeId);
 assert.equal(f.faux.state.callCount,0);assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length,0);
});
for(const kind of ['grant-revoked','field-narrowed','projection-changed'])test('cached private ERP refuses '+kind+' before another model',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 if(kind==='grant-revoked')f.state.allowed=false;else if(kind==='field-narrowed')f.state.fields.delete('grand_total');else f.state.row.grand_total=999;
 const second=await send(f,cid);assert.equal(second.status,'failed',JSON.stringify(second.error));assert.equal(modelCalls(second),0);
});
test('private ERP grant revoked during actual native model generation withholds the result',{timeout:60000},async t=>{
 const f=await fixture(t,{script:[responses[0],{text:'SYNTHETIC_WITHHELD_PRIVATE_ANSWER',wait:100}],life:(event,state)=>{if(event.phase==='nativeModelWaiting')state.allowed=false;}});
 const cid=await conversation(f),run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(modelCalls(run),2);
 assert.ok(!f.app.store.read().messages.some(row=>row.content?.includes('SYNTHETIC_WITHHELD_PRIVATE_ANSWER')));
});
test('private ERP missing safe credentials is truthful unconfigured and sends zero requests',{timeout:60000},async t=>{
 const f=await fixture(t,{missing:true}),cid=await conversation(f),run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify({error:run.error,lifecycle:f.lifecycle}));
 const receipt=(await journal(f,cid)).find(e=>e.message?.toolName==='workspace_erpnext_read').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.status,'unconfigured');assert.equal(f.state.erpCalls,0);
});
test('private Host denies unapproved public outbound search before any source request',{timeout:60000},async t=>{
 const f=await fixture(t,{script:[{tool:'workspace_tender_search',arguments:{provider:'ted',query:'synthetic confidential term'},expectedToolNames:tools},responses[1]]}),cid=await conversation(f),run=await send(f,cid);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));const receipt=(await journal(f,cid)).find(e=>e.message?.toolName==='workspace_tender_search').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'ORIGINAL_AUTHORIZATION_REFUSED');assert.equal(f.state.erpCalls,0);
});
for(const boundary of ['source-changes-during-model','grant-revoked-after-worker-exit'])test('private ERP '+boundary+' withholds final answer',{timeout:60000},async t=>{
 const f=await fixture(t,{script:[responses[0],{text:'SYNTHETIC_LATE_WITHHELD',wait:50}],life:(event,state)=>{
  if(boundary==='source-changes-during-model'&&event.phase==='nativeModelWaiting')state.row.grand_total=999;
  if(boundary==='grant-revoked-after-worker-exit'&&event.phase==='exit'&&event.code===0)state.allowed=false;
 }}),cid=await conversation(f),run=await send(f,cid);
 assert.equal(run.status,'failed');assert.ok(!f.app.store.read().messages.some(row=>row.content?.includes('SYNTHETIC_LATE_WITHHELD')));
 if(boundary==='grant-revoked-after-worker-exit')assert.ok(f.lifecycle.some(event=>event.phase==='exit'&&event.code===0));
});
for(const kind of ['receipt-body','error-disguise','missing-snapshot','cross-session-proof'])test('private native journal refuses '+kind+' before another model',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 const entries=await journal(f,cid),receipt=entries.find(e=>e.message?.toolName==='workspace_erpnext_read').message;
 if(kind==='receipt-body'){receipt.details.record.grand_total=999;receipt.content[0].text=JSON.stringify(receipt.details);}
 if(kind==='error-disguise')receipt.isError=true;
 if(kind==='missing-snapshot')for(const entry of entries)if(entry.customType==='workspace-plugin-disclosure-snapshot')entry.customType='synthetic-removed-snapshot';
 if(kind==='cross-session-proof')for(const entry of entries)if(entry.customType==='workspace-plugin-disclosure-snapshot')for(const proof of entry.data.snapshot.proofs)proof.nativeSessionId='synthetic-other-native-session';
 const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 await fs.writeFile(map.sessionFile,entries.map(JSON.stringify).join('\n')+'\n',{mode:0o600});
 const run=await send(f,cid);assert.equal(run.status,'failed',JSON.stringify(run.error));assert.equal(modelCalls(run),0);
});
test('original signed Session logout/relogin cannot inherit private native receipt authority',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 assert.equal((await f.workspace('/api/session/logout',{body:{}})).status,200);f.clearWorkspaceSession('member-b');
 const runsBefore=f.app.store.read().runs.length;
 const reply=await f.workspace(`/api/conversations/${cid}/messages`,{body:{content:'Resume after rotation.',requestId:'free-trade-rotation',workspaceExecution:false,inputContext:empty()}});
 assert.equal(reply.status,403,reply.text);assert.equal(reply.json.error.code,'BUSINESS_AGENT_BINDING_CHANGED');assert.equal(f.app.store.read().runs.length,runsBefore);
});
test('actual native compaction keeps private source obligations when old tool messages leave context',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 const mapping=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/free-trade-session-compact.mjs',mapping.sessionFile],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,err);assert.equal(JSON.parse(out).privateToolMessages,0);
 f.state.allowed=false;const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(modelCalls(run),0);
});
test('disabled or physically uninstalled native package cannot disclose its prior private Session',{timeout:60000},async t=>{
 const root=await fs.mkdtemp('/tmp/free-trade-private-lifecycle-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.cp('plugins/workspace-free-trade',root+'/workspace-free-trade',{recursive:true});
 const selected={extensions:['./workspace-free-trade'],disabledExtensions:[]},config=root+'/config.free-trade.json';await fs.writeFile(config,JSON.stringify(selected));
 const f=await fixture(t,{pluginConfiguration:{root}}),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 await fs.writeFile(config,JSON.stringify({...selected,disabledExtensions:['workspace-free-trade']}));
 let run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(modelCalls(run),0);
 await fs.writeFile(config,JSON.stringify(selected));await fs.rm(root+'/workspace-free-trade',{recursive:true});
 run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(modelCalls(run),0);
});
