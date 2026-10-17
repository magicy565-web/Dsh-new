import {timingSafeEqual} from "node:crypto"

export function extractBearerToken(authorizationHeader?:string|null):string|null{
  if(!authorizationHeader)return null
  const match=/^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  return match?.[1]?.trim()||null
}

export function isAgentContextReadAuthorized(authorizationHeader?:string|null,expectedToken=process.env.AGENT_CONTEXT_READ_TOKEN):boolean{
  const expected=expectedToken?.trim()
  const provided=extractBearerToken(authorizationHeader)
  if(!expected||!provided)return false
  const a=Buffer.from(provided)
  const b=Buffer.from(expected)
  return a.length===b.length&&timingSafeEqual(a,b)
}
