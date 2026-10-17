// Test-only Bun preload: finite HTTP SSE at the original provider fetch boundary.
// No SDK/package stub and no external network fallback. The production worker,
// Session, transport, private-fd bridge and Node Host remain unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createLocalDeepseekTransport} from '../../server/workspace-omp-local-deepseek.mjs';
import {acceptanceConfiguration} from '../../server/deepseek-acceptance-policy.mjs';
const info=JSON.parse(fs.readFileSync(process.env.WORKSPACE_NATIVE_PAID_FIXTURE,'utf8'));
assert.ok(['control','no-usage','crash-no-report','late-model-request','duplicate-accounting','error-then-late-dispatch','error-then-late-accounting','post-report-final-wire','lost-dispatch','late-dispatch','duplicate-dispatch','out-of-order-dispatch'].includes(info.mode));
const summary={externalModelRequests:0,requests:[]};
const save=()=>fs.writeFileSync(info.reportFile,JSON.stringify(summary),{mode:0o600});
// These finite protocol faults affect only this fresh owned worker. Intercept
// its existing fd-3 event, not an SDK import or any prior journal/receipt.
const rawWrite=fs.writeSync.bind(fs);let injected=false,delayedDispatch=null;
const protocolModes=['post-report-final-wire','lost-dispatch','late-dispatch','duplicate-dispatch','out-of-order-dispatch'];
if(protocolModes.includes(info.mode)){
 save();
 fs.writeSync=(fd,data,...args)=>{
  let value;try{if(fd===3&&typeof data==='string')value=JSON.parse(data);}catch{}
  if(value?.type==='request'&&value.method==='businessFactsDisclosure'&&value.args?.[0]?.phase==='model:disclose'
    &&typeof value.args[0].wireBody==='string'&&info.mode==='post-report-final-wire'&&!injected){
   injected=true;summary.injected='modelRequest-report-finalwire';save();
   const zero=createLocalDeepseekTransport({configuration:acceptanceConfiguration({DEEPSEEK_API_KEY:'synthetic-unused'}),fetchImpl:async()=>{throw Error('No finite send admitted');}}).report();
   rawWrite(3,JSON.stringify({type:'providerAccounting',report:zero})+'\n');
  }
  if(value?.type==='modelDispatched'&&!injected){
   injected=true;summary.injected=info.mode;save();
   if(info.mode==='lost-dispatch')return Buffer.byteLength(data);
   if(info.mode==='late-dispatch'){delayedDispatch=data;return Buffer.byteLength(data);}
   if(info.mode==='out-of-order-dispatch')return rawWrite(fd,JSON.stringify({...value,modelCalls:value.modelCalls+1})+'\n',...args);
   if(info.mode==='duplicate-dispatch'){rawWrite(fd,data,...args);return rawWrite(fd,data,...args);}
  }
  const result=rawWrite(fd,data,...args);
  if(value?.type==='providerAccounting'&&delayedDispatch){rawWrite(3,delayedDispatch);delayedDispatch=null;}
  return result;
 };
}
function sse(delta,finish){
 const frame={id:'finite-native-paid',model:'deepseek-flash',choices:[{index:0,delta,finish_reason:null}]};
 const end={...frame,choices:[{index:0,delta:{},finish_reason:finish}],...(info.mode==='no-usage'?{}:{usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})};
 return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
const call=(name,args,id)=>sse({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init);assert.equal(request.url,'https://api.deepseek.com/chat/completions');assert.equal(request.method,'POST');
 const text=await request.clone().text(),body=JSON.parse(text);assert.equal(body.model,'deepseek-flash');assert.ok(body.max_tokens<=512);assert.deepEqual(body.thinking,{type:'disabled'});
 assert.ok(!body.messages.some(m=>m.role==='developer'));assert.ok(!text.includes(info.unselected));assert.ok(!text.includes('synthetic-only-docling-screen-value'));
 summary.requests.push({sha256:createHash('sha256').update(text).digest('hex'),bodyWithFact:text.includes(info.statement),normalized:true});save();
 const index=summary.requests.length;
 if(protocolModes.includes(info.mode))return sse({role:'assistant',content:'Finite terminal protocol fixture without business disclosure.'},'stop');
 if(info.mode==='crash-no-report')process.exit(23);
 if(['late-model-request','duplicate-accounting','error-then-late-dispatch','error-then-late-accounting'].includes(info.mode)){
  // A deliberately invalid worker protocol sequence, using only a generated
  // finite accounting report. No old Session/receipt recovery is exercised.
  const t=createLocalDeepseekTransport({configuration:acceptanceConfiguration({DEEPSEEK_API_KEY:'synthetic-unused'}),fetchImpl:async()=>new Response('finite')});
  t.configureTools(body.tools.map(t=>t.function.name));await t.fetch(new Request(request,{body:text}));
  t.onSseEvent({data:JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})});
  t.complete({role:'assistant',content:[{type:'text',text:'synthetic protocol report'}],stopReason:'stop',usage:{input:100,output:20,cacheRead:0,cacheWrite:0,totalTokens:120}});t.finish();
  const report=t.report();fs.writeSync(3,JSON.stringify({type:'providerAccounting',report})+'\n');
  if(info.mode.startsWith('error-then-'))fs.writeSync(3,JSON.stringify({type:'error',error:'Synthetic terminal worker error.'})+'\n');
  fs.writeSync(3,JSON.stringify(info.mode==='error-then-late-dispatch'?{type:'modelDispatched',modelCalls:1}
    :['duplicate-accounting','error-then-late-accounting'].includes(info.mode)?{type:'providerAccounting',report}
    :{type:'request',id:900001,method:'modelRequest',args:[{modelCalls:2}]})+'\n');
  return await new Promise(()=>{});
 }
 if(index===1)return call('workspace_brain_sources',{},'paid-sources');
 const receipts=body.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}});
 const catalog=receipts.findLast(r=>r?.kind==='catalog');assert.ok(catalog);
 const refs=catalog.data.sourceRefs.filter(r=>r.kind==='memory-fact');assert.equal(refs.length,1);
 const inputs=structuredClone(info.inputs),turn=info.turn||1,evidence=refs.map(r=>r.kind+':'+r.id);
 inputs.context.sourceRefs=refs;
 for(const note of inputs.context.notes)note.evidenceIds=evidence;
 for(const hypothesis of inputs.first.hypotheses)hypothesis.supportingEvidence=evidence;
 for(const option of inputs.first.options)option.evidenceIds=option.kind==='wait'?[]:evidence;
 // Continue within the exact first Context version. Updating it would make
 // the prior Decision stale under the original Host's deliberate version gate.
 if(index===2)return turn===1
  ?call('workspace_brain_context_save',{...inputs.context,requestId:'paid-context-'+turn,expectedRevision:0},'paid-context-'+turn)
  :call('workspace_brain_context',{},'paid-context-read-'+turn);
 assert.ok(text.includes(info.statement));
 if(index===3)return call('workspace_brain_decision_save',{...inputs.first,requestId:'paid-decision-'+turn,expectedRevision:turn-1,contextRevision:1},'paid-decision-'+turn);
 assert.equal(index,4);return sse({role:'assistant',content:'Synthetic source-backed Context and Decision remain unreviewed against the original Goal.'},'stop');
};
