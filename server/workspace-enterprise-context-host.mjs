// Existing Node Host owns every identity, Library grant, source and Artifact.
// This adapter adds no grant registry, account, service or persistence ledger.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createEnterpriseContextClient,createDoclingSourceReader} from '../plugins/workspace-enterprise-context/src/oss.mjs';
import {libraryReadHash as hash,normalizeLibraryRecipient,libraryRecipientForModel} from './library-model-read-contract.mjs';
import {looksLikeCredential} from './security.mjs';
import {assertNoKnownCredentialEcho} from '../plugins/workspace-enterprise-context/src/credential-echo.mjs';
import {createNativeDocumentTools} from './workspace-native-document-tools.mjs';
const brands=new WeakSet(),factReaderBrands=new WeakSet(),factViewBrands=new WeakSet(),fail=code=>{throw Object.assign(Error(code),{code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixed={plugin:'workspace-enterprise-context-oss',visibility:'internal',canonicalFacts:'Workspace Library',externalActions:false};
const assetOf=input=>({artifactId:input.artifactId,version:input.version,sha256:input.sha256});
export function assertEnterpriseContextHost(value){if(!brands.has(value))fail('OSS_ORIGINAL_HOST_REQUIRED');}
export function assertEnterpriseMemoryFactReader(value){if(!factReaderBrands.has(value))fail('OSS_ORIGINAL_MEMORY_READER_REQUIRED');}
export function assertEnterpriseMemoryFactView(value){if(!factViewBrands.has(value))fail('OSS_ORIGINAL_MEMORY_VIEW_REQUIRED');}
export async function createEnterpriseContextSessionBinding({identity,access,instanceId,sessionClient,libraryModelRead,artifacts,store,
  recipient:rawRecipient,selection,connection={},authorizeParserTransfer,memoryLedger=null,turnContext=null,clock=Date.now}={}){
 if(access?.mode!=='enterprise'||!identity?.sessionId||!sessionClient?.readOnlySession||!instanceId)fail('OSS_ORIGINAL_HOST_REQUIRED');
 if(selection?.enabled!==true||selection.reviewed!==true||typeof selection.customerId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(selection.customerId)
  ||Object.keys(selection).some(key=>!['enabled','reviewed','customerId','sources','allowMemoryRead','allowMemoryWrite'].includes(key))||['allowMemoryRead','allowMemoryWrite'].some(k=>selection[k]!==undefined&&typeof selection[k]!=='boolean')||!Array.isArray(selection.sources)||!selection.sources.length||selection.sources.length>8)fail('OSS_ORIGINAL_SELECTION_REQUIRED');
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
 function sourceFor(asset,signal,state=store.read()){
  const pin=selected.sources.find(pin=>hash(pin.asset)===hash(asset));if(!pin)fail('OSS_CUSTOMER_SOURCE_NOT_SELECTED');
  const original=libraryModelRead.factoryDocumentForSession({identity,recipientHash,asset,signal});
  if(original.documentId!==pin.documentId)fail('OSS_CUSTOMER_SOURCE_NOT_SELECTED');
  const file=state.artifacts.find(row=>row.id===asset.artifactId),version=file?.versions.find(row=>row.version===asset.version);
  if(version?.sha256!==asset.sha256||file.metadata?.businessLibrary?.visibility!=='internal')fail('OSS_SOURCE_VERSION_CHANGED');
  return original;
 }
 let authority;try{authority=sourceFor(selected.sources[0].asset);}catch(error){
  if(error.code!=='FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED')throw error;
 }
 // Pin the actual transport configuration once; caller mutation cannot redirect
 // a reader or change the screening key midway through this binding.
 connection=Object.freeze({...connection});
 const parserPurpose='document-extraction',parserTransfer='complete-file';
 const docling=connection.reviewed===true&&connection.baseURL&&connection.apiKey?createDoclingSourceReader(connection):null;
 const parserRecipient=docling?Object.freeze({kind:'docling',destination:new URL('/v1/convert/file',connection.baseURL).href}):null;
 const scopeHash=hash({instanceId,sessionId:identity.sessionId,workspaceId:identity.workspaceId,subject:identity.subject,selection:selected,recipient,
  libraryScope:authority?.authorization.scopeFingerprint||'unconfigured',doclingOrigin:docling?new URL(connection.baseURL).origin:null,parserRecipient,parserPurpose,parserTransfer});
 const actor={subject:identity.subject,role:identity.role,workspaceId:identity.workspaceId};
 const memoryMethods=memoryLedger&&docling&&authority?['structuredMemoryLookup','structuredMemoryRemember'].filter(method=>selected[method==='structuredMemoryLookup'?'allowMemoryRead':'allowMemoryWrite']===true):[];
  function safe(value){assertNoKnownCredentialEcho(value,[connection.apiKey]);if(looksLikeCredential(JSON.stringify(value)))fail('OSS_CACHED_CONTEXT_CREDENTIAL');}
  function memoryMac(value){return createHmac('sha256',connection.apiKey).update('enterprise-private-screen-v1\0'+hash(value)).digest('hex');}
  function sealMemory(value){safe(value);return {policy:'known-docling-credential-v1',mac:memoryMac(value)};}
  function checkMemory(memory,state=store.read()){
   const row=memoryLedger.revalidateSnapshot(memory,{actor,state});
   const {credentialScreening,...source}=memory.source;
   const scope=Object.fromEntries(['workspaceId','audience','customerId','subjectType','subjectId','factKey'].map(k=>[k,memory[k]]));
   const value={statement:memory.statement,source,scope};
   if(credentialScreening?.policy!=='known-docling-credential-v1'||!/^[a-f0-9]{64}$/.test(credentialScreening.mac||'')
    ||!timingSafeEqual(Buffer.from(credentialScreening.mac,'hex'),Buffer.from(memoryMac(value),'hex')))fail('OSS_PRIVATE_CREDENTIAL_SCREEN_REQUIRED');
   safe(memory);
   const expected=selected.sources.map(pin=>({kind:'document',ref:pin.documentId,revision:sourceFor(pin.asset,undefined,state).revision,version:sourceFor(pin.asset,undefined,state).documentVersion,sha256:pin.asset.sha256,artifactId:pin.asset.artifactId,artifactVersion:pin.asset.version}));
   if(hash(memory.source.dependencies)!==hash(expected))fail('OSS_MEMORY_SOURCE_REVOKED');
   return row;
  }
  function queryOf(input){
   if(!input||['subjectType','subjectId','factKey'].some(k=>typeof input[k]!=='string'||!/^[A-Za-z0-9._@:+|/-]{1,128}$/.test(input[k])))fail('OSS_STRUCTURED_MEMORY_INPUT_INVALID');
   return Object.fromEntries(['subjectType','subjectId','factKey'].map(k=>[k,input[k]]));
  }
  function factQueries(queries){
   if(!Array.isArray(queries)||!queries.length||queries.length>8)fail('OSS_MEMORY_FACT_SELECTION_REQUIRED');
   const exact=queries.map(input=>{
    if(!input||Object.keys(input).sort().join(',')!=='factKey,subjectId,subjectType')fail('OSS_MEMORY_FACT_SELECTION_REQUIRED');
    return queryOf(input);
   });
   if(new Set(exact.map(hash)).size!==exact.length)fail('OSS_MEMORY_FACT_SELECTION_REQUIRED');
   return exact;
  }
  function projectMemory(memory){
   if(!memory)return null;
   const {credentialScreening,...source}=memory.source;
   return {id:memory.id,revision:memory.revision,subjectType:memory.subjectType,subjectId:memory.subjectId,factKey:memory.factKey,
    statement:memory.statement,source:structuredClone(source),updatedAt:memory.updatedAt,expiresAt:memory.expiresAt};
  }
  function assertSessionSourcesCurrent(receiver,signal){
   signal?.throwIfAborted();
   const live=access.nativeSessionById(identity.sessionId);
   if(!live||live.subject!==identity.subject||live.role!==identity.role||live.workspaceId!==identity.workspaceId||hash(libraryRecipientForModel(receiver))!==recipientHash)fail('OSS_SESSION_REVOKED');
   if(authority)for(const pin of selected.sources){const source=sourceFor(pin.asset,signal);if(source.authorization.scopeFingerprint!==authority.authorization.scopeFingerprint)fail('OSS_LIBRARY_SCOPE_CHANGED');}
  }
  async function sourceCurrent(asset,signal,receiver,{bytes=false}={}){
   await current(receiver,signal);const grant=sourceFor(asset,signal);
   if(grant.authorization.scopeFingerprint!==authority?.authorization.scopeFingerprint)fail('OSS_LIBRARY_SCOPE_CHANGED');
   if(bytes){const file=await artifacts.download(asset.artifactId,{version:asset.version});
    if(file.version.sha256!==asset.sha256||digest(file.bytes)!==asset.sha256)fail('OSS_SOURCE_VERSION_CHANGED');
    await current(receiver,signal);sourceFor(asset,signal);
   }return grant;
  }
 const binding={scopeHash,memoryMethods,describe:()=>({scopeHash,configured:Boolean(docling&&authority),memoryMethods}),
  // Human GET projection only: no Run fabrication, parser, write method or
  // model-reader brand. The original execution control below is unchanged.
  conversationFacts(nativeSessionId,{conversationId,bindingFingerprint},queries){
   if(!memoryMethods.includes('structuredMemoryLookup'))fail('OSS_STRUCTURED_MEMORY_NOT_AUTHORIZED');
   const exact=factQueries(queries),readerScope=hash({scopeHash,nativeSessionId,queries:exact}),snapshots=new Map();
   const mappingHash=hash(store.read().conversations.find(row=>row.id===conversationId)?.businessAgentSession||null);
   const selectedQuery=input=>{const query=queryOf(input);if(!exact.some(row=>hash(row)===hash(query)))fail('OSS_MEMORY_FACT_NOT_SELECTED');return query;};
   function viewCurrent(receiver,signal,state=store.read()){
    assertSessionSourcesCurrent(receiver,signal);
    const conversation=state.conversations.find(row=>row.id===conversationId),saved=conversation?.businessAgentSession;
    if(!conversation||conversation.workspaceId!==identity.workspaceId||conversation.businessAgentOwner?.subject!==identity.subject
     ||conversation.businessAgentOwner?.workspaceId!==identity.workspaceId||saved?.agentSessionId!==nativeSessionId
     ||saved.engineScope!=='omp:18.10.4:business-v1'||saved.recipientFingerprint!==recipientHash
     ||!/^[a-f0-9]{64}$/.test(bindingFingerprint||'')||saved.bindingFingerprint!==bindingFingerprint
     ||saved.brainMemoryFactsScopeHash!==readerScope||hash(saved)!==mappingHash)fail('OSS_ORIGINAL_CONVERSATION_CHANGED');
   }
   function observedCurrent(state=store.read()){
    for(const [key,memory]of snapshots){
     if(memory){const row=checkMemory(memory,state);if(row.status!=='active'||hash(row)!==hash(memory))fail('OSS_MEMORY_FACT_CHANGED');}
     else {const query=exact.find(row=>hash(row)===key);if(state.businessLibrary.enterpriseMemories.some(row=>row.workspaceId===identity.workspaceId&&row.status==='active'&&row.audience==='internal'&&Object.entries(query).every(([k,v])=>row[k]===v)))fail('OSS_MEMORY_FACT_CHANGED');}
    }
   }
   const reader={scopeHash:readerScope,queries:()=>structuredClone(exact),
    assertBinding(value,signal){
     if(value?.uiRead!==true||value.runId!==null||value.canSubmit!==false||value.uiWrite!==false
      ||value.nativeSessionId!==nativeSessionId||value.conversationId!==conversationId
      ||['sessionId','subject','workspaceId','role'].some(key=>value.identity?.[key]!==identity[key]))fail('OSS_ORIGINAL_MEMORY_VIEW_REQUIRED');
     viewCurrent(value.receiver,signal);observedCurrent();return true;
    },
    async lookup(input,signal,receiver){
     const query=selectedQuery(input);viewCurrent(receiver,signal);await current(receiver,signal);viewCurrent(receiver,signal);
     const result=await memoryLedger.lookup({audience:'internal',...query},{actor,signal});
     for(const pin of selected.sources)await sourceCurrent(pin.asset,signal,receiver,{bytes:true});
     viewCurrent(receiver,signal);
     snapshots.set(hash(query),result.found?structuredClone(result.memory):null);observedCurrent();
     if(!result.found)return {found:false};
     return {found:true,memory:projectMemory(result.memory)};
    },
    current(input,expected,{state=store.read(),receiver,signal}={}){
     const query=selectedQuery(input),memory=snapshots.get(hash(query));viewCurrent(receiver,signal,state);
     if(!memory||hash(projectMemory(memory))!==hash(expected))fail('OSS_MEMORY_FACT_CHANGED');
     const row=checkMemory(memory,state);if(row.status!=='active'||hash(row)!==hash(memory))fail('OSS_MEMORY_FACT_CHANGED');
     return projectMemory(memory);
    },
   };viewCurrent(model);factViewBrands.add(reader);return Object.freeze(reader);
  },open(nativeSessionId,turn=turnContext){
  if(typeof nativeSessionId!=='string'||!nativeSessionId)fail('OSS_NATIVE_SESSION_REQUIRED');
  const observed=new Map();let conversions=0;
  const key=proof=>hash(proof);
  function turnCurrent(state=store.read()){
   const run=state.runs.find(row=>row.id===turn?.runId),conversation=state.conversations.find(row=>row.id===turn?.conversationId);
   if(!turn||run?.status!=='running'||run.conversationId!==conversation?.id||conversation.activeRunId!==run.id
    ||run.requestId!==turn.requestId||run.businessAgentContext?.sessionId!==identity.sessionId
    ||run.businessAgentContext?.role!==identity.role||conversation.businessAgentOwner?.subject!==identity.subject||conversation.businessAgentOwner?.workspaceId!==identity.workspaceId
    ||run.businessAgentContext?.subject!==identity.subject||run.businessAgentContext?.workspaceId!==identity.workspaceId)fail('OSS_ORIGINAL_RUN_CHANGED');
  }
  function memoryProofMac(proof){const {credentialScreening,...payload}=proof;return createHmac('sha256',connection.apiKey).update('workspace-structured-memory-screen-v1\0'+hash(payload)).digest('hex');}
  function checkMemoryProof(proof){
   if(!memoryMethods.length||proof.scopeHash!==scopeHash||proof.nativeSessionId!==nativeSessionId||!['structuredMemoryLookup','structuredMemoryRemember'].includes(proof.operation))fail('OSS_PRIVATE_RECEIPT_REFUSED');
   queryOf(proof.query);
   if(proof.credentialScreening?.policy!=='known-docling-credential-v1'||!/^[a-f0-9]{64}$/.test(proof.credentialScreening.mac||'')
    ||!timingSafeEqual(Buffer.from(proof.credentialScreening.mac,'hex'),Buffer.from(memoryProofMac(proof),'hex')))fail('OSS_PRIVATE_CREDENTIAL_SCREEN_REQUIRED');
   if(proof.memory){if(Object.entries(proof.query).some(([k,v])=>proof.memory[k]!==v))fail('OSS_PRIVATE_RECEIPT_REFUSED');checkMemory(proof.memory);}
  }
  // Historical receipts may be superseded while an explicit tool projection
  // refreshes. A summary has no toolResult to refresh: its persisted obligation
  // must still be the current fact (including an observed absence) at dispatch.
  function assertCurrentMemoryProof(proof,state=store.read()){
   if(proof?.kind!=='memory')fail('OSS_PRIVATE_RECEIPT_REFUSED');checkMemoryProof(proof);
   if(proof.memory){const row=checkMemory(proof.memory,state);if(row.status!=='active'||hash(row)!==hash(proof.memory))fail('OSS_CACHE_RECEIPT_CHANGED');}
   else if(state.businessLibrary.enterpriseMemories.some(row=>row.workspaceId===identity.workspaceId&&row.status==='active'&&row.audience==='internal'&&Object.entries(proof.query).every(([k,v])=>row[k]===v)))fail('OSS_CACHE_RECEIPT_CHANGED');
  }
  function observe(proof){
   if(proof.kind==='memory')for(const [id,old]of observed)if(id!==key(proof)&&old.kind==='memory'&&hash(old.query)===hash(proof.query))observed.delete(id);
   if(!observed.has(key(proof))&&observed.size>=8)fail('OSS_PRIVATE_RECEIPT_LIMIT');observed.set(key(proof),proof);
  }
  function mintMemory(result,query,operation,statement){
   safe(result);if(result.memory)checkMemory(result.memory);
   const body={...result,...fixed,operation,memoryQuery:query};
   const sources=selected.sources.map(pin=>{const source=sourceFor(pin.asset);return {documentId:source.documentId,revision:source.revision,documentVersion:source.documentVersion,asset:pin.asset};});
   const proof={kind:'memory',operation,query,...(statement===undefined?{}:{statement}),memory:result.memory||null,source:sources[0],sources,bodyHash:hash(body),scopeHash,nativeSessionId};
   proof.credentialScreening={policy:'known-docling-credential-v1',mac:memoryProofMac(proof)};observe(proof);return {...body,authorization:proof};
  }
  // Selective reuse of checkParserGrant/verify semantics from PR87
  // b7bd2410a623a9d7ec654a0a826ac3778cae64c3:
  // server/enterprise-context-original-authority.mjs. Session/Run/Library
  // checks remain in this original Host + its existing bridge, not a second
  // authority. Model-field disclosure alone never authorizes a full upload.
  async function checkParserGrant(action,asset,signal,model){
   const source=await sourceCurrent(asset,signal,model);
   if(!parserRecipient||typeof authorizeParserTransfer!=='function')fail('OSS_DOCLING_TRANSFER_NOT_APPROVED');
   const stop=AbortSignal.timeout(connection.timeoutMs??15000),grantSignal=signal?AbortSignal.any([signal,stop]):stop;
   let cancel;
   try{
    const aborted=new Promise((_,reject)=>{cancel=()=>reject(Error('DOCLING_GRANT_ABORTED'));grantSignal.addEventListener('abort',cancel,{once:true});if(grantSignal.aborted)cancel();});
    const granted=await Promise.race([aborted,Promise.resolve().then(()=>{
     grantSignal.throwIfAborted();
     return authorizeParserTransfer({action,workspaceId:identity.workspaceId,subject:identity.subject,sessionId:identity.sessionId,nativeSessionId,
      model:structuredClone(model),target:{...asset},documentId:source.documentId,documentRevision:source.revision,documentVersion:source.documentVersion,
      recipient:{...parserRecipient},purpose:parserPurpose,transfer:parserTransfer,signal:grantSignal});
    })]);
    grantSignal.throwIfAborted();if(granted!==true)fail('OSS_DOCLING_TRANSFER_NOT_APPROVED');
   }catch{
    if(signal?.aborted)fail('DOCLING_CANCELLED');if(stop.aborted)fail('DOCLING_TIMEOUT');fail('OSS_DOCLING_TRANSFER_NOT_APPROVED');
   }finally{grantSignal.removeEventListener('abort',cancel);}
   // Consent may await the original Host: recheck live Session/source after it.
   await sourceCurrent(asset,signal,model);
   return true;
  }
  const client=createEnterpriseContextClient({scope:{enabled:true,reviewed:true,workspaceId:identity.workspaceId,subject:identity.subject,role:identity.role,
   expiresAt:authority?.authorization.expiresAt||new Date(clock()+60000).toISOString(),customerIds:[selected.customerId],uploads:selected.sources.map(row=>row.asset),memoryIds:[],sourceRefs:[]},
   authorize:async({action,model,signal,target})=>{await current(model,signal);if(target)await checkParserGrant(action,assetOf(target),signal,model);return true;},
   assertUploadCurrent:async({action,model,signal,...target})=>checkParserGrant(action,assetOf(target),signal,model),artifacts,doclingReader:docling,clock});
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
  // The existing disclosure preconditions, shared with a new exact lookup.
  // This does not validate or erase observations; the full final gate below
  // still checks every provided and previously observed memory proof.
  function assertContextCurrent(receiver,signal){
   assertSessionSourcesCurrent(receiver,signal);
   if(memoryMethods.length)turnCurrent();
  }
  const control={async authorizeContext(signal,receiver){await current(receiver,signal);if(authority)for(const pin of selected.sources)await sourceCurrent(pin.asset,signal,receiver);},
   // Initial trusted business capability only. The RPC client cannot construct
   // this facade, broaden its keys, reopen the control or select a profile.
   documentTools(queries){
    if(!memoryMethods.includes('structuredMemoryRemember'))fail('OSS_STRUCTURED_MEMORY_WRITE_NOT_AUTHORIZED');
    const reader=control.readOnlyFacts(queries);
    return createNativeDocumentTools(control,reader.queries());
   },
   // Trusted in-process capability only. This method is deliberately absent
   // from the enterprise RPC/client and never enables a plugin or new grant.
   readOnlyFacts(queries){
    if(!memoryMethods.includes('structuredMemoryLookup'))fail('OSS_STRUCTURED_MEMORY_NOT_AUTHORIZED');
    const exact=factQueries(queries);
    const selectedQueries=new Map(exact.map(query=>[hash(query),query]));
    const proofs=new Map(),project=projectMemory;
    const selectedQuery=input=>{const query=queryOf(input);if(!selectedQueries.has(hash(query)))fail('OSS_MEMORY_FACT_NOT_SELECTED');return query;};
    const reader={scopeHash:hash({scopeHash,nativeSessionId,queries:exact}),queries:()=>structuredClone(exact),
     assertBinding(value,signal){
      if(value?.nativeSessionId!==nativeSessionId)fail('OSS_NATIVE_SESSION_REQUIRED');
      if(!value||['sessionId','subject','workspaceId','role'].some(k=>value.identity?.[k]!==identity[k])
       ||value.conversationId!==turn?.conversationId||value.runId!==turn?.runId)fail('OSS_ORIGINAL_RUN_CHANGED');
      assertContextCurrent(value.receiver,signal);return true;
     },
     async lookup(input,signal,receiver){
      const query=selectedQuery(input),result=await control.structuredMemoryLookup(query,signal,receiver),proof=result.authorization;
      await control.check(proof,signal,receiver);
      control.assertDisclosureCurrent({memoryProofs:[proof],messages:[],context:[]},receiver,signal);
      proofs.set(hash(query),proof);return {found:result.found,...(result.found?{memory:project(result.memory)}:{})};
     },
     current(input,expected,{state=store.read(),receiver,signal}={}){
      const query=selectedQuery(input),proof=proofs.get(hash(query));
      if(!proof?.memory||!expected||hash(project(proof.memory))!==hash(expected))fail('OSS_MEMORY_FACT_CHANGED');
      control.assertDisclosureCurrent({memoryProofs:[proof],messages:[],context:[]},receiver,signal);
      turnCurrent(state);assertCurrentMemoryProof(proof,state);return project(proof.memory);
     },
    };
    factReaderBrands.add(reader);return Object.freeze(reader);
   },
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
    if(proof?.kind==='memory'){
     checkMemoryProof(proof);if(hash(authorization)!==hash(proof)||hash(body)!==proof.bodyHash||hash(body.memory||null)!==hash(proof.memory)||hash(body.memoryQuery)!==hash(proof.query)||body.operation!==proof.operation)fail('OSS_PRIVATE_CACHED_BODY_CHANGED');return;
    }
    const sources=proofSources(proof),disclosed=proof.kind==='status'?body.sources:[body.source];
    if(hash(authorization)!==hash(proof)||hash(body)!==proof.bodyHash||hash(disclosed)!==hash(sources)
     ||hash(body.source)!==hash(proof.source))fail('OSS_PRIVATE_CACHED_BODY_CHANGED');
   },
   async check(proof,signal,receiver){
    if(proof?.scopeHash!==scopeHash||proof.nativeSessionId!==nativeSessionId||!['parse','status','memory'].includes(proof.kind)||!/^[a-f0-9]{64}$/.test(proof.bodyHash||''))fail('OSS_PRIVATE_RECEIPT_REFUSED');
    if(proof.kind==='memory')checkMemoryProof(proof);
    assertScreened(proof);
    for(const pin of proofSources(proof)){
     const source=await sourceCurrent(pin?.asset,signal,receiver,{bytes:true});
     if(hash({documentId:source.documentId,revision:source.revision,documentVersion:source.documentVersion,asset:pin.asset})!==hash(pin))fail('OSS_SOURCE_VERSION_CHANGED');
     if(proof.kind==='parse')await checkParserGrant('parse.reuse',pin.asset,signal,receiver);
    }
    observe(proof);
   },
   async structuredMemoryLookup(input,signal,receiver){
    if(!memoryMethods.includes('structuredMemoryLookup'))fail('OSS_STRUCTURED_MEMORY_NOT_AUTHORIZED');
    await control.authorizeContext(signal,receiver);turnCurrent();const query=queryOf(input);
    const result=await memoryLedger.lookup({audience:'internal',...query},{actor,signal});
    await control.authorizeContext(signal,receiver);turnCurrent();return mintMemory(result,query,'structuredMemoryLookup');
   },
   async structuredMemoryRemember(input,signal,receiver){
    if(!memoryMethods.includes('structuredMemoryRemember'))fail('OSS_STRUCTURED_MEMORY_WRITE_NOT_AUTHORIZED');
    await control.authorizeContext(signal,receiver);turnCurrent();const query=queryOf(input);
    if(typeof input.statement!=='string'||!input.statement.trim()||input.statement.length>4000)fail('OSS_STRUCTURED_MEMORY_INPUT_INVALID');safe(input);
    const sourceDependencies=selected.sources.map(pin=>{const source=sourceFor(pin.asset,signal);return {kind:'document',ref:pin.documentId,revision:source.revision,version:source.documentVersion,sha256:pin.asset.sha256,artifactId:pin.asset.artifactId,artifactVersion:pin.asset.version};});
    const result=await memoryLedger.rememberFromConversationTurn({requestId:'memory:'+hash([turn.requestId,query,input.statement]).slice(0,48),audience:'internal',...query,statement:input.statement},actor,{conversationId:turn.conversationId,runId:turn.runId,sourceDependencies,screenSource:sealMemory,assertCurrent:()=>{turnCurrent();control.assertDisclosureCurrent({messages:[],context:[]},receiver,signal);}});
    await control.authorizeContext(signal,receiver);turnCurrent();return mintMemory(result,query,'structuredMemoryRemember',input.statement);
   },
   async refresh(proof,signal,receiver){
    if(proof?.kind!=='memory')fail('OSS_PRIVATE_RECEIPT_REFUSED');await control.check(proof,signal,receiver);turnCurrent();
    const result=await memoryLedger.lookup({audience:'internal',...proof.query},{actor,signal});
    if(proof.memory&&!result.found)fail('OSS_MEMORY_SOURCE_REVOKED');return mintMemory(result,proof.query,proof.operation,proof.statement);
   },
   async authorizeDisclosure(payload,signal,receiver){await control.authorizeContext(signal,receiver);return control.assertDisclosureCurrent(payload,receiver,signal);},
   assertDisclosureCurrent(payload,receiver,signal){
    signal?.throwIfAborted();safe(payload);
    assertContextCurrent(receiver,signal);
    const memoryProofs=payload.memoryProofs??[];
    if(!Array.isArray(memoryProofs)||memoryProofs.length>8||payload.modelCalls!==undefined&&!Array.isArray(payload.memoryProofs))fail('OSS_FINAL_DISCLOSURE_REQUIRED');
    for(const proof of memoryProofs)assertCurrentMemoryProof(proof);
    for(const proof of observed.values())if(proof.kind==='memory')assertCurrentMemoryProof(proof);
    const coveredQueries=new Set(memoryProofs.map(proof=>hash(proof.query)));
    for(const [messages,isContext]of [[payload.messages,false],[payload.context,true]])for(const message of messages||[]){
     if(message?.role!=='toolResult'||!message.toolName?.startsWith('workspace_enterprise_context_')||message.isError)continue;
     const receipt=message.details,proof=receipt?.authorization;
     if(!proof||message.content?.length!==1||message.content[0].text!==JSON.stringify(receipt))fail('OSS_PRIVATE_HISTORY_REFUSED');
     const operation=proof.kind==='parse'?'parseUpload':proof.kind==='status'?'status':proof.kind==='memory'?proof.operation:null;
     if(!operation||proof.scopeHash!==scopeHash||proof.nativeSessionId!==nativeSessionId
      ||message.toolName!=='workspace_enterprise_context_'+operation.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()))fail('OSS_PRIVATE_RECEIPT_REFUSED');
     control.verifyBody(proof,receipt);
     if(payload.modelCalls!==undefined&&proof.kind==='memory'&&!coveredQueries.has(hash(proof.query)))fail('OSS_PRIVATE_SNAPSHOT_REQUIRED');
     if(proof.kind==='parse')assertScreened(proof);
     for(const source of proofSources(proof)){const current=sourceFor(source.asset,signal);if(hash({documentId:current.documentId,revision:current.revision,documentVersion:current.documentVersion,asset:source.asset})!==hash(source))fail('OSS_SOURCE_VERSION_CHANGED');}
     if(isContext&&proof.kind==='memory')assertCurrentMemoryProof(proof);
    }
    return true;
   },
   async finalCheck(signal,receiver){await control.authorizeContext(signal,receiver);for(const proof of observed.values())await control.check(proof,signal,receiver);control.assertDisclosureCurrent({messages:[],context:[]},receiver,signal);for(const proof of observed.values())if(proof.kind==='memory'&&proof.memory){const row=checkMemory(proof.memory);if(row.status!=='active'||hash(row)!==hash(proof.memory))fail('OSS_CACHE_RECEIPT_CHANGED');}},
  };return Object.freeze(control);
 }};brands.add(binding);return Object.freeze(binding);
}
export function enterpriseContextHostFromRpc(descriptor,request){
 if(!/^[a-f0-9]{64}$/.test(descriptor?.scopeHash||'')||typeof request!=='function')fail('OSS_ORIGINAL_HOST_REQUIRED');
 const binding={scopeHash:descriptor.scopeHash,memoryMethods:descriptor.memoryMethods||[],open(nativeSessionId){const call=(method,args,signal)=>request('enterpriseContext',[nativeSessionId,method,args],signal);
  return {...Object.fromEntries(['status','memorySearch','memoryAdd','memoryHistory','parseUpload','structuredMemoryLookup','structuredMemoryRemember'].map(method=>[method,(input,signal,model)=>call(method,[input,model],signal)])),
   refresh:(proof,signal,model)=>call('refresh',[proof,model],signal),authorizeDisclosure:(payload,signal,model)=>call('authorizeDisclosure',[payload,model],signal),
   authorizeContext:(signal,model)=>call('authorizeContext',[model],signal),check:(proof,signal,model)=>call('check',[proof,model],signal),verifyBody:(proof,receipt)=>call('verifyBody',[proof,receipt])};
 }};brands.add(binding);return Object.freeze(binding);
}
