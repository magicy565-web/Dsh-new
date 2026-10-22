const test=require('node:test');
const assert=require('node:assert/strict');
const {ContainerRegistrationKeys,MedusaError}=require('@medusajs/framework/utils');
const {GET,POST}=require('../.medusa/server/src/business-routes.js');
const {granted,digest,summaryIntent,receipt}=require('../.medusa/server/src/business-contract.js');
const {reviewSourceHash,isCurrentApprovedContext}=require('../.medusa/server/src/product-context-review.js');
// Compiled route tests with explicit persistence/query stand-ins; NOT real DB acceptance.
const actor={actor_id:'user_synthetic',actor_type:'user'};
const grants=[{actor_id:actor.actor_id,product_ids:['prod_synthetic'],capabilities:['product.read','price.read','inventory.read','context.summary.write']}];
process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON=JSON.stringify(grants);
function fixture(){
 const product={id:'prod_synthetic',title:'Synthetic',description:'Internal',status:'draft',metadata:{secret:'PRIVATE'},variants:[{id:'variant_1',sku:'SYN',manage_inventory:true,allow_backorder:false,price_set:{prices:[{id:'price_1',amount:15,currency_code:'usd',price_rules:[{attribute:'region_id',value:'reg_synthetic',secret:'PRIVATE'}],metadata:'PRIVATE'}]},inventory_items:[{inventory_item_id:'iitem_1',required_quantity:2,inventory:{location_levels:[{id:'ilev_1',location_id:'sloc_1',stocked_quantity:10,reserved_quantity:3,available_quantity:7,metadata:'PRIVATE'}]}}]}]};
 const state={record:{id:'ctx_synthetic',product_id:product.id,review_version:1,source_hash:null,status:'ready_for_review',agent_summary:'Old',notes:'PRIVATE'},writes:0,queries:[]};
 const service={listProductContexts:async()=>state.record?[structuredClone(state.record)]:[],updateReviewedProductContext:async(id,version,input,hash)=>{
  if(state.record.review_version!==version||state.record.source_hash!==hash)throw new MedusaError(MedusaError.Types.CONFLICT,'conflict');
  state.record={...state.record,...input};state.writes++;return structuredClone(state.record);
 }};
 const req=()=>({params:{id:product.id},query:{},auth_context:{...actor},scope:{resolve:key=>key===ContainerRegistrationKeys.QUERY?{graph:async q=>{state.queries.push(q);return {data:[product]}}}:service}});
 const res=()=>({code:200,headers:{},status(c){this.code=c;return this},setHeader(k,v){this.headers[k]=v},json(b){this.body=b;return this}});
 const input=()=>{const i={operation_id:'00000000-0000-4000-8000-000000000001',review_version:state.record.review_version,source_hash:reviewSourceHash(state.record,product),agent_summary:'Updated'};return {...i,confirmation:digest(summaryIntent(actor.actor_id,product.id,i))}};
 const run=async(handler,changes={})=>{const request=Object.assign(req(),changes),response=res();await handler(request,response);return response};
 return {product,state,service,req,res,input,run};
}
test('capabilities deny unconfigured, malformed, foreign user, API key and product scope',()=>{
 for(const raw of [undefined,'','{}','[{}]','[{"actor_id":"user_synthetic","product_ids":["*"],"capabilities":["product.read"]}]'])assert.equal(granted(actor,'prod_synthetic',['product.read'],raw===undefined?'':raw),false);
 for(const a of [{},{...actor,actor_type:'api-key'},{...actor,actor_id:'other'}])assert.equal(granted(a,'prod_synthetic',['product.read'],JSON.stringify(grants)),false);
 assert.equal(granted(actor,'prod_other',['product.read'],JSON.stringify(grants)),false);
 assert.equal(granted(actor,'prod_synthetic',['product.read'],JSON.stringify(grants)),true);
});
test('source revision hashes the serialized timestamps returned over HTTP',()=>{
 const timestamp=new Date('2026-01-01T00:00:00.000Z');
 assert.equal(digest({updated_at:timestamp}),digest({updated_at:timestamp.toISOString()}));
 assert.notEqual(digest({updated_at:timestamp}),digest({updated_at:new Date('2026-01-02T00:00:00.000Z')}));
});
test('read projection fetches only authorized fields and never arbitrary metadata',async()=>{
 const f=fixture();const basic=await f.run(GET);assert.equal(basic.code,200);assert.ok(!JSON.stringify(basic.body).includes('PRIVATE'));
 assert.equal(basic.body.product.variants[0].prices,undefined);assert.ok(!f.state.queries[0].fields.some(x=>/prices|location_levels/.test(x)));
 const full=await f.run(GET,{query:{include:'prices,inventory'}});assert.equal(full.code,200);
 assert.equal(full.body.product.variants[0].prices[0].amount,15);assert.equal(full.body.product.variants[0].inventory_items[0].location_levels[0].available_quantity,7);
 assert.ok(!JSON.stringify(full.body).includes('PRIVATE'));assert.equal(full.headers['Cache-Control'],'no-store');
 f.product.variants[0].price_set.prices[0].amount=18;
 assert.notEqual((await f.run(GET,{query:{include:'prices,inventory'}})).body.revision,full.body.revision);
 for(const query of [{fields:'*'},{include:'customers'},{include:['prices']}])assert.equal((await f.run(GET,{query})).code,400);
});
test('read rejects unauthorized fields before any query',async()=>{
 const f=fixture(),original=process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON;
 try{process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON=JSON.stringify([{...grants[0],capabilities:['product.read']}]);assert.equal((await f.run(GET,{query:{include:'prices'}})).code,403);assert.equal(f.state.queries.length,0)}finally{process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON=original}
 assert.equal((await f.run(GET,{auth_context:{}})).code,401);
});
test('confirmed summary write is conditional, withdraws release, and replays durable receipt',async()=>{
 const f=fixture(),body=f.input();f.state.record.status='approved';f.state.record.reviewed_by=actor.actor_id;f.state.record.reviewed_at=new Date().toISOString();
 const applied=await f.run(POST,{body});assert.equal(applied.code,200);assert.equal(f.state.writes,1);assert.equal(f.state.record.reviewed_by,null);assert.equal(f.state.record.status,'ready_for_review');assert.equal(isCurrentApprovedContext({...f.state.record,product:f.product}),false);
 const restored=fixture();restored.state.record=JSON.parse(JSON.stringify(f.state.record));
 const replay=await restored.run(POST,{body});assert.equal(replay.code,200);assert.equal(replay.body.replayed,true);assert.equal(restored.state.writes,0);assert.equal(replay.body.receipt,receipt(actor.actor_id,f.product.id,body));
 assert.ok(!JSON.stringify(replay.body).includes('PRIVATE'));
 const next=f.input();next.operation_id='00000000-0000-4000-8000-000000000002';next.agent_summary='Newer';next.confirmation=digest(summaryIntent(actor.actor_id,f.product.id,next));
 assert.equal((await f.run(POST,{body:next})).code,200);assert.equal((await f.run(POST,{body})).code,409);assert.equal(f.state.writes,2);
});
test('mismatched confirmation, stale revision, extra fields and integer ceiling fail without writes',async()=>{
 for(const change of [{confirmation:'0'.repeat(64)},{notes:'not allowed'},{review_version:2147483647},{agent_summary:'changed after confirmation'}]){
  const f=fixture(),body={...f.input(),...change};assert.ok([400,422].includes((await f.run(POST,{body})).code));assert.equal(f.state.writes,0);
 }
 const f=fixture(),body=f.input();f.product.title='Concurrent product edit';assert.equal((await f.run(POST,{body})).code,409);assert.equal(f.state.writes,0);
});
test('duplicate concurrent operations mutate once; distinct operations conflict',async()=>{
 for(const duplicate of [true,false]){
  const f=fixture(),first=f.input(),second={...first};if(!duplicate){second.operation_id='00000000-0000-4000-8000-000000000002';second.agent_summary='Different';second.confirmation=digest(summaryIntent(actor.actor_id,f.product.id,second))}
  const results=await Promise.all([f.run(POST,{body:first}),f.run(POST,{body:second})]);assert.deepEqual(results.map(r=>r.code),duplicate?[200,200]:[200,409]);assert.equal(f.state.writes,1);
 }
});
test('mounted versioned routes and machine contract refer to the same compiled handlers',()=>{
 const contract=require('../../../contracts/workspace-medusa-business.v1.json');
 const read=require('../.medusa/server/src/api/admin/workspace-business/v1/products/[id]/route.js');
 const write=require('../.medusa/server/src/api/admin/workspace-business/v1/products/[id]/summary/route.js');
 assert.equal(read.GET,GET);assert.equal(write.POST,POST);
 assert.equal(contract.schema_version,require('../.medusa/server/src/business-contract.js').BUSINESS_VERSION);
 const routes=require('../.medusa/server/src/api/middlewares.js').default.routes;
 for(const operation of contract.operations){
  const path=operation.path.replace('{id}',':id');
  assert.ok(routes.some(r=>r.matcher===path&&r.methods.includes(operation.method)&&r.middlewares.length>0));
 }
});
test('revocation blocks replay and later existing admin reapproval accepts the stamped source',async()=>{
 const f=fixture(),body=f.input();assert.equal((await f.run(POST,{body})).code,200);
 const raw=process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON;
 try{delete process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON;assert.equal((await f.run(POST,{body})).code,403);assert.equal(f.state.writes,1)}finally{process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON=raw}
 Object.assign(f.state.record,{readiness_score:90,buyer_profile:null,target_markets:[],use_cases:[],selling_points:[],evidence:[],commercial_policy:null,missing_evidence:[]});
 const admin=require('../.medusa/server/src/api/admin/products/[id]/context/route.js').POST;
 const result=await f.run(admin,{validatedBody:{status:'approved',review_version:f.state.record.review_version,source_hash:reviewSourceHash(f.state.record,f.product)}});
 assert.equal(result.code,200);assert.equal(isCurrentApprovedContext({...f.state.record,product:f.product}),true);
 assert.equal((await f.run(POST,{body})).code,409);
});
