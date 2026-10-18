import type {MedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys} from "@medusajs/framework/utils"
import {isAgentContextReadAuthorized} from "../../../agent-auth"

import {AGENT_CONTEXT_REVIEW_POLICY,CONTEXT_FIELDS,isCurrentApprovedContext,projectAgentContext} from "../../../product-context-review"

export const CORS=false

export const GET=async(req:MedusaRequest,res:MedusaResponse)=>{
  if(!isAgentContextReadAuthorized(req.headers.authorization)){
    return res.status(401).json({message:"Unauthorized"})
  }
  if(!process.env.AGENT_CONTEXT_READ_TOKEN?.trim()){
    return res.status(503).json({message:"Agent context read surface is not configured"})
  }

  const productId=typeof req.query.product_id==="string"&&req.query.product_id.trim()?req.query.product_id.trim():undefined
  const rawLimit=typeof req.query.limit==="string"?Number(req.query.limit):50
  const limit=Number.isFinite(rawLimit)?Math.max(1,Math.min(100,Math.floor(rawLimit))):50
  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const filters:Record<string,unknown>={status:"approved"}
  if(productId)filters.product_id=productId

  const {data}=await query.graph({
    entity:"product_context",
    fields:CONTEXT_FIELDS,
    filters,
    pagination:{skip:0,take:limit,order:{updated_at:"DESC"}}
  })

  const items=(data||[]).filter(isCurrentApprovedContext).map(projectAgentContext)

  res.setHeader("Cache-Control","no-store")
  res.json({
    schema_version:"1.0",
    review_policy:AGENT_CONTEXT_REVIEW_POLICY,
    generated_at:new Date().toISOString(),
    count:items.length,
    items
  })
}
