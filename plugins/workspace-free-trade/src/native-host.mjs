// Original native extension hooks and host-only read receipts. No extra loop,
// account, permission registry, persistence service or ERP implementation.
import {TradeError,validateErpRead} from './free-trade.mjs';
const guardId='workspace-free-trade-private-v1';
const fail=code=>{throw Object.assign(Error(code),{code});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Native loading/outside-repo copies/RPC do not preserve Error constructor
// identity. Normalize only reviewed adapter codes, never exception messages.
const adapterCodes=new Set(['SAM_API_KEY_REQUIRED','ERP_REVIEWED_CONNECTION_REQUIRED','ORIGINAL_AUTHORIZATION_REFUSED','OPERATION_CANCELLED',
  'RATE_LIMITED','REDIRECT_REFUSED','REMOTE_AUTHORIZATION_REFUSED','REMOTE_HTTP_ERROR','REMOTE_NOT_JSON','RESPONSE_TOO_LARGE','EMPTY_RESPONSE',
  'REMOTE_SCHEMA_INVALID','REQUEST_TIMEOUT','NETWORK_UNAVAILABLE','ERP_RECORD_MISMATCH','ERP_FIELD_SHAPE_INVALID','SECRET_ECHO_REFUSED']);
async function callAdapter(run){try{return await run();}catch(error){
  if(error instanceof TradeError)throw error;
  if(adapterCodes.has(error.code))throw new TradeError(error.code,['blocked','unconfigured','unavailable'].includes(error.status)?error.status:'blocked',
    Number.isSafeInteger(error.retryAfterSeconds)&&error.retryAfterSeconds>=0?Math.min(error.retryAfterSeconds,86400):null);
  throw error;
}}
const tenderProxy=client=>({status:()=>client.status(),search:(input,signal)=>callAdapter(()=>client.search(input,signal))});
// Occurrence pairing mirrors local-materials/pairs.mjs; provider IDs can repeat.
function pairs(messages){
  const output=[],pending=new Map();
  for(const message of messages){
    if(message.role==='user')pending.clear();
    if(message.role==='assistant'){
      pending.clear();const ambiguous=new Set();
      for(const call of message.content||[])if(call.type==='toolCall'&&call.id){
        if(pending.has(call.id)||ambiguous.has(call.id)){pending.delete(call.id);ambiguous.add(call.id);}else pending.set(call.id,call);
      }
    }
    if(message.role==='toolResult'){
      const call=pending.get(message.toolCallId);pending.delete(message.toolCallId);
      if(call&&call.name===message.toolName)output.push({call,result:message});
    }
  }return output;
}
export async function registerNativeTrade(pi,host,factory){
  const previous=host?.disclosureSnapshot?.(guardId),binding=host?.freeTrade;
  const privateContext=Boolean(binding||host?.selection&&!host.selection.options.publicOnly);
  if(!binding){
    if(previous)fail('FREE_TRADE_ORIGINAL_HOST_REQUIRED');
    pi.on?.('context',async(event,ctx)=>{
      if(event.messages.some(message=>message.role==='toolResult'&&message.toolName==='workspace_erpnext_read'&&!message.isError)
        ||ctx.sessionManager.getBranch().some(entry=>entry.customType==='workspace-disclosure-guard-required'&&entry.data?.ids?.includes(guardId)))fail('FREE_TRADE_PRIVATE_HISTORY_REFUSED');
    });
    return factory({enterprise:privateContext,...(host?.selection?.options.publicOnly&&host.publicTenderClient?{tenders:tenderProxy(host.publicTenderClient)}:{})})(pi);
  }
  const control=binding.open(host.nativeSessionId),footprints=new Map();
  if(host.history.length&&!previous)fail('FREE_TRADE_PRIVATE_HISTORY_PROOF_REQUIRED');
  if(previous){
    if(previous.schema!==1||previous.scopeHash!==binding.scopeHash||previous.nativeSessionId!==host.nativeSessionId||!Array.isArray(previous.proofs)||previous.proofs.length>8)fail('FREE_TRADE_PRIVATE_HISTORY_PROOF_REQUIRED');
    for(const proof of previous.proofs){await control.check(proof,host.signal,host.getModel());footprints.set(JSON.stringify(proof.request),proof);}
  }
  const snapshot=()=>({schema:1,scopeHash:binding.scopeHash,nativeSessionId:host.nativeSessionId,proofs:[...footprints.values()]});
  let last=previous?JSON.stringify(previous):null;
  function record(){const value=snapshot(),serialized=JSON.stringify(value);if(last!==serialized){host.recordDisclosure(guardId,value);last=serialized;}}
  async function authorize({phase='context'}={}){
    await control.authorizeContext(host.signal,host.getModel());
    const refresh=['model:disclose','model:complete','final:deliver'].includes(phase);
    for(const proof of footprints.values())await control.check(proof,host.signal,host.getModel(),{refresh,phase});
    if(phase==='model:disclose')record();
  }
  host.addDisclosureGuard(authorize,guardId);
  async function history(messages){
    const paired=pairs(messages),seen=new Set(paired.map(pair=>pair.result));
    for(const message of messages)if(message.role==='toolResult'&&message.toolName==='workspace_erpnext_read'){
      if(!message.isError||message.details?.authorization||message.details?.status==='ok'){
        if(message.isError||!seen.has(message))fail('FREE_TRADE_PRIVATE_HISTORY_PAIR_REQUIRED');
      }else if(message.details){
        const receipt=message.details;
        if(receipt.plugin!=='workspace-free-trade'||!['blocked','unconfigured','unavailable'].includes(receipt.status)
          ||typeof receipt.reason!=='string'||!/^[A-Z][A-Z0-9_]{0,80}$/.test(receipt.reason)||receipt.externalWrites!==false
          ||Object.keys(receipt).some(key=>!['plugin','status','reason','externalWrites','retryAfterSeconds'].includes(key))
          ||message.content?.length!==1||message.content[0].type!=='text'||message.content[0].text!==JSON.stringify(receipt))fail('FREE_TRADE_PRIVATE_CACHED_BODY_CHANGED');
      }
    }
    for(const {call,result}of paired){
      if(call.name!=='workspace_erpnext_read'||result.isError)continue;
      const proof=footprints.get(JSON.stringify(result.details?.authorization?.request));
      const args={...call.arguments};delete args.i;
      let request;try{request=validateErpRead(args);}catch{fail('FREE_TRADE_PRIVATE_HISTORY_PROOF_REQUIRED');}
      if(!proof||!same(request,proof.request)||result.content?.length!==1||result.content[0].type!=='text'||result.content[0].text!==JSON.stringify(result.details))fail('FREE_TRADE_PRIVATE_HISTORY_PROOF_REQUIRED');
      await control.verifyBody(proof,result.details);await control.check(proof,host.signal,host.getModel());
    }
  }
  await history(host.history);
  factory({...control,tenders:tenderProxy(control.tenders),erp:{status:()=>control.erp.status(),read:(input,signal,model)=>callAdapter(()=>control.erp.read(input,signal,model))}})({registerTool(tool){pi.registerTool({...tool,async execute(id,input,signal,update,ctx){
    await host.authorize();const result=await tool.execute(id,input,signal,update,ctx);
    if(tool.name==='workspace_erpnext_read'&&!result.isError&&result.details?.status==='ok'){
      const proof=await control.seal(input,result.details,signal,ctx.model),key=JSON.stringify(proof.request),old=footprints.get(key);
      if(old&&!same(old,proof))fail('FREE_TRADE_ERP_PROJECTION_CHANGED');
      if(!old&&footprints.size>=8)fail('FREE_TRADE_PRIVATE_RECEIPT_LIMIT');footprints.set(key,proof);
      const receipt={...result.details,authorization:proof};result.details=receipt;result.content=[{type:'text',text:JSON.stringify(receipt)}];
    }
    await host.authorize();return result;
  }});}});
  pi.on('context',async event=>{await history(event.messages);await authorize();record();});
  host.diagnostics('free-trade',control.report);
}
