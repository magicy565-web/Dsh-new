// Thin original Host binding only. No grant store, queue, payment authority or
// alternate executor. readReviewedScope is a trusted existing Host assertion,
// never supplied by HTTP/model arguments, and is reread at every boundary.
import {ApiError} from '../runtime.mjs';
import {digest,id,object} from './contracts.mjs';
import {libraryReadHash,libraryRecipientForModel,normalizeLibraryRecipient} from '../library-model-read-contract.mjs';
import {looksLikeCredential} from '../security.mjs';
// The core Host remains loadable when the optional package is uninstalled.
const PLUGIN='workspace-marketplace',PURPOSE='marketplace-local-planning-status-v1';
const marketplaceGap=()=>({plugin:PLUGIN,status:'unconfigured',code:'MARKETPLACE_UNCONFIGURED'});
const hosts=new WeakSet(),clone=structuredClone;
const fieldSet=['orderId','status','serviceId','workerId','updatedAt','termsHash'];
const statuses=['draft','approved','dispatching','queued','running','input_required','dispatch_uncertain','cancel_requested','review_required','result_incomplete','accepted','cancelled','failed','budget_dispute'];
const fail=code=>{throw new ApiError(403,code,'Use the current original Marketplace owner, reviewed purpose/fields and model receiver.');};
const same=(a,b)=>digest(a)===digest(b);
export function assertMarketplaceModelHost(host){if(!hosts.has(host))throw TypeError('Original Marketplace model Host required.');}
export function createMarketplaceModelHost({marketplace,store,access,readReviewedScope,clock=Date.now}={}){
 if(!marketplace?.getOrder||!marketplace?.createOrder||!store?.read||access?.mode!=='enterprise'||!access.nativeSessionById||typeof readReviewedScope!=='function')throw TypeError('Original enterprise Marketplace/Store/Access and reviewed Host scope callback required.');
 function bind({identity,conversationId,runId,authorize,recipient}={}){
  identity=clone(identity);recipient=normalizeLibraryRecipient(recipient);const recipientHash=libraryReadHash(recipient);
  if(typeof authorize!=='function')throw TypeError('Original Run authorizer required.');
  const actor={kind:'buyer',subject:identity.subject,workspaceId:identity.workspaceId,role:identity.role,human:false};
  function live(state=store.read(),signal){
   signal?.throwIfAborted();const session=access.nativeSessionById(identity.sessionId),conversation=state.conversations.find(c=>c.id===conversationId),run=state.runs.find(r=>r.id===runId);
   if(!session||['subject','workspaceId','role'].some(k=>session[k]!==identity[k])||state.marketplace?.workspaceId!==identity.workspaceId
    ||!conversation||conversation.workspaceId!==identity.workspaceId||!(conversation.createdBy===identity.subject||conversation.businessAgentOwner?.subject===identity.subject&&conversation.businessAgentOwner?.workspaceId===identity.workspaceId)
    ||!run||run.status!=='running'||run.conversationId!==conversationId||conversation.activeRunId!==runId||run.businessAgentContext?.subject!==identity.subject||run.businessAgentContext?.workspaceId!==identity.workspaceId)fail('MARKETPLACE_SCOPE_REQUIRED');
  }
  function scopeFor(model,signal,state){
   live(state,signal);if(libraryReadHash(libraryRecipientForModel(model))!==recipientHash)fail('MARKETPLACE_SCOPE_REQUIRED');
   const value=readReviewedScope({identity:clone(identity),conversationId,recipient:clone(recipient),purpose:PURPOSE});
   if(value===null||value===undefined||value===false)return null;
   object(value,['reviewed','workspaceId','subject','conversationId','recipient','purpose','revision','expiresAt','allowDiscovery','allowDrafts','allowOwnedOrderStatus','fields']);
   if(value.then||value.reviewed!==true||value.workspaceId!==identity.workspaceId||value.subject!==identity.subject||value.conversationId!==conversationId||value.purpose!==PURPOSE
    ||!id(value.revision)||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=clock()||libraryReadHash(normalizeLibraryRecipient(value.recipient))!==recipientHash
    ||['allowDiscovery','allowDrafts','allowOwnedOrderStatus'].some(k=>typeof value[k]!=='boolean')||!Array.isArray(value.fields)||new Set(value.fields).size!==value.fields.length||value.fields.some(k=>!fieldSet.includes(k))
    ||value.allowOwnedOrderStatus&&!['orderId','status'].every(k=>value.fields.includes(k)))fail('MARKETPLACE_SCOPE_REQUIRED');
   return clone({...value,fields:[...value.fields].sort()});
  }
  async function gate(model,signal,expected){signal?.throwIfAborted();await authorize();const scope=scopeFor(model,signal);if(expected&&(!scope||!same(scope,expected)))fail('MARKETPLACE_SCOPE_REQUIRED');return scope;}
  function allowed(scope,key){if(!scope||scope[key]!==true)fail('MARKETPLACE_SCOPE_REQUIRED');}
  function response(method,input,scope,view,sources){
   const result={plugin:PLUGIN,method,input:clone(input),status:'available',authorization:{workspaceId:identity.workspaceId,subject:identity.subject,sessionId:identity.sessionId,conversationId,recipientHash,purpose:PURPOSE,scopeFingerprint:digest(scope),scopeRevision:scope.revision,expiresAt:scope.expiresAt,fields:scope.fields},view:clone(view),sources:clone(sources),humanReviewRequired:true,externalActions:false};
   if(JSON.stringify(result).length>120000||looksLikeCredential(JSON.stringify(result)))fail('MARKETPLACE_SOURCE_CHANGED');return result;
  }
  function orderView(orderId,scope){
   allowed(scope,'allowOwnedOrderStatus');if(!id(orderId))fail('MARKETPLACE_INPUT_INVALID');
   const exposed=marketplace.getOrder(actor,orderId),state=store.read(),order=(state.workerOrders||[]).find(o=>o.id===orderId),contract=state.marketplace.contracts.find(c=>c.id===orderId);
   if(!order||!contract||contract.buyerSubject!==identity.subject||order.createdBy!==identity.subject||exposed.id!==order.id||exposed.status!==order.status||!statuses.includes(order.status)||!Number.isFinite(Date.parse(order.updatedAt)))fail('MARKETPLACE_SOURCE_CHANGED');
   const data={orderId:order.id,status:order.status,serviceId:order.serviceId,workerId:order.workerId,updatedAt:order.updatedAt,termsHash:contract.termsHash};
   return {view:Object.fromEntries(scope.fields.map(k=>[k,data[k]])),sources:[{kind:'marketplace-order',id:order.id,version:order.updatedAt,sha256:digest({order,contract})}]};
  }
  async function status(input={},signal,model){object(input,[]);const scope=await gate(model,signal);if(!scope)return marketplaceGap('MARKETPLACE_UNCONFIGURED');
   await gate(model,signal,scope);const view={configured:true,discovery:scope.allowDiscovery,drafts:scope.allowDrafts,ownedOrderStatus:scope.allowOwnedOrderStatus};return response('status',{},scope,view,[{kind:'marketplace-configuration',sha256:digest(view)}]);}
  async function find(input={},signal,model){object(input,['query']);const query=input.query??'';if(typeof query!=='string'||query.length>120)fail('MARKETPLACE_INPUT_INVALID');const scope=await gate(model,signal);if(!scope)return marketplaceGap('MARKETPLACE_UNCONFIGURED');allowed(scope,'allowDiscovery');
   await gate(model,signal,scope);const all=marketplace.catalog(actor,query),view={listings:all.slice(0,20),truncated:all.length>20};if(!same(scope,scopeFor(model,signal)))fail('MARKETPLACE_SCOPE_REQUIRED');return response('find',{query},scope,view,[{kind:'marketplace-catalog',sha256:digest(view)}]);}
  async function order(input,signal,model){object(input,['orderId']);const scope=await gate(model,signal);if(!scope)return marketplaceGap('MARKETPLACE_UNCONFIGURED');const projection=orderView(input.orderId,scope);await gate(model,signal,scope);const fresh=orderView(input.orderId,scope);if(!same(projection,fresh))fail('MARKETPLACE_SOURCE_CHANGED');return response('order',input,scope,fresh.view,fresh.sources);}
  async function propose(input,signal,model){const scope=await gate(model,signal);if(!scope)return marketplaceGap('MARKETPLACE_UNCONFIGURED');allowed(scope,'allowDrafts');allowed(scope,'allowOwnedOrderStatus');
   const created=await marketplace.createOrder(actor,input,{assertCurrent:state=>{const current=scopeFor(model,signal,state);if(!current||!same(scope,current))fail('MARKETPLACE_SCOPE_REQUIRED');allowed(current,'allowDrafts');allowed(current,'allowOwnedOrderStatus');return true;}});
   await gate(model,signal,scope);const projection=orderView(created.id,scope);return response('propose',{orderId:created.id,requestId:input.requestId.trim()},scope,projection.view,projection.sources);}
  async function revalidateReceipt(receipt,signal,model){
   if(!receipt||receipt.plugin!==PLUGIN||!['status','find','order','propose'].includes(receipt.method))fail('MARKETPLACE_SOURCE_CHANGED');
   let fresh;
   if(receipt.method==='propose'){
    object(receipt.input,['orderId','requestId']);const scope=await gate(model,signal);allowed(scope,'allowDrafts');allowed(scope,'allowOwnedOrderStatus');
    await gate(model,signal,scope);const state=store.read(),row=(state.workerOrders||[]).find(o=>o.id===receipt.input.orderId),requestKey='mp-'+digest([identity.workspaceId,identity.subject,receipt.input.requestId]).slice(0,48);
    if(!row||row.requestId!==requestKey)fail('MARKETPLACE_SOURCE_CHANGED');const projection=orderView(receipt.input.orderId,scope);if(!same(scope,scopeFor(model,signal)))fail('MARKETPLACE_SCOPE_REQUIRED');fresh=response('propose',receipt.input,scope,projection.view,projection.sources);
   }else fresh=await ({status,find,order})[receipt.method](receipt.input,signal,model);
   if(!same(fresh,receipt))fail('MARKETPLACE_SOURCE_CHANGED');return true;
  }
  return Object.freeze({status,find,propose,order,revalidateReceipt});
 }
 const host=Object.freeze({bind});hosts.add(host);return host;
}
