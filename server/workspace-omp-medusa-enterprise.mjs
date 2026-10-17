// Read-only composition of existing clients and original native journal proofs.
// Discovery grants nothing; no new authority, persistence, runtime or write path.
import {isDeepStrictEqual as equal} from 'node:util';
import {isMedusaGapReceipt} from './workspace-omp-business-journal.mjs';
export const MEDUSA_ENTERPRISE_SCOPE='omp:18.10.4:medusa-enterprise-readonly-v1';
export const MEDUSA_ENTERPRISE_TOOLS=Object.freeze(['workspace_medusa_status','workspace_medusa_preview','workspace_medusa_reconcile','workspace_enterprise_context_status','workspace_enterprise_context_parse_upload']);
const refuse=()=>{throw Object.assign(Error('MEDUSA_ENTERPRISE_RECEIPT_REFUSED'),{code:'MEDUSA_ENTERPRISE_RECEIPT_REFUSED'});};
function receipts(messages){
 const result=[],pending=new Map();
 for(const message of messages){
  if(message?.role==='user')pending.clear();
  if(message?.role==='assistant'){
   pending.clear();
   for(const call of message.content||[])if(call.type==='toolCall'){
    if(!MEDUSA_ENTERPRISE_TOOLS.includes(call.name)||!call.id||pending.has(call.id))refuse();
    pending.set(call.id,call);
   }
  }
  if(message?.role!=='toolResult')continue;
  const call=pending.get(message.toolCallId);pending.delete(message.toolCallId);
  if(!call||call.name!==message.toolName||message.content?.length!==1||message.content[0].type!=='text')refuse();
  let receipt;try{receipt=JSON.parse(message.content[0].text);}catch{refuse();}
  if(!equal(receipt,message.details))refuse();
  const args={...call.arguments};delete args.i;
  if(call.name.startsWith('workspace_medusa_')){
   if(receipt?.plugin!=='workspace-medusa-catalog')refuse();
   if(receipt.method){if(call.name!=='workspace_medusa_'+receipt.method||!equal(args,receipt.input))refuse();}
   else if(!isMedusaGapReceipt(receipt)||!message.isError)refuse();
  }else{
   if(receipt?.plugin!=='workspace-enterprise-context-oss'||receipt.visibility!=='internal'||receipt.canonicalFacts!=='Workspace Library'||receipt.externalActions!==false)refuse();
   if(message.isError){
    if(!['blocked','unconfigured','unavailable'].includes(receipt.status)||!(/^[A-Z][A-Z0-9_]{0,80}$/).test(receipt.reason||'')||Object.keys(receipt).some(k=>!['plugin','visibility','canonicalFacts','externalActions','status','reason','providers'].includes(k)))refuse();
    if(receipt.providers&&(Object.keys(receipt.providers).some(k=>!['mem0','docling'].includes(k))||receipt.providers.mem0!=='disabled'||receipt.providers.docling!=='unconfigured'))refuse();
   }else{
    const proof=receipt.authorization;
    if(!proof||call.name!=='workspace_enterprise_context_'+(proof.kind==='parse'?'parse_upload':proof.kind==='status'?'status':'REFUSED'))refuse();
    if(!equal(args,proof.kind==='status'?{}:proof.source?.asset))refuse();
   }
  }
  result.push({message,receipt,args});
 }
 return result;
}
export async function revalidateMedusaEnterpriseJournal(messages,{medusaClient,enterpriseControl,model,signal}={}){
 for(const {message,receipt}of receipts(messages)){
  signal?.throwIfAborted();
  if(receipt.plugin==='workspace-medusa-catalog'&&receipt.method){
   if(!medusaClient)refuse();
   if(!equal(await medusaClient.refresh(receipt,model,signal),receipt))refuse();
  }else if(receipt.plugin==='workspace-enterprise-context-oss'&&!message.isError&&enterpriseControl){
   await enterpriseControl.verifyBody(receipt.authorization,receipt);await enterpriseControl.check(receipt.authorization,signal,model);
  }
 }
}
// Called on Node after the last awaited original authorization, both at actual
// model wire admission and final delivery. Both source fences are synchronous.
export function assertMedusaEnterpriseDisclosure(messages,{medusaClient,enterpriseControl,model,signal,wireBody}={}){
 const rows=receipts(messages);
 if(medusaClient)medusaClient.assertDisclosureCurrent(null,signal);
 enterpriseControl.assertDisclosureCurrent({messages,context:[],memoryProofs:[],...(wireBody===undefined?{}:{wireBody})},model,signal);
 for(const {receipt}of rows)if(receipt.plugin==='workspace-medusa-catalog'&&receipt.method){
  if(typeof medusaClient?.assertDisclosureCurrent!=='function')refuse();
  medusaClient.assertDisclosureCurrent(receipt,signal);
 }
 if(wireBody!==undefined){
  let body;try{body=JSON.parse(wireBody);}catch{refuse();}
  if(!Array.isArray(body.messages))refuse();
  const calls=new Map();
  for(const message of body.messages){
   if(message.role==='assistant')for(const call of message.tool_calls||[]){
    if(!MEDUSA_ENTERPRISE_TOOLS.includes(call.function?.name)||calls.has(call.id))refuse();
    let args;try{args=JSON.parse(call.function.arguments);}catch{refuse();}delete args.i;calls.set(call.id,{name:call.function.name,args});
   }
   if(message.role!=='tool')continue;
   let receipt;try{receipt=JSON.parse(message.content);}catch{refuse();}
   const call=calls.get(message.tool_call_id);calls.delete(message.tool_call_id);
   if(!call||!rows.some(row=>row.message.toolName===call.name&&equal(row.args,call.args)&&equal(row.receipt,receipt)))refuse();
  }
 }
 signal?.throwIfAborted();
}
