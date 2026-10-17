export function isBrainGapReceipt(receipt){
 return receipt?.plugin==='workspace-goal-intelligence'&&['blocked','unconfigured'].includes(receipt.status)
  && ['BRAIN_REVIEWED_HOST_AND_CONTEXT_GUARD_REQUIRED','BRAIN_CANCELLED','BRAIN_RECEIVER_MISMATCH','BRAIN_INPUT_INVALID','BRAIN_SOURCE_CHANGED','BRAIN_SOURCE_NOT_SELECTED','BRAIN_OPERATION_UNAVAILABLE'].includes(receipt.reason)
  && Object.keys(receipt).every(k=>['plugin','status','reason','retryWithNewRequest'].includes(k))
  && (!Object.hasOwn(receipt,'retryWithNewRequest')||receipt.retryWithNewRequest===false);
}
export function isMedusaGapReceipt(receipt){
 return receipt?.plugin==='workspace-medusa-catalog'&&['blocked','unconfigured'].includes(receipt.status)
  && ['ORIGINAL_REVIEWED_HOST_REQUIRED','MEDUSA_UNCONFIGURED','MEDUSA_PRODUCT_ID_INVALID','MEDUSA_ROLE_REQUIRED','MEDUSA_ORIGINAL_SELECTION_REQUIRED','MEDUSA_SOURCE_CHANGED','MEDUSA_TRANSPORT_UNCERTAIN','MEDUSA_REMOTE_REFUSED','MEDUSA_INVALID_RESPONSE','MEDUSA_RESPONSE_LIMIT','MEDUSA_HANDLE_AMBIGUOUS','MEDUSA_REMOTE_CONFLICT','MEDUSA_NOT_ELIGIBLE','ORIGINAL_MEDUSA_OPERATION_REFUSED'].includes(receipt.reason)
  && Object.keys(receipt).every(k=>['plugin','status','reason','sources'].includes(k))&&Array.isArray(receipt.sources)&&receipt.sources.length===0;
}
// Recheck the original owned native journal at the Node delivery boundary.
// No receipt registry, permission cache, model-supplied citation list or store.
export async function revalidateBusinessJournal(messages,{materialsClient,planClient,monitorClient,productClient,medusaClient,brainClient,model,signal}={}){
 for(const message of messages){
  signal?.throwIfAborted();
  if(message?.role!=='toolResult'||message.toolName==='workspace_skill')continue;
  let receipt;try{receipt=JSON.parse((message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n'));}catch{throw Error('NATIVE_BUSINESS_RECEIPT_INVALID');}
  if(!receipt||typeof receipt!=='object')throw Error('NATIVE_BUSINESS_RECEIPT_INVALID');
  if(receipt.plugin==='workspace-goal-intelligence'&&['blocked','unconfigured'].includes(receipt.status)){if(!isBrainGapReceipt(receipt)||message.content.some(b=>b.type!=='text'))throw Error('BRAIN_CACHE_REFUSED');continue;}
  if(receipt.plugin==='workspace-medusa-catalog'&&!receipt.method){if(!isMedusaGapReceipt(receipt)||message.content.some(b=>b.type!=='text'))throw Error('MEDUSA_SOURCE_CHANGED');continue;}
  if(['blocked','unconfigured','unavailable'].includes(receipt.status)&&!receipt.method&&
    Object.keys(receipt).every(k=>['plugin','status','reason','sources','retryWithNewRequest','detail','humanReviewRequired','humanReviewed','sent','externalActions','visibility','humanConfirmed','independentVerification','startedAt'].includes(k))&&
    (!receipt.sources||Array.isArray(receipt.sources)&&receipt.sources.length===0))continue;
  const modelImages=(message.content||[]).filter(b=>b.type==='image');
  if(receipt.plugin==='workspace-factory-materials')await materialsClient.revalidateReceipt(receipt,model,signal);
  else if(receipt.plugin==='workspace-market-validation')await planClient.revalidateReceipt(receipt,model,signal);
  else if(receipt.plugin==='workspace-market-monitor')await monitorClient.refresh(receipt,model,signal);
  else if(receipt.plugin==='workspace-shopify-product')await productClient.refresh(receipt,model,signal,modelImages);
  else if(receipt.plugin==='workspace-medusa-catalog'){
   const fresh=await medusaClient.refresh(receipt,model,signal);
   if(JSON.stringify(fresh)!==JSON.stringify(receipt))throw Error('MEDUSA_SOURCE_CHANGED');
  }
  else if(receipt.plugin==='workspace-goal-intelligence')await brainClient.revalidateReceipt(receipt,signal,model);
  else throw Error('NATIVE_BUSINESS_RECEIPT_INVALID');
  signal?.throwIfAborted();
 }
}
