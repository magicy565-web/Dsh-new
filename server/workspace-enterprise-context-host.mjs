// Existing Node Host owns every identity, Library grant, source and Artifact.
// This adapter adds no grant registry, account, service or persistence ledger.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createEnterpriseContextClient,createDoclingSourceReader} from '../plugins/workspace-enterprise-context/src/oss.mjs';
import {libraryReadHash as hash,normalizeLibraryRecipient,libraryRecipientForModel} from './library-model-read-contract.mjs';
import {looksLikeCredential} from './security.mjs';
import {assertNoKnownCredentialEcho} from '../plugins/workspace-enterprise-context/src/credential-echo.mjs';
const brands=new WeakSet(),fail=code=>{throw Object.assign(Error(code),{code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixed={plugin:'workspace-enterprise-context-oss',visibility:'internal',canonicalFacts:'Workspace Library',externalActions:false};
const assetOf=input=>({artifactId:input.artifactId,version:input.version,sha256:input.sha256});
export function assertEnterpriseContextHost(value){if(!brands.has(value))fail('OSS_ORIGINAL_HOST_REQUIRED');}
export async function createEnterpriseContextSessionBinding({identity,access,instanceId,sessionClient,libraryModelRead,artifacts,store,
  recipient:rawRecipient,selection,connection={},clock=Date.now}={}){
 if(access?.mode!=='enterprise'||!identity?.sessionId||!sessionClient?.readOnlySession||!instanceId)fail('OSS_ORIGINAL_HOST_REQUIRED');
 if(selection?.enabled!==true||selection.reviewed!==true||typeof selection.customerId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(selection.customerId)
  ||Object.keys(selection).some(key=>!['enabled','reviewed','customerId','sources'].includes(key))||!Array.isArray(selection.sources)||!selection.sources.length||selection.sources.length>8)fail('OSS_ORIGINAL_SELECTION_REQUIRED');
 const selected=structuredClone(selection),recipient=normalizeLibraryRecipient(rawRecipient),recipientHash=hash(recipient);
 async function current(model,signal){
  signal?.throwIfAborted();if(hash(libraryRecipientForModel(model))!==recipientHash)fail('OSS_MODEL_RECEIVER_CHANGED');
  let actor;try{actor=await sessionClient.bindingIdentity(signal);}catch{fail('OSS_SESSION_REVOKED');}
  const live=access.nativeSessionById(identity.sessionId);
  if(!live||live.subject!==identity.subject||live.workspaceId!==identity.workspaceId||live.role!==identity.role||!['admin','operator'].includes(live.role)
   ||actor.instanceId!==instanceId||actor.workspaceId!==live.workspaceId||actor.subject!==live.subject||actor.role!==live.role)fail('OSS_SESSION_REVOKED');
  signal?.throwIfAborted();
 }
 const model={provider:recipient.provider,id:recipient.model,baseUrl:recipient.destination};await current(model);
 function sourceFor(asset,signal){
  const pin=selected.sources.find(pin=>hash(pin.asset)===hash(asset));if(!pin)fail('OSS_CUSTOMER_SOURCE_NOT_SELECTED');
  const original=libraryModelRead.factoryDocumentForSession({identity,recipientHash,asset,signal});
  if(original.documentId!==pin.documentId)fail('OSS_CUSTOMER_SOURCE_NOT_SELECTED');
  const file=store.read().artifacts.find(row=>row.id===asset.artifactId),version=file?.versions.find(row=>row.version===asset.version);
  if(version?.sha256!==asset.sha256||file.metadata?.businessLibrary?.visibility!=='internal')fail('OSS_SOURCE_VERSION_CHANGED');
  return original;
 }
 let authority;try{authority=sourceFor(selected.sources[0].asset);}catch(error){
  if(error.code!=='FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED')throw error;
 }
 const docling=connection.reviewed===true&&connection.baseURL&&connection.apiKey?createDoclingSourceReader(connection):null;
 const scopeHash=hash({instanceId,sessionId:identity.sessionId,workspaceId:identity.workspaceId,subject:identity.subject,selection:selected,recipient,
  libraryScope:authority?.authorization.scopeFingerprint||'unconfigured',doclingOrigin:docling?new URL(connection.baseURL).origin:null});
 const binding={scopeHash,describe:()=>({scopeHash,configured:Boolean(docling&&authority)}),open(nativeSessionId){
  if(typeof nativeSessionId!=='string'||!nativeSessionId)fail('OSS_NATIVE_SESSION_REQUIRED');
  const observed=new Map();let conversions=0;
  const key=proof=>hash(proof);
  async function sourceCurrent(asset,signal,receiver,{bytes=false}={}){
   await current(receiver,signal);const grant=sourceFor(asset,signal);
   if(grant.authorization.scopeFingerprint!==authority?.authorization.scopeFingerprint)fail('OSS_LIBRARY_SCOPE_CHANGED');
   if(bytes){const file=await artifacts.download(asset.artifactId,{version:asset.version});
    if(file.version.sha256!==asset.sha256||digest(file.bytes)!==asset.sha256)fail('OSS_SOURCE_VERSION_CHANGED');
    await current(receiver,signal);sourceFor(asset,signal);
   }return grant;
  }
  const client=createEnterpriseContextClient({scope:{enabled:true,reviewed:true,workspaceId:identity.workspaceId,subject:identity.subject,role:identity.role,
   expiresAt:authority?.authorization.expiresAt||new Date(clock()+60000).toISOString(),customerIds:[selected.customerId],uploads:selected.sources.map(row=>row.asset),memoryIds:[],sourceRefs:[]},
   authorize:async({model,signal,target})=>{await current(model,signal);if(target)await sourceCurrent(assetOf(target),signal,model);return true;},
   assertUploadCurrent:async({model,signal,...target})=>{await sourceCurrent(assetOf(target),signal,model);return true;},artifacts,doclingReader:docling,clock});
  // Only Node mints this evidence after inspecting the complete response/body.
  // Bind every receipt field and the current credential; a version/flag or a
  // copied attestation cannot upgrade an unscreened legacy compacted receipt.
  function screeningMac(proof){
   const {credentialScreening,...payload}=proof;
   return createHmac('sha256',connection.apiKey).update('workspace-docling-credential-screen-v1\0'+hash(payload)).digest('hex');
  }
  function assertScreened(proof){
   if(proof.kind!=='parse')return;
   const evidence=proof.credentialScreening;
   if(typeof connection.apiKey!=='string'||!connection.apiKey||evidence?.policy!=='known-docling-credential-v1'
    ||!/^[a-f0-9]{64}$/.test(evidence.mac||'')
    ||!timingSafeEqual(Buffer.from(evidence.mac,'hex'),Buffer.from(screeningMac(proof),'hex')))fail('OSS_PRIVATE_CREDENTIAL_SCREEN_REQUIRED');
  }
  function remember(body,kind='parse'){
   assertNoKnownCredentialEcho(body,[connection.apiKey]);
   const sources=kind==='status'?body.sources:[body.source];
   const proof={kind,source:body.source,sources:structuredClone(sources),bodyHash:hash(body),scopeHash,nativeSessionId};
   if(kind==='parse')proof.credentialScreening={policy:'known-docling-credential-v1',mac:screeningMac(proof)};
   if(!observed.has(key(proof))&&observed.size>=8)fail('OSS_PRIVATE_RECEIPT_LIMIT');
   observed.set(key(proof),proof);return {...body,authorization:proof};
  }
  function proofSources(proof){
   // Source compatibility never confers credential-screening evidence.
   // Unscreened old parse receipts are independently refused by assertScreened.
   const sources=proof.sources??(proof.kind==='parse'?[proof.source]:null);
   if(!Array.isArray(sources)||!sources.length||sources.length>8||hash(sources[0])!==hash(proof.source)
    ||proof.kind==='parse'&&sources.length!==1)fail('OSS_PRIVATE_RECEIPT_REFUSED');
   if(proof.kind==='status'&&hash(sources.map(source=>({documentId:source.documentId,asset:source.asset})))
     !==hash(selected.sources.map(source=>({documentId:source.documentId,asset:source.asset}))))fail('OSS_PRIVATE_RECEIPT_REFUSED');
   return sources;
  }
  const control={async authorizeContext(signal,receiver){await current(receiver,signal);if(authority)for(const pin of selected.sources)await sourceCurrent(pin.asset,signal,receiver);},
   async status(_input,signal,receiver){
    await current(receiver,signal);
    if(!authority)return {...fixed,status:'unconfigured',reason:'ORIGINAL_LIBRARY_SELECTION_REQUIRED',providers:{mem0:'disabled',docling:'unconfigured'}};
    const sources=[];for(const pin of selected.sources){const grant=await sourceCurrent(pin.asset,signal,receiver);sources.push({documentId:grant.documentId,revision:grant.revision,documentVersion:grant.documentVersion,asset:pin.asset});}
    return remember({...await client.status({},signal,receiver),...fixed,source:sources[0],customerId:selected.customerId,sources,providers:{mem0:'disabled',docling:docling?'configured_unverified':'unconfigured',erpnext:'workspace-free-trade'}},'status');
   },
   ...Object.fromEntries(['memorySearch','memoryAdd','memoryHistory'].map(method=>[method,async()=>({...fixed,status:'blocked',reason:'OSS_MEM0_DISABLED'})])),
   async parseUpload(input,signal,receiver){
    await current(receiver,signal);
    if(!authority||!docling)return {...fixed,status:'unconfigured',reason:!authority?'ORIGINAL_LIBRARY_SELECTION_REQUIRED':'DOCLING_SAFE_CONNECTION_REQUIRED'};
    if(++conversions>4)fail('OSS_PARSE_REQUEST_LIMIT');
    const asset=assetOf(input),source=await sourceCurrent(asset,signal,receiver);
    const parsed=await client.parseUpload(asset,signal,receiver);
    assertNoKnownCredentialEcho(parsed,[connection.apiKey]);
    await sourceCurrent(asset,signal,receiver,{bytes:true});
    if(Buffer.byteLength(parsed.text)>48*1024||looksLikeCredential(parsed.text))fail('OSS_PARSE_OUTPUT_REFUSED');
    return remember({...parsed,...fixed,customerId:selected.customerId,source:{documentId:source.documentId,revision:source.revision,documentVersion:source.documentVersion,asset}});
   },
   verifyBody(proof,receipt){const {authorization,...body}=receipt||{};
    assertNoKnownCredentialEcho(body,[connection.apiKey]);
    const sources=proofSources(proof),disclosed=proof.kind==='status'?body.sources:[body.source];
    if(hash(authorization)!==hash(proof)||hash(body)!==proof.bodyHash||hash(disclosed)!==hash(sources)
     ||hash(body.source)!==hash(proof.source))fail('OSS_PRIVATE_CACHED_BODY_CHANGED');
   },
   async check(proof,signal,receiver){
    if(proof?.scopeHash!==scopeHash||proof.nativeSessionId!==nativeSessionId||!['parse','status'].includes(proof.kind)||!/^[a-f0-9]{64}$/.test(proof.bodyHash||''))fail('OSS_PRIVATE_RECEIPT_REFUSED');
    assertScreened(proof);
    for(const pin of proofSources(proof)){
     const source=await sourceCurrent(pin?.asset,signal,receiver,{bytes:true});
     if(hash({documentId:source.documentId,revision:source.revision,documentVersion:source.documentVersion,asset:pin.asset})!==hash(pin))fail('OSS_SOURCE_VERSION_CHANGED');
    }
    if(!observed.has(key(proof))&&observed.size>=8)fail('OSS_PRIVATE_RECEIPT_LIMIT');observed.set(key(proof),proof);
   },
   async finalCheck(signal,receiver){await control.authorizeContext(signal,receiver);for(const proof of observed.values())await control.check(proof,signal,receiver);},
  };return Object.freeze(control);
 }};brands.add(binding);return Object.freeze(binding);
}
export function enterpriseContextHostFromRpc(descriptor,request){
 if(!/^[a-f0-9]{64}$/.test(descriptor?.scopeHash||'')||typeof request!=='function')fail('OSS_ORIGINAL_HOST_REQUIRED');
 const binding={scopeHash:descriptor.scopeHash,open(nativeSessionId){const call=(method,args,signal)=>request('enterpriseContext',[nativeSessionId,method,args],signal);
  return {...Object.fromEntries(['status','memorySearch','memoryAdd','memoryHistory','parseUpload'].map(method=>[method,(input,signal,model)=>call(method,[input,model],signal)])),
   authorizeContext:(signal,model)=>call('authorizeContext',[model],signal),check:(proof,signal,model)=>call('check',[proof,model],signal),verifyBody:(proof,receipt)=>call('verifyBody',[proof,receipt])};
 }};brands.add(binding);return Object.freeze(binding);
}
