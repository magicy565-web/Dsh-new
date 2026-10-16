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
import {libraryReadHash} from '../server/library-model-read-contract.mjs';
const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
const names=['workspace_enterprise_context_status','workspace_enterprise_context_memory_search','workspace_enterprise_context_memory_add','workspace_enterprise_context_memory_history','workspace_enterprise_context_parse_upload'];
const stop={text:'SYNTHETIC parsed-source answer; not actual Docling or model reasoning.'};
async function fixture(t,{script,missing=false,noLibrary=false,timeoutMs=15000,life=()=>{},pluginConfiguration={},allSources=false,transfer=true}={}){
 const directory=await fs.mkdtemp('/tmp/enterprise-context-host-');
 const seed=await taskFixture(t,{directory,enterprise:true});const rows=[];
 for(const label of ['A','B']){
  const saved=await seed.app.artifacts.create({requestId:randomUUID(),filename:'synthetic-'+label+'.txt',content:'SYNTHETIC authorized source '+label,metadata:{businessLibrary:{visibility:'internal'}}});
  const asset={artifactId:saved.artifact.id,version:1,sha256:saved.artifact.sha256};
  const document=(await seed.app.businessLibrary.createDocument({requestId:randomUUID(),title:'Synthetic customer '+label,slotKey:'specification',asset},{subject:'member-a',role:'admin'})).document;
  rows.push({documentId:document.id,asset,revision:1,documentVersion:1});
 }
 await seed.app.close();
 const state={calls:0,customer:'A',responseHook:null,responseText:'SYNTHETIC_DOCLING_TEXT',responsePayload:null,responseStatus:200,delay:0,held:null,closed:false,identity:null,
  transferAllowed:true,transferChecks:[],transferHook:null,parserDestination:null,doclingSecret:'synthetic-docling-credential-'+randomUUID()+'@"/+&'};let f;const lifecycle=[];
 const server=createServer(async(req,res)=>{
  state.calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/v1/convert/file');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const form=await new Request('http://fixture',{method:'POST',body:Buffer.concat(chunks),headers:{'content-type':req.headers['content-type']}}).formData();
  const bytes=Buffer.from(await form.get('files').arrayBuffer());assert.ok(rows.some(row=>row.asset.sha256===createHash('sha256').update(bytes).digest('hex')));
  if(state.responseHook)await state.responseHook();
  res.on('close',()=>{state.closed=true;});if(state.held){state.held();return;}
  if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
  if(!res.destroyed){res.statusCode=state.responseStatus;res.setHeader('content-type','application/json');res.end(JSON.stringify(state.responsePayload||{status:'success',document:{text_content:state.responseText},errors:[]}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const connection={reviewed:true,baseURL:'http://127.0.0.1:'+server.address().port,apiKey:state.doclingSecret,timeoutMs};
 state.parserDestination=connection.baseURL+'/v1/convert/file';
 const authorizeParserTransfer=transfer?async request=>{
  const {signal,...facts}=request;state.transferChecks.push(facts);if(state.transferHook)await state.transferHook(request);
  const pin=rows.find(row=>row.documentId===request.documentId);
  return state.transferAllowed===true&&request.transfer==='complete-file'&&request.purpose==='document-extraction'
   &&request.recipient.kind==='docling'&&request.recipient.destination===state.parserDestination
   &&request.documentRevision===pin?.revision&&request.documentVersion===pin?.documentVersion&&libraryReadHash(request.target)===libraryReadHash(pin?.asset);
 }:undefined;
 const responses=script?script(rows):[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset,expectedToolNames:names},stop];
 const engineAdapter=createWorkspaceOmpEngineAdapter({paths:workspaceOmpPaths({}),configuration:{providerId:MODEL.provider,model:MODEL.id,baseUrl:MODEL.baseUrl},enterpriseContext:true,
  pluginConfiguration,syntheticResponses:responses,onWorkerLifecycle:event=>{lifecycle.push(event);life(event,state,f);}});
 const policy={enabled:true,reviewed:true,workspaceId:'pi-enterprise-test',subject:'member-a',expiresAt:'2099-01-01T00:00:00.000Z',recipient:RECIPIENT,company:null,products:[],productFields:['name'],
  factoryMaterials:{products:[],productFields:['name'],documents:rows.map(row=>({id:row.documentId,revision:1,documentVersion:1,asset:row.asset}))}};
 const bindingOptions=()=>({recipient:RECIPIENT,selection:{enabled:true,reviewed:true,customerId:'customer-'+state.customer,sources:allSources?rows:[rows[state.customer==='A'?0:1]]},connection:missing?{}:connection,authorizeParserTransfer});
 f=await taskFixture(t,{directory,enterprise:true,libraryModelReadPolicy:noLibrary?null:policy,businessAgentOptions:{recipient:RECIPIENT,engineAdapter,
  resolveBinding:async({actor,sessionReadonlyClient})=>{state.identity=actor;return {client:sessionReadonlyClient(actor),model:MODEL,enterpriseContextHost:await f.app.enterpriseContextSessionBinding(actor,bindingOptions())};}}});
 t.after(async()=>{await f.app.close();await fs.rm(directory,{recursive:true,force:true});});
 return Object.assign(f,{rows,state,lifecycle,bindingOptions,responses,connection});
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
for(const mutation of ['revision','archive','delete','withdraw-asset'])test('two-source status refuses non-first '+mutation+' after worker exit at Node final disclosure',{timeout:60000},async t=>{
 const text='SYNTHETIC_TWO_SOURCE_STATUS_WITHHELD';
 const f=await fixture(t,{allSources:true,script:()=>[{tool:'workspace_enterprise_context_status',arguments:{}},{text}],life:(event,state)=>{if(event.phase==='exit'&&event.code===0)state.afterExit=true;}});
 const download=f.app.artifacts.download;let changed=false;
 f.app.artifacts.download=async(...args)=>{const file=await download(...args);if(f.state.afterExit&&!changed){
  changed=true;assert.equal(args[0],f.rows[0].asset.artifactId);
  await f.app.store.update(state=>{const documents=state.businessLibrary.documents,index=documents.findIndex(row=>row.id===f.rows[1].documentId),second=documents[index];
   if(mutation==='revision')second.revision++;
   else if(mutation==='archive')second.status='archived';
   else if(mutation==='delete')documents.splice(index,1);
   else state.artifacts.find(row=>row.id===f.rows[1].asset.artifactId).metadata.businessLibrary.visibility='withdrawn';
  });
 }return file;};
 const cid=await conversation(f),run=await send(f,cid);
 assert.equal(changed,true);assert.ok(f.lifecycle.some(event=>event.phase==='exit'&&event.code===0));assert.equal(calls(run),2);assert.equal(f.state.calls,0);
 const first=f.app.businessLibrary.getDocument(f.rows[0].documentId).document;assert.equal(first.status,'active');assert.equal(first.revision,1);
 assert.equal(run.status,'failed',JSON.stringify({error:run.error,mutation}));assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');
 assert.ok(!f.app.store.read().messages.some(row=>row.content?.includes(text)));
 const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_status').message.details;
 assert.equal(receipt.sources.length,2);assert.deepEqual(receipt.authorization.sources,receipt.sources);
});
test('two-source status preserves the complete disclosed list across native Session continuation',{timeout:60000},async t=>{
 const f=await fixture(t,{allSources:true,script:()=>[{tool:'workspace_enterprise_context_status',arguments:{}},stop]}),cid=await conversation(f);
 assert.equal((await send(f,cid)).status,'succeeded');const first=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_status').message.details;
 assert.equal(first.sources.length,2);assert.deepEqual(first.authorization.sources,first.sources);
 assert.equal((await send(f,cid)).status,'succeeded');assert.equal(f.state.calls,0);
});
for(const legacy of ['missing','truncated'])test('two-source status refuses '+legacy+' proof coverage before another model',{timeout:60000},async t=>{
 const f=await fixture(t,{allSources:true,script:()=>[{tool:'workspace_enterprise_context_status',arguments:{}},stop]}),cid=await conversation(f);
 assert.equal((await send(f,cid)).status,'succeeded');const entries=await journal(f,cid);
 const alter=proof=>{if(proof?.kind!=='status')return;if(legacy==='missing')delete proof.sources;else proof.sources=proof.sources.slice(0,1);};
 for(const entry of entries){if(entry.customType==='workspace-plugin-disclosure-snapshot')for(const proof of entry.data.snapshot.proofs)alter(proof);
  if(entry.message?.toolName==='workspace_enterprise_context_status'){alter(entry.message.details.authorization);entry.message.content[0].text=JSON.stringify(entry.message.details);}}
 const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;await fs.writeFile(map.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,0);
});
test('unscreened legacy single-source parse refuses native continuation',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');const entries=await journal(f,cid);
 for(const entry of entries){if(entry.customType==='workspace-plugin-disclosure-snapshot')for(const proof of entry.data.snapshot.proofs)if(proof.kind==='parse'){delete proof.sources;delete proof.credentialScreening;}
  if(entry.message?.toolName==='workspace_enterprise_context_parse_upload'){delete entry.message.details.authorization.sources;delete entry.message.details.authorization.credentialScreening;entry.message.content[0].text=JSON.stringify(entry.message.details);}}
 const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;await fs.writeFile(map.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,1);
});
test('Node refuses a credential-bearing cached body before accepting its valid body hash',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 const clean=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message.details;
 const {authorization,...body}=clean;body.text='SYNTHETIC_NODE_ONLY_CACHE_FIXTURE '+encodeURIComponent(f.state.doclingSecret);
 const proof={...authorization,bodyHash:libraryReadHash(body)},binding=await f.app.enterpriseContextSessionBinding(f.state.identity,f.bindingOptions());
 const control=binding.open(proof.nativeSessionId);
 assert.throws(()=>control.verifyBody(proof,{...body,authorization:proof}),error=>error.code==='OSS_CREDENTIAL_ECHO_REFUSED');
 // The deliberately unsafe legacy-shaped fixture exists only in Node memory;
 // it was never written to a Session, sent to the worker or submitted to a model.
 const strings=[...stringsIn(await journal(f,cid)),...stringsIn(f.app.store.read())];
 assert.equal(strings.some(text=>text.includes(f.state.doclingSecret)||text.includes(encodeURIComponent(f.state.doclingSecret))),false);
});
const echoes={
 raw:key=>key,uri:key=>encodeURIComponent(key),json:key=>JSON.stringify(key).slice(1,-1),
 unicode:key=>[...key].map(char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join(''),
 html:key=>[...key].map(char=>'&#'+char.charCodeAt(0)+';').join(''),
 base64:key=>Buffer.from(key).toString('base64'),base64url:key=>Buffer.from(key).toString('base64url'),hex:key=>Buffer.from(key).toString('hex'),
 'base64-error-phrase':key=>Buffer.from('An upstream error echoes '+key+' in context.').toString('base64'),
};
function stringsIn(value){if(typeof value==='string')return [value];if(value&&typeof value==='object')return Object.values(value).flatMap(stringsIn);return [];}
for(const [encoding,encode]of Object.entries(echoes))test('Node refuses HTTP200 Docling '+encoding+' credential echo before worker/model disclosure',{timeout:60000},async t=>{
 const marker='SYNTHETIC_REJECTED_SERVICE_BODY';const f=await fixture(t,{script:rows=>[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset},
  {text:'SYNTHETIC credential-bearing result was refused.',forbiddenContextText:marker}]}),cid=await conversation(f);
 const encoded=encode(f.state.doclingSecret);f.state.responseText=marker+' '+encoded;
 const run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,1);assert.equal(calls(run),2);
 const entries=await journal(f,cid),receipt=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.isError,true,'credential-bearing output reached worker');assert.equal(receipt.details.reason,'OSS_CREDENTIAL_ECHO_REFUSED');
 assert.equal(Object.hasOwn(receipt.details,'text'),false);assert.equal(Object.hasOwn(receipt.details,'authorization'),false);
 const strings=[...stringsIn(entries),...stringsIn(f.app.store.read())],leaked=strings.some(text=>text.includes(f.state.doclingSecret)||text.includes(encoded)||text.includes(marker));
 assert.equal(leaked,false,'credential or upstream body entered worker Session/model/final channels');
});
for(const channel of ['success-errors-array','http-error-body'])test('Node contains credential echoes in Docling '+channel,{timeout:60000},async t=>{
 const marker='SYNTHETIC_PRIVATE_UPSTREAM_ERROR';const f=await fixture(t,{script:rows=>[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset},
  {text:'SYNTHETIC upstream error safely refused.',forbiddenContextText:marker}]}),cid=await conversation(f);
 f.state.responsePayload={status:'success',document:{text_content:'Synthetic ordinary text'},errors:[marker+' '+encodeURIComponent(f.state.doclingSecret)]};
 if(channel==='http-error-body')f.state.responseStatus=503;
 const run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,1);
 const entries=await journal(f,cid),receipt=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,channel==='success-errors-array'?'OSS_CREDENTIAL_ECHO_REFUSED':'DOCLING_UPSTREAM_REFUSED');
 assert.equal(Object.hasOwn(receipt.details,'text'),false);
 const strings=[...stringsIn(entries),...stringsIn(f.app.store.read())];
 assert.equal(strings.some(text=>text.includes(f.state.doclingSecret)||text.includes(encodeURIComponent(f.state.doclingSecret))||text.includes(marker)),false,'upstream error crossed Node boundary');
});

async function compact(f,cid,legacy=false){
 const mapping=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/enterprise-context-compact.mjs',mapping.sessionFile,...legacy?['--legacy-summary']:[]],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 let out='';child.stdout.on('data',data=>out+=data);child.stderr.resume();
 assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,'SDK compaction failed');const result=JSON.parse(out);assert.equal(result.privateMessages,0);if(legacy)assert.equal(result.summaryContainsLegacyBody,true);
}
test('legacy unscreened credential parse compaction refuses restore before any model request',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 const entries=await journal(f,cid),receipt=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 const {authorization,...body}=receipt.details;body.text='SYNTHETIC_LEGACY_UNSCREENED '+f.state.doclingSecret;
 const old={...authorization,bodyHash:libraryReadHash(body)};delete old.sources;delete old.credentialScreening;
 receipt.details={...body,authorization:old};receipt.content[0].text=JSON.stringify(receipt.details);
 for(const entry of entries)if(entry.customType==='workspace-plugin-disclosure-snapshot')entry.data.snapshot.proofs=entry.data.snapshot.proofs.map(proof=>proof.kind==='parse'?old:proof);
 const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 await fs.writeFile(map.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');await compact(f,cid,true);
 const before=await fs.readFile(map.sessionFile,'utf8');
 f.responses.splice(0,f.responses.length,{text:'SYNTHETIC should never run',expectedContextText:'SYNTHETIC_LEGACY_UNSCREENED'});
 const run=await send(f,cid);assert.equal(calls(run),0,'legacy summary reached a model request');assert.equal(run.status,'failed');assert.equal(f.state.calls,1);
 assert.ok(f.lifecycle.some(event=>event.phase==='rpc-refused'&&event.operation==='check'&&event.code==='OSS_PRIVATE_CREDENTIAL_SCREEN_REQUIRED'));
 // Preserve original journal, including the synthetic legacy record, without printing its value.
 assert.equal((await fs.readFile(map.sessionFile,'utf8')).startsWith(before),true);
});
test('screened parse restores same compacted SDK Session without parsing again',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');
 const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 await compact(f,cid);f.responses.splice(0,f.responses.length,{text:'SYNTHETIC safe compacted continuation',expectedContextText:'SYNTHETIC_DOC_SUMMARY_RETAINS_ORIGINAL_SOURCE_OBLIGATIONS'});
 const run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(calls(run),1);assert.equal(f.state.calls,1);
 assert.equal(f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession.agentSessionId,map.agentSessionId);
});

for(const mutation of ['flag-only','forged-mac','changed-body','changed-session'])test('screening evidence refuses '+mutation+' before model restore',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);assert.equal((await send(f,cid)).status,'succeeded');const entries=await journal(f,cid);
 const alter=proof=>{if(proof.kind!=='parse')return;
  if(mutation==='flag-only')proof.credentialScreening={policy:'known-docling-credential-v1'};
  if(mutation==='forged-mac')proof.credentialScreening.mac='0'.repeat(64);
  if(mutation==='changed-body')proof.bodyHash='1'.repeat(64);
  if(mutation==='changed-session')proof.nativeSessionId='synthetic-foreign-native-session';
 };
 for(const entry of entries){if(entry.customType==='workspace-plugin-disclosure-snapshot')for(const proof of entry.data.snapshot.proofs)alter(proof);
  if(entry.message?.toolName==='workspace_enterprise_context_parse_upload'){alter(entry.message.details.authorization);entry.message.content[0].text=JSON.stringify(entry.message.details);}}
 const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;await fs.writeFile(map.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 await compact(f,cid);const run=await send(f,cid);assert.equal(run.status,'failed');assert.equal(calls(run),0);assert.equal(f.state.calls,1);
});

test('model-read grant alone never authorizes complete original file transfer',{timeout:60000},async t=>{
 const f=await fixture(t,{transfer:false}),cid=await conversation(f);let downloads=0;const download=f.app.artifacts.download;
 f.app.artifacts.download=async(...args)=>{downloads++;return download(...args);};const run=await send(f,cid);assert.equal(downloads,0);
 assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,0);
 const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'OSS_DOCLING_TRANSFER_NOT_APPROVED');assert.equal(receipt.details.authorization,undefined);
});
test('actual Host passes exact file document version SHA recipient purpose to live transfer check',{timeout:60000},async t=>{
 const f=await fixture(t),run=await send(f,await conversation(f));assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,1);
 assert.ok(f.state.transferChecks.some(row=>row.action==='upload.dispatch'));assert.ok(f.state.transferChecks.some(row=>row.action==='upload.return'));
 for(const check of f.state.transferChecks){assert.deepEqual(check.target,f.rows[0].asset);assert.equal(check.documentId,f.rows[0].documentId);assert.equal(check.documentRevision,1);assert.equal(check.documentVersion,1);
  assert.equal(check.recipient.destination,f.state.parserDestination);assert.equal(check.transfer,'complete-file');assert.equal(check.purpose,'document-extraction');assert.equal(check.sessionId,f.state.identity.sessionId);}
});
for(const stage of ['before-read','after-download','after-return','cached-resume'])test('complete-file transfer revocation '+stage+' is live checked',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);
 if(stage==='before-read')f.state.transferAllowed=false;
 if(stage==='after-download'){const download=f.app.artifacts.download;f.app.artifacts.download=async(...args)=>{const file=await download(...args);f.state.transferAllowed=false;return file;};}
 if(stage==='after-return')f.state.responseHook=()=>{f.state.transferAllowed=false;};
 if(stage==='cached-resume'){assert.equal((await send(f,cid)).status,'succeeded');f.state.transferAllowed=false;}
 const run=await send(f,cid);assert.equal(f.state.calls,['after-return','cached-resume'].includes(stage)?1:0);
 if(stage==='cached-resume'){assert.equal(run.status,'failed');assert.equal(calls(run),0);}
 else {assert.equal(run.status,'succeeded',JSON.stringify(run.error));const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
  assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'OSS_DOCLING_TRANSFER_NOT_APPROVED');assert.equal(receipt.details.text,undefined);assert.equal(receipt.details.authorization,undefined);}
});
for(const stage of ['new-binding','after-download'])test('parser recipient change '+stage+' never inherits complete-file transfer consent',{timeout:60000},async t=>{
 const f=await fixture(t),download=f.app.artifacts.download;
 if(stage==='new-binding')f.connection.baseURL='http://127.0.0.1:9';
 else f.app.artifacts.download=async(...args)=>{const file=await download(...args);f.state.parserDestination='http://127.0.0.1:9/v1/convert/file';f.connection.baseURL='http://127.0.0.1:9';return file;};
 const cid=await conversation(f),run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,0);
 const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.details.reason,'OSS_DOCLING_TRANSFER_NOT_APPROVED');
});
for(const mutation of ['document-version','artifact-version','artifact-sha'])test('full-file dispatch refuses '+mutation+' change during live consent check',{timeout:60000},async t=>{
 const f=await fixture(t);let changed=false;
 f.state.transferHook=async request=>{if(request.action!=='upload.dispatch'||changed)return;changed=true;await f.app.store.update(state=>{
  if(mutation==='document-version')state.businessLibrary.documents.find(row=>row.id===f.rows[0].documentId).currentVersion++;
  if(mutation==='artifact-version')state.businessLibrary.documents.find(row=>row.id===f.rows[0].documentId).versions[0].asset.version++;
  if(mutation==='artifact-sha')state.artifacts.find(row=>row.id===f.rows[0].asset.artifactId).versions[0].sha256='e'.repeat(64);
 });};
 const run=await send(f,await conversation(f));assert.equal(changed,true);assert.equal(run.status,'failed');assert.equal(f.state.calls,0);
});
test('original Run cancellation aborts a pending transfer check before file egress',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);let entered,grantAborted=false;const pending=new Promise(resolve=>entered=resolve);
 f.state.transferHook=request=>new Promise(()=>{request.signal.addEventListener('abort',()=>{grantAborted=true;},{once:true});entered();});
 const work=send(f,cid);await pending;assert.equal((await f.workspace(`/api/conversations/${cid}/cancel`,{subject:'member-a',body:{}})).status,200);
 const run=await work;assert.equal(run.status,'cancelled');assert.equal(f.state.calls,0);assert.equal(grantAborted,true);
});
test('live transfer check timeout is bounded and never dispatches late consent',{timeout:60000},async t=>{
 const f=await fixture(t,{timeoutMs:30}),cid=await conversation(f);let aborted=false;
 f.state.transferHook=request=>new Promise(resolve=>{request.signal.addEventListener('abort',()=>{aborted=true;},{once:true});setTimeout(resolve,120);});
 const run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(aborted,true);assert.equal(f.state.calls,0);
 const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'DOCLING_TIMEOUT');assert.equal(receipt.details.authorization,undefined);
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(f.state.calls,0);
});

test('live transfer checker exceptions keep private diagnostics out of SDK and journal',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);f.state.transferHook=()=>{throw Error('SYNTHETIC_PRIVATE_GRANT_DIAGNOSTIC '+f.state.doclingSecret);};
 const run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.state.calls,0);
 const entries=await journal(f,cid),receipt=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.details.reason,'OSS_DOCLING_TRANSFER_NOT_APPROVED');assert.equal(receipt.details.authorization,undefined);
 assert.equal([...stringsIn(entries),...stringsIn(f.app.store.read())].some(text=>text.includes(f.state.doclingSecret)||text.includes('SYNTHETIC_PRIVATE_GRANT_DIAGNOSTIC')),false);
});
