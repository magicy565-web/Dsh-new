import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDocumentTools,nativeDocumentReceiptRows} from '../server/workspace-native-document-tools.mjs';
const key={subjectType:'product',subjectId:'synthetic',factKey:'moq'};
const fixed={plugin:'workspace-enterprise-context-oss',visibility:'internal',canonicalFacts:'Workspace Library',externalActions:false};
function pair(){
 const args={...key,statement:'Synthetic MOQ 120'},proof={kind:'memory',operation:'structuredMemoryRemember',query:key,statement:args.statement};
 const receipt={...fixed,operation:proof.operation,authorization:proof};
 const result={role:'toolResult',toolCallId:'c1',toolName:'workspace_enterprise_context_structured_memory_remember',content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt,isError:false};
 return [{role:'assistant',content:[{type:'toolCall',id:'c1',name:result.toolName,arguments:args}]},result];
}
test('new ordinary document facade delegates only the exact selected fact key',async()=>{
 const calls=[],control={structuredMemoryRemember:async(...args)=>{calls.push(args);return 'original';}};
 const tools=createNativeDocumentTools(control,[key]);assert.equal(await tools.structuredMemoryRemember({...key,statement:'Synthetic'},undefined,{id:'exact'}),'original');
 assert.equal(calls.length,1);await assert.rejects(tools.structuredMemoryRemember({...key,factKey:'other',statement:'Synthetic'}));
 await assert.rejects(tools.structuredMemoryRemember({...key,statement:'Synthetic',authority:'model supplied'}));assert.equal(calls.length,1);
});
test('normal enterprise receipts preserve original call argument and body pairing',()=>{
 const messages=pair();assert.equal(nativeDocumentReceiptRows(messages).length,1);
 const changed=structuredClone(messages);changed[0].content[0].arguments.statement='Changed';assert.throws(()=>nativeDocumentReceiptRows(changed));
 const missing=[messages[1]];assert.throws(()=>nativeDocumentReceiptRows(missing));
});
test('normal document revalidation awaits original checks then repeats full synchronous current',async()=>{
 const order=[],messages=pair(),tools=createNativeDocumentTools({verifyBody:()=>order.push('body'),check:async()=>order.push('check'),assertDisclosureCurrent:p=>{assert.equal(p.messages,messages);order.push('current');}},[key]);
 await tools.revalidate(messages);assert.deepEqual(order,['body','check','current']);
});
test('normalized wire must preserve the exact receipt and its paired original call',()=>{
 const messages=pair(),tools=createNativeDocumentTools({assertDisclosureCurrent:()=>true},[key]);
 const wire={messages:[{role:'assistant',tool_calls:[{id:'c1',function:{name:messages[1].toolName,arguments:JSON.stringify(messages[0].content[0].arguments)}}]},{role:'tool',tool_call_id:'c1',content:messages[1].content[0].text}]};
 assert.equal(tools.assertDisclosureCurrent({messages,context:messages,wireBody:JSON.stringify(wire)}),true);
 wire.messages[1].content=JSON.stringify({...messages[1].details,extra:'invented'});assert.throws(()=>tools.assertDisclosureCurrent({messages,wireBody:JSON.stringify(wire)}));
});
test('a fixed refusal receipt is admitted without authenticating invented success fields',async()=>{
 const messages=pair();messages[1].isError=true;messages[1].details={...fixed,status:'blocked',reason:'OSS_MEMORY_FACT_NOT_SELECTED'};messages[1].content[0].text=JSON.stringify(messages[1].details);
 let checks=0;const tools=createNativeDocumentTools({verifyBody:()=>checks++,check:()=>checks++,assertDisclosureCurrent:()=>true},[key]);await tools.revalidate(messages);assert.equal(checks,0);
 messages[1].details.statement='private';messages[1].content[0].text=JSON.stringify(messages[1].details);assert.throws(()=>nativeDocumentReceiptRows(messages));
});
