import type ProductContextModuleService from "../../../modules/product-context/service"
import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {PRODUCT_CONTEXT_MODULE} from "../../../modules/product-context"

export const GET=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  const service=req.scope.resolve<ProductContextModuleService>(PRODUCT_CONTEXT_MODULE)
  const product_contexts=await service.listProductContexts({})
  res.json({product_contexts})
}
