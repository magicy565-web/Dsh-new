// Actual openStore, original Library/policy/FGA client, loopback HTTP only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {createBusinessLibraryService} from '../server/business-library.mjs';
import {createOpenFgaClient} from '../server/enterprise-openfga.mjs';
import {createEnterpriseDisclosurePolicy} from '../server/enterprise-disclosure-policy.mjs';

const admin={workspaceId:'synthetic-revoke-race',subject:'owner',role:'admin'};
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
async function fixture(t,{writeRefused=false,cleanupRefused=false,firstDeleteRefused=false}={}){
 const directory=await fs.mkdtemp('/tmp/disclosure-revoke-race-');
 let store=await openStore(directory),policy;
 const reached=Promise.withResolvers(),release=Promise.withResolvers(),tuples=new Set(),calls=[];
 const key=tuple=>JSON.stringify({...tuple,relation:tuple.relation.replace(/^can_read_/u,'')+(tuple.relation.startsWith('can_read_')?'_reader':'')});
 const persisted=async()=>JSON.parse(await fs.readFile(path.join(directory,'workspace.json'),'utf8'));
 const server=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));calls.push(body);
   let response={};
   if(req.url==='/stores/synthetic/write'){
    if(body.writes){
     assert.equal((await persisted()).businessLibrary.disclosureGrants[0].status,'pending');
     reached.resolve();await release.promise;
     for(const tuple of body.writes.tuple_keys)tuples.add(key(tuple));
     if(writeRefused){res.writeHead(500);res.end('{}');return;}
    }
    if(body.deletes){
     if(firstDeleteRefused&&calls.filter(row=>row.deletes).length===1){res.writeHead(500);res.end('{}');return;}
     if(cleanupRefused&&calls.filter(row=>row.deletes).length>1){res.writeHead(500);res.end('{}');return;}
     for(const tuple of body.deletes.tuple_keys)tuples.delete(key(tuple));
    }
   }else{assert.equal(req.url,'/stores/synthetic/check');response={allowed:tuples.has(key(body.tuple_key))};}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
  }catch(error){res.writeHead(500);res.end('{}');reached.reject(error);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const fga=createOpenFgaClient({baseURL:`http://127.0.0.1:${server.address().port}`,storeId:'synthetic',authorizationModelId:'synthetic',apiToken:'synthetic-loopback-only-value'});
 function openPolicy(){const library=createBusinessLibraryService({store,artifacts:{}});policy=createEnterpriseDisclosurePolicy({store,library,fga,workspaceId:admin.workspaceId});return library;}
 const library=openPolicy(),product=(await library.createProduct({requestId:randomUUID(),name:'SYNTHETIC race product'},admin)).product;
 t.after(async()=>{release.resolve();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();await fs.rm(directory,{recursive:true,force:true});});
 const input={requestId:randomUUID(),customerId:'synthetic-buyer',resourceType:'product',resourceId:product.id,resourceRevision:product.revision,maxLevel:'public',expiresAt:'2099-01-01T00:00:00Z',purpose:'Synthetic revocation barrier'};
 const query={customerId:input.customerId,resourceType:input.resourceType,resourceId:product.id,resourceRevision:product.revision,level:'public'};
 return {get store(){return store;},get policy(){return policy;},fga,input,query,reached:reached.promise,release:release.resolve,tuples,calls,persisted,
  async reopen(){await store.close();store=await openStore(directory);openPolicy();}};
}

test('revoking a persisted pending grant wins over a later FGA write and survives reopen',{timeout:10000},async t=>{
 const f=await fixture(t),grant=outcome(f.policy.grant(f.input,admin));await f.reached;
 const pending=(await f.persisted()).businessLibrary.disclosureGrants[0];assert.equal(pending.status,'pending');
 const revoked=await f.policy.revoke(pending.id,{reason:'Synthetic revoke during delayed write'},admin);
 assert.equal(revoked.grant.status,'revoked');const atRevoke=(await f.persisted()).businessLibrary.disclosureGrants[0];assert.equal(atRevoke.status,'revoked');
 f.release();const completed=await grant,after=(await f.persisted()).businessLibrary.disclosureGrants[0];
 const checked=await outcome(f.policy.check(f.query)),read=await outcome(f.policy.read(f.query));
 console.log(JSON.stringify({acceptance:'real-store-grant-revoke-barrier',pending:pending.status,atRevoke:atRevoke.status,afterLateWrite:after.status,grantError:completed.error?.code||null,checkAllowed:Boolean(checked.value?.allowed),readAllowed:Boolean(read.value),externalTupleCount:f.tuples.size,externalDeletes:f.calls.filter(row=>row.deletes).length,realExternalRequests:0}));
 assert.equal(after.status,'revoked');assert.equal(after.revision,atRevoke.revision);assert.deepEqual(after.history,atRevoke.history);
 assert.equal(completed.error?.code,'DISCLOSURE_GRANT_CHANGED');assert.equal(checked.error?.code,'DISCLOSURE_SCOPE_DENIED');assert.equal(read.error?.code,'DISCLOSURE_SCOPE_DENIED');
 assert.equal(f.tuples.size,0);assert.equal(f.calls.filter(row=>row.deletes).length,2);
 await f.reopen();assert.equal(f.policy.list().grants[0].status,'revoked');
 await assert.rejects(f.policy.check(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');await assert.rejects(f.policy.read(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});

test('unchanged pending grant activates, persists and authorizes through the loopback FGA client',{timeout:10000},async t=>{
 const f=await fixture(t),grant=outcome(f.policy.grant(f.input,admin));await f.reached;f.release();
 const completed=await grant;assert.equal(completed.error,undefined);assert.equal(completed.value.grant.status,'active');assert.equal(completed.value.grant.revision,2);
 assert.deepEqual((await f.persisted()).businessLibrary.disclosureGrants[0],completed.value.grant);
 assert.equal((await f.policy.check(f.query)).allowed,true);assert.equal((await f.policy.read(f.query)).resource.name,'SYNTHETIC race product');
 assert.equal(f.calls.filter(row=>row.deletes).length,0);await f.reopen();assert.equal((await f.policy.check(f.query)).allowed,true);
});

test('pending revision drift cannot be overwritten by the original grant activation',{timeout:10000},async t=>{
 const f=await fixture(t),grant=outcome(f.policy.grant(f.input,admin));await f.reached;
 await f.store.update(state=>{const row=state.businessLibrary.disclosureGrants[0];row.revision++;row.history.push({...structuredClone(row.history[0]),revision:row.revision,action:'synthetic_revision_change'});});
 const changed=(await f.persisted()).businessLibrary.disclosureGrants[0];f.release();const completed=await grant;
 assert.equal(completed.error?.code,'DISCLOSURE_GRANT_CHANGED');assert.deepEqual((await f.persisted()).businessLibrary.disclosureGrants[0],changed);assert.equal(f.tuples.size,0);
 await assert.rejects(f.policy.check(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});

test('a late refused write preserves revocation and cleans an ambiguously applied tuple',{timeout:10000},async t=>{
 const f=await fixture(t,{writeRefused:true}),grant=outcome(f.policy.grant(f.input,admin));await f.reached;
 const revoked=await f.policy.revoke(f.policy.list().grants[0].id,{},admin);f.release();const completed=await grant;
 assert.equal(completed.error?.code,'FGA_UPSTREAM_REFUSED');assert.deepEqual((await f.persisted()).businessLibrary.disclosureGrants[0],revoked.grant);assert.equal(f.tuples.size,0);
 await assert.rejects(f.policy.check(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');await assert.rejects(f.policy.read(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});

test('failed late-tuple cleanup is explicit while local revocation still denies check and read',{timeout:10000},async t=>{
 const f=await fixture(t,{cleanupRefused:true}),grant=outcome(f.policy.grant(f.input,admin));await f.reached;
 const revoked=await f.policy.revoke(f.policy.list().grants[0].id,{},admin);f.release();const completed=await grant;
 assert.equal(completed.error?.code,'DISCLOSURE_CLEANUP_FAILED');assert.deepEqual((await f.persisted()).businessLibrary.disclosureGrants[0],revoked.grant);assert.equal(f.tuples.size,1);
 await assert.rejects(f.policy.check(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');await assert.rejects(f.policy.read(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});


test('real policy retries failed FGA delete after durable revoked state and reopen',{timeout:10000},async t=>{
 const f=await fixture(t,{firstDeleteRefused:true});const pending=f.policy.grant(f.input,admin);await f.reached;f.release();const saved=await pending;
 assert.equal(f.tuples.size,1);const first=await f.policy.revoke(saved.grant.id,{},admin);
 assert.ok(first.syncError);assert.equal(first.grant.status,'revoked');assert.equal(f.tuples.size,1);
 await assert.rejects(f.policy.check(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');await f.reopen();
 const second=await f.policy.revoke(saved.grant.id,{},admin);assert.equal(second.idempotent,true);assert.equal(second.syncError,undefined);assert.equal(f.tuples.size,0);
 assert.equal(f.calls.filter(x=>x.deletes).length,2);assert.deepEqual(second.grant,first.grant);
 await assert.rejects(f.policy.read(f.query),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});
