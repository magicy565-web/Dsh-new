import type ProductContextModuleService from "../../../../../modules/product-context/service"
import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys,MedusaError} from "@medusajs/framework/utils"
import {PRODUCT_CONTEXT_MODULE} from "../../../../../modules/product-context"

import {ProductContextStatus} from "../../../../../modules/product-context/models/product-context"

export type ProductContextInput={
  status?:ProductContextStatus
  readiness_score?:number
  buyer_profile?:string
  target_markets?:string[]
  use_cases?:string[]
  selling_points?:string[]
  evidence?:Array<{id:string;label:string;type:string;status:string;source?:string;sha256?:string;reviewed_at?:string}>
  commercial_policy?:Record<string,unknown>
  missing_evidence?:string[]
  agent_summary?:string
  source_hash?:string
  review_version?:number
  notes?:string
}

export const GET=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const contexts=await service.listProductContexts({product_id:req.params.id})
  res.json({product_context:contexts[0]??null})
}

export const POST=async(req:AuthenticatedMedusaRequest<ProductContextInput>,res:MedusaResponse)=>{
  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const {data:products}=await query.graph({entity:"product",fields:["id"],filters:{id:req.params.id}})
  if(!products.length)throw new MedusaError(MedusaError.Types.NOT_FOUND,"Product not found")
  const current=(await service.listProductContexts({product_id:req.params.id}))[0]
  const body=req.validatedBody
  const score=body.readiness_score==null?Number(current?.readiness_score||0):Math.max(0,Math.min(100,body.readiness_score))
  const missing=body.missing_evidence??current?.missing_evidence??[]
  const evidence=body.evidence??current?.evidence??[]
  const nextStatus=body.status??current?.status??"incomplete"
  const hasMissingEvidence=missing.length>0||!Array.isArray(evidence)||evidence.some((item:any)=>item.status==="missing")
  if(nextStatus==="approved"&&(score<80||hasMissingEvidence)){
    return res.status(422).json({message:"Approved Product Context requires readiness_score >= 80 and no missing evidence."})
  }
  const reviewed=nextStatus==="ready_for_review"||nextStatus==="approved"
  const input={
    ...body,
    product_id:req.params.id,
    readiness_score:score,
    missing_evidence:missing,
    reviewed_at:reviewed?new Date():current?.reviewed_at??null,
    reviewed_by:reviewed?req.auth_context.actor_id:current?.reviewed_by??null,
  }
  const context=current
    ?await service.updateProductContexts({id:current.id,...input})
    :await service.createProductContexts(input)
  res.json({product_context:context})
}
