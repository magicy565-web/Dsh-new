// Original business factory/Host/SDK, with its existing trusted lifecycle seam;
// finite loopback Medusa/Docling and finite model SSE, never real services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startupFixture,sendStartup} from './fixtures/native-document-startup.mjs';

for(const kind of ['contract','approval'])test('serialized native model wire is refused after '+kind+' withdrawal',{timeout:180000},async t=>{
  let f,policy,changed=false;
  f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true,hooks:{ready:value=>{policy=value.policy;},lifecycle:event=>{
    if(event.phase==='nativeMedusaWireCheck'&&f.nativeState.calls>0&&!changed){
      changed=true;if(kind==='contract')policy.nativeMedusa.enabled=false;else f.nativeState.status='draft';
    }
  }}});
  const run=await sendStartup(f);assert.equal(changed,true);assert.equal(run.status,'failed',JSON.stringify(run.error));
  assert.equal((await f.readProvider()).requests.length,2,'the serialized third request must not reach the finite provider');
  assert.equal((await f.readProvider()).externalModelRequests,0);
  assert.ok(!f.app.store.read().messages.some(m=>m.runId===run.id&&m.role==='assistant'&&m.status==='complete'));
});
for(const kind of ['revoke','cancel'])test('native final asynchronous checks after worker exit withhold '+kind,{timeout:180000},async t=>{
  let f,policy,exited=false,changed=false,authorizations=0;
  f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true,hooks:{ready:value=>{policy=value.policy;},
    lifecycle:event=>{if(event.phase==='exit'&&event.code===0)exited=true;},authorize:async()=>{
      if(exited&&++authorizations===2){changed=true;if(kind==='revoke')policy.nativeMedusa.enabled=false;else await f.app.runtime.cancelConversation(f.cid);}
    }}});
  const run=await sendStartup(f);assert.equal(exited,true);assert.equal(changed,true);assert.equal(authorizations,2);
  assert.equal(run.status,kind==='cancel'?'cancelled':'failed',JSON.stringify(run.error));
  assert.equal((await f.readProvider()).requests.length,4,'model completed before the final delivery boundary changed');
  assert.ok(!f.app.store.read().messages.some(m=>m.runId===run.id&&m.role==='assistant'&&m.status==='complete'));
  assert.ok(!f.app.store.read().artifacts.some(a=>a.sourceRunId===run.id));
});
for(const kind of ['same','add','remove','change'])test('default business restart retains original instance/Session pin for native contract '+kind,{timeout:180000},async t=>{
  const f=await startupFixture(t,{mode:kind==='add'?'native-no-grant':'native-medusa',nativeMedusa:true,nativeGrant:kind!=='add'});
  const first=await sendStartup(f);assert.equal(first.status,'succeeded',JSON.stringify(first.error));
  const before=await f.readProvider(),mapping=structuredClone(f.mapping());
  await f.restartNativeContract(kind);await f.writeFixture(2);
  const sent=await f.workspace('/api/conversations/'+f.cid+'/messages',{body:{requestId:randomUUID(),content:'Continue the same conversation',workspaceExecution:false,inputContext:{artifacts:[],skills:[],memoryIds:[],connectorActions:[]}}});
  if(sent.status===202){
    let run;for(let i=0;i<1600;i++){run=f.app.store.read().runs.find(r=>r.id===sent.json.run.id);if(!['queued','running'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(run.status,'failed',JSON.stringify(run.error));
  }else{
    assert.ok([401,403,409].includes(sent.status),sent.text);
    if(kind==='same'){assert.equal(sent.json.error.code,'BUSINESS_AGENT_BINDING_CHANGED');assert.match(sent.json.error.message,/rotated service binding/i);}
  }
  assert.deepEqual(await f.readProvider(),before);assert.deepEqual(f.mapping(),mapping);
  assert.equal(f.app.store.read().businessLibrary.products.length,0);
});
