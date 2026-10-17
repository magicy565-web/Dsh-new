// Official SDK resumes an original signed Host journal. The Node process owns
// Store, Artifact, Access and Brain. Only provider SSE is a finite stand-in.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspaceOmpSession} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const mode=process.argv[2],endpoint=process.argv[3],info=JSON.parse(await fs.readFile(process.argv[4],'utf8'));
const paths=workspaceOmpPaths({}),hostFetch=globalThis.fetch,RequestOriginal=globalThis.Request,controller=new AbortController();
const rpc=async(method,value,model)=>{const r=await hostFetch(endpoint+'/brain/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value,model})});if(!r.ok)throw Error('ORIGINAL_BRAIN_REFUSED');return r.json();};
const brainClient=Object.fromEntries(['sourceCatalog','contextRead','contextSave','diagnose','decisionRead','decisionSave','reviewSave','brief','revalidateReceipt'].map(method=>[method,(value,signal,model)=>rpc(method,value,model)]));
let armed=false,mutated=false,wire=0,session,error;
async function mutate(){if(!armed||mutated)return;const r=await hostFetch(endpoint+'/mutate',{method:'POST'});assert.equal(r.status,200,await r.clone().text());mutated=true;if(mode.endsWith('cancel'))controller.abort();}
try{
 if(mode.startsWith('text-'))globalThis.Request=class extends RequestOriginal{clone(){const copy=super.clone(),text=copy.text.bind(copy);copy.text=async()=>{const result=await text();await mutate();return result;};return copy;}};
 globalThis.fetch=async request=>{const body=await request.clone().text();assert.ok(body.includes(info.originalProblem));assert.ok(body.includes(info.updatedProblem));wire++;
  const frame={id:'finite',model:'finite',choices:[{index:0,delta:{role:'assistant',content:'Synthetic decision read'},finish_reason:null}]},end={...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 try{
  session=await createWorkspaceOmpSession({packageRoot:paths.packageRoot,cwd:info.cwd,agentDir:path.join(info.cwd,'wire-agent'),sessionDirectory:path.dirname(info.savedSession.sessionFile),savedSession:info.savedSession,nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true,brainClient,materialsClient:{},planClient:{},productClient:{},
   pluginConfiguration:{disabled:['workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog',...(mode==='restore-disabled'?['workspace-goal-intelligence']:[])]},
   configuration:{providerId:info.model.provider,model:info.model.id,baseUrl:info.model.baseUrl,apiKey:'explicit-offline-synthetic-only',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},lifecycleSignal:controller.signal,
   authorize:async()=>{const r=await hostFetch(endpoint+'/authorize');if(!r.ok)throw Error('ORIGINAL_SESSION_REFUSED');},
   onModelRequest:async()=>{armed=mode!=='control';if(mode.startsWith('hook-'))await mutate();}});
  await session.session.prompt('Read original saved decision history');
 }catch(e){error=e;}
 assert.equal(wire,mode==='control'?1:0,error?.message||session?.session.messages.at(-1)?.errorMessage);assert.equal(mutated,mode.startsWith('hook-')||mode.startsWith('text-'));
 if(mode==='control')assert.equal(session.session.messages.at(-1)?.stopReason,'stop');
 console.log(JSON.stringify({mode,mutated,modelFetches:wire,actualSdk:true,originalSignedHostJournal:true,realStore:true,externalModelRequests:0}));
}finally{globalThis.fetch=hostFetch;globalThis.Request=RequestOriginal;await session?.close();}
