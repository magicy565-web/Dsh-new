// Actual original Node Host and official SDK with real openStore; identities,
// Library policy service, bytes and HTTP/SSE are explicit bounded stand-ins.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openStore} from '../../server/store.mjs';
import {createEnterpriseMemoryLedger} from '../../server/enterprise-memory-ledger.mjs';
import {createEnterpriseContextSessionBinding} from '../../server/workspace-enterprise-context-host.mjs';
import {createWorkspaceOmpSession} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const mode=process.argv[2],root=process.argv[3]||await fs.mkdtemp('/tmp/unified-egress-'),store=await openStore(root+'/data'),paths=workspaceOmpPaths({});
const writerRace=mode==='compact-race-updated-fetch'||mode==='compact-empty-race-added-fetch',writerFault=process.argv[4]||null;
if(writerFault&&(!writerRace||process.argv[3]||!['write-failed','write-throws','wrong-revision','not-persisted'].includes(writerFault)))throw Error('INVALID_SYNTHETIC_WRITER_FAULT');
const writerTurnMessage='Synthetic revision two from another conversation';
let writerAttempts=0,writerCompleted=false,writerError=null,writerResult=null,writerSessionId=null,writerSessionFile=null,writerStopReason=null,writerEvidence=null;
const hash=x=>createHash('sha256').update(x).digest('hex');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],assets=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const bytes=ids.map((_,i)=>Buffer.from('SYNTHETIC original '+i)),identity={workspaceId:'synthetic-workspace',subject:'member',role:'admin',sessionId:'synthetic-session'};
const resuming=mode.startsWith('cross-')&&mode!=='cross-seed';
if(!resuming)await store.update(state=>{state.conversations.push({id:'conv',activeRunId:'run-1',businessAgentOwner:identity});state.runs.push({id:'run-1',conversationId:'conv',requestId:'request-1',status:'running',businessAgentContext:identity});state.messages.push({id:'user-1',conversationId:'conv',requestId:'request-1',role:'user',status:'complete',content:'Synthetic original turn'});
 state.artifacts=assets.map((id,i)=>({id,metadata:{businessLibrary:{visibility:'internal'}},versions:[{version:1,sha256:hash(bytes[i])}]}));state.businessLibrary.documents=ids.map((id,i)=>({id,revision:1,currentVersion:1,status:'active',versions:[{version:1,asset:{artifactId:assets[i],version:1,sha256:hash(bytes[i])}}]}));});
const selection={enabled:true,reviewed:true,customerId:'synthetic-buyer',allowMemoryRead:true,allowMemoryWrite:true,sources:store.read().businessLibrary.documents.map(row=>({documentId:row.id,asset:row.versions[0].asset}))};
const configuration={providerId:'synthetic-egress',model:'finite',baseUrl:'https://synthetic.invalid'},model={provider:configuration.providerId,id:configuration.model,baseUrl:configuration.baseUrl};
const secret=mode==='cross-rotated'?'synthetic-rotated-parser-value':'synthetic-parser-value-without-provider-prefix',instanceId=mode==='cross-new-instance'?'synthetic-new-instance':'synthetic-instance',query={subjectType:'customer',subjectId:'buyer',factKey:'terms'};
let live=true,policy=true,inPrompt=false,armed=false,mutated=false,wire=0,first,second,writer,compactText=null,summaryReachedMock=false,originalSessionId=null;
let activeTurn={conversationId:'conv',runId:'run-1',requestId:'request-1'};
const access={mode:'enterprise',nativeSessionById:()=>live?identity:null};
const library={getProduct:()=>({}),getDocument:()=>({})},ledger=createEnterpriseMemoryLedger({store,library,workspaceId:identity.workspaceId});
const sourceService={factoryDocumentForSession({asset}){const pin=selection.sources.find(x=>x.asset.artifactId===asset.artifactId),doc=store.read().businessLibrary.documents.find(row=>row.id===pin?.documentId);if(!policy||!doc||doc.status!=='active'||doc.revision!==1)throw Error('SYNTHETIC_SOURCE_REVOKED');return {documentId:doc.id,revision:doc.revision,documentVersion:1,authorization:{scopeFingerprint:'synthetic-library-scope',expiresAt:'2099-01-01T00:00:00Z'}};}};
const makeHost=(turnContext=activeTurn)=>createEnterpriseContextSessionBinding({identity,access,instanceId,sessionClient:{readOnlySession:true,bindingIdentity:async()=>{await Promise.resolve();if(armed&&mode==='source-authorize')await mutate();return {...identity,instanceId};}},libraryModelRead:sourceService,artifacts:{download:async id=>({bytes:bytes[assets.indexOf(id)],mimeType:'text/plain',version:{sha256:hash(bytes[assets.indexOf(id)])}})},store,memoryLedger:ledger,selection,recipient:{kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl},connection:mode==='cross-unconfigured'?{}:{reviewed:true,baseURL:'http://127.0.0.1:5001',apiKey:secret,fetchImpl:async()=>{throw Error('NO_PARSE_EXPECTED');}},authorizeParserTransfer:async()=>true,turnContext});
async function mutate(){if(!armed)return;armed=false;await Promise.resolve();
 if(writerRace){await writeRevisionTwo(mode==='compact-race-updated-fetch'?2:1);return;}
 mutated=true;
 if(mode.includes('source'))await store.update(state=>{state.businessLibrary.documents[1].status='archived';});
 else if(mode.includes('policy'))policy=false;
 else if(mode.includes('revoke'))live=false;
 else if(mode.includes('memory'))await store.update(state=>{state.businessLibrary.enterpriseMemories[0].statement='Synthetic concurrent changed fact';});
}
const base={packageRoot:paths.packageRoot,cwd:root,agentDir:root+'/agent',sessionDirectory:root+'/sessions',configuration,pluginConfiguration:{configuration:'config.enterprise-context.json'}};
async function writeRevisionTwo(expectedRevision=2){
 writerAttempts++;
 try{
  const beforeRows=store.read().businessLibrary.enterpriseMemories;
  await store.update(state=>{state.conversations.push({id:'conv-b',activeRunId:'run-b',businessAgentOwner:identity});state.runs.push({id:'run-b',conversationId:'conv-b',requestId:'request-b',status:'running',businessAgentContext:identity});state.messages.push({id:'user-b',conversationId:'conv-b',requestId:'request-b',role:'user',status:'complete',content:writerTurnMessage});});
  const statement=expectedRevision===1?'Synthetic newly created memory.':'Synthetic source-bound revision two.';
  const finalWrite={tool:'workspace_enterprise_context_structured_memory_remember',arguments:{...query,statement:writerFault==='write-failed'?'':statement}};
  const script=[...(writerFault==='wrong-revision'?[{tool:finalWrite.tool,arguments:{...query,statement:statement+' Synthetic intermediate write.'}}]:[]),finalWrite,{text:'Synthetic second Session completed.'}];
  writer=await createWorkspaceOmpSession({...base,enterpriseContextHost:await makeHost({conversationId:'conv-b',runId:'run-b',requestId:'request-b'}),syntheticResponses:script});
  writerSessionId=writer.manager.getSessionId();writerSessionFile=writer.manager.getSessionFile();
  if(writerFault==='write-throws')throw Error('SYNTHETIC_B_WRITE_REJECTED');
  await writer.session.prompt('Record a fact in a separate original Session and Run.');await writer.manager.flush();
  writerResult=structuredClone(writer.session.messages.filter(row=>row.role==='toolResult').at(-1));writerStopReason=writer.session.messages.at(-1)?.stopReason;
  await writer.close();writer=null;
  if(writerFault==='not-persisted'){
   // Negative oracle control only: retain a genuine successful receipt and live
   // Store projection, but remove B's durable rows from this private fixture.
   // This is deliberate disk data loss, not a claim that openStore fake-succeeds.
   const file=root+'/data/workspace.json',disk=JSON.parse(await fs.readFile(file,'utf8'));
   disk.businessLibrary.enterpriseMemories=beforeRows;await fs.writeFile(file,JSON.stringify(disk));
  }
  writerCompleted=true;
 }catch(error){writerError=error;throw error;}
}
// This oracle must run outside A's expected-failure catch, including when B's
// work/SDK assertions would otherwise be swallowed by Request.text()/permit.
async function verifyWriter(expectedRevision){
 assert.equal(writerAttempts,1,'B_ATTEMPT_REQUIRED');assert.ok(!writerError,'B_WRITE_FAILED');assert.equal(writerCompleted,true,'B_WRITE_INCOMPLETE');
 assert.notEqual(writerSessionId,originalSessionId,'B_SESSION_NOT_DISTINCT');assert.equal(writerStopReason,'stop','B_SESSION_INCOMPLETE');
 assert.ok(writerResult,'B_RECEIPT_REQUIRED');assert.equal(writerResult.isError,false,'B_TOOL_FAILED');
 assert.equal(writerResult.toolName,'workspace_enterprise_context_structured_memory_remember','B_TOOL_MISMATCH');
 const receipt=writerResult.details;assert.ok(receipt?.memory,'B_MEMORY_RECEIPT_REQUIRED');
 assert.deepEqual(JSON.parse(writerResult.content.filter(row=>row.type==='text').map(row=>row.text).join('\n')),receipt,'B_TEXT_DETAILS_MISMATCH');
 assert.equal(receipt.operation,'structuredMemoryRemember','B_OPERATION_MISMATCH');assert.equal(receipt.authorization?.kind,'memory','B_PROOF_REQUIRED');
 assert.equal(receipt.authorization.nativeSessionId,writerSessionId,'B_PROOF_SESSION_MISMATCH');
 const row=store.read().businessLibrary.enterpriseMemories.find(value=>value.id===receipt.memory.id);
 assert.ok(row,'B_STORE_ROW_REQUIRED');assert.equal(row.revision,expectedRevision,'B_REVISION_MISMATCH');
 assert.equal(row.status,'active','B_STATUS_MISMATCH');assert.equal(row.workspaceId,identity.workspaceId,'B_WORKSPACE_MISMATCH');assert.equal(row.audience,'internal','B_AUDIENCE_MISMATCH');
 for(const [key,value]of Object.entries(query))assert.equal(row[key],value,'B_QUERY_MISMATCH');
 assert.equal(row.statement,expectedRevision===1?'Synthetic newly created memory.':'Synthetic source-bound revision two.','B_STATEMENT_MISMATCH');
 const {credentialScreening,...source}=row.source;
 assert.deepEqual(source,{kind:'conversation',ref:'conv-b',revision:1,version:1,messageId:'user-b',runId:'run-b',sha256:hash(writerTurnMessage),dependencies:ids.map((ref,index)=>({kind:'document',ref,revision:1,version:1,sha256:hash(bytes[index]),artifactId:assets[index],artifactVersion:1}))},'B_SOURCE_MISMATCH');
 assert.equal(credentialScreening?.policy,'known-docling-credential-v1','B_SCREENING_REQUIRED');assert.match(credentialScreening.mac,/^[a-f0-9]{64}$/,'B_SCREENING_REQUIRED');
 assert.deepEqual(receipt.memory,row,'B_RECEIPT_STORE_MISMATCH');assert.deepEqual(receipt.authorization.memory,row,'B_PROOF_STORE_MISMATCH');
 const disk=JSON.parse(await fs.readFile(root+'/data/workspace.json','utf8')),persisted=disk.businessLibrary.enterpriseMemories.find(value=>value.id===row.id);
 assert.ok(persisted,'B_PERSISTENCE_MISSING');assert.deepEqual(persisted,row,'B_PERSISTENCE_MISMATCH');
 const journal=(await fs.readFile(writerSessionFile,'utf8')).trim().split('\n').map(JSON.parse),tool=journal.filter(entry=>entry.message?.toolName===writerResult.toolName).at(-1)?.message;
 assert.equal(tool?.isError,false,'B_JOURNAL_TOOL_FAILED');assert.deepEqual(tool.details,receipt,'B_JOURNAL_RECEIPT_MISMATCH');assert.deepEqual(tool.content,writerResult.content,'B_JOURNAL_CONTENT_MISMATCH');
 writerEvidence={completed:true,verified:true,revision:expectedRevision,sourceRef:'conv-b',sourceRun:'run-b',sourceMessage:'user-b',sourceDependencies:2,storeMatchesReceipt:true,diskMatchesStore:true};
 if(writerRace)mutated=true;
}
const successReceipts=[];
const RequestOriginal=globalThis.Request;
globalThis.fetch=async()=>{throw Error('LIVE_NETWORK_FORBIDDEN');};
try{
 let saved;
 if(!resuming){
 const host=await makeHost();
 first=await createWorkspaceOmpSession({...base,enterpriseContextHost:host,syntheticResponses:[mode.startsWith('compact-empty-')?{tool:'workspace_enterprise_context_structured_memory_lookup',arguments:query}:{tool:'workspace_enterprise_context_structured_memory_remember',arguments:{...query,statement:'Synthetic source-bound memory.'}},{text:'Synthetic setup complete.'}]});
 await first.session.prompt('Record a synthetic fact.');await first.manager.flush();
 assert.equal(first.session.messages.filter(row=>row.role==='toolResult').at(-1).isError,false);
 if(mode.startsWith('compact-')){
  const observation=first.session.messages.find(row=>row.role==='toolResult'&&row.toolName?.startsWith('workspace_enterprise_context_structured_memory_')).details;
  if(mode.startsWith('compact-empty-'))assert.equal(observation.found,false);
  compactText=observation.memory?.statement||'SYNTHETIC_NO_MEMORY_FOUND';
  const last=first.manager.getBranch().filter(row=>row.type==='message').at(-1);
  first.manager.appendCompaction('SYNTHETIC_MEMORY_SUMMARY '+compactText,undefined,last.id,100,{fromExtension:true});await first.manager.flush();
  const context=first.manager.buildSessionContext().messages;
  assert.ok(JSON.stringify(context).includes(compactText));assert.equal(context.some(row=>row.role==='toolResult'&&row.toolName?.startsWith('workspace_enterprise_context_')),false);
 }
 saved={sessionFile:first.manager.getSessionFile(),agentSessionId:first.manager.getSessionId(),engineScope:first.engineScope};await first.close();first=null;originalSessionId=saved.agentSessionId;
 await fs.writeFile(root+'/synthetic-session-mapping.json',JSON.stringify(saved));
 }else saved=JSON.parse(await fs.readFile(root+'/synthetic-session-mapping.json','utf8'));
 if(mode==='cross-seed'){successReceipts.push({mode,pid:process.pid,nativeSessionId:saved.agentSessionId,seeded:true,realModelRequests:0});}
 else{
 if(mode.startsWith('legacy-')||mode==='forged-proof'||mode.startsWith('proof-')){
  const entries=(await fs.readFile(saved.sessionFile,'utf8')).trim().split('\n').map(JSON.parse),message=entries.find(row=>row.message?.toolName==='workspace_enterprise_context_structured_memory_remember').message;
  if(mode==='forged-proof')message.details.authorization.query.factKey='forged-key';
  else if(mode==='proof-native')message.details.authorization.nativeSessionId='foreign-native-session';
  else if(mode==='proof-scope')message.details.authorization.scopeHash='0'.repeat(64);
  else if(mode==='proof-revision')message.details.authorization.memory.revision++;
  else if(mode==='proof-source')message.details.authorization.sources[1].revision++;
  else if(mode==='proof-statement')message.details.authorization.statement='Synthetic substituted statement';
  else{message.details.memory.statement=mode==='legacy-plain'?secret:mode==='legacy-base64'?Buffer.from(secret).toString('base64'):Buffer.from(secret).toString('hex');delete message.details.authorization.credentialScreening;}
  message.content[0].text=JSON.stringify(message.details);await fs.writeFile(saved.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 }
 if(mode==='compact-updated'){await writeRevisionTwo();await verifyWriter(2);}
 if(mode==='compact-empty-added'){await writeRevisionTwo(1);await verifyWriter(1);}
 if(mode==='compact-revoked')await ledger.revoke(store.read().businessLibrary.enterpriseMemories[0].id,{reason:'Synthetic post-compaction revoke'},identity);
 if(mode.startsWith('compact-')){
  await store.update(state=>{state.runs.find(row=>row.id==='run-1').status='succeeded';state.conversations.find(row=>row.id==='conv').activeRunId='run-2';state.runs.push({id:'run-2',conversationId:'conv',requestId:'request-2',status:'running',businessAgentContext:identity});state.messages.push({id:'user-2',conversationId:'conv',requestId:'request-2',role:'user',status:'complete',content:'Synthetic new Run restores the compacted Session'});});
  activeTurn={conversationId:'conv',runId:'run-2',requestId:'request-2'};
 }
 const beforeRestore=mode.startsWith('compact-')?await fs.readFile(saved.sessionFile):null;
 globalThis.fetch=async request=>{if(mode.startsWith('compact-')){const body=await request.clone().text();summaryReachedMock=body.includes(compactText);assert.equal(summaryReachedMock,true,'The actual SDK body must include the compacted observation.');}wire++;if(mode==='wire-error')return new Response('{}',{status:500});const frame={id:'synthetic-sse',model:'finite',choices:[{index:0,delta:{role:'assistant',content:'SYNTHETIC_MODEL_DISPATCH'},finish_reason:null}]},end={...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 if(mode.endsWith('-fetch'))globalThis.Request=class extends RequestOriginal{clone(){const copy=super.clone(),read=copy.text.bind(copy);copy.text=async()=>{const text=await read();if(inPrompt)await mutate();return text;};return copy;}};
 let error;
 try{
  second=await createWorkspaceOmpSession({...base,savedSession:saved,enterpriseContextHost:await makeHost(),configuration:{...configuration,apiKey:'synthetic-offline-sdk-value',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
   onModelRequest:async()=>{armed=mode.endsWith('-model')||mode==='source-authorize'||mode.endsWith('-fetch');if(mode.endsWith('-model'))await mutate();}});
  inPrompt=true;await second.session.prompt('Read the restored synthetic memory.');
 }catch(e){error=e;}
 if(writerRace)await verifyWriter(mode==='compact-race-updated-fetch'?2:1);
 const allowed=['wire-safe','wire-error','cross-resume','compact-current','compact-empty-current'].includes(mode);
 if(mode.startsWith('compact-')){
  const rows=(await fs.readFile(saved.sessionFile,'utf8')).trim().split('\n').map(JSON.parse),before=beforeRestore.toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.slice(0,before.length),before,'Compacted A journal and its proofs must be preserved.');
 }
 assert.equal(wire,allowed?1:0,error?.message);assert.equal(second?.modelCalls()||0,allowed?1:0);
 if(mode.endsWith('-model')||mode==='source-authorize'||mode.endsWith('-fetch'))assert.equal(mutated,true,'Exact asynchronous mutation window must be reached.');
 if(mode.startsWith('compact-'))successReceipts.push({acceptance:'actual-sdk-memory-compaction',mode,summaryToolResults:0,currentRevision:store.read().businessLibrary.enterpriseMemories.at(-1)?.revision??null,summaryReachedMock,mockFetches:wire,admittedModelCalls:second?.modelCalls()||0,blocked:error!==undefined||second?.session.messages.at(-1)?.stopReason!=='stop',bMutation:writerEvidence,realModelRequests:0});
 successReceipts.push({mode,pid:process.pid,nativeSessionId:saved.agentSessionId,mutated,mockFetches:wire,admittedModelCalls:second?.modelCalls()||0,bMutation:writerEvidence,originalHost:true,actualNativeSession:true,realStore:true,blocked:error!==undefined||second?.session.messages.at(-1)?.stopReason!=='stop',realModelRequests:0});
}
}finally{globalThis.Request=RequestOriginal;await first?.close();await second?.close();await writer?.close();await store.close();if(!process.argv[3])await fs.rm(root,{recursive:true,force:true});}
for(const receipt of successReceipts)console.log(JSON.stringify(receipt));
