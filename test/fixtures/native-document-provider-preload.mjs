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
 const discover=(name,index=0)=>{const value=schema(name);assert.ok(Array.isArray(value.oneOf)&&value.oneOf.length);
  const branch=value.oneOf[index];assert.ok(branch,'The whole selected tuple must be advertised at this index');
  const keys=name==='workspace_enterprise_context_parse_upload'?['artifactId','version','sha256']:['subjectType','subjectId','factKey'];
  return Object.fromEntries(keys.map(key=>{const rule=branch.properties[key];assert.ok(branch.required.includes(key));
   if(Object.hasOwn(rule,'const')){if(rule.enum!==undefined)assert.deepEqual(rule.enum,[rule.const]);return [key,rule.const];}
   assert.ok(Array.isArray(rule.enum)&&rule.enum.length===1,'A discovered tuple field must have exactly one authorized value');return [key,rule.enum[0]];
  }));};
 const receipts=body.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}});
 // Shape-only failure evidence survives fixture teardown through test messages;
 // no headers, parameter values, uploaded text, credentials or full contexts.
 const documentSchemas=body.tools.filter(t=>t.function.name.startsWith('workspace_enterprise_context_')).map(({function:t})=>({name:t.name,strict:t.strict===true,branches:(t.parameters.oneOf||[]).map(branch=>({additionalProperties:branch.additionalProperties,required:branch.required,fields:Object.fromEntries(Object.entries(branch.properties||{}).map(([key,rule])=>[key,{hasConst:Object.hasOwn(rule,'const'),enumLength:Array.isArray(rule.enum)?rule.enum.length:null}]))}))}));
 summary.requests.push({withSource:text.includes(info.statement),...(info.product?{withProduct:text.includes(info.product.name)}:{}),toolNames:body.tools.map(t=>t.function.name),documentSchemas});
 fs.writeFileSync(info.reportFile,JSON.stringify(summary),{mode:0o600});const n=summary.requests.length;
 if(info.mode==='native-no-grant'){
  assert.ok(!body.tools.some(t=>t.function.name==='workspace_medusa_context'));assert.ok(!text.includes(info.nativeProduct.title));assert.ok(!text.includes(info.nativeProduct.description));
  assert.equal(n,1);return sse({role:'assistant',content:'Native Medusa access requires independent model permission.'},'stop');
 }
 if(info.mode==='native-medusa'){
  assert.ok(!text.includes('SYNTHETIC_UNAPPROVED_POLICY'));assert.ok(!text.includes('SYNTHETIC_UNAPPROVED_METADATA'));
  schema('workspace_medusa_context');
  if((info.turn||1)===1&&n===1){assert.ok(!text.includes(info.nativeProduct.title));assert.ok(!text.includes(info.statement));return call('workspace_medusa_status',{},'native-status');}
  if((info.turn||1)===1&&n===2){const status=receipts.findLast(r=>r?.view?.nativeProducts);assert.ok(status);return call('workspace_medusa_context',{productId:status.view.nativeProducts.products[0].productId},'native-context');}
  const product=receipts.findLast(r=>r?.method==='context'&&r.plugin==='workspace-medusa-catalog');assert.ok(product,'Native approved product must arrive through the real guarded tool');
  assert.equal(product.view.product.id,info.nativeProduct.id);assert.equal(product.view.product.title,info.nativeProduct.title);assert.equal(product.view.product.description,info.nativeProduct.description);assert.equal(product.view.product.agent_summary,info.nativeProduct.summary);
  if((info.turn||1)===1&&n===3)return call('workspace_enterprise_context_parse_upload',discover('workspace_enterprise_context_parse_upload'),'native-document');
  const document=receipts.findLast(r=>r?.authorization?.kind==='parse');assert.equal(document?.text,info.statement);assert.equal(n,(info.turn||1)===1?4:1);
  return sse({role:'assistant',content:((info.turn||1)===1?'Native product result: ':'Native same-session continuation: ')+product.view.product.title+' '+product.view.product.description+' '+product.view.product.agent_summary+' '+document.text},'stop');
 }
 if(info.mode==='library-flow'){
  assert.ok(!text.includes(info.product.category),'Unapproved product fields must not reach the wire');
  assert.ok(body.tools.every(t=>!/^workspace_(medusa|shopify|marketplace)_/.test(t.function.name)));
  if((info.turn||1)===1&&n===1){
   assert.ok(!text.includes(info.product.name));assert.ok(!text.includes(info.statement));
   const name=schema('workspace_skill').properties.name.enum.find(name=>name==='enterprise-context');assert.ok(name);
   return call('workspace_skill',{name},'library-handbook');
  }
  if((info.turn||1)===1&&n===2)return call('workspace_factory_materials',{limit:1},'selected-product');
  const material=receipts.findLast(r=>r?.plugin==='workspace-factory-materials'&&Array.isArray(r.products));
  assert.equal(material?.status,'available');assert.equal(material.products.length,1);
  assert.deepEqual(Object.keys(material.products[0]).sort(),['description','id','name','revision']);
  assert.equal(material.products[0].name,info.product.name);assert.equal(material.products[0].description,info.product.description);
  if((info.turn||1)===1&&n===3)return call('workspace_enterprise_context_parse_upload',discover('workspace_enterprise_context_parse_upload'),'selected-document');
  const document=receipts.findLast(r=>r?.authorization?.kind==='parse');assert.equal(document?.text,info.statement);
  assert.equal(n,(info.turn||1)===1?4:1);
  return sse({role:'assistant',content:((info.turn||1)===1?'Internal summary: ':'Same-session continuation: ')+material.products[0].name+' — '+material.products[0].description+' '+document.text+' Unreviewed; no external action.'},'stop');
 }
 if(info.mode==='unknown')return new Response('data: '+JSON.stringify({id:'finite-no-usage',model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:'Unconfirmed synthetic response'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 if(info.mode==='clarify')return sse({role:'assistant',content:'What business outcome should I investigate? I can wait for your clarification without parsing or saving.'},'stop');
 if(info.mode==='lookup'){if(n===1)return call('workspace_enterprise_context_structured_memory_lookup',discover('workspace_enterprise_context_structured_memory_lookup'),'lookup-only');assert.equal(n,2);assert.equal(receipts.findLast(r=>r?.operation==='structuredMemoryLookup').found,false);return sse({role:'assistant',content:'The selected fact is not yet saved. No parser or write was needed to check it.'},'stop');}
 if(info.mode==='limit'||info.mode==='repeat'){
  const name=info.documents?'workspace_enterprise_context_structured_memory_lookup':'workspace_brain_sources';
  if(info.documents&&info.mode==='limit')assert.equal(schema(name).oneOf.length,8);
  return call(name,info.documents?discover(name,info.mode==='limit'?n-1:0):{},'limit-'+n);
 }
 const turn=info.turn||1;
 if(turn===3){if(n===1)return call('workspace_brain_context',{},'third-context');assert.equal(n,2);const context=receipts.findLast(r=>r?.kind==='context');assert.ok(context?.data.context);assert.ok(text.includes(info.statement));return sse({role:'assistant',content:'The third turn retains the original saved Context and source-backed fact; no new execution was started.'},'stop');}
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
