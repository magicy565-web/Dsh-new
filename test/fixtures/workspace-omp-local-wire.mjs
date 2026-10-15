// Actual official OMP provider/HTTP/SSE path; only fetch returns synthetic wire
// responses. No syntheticResponses agent replacement or real provider fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runLocalFactorySession } from '../../scripts/workspace-omp-local.mjs';
import { acceptanceConfiguration } from '../../server/deepseek-acceptance-policy.mjs';
import { workspaceOmpPaths } from '../../server/workspace-omp-bridge.mjs';
import { LOCAL_DEEPSEEK_LIMITS } from '../../server/workspace-omp-local-deepseek.mjs';
const mode=process.env.LOCAL_WIRE_MODE,root=await fs.mkdtemp('/tmp/local-provider-wire-');
let requests=0, validatedWireRequests=0;
function sse(body,delta,finish){
 const frame={id:'synthetic-local-wire',model:body.model,object:'chat.completion.chunk',created:1,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]};
 let usage={prompt_tokens:100,completion_tokens:20,total_tokens:120};
 if(mode==='cached')usage={...usage,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20};
 if(mode==='partial-usage')usage={prompt_tokens:100};
 if(mode==='inconsistent-usage')usage={prompt_tokens:100,completion_tokens:20,total_tokens:121};
 if(mode==='oversized-usage')usage={prompt_tokens:32001,completion_tokens:20,total_tokens:32021};
 if(mode==='empty-response')usage={prompt_tokens:100,completion_tokens:0,total_tokens:100};
 if(mode==='output-contract')usage={prompt_tokens:100,completion_tokens:513,total_tokens:613};
 const end={...frame,choices:[{index:0,delta:{},finish_reason:finish}],...(mode==='missing-usage'?{}:{usage})};
 return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
try{
 await fs.mkdir(root+'/out');await fs.mkdir(root+'/run');
 // Multiple ordinary lines survive the upstream ReadTool's long-line truncation.
 await fs.writeFile(root+'/product.md',mode==='oversize-after-read'?('synthetic '.repeat(6)+'\n').repeat(300):'Synthetic wire product: cup; capacity unknown.\n');
 const result=await runLocalFactorySession({directory:root+'/run',paths:workspaceOmpPaths({}),configuration:acceptanceConfiguration({DEEPSEEK_API_KEY:'explicit-synthetic-wire-unused'}),
  options:{inputs:[root+'/product.md'],outputDirectory:root+'/out',task:mode==='oversize-first'?'x'.repeat(20000):'Read input-1 and save a new local report. No sending.'}},
  {fetchImpl:async request=>{
   requests++;assert.equal(request.url,'https://api.deepseek.com/chat/completions');assert.equal(request.redirect,'error');
   const text=await request.text(),body=JSON.parse(text);assert.ok(Buffer.byteLength(text)<=LOCAL_DEEPSEEK_LIMITS.maxRequestBytes);
   assert.equal(body.model,'deepseek-flash');assert.equal(body.max_tokens,512);assert.deepEqual(body.thinking,{type:'disabled'});
   assert.equal(body.max_completion_tokens,undefined);assert.equal(body.reasoning_effort,undefined);
   assert.ok(body.messages.every(m=>m.role!=='developer'));assert.ok(body.tools.every(t=>t.function.strict===undefined));
   validatedWireRequests++;
   if(mode==='http500')return new Response('{}',{status:500});
   if(mode==='network-error')throw Error('Explicit synthetic connection reset');
   if(mode==='stream-error')return new Response('data: {"error":{"message":"synthetic stream error"}}\n\n',{headers:{'content-type':'text/event-stream'}});
   if(mode==='truncated')return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Incomplete'},finish_reason:null}]})+'\n\n',{headers:{'content-type':'text/event-stream'}});
   if(mode==='empty-response')return sse(body,{},'stop');
   const tool=(name,args)=>sse(body,{tool_calls:[{index:0,id:'wire-call-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
   if(requests===1||mode==='exhausted')return tool('read',{path:mode==='bad-tool'?'/not-selected.md':'input-1'});
   if(requests===2)return tool('write',{path:'report.md',content:'Synthetic wire-only local report. Capacity pending. Source input-1.'});
   return sse(body,{content:'Synthetic wire report saved. No real data or paid model.'},'stop');
  }});
 assert.equal(result.provider.actualProviderRequests,requests);assert.equal(validatedWireRequests,requests);
 if(['happy','cached'].includes(mode)){
  assert.equal(result.status,'saved-local-drafts',JSON.stringify(result));assert.equal(requests,3);assert.equal(result.provider.confirmedResponses,3);
  assert.ok(result.provider.chargeUpperCny<0.01);assert.equal(result.provider.billingUncertain,false);assert.equal(result.saved.length,1);
  assert.equal(result.paidModelVerified,false);assert.equal(result.evidenceKind,'official-omp-local-files-mocked-http');
 }else{
  assert.equal(result.status,'stopped',JSON.stringify(result));
  assert.equal(requests,mode==='oversize-first'?0:mode==='exhausted'?8:1);
  assert.ok(requests<=LOCAL_DEEPSEEK_LIMITS.maxRequests);
  if(mode==='output-contract')assert.equal(result.provider.chargeUpperCny,null);
  else assert.ok(result.provider.chargeUpperCny<=LOCAL_DEEPSEEK_LIMITS.failureInclusiveUpperCny+1e-10);
  if(!['oversize-first','oversize-after-read','bad-tool','exhausted'].includes(mode)){
   assert.equal(result.provider.billingUncertain,true);assert.ok(result.provider.chargeUpperCny===null||result.provider.chargeUpperCny>0);
  }
 }
 console.log(JSON.stringify({mode,passed:true,actualMockHttpRequests:requests,realProviderRequests:0,status:result.status,chargeUpperCny:result.provider.chargeUpperCny}));
}finally{await fs.rm(root,{recursive:true,force:true});}
