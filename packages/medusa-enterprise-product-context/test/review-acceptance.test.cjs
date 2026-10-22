const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {fixture,response,admin,single,list}=require('./acceptance-fixture.cjs');
const {reviewSourceHash,PRODUCT_FIELDS,CONTEXT_FIELDS}=require('../.medusa/server/src/product-context-review.js');
process.env.AGENT_CONTEXT_READ_TOKEN='synthetic-only-token';

test('loopback HTTP uses compiled Agent routes: authorization, approved projection, stale source and explicit rereview',async t=>{
 const f=fixture();assert.equal((await f.edit({status:'incomplete',notes:'CONTEXT PRIVATE',evidence:[{id:'e',label:'Synthetic certificate',type:'certificate',status:'verified',source:'PRIVATE EVIDENCE LOCATION',sha256:'a'.repeat(64)}],commercial_policy:{moq:0,currency:'USD',sample_policy:'Sample'}})).code,200);
 assert.equal((await f.approve()).code,200);
 const server=http.createServer(async(req,res)=>{try{
  const target=req.url==='/agent/product-contexts'?list:single;
  const request=f.request();request.headers=req.headers;
  const result=response();await target(request,result);
  res.writeHead(result.code,{'content-type':'application/json',...result.headers});res.end(JSON.stringify(result.body));
 }catch{res.writeHead(500);res.end('{"message":"Unexpected test error"}')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const paths=['/agent/product-contexts','/agent/product-contexts/prod-synthetic'];
 for(const path of paths){
  for(const authorization of [undefined,'Bearer wrong']){
   const before=f.state.queries.length;const r=await fetch(origin+path,{headers:authorization?{authorization}:{}});assert.equal(r.status,401);assert.equal(f.state.queries.length,before);
  }
  const r=await fetch(origin+path,{headers:{authorization:'Bearer synthetic-only-token'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const body=await r.json(),projection=body.items?.[0]??{context:body.context,product:body.product};
  assert.equal(projection.context.source_hash,f.state.record.source_hash);assert.equal(projection.context.commercial_policy.moq,0);
  assert.deepEqual(projection.product.variants.map(v=>v.id),['v1','v2']);
  assert.ok(!JSON.stringify(body).includes('PRIVATE'));if(body.items)assert.equal(body.count,1);
 }
 f.state.product.title='CHANGED UNREVIEWED TITLE';f.state.product.description='CHANGED UNREVIEWED DESCRIPTION';f.state.product.variants[0].sku='CHANGED-SKU';
 for(const path of paths){const r=await fetch(origin+path,{headers:{authorization:'Bearer synthetic-only-token'}});const body=await r.json();assert.equal(r.status,path===paths[0]?200:404);assert.ok(!JSON.stringify(body).includes('CHANGED'));assert.ok(!JSON.stringify(body).includes('PRIVATE'));if(body.items){assert.deepEqual(body.items,[]);assert.equal(body.count,0)}}
 const staleHash=f.state.record.source_hash;
 assert.equal((await f.post({status:'approved',review_version:f.state.record.review_version,source_hash:staleHash})).code,409);
 assert.equal((await f.approve()).code,200);assert.notEqual(f.state.record.source_hash,staleHash);
 assert.equal((await f.single()).body.product.title,'CHANGED UNREVIEWED TITLE');
 assert.deepEqual((await f.list()).body.items[0],{context:(await f.single()).body.context,product:(await f.single()).body.product});
 delete process.env.AGENT_CONTEXT_READ_TOKEN;
 try{for(const path of paths){const before=f.state.queries.length;const r=await fetch(origin+path,{headers:{authorization:'Bearer synthetic-only-token'}});assert.equal(r.status,401);assert.equal(f.state.queries.length,before)}}
 finally{process.env.AGENT_CONTEXT_READ_TOKEN='synthetic-only-token'}
});

test('fingerprint binds every mapped product field, context material and revision; ordering alone does not invalidate',async()=>{
 const f=fixture();await f.approve();const original=structuredClone(f.state);
 const changed=[...PRODUCT_FIELDS.filter(k=>!k.startsWith('variants.')).map(field=>()=>{f.state.product[field]='CHANGED'}),
  ...['id','title','sku'].map(field=>()=>{f.state.product.variants[0][field]='CHANGED'}),
  ()=>{f.state.product.variants.push({id:'new',title:'New',sku:'NEW'})},()=>{f.state.product.variants.pop()},
  ()=>{f.state.record.review_version++},()=>{f.state.record.agent_summary='UNREVIEWED'},()=>{f.state.record.source_hash='forged'},
  ()=>{f.state.record.product_id='different'},()=>{f.state.record.reviewed_by=null},()=>{f.state.record.reviewed_at=null},
  ()=>{f.state.record.source_hash=null}];
 for(const mutate of changed){f.state.product=structuredClone(original.product);f.state.record=structuredClone(original.record);mutate();assert.equal((await f.single()).code,404);assert.deepEqual((await f.list()).body.items,[])}
 f.state.product=structuredClone(original.product);f.state.record=structuredClone(original.record);f.state.product.variants.reverse();assert.equal((await f.single()).code,200);
 assert.deepEqual(f.state.queries.filter(q=>q.entity==='product_context').at(-1).fields,CONTEXT_FIELDS);
});

test('edits revoke old approval; incomplete, review-ready, blocked and invalid releases fail closed on both reads',async()=>{
 const f=fixture();await f.approve();const old=structuredClone(f.state.record);
 assert.equal((await f.edit({agent_summary:'Edited context'})).code,200);assert.equal(f.state.record.status,'ready_for_review');assert.equal(f.state.record.source_hash,null);assert.equal(f.state.record.reviewed_by,null);assert.equal(f.state.record.reviewed_at,null);
 assert.equal((await f.single()).code,404);await f.approve();
 for(const status of ['incomplete','ready_for_review','blocked']){await f.edit({status});assert.equal((await f.single()).code,404);assert.deepEqual((await f.list()).body.items,[])}
 for(const bad of [{readiness_score:79},{readiness_score:NaN},{missing_evidence:['certificate']},{missing_evidence:null},{evidence:[{status:'missing'}]},{evidence:[null]},{evidence:{invalid:true}}]){
  f.state.record={...old,...bad};assert.equal((await f.single()).code,404);assert.deepEqual((await f.list()).body.items,[]);
 }
 f.state.record=old;for(const review_version of [undefined,0,old.review_version+1]){assert.equal((await f.post({status:'approved',review_version,source_hash:old.source_hash})).code,409)}
 assert.equal((await f.post({status:'approved',review_version:old.review_version,source_hash:'forged'})).code,409);
});

test('two concurrent admin requests use atomic CAS in both completion orders',async()=>{
 for(const order of ['approval-first','evidence-first']){
  const f=fixture();await f.edit({status:'ready_for_review',readiness_score:90});const read=(await f.read()).body;
  const guard={review_version:read.product_context.review_version,source_hash:read.review_source_hash};f.state.hold=true;
  const a=f.post({...guard,status:'approved'}),b=f.post({...guard,missing_evidence:['certificate']});
  while(f.state.pending.length<2)await new Promise(resolve=>setImmediate(resolve));
  const first=order==='approval-first'?0:1,second=1-first;f.state.pending[first]();const firstResult=await (first===0?a:b);f.state.pending[second]();const secondResult=await (second===0?a:b);
  assert.equal(firstResult.code,200);assert.equal(secondResult.code,409);assert.equal(f.state.record.review_version,guard.review_version+1);
  if(order==='approval-first'){assert.equal((await f.single()).code,200);assert.deepEqual(f.state.record.missing_evidence,[])}
  else{assert.equal((await f.single()).code,404);assert.deepEqual(f.state.record.missing_evidence,['certificate']);assert.equal(f.state.record.source_hash,null)}
  assert.ok(f.state.writes.every(w=>w.where.id==='ctx-synthetic'&&w.where.review_version===guard.review_version&&w.where.deleted_at===null));
 }
 for(const duplicateMapped of [false,true]){
  const f=fixture();f.state.duplicateMapped=duplicateMapped;
  const guard={review_version:0,source_hash:(await f.read()).body.review_source_hash};
  const results=await Promise.all([f.post({...guard,status:'approved',readiness_score:90}),f.post({...guard,missing_evidence:['certificate']})]);
  assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);assert.equal(f.state.record.review_version,1);
 }
});

test('actual MikroORM PostgreSQL metadata generates a revision-predicated UPDATE; no DB connection',async t=>{
 const {MikroORM}=require('@medusajs/framework/mikro-orm/postgresql');
 const {toMikroORMEntity}=require('@medusajs/framework/utils');
 const {ProductContext}=require('../.medusa/server/src/modules/product-context/models/product-context.js');
 const Service=require('../.medusa/server/src/modules/product-context/service.js').default;
 const entity=toMikroORMEntity(ProductContext);
 const orm=await MikroORM.init({entities:[entity],dbName:'synthetic_not_connected',connect:false});t.after(()=>orm.close());
 assert.match(await orm.schema.getCreateSchemaSQL(),/"review_version" integer/);
 const captured=[];let affectedRows=1;
 // Transport interception only: exercise the pinned ORM's actual query compiler,
 // never claim that this executes against PostgreSQL or checks DB isolation.
 orm.em.getConnection().execute=async(sql,params)=>{captured.push({sql,params});return {affectedRows}};
 const service=new Service({baseRepository:{getFreshManager:()=>orm.em.fork(),serialize:async x=>x},productContextService:{retrieve:async()=>({id:'ctx-sql'})}});
 await service.updateReviewedProductContext('ctx-sql',7,{status:'approved',review_version:8,source_hash:'a'.repeat(64),missing_evidence:[],evidence:[{id:'e',status:'verified'}]},'old-source');
 assert.equal(captured.length,1);assert.match(captured[0].sql,/^update "product_context" set /);assert.match(captured[0].sql,/where .*"id" = .* and .*"review_version" = .* and .*"deleted_at" is null/);
 assert.match(captured[0].sql,/and .*"source_hash" = /);
 assert.deepEqual(captured[0].params.slice(-3),['ctx-sql',7,'old-source']);
 assert.ok(captured[0].params.includes(8));assert.ok(captured[0].params.includes('a'.repeat(64)));
 affectedRows=0;await assert.rejects(service.updateReviewedProductContext('ctx-sql',7,{review_version:8},'old-source'),{type:'conflict'});
});

test('integer-bound revisions remain editable and revocable; ceiling stamps fence stale and concurrent writes',async()=>{
 const {MAX_REVIEW_VERSION}=require('../.medusa/server/src/product-context-validation.js');
 const {sealReviewSource}=require('../.medusa/server/src/product-context-review.js');
 const validate=require('../.medusa/server/src/api/middlewares.js').default.routes.find(r=>r.matcher==='/admin/products/:id/context'&&r.methods.includes('POST')).middlewares[1];
 async function validationError(body){let error;await validate({body},response(),e=>{error=e});return error}
 for(const review_version of [0,99999,100000,MAX_REVIEW_VERSION-1,MAX_REVIEW_VERSION])assert.equal(await validationError({review_version}),undefined);
 for(const review_version of [undefined,-1,MAX_REVIEW_VERSION+1,1.5])assert.ok(await validationError({review_version}));
 for(const initial of [99999,100000,MAX_REVIEW_VERSION-1,MAX_REVIEW_VERSION]){
  const f=fixture();await f.approve();f.state.record.review_version=initial;f.state.record.source_hash=sealReviewSource(f.state.record,f.state.product,true);
  assert.equal((await f.single()).code,200);assert.equal((await f.approve()).code,200);assert.equal(f.state.record.review_version,Math.min(initial+1,MAX_REVIEW_VERSION));
  assert.equal((await f.edit({status:'blocked'})).code,200);assert.equal((await f.single()).code,404);assert.deepEqual((await f.list()).body.items,[]);
  assert.equal((await f.edit({agent_summary:'Edited after withdrawal'})).code,200);assert.equal((await f.approve()).code,200);
 }
 const f=fixture();await f.approve();f.state.record.review_version=MAX_REVIEW_VERSION;f.state.record.source_hash=sealReviewSource(f.state.record,f.state.product,true);
 let read=(await f.read()).body;const stale={review_version:MAX_REVIEW_VERSION,source_hash:read.review_source_hash,status:'approved'};
 assert.equal((await f.post({review_version:MAX_REVIEW_VERSION,status:'blocked'})).code,409);
 assert.equal((await f.post({...stale,review_version:undefined})).code,409);
 assert.equal((await f.post({...stale,review_version:MAX_REVIEW_VERSION-1})).code,409);
 assert.equal((await f.post(stale)).code,200);assert.equal(f.state.record.review_version,MAX_REVIEW_VERSION);assert.equal((await f.single()).code,200);
 assert.equal((await f.post(stale)).code,409); // Same content/version, a new stamp still rejects replay.
 assert.equal((await f.edit({status:'blocked'})).code,200);assert.equal((await f.approve()).code,200);
 assert.equal((await f.post(stale)).code,409); // Returning to approved cannot revive the old revision.
 for(const order of ['approval-first','withdrawal-first']){
  read=(await f.read()).body;const guard={review_version:MAX_REVIEW_VERSION,source_hash:read.review_source_hash};f.state.hold=true;f.state.pending=[];
  const a=f.post({...guard,status:'approved'}),b=f.post({...guard,status:'blocked'});
  while(f.state.pending.length<2)await new Promise(resolve=>setImmediate(resolve));
  const first=order==='approval-first'?0:1;f.state.pending[first]();const firstResult=await (first===0?a:b);f.state.pending[1-first]();const secondResult=await (first===0?b:a);
  assert.equal(firstResult.code,200);assert.equal(secondResult.code,409);assert.equal(f.state.record.review_version,MAX_REVIEW_VERSION);
  assert.equal((await f.single()).code,first===0?200:404);f.state.hold=false;
 }
});

test('complete shared schema refuses malformed legacy JSON before reapproval and both Agent projections',async()=>{
 const marker={source:'SYNTHETIC PRIVATE'};
 const validate=require('../.medusa/server/src/api/middlewares.js').default.routes.find(r=>r.matcher==='/admin/products/:id/context'&&r.methods.includes('POST')).middlewares[1];
 const cases=[
  {evidence:[{id:'e',label:marker,type:'certificate',status:'verified'}]},
  {commercial_policy:{moq:{internal_note:'SYNTHETIC PRIVATE'}}},
  {commercial_policy:{moq:1,internal_note:'SYNTHETIC PRIVATE'}}, {commercial_policy:{moq:Infinity}},
  {target_markets:[marker]}, {buyer_profile:marker}, {agent_summary:marker},
  {use_cases:[marker]}, {selling_points:[marker]},
 ];
 for(const malformed of cases){
  let validationError;await validate({body:{review_version:1,...malformed}},response(),e=>{validationError=e});assert.ok(validationError);
  const f=fixture();await f.approve();Object.assign(f.state.record,structuredClone(malformed));
  f.state.record.source_hash=reviewSourceHash(f.state.record,f.state.product); // Even a matching old signer cannot release malformed values.
  const before=structuredClone(f.state.record),writes=f.state.writes.length;
  assert.equal((await f.single()).code,404);const listed=await f.list();assert.deepEqual(listed.body.items,[]);assert.ok(!JSON.stringify(listed.body).includes('SYNTHETIC PRIVATE'));
  const result=await f.approve();assert.equal(result.code,422);assert.ok(!JSON.stringify(result.body).includes('SYNTHETIC PRIVATE'));assert.deepEqual(f.state.record,before);assert.equal(f.state.writes.length,writes);
  const corrected=Object.fromEntries(Object.keys(malformed).map(key=>[key,['evidence','target_markets','use_cases','selling_points'].includes(key)?[]:null]));
  assert.equal((await f.edit({...corrected,status:'approved'})).code,200);assert.equal((await f.single()).code,200);assert.ok(!JSON.stringify((await f.single()).body).includes('SYNTHETIC PRIVATE'));
 }
});
