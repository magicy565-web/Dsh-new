// Original Host hooks and native Session proofs; no private store or Agent loop.
const guardId='workspace-enterprise-context-private-v1';
const fail=code=>{throw Object.assign(Error(code),{code});};
function pairs(messages){const out=[],pending=new Map();for(const message of messages){
 if(message.role==='user')pending.clear();
 if(message.role==='assistant'){pending.clear();const ambiguous=new Set();for(const call of message.content||[])if(call.type==='toolCall'&&call.id){if(pending.has(call.id)||ambiguous.has(call.id)){pending.delete(call.id);ambiguous.add(call.id);}else pending.set(call.id,call);}}
 if(message.role==='toolResult'){const call=pending.get(message.toolCallId);pending.delete(message.toolCallId);if(call?.name===message.toolName)out.push({call,result:message});}
}return out;}
export async function registerNativeContext(pi,host,factory){
 const binding=host?.enterpriseContext,previous=host?.disclosureSnapshot?.(guardId);
 if(!binding){if(previous)fail('OSS_ORIGINAL_HOST_REQUIRED');return factory()(pi);}
 const control=binding.open(host.nativeSessionId),proofs=new Map(),names=['workspace_enterprise_context_parse_upload','workspace_enterprise_context_status',...(binding.memoryMethods||[]).map(method=>'workspace_enterprise_context_'+method.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()))];
 const key=proof=>JSON.stringify(proof);
 if(host.history.length&&!previous)fail('OSS_PRIVATE_SNAPSHOT_REQUIRED');
 if(previous){if(previous.schema!==1||previous.scopeHash!==binding.scopeHash||previous.nativeSessionId!==host.nativeSessionId||!Array.isArray(previous.proofs)||previous.proofs.length>8)fail('OSS_PRIVATE_SNAPSHOT_REQUIRED');
  // Node checks both current sources and authenticated credential-screening
  // evidence here, before compacted summaries can reach the first model call.
  for(const proof of previous.proofs){await control.check(proof,host.signal,host.getModel());proofs.set(key(proof),proof);}}
 const addProof=proof=>{if(proof.kind==='memory')for(const [id,old]of proofs)if(id!==key(proof)&&old.kind==='memory'&&JSON.stringify(old.query)===JSON.stringify(proof.query))proofs.delete(id);if(!proofs.has(key(proof))&&proofs.size>=8)fail('OSS_PRIVATE_RECEIPT_LIMIT');proofs.set(key(proof),proof);};
 const snapshot=()=>({schema:1,scopeHash:binding.scopeHash,nativeSessionId:host.nativeSessionId,proofs:[...proofs.values()]});let last=previous?JSON.stringify(previous):null;
 const record=()=>{const value=snapshot(),serialized=JSON.stringify(value);if(last!==serialized){host.recordDisclosure(guardId,value);last=serialized;}};
 async function guard(){await control.authorizeContext(host.signal,host.getModel());for(const proof of proofs.values())await control.check(proof,host.signal,host.getModel());record();}
 host.addDisclosureGuard(guard,guardId);
 async function history(messages,project=false){
  const paired=pairs(messages),seen=new Set(paired.map(pair=>pair.result));
  for(const result of messages)if(result.role==='toolResult'&&result.toolName?.startsWith('workspace_enterprise_context_')){
   if(result.details?.authorization||!result.isError){if(result.isError||!seen.has(result)||!names.includes(result.toolName))fail('OSS_PRIVATE_HISTORY_REFUSED');}
   else if(result.details&&(!['blocked','unconfigured','unavailable'].includes(result.details.status)
    ||Object.keys(result.details).some(k=>!['plugin','visibility','canonicalFacts','externalActions','status','reason','providers'].includes(k))
    ||result.details.plugin!=='workspace-enterprise-context-oss'||result.details.visibility!=='internal'||result.details.canonicalFacts!=='Workspace Library'||result.details.externalActions!==false
    ||!/^[A-Z][A-Z0-9_]{0,80}$/.test(result.details.reason||'')
    ||result.details.providers&&(Object.keys(result.details.providers).some(k=>!['mem0','docling'].includes(k))||result.details.providers.mem0!=='disabled'||result.details.providers.docling!=='unconfigured')
    ||result.content?.length!==1||result.content[0].text!==JSON.stringify(result.details)))fail('OSS_PRIVATE_HISTORY_REFUSED');
  }
  for(const {call,result}of paired){if(!names.includes(call.name)||result.isError)continue;
   const candidate=result.details?.authorization,proof=candidate?.kind==='memory'?candidate:proofs.get(key(candidate)),args={...call.arguments};delete args.i;
   const validArgs=proof?.kind==='memory'?call.name==='workspace_enterprise_context_'+proof.operation.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())&&Object.keys(args).sort().join(',')===(proof.operation==='structuredMemoryRemember'?'factKey,statement,subjectId,subjectType':'factKey,subjectId,subjectType')&&Object.entries(proof.query).every(([k,v])=>args[k]===v)&&(proof.operation!=='structuredMemoryRemember'||args.statement===proof.statement):call.name===names[1]?Object.keys(args).length===0:args.artifactId===proof?.source.asset.artifactId&&args.version===proof.source.asset.version&&args.sha256===proof.source.asset.sha256&&Object.keys(args).every(k=>['artifactId','version','sha256'].includes(k));
   if(!proof||!validArgs
    ||result.content?.length!==1||result.content[0].type!=='text'||result.content[0].text!==JSON.stringify(result.details))fail('OSS_PRIVATE_HISTORY_REFUSED');
   await control.verifyBody(proof,result.details);await control.check(proof,host.signal,host.getModel());
   if(proof.kind==='memory'){const fresh=project?await control.refresh(proof,host.signal,host.getModel()):null;addProof(fresh?.authorization||proof);if(fresh){result.details=fresh;result.content=[{type:'text',text:JSON.stringify(fresh)}];}}
  }
 }
 await history(host.history);
 const register=tool=>pi.registerTool({...tool,async execute(...args){await host.authorize();const result=await tool.execute(...args);
  const proof=result.details?.authorization;if(proof&&!result.isError){await control.check(proof,host.signal,host.getModel());addProof(proof);record();}
  await host.authorize();return result;
 }});
 factory({client:control,enabledMethods:host.medusaEnterprise?['status','parseUpload']:['status','memorySearch','memoryAdd','memoryHistory','parseUpload',...(binding.memoryMethods||[])],authorize:async(signal,model)=>{await control.authorizeContext(signal,model);return true;}})({registerTool:register});
 pi.on('context',async event=>{await history(event.messages,true);await guard();});
}
