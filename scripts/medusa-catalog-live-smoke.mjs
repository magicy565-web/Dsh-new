import {createHash} from 'node:crypto'
const baseUrl=(process.env.MEDUSA_BACKEND_URL||'').replace(/\/$/,'')
let destination
try { destination=new URL(baseUrl) } catch {}
if(!destination||destination.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(destination.hostname)||destination.username||destination.password||destination.pathname!=='/'||destination.search||destination.hash){console.error('ISOLATED_LOOPBACK_MEDUSA_REQUIRED');process.exit(2)}
const {MEDUSA_ADMIN_EMAIL:email,MEDUSA_ADMIN_PASSWORD:password,AGENT_CONTEXT_READ_TOKEN:agentToken}=process.env
const report={ok:false,status:'blocked',backend:baseUrl,started_at:new Date().toISOString(),checks:[],fixtures:{},cleanup:[]}
if(!baseUrl||!email||!password||!agentToken||process.env.MEDUSA_LIVE_ALLOW_WRITES!=='isolated'){
 console.log(JSON.stringify({...report,reason:'Required: MEDUSA_BACKEND_URL, MEDUSA_ADMIN_EMAIL, MEDUSA_ADMIN_PASSWORD, AGENT_CONTEXT_READ_TOKEN and MEDUSA_LIVE_ALLOW_WRITES=isolated. Use a disposable test database only.'},null,2));process.exit(2)
}
const prefix='acceptance-'+Date.now(),cleanup=[]
let adminToken
async function call(path,{body,headers={},...options}={}){
 const response=await fetch(baseUrl+path,{...options,redirect:'error',body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),headers:{...(body!==undefined&&!(body instanceof FormData)?{'content-type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(15000)})
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data={message:raw.slice(0,500)}}return{status:response.status,ok:response.ok,data,cache:response.headers.get('cache-control')}
}
const admin=(path,options={})=>call(path,{...options,headers:{Authorization:'Bearer '+adminToken,...options.headers}})
const agent=(path,token=agentToken)=>call(path,{headers:{Authorization:'Bearer '+token}})
function check(name,ok,detail){report.checks.push({name,ok:Boolean(ok),detail});if(!ok)throw Error(name+': '+JSON.stringify(detail))}
async function create(path,body,key){const r=await admin(path,{method:'POST',body});check(key+'-create',r.ok&&r.data[key]?.id,{status:r.status,message:r.data.message});const item=r.data[key];report.fixtures[key]=item.id;cleanup.push({path:path+'/'+encodeURIComponent(item.id),id:item.id});return item}
const contextPath=id=>'/admin/products/'+id+'/context'
try{
 const login=await call('/auth/user/emailpass',{method:'POST',body:{email,password}});adminToken=login.data.token
 check('admin-login',login.ok&&typeof adminToken==='string',{status:login.status})
 const unauthAdmin=await call('/admin/products?limit=1');check('admin-deny-anonymous',unauthAdmin.status===401,{status:unauthAdmin.status})
 const collection=await create('/admin/collections',{title:prefix,handle:prefix},'collection')
 const category=await create('/admin/product-categories',{name:prefix,handle:prefix,is_active:true},'product_category')
 const channel=await create('/admin/sales-channels',{name:prefix},'sales_channel')
 const location=await create('/admin/stock-locations',{name:prefix},'stock_location')
 const inventory=await create('/admin/inventory-items',{sku:prefix,title:prefix},'inventory_item')
 let r=await admin('/admin/inventory-items/'+inventory.id+'/location-levels',{method:'POST',body:{location_id:location.id,stocked_quantity:10}})
 check('inventory-level-create',r.ok,{status:r.status,message:r.data.message})
 const product=await create('/admin/products',{title:'Isolated Acceptance Fabric',handle:prefix,status:'draft',description:'Isolated test data, not a commercial product.',options:[{title:'Color',values:['Ivory','Blue']}],variants:[{title:'Ivory',sku:prefix+'-ivory',manage_inventory:false,options:{Color:'Ivory'},prices:[{currency_code:'usd',amount:2.15}]}]},'product')
 r=await admin('/admin/products/'+product.id,{method:'POST',body:{subtitle:'API acceptance',material:'Rayon / Viscose',origin_country:'cn',collection_id:collection.id,categories:[{id:category.id}],sales_channels:[{id:channel.id}]}})
 check('product-update',r.ok,{status:r.status,message:r.data.message})
 let read=await admin('/admin/products/'+product.id+'?fields=id,title,subtitle,material,origin_country,collection_id,*categories,*sales_channels,*variants.prices,*variants.options.option,*images')
 const p=read.data.product;check('product-persisted-reread',read.ok&&p.subtitle==='API acceptance'&&p.material==='Rayon / Viscose',{status:read.status,id:product.id})
 check('product-organization-reread',p.collection_id===collection.id&&p.categories?.some(x=>x.id===category.id)&&p.sales_channels?.some(x=>x.id===channel.id),{collection:p.collection_id,categories:p.categories?.map(x=>x.id),sales_channels:p.sales_channels?.map(x=>x.id)})
 const variant=p.variants?.[0];check('variant-create-reread',variant?.prices?.some(x=>x.currency_code==='usd'&&Number(x.amount)===2.15),{variant_id:variant?.id})
 r=await admin('/admin/products/'+product.id+'/variants/'+variant.id,{method:'POST',body:{title:'Ivory updated',prices:[{currency_code:'usd',amount:2.3}]}})
 check('variant-update',r.ok,{status:r.status,message:r.data.message})
 read=await admin('/admin/products/'+product.id+'?fields=id,*variants.prices');check('variant-update-reread',read.data.product?.variants?.some(x=>x.id===variant.id&&x.title==='Ivory updated'&&x.prices?.some(y=>Number(y.amount)===2.3)),{status:read.status})
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0P8AAAAASUVORK5CYII=','base64')
 const form=new FormData();form.append('files',new Blob([png],{type:'image/png'}),prefix+'.png');r=await admin('/admin/uploads',{method:'POST',body:form})
 const uploaded=r.data.files?.[0];check('image-upload',r.ok&&uploaded?.id&&uploaded?.url,{status:r.status,message:r.data.message});report.fixtures.file=uploaded.id;cleanup.push({path:'/admin/uploads/'+uploaded.id,id:uploaded.id})
 r=await admin('/admin/products/'+product.id,{method:'POST',body:{images:[{url:uploaded.url}],thumbnail:uploaded.url}});check('image-assignment',r.ok,{status:r.status})
 read=await admin('/admin/products/'+product.id+'?fields=id,thumbnail,*images');check('image-persisted-reread',read.data.product?.images?.some(x=>x.url===uploaded.url)&&read.data.product.thumbnail===uploaded.url,{status:read.status})
 check('image-origin',new URL(uploaded.url).origin===destination.origin,{same_origin:new URL(uploaded.url).origin===destination.origin})
 const image=await fetch(uploaded.url,{redirect:'error',signal:AbortSignal.timeout(10000)});const bytes=Buffer.from(await image.arrayBuffer());check('image-bytes-roundtrip',image.ok&&createHash('sha256').update(bytes).digest('hex')===createHash('sha256').update(png).digest('hex'),{status:image.status,bytes:bytes.length})
 r=await admin(contextPath(product.id),{method:'POST',body:{status:'approved',readiness_score:79,missing_evidence:[]}});check('approval-reject-low-score',r.status===422,{status:r.status})
 r=await admin(contextPath(product.id),{method:'POST',body:{status:'approved',readiness_score:92,missing_evidence:['Test report']}});check('approval-reject-missing-evidence',r.status===422,{status:r.status})
 r=await admin(contextPath(product.id),{method:'POST',body:{status:'approved',readiness_score:92,buyer_profile:'Isolated test buyer',target_markets:['United States'],use_cases:['Test'],selling_points:['Test'],evidence:[{id:'spec',label:'Test specification',type:'spec_sheet',status:'verified',source:'private-source-sentinel'}],commercial_policy:{currency:'USD',moq:1000},missing_evidence:[],agent_summary:'Isolated acceptance only',notes:'private-note-sentinel'}})
 check('context-approve',r.ok&&r.data.product_context?.status==='approved',{status:r.status,message:r.data.message})
 read=await admin(contextPath(product.id));check('context-persisted-reread',read.ok&&read.data.product_context?.status==='approved',{status:read.status})
 for(const [name,token] of [['missing',null],['invalid','invalid-token'],['admin-jwt',adminToken]]){const denied=token===null?await call('/agent/product-contexts/'+product.id):await agent('/agent/product-contexts/'+product.id,token);check('agent-deny-'+name,denied.status===401,{status:denied.status})}
 const list=await agent('/agent/product-contexts?product_id='+product.id);check('agent-approved-list',list.ok&&list.data.items?.some(x=>x.context?.product_id===product.id&&x.product?.id===product.id),{status:list.status,message:list.data.message})
 const detail=await agent('/agent/product-contexts/'+product.id);check('agent-approved-detail',detail.ok&&detail.data.product?.id===product.id&&detail.data.context?.status==='approved',{status:detail.status,message:detail.data.message})
 const exposed=JSON.stringify([list.data,detail.data]);check('agent-narrow-projection',!['reviewed_by','private-note-sentinel','private-source-sentinel','metadata'].some(x=>exposed.includes(x))&&detail.cache==='no-store',{cache_control:detail.cache})
 const writeDenied=await call(contextPath(product.id),{method:'POST',body:{status:'approved'},headers:{Authorization:'Bearer '+agentToken}});check('agent-cannot-admin-write',writeDenied.status===401,{status:writeDenied.status})
 r=await admin(contextPath(product.id),{method:'POST',body:{status:'blocked'}});check('context-revoke',r.ok&&r.data.product_context?.status==='blocked',{status:r.status})
 const revokedDetail=await agent('/agent/product-contexts/'+product.id),revokedList=await agent('/agent/product-contexts?product_id='+product.id)
 check('agent-revocation-detail',revokedDetail.status===404,{status:revokedDetail.status});check('agent-revocation-list',revokedList.ok&&revokedList.data.items?.length===0,{status:revokedList.status})
 for(const quantity of [11,10]){
  r=await admin('/admin/inventory-items/'+inventory.id+'/location-levels/'+location.id,{method:'POST',body:{stocked_quantity:quantity}});check('inventory-write-'+quantity,r.ok,{status:r.status})
  read=await admin('/admin/inventory-items/'+inventory.id+'?fields=id,*location_levels');const level=read.data.inventory_item?.location_levels?.find(x=>x.location_id===location.id)
  check('inventory-reread-'+quantity,read.ok&&Number(level?.stocked_quantity)===quantity,{status:read.status,stocked_quantity:level?.stocked_quantity})
 }
 report.status='passed'
}catch(error){report.status=report.checks.length?'failed':'blocked';report.error=error.message}
finally{
 for(const item of cleanup.reverse()){try{const r=await admin(item.path,{method:'DELETE'});report.cleanup.push({id:item.id,status:r.status,ok:r.ok})}catch(e){report.cleanup.push({id:item.id,ok:false,error:e.message})}}
 report.ok=report.status==='passed'&&report.checks.every(x=>x.ok)&&report.cleanup.every(x=>x.ok)
 if(!report.ok&&report.status==='passed')report.status='cleanup_failed'
 report.completed_at=new Date().toISOString();let output=JSON.stringify(report,null,2);for(const value of [password,agentToken,adminToken].filter(x=>typeof x==='string'&&x.length))output=output.replaceAll(value,'[redacted]');console.log(output)
}
process.exit(report.ok?0:1)
