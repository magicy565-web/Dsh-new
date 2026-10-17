// New official SDK Session, original Node Host via loopback fixture RPC. Only
// provider SSE is finite; no package stub, external network or old journal.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWorkspaceOmpSession} from '../../server/workspace-omp-session.mjs';
const info=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const hostFetch=globalThis.fetch;let created,modelFetches=0,bodyWithFact=false,error=null;
const rpc=async(method,value)=>{const r=await hostFetch(info.endpoint+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw Error('ORIGINAL_SYNTHETIC_FACT_HOST_REFUSED');return r.json();};
const sse=(delta,finish)=>{
 const frame={id:'finite-facts',model:'finite',choices:[{index:0,delta,finish_reason:null}]};
 const end={...frame,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
 return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
};
try{
 globalThis.fetch=async request=>{
  assert.ok(request instanceof Request);assert.equal(new URL(request.url).origin,new URL(info.model.baseUrl).origin);
  const text=await request.clone().text(),body=JSON.parse(text);assert.ok(!text.includes(info.unselected));assert.ok(!text.includes('synthetic-only-docling-screen-value'));modelFetches++;
  if(modelFetches===1)return sse({role:'assistant',tool_calls:[{index:0,id:'finite-source',type:'function',function:{name:'workspace_brain_sources',arguments:'{}'}}]},'tool_calls');
  if(modelFetches===2){
   const catalog=body.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(r=>r?.kind==='catalog');
   assert.ok(catalog);const refs=catalog.data.sourceRefs.filter(r=>r.kind==='memory-fact');assert.equal(refs.length,1);
   return sse({role:'assistant',tool_calls:[{index:0,id:'finite-context',type:'function',function:{name:'workspace_brain_context_save',arguments:JSON.stringify({requestId:'wire-context',expectedRevision:0,goalIds:[info.goalId],sourceRefs:refs,businessModel:{valueProposition:'Synthetic source-backed investigation',customerSegments:['Synthetic distributors'],revenueModel:'Unreviewed draft'},operatingFocus:['Verify synthetic MOQ'],unknowns:['Independent confirmation missing'],notes:[{kind:'hypothesis',text:'MOQ may be an obstacle; unverified.',evidenceIds:refs.map(r=>r.kind+':'+r.id)}]})}}]},'tool_calls');
  }
  assert.equal(modelFetches,3);assert.ok(text.includes(info.statement));bodyWithFact=true;
  return sse({role:'assistant',content:'Synthetic fact observation is an unreviewed draft.'},'stop');
 };
 try{
  created=await createWorkspaceOmpSession({packageRoot:info.packageRoot,cwd:info.cwd,agentDir:info.agentDir,sessionDirectory:info.sessionDirectory,
   nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true,materialsClient:{},planClient:{},productClient:{},
   pluginConfiguration:{disabled:['workspace-factory-materials','workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog','workspace-marketplace']},
   brainClient:Object.fromEntries(['sourceCatalog','contextRead','contextSave','diagnose','decisionRead','decisionSave','reviewSave','brief','revalidateReceipt'].map(method=>[method,(value,signal,model)=>rpc('brain',{method,value,model})])),
   configuration:{providerId:info.model.provider,model:info.model.id,baseUrl:info.model.baseUrl,apiKey:'explicit-finite-sse-placeholder',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
   authorize:()=>rpc('authorize',{}),onNativeSessionReady:value=>rpc('ready',value),onBusinessFactsDisclosure:value=>rpc('disclosure',value),onModelRequest:value=>rpc('model',value)});
  await created.manager.ensureOnDisk();await created.manager.flush();
  await rpc('save',{engineScope:created.engineScope,agentSessionId:created.manager.getSessionId(),sessionFile:created.manager.getSessionFile()});
  await created.session.prompt('Inspect the selected synthetic fact and save an unreviewed context.');
  await created.authorizeDisclosure({phase:'final:deliver'});await created.manager.flush();
  if(created.session.messages.at(-1)?.stopReason!=='stop')throw Error('Finite SDK turn did not complete.');
 }catch(e){error=e;}
 const success=info.mode==='control';assert.equal(modelFetches,success?3:2,error?.message);assert.equal(bodyWithFact,success);
 if(success)assert.equal(error,null);else assert.ok(error);
 const result=success?{content:JSON.stringify({done:true,content:created.session.getLastAssistantText()}),usage:created.usage(),runtime:{kind:'pi-durable',execution:'agent-session',engine:'omp',engineScope:created.engineScope,agentSessionId:created.manager.getSessionId(),modelCalls:created.modelCalls(),originalRunId:info.runId,workerExitObserved:true}}:null;
 console.log(JSON.stringify({mode:info.mode,actualSdk:true,finiteSse:true,modelFetches,bodyWithFact,externalModelRequests:0,result}));
}finally{globalThis.fetch=hostFetch;await created?.close();}
