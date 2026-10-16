import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,conversation,send,journal} from './fixtures/enterprise-context-integration.mjs';
const query={subjectType:'customer',subjectId:'synthetic-buyer',factKey:'shipping.preference'};
const remember=statement=>({tool:'workspace_enterprise_context_structured_memory_remember',arguments:{...query,statement}});
const lookup={tool:'workspace_enterprise_context_structured_memory_lookup',arguments:query};
const reply={text:'SYNTHETIC bounded reply, not a real model.'};
async function receipt(f,cid,run,tool,revision){
 assert.equal(run.status,'succeeded',JSON.stringify({error:run.error,lifecycle:f.lifecycle}));
 assert.equal(run.events.filter(e=>e.type==='pi.tool.failed').length,0);
 const rows=await journal(f,cid),message=rows.filter(row=>row.message?.toolName===tool).at(-1).message;
 assert.equal(message.isError,false);assert.equal(message.content[0].text,JSON.stringify(message.details));
 const value=message.details;assert.equal(value.authorization.kind,'memory');assert.equal(value.memory.revision,revision);assert.equal(value.memory.source.dependencies.length,2);
 const disk=JSON.parse(await fs.readFile(path.join(f.directory,'workspace.json'),'utf8'));
 assert.deepEqual(value.memory,disk.businessLibrary.enterpriseMemories.find(row=>row.id===value.memory.id));return value;
}
test('unified native plugin persists two-source remember1/lookup1/remember2/lookup2 in four reopened Runs',{timeout:60000},async t=>{
 const f=await fixture(t,{memory:true,allSources:true,script:rows=>[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset},{tool:'workspace_enterprise_context_parse_upload',arguments:rows[1].asset},remember('Synthetic FOB Singapore.'),reply]});
 const cid=await conversation(f),one=await send(f,cid),r1=await receipt(f,cid,one,remember('').tool,1);
 const firstObservation=structuredClone((await journal(f,cid)).find(row=>row.message?.toolName===remember('').tool).message);
 const original=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;
 f.responses.splice(0,f.responses.length,lookup,reply);const two=await send(f,cid);await receipt(f,cid,two,lookup.tool,1);
 f.responses.splice(0,f.responses.length,remember('Synthetic terms require confirmation.'),reply);const three=await send(f,cid);await receipt(f,cid,three,remember('').tool,2);
 f.responses.splice(0,f.responses.length,lookup,{...reply,expectedContextText:'Synthetic terms require confirmation.'});const four=await send(f,cid);await receipt(f,cid,four,lookup.tool,2);
 assert.equal(f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession.agentSessionId,original.agentSessionId);
 assert.deepEqual((await journal(f,cid)).find(row=>row.message?.toolCallId===firstObservation.toolCallId).message,firstObservation,'Refreshing a model projection must preserve the original journal observation.');
 assert.equal(one.businessAgentContext.allowBusinessSubmit,false);
 assert.notEqual(four.id,one.id);assert.equal(r1.memory.revision,1);
 console.log(JSON.stringify({acceptance:'unified-four-runs',runs:4,verifiedSuccessfulReceipts:4,sameNativeSession:true,sourceDependencies:2,realModelRequests:0,mem0:'disabled'}));
});

test('memory-enabled native status remains a status proof across the next Run',{timeout:30000},async t=>{
 const f=await fixture(t,{memory:true,allSources:true,script:()=>[{tool:'workspace_enterprise_context_status',arguments:{}},reply]}),cid=await conversation(f);
 for(let i=0;i<2;i++){const run=await send(f,cid);assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(run.events.some(e=>e.type==='pi.tool.failed'),false);const message=(await journal(f,cid)).filter(row=>row.message?.toolName==='workspace_enterprise_context_status').at(-1).message;assert.equal(message.isError,false);assert.equal(message.details.authorization.kind,'status');assert.equal(message.details.authorization.sources.length,2);}
});
