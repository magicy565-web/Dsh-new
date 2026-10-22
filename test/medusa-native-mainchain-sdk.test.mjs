// Original default business startup and pinned SDK; finite local Medusa/Docling
// HTTP and finite provider SSE. No real service, identity or paid request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {startupFixture,sendStartup,STATEMENT} from './fixtures/native-document-startup.mjs';
test('default nativeBusiness reads exact prod_* plus document, saves through original Artifact and continues original Session',{timeout:180000},async t=>{
  const f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true});
  const first=await sendStartup(f,'Read the separately reviewed native Medusa product and selected document. Prepare an internal summary.');
  assert.equal(first.status,'succeeded',JSON.stringify({error:first.error,session:await f.sessionDiagnostics()}));
  const mapping=structuredClone(f.mapping());assert.equal(mapping.engineScope,'omp:18.10.4:business-v1');assert.match(mapping.nativeMedusaScopeHash,/^[a-f0-9]{64}$/);
  const message=f.app.store.read().messages.find(m=>m.runId===first.id&&m.role==='assistant'&&m.status==='complete');assert.ok(message);
  for(const text of [f.nativeState.title,f.nativeState.description,f.nativeState.summary,STATEMENT])assert.ok(message.content.includes(text));
  assert.ok(!message.content.includes('SYNTHETIC_UNAPPROVED'));assert.equal(f.app.store.read().businessLibrary.products.length,0);
  const saved=await f.workspace('/api/artifacts',{body:{requestId:randomUUID(),filename:'native-result.md',content:message.content,sourceConversationId:f.cid,sourceRunId:first.id}});
  assert.equal(saved.status,201,saved.text);const artifact=saved.json.artifact;
  const download=await f.workspace('/api/artifacts/'+artifact.id+'/download?version=1&sha256='+artifact.sha256);
  assert.equal(download.status,200);assert.equal(download.text,message.content);assert.equal(createHash('sha256').update(download.text).digest('hex'),artifact.sha256);
  assert.equal((await f.readProvider()).requests.length,4);assert.equal((await f.readProvider()).externalModelRequests,0);assert.equal(f.parserCalls(),1);assert.ok(f.nativeState.calls>1);
  await f.writeFixture(2);const second=await sendStartup(f,'Continue the same conversation. What remains uncertain?');
  assert.equal(second.status,'succeeded',JSON.stringify({error:second.error,session:await f.sessionDiagnostics()}));assert.deepEqual(f.mapping(),mapping);
  assert.equal((await f.readProvider()).requests.length,1);assert.equal((await f.readProvider()).externalModelRequests,0);assert.equal(f.parserCalls(),1);
  assert.ok(f.app.store.read().messages.some(m=>m.runId===second.id&&m.role==='assistant'&&m.status==='complete'&&m.content.includes('Native same-session continuation:')));
  assert.equal((await f.workspace('/api/conversations/'+f.cid+'/messages',{subject:'member-b'})).status,404);
});
for(const kind of ['revision','fingerprint','withdrawn','contract-binding'])test('default nativeBusiness refuses changed/revoked native source before next model: '+kind,{timeout:180000},async t=>{
  const f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true});const first=await sendStartup(f);assert.equal(first.status,'succeeded',JSON.stringify(first.error));
  const before=await f.readProvider(),mapping=structuredClone(f.mapping());
  if(kind==='revision')f.nativeState.reviewVersion++;
  if(kind==='fingerprint')f.nativeState.sourceHash='d'.repeat(64);
  if(kind==='withdrawn')f.nativeState.status='draft';
  if(kind==='contract-binding')await f.app.store.update(state=>{delete state.conversations.find(c=>c.id===f.cid).businessAgentSession.nativeMedusaScopeHash;});
  await f.writeFixture(2);const next=await sendStartup(f);
  assert.equal(next.status,'failed',JSON.stringify(next.error));assert.deepEqual(await f.readProvider(),before);if(kind!=='contract-binding')assert.deepEqual(f.mapping(),mapping);
  assert.ok(!f.app.store.read().messages.some(m=>m.runId===next.id&&m.role==='assistant'&&m.status==='complete'));
});
test('default business startup without independent native disclosure does not advertise a native read or contact its source',{timeout:180000},async t=>{
  const f=await startupFixture(t,{mode:'native-no-grant',nativeMedusa:true,nativeGrant:false});const run=await sendStartup(f,'Read my native Medusa product if it is independently authorized.');
  assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(f.nativeState.calls,0);assert.equal(f.parserCalls(),0);assert.equal((await f.readProvider()).requests.length,1);
  assert.ok(!f.mapping().nativeMedusaScopeHash);assert.equal((await f.readProvider()).externalModelRequests,0);
});
test('default business startup refuses an expired original model disclosure before a Run or remote read',{timeout:30000},async t=>{
  const f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true,expiresAt:'2020-01-01T00:00:00.000Z'});
  const result=await f.workspace('/api/conversations/'+f.cid+'/messages',{body:{requestId:randomUUID(),content:'Read the native product',workspaceExecution:false,inputContext:{artifacts:[],skills:[],memoryIds:[],connectorActions:[]}}});
  assert.equal(result.status,403,result.text);assert.equal(f.nativeState.calls,0);assert.equal(f.app.store.read().runs.length,0);await assert.rejects(f.readProvider(),{code:'ENOENT'});
});
test('original Run cancellation aborts the in-flight native source and withholds completion',{timeout:180000},async t=>{
  const f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true});
  let entered;const pending=new Promise(resolve=>{entered=resolve;});f.nativeState.held=entered;
  const work=sendStartup(f);await pending;
  assert.equal((await f.workspace('/api/conversations/'+f.cid+'/cancel',{body:{}})).status,200);
  const run=await work;assert.equal(run.status,'cancelled');
  for(let i=0;i<100&&!f.nativeState.closed;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.nativeState.closed,true);assert.equal(f.nativeState.calls,1);assert.equal((await f.readProvider()).requests.length,2);
  assert.ok(!f.app.store.read().messages.some(m=>m.runId===run.id&&m.role==='assistant'&&m.status==='complete'));
});
