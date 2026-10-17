import { ApiError } from './runtime.mjs';
import { randomUUID, createHash } from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const ID=/^[A-Za-z0-9._@:+|/-]{1,128}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const AUDIENCES=['internal','customer'];
const LEVELS=['public','qualified','commercial','channel','confidential'];
const SOURCE_KINDS=['document','product','conversation'];
const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
const iso=v=>new Date(v).toISOString();
const clean=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');

function validateSource(source){
  if(!source||typeof source!=='object'||!SOURCE_KINDS.includes(source.kind)||!ID.test(source.ref)||!Number.isSafeInteger(source.revision)||source.revision<1||!Number.isSafeInteger(source.version)||source.version<1||!SHA.test(source.sha256))
    fail(400,'MEMORY_SOURCE_INVALID','A memory must pin an exact source revision, version and SHA-256.');
  if(['document','product'].includes(source.kind)&&!UUID.test(source.ref)) fail(400,'MEMORY_SOURCE_INVALID','Library memory sources require an exact UUID.');
  if(source.kind==='conversation'&&(!ID.test(source.messageId)||!ID.test(source.runId))) fail(400,'MEMORY_SOURCE_INVALID','Conversation memory sources require the original message and run.');
  if(source.dependencies!==undefined){
    if(!Array.isArray(source.dependencies)||source.dependencies.length>8) fail(400,'MEMORY_SOURCE_INVALID','Invalid Library dependency footprint.');
    for(const dependency of source.dependencies){
      if(dependency.kind!=='document'||dependency.dependencies!==undefined||!UUID.test(dependency.artifactId)||!Number.isSafeInteger(dependency.artifactVersion)||dependency.artifactVersion<1) fail(400,'MEMORY_SOURCE_INVALID','Exact original artifact dependencies are required.');
      validateSource(dependency);
    }
  }
  return source;
}
function sourceExists(store,source){
  const state=store.read();
  if(source.kind==='document'){
    const doc=state.businessLibrary?.documents?.find(x=>x.id===source.ref), version=doc?.versions?.find(x=>x.version===source.version);
    if(!doc||!version||version.asset?.sha256!==source.sha256||doc.revision<source.revision) fail(409,'MEMORY_SOURCE_HISTORY_MISSING','The historical document source no longer exists exactly.');
    return;
  }
  if(source.kind==='product'){
    const product=state.businessLibrary?.products?.find(x=>x.id===source.ref);
    if(!product||product.revision!==source.revision||source.version!==source.revision||hash(canonical(product))!==source.sha256) fail(409,'MEMORY_SOURCE_HISTORY_MISSING','The historical product source cannot be verified.');
    return;
  }
  const message=state.messages?.find(x=>x.id===source.messageId&&x.conversationId===source.ref&&x.role==='user'&&x.status==='complete');
  const run=state.runs?.find(x=>x.id===source.runId&&x.conversationId===source.ref);
  if(!message||!run||source.version!==1||source.revision!==1||hash(message.content)!==source.sha256) fail(409,'MEMORY_SOURCE_HISTORY_MISSING','The historical conversation source cannot be verified.');
}
function currentSource(store,source,state=store.read()){
  for(const dependency of source.dependencies||[]){
    currentSource(store,dependency,state);
    const artifact=state.artifacts?.find(x=>x.id===dependency.artifactId),version=artifact?.versions?.find(x=>x.version===dependency.artifactVersion);
    const doc=state.businessLibrary?.documents?.find(x=>x.id===dependency.ref),docVersion=doc?.versions?.find(x=>x.version===dependency.version);
    if(!version||version.sha256!==dependency.sha256||docVersion?.asset?.artifactId!==dependency.artifactId||docVersion.asset.version!==dependency.artifactVersion) fail(409,'MEMORY_SOURCE_REVOKED','The original artifact dependency changed.');
  }
  if(source.kind==='document'){
    const doc=state.businessLibrary?.documents?.find(x=>x.id===source.ref), version=doc?.versions?.find(x=>x.version===source.version);
    if(!doc||doc.status!=='active'||doc.revision!==source.revision||doc.currentVersion!==source.version||!version||version.asset?.sha256!==source.sha256) fail(409,'MEMORY_SOURCE_REVOKED','The memory source document revision is no longer current.');
    return;
  }
  if(source.kind==='product'){
    const product=state.businessLibrary?.products?.find(x=>x.id===source.ref);
    if(!product||product.status==='archived'||product.revision!==source.revision||source.version!==source.revision||hash(canonical(product))!==source.sha256) fail(409,'MEMORY_SOURCE_REVOKED','The memory source product revision is no longer current.');
    return;
  }
  const message=state.messages?.find(x=>x.id===source.messageId&&x.conversationId===source.ref&&x.role==='user'&&x.status==='complete');
  const run=state.runs?.find(x=>x.id===source.runId&&x.conversationId===source.ref);
  if(!message||!run||!['running','complete','succeeded'].includes(run.status)||source.version!==1||source.revision!==1||hash(message.content)!==source.sha256) fail(409,'MEMORY_SOURCE_REVOKED','The memory source conversation turn is no longer available as an exact source.');
}
function validateStored(row){
  if(!row||typeof row!=='object'||!UUID.test(row.id)||!ID.test(row.requestId)||!ID.test(row.workspaceId)||!AUDIENCES.includes(row.audience)
    ||row.customerId!==null&&(!ID.test(row.customerId))||!ID.test(row.subjectType)||!ID.test(row.subjectId)||!ID.test(row.factKey)
    ||typeof row.statement!=='string'||!row.statement.trim()||row.statement.length>4000||row.audience==='customer'&&!LEVELS.includes(row.visibilityLevel)||row.audience==='internal'&&row.visibilityLevel!=='internal'
    ||!Number.isSafeInteger(row.revision)||row.revision<1||!['pending','active','superseded','revoked','sync_error'].includes(row.status)
    ||!ID.test(row.createdBy)||!ID.test(row.updatedBy)||!Number.isFinite(Date.parse(row.createdAt))||!Number.isFinite(Date.parse(row.updatedAt))
    ||!Array.isArray(row.history)||row.history.length<1||row.history.length>100||row.expiresAt!==null&&!Number.isFinite(Date.parse(row.expiresAt)))
    fail(500,'MEMORY_STORE_INVALID','Stored enterprise memory is invalid.');
  validateSource(row.source);
  if(row.audience==='customer'&&(!row.customerId||(row.status==='active'&&!UUID.test(row.disclosureGrantId||'')))) fail(500,'MEMORY_STORE_INVALID','Active customer memory requires a disclosure grant.');
  if(row.audience==='internal'&&row.customerId!==null) fail(500,'MEMORY_STORE_INVALID','Internal memory cannot carry a customer identity.');
}
export function validateEnterpriseMemory(row){validateStored(row);return clean(row);}

export function createEnterpriseMemoryLedger({store,library,disclosure=null,workspaceId,clock=Date.now}={}){
  if(!store||typeof store.read!=='function'||typeof store.update!=='function') throw new TypeError('Enterprise memory requires the original Workspace store.');
  if(!library||typeof library.getProduct!=='function'||typeof library.getDocument!=='function') throw new TypeError('Enterprise memory requires the original Library service.');
  if(!ID.test(workspaceId)) throw new TypeError('Enterprise memory requires an exact workspace identity.');
  function rows(state){
    const lib=state.businessLibrary;if(!lib) fail(500,'MEMORY_LIBRARY_MISSING','The original Library is unavailable.');
    lib.enterpriseMemories??=[];
    if(!Array.isArray(lib.enterpriseMemories)||lib.enterpriseMemories.length>10000) fail(500,'MEMORY_STORE_INVALID','Enterprise memory store is invalid or full.');
    for(const row of lib.enterpriseMemories){validateStored(row);if(row.workspaceId!==workspaceId)fail(500,'MEMORY_STORE_INVALID','Stored memory belongs to another workspace.');}
    return lib.enterpriseMemories;
  }
  function actorOk(actor,audience){
    if(!actor||actor.workspaceId!==workspaceId||!ID.test(actor.subject)) fail(403,'MEMORY_WORKSPACE_REQUIRED','Use the original workspace identity.');
    if(audience==='customer'&&actor.role!=='admin') fail(403,'MEMORY_CUSTOMER_AUTHORIZATION_REQUIRED','Only an administrator may authorize customer-visible memory.');
    if(audience==='internal'&&!['admin','operator'].includes(actor.role)) fail(403,'MEMORY_ROLE_REQUIRED','The existing workspace role cannot write enterprise memory.');
  }
  async function remember(body,actor,{assertCurrent}={}){
    if(!body||typeof body!=='object'||!ID.test(body.requestId)||!AUDIENCES.includes(body.audience)||!ID.test(body.subjectType)||!ID.test(body.subjectId)||!ID.test(body.factKey)||typeof body.statement!=='string'||!body.statement.trim()||body.statement.length>4000)
      fail(400,'MEMORY_INPUT_INVALID','Memory writes require bounded identity, fact key and statement fields.');
    actorOk(actor,body.audience);validateSource(body.source);currentSource(store,body.source);
    if(body.audience==='customer'){
      if(!ID.test(body.customerId)||!disclosure) fail(503,'MEMORY_AUTHZ_NOT_CONFIGURED','Customer memory requires the disclosure authorization service.');
      if(!LEVELS.includes(body.visibilityLevel)) fail(400,'MEMORY_LEVEL_INVALID','Customer memory requires a disclosure level.');
      if(typeof body.purpose!=='string'||!body.purpose.trim()||body.purpose.length>500) fail(400,'MEMORY_PURPOSE_INVALID','Customer memory authorization requires a bounded purpose.');
      if(!body.expiresAt||!Number.isFinite(Date.parse(body.expiresAt))||Date.parse(body.expiresAt)<=clock()) fail(400,'MEMORY_EXPIRY_INVALID','Customer memory requires a future expiry.');
    } else if(body.customerId!==undefined&&body.customerId!==null) fail(400,'MEMORY_CUSTOMER_INVALID','Internal memory cannot be assigned to a customer.');
    const fp=hash({workspaceId,audience:body.audience,customerId:body.customerId??null,subjectType:body.subjectType,subjectId:body.subjectId,factKey:body.factKey,statement:body.statement.trim(),visibilityLevel:body.visibilityLevel??'internal',source:body.source,expiresAt:body.expiresAt??null,purpose:body.purpose??null});
    // The original Store already serializes transactions. Read the receipt and
    // fact head in that same transaction, never from an earlier read snapshot.
    const {next,previous,idempotent}=await store.update(state=>{
      assertCurrent?.();actorOk(actor,body.audience);currentSource(store,body.source,state);
      const list=rows(state),priorRequest=list.find(x=>x.requestId===body.requestId);
      if(priorRequest){
        if(priorRequest.fingerprint!==fp||priorRequest.createdBy!==actor.subject) fail(409,'MEMORY_IDEMPOTENCY_CONFLICT','requestId already belongs to another memory write.');
        return {next:clean(priorRequest),previous:null,idempotent:true};
      }
      const previous=list.filter(x=>x.workspaceId===workspaceId&&x.audience===body.audience&&(x.customerId??null)===(body.customerId??null)&&x.subjectType===body.subjectType&&x.subjectId===body.subjectId&&x.factKey===body.factKey).sort((a,b)=>b.revision-a.revision)[0];
      if(previous?.status==='pending') fail(409,'MEMORY_WRITE_PENDING','The previous fact write is still awaiting authorization; retry after it completes.');
      // Each distinct requestId owns a durable receipt, even for equal text.
      // Revocation or failed synchronization must not reset the revision chain.
      const now=iso(clock()),next={
        id:randomUUID(),requestId:body.requestId,fingerprint:fp,workspaceId,audience:body.audience,customerId:body.customerId??null,
        subjectType:body.subjectType,subjectId:body.subjectId,factKey:body.factKey,statement:body.statement.trim(),visibilityLevel:body.visibilityLevel??'internal',
        source:clean(body.source),createdAt:now,createdBy:actor.subject,updatedAt:now,updatedBy:actor.subject,revision:previous?previous.revision+1:1,
        status:body.audience==='customer'?'pending':'active',expiresAt:body.audience==='customer'?body.expiresAt:null,disclosureGrantId:null,
        previousMemoryId:previous?.id??null,history:[{revision:previous?previous.revision+1:1,action:previous?'updated':'created',at:now,actor:actor.subject,source:clean(body.source),statement:body.statement.trim(),previousMemoryId:previous?.id??null}],
      };
      if(previous?.status==='active'){previous.status='superseded';previous.updatedAt=now;previous.updatedBy=actor.subject;}
      list.push(next);return {next:clean(next),previous:previous?clean(previous):null,idempotent:false};
    });
    if(idempotent)return {memory:next,idempotent:true};
    if(body.audience==='customer'){
      let grant;
      try{
        grant=await disclosure.grant({requestId:`memory-${hash(next.id + next.requestId).slice(0,48)}`,customerId:body.customerId,resourceType:'memory',resourceId:next.id,resourceRevision:next.revision,maxLevel:body.visibilityLevel,expiresAt:body.expiresAt,purpose:body.purpose},actor);
        await store.update(state=>{
          assertCurrent?.();currentSource(store,body.source,state);
          const row=rows(state).find(x=>x.id===next.id);
          if(row?.status!=='pending')fail(409,'MEMORY_WRITE_CHANGED','The pending memory changed before activation.');
          row.disclosureGrantId=grant.grant.id;row.status='active';row.updatedAt=iso(clock());row.updatedBy=actor.subject;return null;
        });
        if(previous?.disclosureGrantId){
          const cleanup=await disclosure.revoke(previous.disclosureGrantId,{reason:`Superseded by memory ${next.id}`},actor);
          if(cleanup?.syncError)fail(503,'MEMORY_AUTHZ_CLEANUP_FAILED','Previous customer authorization could not be removed.');
        }
      }catch(error){
        await store.update(state=>{const row=rows(state).find(x=>x.id===next.id);if(row&&['pending','active'].includes(row.status)){row.status='sync_error';row.updatedAt=iso(clock());row.updatedBy=actor.subject;}return null;});
        if(grant?.grant?.id){
          const cleanup=await disclosure.revoke(grant.grant.id,{reason:`Memory ${next.id} activation failed`},actor);
          if(cleanup.syncError)fail(503,'MEMORY_AUTHZ_CLEANUP_FAILED','Memory authorization was refused, but disclosure cleanup failed; reconciliation is required.');
        }
        throw error;
      }
    }
    return {memory:clean(rows(store.read()).find(x=>x.id===next.id)),idempotent:false};
  }
  async function rememberFromConversationTurn(body, actor, { conversationId, runId, sourceDependencies = [],screenSource,assertCurrent } = {}) {
    if (!ID.test(conversationId) || !ID.test(runId)) fail(400,'MEMORY_CONVERSATION_SOURCE_INVALID','The original conversation and run are required.');
    const state=store.read(), run=state.runs?.find(x=>x.id===runId&&x.conversationId===conversationId);
    const message=state.messages?.find(x=>x.conversationId===conversationId&&x.role==='user'&&x.requestId===run?.requestId&&x.status==='complete');
    if(!run||!message) fail(409,'MEMORY_CONVERSATION_SOURCE_MISSING','The current conversation turn could not be pinned as a memory source.');
    const source={kind:'conversation',ref:conversationId,revision:1,version:1,messageId:message.id,runId,sha256:hash(message.content),dependencies:clean(sourceDependencies)};
    if(screenSource)source.credentialScreening=screenSource({statement:body.statement.trim(),source:clean(source),scope:{workspaceId:actor.workspaceId,
      audience:body.audience,customerId:body.customerId??null,subjectType:body.subjectType,subjectId:body.subjectId,factKey:body.factKey}});
    return remember({...body,source},actor,{assertCurrent});
  }

  async function read(idValue,{customerId=null,actor=null,signal}={}){
    if(!UUID.test(idValue)) fail(400,'MEMORY_ID_INVALID','Invalid memory id.');
    const row=rows(store.read()).find(x=>x.id===idValue);
    if(!row||row.status!=='active') fail(404,'MEMORY_NOT_FOUND','Memory is not active.');
    currentSource(store,row.source);
    if(row.audience==='customer'){
      if(customerId!==row.customerId) fail(403,'MEMORY_CUSTOMER_SCOPE_DENIED','Customer memory belongs to another customer.');
      if(!disclosure) fail(503,'MEMORY_AUTHZ_NOT_CONFIGURED','Customer memory authorization is unavailable.');
      await disclosure.check({customerId,resourceType:'memory',resourceId:row.id,resourceRevision:row.revision,level:row.visibilityLevel},signal);
    } else if(!actor||actor.workspaceId!==workspaceId||!['admin','operator'].includes(actor.role)) fail(403,'MEMORY_ROLE_REQUIRED','Internal memory requires a workspace member.');
    currentSource(store,row.source);
    return {memory:clean(row)};
  }
  async function lookup({audience='internal',customerId=null,subjectType,subjectId,factKey,level='public'},{actor=null,signal}={}) {
    signal?.throwIfAborted();
    if(!ID.test(subjectType)||!ID.test(subjectId)||!ID.test(factKey)||!AUDIENCES.includes(audience)) fail(400,'MEMORY_LOOKUP_INVALID','Memory lookup requires bounded identity fields.');
    if(audience==='customer'){
      if(!ID.test(customerId)) fail(400,'MEMORY_CUSTOMER_INVALID','Customer memory lookup requires a customer identity.');
      if(!actor||actor.workspaceId!==workspaceId||!ID.test(actor.subject)) fail(403,'MEMORY_WORKSPACE_REQUIRED','Use the original workspace identity.');
      if(actor.role!=='admin'&&actor.customerId!==customerId) fail(403,'MEMORY_CUSTOMER_SCOPE_DENIED','Customer memory belongs to another customer.');
      if(!disclosure||!LEVELS.includes(level)) fail(503,'MEMORY_AUTHZ_NOT_CONFIGURED','Customer memory authorization is unavailable.');
    } else actorOk(actor,audience);
    const row=rows(store.read()).filter(x=>x.status==='active'&&x.workspaceId===workspaceId&&x.audience===audience&&(x.customerId??null)===(customerId??null)&&x.subjectType===subjectType&&x.subjectId===subjectId&&x.factKey===factKey).sort((a,b)=>b.revision-a.revision)[0];
    if(!row) return {found:false};
    currentSource(store,row.source);
    if(audience==='customer') await disclosure.check({customerId,resourceType:'memory',resourceId:row.id,resourceRevision:row.revision,level},signal);
    currentSource(store,row.source);
    return {found:true,memory:clean(row)};
  }

  // Revalidate an earlier native tool observation without treating superseded
  // facts as current. The Host then supplies the latest authorized projection.
  function revalidateSnapshot(snapshot,{actor,signal,state=store.read()}={}) {
    signal?.throwIfAborted();actorOk(actor,'internal');
    const row=rows(state).find(x=>x.id===snapshot?.id&&x.workspaceId===workspaceId&&x.audience==='internal');
    if(!row||!['active','superseded'].includes(row.status)||snapshot.status!=='active') fail(403,'MEMORY_SOURCE_REVOKED','The cached memory is no longer available.');
    const immutable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['status','updatedAt','updatedBy'].includes(key)));
    if(hash(immutable(row))!==hash(immutable(snapshot))) fail(403,'MEMORY_SOURCE_REVOKED','The cached memory observation changed.');
    currentSource(store,row.source,state);return clean(row);
  }

  async function revoke(idValue,body={},actor){
    if(!UUID.test(idValue)) fail(400,'MEMORY_ID_INVALID','Invalid memory id.');
    // Capture the grant from the same serialized transaction that revokes it.
    // An activation already queued may not yet be visible in store.read().
    const {row,idempotent}=await store.update(state=>{
      const item=rows(state).find(x=>x.id===idValue);if(!item)fail(404,'MEMORY_NOT_FOUND','Memory not found.');
      actorOk(actor,item.audience);
      const idempotent=item.status==='revoked';
      if(!idempotent){const now=iso(clock());item.status='revoked';item.updatedAt=now;item.updatedBy=actor.subject;item.history.push({revision:item.revision,action:'revoked',at:now,actor:actor.subject,reason:body.reason||'revoked_by_admin'});}
      return {row:clean(item),idempotent};
    });
    let syncError=null;
    if(row.audience==='customer'&&row.disclosureGrantId&&disclosure){const result=await disclosure.revoke(row.disclosureGrantId,{reason:body.reason||'memory_revoked'},actor);syncError=result.syncError||null;}
    return {memory:clean(rows(store.read()).find(x=>x.id===idValue)),...(idempotent?{idempotent:true}:{}),...(syncError?{syncError}: {})};
  }
  function list({customerId=null,audience}={},actor){
    if(!actor||actor.workspaceId!==workspaceId||actor.role!=='admin') fail(403,'MEMORY_ADMIN_REQUIRED','Only an administrator can enumerate enterprise memory.');
    if(audience!==undefined&&!AUDIENCES.includes(audience)) fail(400,'MEMORY_AUDIENCE_INVALID','Unknown memory audience.');
    return {memories:rows(store.read()).filter(x=>(audience===undefined||x.audience===audience)&&(customerId===null||x.customerId===customerId)).map(clean)};
  }
  function history(idValue,actor){
    if(!UUID.test(idValue)) fail(400,'MEMORY_ID_INVALID','Invalid memory id.');
    if(!actor||actor.workspaceId!==workspaceId||actor.role!=='admin') fail(403,'MEMORY_ADMIN_REQUIRED','Only an administrator can inspect enterprise memory history.');
    const all=rows(store.read()), result=[];let current=all.find(x=>x.id===idValue),guard=0;
    if(!current) fail(404,'MEMORY_NOT_FOUND','Memory not found.');
    while(current&&guard++<100){sourceExists(store,current.source);result.push(clean({id:current.id,revision:current.revision,status:current.status,statement:current.statement,source:current.source,createdAt:current.createdAt,createdBy:current.createdBy,updatedAt:current.updatedAt,updatedBy:current.updatedBy}));current=current.previousMemoryId?all.find(x=>x.id===current.previousMemoryId):null;}
    if(current) fail(500,'MEMORY_HISTORY_INVALID','Memory history chain exceeds the safety bound.');
    return {memoryId:idValue,history:result};
  }
  function resolveResource({resourceId,forGrant=false}){const row=rows(store.read()).find(x=>x.id===resourceId&&x.workspaceId===workspaceId);if(!row)return null;if(row.status==='active'||forGrant&&row.status==='pending')currentSource(store,row.source);return row;}
  return Object.freeze({remember,rememberFromConversationTurn,read,lookup,revalidateSnapshot,revoke,list,history,resolveResource,status:()=>({provider:'structured-library-memory',enabled:true,vectorSearch:false,sourceBound:true,history:true,customerAuthorization:!!disclosure})});
}
