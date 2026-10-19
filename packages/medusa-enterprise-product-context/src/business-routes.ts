import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys,MedusaError} from "@medusajs/framework/utils"
import {BUSINESS_VERSION,granted,digest,ReadQuery,SummaryInput,summaryIntent,receipt,PRODUCT_BASE_FIELDS,PRICE_FIELDS,INVENTORY_FIELDS,projectBusinessProduct} from "./business-contract"
import {PRODUCT_FIELDS,reviewSourceHash} from "./product-context-review"
import {PRODUCT_CONTEXT_MODULE} from "./modules/product-context"
import type ProductContextModuleService from "./modules/product-context/service"

function fail(res:MedusaResponse,status:number,code:string){return res.status(status).json({schema_version:BUSINESS_VERSION,error:{code}})}
function authorized(req:AuthenticatedMedusaRequest,res:MedusaResponse,capabilities:string[]){
  res.setHeader("Cache-Control","no-store")
  if(!req.auth_context?.actor_id){fail(res,401,"UNAUTHENTICATED");return false}
  if(!/^prod_[A-Za-z0-9]+$/.test(req.params.id)||!granted(req.auth_context,req.params.id,capabilities)){fail(res,403,"CAPABILITY_DENIED");return false}
  return true
}
export const GET=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  const parsed=ReadQuery.safeParse(req.query??{})
  if(!parsed.success)return fail(res,400,"INVALID_QUERY")
  const include=parsed.data.include?.split(",")??[]
  if(!authorized(req,res,["product.read",...include.map(i=>i==="prices"?"price.read":"inventory.read")]))return
  const fields=[...new Set([...PRODUCT_BASE_FIELDS,...PRODUCT_FIELDS,
    ...(include.includes("prices")?PRICE_FIELDS.map(f=>`variants.price_set.prices.${f}`):[]),
    ...(include.includes("inventory")?INVENTORY_FIELDS:[])])]
  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {data}=await query.graph({entity:"product",fields,filters:{id:req.params.id}})
  if(!data?.[0])return fail(res,404,"PRODUCT_NOT_FOUND")
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const context=(await service.listProductContexts({product_id:req.params.id}))[0]??null
  const product=projectBusinessProduct(data[0],include)
  const summary={agent_summary:context?.agent_summary??null,status:context?.status??null,review_version:context?.review_version??0,source_hash:reviewSourceHash(context,data[0])}
  return res.json({schema_version:BUSINESS_VERSION,observed_at:new Date().toISOString(),revision:digest({product,summary}),consistency:"observed_not_transactional",product,summary})
}
export const POST=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  if(!authorized(req,res,["product.read","context.summary.write"]))return
  const parsed=SummaryInput.safeParse(req.body)
  if(!parsed.success)return fail(res,400,"INVALID_BODY")
  const input=parsed.data,actorId=req.auth_context.actor_id!
  if(input.confirmation!==digest(summaryIntent(actorId,req.params.id,input)))return fail(res,422,"CONFIRMATION_MISMATCH")
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const load=async()=>(await service.listProductContexts({product_id:req.params.id}))[0]
  const current=await load()
  if(!current)return fail(res,409,"CONTEXT_REQUIRED")
  const stamp=receipt(actorId,req.params.id,input)
  const isReplay=(c:any)=>c?.source_hash===stamp&&c.review_version===input.review_version+1&&c.agent_summary===input.agent_summary&&c.status==="ready_for_review"&&!c.reviewed_by&&!c.reviewed_at
  const reply=(c:any,replayed:boolean)=>res.json({schema_version:BUSINESS_VERSION,operation_id:input.operation_id,outcome:"applied",replayed,product_id:req.params.id,summary:{agent_summary:c.agent_summary,status:c.status,review_version:c.review_version},receipt:stamp})
  // The existing durable context row is the receipt. No process-local success cache.
  if(isReplay(current))return reply(current,true)
  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {data}=await query.graph({entity:"product",fields:PRODUCT_FIELDS,filters:{id:req.params.id}})
  if(!data?.[0])return fail(res,404,"PRODUCT_NOT_FOUND")
  if(current.review_version!==input.review_version||reviewSourceHash(current,data[0])!==input.source_hash)return fail(res,409,"REVISION_CONFLICT")
  const update={agent_summary:input.agent_summary,status:"ready_for_review",review_version:input.review_version+1,source_hash:stamp,reviewed_by:null,reviewed_at:null}
  try{
    const saved=await service.updateReviewedProductContext(current.id,input.review_version,update,current.source_hash??null)
    // Another writer may advance after nativeUpdate but before its retrieve.
    if(!isReplay(saved))return fail(res,409,"REVISION_CONFLICT")
    return reply(saved,false)
  }catch(error:any){
    if(error.type===MedusaError.Types.CONFLICT){
      const latest=await load()
      if(isReplay(latest))return reply(latest,true)
      return fail(res,409,"REVISION_CONFLICT")
    }
    throw error
  }
}
