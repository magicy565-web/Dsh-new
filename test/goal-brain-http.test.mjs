import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGoalBrainHttp } from '../server/goal-brain-http.mjs';
const pathname='/api/conversations/c-123/brain/sources';
const context={subject:'owner',workspaceId:'enterprise-A',role:'admin',session:{id:'s-1'}};
const probe={calls:[],host:{bind({identity,conversationId,canSubmit}) {probe.calls.push({identity,conversationId,canSubmit});return {
  binding:{receiver:{provider:'test',id:'test'}},brain:{sourceCatalog:async()=>({plugin:'workspace-goal-intelligence',status:'available',data:{sourceRefs:[]}})},assertLive:()=>true
};}}};
const respond=async (_res,status,body)=>{probe.calls.push({status,body})};
test('original HTTP GET route only exposes precise read endpoints',async()=>{
  for(const p of ['/api/conversations/c-123/brain/sources','/api/conversations/c-123/brain/context','/api/conversations/c-123/brain/diagnosis','/api/conversations/c-123/brain/brief']){
    const host={bind:()=>({binding:{receiver:{}},brain:{sourceCatalog:async()=>({}),contextRead:async()=>({}),diagnose:async()=>({}),brief:async()=>({})},assertLive:()=>{}})};
    assert.equal(await handleGoalBrainHttp({pathname:p,method:'GET',context,host,res:{},respond}),true);
  }
  assert.equal(await handleGoalBrainHttp({pathname:'/api/conversations/c-123/brain/execute',method:'GET',context,host:probe.host,res:{},respond}),false);
  assert.equal(await handleGoalBrainHttp({pathname:'/api/conversations/../../brain/context',method:'GET',context,host:probe.host,res:{},respond}),false);
});
test('disabled original Host never reads private data or starts an Agent',async()=>{
  probe.calls.length=0;
  assert.equal(await handleGoalBrainHttp({pathname,method:'GET',context,host:null,res:{},respond}),true);
  assert.equal(probe.calls[0].body.status,'unconfigured');assert.equal(probe.calls[0].body.modelCalls,0);
  await assert.rejects(()=>handleGoalBrainHttp({pathname:'/api/conversations/c-123/brain/reviews',method:'POST',context,host:null,body:{},res:{},respond}),e=>e.code==='BRAIN_REVIEWED_HOST_NOT_ENABLED');
});
test('signed original Session controls identity, no browser or model-selected workspace',async()=>{
  probe.calls.length=0;
  await handleGoalBrainHttp({pathname,method:'GET',context,host:probe.host,res:{},respond});
  assert.deepEqual(probe.calls[0],{conversationId:'c-123',canSubmit:false,identity:{workspaceId:'enterprise-A',subject:'owner',role:'admin',sessionId:'s-1'}});
  assert.equal(probe.calls[1].status,200);
});
test('Brain HTTP writes are limited to owner review/feedback and never approve external actions',async()=>{
  const reviewHost={bind:({uiWrite})=>({binding:{receiver:{}},brain:{reviewSave:async body=>{assert.equal(uiWrite,true);return {ok:true,body};}},assertLive:()=>{}})};
  await handleGoalBrainHttp({pathname:'/api/conversations/c-123/brain/reviews',method:'POST',context,host:reviewHost,body:{requestId:'r'},res:{},respond});
  await assert.rejects(()=>handleGoalBrainHttp({pathname,method:'POST',context,host:probe.host,res:{},respond}),e=>e.code==='BRAIN_EXECUTION_INTENT_REQUIRED');
  await assert.rejects(()=>handleGoalBrainHttp({pathname,method:'GET',context:{...context,session:null},host:probe.host,res:{},respond}),e=>e.code==='BRAIN_SESSION_REQUIRED');
});
