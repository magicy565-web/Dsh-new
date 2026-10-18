export type ProductStatus = "draft" | "proposed" | "published" | "rejected"

export type ProductImage = { id?:string; url:string; rank?:number }
export type ProductOptionValue = { id:string; value:string; rank?:number }
export type ProductOption = {
  id?:string
  title:string
  values:string[]
  value_ids?:ProductOptionValue[]
  product_id?:string|null
  is_exclusive?:boolean
}
export type ProductPrice = { id?:string; currency_code:string; amount:number }
export type SalesChannel = { id:string; name:string; description?:string|null; is_disabled?:boolean }
export type InventoryLevel = { id:string; inventory_item_id:string; location_id:string; stocked_quantity:number; reserved_quantity:number; available_quantity:number; incoming_quantity:number }
export type InventoryItem = { id:string; sku?:string|null; title?:string|null; stocked_quantity:number; reserved_quantity:number; available_quantity:number; location_levels:InventoryLevel[] }
export type StockLocation = { id:string; name:string; sales_channels?:SalesChannel[] }
export type ProductVariant = {
  id:string
  title:string
  sku?:string|null
  prices?:ProductPrice[]|null
  options?:Record<string,string>|null
  manage_inventory?:boolean
  allow_backorder?:boolean
}
export type Product = {
  id:string
  title:string
  subtitle?:string|null
  handle:string
  description?:string|null
  status:ProductStatus
  thumbnail?:string|null
  images?:ProductImage[]
  options?:ProductOption[]
  variants?:ProductVariant[]
  material?:string|null
  origin_country?:string|null
  collection_id?:string|null
  sales_channels?:SalesChannel[]
  categories?:{id:string;name:string}[]
  tags?:{id:string;value:string}[]
  metadata?:Record<string,unknown>
  updated_at?:string
}

export type EvidenceItem = {
  id:string
  label:string
  type:"certificate"|"test_report"|"case_study"|"spec_sheet"|"other"
  status:"verified"|"pending"|"missing"
  source?:string
  sha256?:string
  reviewed_at?:string
}
export type CommercialPolicy = {
  moq?:number
  trial_quantity?:number
  currency?:string
  price_min?:number
  price_max?:number
  lead_time_days?:number
  sample_policy?:string
}
export type ProductContext = {
  id:string
  product_id:string
  status:"incomplete"|"ready_for_review"|"approved"|"blocked"
  readiness_score:number
  buyer_profile?:string|null
  target_markets?:string[]
  use_cases?:string[]
  selling_points?:string[]
  evidence?:EvidenceItem[]
  commercial_policy?:CommercialPolicy|null
  missing_evidence?:string[]
  agent_summary?:string|null
  source_hash?:string|null
  review_version?:number
  reviewed_at?:string|null
  reviewed_by?:string|null
  notes?:string|null
}
export type AgentProfile = {
  readiness:number
  buyer:string
  markets:string[]
  useCases:string[]
  sellingPoints:string[]
  missing:string[]
  lastReviewed:string
  status:ProductContext["status"]
}

const products:Product[]=[
  {id:"demo-01",title:"Printed Rayon Voile 120 GSM",subtitle:"145 cm · soft handfeel · reactive print",handle:"printed-rayon-voile-120gsm",description:"Lightweight printed rayon/viscose fabric for resort shirts, dresses and relaxed womenswear.",status:"draft",thumbnail:"swatch-a",images:[{url:"swatch-a"},{url:"swatch-b"},{url:"swatch-c"}],options:[{id:"opt-01",title:"Colorway",values:["Ivory","Blue","Olive"],product_id:"demo-01",is_exclusive:true}],variants:[{id:"v1",title:"Ivory",sku:"RV120-IVORY",options:{Colorway:"Ivory"},prices:[{currency_code:"usd",amount:2.15}]},{id:"v2",title:"Blue",sku:"RV120-BLUE",options:{Colorway:"Blue"},prices:[{currency_code:"usd",amount:2.2}]},{id:"v3",title:"Olive",sku:"RV120-OLIVE",options:{Colorway:"Olive"},prices:[{currency_code:"usd",amount:2.25}]}],material:"Rayon / Viscose",origin_country:"China",collection_id:"demo-col-1",sales_channels:[{id:"demo-web",name:"US Storefront"},{id:"demo-b2b",name:"Distributor Portal"}],categories:[{id:"fabric",name:"Fabrics"}]},
  {id:"demo-02",title:"Cotton Modal Rib 220 GSM",subtitle:"4-way stretch · compact surface",handle:"cotton-modal-rib-220gsm",description:"Compact rib knit for basics, fitted tops and athleisure programs.",status:"published",thumbnail:"swatch-d",images:[{url:"swatch-d"},{url:"swatch-e"}],options:[{id:"opt-02",title:"Color",values:["Black","Stone"],product_id:"demo-02",is_exclusive:true}],variants:[{id:"v4",title:"Black",sku:"CMR220-BLK",options:{Color:"Black"},prices:[{currency_code:"usd",amount:3.4}]},{id:"v5",title:"Stone",sku:"CMR220-STN",options:{Color:"Stone"},prices:[{currency_code:"usd",amount:3.5}]}],material:"Cotton / Modal",origin_country:"China",collection_id:"demo-col-2",sales_channels:[{id:"demo-web",name:"US Storefront"}],categories:[{id:"knit",name:"Knits"}]},
  {id:"demo-03",title:"Washed Linen Blend 165 GSM",subtitle:"Natural texture · breathable",handle:"washed-linen-blend-165gsm",description:"Washed linen blend for resort shirts, sets and lightweight jackets.",status:"proposed",thumbnail:"swatch-f",images:[{url:"swatch-f"},{url:"swatch-g"}],options:[{id:"opt-03",title:"Color",values:["Sand","Charcoal"],product_id:"demo-03",is_exclusive:true}],variants:[{id:"v6",title:"Sand",sku:"WLB165-SAND",options:{Color:"Sand"},prices:[{currency_code:"usd",amount:2.95}]}],material:"Linen / Viscose",origin_country:"China",collection_id:"demo-col-1",sales_channels:[{id:"demo-b2b",name:"Distributor Portal"}],categories:[{id:"fabric",name:"Fabrics"}]}
]

const contexts:Record<string,ProductContext>={
  "demo-01":{id:"ctx-01",product_id:"demo-01",status:"ready_for_review",readiness_score:92,buyer_profile:"US apparel brands & distributors",target_markets:["United States","Canada"],use_cases:["Resortwear","Womenswear"],selling_points:["120 GSM / 145 cm","Trial order supported"],missing_evidence:["Approved compliance PDF"],evidence:[{id:"ev-01",label:"Specification sheet",type:"spec_sheet",status:"verified"}],commercial_policy:{moq:1000,trial_quantity:500,currency:"USD",price_min:1.8,price_max:2.3,lead_time_days:25,sample_policy:"500m trial available"},agent_summary:"Suitable for first-pass US resortwear outreach. Confirm compliance evidence before external quoting.",reviewed_at:"2026-10-15",reviewed_by:"catalog-review"},
  "demo-02":{id:"ctx-02",product_id:"demo-02",status:"approved",readiness_score:86,buyer_profile:"US fashion distributors",target_markets:["United States"],use_cases:["Basics","Athleisure"],selling_points:["220 GSM","4-way stretch"],missing_evidence:[],evidence:[{id:"ev-02",label:"Specification sheet",type:"spec_sheet",status:"verified"},{id:"ev-03",label:"Test report",type:"test_report",status:"verified"}],commercial_policy:{moq:800,trial_quantity:300,currency:"USD",price_min:3.2,price_max:3.8,lead_time_days:28,sample_policy:"Lab dip available"},agent_summary:"Ready for distributor discovery and controlled product outreach.",reviewed_at:"2026-10-10",reviewed_by:"catalog-review"},
  "demo-03":{id:"ctx-03",product_id:"demo-03",status:"incomplete",readiness_score:61,buyer_profile:"Resortwear importers",target_markets:["United States","Australia"],use_cases:["Shirts","Resort sets"],selling_points:["Natural texture","Breathable"],missing_evidence:["Test report","MOQ","Lead time"],evidence:[{id:"ev-04",label:"Specification sheet",type:"spec_sheet",status:"verified"}],commercial_policy:{currency:"USD"},agent_summary:"Do not quote externally until commercial policy and testing evidence are completed.",reviewed_at:"2026-10-14",reviewed_by:"catalog-review"}
}

export function demoProducts():Product[]{const raw=localStorage.getItem("medusa-catalog-demo-products-v2");if(!raw)return products;try{return JSON.parse(raw) as Product[]}catch{return products}}
export function saveDemoProducts(value:Product[]){localStorage.setItem("medusa-catalog-demo-products-v2",JSON.stringify(value))}
export function demoContexts():Record<string,ProductContext>{const raw=localStorage.getItem("medusa-catalog-demo-contexts");if(!raw)return contexts;try{return JSON.parse(raw) as Record<string,ProductContext>}catch{return contexts}}
export function saveDemoContexts(value:Record<string,ProductContext>){localStorage.setItem("medusa-catalog-demo-contexts",JSON.stringify(value))}

export function normalizeProduct(raw:any):Product{
  const options:Array<ProductOption>=(raw.options||[]).map((o:any)=>({id:o.id,title:o.title||"",values:(o.values||[]).map((v:any)=>typeof v==="string"?v:v?.value).filter(Boolean),value_ids:(o.values||[]).filter((v:any)=>v&&typeof v==="object"&&v.id).map((v:any)=>({id:v.id,value:v.value,rank:v.rank})),product_id:o.product_id??null,is_exclusive:o.is_exclusive}))
  const variants:Array<ProductVariant>=(raw.variants||[]).map((v:any)=>{const mapped:Record<string,string>={};if(Array.isArray(v.options)){for(const ov of v.options){const title=ov?.option?.title||ov?.option_title||ov?.title;if(title&&ov?.value!=null)mapped[title]=ov.value}}else if(v.options&&typeof v.options==="object")Object.assign(mapped,v.options);return{id:v.id,title:v.title||"",sku:v.sku??null,options:mapped,manage_inventory:v.manage_inventory,allow_backorder:v.allow_backorder,prices:(v.prices||[]).map((p:any)=>({id:p.id,currency_code:p.currency_code,amount:Number(p.amount)}))}})
  return {id:raw.id,title:raw.title||"",subtitle:raw.subtitle??null,handle:raw.handle||"",description:raw.description??null,status:raw.status||"draft",thumbnail:raw.thumbnail??null,images:(raw.images||[]).map((i:any)=>({id:i.id,url:i.url,rank:i.rank})),options,variants,material:raw.material??null,origin_country:raw.origin_country??null,...(Object.hasOwn(raw,"collection_id")?{collection_id:raw.collection_id}:{}),...(Array.isArray(raw.sales_channels)?{sales_channels:raw.sales_channels.map((c:any)=>({id:c.id,name:c.name,is_disabled:c.is_disabled}))}:{}),categories:(raw.categories||[]).map((c:any)=>({id:c.id,name:c.name})),tags:(raw.tags||[]).map((t:any)=>({id:t.id,value:t.value})),metadata:raw.metadata||{},updated_at:raw.updated_at}
}

export class MedusaClient{
  private token:string|null=null
  private baseUrl:string
  constructor(baseUrl:string=""){this.baseUrl=baseUrl}
  get authenticated(){return !!this.token}
  async login(email:string,password:string){const r=await fetch(this.baseUrl+"/auth/user/emailpass",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});const b=await read(r);if(!r.ok||typeof b.token!=="string")throw Error(b.message||"登录失败");this.token=b.token}
  async request<T>(path:string,init:RequestInit={}):Promise<T>{const r=await fetch(this.baseUrl+path,{...init,credentials:"include",headers:{...(this.token?{Authorization:"Bearer "+this.token}:{}),...(init.body instanceof FormData?{}:init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}});const b=await read(r);if(!r.ok)throw Error(b.message||b.type||"Medusa API 请求失败");return b as T}
  async listProducts(q?:string,status?:string,limit=50,offset=0){const p=new URLSearchParams({limit:String(limit),offset:String(offset),order:"-updated_at",fields:"id,title,subtitle,handle,status,thumbnail,collection_id,*images,*options.values,*variants.prices,*variants.options.option,*categories,*tags,*sales_channels,+metadata"});if(q)p.set("q",q);if(status)p.set("status",status);const r=await this.request<{products:any[];count:number}>("/admin/products?"+p);return{products:r.products.map(normalizeProduct),count:r.count}}
  async retrieveProduct(id:string){const r=await this.request<{product:any}>("/admin/products/"+encodeURIComponent(id)+"?fields=id,title,subtitle,handle,description,status,thumbnail,collection_id,*images,*options.values,*variants.prices,*variants.options.option,*categories,*tags,*sales_channels,+metadata");return{product:normalizeProduct(r.product)}}
  createProduct(input:Record<string,unknown>){return this.request<{product:any}>("/admin/products",{method:"POST",body:JSON.stringify(input)}).then(r=>({product:normalizeProduct(r.product)}))}
  updateProduct(id:string,input:Record<string,unknown>){return this.request<{product:any}>("/admin/products/"+encodeURIComponent(id),{method:"POST",body:JSON.stringify(input)}).then(r=>({product:normalizeProduct(r.product)}))}
  async uploadFiles(files:File[]){const body=new FormData();for(const file of files)body.append("files",file);return this.request<{files:{id:string;url:string}[]}>("/admin/uploads",{method:"POST",body})}
  linkOptions(id:string,input:{add?:Array<string|{title:string;values:string[];is_exclusive?:boolean}>;remove?:string[]}){return this.request<{product:any}>("/admin/products/"+encodeURIComponent(id)+"/options/batch",{method:"POST",body:JSON.stringify(input)}).then(r=>({product:normalizeProduct(r.product)}))}
  updateProductOption(id:string,input:{title?:string;values?:string[]}){return this.request<{product_option:any}>("/admin/product-options/"+encodeURIComponent(id),{method:"POST",body:JSON.stringify(input)})}
  batchVariants(id:string,input:{create?:any[];update?:any[];delete?:string[]}){return this.request<{created:any[];updated:any[];deleted:any[]}>("/admin/products/"+encodeURIComponent(id)+"/variants/batch",{method:"POST",body:JSON.stringify(input)}).then(r=>({created:r.created.map(normalizeVariant),updated:r.updated.map(normalizeVariant),deleted:r.deleted}))}
  async saveProductStructure(id:string,original:Product,draft:Product){
    const patch=productEditPayload(original,draft)
    if(Object.keys(patch).length)await this.updateProduct(id,patch)
    const originalOptions=original.options||[], nextOptions=draft.options||[]
    const originalById=new Map(originalOptions.filter(o=>o.id).map(o=>[o.id!,o]))
    const nextById=new Map(nextOptions.filter(o=>o.id).map(o=>[o.id!,o]))
    const additions=nextOptions.filter(o=>!o.id).map(o=>({title:o.title.trim(),values:o.values.map(v=>v.trim()).filter(Boolean),is_exclusive:true})).filter(o=>o.title&&o.values.length)
    if(additions.length)await this.linkOptions(id,{add:additions})
    for(const next of nextOptions.filter(o=>o.id&&originalById.has(o.id))){const prev=originalById.get(next.id!)!;if((next.product_id===id||next.is_exclusive===true)&&(prev.title!==next.title||JSON.stringify(prev.values)!==JSON.stringify(next.values)))await this.updateProductOption(next.id!,{title:next.title,values:next.values})}
    const create=(draft.variants||[]).filter(v=>v.id.startsWith("new-")).map(v=>variantPayload(v))
    const update=(draft.variants||[]).filter(v=>!v.id.startsWith("new-")&&v.id&&JSON.stringify(v)!==JSON.stringify((original.variants||[]).find(o=>o.id===v.id))).map(v=>variantEditPayload((original.variants||[]).find(o=>o.id===v.id)!,v))
    const deleted=(original.variants||[]).filter(v=>!(draft.variants||[]).some(n=>n.id===v.id)).map(v=>v.id)
    if(create.length||update.length||deleted.length)await this.batchVariants(id,{create,update,delete:deleted})
    const removed=originalOptions.filter(o=>o.id&&!nextById.has(o.id)).map(o=>o.id!)
    if(removed.length)await this.linkOptions(id,{remove:removed})
    return this.retrieveProduct(id)
  }
  getContext(id:string){return this.request<{product_context:ProductContext|null;review_source_hash:string}>("/admin/products/"+encodeURIComponent(id)+"/context")}
  saveContext(id:string,input:Record<string,unknown>){return this.request<{product_context:ProductContext}>("/admin/products/"+encodeURIComponent(id)+"/context",{method:"POST",body:JSON.stringify(input)})}
  listCollections(){return this.request<{collections:{id:string;title:string;handle:string;products?:{id:string}[]}[]}>("/admin/collections?limit=50&offset=0&order=-updated_at&fields=id,title,handle,products.id")}
  listCategories(){return this.request<{product_categories:{id:string;name:string;handle:string;parent_category_id?:string|null;is_active?:boolean}[]}>("/admin/product-categories?limit=50&offset=0&order=rank")}
  listContexts(){return this.request<{product_contexts:ProductContext[]}>("/admin/product-contexts?limit=1000")}
  listSalesChannels(){return this.request<{sales_channels:SalesChannel[]}>("/admin/sales-channels?limit=100&offset=0&order=-updated_at")}
  async listInventoryItems(q?:string){
    const p=new URLSearchParams({limit:"100",offset:"0",order:"-updated_at",fields:"id,sku,title,stocked_quantity,reserved_quantity,*location_levels"})
    if(q)p.set("q",q)
    const r=await this.request<{inventory_items:any[];count:number}>("/admin/inventory-items?"+p)
    return {
      ...r,
      inventory_items:r.inventory_items.map((x:any)=>{
        const stocked=Number(x.stocked_quantity||0),reserved=Number(x.reserved_quantity||0)
        return {
          ...x,
          stocked_quantity:stocked,
          reserved_quantity:reserved,
          available_quantity:Number.isFinite(Number(x.available_quantity))?Number(x.available_quantity):stocked-reserved,
          location_levels:(x.location_levels||[]).map((l:any)=>{
            const ls=Number(l.stocked_quantity||0),lr=Number(l.reserved_quantity||0)
            return {
              ...l,
              stocked_quantity:ls,
              reserved_quantity:lr,
              available_quantity:Number.isFinite(Number(l.available_quantity))?Number(l.available_quantity):ls-lr,
              incoming_quantity:Number(l.incoming_quantity||0)
            }
          })
        }
      })
    }
  }
  listStockLocations(){return this.request<{stock_locations:StockLocation[]}>("/admin/stock-locations?limit=100&offset=0&order=name&fields=id,name,*sales_channels")}
  createInventoryLevel(id:string,locationId:string,stockedQuantity:number){return this.request<{inventory_item:InventoryItem}>("/admin/inventory-items/"+encodeURIComponent(id)+"/location-levels",{method:"POST",body:JSON.stringify({location_id:locationId,stocked_quantity:stockedQuantity})})}
  updateInventoryLevel(id:string,locationId:string,stockedQuantity:number){return this.request<{inventory_item:InventoryItem}>("/admin/inventory-items/"+encodeURIComponent(id)+"/location-levels/"+encodeURIComponent(locationId),{method:"POST",body:JSON.stringify({stocked_quantity:stockedQuantity})})}
  batchProducts(input:{create?:any[];update?:any[];delete?:string[]}){return this.request<{created:any[];updated:any[];deleted:any[]}>("/admin/products/batch",{method:"POST",body:JSON.stringify(input)}).then(r=>({created:r.created.map(normalizeProduct),updated:r.updated.map(normalizeProduct),deleted:r.deleted}))}
  updateCollectionProducts(id:string,input:{add?:string[];remove?:string[]}){return this.request<{collection:any}>("/admin/collections/"+encodeURIComponent(id)+"/products",{method:"POST",body:JSON.stringify(input)})}
  updateCategoryProducts(id:string,input:{add?:string[];remove?:string[]}){return this.request<{product_category:any}>("/admin/product-categories/"+encodeURIComponent(id)+"/products",{method:"POST",body:JSON.stringify(input)})}
  async listAllProducts(q?:string,status?:string){const all:Product[]=[];let offset=0;let count=0;do{const r=await this.listProducts(q,status,100,offset);all.push(...r.products);count=r.count;offset+=r.products.length;if(!r.products.length)break}while(all.length<count);return all}
}

function normalizeVariant(raw:any):ProductVariant{return{id:raw.id,title:raw.title||"",sku:raw.sku??null,options:Array.isArray(raw.options)?Object.fromEntries(raw.options.map((x:any)=>[x?.option?.title||x?.option_title||x?.title||"Option",x?.value??""])):raw.options||{},manage_inventory:raw.manage_inventory,allow_backorder:raw.allow_backorder,prices:(raw.prices||[]).map((p:any)=>({id:p.id,currency_code:p.currency_code,amount:Number(p.amount)}))}}
function variantPayload(v:ProductVariant,update=false){const priceList=(v.prices||[]).map(p=>({...(p.id?{id:p.id}:{}),currency_code:p.currency_code,amount:Number(p.amount)}));const base:any={title:v.title.trim(),sku:v.sku||undefined,options:v.options||{},...(v.prices!==undefined?{prices:priceList}:{}),...(v.manage_inventory!==undefined?{manage_inventory:v.manage_inventory}:{}),...(v.allow_backorder!==undefined?{allow_backorder:v.allow_backorder}:{})};return update?{id:v.id,...base}:base}
async function read(r:Response){const t=await r.text();if(!t)return{};try{return JSON.parse(t)}catch{return{message:t}}}

// Only explicitly changed fields are submitted. Missing projection fields are
// not instructions to clear authoritative Medusa relations or scalar values.
export function productEditPayload(original:Product,draft:Product):Record<string,unknown>{
 const patch:Record<string,unknown>={}
 for(const key of ["title","subtitle","handle","description","material","origin_country","status","collection_id"] as const){
  if(Object.hasOwn(draft,key)&&draft[key]!==undefined&&JSON.stringify(draft[key])!==JSON.stringify(original[key]))patch[key]=draft[key]
 }
 for(const key of ["categories","sales_channels"] as const){
  if(draft[key]!==undefined&&JSON.stringify(draft[key])!==JSON.stringify(original[key]))patch[key]=draft[key]!.map(x=>({id:x.id}))
 }
 if(draft.images!==undefined&&JSON.stringify(draft.images)!==JSON.stringify(original.images)){
  const images=draft.images.filter(i=>i.url&&!i.url.startsWith("data:")).map(i=>({id:i.id,url:i.url}))
  patch.images=images;patch.thumbnail=images[0]?.url??null
 }
 return patch
}

export function variantEditPayload(original:ProductVariant,draft:ProductVariant):Record<string,unknown>{
 const patch:Record<string,unknown>={id:draft.id}
 for(const key of ["title","sku","options","prices","manage_inventory","allow_backorder"] as const){
  if(Object.hasOwn(draft,key)&&draft[key]!==undefined&&JSON.stringify(draft[key])!==JSON.stringify(original[key]))patch[key]=draft[key]
 }
 return patch
}

// The approval fingerprint belongs to the GET snapshot shown to the reviewer.
// Never fetch a new fingerprint silently while saving an old draft.
export function productContextPayload(c:ProductContext,reviewSourceHash?:string|null){
  const version=c.review_version??0
  if(!Number.isInteger(version)||version<0||version>2147483647)throw Error("请重新读取 Product Context 版本")
  if((c.status==="approved"||version===2147483647)&&!reviewSourceHash)throw Error("请重新打开资料并核对当前产品后审核")
  return {status:c.status,readiness_score:c.readiness_score,buyer_profile:c.buyer_profile??null,
    target_markets:c.target_markets??[],use_cases:c.use_cases??[],selling_points:c.selling_points??[],
    evidence:c.evidence??[],commercial_policy:c.commercial_policy??null,missing_evidence:c.missing_evidence??[],
    agent_summary:c.agent_summary??null,review_version:version,...(reviewSourceHash?{source_hash:reviewSourceHash}:{}),notes:c.notes??null}
}
export function importedContextPayload(c:ProductContext,snapshot:{product_context:ProductContext|null;review_source_hash:string}){
  return productContextPayload({...c,status:c.status==="approved"?"ready_for_review":c.status,review_version:snapshot.product_context?.review_version??0},snapshot.review_source_hash)
}
