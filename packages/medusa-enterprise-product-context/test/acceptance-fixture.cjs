// Explicit persistence/graph stand-ins. The module service, routes and SDK are real.
const {ContainerRegistrationKeys,MedusaError}=require('@medusajs/framework/utils');
const Service=require('../.medusa/server/src/modules/product-context/service.js').default;
const admin=require('../.medusa/server/src/api/admin/products/[id]/context/route.js');
const single=require('../.medusa/server/src/api/agent/product-contexts/[id]/route.js').GET;
const list=require('../.medusa/server/src/api/agent/product-contexts/route.js').GET;
const copy=value=>structuredClone(value);
const response=()=>({code:200,headers:{},status(c){this.code=c;return this},setHeader(k,v){this.headers[k]=v},json(body){this.body=body;return this}});
function fixture(){
 const state={record:null,queries:[],writes:[],pending:[],hold:false,product:{id:'prod-synthetic',title:'Reviewed product',subtitle:'Subtitle',handle:'synthetic',description:'Reviewed description',status:'published',thumbnail:'https://synthetic.invalid/image.png',variants:[{id:'v2',title:'Large',sku:'LARGE'},{id:'v1',title:'Small',sku:'SMALL'}],metadata:{private:'PRODUCT PRIVATE'}}};
 const manager={nativeUpdate:async(entity,where,input)=>{
  state.writes.push({entity,where:copy(where),input:copy(input)});
  const apply=()=>{if(!state.record||state.record.id!==where.id||state.record.review_version!==where.review_version||state.record.deleted_at||(state.record.source_hash??null)!==where.source_hash)return 0;state.record={...state.record,...copy(input),updated_at:new Date()};return 1};
  if(state.hold)return new Promise(resolve=>state.pending.push(()=>resolve(apply())));
  return apply();
 }};
 const service=new Service({baseRepository:{getFreshManager:()=>manager,serialize:async x=>copy(x)},productContextService:{
  list:async()=>state.record?[copy(state.record)]:[],retrieve:async()=>copy(state.record),
  create:async input=>{if(state.record)throw state.duplicateMapped?new MedusaError(MedusaError.Types.INVALID_DATA,'Synthetic duplicate'):Object.assign(new Error('synthetic duplicate'),{code:'23505'});state.record={id:'ctx-synthetic',...copy(input)};return copy(state.record)}
 }});
 const query={graph:async input=>{state.queries.push(copy(input));return input.entity==='product'?{data:[copy(state.product)]}:{data:state.record?[{...copy(state.record),product:copy(state.product)}]:[],metadata:{count:987}}}};
 const request=(body)=>({params:{id:state.product.id},validatedBody:body,auth_context:{actor_id:'synthetic-medusa-user'},query:{},headers:{authorization:'Bearer synthetic-only-token'},scope:{resolve:key=>key===ContainerRegistrationKeys.QUERY?query:service}});
 const call=async(handler,body)=>{const res=response();await handler(request(body),res);return res};
 const read=()=>call(admin.GET);
 const post=body=>call(admin.POST,body);
 async function edit(body){const {body:current}=await read();return post({review_version:current.product_context?.review_version??0,source_hash:current.review_source_hash,...body})}
 return {state,service,request,call,read,post,edit,approve:()=>edit({status:'approved',readiness_score:90}),single:()=>call(single),list:()=>call(list)};
}
module.exports={fixture,response,admin,single,list};
