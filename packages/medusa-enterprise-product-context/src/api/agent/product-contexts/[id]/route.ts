import type {MedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys} from "@medusajs/framework/utils"
import {isAgentContextReadAuthorized} from "../../../../agent-auth"

import {AGENT_CONTEXT_REVIEW_POLICY,CONTEXT_FIELDS,isCurrentApprovedContext,projectAgentContext} from "../../../../product-context-review"

export const CORS=false

export const GET=async(req:MedusaRequest,res:MedusaResponse)=>{
  if(!isAgentContextReadAuthorized(req.headers.authorization)){
    return res.status(401).json({message:"Unauthorized"})
  }
  if(!process.env.AGENT_CONTEXT_READ_TOKEN?.trim()){
    return res.status(503).json({message:"Agent context read surface is not configured"})
  }

  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {data}=await query.graph({
    entity:"product_context",
    fields:CONTEXT_FIELDS,
    filters:{product_id:req.params.id,status:"approved"}
  })
  const item=data?.[0]
  if(!isCurrentApprovedContext(item))return res.status(404).json({message:"Approved Product Context not found"})

  res.setHeader("Cache-Control","no-store")
  res.json({
    schema_version:"1.0",
    review_policy:AGENT_CONTEXT_REVIEW_POLICY,
    generated_at:new Date().toISOString(),
    ...projectAgentContext(item)
  })
}
