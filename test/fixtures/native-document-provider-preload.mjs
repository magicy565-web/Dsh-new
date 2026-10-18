// Test-only finite provider at original SDK fetch. All other URLs fail closed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const info=JSON.parse(fs.readFileSync(process.env.WORKSPACE_NATIVE_DOCUMENT_FIXTURE,'utf8'));
assert.equal(Object.hasOwn(info,'query'),false);assert.equal(Object.hasOwn(info,'asset'),false);
const summary={externalModelRequests:0,requests:[]};
const sse=(delta,finish)=>new Response('data: '+JSON.stringify({id:'finite-document',model:'deepseek-flash',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'finite-document',model:'deepseek-flash',choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
const call=(name,args,id)=>sse({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init);assert.equal(request.url,'https://api.deepseek.com/chat/completions');assert.equal(request.method,'POST');
 const text=await request.text(),body=JSON.parse(text);assert.equal(body.model,'deepseek-flash');assert.ok(!text.includes(info.parserSecret));
 if(info.bounded){assert.deepEqual(body.thinking,{type:'disabled'});assert.ok(body.max_tokens<=512);}
 const schema=name=>{const tool=body.tools.find(t=>t.function.name===name);assert.ok(tool,'Needed capability must be advertised');return tool.function.parameters;};
 const discover=name=>{const value=schema(name);assert.ok(Array.isArray(value.oneOf)&&value.oneOf.length);return Object.fromEntries(Object.entries(value.oneOf[0].properties).map(([key,rule])=>{assert.ok(Object.hasOwn(rule,'const'));return [key,rule.const];}));};
 const receipts=body.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}});
 summary.requests.push({withSource:text.includes(info.statement),toolNames:body.tools.map(t=>t.function.name)});
 fs.writeFileSync(info.reportFile,JSON.stringify(summary),{mode:0o600});const n=summary.requests.length;
 if(info.mode==='clarify')return sse({role:'assistant',content:'What business outcome should I investigate? I can wait for your clarification without parsing or saving.'},'stop');
 if(info.mode==='lookup'){if(n===1)return call('workspace_enterprise_context_structured_memory_lookup',discover('workspace_enterprise_context_structured_memory_lookup'),'lookup-only');assert.equal(n,2);assert.equal(receipts.findLast(r=>r?.operation==='structuredMemoryLookup').found,false);return sse({role:'assistant',content:'The selected fact is not yet saved. No parser or write was needed to check it.'},'stop');}
 if(info.mode==='limit')return call(info.documents?'workspace_enterprise_context_structured_memory_lookup':'workspace_brain_sources',info.documents?discover('workspace_enterprise_context_structured_memory_lookup'):{},'limit-'+n);
 const turn=info.turn||1;
 if(turn===2){
  if(n===1)return call('workspace_brain_context',{},'second-context');
  const context=receipts.findLast(r=>r?.kind==='context');assert.ok(context);assert.ok(text.includes(info.statement));
  if(n===2){const next=structuredClone(info.inputs.second),refs=context.data.sources.map(s=>s.reference),evidence=refs.map(r=>r.kind+':'+r.id);next.goalId=context.data.context.payload.goalIds[0];assert.ok(next.goalId);next.sourceRefs=refs;for(const h of next.hypotheses)h.supportingEvidence=evidence;for(const option of next.options)option.evidenceIds=option.kind==='wait'?[]:evidence;return call('workspace_brain_decision_save',{...next,contextRevision:1},'second-decision');}
  assert.equal(n,3);return sse({role:'assistant',content:'Synthetic continuation preserves the same document-backed fact, Context and original Goal. Decision revision 2 remains unreviewed.'},'stop');
 }
 if(n===1){const name=schema('workspace_skill').properties.name.enum.find(name=>name==='enterprise-context');assert.ok(name);return call('workspace_skill',{name},'read-handbook');}
 const handbook=body.messages.find(m=>m.role==='tool'&&m.content.includes('Enterprise context from original sources'));assert.ok(handbook,'Original SDK skill read must reach the model');
 if(n===2)return call('workspace_enterprise_context_parse_upload',discover('workspace_enterprise_context_parse_upload'),'document-parse');
 const parsed=receipts.findLast(r=>r?.authorization?.kind==='parse');assert.ok(parsed);assert.equal(parsed.text,info.statement);
 if(n===3)return call('workspace_enterprise_context_structured_memory_remember',{...discover('workspace_enterprise_context_structured_memory_remember'),statement:parsed.text},'document-remember');
 const remembered=receipts.findLast(r=>r?.operation==='structuredMemoryRemember');assert.ok(remembered);assert.equal(remembered.memory.statement,info.statement);
 if(n===4)return call('workspace_brain_sources',{},'document-sources');
 const catalog=receipts.findLast(r=>r?.kind==='catalog');assert.ok(catalog);const refs=catalog.data.sourceRefs.filter(r=>r.kind==='memory-fact');assert.equal(refs.length,1);
 const inputs=structuredClone(info.inputs),evidence=refs.map(r=>r.kind+':'+r.id);inputs.context.goalIds=catalog.data.goalIds;assert.equal(inputs.context.goalIds.length,1);inputs.first.goalId=inputs.context.goalIds[0];inputs.context.sourceRefs=refs;inputs.first.sourceRefs=refs;
 for(const note of inputs.context.notes)note.evidenceIds=evidence;
 for(const hypothesis of inputs.first.hypotheses)hypothesis.supportingEvidence=evidence;
 for(const option of inputs.first.options)option.evidenceIds=option.kind==='wait'?[]:evidence;
 if(n===5)return call('workspace_brain_context_save',inputs.context,'document-context');
 if(n===6)return call('workspace_brain_decision_save',{...inputs.first,contextRevision:1},'document-decision');
 assert.equal(n,7);return sse({role:'assistant',content:'Synthetic uploaded source was read and saved as source-bound unreviewed memory. The Context and Decision refer to the original Goal; no execution was started.'},'stop');
};
