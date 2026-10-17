import type {MedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys} from "@medusajs/framework/utils"
import {isAgentContextReadAuthorized} from "../../../agent-auth"

const CONTEXT_FIELDS=[
  "id","product_id","status","readiness_score","buyer_profile","target_markets",
  "use_cases","selling_points","evidence","commercial_policy","missing_evidence",
  "agent_summary","review_version","updated_at",
  "product.id","product.title","product.subtitle","product.handle","product.description",
  "product.status","product.thumbnail","product.variants.id","product.variants.title",
  "product.variants.sku"
]

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

  const {data,metadata}=await query.graph({
    entity:"product_context",
    fields:CONTEXT_FIELDS,
    filters,
    pagination:{skip:0,take:limit,order:{updated_at:"DESC"}}
  })

  const items=(data||[]).map((item:any)=>({
    context:{
      id:item.id,
      product_id:item.product_id,
      status:item.status,
      readiness_score:Number(item.readiness_score||0),
      buyer_profile:item.buyer_profile??null,
      target_markets:item.target_markets||[],
      use_cases:item.use_cases||[],
      selling_points:item.selling_points||[],
      evidence:(item.evidence||[]).map((e:any)=>({
        id:e.id,label:e.label,type:e.type,status:e.status,
        sha256:e.sha256??null,reviewed_at:e.reviewed_at??null
      })),
      commercial_policy:item.commercial_policy??null,
      missing_evidence:item.missing_evidence||[],
      agent_summary:item.agent_summary??null,
      review_version:Number(item.review_version||1),
      updated_at:item.updated_at??null
    },
    product:item.product?{
      id:item.product.id,
      title:item.product.title,
      subtitle:item.product.subtitle??null,
      handle:item.product.handle,
      description:item.product.description??null,
      status:item.product.status,
      thumbnail:item.product.thumbnail??null,
      variants:(item.product.variants||[]).map((v:any)=>({
        id:v.id,title:v.title,sku:v.sku??null
      }))
    }:null
  }))

  res.setHeader("Cache-Control","no-store")
  res.json({
    schema_version:"1.0",
    generated_at:new Date().toISOString(),
    count:metadata?.count??items.length,
    items
  })
}
