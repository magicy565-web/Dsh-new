import type {MedusaRequest,MedusaResponse} from "@medusajs/framework/http"
import {ContainerRegistrationKeys} from "@medusajs/framework/utils"
import {isAgentContextReadAuthorized} from "../../../../agent-auth"

const FIELDS=[
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

  const query=req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {data}=await query.graph({
    entity:"product_context",
    fields:FIELDS,
    filters:{product_id:req.params.id,status:"approved"}
  })
  const item=data?.[0]
  if(!item)return res.status(404).json({message:"Approved Product Context not found"})

  res.setHeader("Cache-Control","no-store")
  res.json({
    schema_version:"1.0",
    generated_at:new Date().toISOString(),
    context:{
      id:item.id,product_id:item.product_id,status:item.status,
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
      id:item.product.id,title:item.product.title,subtitle:item.product.subtitle??null,
      handle:item.product.handle,description:item.product.description??null,
      status:item.product.status,thumbnail:item.product.thumbnail??null,
      variants:(item.product.variants||[]).map((v:any)=>({id:v.id,title:v.title,sku:v.sku??null}))
    }:null
  })
}
