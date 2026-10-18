import type ProductContextModuleService from "../../../../../modules/product-context/service"
import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys,MedusaError} from "@medusajs/framework/utils"
import {EDITABLE_FIELDS,PRODUCT_FIELDS,passesReleaseGate,reviewSourceHash,sealReviewSource} from "../../../../../product-context-review"
import {PRODUCT_CONTEXT_MODULE} from "../../../../../modules/product-context"

import {ProductContextStatus} from "../../../../../modules/product-context/models/product-context"

import {MAX_REVIEW_VERSION,ProductSourceSchema} from "../../../../../product-context-validation"
import type {ProductContextInput} from "../../../../../product-context-validation"

async function readProduct(req:AuthenticatedMedusaRequest){
  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {data}=await query.graph({entity:"product",fields:PRODUCT_FIELDS,filters:{id:req.params.id}})
  if(!data?.[0])throw new MedusaError(MedusaError.Types.NOT_FOUND,"Product not found")
  if(!ProductSourceSchema.safeParse(data[0]).success)throw new MedusaError(MedusaError.Types.INVALID_DATA,"Product source contains invalid field values.")
  return data[0]
}

export const GET=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const product=await readProduct(req)
  const context=(await service.listProductContexts({product_id:req.params.id}))[0]??null
  res.setHeader("Cache-Control","no-store")
  res.json({product_context:context,review_source_hash:reviewSourceHash(context,product)})
}

export const POST=async(req:AuthenticatedMedusaRequest<ProductContextInput>,res:MedusaResponse)=>{
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const product=await readProduct(req)
  const current=(await service.listProductContexts({product_id:req.params.id}))[0]
  const body=req.validatedBody
  const version=current?.review_version??0
  if(!Number.isSafeInteger(version)||version<0||version>MAX_REVIEW_VERSION||body.review_version!==version){
    return res.status(409).json({message:"Product Context version changed; reload before editing."})
  }
  const explicitApproval=body.status==="approved"
  if(explicitApproval&&!req.auth_context.actor_id){
    return res.status(401).json({message:"Authenticated reviewer required."})
  }
  if((explicitApproval||version===MAX_REVIEW_VERSION)&&body.source_hash!==reviewSourceHash(current,product)){
    return res.status(409).json({message:"Product Context or product source changed; reload before reviewing."})
  }
  const defaults={target_markets:[],use_cases:[],selling_points:[],missing_evidence:[]}
  const fields=Object.fromEntries(EDITABLE_FIELDS.map(field=>[field,body[field]!==undefined?body[field]:current?.[field]??defaults[field as keyof typeof defaults]??null]))
  const nextStatus:ProductContextStatus=(body.status??(current?.status==="approved"?ProductContextStatus.READY_FOR_REVIEW:current?.status??ProductContextStatus.INCOMPLETE)) as ProductContextStatus
  const input={...fields,product_id:req.params.id,status:nextStatus,
    readiness_score:body.readiness_score??current?.readiness_score??0,
    review_version:Math.min(version+1,MAX_REVIEW_VERSION),source_hash:null as string|null,
    reviewed_at:explicitApproval?new Date():null,
    reviewed_by:explicitApproval?req.auth_context.actor_id:null}
  if(explicitApproval&&!passesReleaseGate(input)){
    return res.status(422).json({message:"Approval requires valid Product Context field values, readiness_score >= 80 and no missing evidence. Correct invalid fields explicitly."})
  }
  input.source_hash=sealReviewSource(input,product,explicitApproval)
  try{
    const context=current
      ?await service.updateReviewedProductContext(current.id,version,input,current.source_hash??null)
      :await service.createProductContexts(input)
    res.setHeader("Cache-Control","no-store")
    return res.json({product_context:context})
  }catch(error:any){
    // A duplicate first create is also a conflict, never an overwrite/retry.
    if(error.type===MedusaError.Types.CONFLICT||error.code==="23505"){
      return res.status(409).json({message:"Product Context changed; reload before editing."})
    }
    // The pinned SDK can map a unique violation to INVALID_DATA.
    if(!current&&error.type===MedusaError.Types.INVALID_DATA&&
      (await service.listProductContexts({product_id:req.params.id})).length){
      return res.status(409).json({message:"Product Context changed; reload before editing."})
    }
    throw error
  }
}
