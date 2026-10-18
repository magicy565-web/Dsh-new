import {randomUUID} from 'node:crypto'
import {createMedusaApprovedSource} from '../../plugins/workspace-medusa-catalog/src/approved-source.mjs'
import {MAX_VERSION,POLICY,loadPg} from './config.mjs'
import {openPostgres,raceWithRowLock} from './postgres.mjs'

export const raceCases=()=>[1,MAX_VERSION].flatMap(version=>['missing_evidence','revoke'].flatMap(kind=>['approval-first','negative-first'].map(order=>({version,kind,order}))))
export const guard=snapshot=>({review_version:snapshot.product_context?.review_version??0,source_hash:snapshot.review_source_hash})
const path=id=>'/admin/products/'+encodeURIComponent(id)+'/context'
const content={status:'ready_for_review',readiness_score:92,buyer_profile:'Synthetic acceptance buyer',target_markets:['Test'],use_cases:['Test'],selling_points:['Test'],
 evidence:[{id:'spec',label:'Synthetic specification',type:'spec_sheet',status:'verified',source:'private-source-sentinel'}],commercial_policy:{currency:'USD',moq:1},missing_evidence:[],agent_summary:'Synthetic acceptance only',notes:'private-note-sentinel'}

export function assertPublicPayload(value,check,name){
 const forbidden=[]
 const fields=(node,keys,location)=>{
  if(node==null)return
  if(typeof node!=='object'||Array.isArray(node)){forbidden.push(location);return}
  for(const key of Object.keys(node))if(!keys.includes(key))forbidden.push(location+'.'+key)
 }
 const scalars=(node,except,location)=>{for(const [key,item] of Object.entries(node??{}))if(!except.includes(key)&&item!==null&&typeof item==='object')forbidden.push(location+'.'+key)}
 const rows=(items,inspect,location)=>{if(items==null)return;if(!Array.isArray(items)){forbidden.push(location);return}items.forEach(inspect)}
 const projection=row=>{
  const product=row?.product,context=row?.context
  fields(product,['id','title','subtitle','handle','description','status','thumbnail','variants'],'product')
  scalars(product,['variants'],'product')
  rows(product?.variants,variant=>{fields(variant,['id','title','sku'],'variant');scalars(variant,[],'variant')},'variants')
  fields(context,['id','product_id','status','readiness_score','buyer_profile','target_markets','use_cases','selling_points','evidence','commercial_policy','missing_evidence','agent_summary','source_hash','review_version','updated_at'],'context')
  scalars(context,['target_markets','use_cases','selling_points','evidence','commercial_policy','missing_evidence'],'context')
  for(const key of ['target_markets','use_cases','selling_points','missing_evidence'])rows(context?.[key],item=>{if(typeof item!=='string')forbidden.push('context.'+key)},'context.'+key)
  rows(context?.evidence,item=>{fields(item,['id','label','type','status','sha256','reviewed_at'],'evidence');scalars(item,[],'evidence')},'evidence')
  fields(context?.commercial_policy,['moq','trial_quantity','currency','price_min','price_max','lead_time_days','sample_policy'],'commercial_policy')
  scalars(context?.commercial_policy,[],'commercial_policy')
 }
 const list=value?.items!==undefined,detail=value?.product!==undefined||value?.context!==undefined
 fields(value,list?['schema_version','review_policy','generated_at','count','items']:detail?['schema_version','review_policy','generated_at','context','product']:['message'],'response')
 scalars(value,list?['items']:detail?['context','product']:[],'response')
 if(list)rows(value.items,row=>{fields(row,['context','product'],'item');projection(row)},'items')
 else if(detail)projection(value)
 const walk=(node,parent)=>{if(!node||typeof node!=='object')return;for(const [key,item] of Object.entries(node)){
  if(key==='metadata'||key==='notes'||key==='reviewed_by'||(key==='source'&&parent==='evidence'))forbidden.push(key)
  walk(item,key==='evidence'||parent==='evidence'?'evidence':key)
 }}
 walk(value,'')
 const wire=JSON.stringify(value)
 check(name+'-private-fields-absent',forbidden.length===0&&!wire.includes('private-note-sentinel')&&!wire.includes('private-source-sentinel'),{forbidden_keys:[...new Set(forbidden)]})
}

export async function runReviewSuite({config,admin,agent,call,create,check,report,prefix,signal}){
 const Client=loadPg(config)
 const pg=await openPostgres(Client,config.postgres)
 const owned=new Set()
 const actor={workspaceId:'synthetic-live-acceptance',subject:'synthetic-operator'}
 const reader=createMedusaApprovedSource({connection:{reviewed:true,sourceId:randomUUID(),workspaceId:actor.workspaceId,baseURL:config.backendUrl,readToken:config.agentToken,allowLoopbackHTTP:true,timeoutMs:10000},authorizeOriginal:value=>value===actor})
 async function snapshot(id){
  const read=await admin(path(id))
  check('context-snapshot',read.status===200&&read.cache==='no-store'&&/^[a-f0-9]{64}$/.test(read.data.review_source_hash??''),{status:read.status})
  return read.data
 }
 async function save(id,patch,expected=200,read){
  const body={...guard(read??await snapshot(id)),...patch}
  const result=await admin(path(id),{method:'POST',body})
  check('context-save-'+expected,result.status===expected,{status:result.status})
  const contextId=result.data.product_context?.id
  if(contextId){report.fixtures.contexts??=[];if(!report.fixtures.contexts.includes(contextId))report.fixtures.contexts.push(contextId)}
  return result.data.product_context
 }
 async function product(label){
  const item=await create('/admin/products',{title:prefix+' '+label,handle:prefix+'-'+label,status:'draft',description:'Disposable synthetic data only.',options:[{title:'Test',values:['One']}],variants:[{title:'One',sku:prefix+'-'+label,manage_inventory:false,options:{Test:'One'},prices:[{currency_code:'usd',amount:1}]}]},'product')
  owned.add(item.id);report.fixtures.products??=[];report.fixtures.products.push(item.id)
  const initial=await snapshot(item.id)
  check(label+'-first-version-zero',initial.product_context===null&&guard(initial).review_version===0,{version:guard(initial).review_version})
  return item
 }
 async function dbRow(id){
  check('sql-owned-product',owned.has(id),{})
  const {rows}=await pg.observer.query('select id,product_id,status,review_version,source_hash,missing_evidence,reviewed_by,reviewed_at from product_context where product_id=$1 and deleted_at is null',[id])
  check('db-exact-context',rows.length===1,{rows:rows.length})
  return rows[0]
 }
 async function agentView(id,visible,row,label){
  const [list,detail]=await Promise.all([agent('/agent/product-contexts?product_id='+encodeURIComponent(id)),agent('/agent/product-contexts/'+encodeURIComponent(id))])
  check(label+'-list-policy-cache',list.status===200&&list.data.review_policy===POLICY&&list.cache==='no-store'&&list.data.count===list.data.items?.length,{status:list.status,cache:list.cache,policy:list.data.review_policy})
  assertPublicPayload(list.data,check,label+'-list');assertPublicPayload(detail.data,check,label+'-detail')
  check(label+'-visibility',visible?detail.status===200&&list.data.items?.length===1&&detail.data.product?.id===id:list.data.items?.length===0&&detail.status===404,{visible,list_count:list.data.items?.length,detail_status:detail.status})
  if(visible){
   check(label+'-detail-policy-cache',detail.data.review_policy===POLICY&&detail.cache==='no-store',{cache:detail.cache,policy:detail.data.review_policy})
   check(label+'-db-agent-agree',[list.data.items[0],detail.data].every(item=>item.context?.product_id===row.product_id&&item.context?.status===row.status&&item.context?.review_version===row.review_version&&item.context?.source_hash===row.source_hash&&JSON.stringify(item.context?.missing_evidence)===JSON.stringify(row.missing_evidence)),{})
  }
  const consumed=await reader.read(id,actor,signal)
  check(label+'-actual-approved-reader',visible?consumed?.reference.id===id&&consumed.reference.revision===row.review_version&&consumed.reference.sourceHash===row.source_hash:consumed===null,{visible})
  return detail.data
 }
 try{
  const p=await product('source')
  const initial=await snapshot(p.id)
  await save(p.id,{...content,status:'approved',readiness_score:79},422,initial)
  await save(p.id,{...content,status:'approved',missing_evidence:['Test report']},422,initial)
  await save(p.id,{...content,status:'approved'},200,initial)
  const first=await snapshot(p.id),row=await dbRow(p.id)
  check('first-save-version-one',first.product_context?.review_version===1&&row.review_version===1,{version:row.review_version})
  await agentView(p.id,true,row,'initial-approved')
  const consumedList=await reader.list({q:prefix},actor,signal)
  check('actual-approved-reader-list-marker',consumedList.items.some(item=>item.reference.id===p.id&&item.reference.sourceHash===row.source_hash),{})
  for(const [name,token] of [['missing',null],['invalid','synthetic-invalid-token'],['admin-jwt',config.adminToken]]){
   for(const suffix of ['?product_id='+p.id,'/'+p.id]){
    const denied=token===null?await call('/agent/product-contexts'+suffix):await agent('/agent/product-contexts'+suffix,token)
    check('agent-deny-'+name,denied.status===401,{status:denied.status})
   }
  }
  const writeDenied=await call(path(p.id),{method:'POST',headers:{Authorization:'Bearer '+config.agentToken},body:{...guard(first),status:'blocked'}})
  check('agent-cannot-admin-write',writeDenied.status===401,{status:writeDenied.status})
  for(const field of ['title','sku']){
   const before=await snapshot(p.id)
   let changed
   if(field==='title')changed=await admin('/admin/products/'+p.id,{method:'POST',body:{title:prefix+' changed-title'}})
   else{
    const read=await admin('/admin/products/'+p.id+'?fields=id,*variants')
    const variant=read.data.product?.variants?.[0]
    check('variant-api-reread',read.status===200&&Boolean(variant?.id),{status:read.status})
    changed=await admin('/admin/products/'+p.id+'/variants/'+variant.id,{method:'POST',body:{sku:prefix+'-changed-sku'}})
   }
   check('source-'+field+'-api-change',changed.status===200,{status:changed.status})
   const fresh=await snapshot(p.id)
   check('source-'+field+'-hash-invalidated',fresh.review_source_hash!==before.review_source_hash,{})
   await agentView(p.id,false,null,'changed-'+field)
   await save(p.id,{status:'approved',source_hash:before.review_source_hash},409,fresh)
   await save(p.id,{status:'approved'},200,fresh)
   const view=await agentView(p.id,true,await dbRow(p.id),'rereview-'+field)
   check('source-'+field+'-new-value',field==='title'?view.product.title===prefix+' changed-title':view.product.variants.some(v=>v.sku===prefix+'-changed-sku'),{})
  }
  await save(p.id,{status:'blocked'})
  await agentView(p.id,false,null,'immediate-revocation')

  for(const {version,kind,order} of raceCases()){
   const name=(version===MAX_VERSION?'ceiling':'normal')+'-'+kind+'-'+order
   const fixture=await product(name)
   await save(fixture.id,content)
   let current=await snapshot(fixture.id)
   if(version===MAX_VERSION){
    // Test preparation on this run's own fixture only, never a business write path.
    const seeded=await pg.observer.query('update product_context set review_version=$1 where id=$2 and product_id=$3 and deleted_at is null returning id',[MAX_VERSION,current.product_context.id,fixture.id])
    check(name+'-sql-fixture-ceiling-preparation',owned.has(fixture.id)&&seeded.rowCount===1,{rows:seeded.rowCount,test_preparation:true})
    current=await snapshot(fixture.id)
   }
   if(kind==='revoke'){await save(fixture.id,{status:'approved'},200,current);current=await snapshot(fixture.id)}
   const before=await dbRow(fixture.id)
   check(name+'-get-db-version',current.product_context.review_version===before.review_version&&(version!==MAX_VERSION||before.review_version===MAX_VERSION),{version:before.review_version})
   const approval={...guard(current),status:'approved'}
   const negative={...guard(current),...(kind==='revoke'?{status:'blocked'}:{missing_evidence:['Synthetic missing certificate']})}
   const approvalFirst=order==='approval-first'
   const winner=await raceWithRowLock({...pg,serverRole:config.postgres.serverRole,id:before.id,productId:fixture.id,firstBody:approvalFirst?approval:negative,secondBody:approvalFirst?negative:approval,post:body=>admin(path(fixture.id),{method:'POST',body}),check,name})
   const after=await dbRow(fixture.id),readback=await snapshot(fixture.id)
   const expectedStatus=approvalFirst?'approved':kind==='revoke'?'blocked':'ready_for_review'
   const expectedMissing=!approvalFirst&&kind==='missing_evidence'?['Synthetic missing certificate']:[]
   check(name+'-db-winner',after.status===expectedStatus&&after.review_version===Math.min(before.review_version+1,MAX_VERSION)&&JSON.stringify(after.missing_evidence)===JSON.stringify(expectedMissing)&&after.source_hash===winner?.source_hash&&readback.product_context?.source_hash===after.source_hash&&readback.product_context?.status===after.status&&readback.product_context?.review_version===after.review_version&&(approvalFirst?Boolean(after.reviewed_by&&after.reviewed_at):after.reviewed_by===null&&after.reviewed_at===null),{status:after.status,version:after.review_version})
   if(version===MAX_VERSION){
    check(name+'-revision-rotated',/^rev:[a-f0-9]{32}:(?:[a-f0-9]{64}|unreviewed)$/.test(after.source_hash??'')&&after.source_hash!==before.source_hash,{})
    // Same numeric version and same content still cannot replay the old GET hash.
    await save(fixture.id,{status:'approved',source_hash:current.review_source_hash},409,readback)
   }
   await agentView(fixture.id,approvalFirst,after,name)
  }
 }finally{await pg.close()}
}
