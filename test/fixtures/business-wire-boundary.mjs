// Original signed Node Host and materials client; official OMP SDK. Only model
// transport is a finite SSE substitute, never an external provider.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const MODEL={provider:'shopify-product-explicit-faux',id:'finite',baseUrl:'https://synthetic.invalid'};const RECIPIENT={kind:'pi-coding-agent',provider:MODEL.provider,model:MODEL.id,destination:MODEL.baseUrl};
import {createWorkspaceFactoryMaterialsClient} from '../../plugins/workspace-procurement/src/workspace-factory-materials-client.mjs';
import {createWorkspaceOmpSession} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const mode=process.argv[2],endpoint=process.argv[3],productId=process.argv[4],root=await fs.mkdtemp('/tmp/business-wire-');
const hostFetch=globalThis.fetch;
const materialsClient=createWorkspaceFactoryMaterialsClient({recipient:RECIPIENT,request:(path,options)=>hostFetch(endpoint+path,options)});
const privateMode=mode==='medusa-private';
const medusaClient={reconcile:async()=>{const r=await hostFetch(endpoint+'/medusa/reconcile');assert.equal(r.status,200,await r.clone().text());return r.json();},refresh:async()=>medusaClient.reconcile()};
const base={packageRoot:workspaceOmpPaths({}).packageRoot,cwd:root,agentDir:root+'/agent',sessionDirectory:root+'/sessions',nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true,materialsClient,...(privateMode?{medusaClient}:{}),productClient:{},planClient:{},pluginConfiguration:{disabled:['workspace-shopify-product','workspace-market-validation',...(privateMode?[]:['workspace-medusa-catalog']),'workspace-goal-intelligence']},configuration:{providerId:MODEL.provider,model:MODEL.id,baseUrl:MODEL.baseUrl}};
let first,second,armed=false,mutated=false,wire=0;const originalRequest=globalThis.Request,originalFetch=globalThis.fetch;
async function mutate(){if(!armed||mutated)return;const r=await hostFetch(endpoint+'/mutate/'+mode,{method:'POST'});assert.equal(r.status,200,await r.text());mutated=true;}
try{
 first=await createWorkspaceOmpSession({...base,syntheticResponses:[{tool:privateMode?'workspace_medusa_reconcile':'workspace_factory_materials',arguments:{productId}},{text:'Finite initial read.'}]});
 await first.session.prompt('Read synthetic product');await first.manager.flush();assert.equal(first.session.messages.find(x=>x.role==='toolResult').isError,false);
 const savedSession={sessionFile:first.manager.getSessionFile(),agentSessionId:first.manager.getSessionId(),engineScope:first.engineScope};await first.close();first=null;
 globalThis.fetch=async request=>{const body=await request.clone().text();assert.ok(!body.includes('REMOTE_PRIVATE'),'Remote private text must never reach model wire');wire++;const frame={id:'synthetic',model:'finite',choices:[{index:0,delta:{role:'assistant',content:'Finite SSE'},finish_reason:null}]},end={...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 if(mode.startsWith('text-'))globalThis.Request=class extends originalRequest{clone(){const copy=super.clone(),read=copy.text.bind(copy);copy.text=async()=>{const text=await read();await mutate();return text;};return copy;}};
 let error;try{second=await createWorkspaceOmpSession({...base,savedSession,configuration:{...base.configuration,apiKey:'synthetic-offline-value',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},onModelRequest:async()=>{armed=mode!=='control'&&!privateMode;if(mode.startsWith('hook-'))await mutate();}});await second.session.prompt('Read prior product');}catch(e){error=e;}
 assert.equal(wire,mode==='control'||privateMode?1:0,error?.message);assert.equal(mutated,mode!=='control'&&!privateMode);
 console.log(JSON.stringify({mode,mutated,modelFetches:wire,originalSignedHost:true,actualSdk:true,externalModelRequests:0}));
}finally{globalThis.Request=originalRequest;globalThis.fetch=originalFetch;await first?.close();await second?.close();await fs.rm(root,{recursive:true,force:true});}
