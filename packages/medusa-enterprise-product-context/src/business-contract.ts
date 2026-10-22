import {createHash} from "node:crypto"
import {z} from "@medusajs/framework/zod"

export const BUSINESS_VERSION="workspace-medusa-business/1.0"
export const Capabilities=z.enum(["product.read","price.read","inventory.read","context.summary.write"])
const Grants=z.array(z.object({actor_id:z.string().min(1),product_ids:z.array(z.string().regex(/^prod_[A-Za-z0-9]+$/)).min(1).max(100),capabilities:z.array(Capabilities).min(1)}).strict()).max(100)
export function granted(actor:any,productId:string,capabilities:string[],raw=process.env.WORKSPACE_MEDUSA_BUSINESS_GRANTS_JSON):boolean{
  if(actor?.actor_type!=="user"||!actor.actor_id||!raw)return false
  try{
    const grants=Grants.parse(JSON.parse(raw))
    return capabilities.every(capability=>grants.some(g=>g.actor_id===actor.actor_id&&g.product_ids.includes(productId)&&g.capabilities.includes(capability as any)))
  }catch{return false}
}
function canonical(value:any):any{
  if(value instanceof Date)return value.toJSON()
  if(Array.isArray(value))return value.map(canonical)
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))
  return value
}
export function digest(value:any):string{return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}
export const ReadQuery=z.object({include:z.enum(["prices","inventory","prices,inventory"]).optional()}).strict()
export const SummaryInput=z.object({operation_id:z.string().uuid(),review_version:z.number().int().min(1).max(2147483646),source_hash:z.string().regex(/^[a-f0-9]{64}$/),agent_summary:z.string().max(5000).nullable(),confirmation:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export function summaryIntent(actorId:string,productId:string,input:any){
  return {schema_version:BUSINESS_VERSION,action:"context.summary.write",actor_id:actorId,product_id:productId,operation_id:input.operation_id,review_version:input.review_version,source_hash:input.source_hash,agent_summary:input.agent_summary}
}
export function receipt(actorId:string,productId:string,input:any){return `rev:${digest(summaryIntent(actorId,productId,input)).slice(0,32)}:unreviewed`}
export const PRODUCT_BASE_FIELDS=["id","title","description","status","updated_at","variants.id","variants.title","variants.sku","variants.manage_inventory","variants.allow_backorder"]
export const PRICE_FIELDS=["id","currency_code","amount","min_quantity","max_quantity","price_list_id","price_rules.attribute","price_rules.value"]
export const LEVEL_FIELDS=["id","location_id","stocked_quantity","reserved_quantity","incoming_quantity","available_quantity","updated_at"]
export const INVENTORY_FIELDS=["variants.inventory_items.inventory_item_id","variants.inventory_items.required_quantity",...LEVEL_FIELDS.map(f=>`variants.inventory_items.inventory.location_levels.${f}`)]
const pick=(item:any,keys:string[])=>Object.fromEntries(keys.map(k=>[k,item?.[k]??null]))
const sort=(items:any[])=>items.sort((a,b)=>String(a.id??a.inventory_item_id).localeCompare(String(b.id??b.inventory_item_id)))
export function projectBusinessProduct(product:any,include:string[]){
  return {...pick(product,["id","title","description","status","updated_at"]),variants:sort((product.variants??[]).map((v:any)=>({
    ...pick(v,["id","title","sku","manage_inventory","allow_backorder"]),
    ...(include.includes("prices")?{prices:sort((v.price_set?.prices??[]).map((p:any)=>({...pick(p,PRICE_FIELDS.filter(f=>!f.includes("."))),price_rules:(p.price_rules??[]).map((r:any)=>pick(r,["attribute","value"])).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})))}:{}),
    ...(include.includes("inventory")?{inventory_items:sort((v.inventory_items??[]).map((i:any)=>({...pick(i,["inventory_item_id","required_quantity"]),location_levels:sort((i.inventory?.location_levels??[]).map((l:any)=>pick(l,LEVEL_FIELDS)))})))}:{})
  })))}
}
