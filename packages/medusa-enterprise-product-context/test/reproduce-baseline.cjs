const assert=require('node:assert/strict');
// Run only against an explicitly extracted, compiled fixed baseline package.
const root=process.env.MEDUSA_BASELINE_PACKAGE;
if(!root)throw Error('MEDUSA_BASELINE_PACKAGE must point to the compiled baseline package');
const {POST}=require(root+'/.medusa/server/src/api/admin/products/[id]/context/route.js');
const {GET:single}=require(root+'/.medusa/server/src/api/agent/product-contexts/[id]/route.js');
const {GET:list}=require(root+'/.medusa/server/src/api/agent/product-contexts/route.js');
const {ContainerRegistrationKeys}=require('node:module').createRequire(root+'/package.json')('@medusajs/framework/utils');
process.env.AGENT_CONTEXT_READ_TOKEN='synthetic-only';
const response=()=>({code:200,status(c){this.code=c;return this},setHeader(){},json(b){this.body=b;return this}});
const product={id:'prod-synthetic',title:'Reviewed title',description:'Reviewed description',variants:[{id:'v1',title:'Variant',sku:'REVIEWED'}]};
let stored={id:'ctx',product_id:product.id,status:'approved',readiness_score:90,evidence:[],missing_evidence:[],review_version:1,source_hash:'unverified-body-value',notes:'PRIVATE NOTES'};
const graph={graph:async()=>({data:[{...stored,product}],metadata:{count:1}})};
const req=()=>({params:{id:product.id},query:{},headers:{authorization:'Bearer synthetic-only'},scope:{resolve:()=>graph}});
(async()=>{
 product.title='CHANGED UNREVIEWED TITLE';product.description='CHANGED UNREVIEWED DESCRIPTION';product.variants[0].sku='CHANGED-SKU';
 for(const handler of [single,list]){const res=response();await handler(req(),res);const payload=JSON.stringify(res.body);assert.ok(payload.includes('CHANGED UNREVIEWED TITLE'));assert.ok(payload.includes('CHANGED UNREVIEWED DESCRIPTION'));assert.ok(payload.includes('CHANGED-SKU'));console.log('REPRO stale approval emitted changed product: '+(handler===single?'single':'list'));}
 for(const order of ['A-then-B','B-then-A']){
  stored={id:'ctx',product_id:product.id,status:'ready_for_review',readiness_score:90,evidence:[],missing_evidence:[],review_version:1};
  const pending={};let readyResolve;const ready=new Promise(r=>readyResolve=r);let readCount=0;
  const service={listProductContexts:async()=>{const snapshot=structuredClone(stored);if(++readCount===2)readyResolve();await ready;return [snapshot]},updateProductContexts:async input=>new Promise(resolve=>{pending[input.status==='approved'?'A':'B']=()=>{stored={...stored,...input};resolve(structuredClone(stored))}})};
  const admin=(body)=>({params:{id:product.id},validatedBody:body,auth_context:{actor_id:'synthetic-reviewer'},scope:{resolve:k=>k===ContainerRegistrationKeys.QUERY?{graph:async()=>({data:[product]})}:service}});
  const a=POST(admin({status:'approved'}),response()),b=POST(admin({missing_evidence:['certificate']}),response());
  await ready;while(Object.keys(pending).length<2)await new Promise(r=>setImmediate(r));
  const first=order[0],second=first==='A'?'B':'A';pending[first]();await (first==='A'?a:b);pending[second]();await Promise.all([a,b]);
  const res=response();await single(req(),res);assert.equal(res.code,200);assert.equal(stored.status,'approved');assert.deepEqual(stored.missing_evidence,order==='A-then-B'?['certificate']:[]);
  console.log(JSON.stringify({repro:order,status:stored.status,missing_evidence:stored.missing_evidence,agentReturned:true}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
