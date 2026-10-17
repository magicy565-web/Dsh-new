import {authenticate,defineMiddlewares,validateAndTransformBody} from "@medusajs/framework/http"
import {isAgentContextReadAuthorized} from "../agent-auth"
import {z} from "@medusajs/framework/zod"

const EvidenceSchema=z.object({
  id:z.string().min(1).max(120),
  label:z.string().min(1).max(200),
  type:z.enum(["certificate","test_report","case_study","spec_sheet","other"]),
  status:z.enum(["verified","pending","missing"]),
  source:z.string().max(1000).optional(),
  sha256:z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
  reviewed_at:z.string().datetime().optional(),
})
const CommercialPolicySchema=z.object({
  moq:z.number().nonnegative().optional(),
  trial_quantity:z.number().nonnegative().optional(),
  currency:z.string().max(10).optional(),
  price_min:z.number().nonnegative().optional(),
  price_max:z.number().nonnegative().optional(),
  lead_time_days:z.number().int().nonnegative().optional(),
  sample_policy:z.string().max(1000).optional(),
})
const ProductContextSchema=z.object({
  status:z.enum(["incomplete","ready_for_review","approved","blocked"]).optional(),
  readiness_score:z.number().min(0).max(100).optional(),
  buyer_profile:z.string().max(2000).optional(),
  target_markets:z.array(z.string().min(1).max(120)).max(50).optional(),
  use_cases:z.array(z.string().min(1).max(160)).max(50).optional(),
  selling_points:z.array(z.string().min(1).max(500)).max(50).optional(),
  evidence:z.array(EvidenceSchema).max(100).optional(),
  commercial_policy:CommercialPolicySchema.optional(),
  missing_evidence:z.array(z.string().min(1).max(240)).max(50).optional(),
  agent_summary:z.string().max(5000).optional(),
  source_hash:z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/).optional(),
  review_version:z.number().int().min(1).max(100000).optional(),
  notes:z.string().max(5000).optional(),
})

const agentContextReadMiddleware=(req:any,res:any,next:any)=>{
  const configured=Boolean(process.env.AGENT_CONTEXT_READ_TOKEN?.trim())
  const authorization=req.headers?.authorization as string|undefined
  if(!configured||!isAgentContextReadAuthorized(authorization)){
    return res.status(401).json({message:"Unauthorized"})
  }
  next()
}

export default defineMiddlewares({routes:[
  {matcher:"/admin/products/:id/context",method:"GET",middlewares:[authenticate("user",["session","bearer","api-key"])]},
  {matcher:"/admin/products/:id/context",method:"POST",middlewares:[authenticate("user",["session","bearer","api-key"]),validateAndTransformBody(ProductContextSchema)]},
  {matcher:"/admin/product-contexts",method:"GET",middlewares:[authenticate("user",["session","bearer","api-key"])]},
  {matcher:"/agent/product-contexts",method:"GET",middlewares:[agentContextReadMiddleware]},
  {matcher:"/agent/product-contexts/:id",method:"GET",middlewares:[agentContextReadMiddleware]},
]}
)
