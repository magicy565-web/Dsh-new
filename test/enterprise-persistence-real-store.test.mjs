// Real createApp/openStore, actual files, explicit synthetic services only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,generateKeyPairSync} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {enterpriseContextExtension} from '../plugins/workspace-enterprise-context/src/extension.js';
const actor={workspaceId:'synthetic-persistence',subject:'owner',role:'admin'};
const disk=async f=>JSON.parse(await fs.readFile(path.join(f.directory,'workspace.json'),'utf8'));
async function fixture(t,{fga=true,onWrite}={}){
 const directory=await fs.mkdtemp('/tmp/enterprise-persistence-real-'),keys=generateKeyPairSync('ed25519');let app,expectedStoreFailure=false;
 const calls=[];
 const appOptions={dataDirectory:directory,capabilityEnvironment:{},provider:{configured:false,kind:'synthetic-disabled',complete:async()=>{throw Error('MODEL_FORBIDDEN');}},
  access:{mode:'enterprise',publicOrigin:'https://persistence.example',workspaceId:actor.workspaceId,issuer:'synthetic',keyId:'synthetic',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),members:[{subject:'owner',role:'admin'}]},
  ...(fga?{enterpriseDisclosureOptions:{openfga:{baseURL:'https://fga.example.invalid',storeId:'synthetic',authorizationModelId:'synthetic',apiToken:'synthetic-offline-fga-value',fetchImpl:async(_url,init)=>{
   const body=JSON.parse(init.body);calls.push(body);
   if(body.writes||body.deletes){
    const rows=app.store.read().businessLibrary.disclosureGrants;
    assert.ok(rows.some(row=>row.status===(body.writes?'pending':'revoked')),'Original grant state must be committed before external synchronization.');
    const persisted=await disk({directory});
    assert.ok(persisted.businessLibrary.disclosureGrants.some(row=>row.status===(body.writes?'pending':'revoked')));
    await onWrite?.({directory,app,body});
   }
   return new Response(JSON.stringify({allowed:true}),{headers:{'content-type':'application/json'}});
  }}}}:{})};
 app=await createApp(appOptions);
 t.after(async()=>{
  let clean=false;
  try{await app.close();clean=true;}catch(error){assert.equal(expectedStoreFailure,true);assert.match(error.message,/changed outside this writer|store is closed/);}
  finally{if(!clean){await app.access.close();await app.store.close();}await fs.rm(directory,{recursive:true,force:true});}
 });
 const bytes='SYNTHETIC persistent original document.';
 const upload=await app.artifacts.create({requestId:randomUUID(),filename:'synthetic.txt',content:bytes,metadata:{businessLibrary:{visibility:'internal'}}});
 const asset={artifactId:upload.artifact.id,version:1,sha256:createHash('sha256').update(bytes).digest('hex')};
 const document=(await app.businessLibrary.createDocument({requestId:randomUUID(),title:'Synthetic original',slotKey:'other',asset},actor)).document;
 const source={kind:'document',ref:document.id,revision:document.revision,version:1,sha256:asset.sha256};
 return {directory,app,calls,source,document,asset,reopen:async()=>{await app.close();app=await createApp(appOptions);return app;},expectStoreFailure:()=>{expectedStoreFailure=true;}};
}
const internal=(f,statement='Synthetic initial fact')=>({requestId:randomUUID(),audience:'internal',subjectType:'product',subjectId:'synthetic-product',factKey:'specification',statement,source:f.source});
const grantInput=f=>({requestId:randomUUID(),customerId:'synthetic-buyer',resourceType:'document',resourceId:f.document.id,resourceRevision:f.document.revision,documentVersion:1,maxLevel:'qualified',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic persistence acceptance'});

test('real createApp remember returns only after first memory and revision are durably committed',async t=>{
 const f=await fixture(t);let first,error;
 try{first=await f.app.enterpriseMemory.remember(internal(f),actor);}catch(e){error=e;}
 const atReturn=await disk(f);
 await f.app.store.update(()=>null); // Drain the actual queue, never substitute a synchronous Store.
 const afterDrain=await disk(f);
 console.log(JSON.stringify({acceptance:'real-store-first-memory',returnedError:Boolean(error),diskRowsAtReturn:atReturn.businessLibrary.enterpriseMemories.length,diskRowsAfterDrain:afterDrain.businessLibrary.enterpriseMemories.length}));
 assert.equal(error,undefined,'First memory must not fail before its queued write later commits.');
 assert.equal(first.memory.revision,1);assert.equal(atReturn.businessLibrary.enterpriseMemories[0].id,first.memory.id);
 const second=await f.app.enterpriseMemory.remember(internal(f,'Synthetic updated fact'),actor);
 const updated=await disk(f);assert.equal(second.memory.revision,2);assert.equal(second.memory.previousMemoryId,first.memory.id);
 assert.equal(updated.businessLibrary.enterpriseMemories.find(row=>row.id===second.memory.id).revision,2);
 assert.equal(updated.businessLibrary.enterpriseMemories.find(row=>row.id===first.memory.id).status,'superseded');
 const revoked=await f.app.enterpriseMemory.revoke(second.memory.id,{reason:'Synthetic revoke'},actor);
 assert.equal(revoked.memory.status,'revoked');assert.equal((await disk(f)).businessLibrary.enterpriseMemories.find(row=>row.id===second.memory.id).status,'revoked');
});

test('real disclosure grant and revoke return persisted objects before reporting success',async t=>{
 const f=await fixture(t),created=await f.app.enterpriseDisclosure.grant(grantInput(f),actor);
 assert.equal(created.grant.status,'active');assert.equal(typeof created.grant.then,'undefined');
 assert.equal((await disk(f)).businessLibrary.disclosureGrants.find(row=>row.id===created.grant.id).status,'active');
 const revoked=await f.app.enterpriseDisclosure.revoke(created.grant.id,{reason:'Synthetic complete'},actor);
 assert.equal(revoked.grant.status,'revoked');assert.equal((await disk(f)).businessLibrary.disclosureGrants.find(row=>row.id===created.grant.id).status,'revoked');
});

test('customer memory activation and revoke await the same real Store and disclosure chain',async t=>{
 const f=await fixture(t);
 const saved=await f.app.enterpriseMemory.remember({...internal(f),audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic customer fact'},actor);
 const persisted=await disk(f);assert.equal(saved.memory.status,'active');assert.ok(saved.memory.disclosureGrantId);
 assert.equal(persisted.businessLibrary.enterpriseMemories.find(row=>row.id===saved.memory.id).status,'active');
 assert.equal(persisted.businessLibrary.disclosureGrants.find(row=>row.id===saved.memory.disclosureGrantId).status,'active');
 const updated=await f.app.enterpriseMemory.remember({...internal(f,'Synthetic revised customer fact'),audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic customer revision'},actor);
 assert.equal(updated.memory.revision,2);const afterUpdate=await disk(f);
 assert.equal(afterUpdate.businessLibrary.enterpriseMemories.find(row=>row.id===saved.memory.id).status,'superseded');
 assert.equal(afterUpdate.businessLibrary.disclosureGrants.find(row=>row.id===saved.memory.disclosureGrantId).status,'revoked');
 const revoked=await f.app.enterpriseMemory.revoke(updated.memory.id,{reason:'Synthetic customer revoke'},actor);
 assert.equal(revoked.memory.status,'revoked');const after=await disk(f);
 assert.equal(after.businessLibrary.enterpriseMemories.find(row=>row.id===updated.memory.id).status,'revoked');
 assert.equal(after.businessLibrary.disclosureGrants.find(row=>row.id===updated.memory.disclosureGrantId).status,'revoked');
});

test('a missing external authority is refused only after durable sync_error is recorded',async t=>{
 const f=await fixture(t,{fga:false});
 await assert.rejects(f.app.enterpriseDisclosure.grant(grantInput(f),actor),e=>e.code==='DISCLOSURE_AUTHZ_NOT_CONFIGURED');
 assert.equal((await disk(f)).businessLibrary.disclosureGrants[0].status,'sync_error');
});

test('real persistence refusal never becomes a successful memory tool receipt or a late write',async t=>{
 const f=await fixture(t);f.expectStoreFailure();await fs.appendFile(path.join(f.directory,'workspace.json'),' ');
 const before=await fs.readFile(path.join(f.directory,'workspace.json'));
 const tools=[];enterpriseContextExtension({enabledMethods:['structuredMemoryRemember'],authorize:()=>true,
  client:{structuredMemoryRemember:()=>f.app.enterpriseMemory.remember(internal(f),actor)}})({registerTool:t=>tools.push(t)});
 const receipt=await tools[0].execute('synthetic-tool',{subjectType:'product',subjectId:'synthetic-product',factKey:'specification',statement:'Synthetic fact'},undefined,undefined,{model:{provider:'synthetic',id:'finite'}});
 assert.equal(receipt.isError,true);assert.equal(receipt.details.status,'blocked');assert.equal(receipt.details.memory,undefined);
 await assert.rejects(f.app.enterpriseDisclosure.grant(grantInput(f),actor),/changed outside this writer/);
 await assert.rejects(f.app.store.update(()=>null),/changed outside this writer/);
 assert.deepEqual(await fs.readFile(path.join(f.directory,'workspace.json')),before);
 assert.equal(f.app.store.read().businessLibrary.enterpriseMemories.length,0);
});

test('activation persistence failure rejects grant instead of returning a success Promise',async t=>{
 const f=await fixture(t,{onWrite:async({directory})=>fs.appendFile(path.join(directory,'workspace.json'),' ')});
 f.expectStoreFailure();
 await assert.rejects(f.app.enterpriseDisclosure.grant(grantInput(f),actor),/changed outside this writer/);
 assert.equal(f.app.store.read().businessLibrary.disclosureGrants[0].status,'pending');
 assert.equal((await disk(f)).businessLibrary.disclosureGrants[0].status,'pending');
});

test('real revision and memory/grant revocation persistence failures leave no false successful state',async t=>{
 const f=await fixture(t),saved=await f.app.enterpriseMemory.remember(internal(f),actor),grant=await f.app.enterpriseDisclosure.grant(grantInput(f),actor);
 f.expectStoreFailure();await fs.appendFile(path.join(f.directory,'workspace.json'),' ');const before=await fs.readFile(path.join(f.directory,'workspace.json'));
 await assert.rejects(f.app.enterpriseMemory.remember(internal(f,'Must not become revision two'),actor),/changed outside this writer/);
 await assert.rejects(f.app.enterpriseMemory.revoke(saved.memory.id,{reason:'Must not falsely revoke'},actor),/changed outside this writer/);
 await assert.rejects(f.app.enterpriseDisclosure.revoke(grant.grant.id,{reason:'Must not falsely revoke'},actor),/changed outside this writer/);
 assert.equal(f.app.store.read().businessLibrary.enterpriseMemories[0].revision,1);assert.equal(f.app.store.read().businessLibrary.enterpriseMemories[0].status,'active');
 assert.equal(f.app.store.read().businessLibrary.disclosureGrants[0].status,'active');assert.equal(f.calls.filter(call=>call.deletes).length,0);
 assert.deepEqual(await fs.readFile(path.join(f.directory,'workspace.json')),before);
});

test('customer memory activation failure rejects and leaves pending records instead of active success',async t=>{
 const f=await fixture(t,{onWrite:async({directory})=>fs.appendFile(path.join(directory,'workspace.json'),' ')});f.expectStoreFailure();
 await assert.rejects(f.app.enterpriseMemory.remember({...internal(f),audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic failure'},actor),/changed outside this writer/);
 const persisted=await disk(f);assert.equal(persisted.businessLibrary.enterpriseMemories[0].status,'pending');assert.equal(persisted.businessLibrary.disclosureGrants[0].status,'pending');
});

test('external synchronization failure is reported after both original sync_error records are durable',async t=>{
 const f=await fixture(t,{onWrite:async()=>{throw Error('Synthetic external refusal');}});
 await assert.rejects(f.app.enterpriseMemory.remember({...internal(f),audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic failure'},actor),e=>e.code==='FGA_UNAVAILABLE');
 const persisted=await disk(f);assert.equal(persisted.businessLibrary.enterpriseMemories[0].status,'sync_error');assert.equal(persisted.businessLibrary.disclosureGrants[0].status,'sync_error');
});

test('a superseded grant persistence failure cannot be swallowed as a successful customer update',async t=>{
 const f=await fixture(t),body={...internal(f),audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic update failure'};
 const first=await f.app.enterpriseMemory.remember(body,actor);let failed=false;
 const unsubscribe=f.app.store.subscribe(()=>{if(!failed&&f.app.store.read().businessLibrary.enterpriseMemories.some(row=>row.revision===2&&row.status==='active')){appendFileSync(path.join(f.directory,'workspace.json'),' ');failed=true;}});
 f.expectStoreFailure();try{await assert.rejects(f.app.enterpriseMemory.remember({...body,requestId:randomUUID(),statement:'Synthetic customer revision two'},actor),/changed outside this writer/);}finally{unsubscribe();}
 assert.equal(failed,true);assert.equal((await disk(f)).businessLibrary.disclosureGrants.find(row=>row.id===first.memory.disclosureGrantId).status,'active');
});

test('a customer grant revoke persistence failure is thrown even after local memory revocation committed',async t=>{
 const f=await fixture(t),saved=await f.app.enterpriseMemory.remember({...internal(f),audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic revoke failure'},actor);let failed=false;
 const unsubscribe=f.app.store.subscribe(()=>{if(!failed&&f.app.store.read().businessLibrary.enterpriseMemories[0].status==='revoked'){appendFileSync(path.join(f.directory,'workspace.json'),' ');failed=true;}});
 f.expectStoreFailure();try{await assert.rejects(f.app.enterpriseMemory.revoke(saved.memory.id,{reason:'Synthetic disk failure'},actor),/changed outside this writer/);}finally{unsubscribe();}
 assert.equal(failed,true);const persisted=await disk(f);assert.equal(persisted.businessLibrary.enterpriseMemories[0].status,'revoked');assert.equal(persisted.businessLibrary.disclosureGrants[0].status,'active');assert.equal(f.calls.filter(call=>call.deletes).length,0);
});

test('trusted current-turn fence rejects a queued memory write after original Run cancellation',async t=>{
 const f=await fixture(t);
 await f.app.store.update(state=>{state.conversations.push({id:'synthetic-conversation'});state.runs.push({id:'synthetic-run',conversationId:'synthetic-conversation',requestId:'synthetic-turn',status:'running'});state.messages.push({id:'synthetic-message',conversationId:'synthetic-conversation',requestId:'synthetic-turn',role:'user',status:'complete',content:'Synthetic queued cancellation'});});
 const cancelled=f.app.store.update(state=>{state.runs.find(row=>row.id==='synthetic-run').status='cancelled';});
 let fenceReached=false;
 const writing=f.app.enterpriseMemory.rememberFromConversationTurn(internal(f),actor,{conversationId:'synthetic-conversation',runId:'synthetic-run',assertCurrent:()=>{fenceReached=true;if(f.app.store.read().runs.find(row=>row.id==='synthetic-run').status!=='running')throw Error('SYNTHETIC_RUN_CANCELLED');}});
 await cancelled;await assert.rejects(writing,/SYNTHETIC_RUN_CANCELLED/);assert.equal(fenceReached,true);
 assert.equal((await disk(f)).businessLibrary.enterpriseMemories.length,0);
});

test('original createApp Store closes, reacquires and reads the same persisted memory',{timeout:10000},async t=>{
 const f=await fixture(t),saved=await f.app.enterpriseMemory.remember(internal(f),actor);
 const reopened=await f.reopen();
 const result=await reopened.enterpriseMemory.lookup({audience:'internal',subjectType:'product',subjectId:'synthetic-product',factKey:'specification'},{actor});
 assert.equal(result.found,true);assert.deepEqual(result.memory,saved.memory);
 assert.deepEqual((await disk(f)).businessLibrary.enterpriseMemories[0],saved.memory);
});
