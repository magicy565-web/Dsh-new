import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { CommerceStore } from '../store.js';
import { createCommerceService } from '../service.js';
import { createGrokBridge, createGrokCallbackHandler, readGrokConfiguration } from '../grok-bridge.js';

async function fixture(transport) {
  const workspaceId=randomUUID(), sessionId=`session-${randomUUID()}`;
  const registry={get:id=>id===workspaceId?{id,sessionIds:[sessionId]}:null,list:()=>[{id:workspaceId,sessionIds:[sessionId]}]};
  const store=new CommerceStore(':memory:'), service=createCommerceService({store,registry});
  const execution=()=>({agent:{session:{id:sessionId}},callId:`call_${randomUUID()}`,signal:new AbortController().signal});
  let projectId;
  const state=()=>service.state(sessionId,projectId);
  const command=(command,payload)=>service.command(sessionId,{projectId,expectedRevision:state().revision,requestId:randomUUID(),command,payload});
  const tool=(command,payload)=>service.toolCommand({projectId,expectedRevision:state().revision,requestId:randomUUID(),command,payload},execution());
  const plan=await tool('apply_plan',{title:'TEST synthetic project',parties:[{id:'requester',type:'factory',displayName:'TEST requester'},{id:'provider',type:'provider',displayName:'TEST provider'}],agents:[{id:'grok',providerPartyId:'provider',providerType:'grokbot',displayName:'TEST Grok',skills:['public_web_research']}],workOrders:[{id:'task',requesterPartyId:'requester',agentServiceId:'grok',title:'TEST task',brief:'TEST research only',allowedActions:['public_web_research'],allowedResourceRefs:[],maximumMinor:0,currency:'USD',ttlSeconds:86400}]});
  projectId=plan.projectId;
  const token=(await command('issue_agent_credential',{agentServiceId:'grok'})).credential.token;
  const configuration=readGrokConfiguration({GROKBOT_WEBHOOK_URL:'https://grok.example.test/hook',GROKBOT_WEBHOOK_KEY:'test-webhook-key-0000',GROKBOT_PUBLIC_ORIGIN:'https://dsh.example.test',GROKBOT_CALLBACK_TOKEN:'test-callback-key-0000',GROKBOT_WORKER_TOKEN:token});
  const bridge=createGrokBridge({service,store,configuration,transport});
  await bridge.connect(execution());
  const review=await service.review(sessionId,projectId,'task');
  await service.command(sessionId,{projectId,expectedRevision:review.networkRevision,requestId:randomUUID(),command:'approve_order',payload:{orderId:'task',reviewDigest:review.reviewDigest}});
  await tool('dispatch_order',{orderId:'task'});
  return {bridge,service,store,execution,state,projectId,sessionId,configuration,token,close:()=>service.close()};
}

test('uncertain handoff is never resent; late callbacks record distinct progress and one owner-reviewed delivery',async()=>{
  let sends=0;const f=await fixture(async(_url,options)=>{sends++;assert.equal(options.redirect,'error');throw new Error('simulated timeout after receipt');});
  try{
    const args={projectId:f.projectId,orderId:'task'};
    assert.equal((await f.bridge.handoff(args,f.execution())).state,'unknown');
    assert.equal(f.state().commerceNetwork.workOrders[0].grokHandoff.state,'unknown');
    assert.equal((await f.bridge.handoff(args,f.execution())).replayed,true);assert.equal(sends,1);
    const cb=(status,eventId,extra={})=>({taskId:'task',threadId:f.sessionId,status,eventId,...extra});
    assert.equal((await f.bridge.callback(cb('accepted','evt-1',{summary:'接单'}))).state,'accepted');
    await f.bridge.callback(cb('progress','evt-2',{summary:'第一条进度'}));
    await f.bridge.callback(cb('progress','evt-3',{summary:'第二条进度'}));
    assert.equal(f.state().commerceNetwork.workOrders[0].workerProgress,'第二条进度');
    await assert.rejects(f.bridge.callback(cb('progress','evt-3',{summary:'冲突'})),{code:'EVENT_ID_CONFLICT'});
    const noId={taskId:'task',threadId:f.sessionId,status:'progress',summary:'无 ID 的进度一'};
    assert.equal((await f.bridge.callback(noId)).duplicate,false);
    assert.equal((await f.bridge.callback(noId)).duplicate,true);
    assert.equal((await f.bridge.callback({...noId,summary:'无 ID 的进度二'})).duplicate,false);
    assert.equal(f.state().commerceNetwork.workOrders[0].workerProgress,'无 ID 的进度二');
    const done=cb('done','evt-4',{summary:'完成',artifacts:[{type:'markdown',title:'TEST report',content:'TEST result'},{type:'link',title:'TEST source',url:'https://example.test/source'}],drafts:[{channel:'email',to:'test@example.test',subject:'TEST',body:'Draft only'}]});
    assert.equal((await f.bridge.callback(done)).state,'done');
    assert.equal((await f.bridge.callback(done)).duplicate,true);
    // Simulate process loss after the native delivery commits but before the
    // callback receipt commits. Replaying the same event must recover it.
    f.store.db.prepare("DELETE FROM grok_callback_receipt WHERE event_key='id:evt-4'").run();
    f.store.db.prepare("UPDATE grok_handoff SET state='unknown' WHERE order_id='task'").run();
    assert.equal((await f.bridge.callback(done)).state,'done');
    const view=f.state(),order=view.commerceNetwork.workOrders[0];
    assert.equal(order.status,'delivered');assert.equal(view.deliverables.length,1);
    const delivery=f.service.delivery(f.sessionId,f.projectId,view.deliverables[0].id);
    assert.match(delivery.content,/Draft only/);assert.match(delivery.content,/未发送/);assert.deepEqual(delivery.sourceUrls,['https://example.test/source']);
    await assert.rejects(f.bridge.callback(cb('progress','evt-5')),{code:'GROK_TERMINAL'});
    assert.equal(sends,1);
  }finally{f.close();}
});

test('callback can arrive before webhook response and cannot be overwritten by acknowledgement',async()=>{
  let f;f=await fixture(async()=>{await f.bridge.callback({taskId:'task',threadId:f.sessionId,status:'accepted',eventId:'early',summary:'已接收'});return new Response('',{status:202});});
  try{const result=await f.bridge.handoff({projectId:f.projectId,orderId:'task'},f.execution());assert.equal(result.state,'accepted');assert.equal(f.state().commerceNetwork.workOrders[0].status,'running');}finally{f.close();}
});

test('failure callback is scoped to the task and does not claim the remote worker stopped',async()=>{
  const f=await fixture(async()=>new Response('',{status:202}));
  try{
    await f.bridge.handoff({projectId:f.projectId,orderId:'task'},f.execution());
    await assert.rejects(f.bridge.callback({taskId:'task',threadId:'session-wrong',status:'failed'}),{code:'GROK_TASK_NOT_FOUND'});
    await f.bridge.callback({taskId:'task',threadId:f.sessionId,status:'failed',eventId:'failed',summary:'provider reports failure'});
    const order=f.state().commerceNetwork.workOrders[0];assert.equal(order.status,'failed');assert.equal(order.stopUnconfirmed,true);
  }finally{f.close();}
});

test('a cancel request blocks later provider progress and does not claim remote stop',async()=>{
  const f=await fixture(async()=>new Response('',{status:202}));
  try{
    await f.bridge.handoff({projectId:f.projectId,orderId:'task'},f.execution());
    const view=f.state();
    await f.service.command(f.sessionId,{projectId:f.projectId,expectedRevision:view.revision,requestId:randomUUID(),command:'cancel_order',payload:{orderId:'task'}});
    await assert.rejects(f.bridge.callback({taskId:'task',threadId:f.sessionId,status:'progress',eventId:'late',summary:'still running'}),{code:'STOP_REQUESTED'});
    assert.equal(f.state().commerceNetwork.workOrders[0].status,'stop_requested');
  }finally{f.close();}
});

test('callback ingress checks bearer, browser headers and size without disclosing credentials',async()=>{
  const f=await fixture(async()=>new Response('',{status:202}));
  try{
    const handler=createGrokCallbackHandler(f.bridge);
    const invoke=async(headers,body='{}')=>{const req=Readable.from([Buffer.from(body)]);Object.assign(req,{method:'POST',url:'/commerce-grok-api/callback',headers,socket:{remoteAddress:'127.0.0.1'}});const res={writeHead(status){this.status=status;},end(value){this.body=JSON.parse(value);}};await handler(req,res);return res;};
    assert.equal((await invoke({'content-type':'application/json'})).status,401);
    assert.equal((await invoke({'content-type':'application/json',authorization:`Bearer ${f.configuration.callbackToken}`,origin:'https://evil.test'})).status,403);
    const rejected=await invoke({'content-type':'application/json',authorization:`Bearer ${f.configuration.callbackToken}`},JSON.stringify({taskId:'missing',threadId:f.sessionId,status:'accepted'}));
    assert.equal(rejected.status,404);assert.equal(JSON.stringify(rejected).includes(f.configuration.callbackToken),false);
  }finally{f.close();}
});

test('configuration rejects local endpoints and missing secrets',()=>{
  assert.equal(readGrokConfiguration({}).configured,false);
  assert.equal(readGrokConfiguration({GROKBOT_WEBHOOK_URL:'http://127.0.0.1/hook',GROKBOT_WEBHOOK_KEY:'test-webhook-key-0000',GROKBOT_PUBLIC_ORIGIN:'https://dsh.example.test',GROKBOT_CALLBACK_TOKEN:'test-callback-key-0000',GROKBOT_WORKER_TOKEN:`cnw_${'a'.repeat(24)}.${'a'.repeat(43)}`}).configured,false);
});
