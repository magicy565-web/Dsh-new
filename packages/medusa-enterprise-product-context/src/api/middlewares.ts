import {authenticate,defineMiddlewares,validateAndTransformBody} from "@medusajs/framework/http"
import {isAgentContextReadAuthorized} from "../agent-auth"
import {ProductContextInputSchema} from "../product-context-validation"

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
  {matcher:"/admin/products/:id/context",method:"POST",middlewares:[authenticate("user",["session","bearer","api-key"]),validateAndTransformBody(ProductContextInputSchema)]},
  {matcher:"/admin/product-contexts",method:"GET",middlewares:[authenticate("user",["session","bearer","api-key"])]},
  {matcher:"/agent/product-contexts",method:"GET",middlewares:[agentContextReadMiddleware]},
  {matcher:"/agent/product-contexts/:id",method:"GET",middlewares:[agentContextReadMiddleware]},
]}
)
