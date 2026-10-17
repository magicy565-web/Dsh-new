// Official OMP SDK/provider serialization with an original signed Host journal.
// The Node process owns real Store/Artifact/Access/Brain; only SSE is a stand-in.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspaceOmpSession} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const mode=process.argv[2],endpoint=process.argv[3],info=JSON.parse(await fs.readFile(process.argv[4],'utf8'));
const hostFetch=globalThis.fetch,RequestOriginal=globalThis.Request,paths=workspaceOmpPaths({});
let serialized=false,wire=0,session,error;
const rpc=async(method,value,model)=>{const r=await hostFetch(endpoint+'/brain/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value,model})});if(!r.ok)throw Error('ORIGINAL_CONTEXT_REFUSED');return r.json();};
const brainClient=Object.fromEntries(['sourceCatalog','contextRead','contextSave','diagnose','decisionRead','decisionSave','reviewSave','brief','revalidateReceipt'].map(method=>[method,(value,signal,model)=>rpc(method,value,model)]));
try{
 globalThis.Request=class extends RequestOriginal{clone(){const copy=super.clone(),read=copy.text.bind(copy);copy.text=async()=>{const body=await read();if(!serialized){serialized=true;const r=await hostFetch(endpoint+'/arm',{method:'POST'});assert.equal(r.status,200);}return body;};return copy;}};
 globalThis.fetch=async request=>{
  const body=await request.clone().text();assert.ok(body.includes(info.originalProductName),'Positive wire must contain the original historical source');wire++;
  const frame={id:'finite',model:'finite',choices:[{index:0,delta:{role:'assistant',content:'Finite synthetic answer'},finish_reason:null}]},end={...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 try{
  session=await createWorkspaceOmpSession({packageRoot:paths.packageRoot,cwd:info.cwd,agentDir:path.join(info.cwd,'context-wire-agent'),sessionDirectory:path.dirname(info.savedSession.sessionFile),savedSession:info.savedSession,nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true,brainClient,materialsClient:{},planClient:{},productClient:{},
   pluginConfiguration:{disabled:['workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog']},
   configuration:{providerId:info.model.provider,model:info.model.id,baseUrl:info.model.baseUrl,apiKey:'explicit-offline-synthetic-only',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
   authorize:async()=>{const r=await hostFetch(endpoint+'/authorize');if(!r.ok)throw Error('ORIGINAL_SESSION_REFUSED');}});
  await session.session.prompt('Read original historical context');
 }catch(e){error=e;}
 assert.equal(serialized,true,'Reach actual provider Request.text');
 // Emit bounded metadata before assertions so the unfixed zero-fetch oracle
 // records an actual attempted dispatch instead of only an SDK error string.
 console.log(JSON.stringify({mode,serialized,modelFetches:wire,actualSdk:true,originalSignedHostJournal:true,realStore:true,externalModelRequests:0}));
 assert.equal(wire,mode==='control'?1:0,error?.message||session?.session.messages.at(-1)?.errorMessage);
 if(mode==='control')assert.equal(session.session.messages.at(-1)?.stopReason,'stop');
}finally{globalThis.Request=RequestOriginal;globalThis.fetch=hostFetch;await session?.close();}
