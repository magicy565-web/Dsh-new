// Actual original Store, writer lock, fsync/rename and close/reopen. No model or HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {createBusinessLibraryService} from '../server/business-library.mjs';
import {createEnterpriseMemoryLedger} from '../server/enterprise-memory-ledger.mjs';

const actor={workspaceId:'synthetic-concurrency',subject:'owner',role:'admin'};
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
async function fixture(t,{disclosure=null}={}){
 const directory=await fs.mkdtemp('/tmp/memory-concurrency-');let store,library,ledger;
 const open=async()=>{
  store=await openStore(directory);library=createBusinessLibraryService({store,artifacts:{}});
  ledger=createEnterpriseMemoryLedger({store,library,disclosure,workspaceId:actor.workspaceId});
 };
 await open();
 t.after(async()=>{try{await store.close();}finally{await fs.rm(directory,{recursive:true,force:true});}});
 const {product}=await library.createProduct({requestId:randomUUID(),name:'SYNTHETIC concurrency fabric'},actor);
 const source={kind:'product',ref:product.id,revision:product.revision,version:product.revision,sha256:createHash('sha256').update(canonical(product)).digest('hex')};
 return {source,get store(){return store;},get ledger(){return ledger;},
  disk:async()=>JSON.parse(await fs.readFile(path.join(directory,'workspace.json'),'utf8')).businessLibrary.enterpriseMemories,
  reopen:async()=>{await store.close();await open();}};
}
const input=(f,requestId,statement='SYNTHETIC 120 GSM')=>({requestId,audience:'internal',subjectType:'product',subjectId:f.source.ref,factKey:'spec.gsm',statement,source:f.source});
async function reopenedRows(f){const before=await f.disk();await f.reopen();assert.deepEqual(f.store.read().businessLibrary.enterpriseMemories,before);return before;}

for(const seeded of [false,true])test(`real Store concurrent fact writes serialize revisions and history (seeded=${seeded})`,async t=>{
 const f=await fixture(t);if(seeded)await f.ledger.remember(input(f,'seed','SYNTHETIC initial'),actor);
 const results=await Promise.all([f.ledger.remember(input(f,'writer-a'),actor),f.ledger.remember(input(f,'writer-b','SYNTHETIC 145 GSM'),actor)]);
 const rows=await reopenedRows(f),active=rows.filter(x=>x.status==='active');
 console.log(JSON.stringify({case:`fact-${seeded}`,rows:rows.length,active:active.length,revisions:rows.map(x=>x.revision)}));
 assert.equal(active.length,1);assert.deepEqual(rows.map(x=>x.revision),seeded?[1,2,3]:[1,2]);
 const history=f.ledger.history(active[0].id,actor).history;
 assert.equal(history.length,rows.length);assert.deepEqual(history.map(x=>x.revision),rows.map(x=>x.revision).reverse());
 for(const result of results){const retry=await f.ledger.remember(input(f,result.memory.requestId,result.memory.statement),actor);assert.equal(retry.idempotent,true);assert.equal(retry.memory.id,result.memory.id);}
 assert.deepEqual(await f.disk(),rows);
});

test('real Store concurrent identical request retries commit exactly one durable receipt',async t=>{
 const f=await fixture(t),body=input(f,'same-request');
 const results=await Promise.all([f.ledger.remember(body,actor),f.ledger.remember(body,actor)]);
 const rows=await reopenedRows(f);
 console.log(JSON.stringify({case:'identical-request',rows:rows.length,ids:results.map(x=>x.memory.id),idempotent:results.map(x=>x.idempotent)}));
 assert.equal(rows.length,1);assert.equal(results[0].memory.id,results[1].memory.id);
 assert.deepEqual(results.map(x=>x.idempotent).sort(),[false,true]);
 const retry=await f.ledger.remember(body,actor);assert.equal(retry.idempotent,true);assert.equal(retry.memory.id,rows[0].id);
 assert.deepEqual(await f.disk(),rows);
});

test('real Store concurrent conflicting request payloads allow exactly one committed winner',async t=>{
 const f=await fixture(t),a=input(f,'conflicting-request'),b=input(f,'conflicting-request','SYNTHETIC conflicting 145 GSM');
 const results=await Promise.allSettled([f.ledger.remember(a,actor),f.ledger.remember(b,actor)]);
 const rows=await reopenedRows(f);
 console.log(JSON.stringify({case:'conflicting-request',rows:rows.length,statuses:results.map(x=>x.status)}));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.find(x=>x.status==='rejected')?.reason.code,'MEMORY_IDEMPOTENCY_CONFLICT');assert.equal(rows.length,1);
 const winner=rows[0].statement===a.statement?a:b,loser=winner===a?b:a;
 assert.equal((await f.ledger.remember(winner,actor)).memory.id,rows[0].id);
 await assert.rejects(f.ledger.remember(loser,actor),e=>e.code==='MEMORY_IDEMPOTENCY_CONFLICT');assert.deepEqual(await f.disk(),rows);
});

test('real Store source revocation queued before remember is checked at commit',async t=>{
 const f=await fixture(t);
 const archived=f.store.update(state=>{state.businessLibrary.products[0].status='archived';return null;});
 const write=f.ledger.remember(input(f,'revoked-source'),actor);
 const results=await Promise.allSettled([archived,write]);
 assert.equal(results[0].status,'fulfilled');
 assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'MEMORY_SOURCE_REVOKED');
 assert.deepEqual(await reopenedRows(f),[]);
});

test('distinct requestIds with equal facts retain separate receipts and reject later payload reuse',async t=>{
 const f=await fixture(t),a=input(f,'equal-a'),b=input(f,'equal-b');
 const results=await Promise.all([f.ledger.remember(a,actor),f.ledger.remember(b,actor)]);
 assert.deepEqual(results.map(x=>x.memory.revision),[1,2]);
 const rows=await reopenedRows(f);assert.equal(rows.filter(x=>x.status==='active').length,1);
 for(const body of [a,b]){
  assert.equal((await f.ledger.remember(body,actor)).idempotent,true);
  await assert.rejects(f.ledger.remember({...body,statement:'SYNTHETIC changed'},actor),e=>e.code==='MEMORY_IDEMPOTENCY_CONFLICT');
 }
 assert.deepEqual(await f.disk(),rows);
});

test('new writes after revocation continue history without reviving the revoked receipt',async t=>{
 const f=await fixture(t),first=await f.ledger.remember(input(f,'before-revoke'),actor);
 await f.ledger.revoke(first.memory.id,{reason:'Synthetic revoke'},actor);
 const next=await f.ledger.remember(input(f,'after-revoke','SYNTHETIC 145 GSM'),actor);
 assert.equal(next.memory.revision,2);assert.equal(next.memory.previousMemoryId,first.memory.id);
 const rows=await reopenedRows(f);assert.equal(rows[0].status,'revoked');assert.equal(rows[1].status,'active');
 assert.equal(f.ledger.history(next.memory.id,actor).history.length,2);
});

const customer=body=>({...body,audience:'customer',customerId:'synthetic-buyer',visibilityLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic concurrency authorization'});
function delayedDisclosure({cleanupRefused=false}={}){
 const reached=Promise.withResolvers(),release=Promise.withResolvers(),grants=[],revoked=[];
 return {reached:reached.promise,release:release.resolve,grants,revoked,service:{
  grant:async body=>{const id=randomUUID();grants.push({id,body});reached.resolve();await release.promise;return {grant:{id}};},
  revoke:async id=>{revoked.push(id);return {grant:{id,status:'revoked'},...(cleanupRefused?{syncError:'SYNTHETIC_DELETE_FAILED'}:{})};},
 }};
}
const outcome=p=>p.then(value=>({value}),error=>({error}));

test('pending customer authorization refuses another writer and preserves one request receipt',{timeout:10000},async t=>{
 const d=delayedDisclosure(),f=await fixture(t,{disclosure:d.service}),body=customer(input(f,'customer-a'));
 const first=outcome(f.ledger.remember(body,actor));
 try{
  await d.reached;assert.equal((await f.disk())[0].status,'pending');
  const retry=await f.ledger.remember(body,actor);assert.equal(retry.idempotent,true);assert.equal(retry.memory.status,'pending');
  await assert.rejects(f.ledger.remember(customer(input(f,'customer-b','SYNTHETIC 145 GSM')),actor),e=>e.code==='MEMORY_WRITE_PENDING');
  assert.equal(d.grants.length,1);assert.equal((await f.disk()).length,1);
 }finally{d.release();}
 const finished=await first;assert.equal(finished.error,undefined);assert.equal(finished.value.memory.status,'active');
 const next=await f.ledger.remember(customer(input(f,'customer-b','SYNTHETIC 145 GSM')),actor);
 assert.equal(next.memory.revision,2);assert.deepEqual(d.revoked,[d.grants[0].id]);
 const rows=await reopenedRows(f);assert.deepEqual(rows.map(x=>x.status),['superseded','active']);
 assert.equal(f.ledger.history(next.memory.id,actor).history.length,2);
});

test('revoking pending customer memory wins over late grant completion and cleans the grant',{timeout:10000},async t=>{
 const d=delayedDisclosure(),f=await fixture(t,{disclosure:d.service});
 const writing=outcome(f.ledger.remember(customer(input(f,'customer-revoked')),actor));
 let revoked;
 try{await d.reached;const pending=(await f.disk())[0];revoked=await f.ledger.revoke(pending.id,{reason:'Synthetic pending revoke'},actor);}
 finally{d.release();}
 const finished=await writing;assert.equal(finished.error?.code,'MEMORY_WRITE_CHANGED');
 assert.deepEqual(await reopenedRows(f),[revoked.memory]);assert.deepEqual(d.revoked,[d.grants[0].id]);
});

test('source revocation during customer authorization prevents activation and cleans the grant',{timeout:10000},async t=>{
 const d=delayedDisclosure(),f=await fixture(t,{disclosure:d.service});
 const writing=outcome(f.ledger.remember(customer(input(f,'customer-source-revoked')),actor));
 try{await d.reached;await f.store.update(state=>{state.businessLibrary.products[0].status='archived';return null;});}
 finally{d.release();}
 const finished=await writing;assert.equal(finished.error?.code,'MEMORY_SOURCE_REVOKED');
 const rows=await reopenedRows(f);assert.equal(rows[0].status,'sync_error');assert.deepEqual(d.revoked,[d.grants[0].id]);
});

test('late customer grant cleanup refusal is explicit while local memory remains revoked',{timeout:10000},async t=>{
 const d=delayedDisclosure({cleanupRefused:true}),f=await fixture(t,{disclosure:d.service});
 const writing=outcome(f.ledger.remember(customer(input(f,'customer-cleanup-refused')),actor));
 let revoked;
 try{await d.reached;revoked=await f.ledger.revoke((await f.disk())[0].id,{},actor);}
 finally{d.release();}
 const finished=await writing;assert.equal(finished.error?.code,'MEMORY_AUTHZ_CLEANUP_FAILED');
 assert.deepEqual(await reopenedRows(f),[revoked.memory]);assert.deepEqual(d.revoked,[d.grants[0].id]);
});
