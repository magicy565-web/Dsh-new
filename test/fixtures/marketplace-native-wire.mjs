// Official OMP SDK restores the original Host journal. Only provider SSE is a
// finite stand-in. The Node process retains the original active Run and client.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspaceOmpSession} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const mode=process.argv[2],endpoint=process.argv[3],info=JSON.parse(await fs.readFile(process.argv[4],'utf8'));
const hostFetch=globalThis.fetch,RequestOriginal=globalThis.Request,paths=workspaceOmpPaths({});let session,error,armed=false,mutated=false,serialized=false,wire=0;
const rpc=async(method,value,model)=>{const r=await hostFetch(endpoint+'/marketplace/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value,model})});if(!r.ok)throw Object.assign(Error('ORIGINAL_MARKETPLACE_REFUSED'),{code:(await r.json()).code});return r.json();};
const marketplaceClient=Object.fromEntries(['status','find','propose','order','revalidateReceipt'].map(method=>[method,(value,signal,model)=>rpc(method,value,model)]));
async function mutate(){if(!armed||mutated)return;const r=await hostFetch(endpoint+'/mutate',{method:'POST'});assert.equal(r.status,200,await r.clone().text());mutated=true;}
try{
 if(mode.startsWith('text-'))globalThis.Request=class extends RequestOriginal{clone(){const copy=super.clone(),text=copy.text.bind(copy);copy.text=async()=>{const body=await text();serialized=true;await mutate();return body;};return copy;}};
 globalThis.fetch=async request=>{const body=await request.clone().text();assert.ok(!body.includes('UNSELECTED_PRIVATE_ORDER_BODY'),'Unselected order inputs must never enter wire');assert.ok(!body.includes('FORGED_PRIVATE_BODY'));assert.ok(body.includes(info.orderId));wire++;
  const frame={id:'finite',model:'finite',choices:[{index:0,delta:{role:'assistant',content:'Explicit synthetic Marketplace status answer.'},finish_reason:null}]},end={...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 try{
  session=await createWorkspaceOmpSession({packageRoot:paths.packageRoot,cwd:info.cwd,agentDir:path.join(info.cwd,'marketplace-wire-agent'),sessionDirectory:path.dirname(info.savedSession.sessionFile),savedSession:info.savedSession,nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true,marketplaceClient,materialsClient:{},planClient:{},productClient:{},
   pluginConfiguration:{disabled:['workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog','workspace-goal-intelligence',...(mode==='disabled'?['workspace-marketplace']:[])]},
   configuration:{providerId:info.model.provider,model:info.model.id+(mode==='receiver'?'-other':''),baseUrl:info.model.baseUrl,apiKey:'explicit-offline-synthetic-only',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
   authorize:async()=>{const r=await hostFetch(endpoint+'/authorize');if(!r.ok)throw Error('ORIGINAL_RUN_REFUSED');},onModelRequest:async()=>{armed=mode.startsWith('hook-')||mode.startsWith('text-');if(mode.startsWith('hook-'))await mutate();}});
  await session.session.prompt('Read the original reviewed Marketplace status');
 }catch(e){error=e;}
 assert.equal(wire,mode==='control'?1:0,error?.message||session?.session.messages.at(-1)?.errorMessage);assert.equal(mutated,mode.startsWith('hook-')||mode.startsWith('text-'));if(mode.startsWith('text-'))assert.equal(serialized,true);
 let result=null;if(mode==='control'){assert.equal(session.session.messages.at(-1)?.stopReason,'stop');await session.manager.flush();result={content:JSON.stringify({done:true,content:session.session.getLastAssistantText()}),usage:session.usage(),runtime:{kind:'pi-durable',execution:'agent-session',engine:'omp',engineScope:session.engineScope,agentSessionId:session.manager.getSessionId(),modelCalls:session.modelCalls(),originalRunId:info.runId,workerExitObserved:true}};}
 console.log(JSON.stringify({mode,mutated,serialized,modelFetches:wire,actualSdk:true,originalActiveRun:true,realStore:true,externalModelRequests:0,result}));
}finally{globalThis.fetch=hostFetch;globalThis.Request=RequestOriginal;await session?.close();}
