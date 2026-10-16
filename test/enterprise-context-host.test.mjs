// Actual Node24 Host/signed Sessions/Run/Bun18 SDK and Artifact/Library files.
// Docling HTTP, all source data, identities and model decisions are stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {taskFixture,api} from './fixtures/pi-task-helpers.mjs';
import {MODEL,RECIPIENT} from './fixtures/factory-materials-read.mjs';
import {createWorkspaceOmpEngineAdapter,workspaceOmpPaths} from '../server/workspace-omp-bridge.mjs';
const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
const names=['workspace_enterprise_context_status','workspace_enterprise_context_memory_search','workspace_enterprise_context_memory_add','workspace_enterprise_context_memory_history','workspace_enterprise_context_parse_upload'];
const stop={text:'SYNTHETIC parsed-source answer; not actual Docling or model reasoning.'};
async function fixture(t,{script,missing=false,noLibrary=false,timeoutMs=15000,life=()=>{},pluginConfiguration={}}={}){
 const directory=await fs.mkdtemp('/tmp/enterprise-context-host-');
 const seed=await taskFixture(t,{directory,enterprise:true});const rows=[];
 for(const label of ['A','B']){
  const saved=await seed.app.artifacts.create({requestId:randomUUID(),filename:'synthetic-'+label+'.txt',content:'SYNTHETIC authorized source '+label,metadata:{businessLibrary:{visibility:'internal'}}});
  const asset={artifactId:saved.artifact.id,version:1,sha256:saved.artifact.sha256};
  const document=(await seed.app.businessLibrary.createDocument({requestId:randomUUID(),title:'Synthetic customer '+label,slotKey:'specification',asset},{subject:'member-a',role:'admin'})).document;
  rows.push({documentId:document.id,asset,revision:1,documentVersion:1});
 }
 await seed.app.close();
 const state={calls:0,customer:'A',responseHook:null,delay:0,held:null,closed:false,identity:null};let f;const lifecycle=[];
 const server=createServer(async(req,res)=>{
  state.calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/v1/convert/file');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const form=await new Request('http://fixture',{method:'POST',body:Buffer.concat(chunks),headers:{'content-type':req.headers['content-type']}}).formData();
  const bytes=Buffer.from(await form.get('files').arrayBuffer());assert.ok(rows.some(row=>row.asset.sha256===createHash('sha256').update(bytes).digest('hex')));
  if(state.responseHook)await state.responseHook();
  res.on('close',()=>{state.closed=true;});if(state.held){state.held();return;}
  if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
  if(!res.destroyed){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'success',document:{text_content:'SYNTHETIC_DOCLING_TEXT'},errors:[]}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const connection={reviewed:true,baseURL:'http://127.0.0.1:'+server.address().port,apiKey:'fixture-docling-only',timeoutMs};
 const responses=script?script(rows):[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset,expectedToolNames:names},stop];
 const engineAdapter=createWorkspaceOmpEngineAdapter({paths:workspaceOmpPaths({}),configuration:{providerId:MODEL.provider,model:MODEL.id,baseUrl:MODEL.baseUrl},enterpriseContext:true,
  pluginConfiguration,syntheticResponses:responses,onWorkerLifecycle:event=>{lifecycle.push(event);life(event,state,f);}});
 const policy={enabled:true,reviewed:true,workspaceId:'pi-enterprise-test',subject:'member-a',expiresAt:'2099-01-01T00:00:00.000Z',recipient:RECIPIENT,company:null,products:[],productFields:['name'],
  factoryMaterials:{products:[],productFields:['name'],documents:rows.map(row=>({id:row.documentId,revision:1,documentVersion:1,asset:row.asset}))}};
 const bindingOptions=()=>({recipient:RECIPIENT,selection:{enabled:true,reviewed:true,customerId:'customer-'+state.customer,sources:[rows[state.customer==='A'?0:1]]},connection:missing?{}:connection});
 f=await taskFixture(t,{directory,enterprise:true,libraryModelReadPolicy:noLibrary?null:policy,businessAgentOptions:{recipient:RECIPIENT,engineAdapter,
  resolveBinding:async({actor,sessionReadonlyClient})=>{state.identity=actor;return {client:sessionReadonlyClient(actor),model:MODEL,enterpriseContextHost:await f.app.enterpriseContextSessionBinding(actor,bindingOptions())};}}});
 t.after(async()=>{await f.app.close();await fs.rm(directory,{recursive:true,force:true});});
 return Object.assign(f,{rows,state,lifecycle,bindingOptions,responses});
}
async function conversation(f){const r=await f.workspace('/api/conversations',{subject:'member-a',body:{title:'Synthetic enterprise sources',inputContext:empty()}});assert.equal(r.status,201,r.text);return r.json.conversation.id;}
let next=0;
async function send(f,cid,{write=false}={}){
 const reply=await f.workspace(`/api/conversations/${cid}/messages`,{subject:'member-a',body:{content:'Use only the selected synthetic source, no real service or model claim.',requestId:'enterprise-context-'+(++next),workspaceExecution:write,inputContext:empty()}});
 assert.equal(reply.status,202,reply.text);const until=Date.now()+40000;
 while(Date.now()<until){const run=f.app.store.read().runs.find(row=>row.id===reply.json.run.id);if(run&&!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('Original Run timeout');
}
const calls=run=>run.events.filter(row=>row.type==='pi.agent-session.request').length;
async function journal(f,cid){const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;return (await fs.readFile(map.sessionFile,'utf8')).trim().split('\n').map(JSON.parse);}
async function changeSource(f){await f.app.store.update(state=>{state.businessLibrary.documents.find(row=>row.id===f.rows[0].documentId).revision++;});}
test('original Host/SDK parses pinned Library source over actual local HTTP and resumes same native Session',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f),first=await send(f,cid);assert.equal(first.status,'succeeded',JSON.stringify({error:first.error,lifecycle:f.lifecycle}));
 const result=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.details.text,'SYNTHETIC_DOCLING_TEXT');assert.equal(result.details.source.documentId,f.rows[0].documentId);assert.equal(result.details.canonicalFacts,'Workspace Library');
 const id=result.details.authorization.nativeSessionId,second=await send(f,cid);assert.equal(second.status,'succeeded',JSON.stringify(second.error));
 assert.equal((await journal(f,cid)).filter(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').at(-1).message.details.authorization.nativeSessionId,id);
 assert.equal(f.state.calls,2);assert.equal(calls(first),2);assert.equal(f.faux.state.callCount,0);
});
for(const reason of ['safe-connection','library-selection'])test('missing '+reason+' is honest unconfigured with zero Docling HTTP',{timeout:60000},async t=>{
 const f=await fixture(t,{missing:reason==='safe-connection',noLibrary:reason==='library-selection'}),cid=await conversation(f),run=await send(f,cid);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));const result=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(result.isError,true);assert.equal(result.details.status,'unconfigured');assert.equal(f.state.calls,0);
});
test('cached original source revision change refuses another model request',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');await changeSource(f);
 const before=f.app.store.read().runs.length;const reply=await f.workspace(`/api/conversations/${cid}/messages`,{subject:'member-a',body:{content:'Resume changed source.',requestId:'changed-source',workspaceExecution:false,inputContext:empty()}});
 assert.equal(reply.status,409,reply.text);assert.equal(reply.json.error.code,'FACTORY_DOCUMENT_REVISION_CHANGED');assert.equal(f.app.store.read().runs.length,before);assert.equal(f.state.calls,1);
});
test('Docling dispatch rechecks source after original download and before any bytes leave Host',{timeout:60000},async t=>{
 const f=await fixture(t),download=f.app.artifacts.download;let changed=false;
 f.app.artifacts.download=async(...args)=>{const value=await download(...args);if(!changed){changed=true;await changeSource(f);}return value;};
 const run=await send(f,await conversation(f));assert.equal(run.status,'failed');assert.equal(f.state.calls,0);
});
test('source changed by local Docling stand-in before return withholds all parsed text',{timeout:60000},async t=>{
 const f=await fixture(t);f.state.responseHook=()=>changeSource(f);const run=await send(f,await conversation(f));
 assert.equal(run.status,'failed');assert.equal(f.state.calls,1);assert.ok(!f.app.store.read().messages.some(row=>row.content?.includes('SYNTHETIC_DOCLING_TEXT')));
});
test('original readonly Session refuses Artifact write intent before SDK or service access',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);const reply=await f.workspace(`/api/conversations/${cid}/messages`,{subject:'member-a',body:{content:'Save the extraction.',requestId:'write-intent',workspaceExecution:true,inputContext:empty()}});
 assert.equal(reply.status,403,reply.text);assert.equal(reply.json.error.code,'SESSION_READONLY_EXECUTION_REFUSED');assert.equal(f.state.calls,0);assert.equal(f.lifecycle.length,0);
});
test('Host Mem0 search/add/history stay disabled and status keeps Library canonical',{timeout:60000},async t=>{
 const f=await fixture(t,{script:rows=>[
  {tool:'workspace_enterprise_context_memory_search',arguments:{customerId:'customer-A',query:'synthetic'}},
  {tool:'workspace_enterprise_context_memory_add',arguments:{customerId:'customer-A',note:'synthetic',sourceRef:rows[0].documentId,sourceVersion:1,sourceSha256:rows[0].asset.sha256}},
  {tool:'workspace_enterprise_context_memory_history',arguments:{customerId:'customer-A',memoryId:'synthetic-memory'}},stop,
 ]}),cid=await conversation(f),run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,0);
 for(const row of (await journal(f,cid)).filter(row=>row.message?.role==='toolResult')){assert.equal(row.message.isError,true);assert.equal(row.message.details.reason,'OSS_MEM0_DISABLED');assert.equal(row.message.details.canonicalFacts,'Workspace Library');}
});
test('customer narrowing refuses other approved Library document without Docling request',{timeout:60000},async t=>{
 const f=await fixture(t,{script:rows=>[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[1].asset},stop]}),cid=await conversation(f),run=await send(f,cid);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,0);
 assert.equal((await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message.details.reason,'OSS_CUSTOMER_SOURCE_NOT_SELECTED');
});
test('switching customer cannot inherit prior native receipts; fresh customer uses only its original source',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');f.state.customer='B';
 f.responses[0].arguments=f.rows[1].asset;const refused=await send(f,cid);assert.equal(refused.status,'failed');assert.equal(calls(refused),0);
 const other=await conversation(f),run=await send(f,other);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,2);
 assert.equal((await journal(f,other)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message.details.source.documentId,f.rows[1].documentId);
});
test('foreign member and foreign original Host Session cannot claim Library authority',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);await send(f,cid);
 const other=await taskFixture(t,{enterprise:true,workspaceId:'foreign-enterprise'});
 await assert.rejects(other.app.enterpriseContextSessionBinding(f.state.identity,f.bindingOptions()));
 const c=await f.workspace('/api/conversations',{subject:'member-b',body:{title:'Foreign member',inputContext:empty()}});
 const r=await f.workspace(`/api/conversations/${c.json.conversation.id}/messages`,{subject:'member-b',body:{content:'Read sources.',requestId:'foreign-member',workspaceExecution:false,inputContext:empty()}});
 assert.equal(r.status,403,r.text);assert.equal(f.state.calls,1);
});
test('actual Session logout after download stops dispatch',{timeout:60000},async t=>{
 const f=await fixture(t),download=f.app.artifacts.download;let revoked=false;
 f.app.artifacts.download=async(...args)=>{const file=await download(...args);if(!revoked){revoked=true;assert.equal((await f.workspace('/api/session/logout',{subject:'member-a',body:{}})).status,200);}return file;};
 const run=await send(f,await conversation(f));assert.equal(run.status,'failed');assert.equal(f.state.calls,0);
});
test('source revoked during native model generation withholds response',{timeout:60000},async t=>{
 let mutation;const f=await fixture(t,{script:rows=>[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset},{text:'SYNTHETIC_CONTEXT_WITHHELD',wait:100}],life:(event,_state,app)=>{if(event.phase==='nativeModelWaiting')mutation=changeSource(app);}});
 const run=await send(f,await conversation(f));await mutation;assert.equal(run.status,'failed');assert.equal(calls(run),2);
 assert.ok(!f.app.store.read().messages.some(row=>row.content?.includes('SYNTHETIC_CONTEXT_WITHHELD')));
});
test('Node final gate rechecks source after actual worker exit',{timeout:60000},async t=>{
 const f=await fixture(t,{life:(event,state)=>{if(event.phase==='exit'&&event.code===0)state.afterExit=true;}}),download=f.app.artifacts.download;let changed=false;
 f.app.artifacts.download=async(...args)=>{const file=await download(...args);if(f.state.afterExit&&!changed){changed=true;await changeSource(f);}return file;};
 const run=await send(f,await conversation(f));assert.equal(changed,true);assert.equal(run.status,'failed');assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');
});
test('cached parse text tamper fails original native initialization before another model',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');const entries=await journal(f,cid);
 const message=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;message.details.text='SYNTHETIC_FORGED_BODY';message.content[0].text=JSON.stringify(message.details);
 const mapping=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;await fs.writeFile(mapping.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,1);
});
test('local Docling timeout is unavailable without retry or success text',{timeout:60000},async t=>{
 const f=await fixture(t,{timeoutMs:30});f.state.delay=200;const cid=await conversation(f),run=await send(f,cid);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,1);
 const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.status,'unavailable');assert.equal(receipt.details.reason,'DOCLING_TIMEOUT');assert.equal(receipt.details.text,undefined);
});
test('original cancellation aborts in-flight Docling HTTP and releases only owned work',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);let entered;const pending=new Promise(resolve=>entered=resolve);f.state.held=entered;
 const work=send(f,cid);await pending;assert.equal((await f.workspace(`/api/conversations/${cid}/cancel`,{subject:'member-a',body:{}})).status,200);
 const run=await work;assert.equal(run.status,'cancelled');const until=Date.now()+2000;while(!f.state.closed&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(f.state.closed,true);assert.equal(f.state.calls,1);
});
test('native disable/uninstall refuse old private history while a fresh tool-free Session works',{timeout:60000},async t=>{
 const root=await fs.mkdtemp('/tmp/enterprise-plugin-lifecycle-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.cp('plugins/workspace-enterprise-context',root+'/workspace-enterprise-context',{recursive:true});const config=root+'/config.enterprise-context.json';
 const selected={extensions:['./workspace-enterprise-context'],disabledExtensions:[]};await fs.writeFile(config,JSON.stringify(selected));
 const f=await fixture(t,{pluginConfiguration:{root}}),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 await fs.writeFile(config,JSON.stringify({...selected,disabledExtensions:['workspace-enterprise-context']}));let run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);
 await fs.writeFile(config,JSON.stringify({extensions:[],disabledExtensions:[]}));await fs.rm(root+'/workspace-enterprise-context',{recursive:true});
 run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);
 f.responses.splice(0,f.responses.length,{text:'Synthetic conversation with no plugin tools.',expectedToolNames:[]});run=await send(f,await conversation(f));assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,1);
});
test('enterprise plugin coexists with probe/free-trade and cannot inherit unguarded public outbound tools',{timeout:60000},async t=>{
 const root=await fs.mkdtemp('/tmp/enterprise-plugin-coexist-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of ['workspace-enterprise-context','workspace-free-trade','workspace-plugin-info'])await fs.cp('plugins/'+name,root+'/'+name,{recursive:true});
 await fs.writeFile(root+'/config.enterprise-context.json',JSON.stringify({extensions:['./workspace-enterprise-context','./workspace-free-trade','./workspace-plugin-info'],disabledExtensions:[]}));
 const f=await fixture(t,{pluginConfiguration:{root},script:()=>[{tool:'workspace_tender_search',arguments:{provider:'ted',query:'synthetic private term'},expectedToolNames:[...names,'workspace_free_trade_status','workspace_tender_search','workspace_erpnext_read','workspace_erpnext_prepare_quotation','workspace_plugin_info']},stop]}),cid=await conversation(f),run=await send(f,cid);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_tender_search').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'ORIGINAL_REVIEWED_HOST_REQUIRED');assert.equal(f.state.calls,0);
});
test('cached source bytes tamper refuses native recovery without another Docling call',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');const download=f.app.artifacts.download;
 f.app.artifacts.download=async(...args)=>({...await download(...args),bytes:Buffer.from('SYNTHETIC_CHANGED_ORIGINAL_BYTES')});
 const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,1);
});
test('native compaction retains source obligations and refuses revoked source before model disclosure',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 const mapping=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/enterprise-context-compact.mjs',mapping.sessionFile],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,err);
 assert.equal(JSON.parse(out).privateMessages,0);
 const download=f.app.artifacts.download;f.app.artifacts.download=async(...args)=>({...await download(...args),bytes:Buffer.from('SYNTHETIC_COMPACTED_SOURCE_TAMPER')});
 const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,1);
});
test('private status metadata is source-pinned and cannot become forged customer context on resume',{timeout:60000},async t=>{
 const f=await fixture(t,{script:()=>[{tool:'workspace_enterprise_context_status',arguments:{},expectedToolNames:names},{text:'SYNTHETIC configuration and selected source status only.'}]}),cid=await conversation(f);
 assert.equal((await send(f,cid)).status,'succeeded');const entries=await journal(f,cid),message=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_status').message;
 assert.equal(message.details.providers.mem0,'disabled');assert.equal(message.details.providers.docling,'configured_unverified');assert.equal(message.details.sources[0].documentId,f.rows[0].documentId);
 assert.ok(message.details.authorization);message.details.customerId='SYNTHETIC_FORGED_CUSTOMER';message.content[0].text=JSON.stringify(message.details);
 const mapping=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;await fs.writeFile(mapping.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,0);
});
test('original Agent bearer or external Worker cannot substitute for signed Library Session authority',{timeout:60000},async t=>{
 const f=await fixture(t);const response=await api(f,`/api/library/model-read/factory/documents/${f.rows[0].documentId}/1`);
 assert.ok([401,403].includes(response.status),response.text);assert.equal(f.state.calls,0);assert.equal(f.app.store.read().runs.length,0);
});
