const test=require('node:test');
const assert=require('node:assert/strict');
const {isAgentContextReadAuthorized}=require('../.medusa/server/src/agent-auth.js');
const {POST}=require('../.medusa/server/src/api/admin/products/[id]/context/route.js');
const {ContainerRegistrationKeys}=require('@medusajs/framework/utils');
const {reviewSourceHash}=require('../.medusa/server/src/product-context-review.js');
// The installed Medusa SDK and compiled routes are real. Persistence below is
// an explicit unit stand-in; this is not a running Medusa/DB acceptance.
test('Agent read token is explicit and exact; no ambient credential required',()=>{
 const token='synthetic-agent-read-token';
 assert.equal(isAgentContextReadAuthorized('Bearer '+token,token),true);
 assert.equal(isAgentContextReadAuthorized('Bearer wrong',token),false);
 assert.equal(isAgentContextReadAuthorized('Bearer '+token,''),false);
 assert.equal(isAgentContextReadAuthorized(undefined,token),false);
});
function request(body,current=null){
 body={...body,review_version:current?.review_version??0,source_hash:reviewSourceHash(current,{id:'prod-synthetic',title:'Synthetic product'})};
 const saved=[];const service={listProductContexts:async()=>current?[current]:[],createProductContexts:async input=>{saved.push(input);return {id:'ctx-synthetic',...input}},updateProductContexts:async input=>{saved.push(input);return input}};
 const req={params:{id:'prod-synthetic'},validatedBody:body,auth_context:{actor_id:'original-medusa-user'},scope:{resolve:key=>key===ContainerRegistrationKeys.QUERY?{graph:async()=>({data:[{id:'prod-synthetic',title:'Synthetic product'}]})}:service}};
 const res={statusCode:200,status(code){this.statusCode=code;return this},setHeader(){},json(body){this.body=body;return this}};
 return {req,res,saved};
}
test('compiled original admin route rejects approval with missing or malformed evidence',async()=>{
 for(const evidence of [[{id:'e',status:'missing'}],{invalid:true}]){
  const f=request({status:'approved',readiness_score:90},{id:'ctx',evidence,missing_evidence:[]});
  await POST(f.req,f.res);assert.equal(f.res.statusCode,422);assert.equal(f.saved.length,0);
 }
});
test('reviewed compiled context keeps JSON evidence arrays and original authenticated reviewer',async()=>{
 const evidence=[{id:'e',label:'Synthetic',type:'spec_sheet',status:'verified'}];
 const f=request({status:'approved',readiness_score:90,evidence,reviewed_by:'UNTRUSTED_BODY'});
 await POST(f.req,f.res);assert.equal(f.res.statusCode,200);assert.equal(f.saved.length,1);assert.deepEqual(f.saved[0].evidence,evidence);assert.equal(f.saved[0].reviewed_by,'original-medusa-user');
});
test('compiled Medusa module and read-only Product Context link load against the pinned SDK',()=>{
 const {MedusaModule}=require('@medusajs/modules-sdk');
 const before=MedusaModule.getCustomLinks().length;
 const module=require('../.medusa/server/src/modules/product-context/index.js');
 require('../.medusa/server/src/links/product-context-product.js');
 const links=MedusaModule.getCustomLinks().slice(before).map(register=>register([{serviceName:'product'},{serviceName:'product_context'}]));
 assert.ok(module.default);assert.equal(module.PRODUCT_CONTEXT_MODULE,'product_context');assert.equal(links.length,2);
 assert.ok(links.every(link=>link.isReadOnlyLink===true));
 const direct=links.find(link=>link.extends[0].serviceName==='product_context').extends[0].relationship;
 assert.equal(direct.foreignKey,'product_id');assert.equal(direct.primaryKey,'id');assert.equal(direct.alias,'product');
});
