import {createHash,randomBytes} from "node:crypto"
import {ContextContentSchema,MAX_REVIEW_VERSION,ProductSourceSchema} from "./product-context-validation"

export const AGENT_CONTEXT_REVIEW_POLICY="medusa-product-context-current-source-v1"

// This is the exact native Medusa projection reviewed and released to an Agent.
export const PRODUCT_FIELDS=["id","title","subtitle","handle","description","status","thumbnail",
  "variants.id","variants.title","variants.sku"]
export const CONTEXT_FIELDS=["id","product_id","status","readiness_score","buyer_profile","target_markets",
  "use_cases","selling_points","evidence","commercial_policy","missing_evidence","agent_summary",
  "source_hash","review_version","reviewed_at","reviewed_by","updated_at",
  ...PRODUCT_FIELDS.map(field=>`product.${field}`)]
export const POLICY_FIELDS=["moq","trial_quantity","currency","price_min","price_max","lead_time_days","sample_policy"]
export const EDITABLE_FIELDS=["buyer_profile","target_markets","use_cases","selling_points","evidence",
  "commercial_policy","missing_evidence","agent_summary","notes"] as const

export function projectProduct(product:any){
  if(!product||typeof product.id!=="string")return null
  return {id:product.id,title:product.title??null,subtitle:product.subtitle??null,
    handle:product.handle??null,description:product.description??null,status:product.status??null,
    thumbnail:product.thumbnail??null,variants:(product.variants??[]).map((v:any)=>({
      id:v.id,title:v.title??null,sku:v.sku??null
    })).sort((a:any,b:any)=>a.id.localeCompare(b.id))}
}

function canonical(value:any):any{
  if(Array.isArray(value))return value.map(canonical)
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))
  return value
}

export function reviewSourceHash(context:any,product:any):string{
  const material={product:projectProduct(product),review_version:context?.review_version??0,
    ...(revisionStamp(context?.source_hash)?{revision_stamp:revisionStamp(context.source_hash)![1]}:{}),
    readiness_score:Number(context?.readiness_score??0),
    ...Object.fromEntries(EDITABLE_FIELDS.filter(field=>field!=="notes").map(field=>[field,context?.[field]??null]))}
  return createHash("sha256").update(JSON.stringify(canonical(material))).digest("hex")
}

function revisionStamp(hash:unknown){
  return typeof hash==="string"?/^rev:([a-f0-9]{32}):([a-f0-9]{64}|unreviewed)$/.exec(hash):null
}

// At the integer ceiling the counter saturates. A fresh stamp in the existing
// source_hash rotates on EVERY save, including withdrawal, so CAS cannot suffer
// ABA when the numeric version is unchanged. No schema change or wraparound.
export function sealReviewSource(context:any,product:any,approved:boolean):string|null{
  const prefix=context.review_version===MAX_REVIEW_VERSION?`rev:${randomBytes(16).toString("hex")}:`:""
  if(!approved)return prefix?prefix+"unreviewed":null
  return prefix+reviewSourceHash({...context,source_hash:prefix?prefix+"unreviewed":null},product)
}

export function passesReleaseGate(context:any):boolean{
  if(!ContextContentSchema.safeParse(context).success)return false
  const score=Number(context.readiness_score)
  return Number.isFinite(score)&&score>=80&&score<=100&&Array.isArray(context.missing_evidence)&&
    context.missing_evidence.length===0&&(context.evidence==null||Array.isArray(context.evidence)&&
      context.evidence.every((e:any)=>e&&["verified","pending"].includes(e.status)))
}

export function isCurrentApprovedContext(item:any):boolean{
  return item?.status==="approved"&&passesReleaseGate(item)&&
    Number.isSafeInteger(item.review_version)&&item.review_version>0&&item.review_version<=MAX_REVIEW_VERSION&&
    Boolean(item.reviewed_by&&item.reviewed_at)&&Boolean(item.product)&&item.product_id===item.product.id&&
    ProductSourceSchema.safeParse(item.product).success&&typeof item.source_hash==="string"&&
    (revisionStamp(item.source_hash)?.[2]??item.source_hash)===reviewSourceHash(item,item.product)
}

export function projectAgentContext(item:any){
  return {context:{id:item.id,product_id:item.product_id,status:item.status,
    readiness_score:Number(item.readiness_score),buyer_profile:item.buyer_profile??null,
    target_markets:item.target_markets??[],use_cases:item.use_cases??[],selling_points:item.selling_points??[],
    evidence:(item.evidence??[]).map((e:any)=>({id:e.id,label:e.label,type:e.type,status:e.status,
      sha256:e.sha256??null,reviewed_at:e.reviewed_at??null})),
    commercial_policy:item.commercial_policy==null?null:Object.fromEntries(POLICY_FIELDS
      .filter(field=>Object.hasOwn(item.commercial_policy,field)).map(field=>[field,item.commercial_policy[field]])),
    missing_evidence:item.missing_evidence,agent_summary:item.agent_summary??null,
    source_hash:item.source_hash,review_version:item.review_version,updated_at:item.updated_at??null},
    product:projectProduct(item.product)}
}
