// Optional projection on the original Library model policy and native Session.
// No grant store, credential discovery, Agent loop or alternate product authority.
import {isDeepStrictEqual} from 'node:util';
import {libraryReadHash,libraryRecipientForModel} from './library-model-read-contract.mjs';
import {looksLikeCredential} from './security.mjs';
import {ApiError} from './runtime.mjs';
import {isMedusaGapReceipt} from './workspace-omp-business-journal.mjs';
const fail=()=>{throw new ApiError(403,'MEDUSA_SOURCE_CHANGED','The exact native product/model disclosure is not currently authorized.');};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(key=>keys.includes(key));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
export function validateNativeMedusaPolicy(value){
  if(value===undefined)return;
  if(!exact(value,['enabled','reviewed','sourceId','baseURL','allowLoopbackHTTP','timeoutMs','products','fields'])||typeof value.enabled!=='boolean')fail();
  if(!value.enabled){if(Object.keys(value).length!==1)fail();return;}
  if(value.reviewed!==true||!uuid(value.sourceId)||!Array.isArray(value.products)||!value.products.length||value.products.length>8
    ||new Set(value.products.map(pin=>pin?.productId)).size!==value.products.length
    ||value.products.some(pin=>!exact(pin,['productId','reviewVersion','sourceHash'])||typeof pin.productId!=='string'||!/^prod_[A-Za-z0-9_-]{1,123}$/u.test(pin.productId)
      ||!Number.isSafeInteger(pin.reviewVersion)||pin.reviewVersion<1||pin.reviewVersion>2147483647||typeof pin.sourceHash!=='string'||!/^(?:[a-f0-9]{64}|rev:[a-f0-9]{32}:[a-f0-9]{64})$/u.test(pin.sourceHash))
    ||!Array.isArray(value.fields)||!value.fields.length||new Set(value.fields).size!==value.fields.length||value.fields.some(field=>!['title','description','agent_summary'].includes(field))
    ||value.allowLoopbackHTTP!==undefined&&typeof value.allowLoopbackHTTP!=='boolean'
    ||value.timeoutMs!==undefined&&(!Number.isInteger(value.timeoutMs)||value.timeoutMs<50||value.timeoutMs>10000))fail();
  let url;try{url=new URL(value.baseURL);}catch{fail();}
  if(url.href!==url.origin+'/'||url.username||url.password||url.protocol!=='https:'&&!(value.allowLoopbackHTTP===true&&url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname)))fail();
}

// Called only on explicit startup opt-in; Space/admin files are not a fallback.
export async function loadNativeMedusaModelConnection(policy,environment={}){
  validateNativeMedusaPolicy(policy?.nativeMedusa);
  const selected=policy?.nativeMedusa,filename=environment.WORKSPACE_MEDUSA_MODEL_READ_TOKEN_FILE;
  if(!selected?.enabled){if(filename!==undefined)fail();return null;}
  if(policy.enabled!==true||policy.reviewed!==true)fail();
  const [{default:path},{openPrivateFile},{stat}]=await Promise.all([import('node:path'),import('./store.mjs'),import('node:fs/promises')]);
  if(typeof filename!=='string'||!path.isAbsolute(filename)||filename===environment.WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE)fail();
  let file;
  try{
    file=await openPrivateFile(filename);const info=await file.stat();
    if(info.size<16||info.size>4096||process.platform!=='win32'&&((info.mode&0o077)!==0||![0,process.getuid()].includes(info.uid)))fail();
    if(environment.WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE){const space=await stat(environment.WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE);if(space.dev===info.dev&&space.ino===info.ino)fail();}
    const bytes=await file.readFile();if(bytes.length>4096)fail();
    const readToken=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(!/^[\x21-\x7e]{16,4096}$/u.test(readToken)||readToken===environment.WORKSPACE_MEDUSA_SECRET_API_KEY)fail();
    return Object.freeze({reviewed:true,sourceId:selected.sourceId,workspaceId:policy.workspaceId,baseURL:selected.baseURL,
      ...(selected.allowLoopbackHTTP===undefined?{}:{allowLoopbackHTTP:selected.allowLoopbackHTTP}),...(selected.timeoutMs===undefined?{}:{timeoutMs:selected.timeoutMs}),readToken});
  }catch{fail();}finally{await file?.close();}
}

export async function createNativeMedusaModelClient({legacy=null,grant,connection,identity,authorize,fetchImpl}={}){
  if(!grant||!connection||typeof authorize!=='function')fail();
  const selected=grant.scope.nativeMedusa;
  if(connection.sourceId!==selected.sourceId||connection.workspaceId!==grant.scope.workspaceId||connection.baseURL!==selected.baseURL)fail();
  const live=signal=>{signal?.throwIfAborted();grant.assertCurrent();};
  const gate=async(signal,model)=>{live(signal);if(libraryReadHash(libraryRecipientForModel(model))!==libraryReadHash(grant.scope.recipient))fail();await authorize(signal,model);live(signal);};
  const {createMedusaModelSource}=await import('../plugins/workspace-medusa-catalog/src/approved-source.mjs');
  const reader=createMedusaModelSource({connection,authorizeOriginal:()=>{grant.assertCurrent();return true;},...(fetchImpl?{fetchImpl}:{})});
  const authorization={scopeFingerprint:grant.scopeHash,workspaceId:identity.workspaceId,subject:identity.subject,recipient:grant.scope.recipient,expiresAt:grant.scope.expiresAt};
  async function context(input,signal,model){
    if(!exact(input,['productId'])||Object.keys(input).length!==1)fail();
    const pin=selected.products.find(pin=>pin.productId===input.productId);if(!pin)fail();
    await gate(signal,model);
    const row=await reader.read(pin.productId,selected.fields,{workspaceId:identity.workspaceId},signal);
    if(row.reference.revision!==pin.reviewVersion||row.reference.sourceHash!==pin.sourceHash||row.reference.sourceId!==selected.sourceId||looksLikeCredential(JSON.stringify(row.fields)))fail();
    live(signal);
    return {plugin:'workspace-medusa-catalog',method:'context',input:{productId:pin.productId},status:'available',sourceHash:pin.sourceHash,
      authorization:structuredClone(authorization),sources:[{...row.reference,projectionSha256:libraryReadHash(row.fields)}],
      view:{product:{id:pin.productId,...row.fields}},contentTrust:'untrusted-private-source',consistency:'remote-point-in-time',publicListing:false,inventoryWritten:false,humanReviewRequired:true};
  }
  async function status(input,signal,model){
    if(!exact(input,[])||Object.keys(input).length)fail();await gate(signal,model);
    const previous=legacy?await legacy.status(input,signal,model):null;live(signal);
    return {plugin:'workspace-medusa-catalog',method:'status',input:{},status:'available',sourceHash:null,authorization:structuredClone(authorization),sources:[],
      view:{...(previous?.view??{}),nativeProducts:{configured:true,products:structuredClone(selected.products),fields:[...selected.fields]}},publicListing:false,inventoryWritten:false,humanReviewRequired:true};
  }
  async function refresh(receipt,model,signal){
    if(receipt?.method==='context')return context(receipt.input,signal,model);
    if(receipt?.method==='status'&&receipt.authorization?.scopeFingerprint===grant.scopeHash)return status(receipt.input,signal,model);
    if(!legacy)fail();return legacy.refresh(receipt,model,signal);
  }
  function nativeReceipts(messages){
    const result=[],calls=new Map(),seen=new Set(),nativeIds=new Set();
    for(const message of messages){
      if(message?.role==='user'||message?.role==='assistant')calls.clear();
      if(message?.role==='assistant')for(const call of message.content||[])if(call.type==='toolCall'){
        if(typeof call.id!=='string'||!call.id||calls.has(call.id)||nativeIds.has(call.id)||call.name==='workspace_medusa_context'&&seen.has(call.id))fail();
        seen.add(call.id);if(call.name==='workspace_medusa_context')nativeIds.add(call.id);calls.set(call.id,call);
      }
      if(message?.role!=='toolResult'||message.toolName!=='workspace_medusa_context'&&!(message.details?.plugin==='workspace-medusa-catalog'&&message.details.method==='context'))continue;
      const call=calls.get(message.toolCallId);calls.delete(message.toolCallId);
      if(!call||call.name!=='workspace_medusa_context'||message.toolName!=='workspace_medusa_context'||message.content?.length!==1||message.content[0].type!=='text')fail();
      let receipt;try{receipt=JSON.parse(message.content[0].text);}catch{fail();}
      if(!isDeepStrictEqual(receipt,message.details))fail();const args={...call.arguments};delete args.i;
      if(receipt.plugin!=='workspace-medusa-catalog')fail();
      if(receipt.method==='context'){if(message.isError||!isDeepStrictEqual(args,receipt.input)||receipt.authorization?.scopeFingerprint!==grant.scopeHash)fail();}
      else if(!message.isError||!isMedusaGapReceipt(receipt))fail();
      result.push({id:call.id,name:call.name,args,receipt,isError:message.isError===true});
    }
    return result;
  }
  function nativePayloadRows(payload){
    const rows=new Map();
    // The SDK may expose the same original entries in both views. Admit exact
    // overlap across views, never duplicate calls within one view or conflicting
    // observations under the same original ID.
    for(const messages of [payload.messages??[],payload.context??[]]){
      if(!Array.isArray(messages))fail();
      for(const row of nativeReceipts(messages)){
        if(rows.has(row.id)&&!isDeepStrictEqual(rows.get(row.id),row))fail();
        rows.set(row.id,row);
      }
    }
    return rows;
  }
  function assertDisclosureCurrent(receipt,signal){
    live(signal);
    if(receipt===null)return;
    if(receipt.method==='context'||receipt.authorization?.scopeFingerprint===grant.scopeHash){
      if(!isDeepStrictEqual(receipt.authorization,authorization))fail();
      if(receipt.method==='context'){
        const pin=selected.products.find(pin=>pin.productId===receipt.input?.productId),source=receipt.sources?.[0],product=receipt.view?.product;
        if(!pin||receipt.sources.length!==1||source.kind!=='medusa-product'||source.id!==pin.productId||source.sourceId!==selected.sourceId||source.revision!==pin.reviewVersion||source.sourceHash!==pin.sourceHash
          ||!product||product.id!==pin.productId||Object.keys(product).length!==selected.fields.length+1||selected.fields.some(field=>typeof product[field]!=='string')
          ||libraryReadHash(Object.fromEntries(selected.fields.map(field=>[field,product[field]])))!==source.projectionSha256)fail();
      }
    }
    else{if(!legacy)fail();legacy.assertDisclosureCurrent(receipt,signal);}
  }
  function assertPayloadCurrent(payload,signal){
    const messages=[...(payload.messages||[]),...(payload.context||[])];
    nativePayloadRows(payload);live(signal);
    for(const message of messages){
      if(message?.role!=='toolResult'||!message.toolName?.startsWith('workspace_medusa_'))continue;
      let receipt;try{receipt=JSON.parse(message.content?.[0]?.text);}catch{if(message.isError&&message.details===undefined)continue;fail();}
      if(receipt.method){if(!isDeepStrictEqual(receipt,message.details))fail();assertDisclosureCurrent(receipt,signal);}
    }
  }
  async function authorizeDisclosure(payload,model,signal){
    await gate(signal,model);
    const rows=nativePayloadRows(payload);
    for(const {receipt} of rows.values())if(receipt.method==='context'&&!isDeepStrictEqual(await context(receipt.input,signal,model),receipt))fail();
    if(payload.wireBody!==undefined){
      let wire;try{wire=JSON.parse(payload.wireBody);}catch{fail();}if(!Array.isArray(wire.messages))fail();
      const calls=new Map(),seen=new Set(),nativeIds=new Set();
      for(const message of wire.messages){
        if(message.role==='assistant')for(const call of message.tool_calls||[]){
          if(typeof call.id!=='string'||!call.id||calls.has(call.id)||nativeIds.has(call.id))fail();
          let args;try{args=JSON.parse(call.function.arguments);}catch{fail();}delete args.i;
          if(call.function.name==='workspace_medusa_context'){
            const original=rows.get(call.id);
            if(seen.has(call.id)||!original||original.name!==call.function.name||!isDeepStrictEqual(original.args,args))fail();
            nativeIds.add(call.id);
          }
          seen.add(call.id);calls.set(call.id,{name:call.function.name,args});
        }
        if(message.role!=='tool')continue;
        const call=calls.get(message.tool_call_id);calls.delete(message.tool_call_id);let receipt;try{receipt=JSON.parse(message.content);}catch{if(call?.name==='workspace_medusa_context')fail();continue;}
        if(call?.name==='workspace_medusa_context'||rows.has(message.tool_call_id)||receipt?.plugin==='workspace-medusa-catalog'&&receipt.method==='context'){
          const original=rows.get(message.tool_call_id);
          if(call?.name!=='workspace_medusa_context'||!original||original.name!==call.name||!isDeepStrictEqual(original.args,call.args)||!isDeepStrictEqual(original.receipt,receipt))fail();
        }
      }
      if([...calls.values()].some(call=>call.name==='workspace_medusa_context'))fail();
    }
    assertPayloadCurrent(payload,signal);
  }
  return Object.freeze({nativeScopeHash:grant.scopeHash,status,context,refresh,assertDisclosureCurrent,assertPayloadCurrent,authorizeDisclosure,
    ...Object.fromEntries(['preview','reconcile'].map(method=>[method,async(...args)=>{if(!legacy)fail();live(args[1]);const value=await legacy[method](...args);live(args[1]);return value;}]))});
}
