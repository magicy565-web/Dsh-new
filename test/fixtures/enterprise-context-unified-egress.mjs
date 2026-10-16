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
const hash=x=>createHash('sha256').update(x).digest('hex');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],assets=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const bytes=ids.map((_,i)=>Buffer.from('SYNTHETIC original '+i)),identity={workspaceId:'synthetic-workspace',subject:'member',role:'admin',sessionId:'synthetic-session'};
const resuming=mode.startsWith('cross-')&&mode!=='cross-seed';
if(!resuming)await store.update(state=>{state.conversations.push({id:'conv',activeRunId:'run-1',businessAgentOwner:identity});state.runs.push({id:'run-1',conversationId:'conv',requestId:'request-1',status:'running',businessAgentContext:identity});state.messages.push({id:'user-1',conversationId:'conv',requestId:'request-1',role:'user',status:'complete',content:'Synthetic original turn'});
 state.artifacts=assets.map((id,i)=>({id,metadata:{businessLibrary:{visibility:'internal'}},versions:[{version:1,sha256:hash(bytes[i])}]}));state.businessLibrary.documents=ids.map((id,i)=>({id,revision:1,currentVersion:1,status:'active',versions:[{version:1,asset:{artifactId:assets[i],version:1,sha256:hash(bytes[i])}}]}));});
const selection={enabled:true,reviewed:true,customerId:'synthetic-buyer',allowMemoryRead:true,allowMemoryWrite:true,sources:store.read().businessLibrary.documents.map(row=>({documentId:row.id,asset:row.versions[0].asset}))};
const configuration={providerId:'synthetic-egress',model:'finite',baseUrl:'https://synthetic.invalid'},model={provider:configuration.providerId,id:configuration.model,baseUrl:configuration.baseUrl};
const secret=mode==='cross-rotated'?'synthetic-rotated-parser-value':'synthetic-parser-value-without-provider-prefix',instanceId=mode==='cross-new-instance'?'synthetic-new-instance':'synthetic-instance',query={subjectType:'customer',subjectId:'buyer',factKey:'terms'};
let live=true,policy=true,inPrompt=false,armed=false,mutated=false,wire=0,first,second;
const access={mode:'enterprise',nativeSessionById:()=>live?identity:null};
const library={getProduct:()=>({}),getDocument:()=>({})},ledger=createEnterpriseMemoryLedger({store,library,workspaceId:identity.workspaceId});
const sourceService={factoryDocumentForSession({asset}){const pin=selection.sources.find(x=>x.asset.artifactId===asset.artifactId),doc=store.read().businessLibrary.documents.find(row=>row.id===pin?.documentId);if(!policy||!doc||doc.status!=='active'||doc.revision!==1)throw Error('SYNTHETIC_SOURCE_REVOKED');return {documentId:doc.id,revision:doc.revision,documentVersion:1,authorization:{scopeFingerprint:'synthetic-library-scope',expiresAt:'2099-01-01T00:00:00Z'}};}};
const makeHost=()=>createEnterpriseContextSessionBinding({identity,access,instanceId,sessionClient:{readOnlySession:true,bindingIdentity:async()=>{await Promise.resolve();if(armed&&mode==='source-authorize')await mutate();return {...identity,instanceId};}},libraryModelRead:sourceService,artifacts:{download:async id=>({bytes:bytes[assets.indexOf(id)],mimeType:'text/plain',version:{sha256:hash(bytes[assets.indexOf(id)])}})},store,memoryLedger:ledger,selection,recipient:{kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl},connection:mode==='cross-unconfigured'?{}:{reviewed:true,baseURL:'http://127.0.0.1:5001',apiKey:secret,fetchImpl:async()=>{throw Error('NO_PARSE_EXPECTED');}},authorizeParserTransfer:async()=>true,turnContext:{conversationId:'conv',runId:'run-1',requestId:'request-1'}});
async function mutate(){if(!armed)return;armed=false;await Promise.resolve();mutated=true;
 if(mode.includes('source'))await store.update(state=>{state.businessLibrary.documents[1].status='archived';});
 else if(mode.includes('policy'))policy=false;
 else if(mode.includes('revoke'))live=false;
 else if(mode.includes('memory'))await store.update(state=>{state.businessLibrary.enterpriseMemories[0].statement='Synthetic concurrent changed fact';});
}
const base={packageRoot:paths.packageRoot,cwd:root,agentDir:root+'/agent',sessionDirectory:root+'/sessions',configuration,pluginConfiguration:{configuration:'config.enterprise-context.json'}};
const RequestOriginal=globalThis.Request;
globalThis.fetch=async()=>{throw Error('LIVE_NETWORK_FORBIDDEN');};
try{
 let saved;
 if(!resuming){
 const host=await makeHost();
 first=await createWorkspaceOmpSession({...base,enterpriseContextHost:host,syntheticResponses:[{tool:'workspace_enterprise_context_structured_memory_remember',arguments:{...query,statement:'Synthetic source-bound memory.'}},{text:'Synthetic setup complete.'}]});
 await first.session.prompt('Record a synthetic fact.');await first.manager.flush();
 assert.equal(first.session.messages.filter(row=>row.role==='toolResult').at(-1).isError,false);
 saved={sessionFile:first.manager.getSessionFile(),agentSessionId:first.manager.getSessionId(),engineScope:first.engineScope};await first.close();first=null;
 await fs.writeFile(root+'/synthetic-session-mapping.json',JSON.stringify(saved));
 }else saved=JSON.parse(await fs.readFile(root+'/synthetic-session-mapping.json','utf8'));
 if(mode==='cross-seed'){console.log(JSON.stringify({mode,pid:process.pid,nativeSessionId:saved.agentSessionId,seeded:true,realModelRequests:0}));}
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
 globalThis.fetch=async()=>{wire++;if(mode==='wire-error')return new Response('{}',{status:500});const frame={id:'synthetic-sse',model:'finite',choices:[{index:0,delta:{role:'assistant',content:'SYNTHETIC_MODEL_DISPATCH'},finish_reason:null}]},end={...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 if(mode.endsWith('-fetch'))globalThis.Request=class extends RequestOriginal{clone(){const copy=super.clone(),read=copy.text.bind(copy);copy.text=async()=>{const text=await read();if(inPrompt)await mutate();return text;};return copy;}};
 let error;
 try{
  second=await createWorkspaceOmpSession({...base,savedSession:saved,enterpriseContextHost:await makeHost(),configuration:{...configuration,apiKey:'synthetic-offline-sdk-value',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
   onModelRequest:async()=>{armed=mode.endsWith('-model')||mode==='source-authorize'||mode.endsWith('-fetch');if(mode.endsWith('-model'))await mutate();}});
  inPrompt=true;await second.session.prompt('Read the restored synthetic memory.');
 }catch(e){error=e;}
 const allowed=['wire-safe','wire-error','cross-resume'].includes(mode);
 assert.equal(wire,allowed?1:0,error?.message);assert.equal(second?.modelCalls()||0,allowed?1:0);
 if(mode.endsWith('-model')||mode==='source-authorize'||mode.endsWith('-fetch'))assert.equal(mutated,true,'Exact asynchronous mutation window must be reached.');
 console.log(JSON.stringify({mode,pid:process.pid,nativeSessionId:saved.agentSessionId,mutated,mockFetches:wire,admittedModelCalls:second?.modelCalls()||0,originalHost:true,actualNativeSession:true,realStore:true,blocked:error!==undefined||second?.session.messages.at(-1)?.stopReason!=='stop',realModelRequests:0}));
}
}finally{globalThis.Request=RequestOriginal;await first?.close();await second?.close();await store.close();if(!process.argv[3])await fs.rm(root,{recursive:true,force:true});}
