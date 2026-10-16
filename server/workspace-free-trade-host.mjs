// In-process bridge only. Original Host owns identity, resource grants and safe
// connection injection. This creates no account, grant store, route or ERP.
import {createErpNextClient,createTenderClient,validateErpRead,TradeError} from '../plugins/workspace-free-trade/src/free-trade.mjs';
import {libraryReadHash as hash,normalizeLibraryRecipient,libraryRecipientForModel} from './library-model-read-contract.mjs';
const instances=new WeakSet();
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
export const assertFreeTradeHost=value=>{if(!instances.has(value))fail('FREE_TRADE_ORIGINAL_HOST_REQUIRED');};
export async function createFreeTradeSessionBinding({access,identity,sessionClient,instanceId,policy,connection={},authorizeRecord,authorizeTool,
  tenderClient=createTenderClient(),clock=Date.now}={}){
  if(!policy?.enabled)return null;
  if(access?.mode!=='enterprise'||!sessionClient?.readOnlySession||typeof sessionClient.bindingIdentity!=='function'||!identity?.sessionId||!instanceId)
    fail('FREE_TRADE_ORIGINAL_HOST_REQUIRED');
  if(!exact(policy,['enabled','reviewed','workspaceId','subject','recipient','expiresAt','origin','records'])||policy.reviewed!==true
    ||policy.subject!==identity.subject||policy.workspaceId!==identity.workspaceId||!Number.isFinite(Date.parse(policy.expiresAt))
    ||!Array.isArray(policy.records)||!policy.records.length||policy.records.length>8||typeof authorizeRecord!=='function')fail('FREE_TRADE_REVIEWED_SCOPE_REQUIRED');
  const recipient=normalizeLibraryRecipient(policy.recipient),records=policy.records.map(validateErpRead);
  let origin;
  try{origin=new URL(policy.origin).origin;if(policy.origin!==origin||connection.baseUrl&&new URL(connection.baseUrl).origin!==origin)throw Error();}
  catch{fail('FREE_TRADE_ERP_ORIGIN_CHANGED');}
  const scope=structuredClone({...policy,recipient,records,instanceId,sessionId:identity.sessionId}),scopeHash=hash(scope);
  async function current(model,signal){
    signal?.throwIfAborted();
    if(clock()>=Date.parse(scope.expiresAt)||hash(libraryRecipientForModel(model))!==hash(recipient))fail('FREE_TRADE_RECEIVER_OR_SCOPE_CHANGED');
    let live,actor;
    try{live=access.nativeSessionById(identity.sessionId);actor=await sessionClient.bindingIdentity(signal);}
    catch{fail('FREE_TRADE_SESSION_REVOKED');}
    if(!live||live.subject!==identity.subject||live.workspaceId!==identity.workspaceId||live.role!==identity.role
      ||actor.instanceId!==instanceId||actor.subject!==live.subject||actor.workspaceId!==live.workspaceId||actor.role!==live.role)fail('FREE_TRADE_SESSION_REVOKED');
    signal?.throwIfAborted();
  }
  async function recordAllowed(raw,signal,model){
    await current(model,signal);const input=validateErpRead(raw);
    const selected=records.find(row=>row.doctype===input.doctype&&row.name===input.name&&input.fields.every(field=>row.fields.includes(field)));
    let allowed=false;
    if(selected)try{allowed=await authorizeRecord(Object.freeze({...input,origin}),signal,model)===true;}catch{}
    if(!allowed)fail('FREE_TRADE_RECORD_SCOPE_REVOKED');
    await current(model,signal);return true;
  }
  // Validate the original member/instance immediately; no OS-owner fallback.
  await current({provider:recipient.provider,id:recipient.model,baseUrl:recipient.destination});
  const binding={scopeHash,describe:()=>({scopeHash,erp:connection.baseUrl&&connection.apiKey&&connection.apiSecret?'configured_unverified':'unconfigured',tenders:tenderClient.status()}),
    open(nativeSessionId){
      if(typeof nativeSessionId!=='string'||!nativeSessionId)fail('FREE_TRADE_NATIVE_SESSION_REQUIRED');
      let reads=0;const observed=new Map(),admitted=new Set();
      const maxReads=16;
      // All five freshness passes stay independent: before request accounting,
      // after its Host hook, completion, worker delivery and Node delivery.
      const remainingPasses={'model:prepare':5,'model:disclose':4,'model:complete':3,'final:deliver':2};
      function reserve(count,passes=5,extra=0){
        if(reads+extra+passes*count>maxReads)throw new TradeError('FREE_TRADE_PRIVATE_READ_CAPACITY');
      }
      const erp=createErpNextClient({...connection,authorizeRecord:(request,signal,model)=>{
        if(request.origin!==origin)fail('FREE_TRADE_ERP_ORIGIN_CHANGED');
        return recordAllowed({doctype:request.doctype,name:request.name,fields:request.fields},signal,model);
      }});
      async function sourceRead(input,signal,model){if(reads>=maxReads)fail('FREE_TRADE_PRIVATE_READ_LIMIT');reads++;return erp.read(input,signal,model);}
      async function read(raw,signal,model){
        const input=validateErpRead(raw);await recordAllowed(input,signal,model);
        if(erp.status()==='unconfigured')return erp.read(input,signal,model);
        const key=hash(input),next=new Set([...observed.keys(),...admitted,key]);
        reserve(next.size,5,1);
        // Reserve synchronously before I/O so concurrent tool calls cannot each
        // admit themselves against the same empty footprint. Failed attempts
        // conservatively retain their slot for this worker turn.
        admitted.add(key);return sourceRead(input,signal,model);
      }
      const control={enterprise:true,tenders:tenderClient,erp:{status:()=>erp.status(),read},
        async authorize({tool,input},signal,model){
          await current(model,signal);
          if(tool==='workspace_erpnext_read')return recordAllowed(input,signal,model);
          let allowed=false;if(typeof authorizeTool==='function')try{allowed=await authorizeTool({tool,input},signal,model)===true;}catch{}
          if(!allowed)fail('FREE_TRADE_OUTBOUND_OR_INTENT_NOT_APPROVED');
          await current(model,signal);return true;
        },
        async seal(input,body,signal,model){
          const request=validateErpRead(input);await recordAllowed(request,signal,model);
          if(body.plugin!=='workspace-free-trade'||body.status!=='ok'||body.contentTrust!=='private_source_data'
            ||body.doctype!==request.doctype||body.name!==request.name||hash(body.fields)!==hash(request.fields))fail('FREE_TRADE_PRIVATE_RECEIPT_INVALID');
          const proof={request,receiptHash:hash(body),projectionHash:hash(body.record),scopeHash,nativeSessionId};
          observed.set(hash(request),proof);return proof;
        },
        async check(proof,signal,model,{refresh=false}={}){
          if(!exact(proof,['request','receiptHash','projectionHash','scopeHash','nativeSessionId'])||proof.scopeHash!==scopeHash
            ||proof.nativeSessionId!==nativeSessionId||![proof.receiptHash,proof.projectionHash].every(value=>/^[a-f0-9]{64}$/.test(value||'')))fail('FREE_TRADE_PRIVATE_RECEIPT_INVALID');
          await recordAllowed(proof.request,signal,model);
          if(refresh){const fresh=await sourceRead(proof.request,signal,model);if(hash(fresh.record)!==proof.projectionHash)fail('FREE_TRADE_ERP_PROJECTION_CHANGED');}
          observed.set(hash(proof.request),proof);
        },
        verifyBody(proof,receipt){
          const {authorization,...body}=receipt||{};
          if(hash(authorization)!==hash(proof)||hash(body)!==proof.receiptHash||hash(body.record)!==proof.projectionHash
            ||body.doctype!==proof.request.doctype||body.name!==proof.request.name||hash(body.fields)!==hash(proof.request.fields))fail('FREE_TRADE_PRIVATE_CACHED_BODY_CHANGED');
        },
        async authorizeContext(signal,model,{phase}={}){await current(model,signal);if(Object.hasOwn(remainingPasses,phase))reserve(observed.size,remainingPasses[phase]);},
        async finalCheck(signal,model){await current(model,signal);reserve(observed.size,1);for(const proof of observed.values())await control.check(proof,signal,model,{refresh:true});},
        report:()=>({mode:'original-enterprise-session',privateReads:reads,maxPrivateReads:maxReads,realCustomerAuthorizationClaimed:false})};
      return Object.freeze(control);
    }};
  instances.add(binding);return Object.freeze(binding);
}

// Only the existing owned worker's private fd3 protocol calls this. Credentials
// and the actual identity/record checks stay on the original Node24 Host.
export function freeTradeHostFromRpc(descriptor,request){
  if(!descriptor||!/^[a-f0-9]{64}$/.test(descriptor.scopeHash||'')||typeof request!=='function')fail('FREE_TRADE_ORIGINAL_HOST_REQUIRED');
  const binding={scopeHash:descriptor.scopeHash,open(nativeSessionId){
    const call=(method,args=[],signal)=>request('freeTrade',[nativeSessionId,method,args],signal);
    return {enterprise:true,tenders:{status:()=>descriptor.tenders,search:(input,signal)=>call('tenderSearch',[input],signal)},
      erp:{status:()=>descriptor.erp,read:(input,signal,model)=>call('read',[input,model],signal)},
      authorize:(value,signal,model)=>call('authorize',[value,model],signal),
      seal:(input,body,signal,model)=>call('seal',[input,body,model],signal),
      check:(proof,signal,model,options={})=>call('check',[proof,model,options],signal),
      verifyBody:(proof,receipt)=>call('verifyBody',[proof,receipt]),
      authorizeContext:(signal,model,options={})=>call('authorizeContext',[model,options],signal),
      report:()=>({mode:'original-host-private-fd',realCustomerAuthorizationClaimed:false})};
  }};
  instances.add(binding);return Object.freeze(binding);
}
