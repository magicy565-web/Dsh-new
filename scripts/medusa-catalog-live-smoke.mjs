const baseUrl=(process.env.MEDUSA_BACKEND_URL||"").replace(/\/$/,"")
const email=process.env.MEDUSA_ADMIN_EMAIL
const password=process.env.MEDUSA_ADMIN_PASSWORD
const agentToken=process.env.AGENT_CONTEXT_READ_TOKEN

if(!baseUrl||!email||!password||!agentToken){
  console.error("Required: MEDUSA_BACKEND_URL, MEDUSA_ADMIN_EMAIL, MEDUSA_ADMIN_PASSWORD, AGENT_CONTEXT_READ_TOKEN")
  process.exit(2)
}

const report={ok:true,checks:[],createdProductId:null}

async function call(path,options={}){
  const response=await fetch(baseUrl+path,{
    ...options,
    headers:{
      ...(options.body?{"content-type":"application/json"}:{}),
      ...(options.headers||{})
    }
  })
  const text=await response.text()
  let body=null
  try{body=text?JSON.parse(text):null}catch{body=text}
  return{response,body}
}
function check(name,ok,detail){
  report.checks.push({name,ok,detail})
  if(!ok)report.ok=false
}
async function adminCall(path,options={},token){
  return call(path,{...options,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(options.headers||{})}})
}

let adminToken
try{
  const login=await call("/auth/user/emailpass",{method:"POST",body:JSON.stringify({email,password})})
  adminToken=login.body?.token
  check("admin-login",login.response.ok&&typeof adminToken==="string","Medusa admin authentication")
  if(!adminToken)throw Error("admin login failed")
}catch(error){
  check("admin-login",false,error instanceof Error?error.message:String(error))
}

let productId
try{
  const handle="acceptance-"+Date.now()
  const created=await adminCall("/admin/products",{method:"POST",body:JSON.stringify({
    title:"Live Acceptance Product",
    handle,
    description:"Temporary product used by the Medusa catalog live acceptance smoke test.",
    status:"draft"
  })},adminToken)
  productId=created.body?.product?.id
  report.createdProductId=productId||null
  check("product-create",created.response.ok&&typeof productId==="string","create temporary Product")
}catch(error){check("product-create",false,error instanceof Error?error.message:String(error))}

if(productId){
  try{
    const updated=await adminCall("/admin/products/"+encodeURIComponent(productId),{
      method:"POST",
      body:JSON.stringify({subtitle:"Acceptance subtitle",material:"Rayon / Viscose",origin_country:"China"})
    },adminToken)
    check("product-update",updated.response.ok,"update native Product fields")
  }catch(error){check("product-update",false,error instanceof Error?error.message:String(error))}

  try{
    const collections=await adminCall("/admin/collections?limit=1&offset=0&fields=id,title,handle",{},adminToken)
    const categories=await adminCall("/admin/product-categories?limit=1&offset=0&fields=id,name,handle",{},adminToken)
    const channels=await adminCall("/admin/sales-channels?limit=1&offset=0&fields=id,name,is_disabled",{},adminToken)
    const c=collections.body?.collections?.[0]
    const cat=categories.body?.product_categories?.[0]
    const sc=channels.body?.sales_channels?.find(x=>!x.is_disabled)
    const payload={}
    if(c)payload.collection_id=c.id
    if(cat)payload.categories=[{id:cat.id}]
    if(sc)payload.sales_channels=[{id:sc.id}]
    if(Object.keys(payload).length){
      const r=await adminCall("/admin/products/"+encodeURIComponent(productId),{method:"POST",body:JSON.stringify(payload)},adminToken)
      check("product-organization",r.response.ok,"collection/category/sales-channel native relations")
    }else{
      check("product-organization",false,"unconfigured: preview has no collection/category/active sales channel")
    }
  }catch(error){check("product-organization",false,error instanceof Error?error.message:String(error))}

  try{
    const context=await adminCall("/admin/products/"+encodeURIComponent(productId)+"/context",{
      method:"POST",
      body:JSON.stringify({
        status:"approved",
        readiness_score:92,
        buyer_profile:"US apparel distributors",
        target_markets:["United States"],
        use_cases:["Resortwear"],
        selling_points:["Live acceptance"],
        evidence:[{id:"acceptance-spec",label:"Acceptance specification",type:"spec_sheet",status:"verified"}],
        commercial_policy:{moq:1000,trial_quantity:500,currency:"USD",price_min:1.8,price_max:2.3,lead_time_days:25},
        missing_evidence:[],
        agent_summary:"Approved only for this live acceptance test."
      })
    },adminToken)
    check("context-approve",context.response.ok&&context.body?.product_context?.status==="approved","approved Product Context gate")
  }catch(error){check("context-approve",false,error instanceof Error?error.message:String(error))}

  try{
    const unauthorized=await call("/agent/product-contexts?product_id="+encodeURIComponent(productId))
    check("agent-deny-without-token",unauthorized.response.status===401,"agent surface rejects missing credential")
  }catch(error){check("agent-deny-without-token",false,error instanceof Error?error.message:String(error))}

  try{
    const agent=await call("/agent/product-contexts?product_id="+encodeURIComponent(productId),{headers:{Authorization:"Bearer "+agentToken}})
    const found=agent.body?.items?.some(x=>x.context?.product_id===productId&&x.context?.status==="approved")
    check("agent-approved-read",agent.response.ok&&found,"agent receives approved context and narrow product projection")
  }catch(error){check("agent-approved-read",false,error instanceof Error?error.message:String(error))}

  try{
    const blocked=await adminCall("/admin/products/"+encodeURIComponent(productId)+"/context",{
      method:"POST",
      body:JSON.stringify({status:"blocked",readiness_score:92,missing_evidence:[]})
    },adminToken)
    check("context-block",blocked.response.ok&&blocked.body?.product_context?.status==="blocked","context status can leave approved")
    const agent=await call("/agent/product-contexts/"+encodeURIComponent(productId),{headers:{Authorization:"Bearer "+agentToken}})
    check("agent-fail-closed-status",agent.response.status===404,"agent no longer exposes non-approved context")
  }catch(error){check("agent-fail-closed-status",false,error instanceof Error?error.message:String(error))}

  try{
    const inventory=await adminCall("/admin/inventory-items?limit=5&offset=0&fields=id,sku,title,stocked_quantity,reserved_quantity,*location_levels",{},adminToken)
    const locations=await adminCall("/admin/stock-locations?limit=5&offset=0&fields=id,name",{},adminToken)
    const item=inventory.body?.inventory_items?.[0]
    const level=item?.location_levels?.[0]
    if(item&&level){
      const original=Number(level.stocked_quantity||0)
      const changed=await adminCall("/admin/inventory-items/"+encodeURIComponent(item.id)+"/location-levels/"+encodeURIComponent(level.location_id),{
        method:"POST",
        body:JSON.stringify({stocked_quantity:original+1})
      },adminToken)
      const restored=await adminCall("/admin/inventory-items/"+encodeURIComponent(item.id)+"/location-levels/"+encodeURIComponent(level.location_id),{
        method:"POST",
        body:JSON.stringify({stocked_quantity:original})
      },adminToken)
      check("inventory-roundtrip",changed.response.ok&&restored.response.ok,"native Inventory Level update + restore")
    }else{
      check("inventory-roundtrip",false,"unconfigured: environment has no Inventory Item with a Location Level")
    }
  }catch(error){check("inventory-roundtrip",false,error instanceof Error?error.message:String(error))}

  try{
    const deleted=await adminCall("/admin/products/"+encodeURIComponent(productId),{method:"DELETE"},adminToken)
    check("product-cleanup",deleted.response.ok,"delete temporary acceptance Product")
  }catch(error){check("product-cleanup",false,error instanceof Error?error.message:String(error))}
}

console.log(JSON.stringify(report,null,2))
process.exit(report.ok?0:1)
