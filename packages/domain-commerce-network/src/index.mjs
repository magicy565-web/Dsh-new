import {createHash} from 'node:crypto';

/**
 * Pure Work Order contract; MUST be invoked behind server-authenticated,
 * tenant-scoped storage and approval APIs. This module does not dispatch,
 * authorize, contact buyers, charge money, or execute third-party code.
 */
const id = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const allowedActions = new Set(['public_web_research','read_granted_product_context','draft_outreach','classify_opted_in_replies','summarize_rfq']);
export const WORK_ORDER_ACTIONS = Object.freeze([...allowedActions]);
export const WORK_ORDER_STATES = Object.freeze(['proposed','authorized','queued','claimed','running','delivered','accepted','rejected','stop_requested','cancelled','failed']);
const ERR = code => {throw new Error(code);};

/** Untrusted Agent Cards are proposals, never verified skills or authority. */
export function createAgentRegistrationProposal(data) {
  if(!data||!id(data.providerPartyId)||!id(data.agentId))ERR('AGENT_IDENTITY_REQUIRED');
  if(!['a2a','pull_gateway','managed'].includes(data.protocol))ERR('AGENT_PROTOCOL_UNSUPPORTED');
  if(typeof data.displayName!=='string'||!data.displayName.trim()||data.displayName.length>120||/[\u0000-\u001f\u007f]/.test(data.displayName))ERR('AGENT_NAME_INVALID');
  // A pull worker opens an outbound connection to the gateway. Requiring an
  // inbound Agent Card URL would invent an endpoint this protocol does not use.
  if(data.protocol==='pull_gateway'&&(data.agentCardUrl===undefined||data.agentCardUrl===null||data.agentCardUrl==='')){
    return Object.freeze({agentId:data.agentId,providerPartyId:data.providerPartyId,displayName:data.displayName.trim(),
      agentCardUrl:null,protocol:data.protocol,verification:'pending_credential_check',executionEnabled:false});
  }
  const value=typeof data.agentCardUrl==='string'?data.agentCardUrl:'';
  let url;try{url=new URL(value);}catch{ERR('AGENT_CARD_INVALID_URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?)$/i.test(url.hostname))ERR('AGENT_CARD_UNSAFE_ORIGIN');
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)||/(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname))ERR('AGENT_CARD_UNSAFE_ORIGIN');
  return Object.freeze({agentId:data.agentId,providerPartyId:data.providerPartyId,displayName:data.displayName.trim(),
    agentCardUrl:url.toString(),protocol:data.protocol,verification:'pending_endpoint_check',executionEnabled:false});
}

/** Generate only a reviewable proposal, not a runnable dispatch instruction. */
export function makeWorkOrderProposal(input) {
  if(!input||!['projectId','requesterPartyId','agentServiceId','opportunityId'].every(k=>id(input[k])))ERR('WORK_ORDER_REFERENCE_INVALID');
  if(!Array.isArray(input.allowedActions)||!input.allowedActions.length||input.allowedActions.length>10||[...input.allowedActions].some(a=>!allowedActions.has(a)))ERR('WORK_ORDER_ACTION_OUT_OF_POLICY');
  if(!Array.isArray(input.allowedResourceRefs)||input.allowedResourceRefs.length>100||[...input.allowedResourceRefs].some(ref=>typeof ref!=='string'||!/^((product|approved_document|market_public|accepted_deliverable):[A-Za-z0-9._:-]{1,128})$/.test(ref)))ERR('RESOURCE_SCOPE_INVALID');
  if(input.allowSubdelegation!==false)ERR('SUBDELEGATION_FORBIDDEN');
  if(!Number.isSafeInteger(input.maximumMinor)||input.maximumMinor<0||input.maximumMinor>100000000)ERR('BUDGET_INVALID');
  if(typeof input.currency!=='string'||!/^[A-Z]{3}$/.test(input.currency))ERR('CURRENCY_INVALID');
  if(!id(input.acceptanceReviewerPartyId)||input.acceptanceReviewerPartyId!==input.requesterPartyId)ERR('REVIEWER_MUST_BE_REQUESTER');
  if(!Number.isInteger(input.ttlSeconds)||input.ttlSeconds<60||input.ttlSeconds>2592000)ERR('TTL_INVALID');
  return Object.freeze({projectId:input.projectId,requesterPartyId:input.requesterPartyId,
    agentServiceId:input.agentServiceId,opportunityId:input.opportunityId,
    allowedActions:Object.freeze([...new Set(input.allowedActions)].sort()),allowedResourceRefs:Object.freeze([...new Set(input.allowedResourceRefs)].sort()),allowSubdelegation:false,
    maximumMinor:input.maximumMinor,currency:input.currency,ttlSeconds:input.ttlSeconds,
    acceptanceReviewerPartyId:input.requesterPartyId,status:'proposed',dispatchEnabled:false,
    requires:Object.freeze(['server_grant_check','human_authorization','budget_reservation','verified_agent_identity'])});
}

const transitionByEvent = {
  authorize:{from:['proposed'],to:'authorized',role:'requester',fields:['approvalReceiptId','grantId','budgetReservationId']},
  dispatch:{from:['authorized'],to:'queued',role:'host',fields:['dshTaskRef']},
  claim:{from:['queued'],to:'claimed',role:'provider',fields:['claimReceiptId','leaseId','leaseExpiresAt']},
  start:{from:['claimed'],to:'running',role:'provider',fields:['heartbeatReceiptId']},
  deliver:{from:['running'],to:'delivered',role:'provider',fields:['deliverableId','deliveryReceiptId','deliverableSha256']},
  accept:{from:['delivered'],to:'accepted',role:'requester',fields:['acceptanceReceiptId']},
  reject:{from:['delivered'],to:'rejected',role:'requester',fields:['rejectionReceiptId']},
  cancel:{from:['proposed','authorized','queued','claimed','running'],to:null,role:'requester',fields:['cancellationRequestId']},
  stopped:{from:['stop_requested'],to:'cancelled',role:'host',fields:['stopReceiptId']},
  fail:{from:['queued','claimed','running','stop_requested'],to:'failed',role:'host',fields:['failureReceiptId']},
};
function canonicalEvent(event){const keys=Object.keys(event).sort();return JSON.stringify(Object.fromEntries(keys.map(k=>[k,event[k]])));}
function instant(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;
  const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString()===value?time:NaN;
}
function clock(now){if(!Number.isSafeInteger(now)||now<0)ERR('TRUSTED_CLOCK_REQUIRED');return now;}
function orderNotExpired(order,now){
  if(order.expiresAt!==undefined){const expires=instant(order.expiresAt);if(!Number.isFinite(expires)||expires<=clock(now))ERR('WORK_ORDER_EXPIRED');}
}

/**
 * Auth role MUST be derived from server-authenticated principal or verified
 * Agent signature; never accept it from a client JSON body.
 * Authorization requires a server-side grant check, a human approval record,
 * a budget reservation, and a verified provider credential. This reducer only
 * checks receipt shape; it cannot authenticate receipts, reserve funds, or
 * validate a DSH session. Those checks belong in the caller's transaction.
 * Provider identity, current lease and clock MUST come from the authenticated
 * service, never from a model tool payload or incoming worker request body.
 */
export function applyWorkOrderEvent(order,event,{role,actorPartyId,agentServiceId,leaseId,now}={}){
  if(!order||!id(order.id)||!id(order.requesterPartyId)||!id(order.agentServiceId)||!Number.isSafeInteger(order.revision)||order.revision<0||order.revision===Number.MAX_SAFE_INTEGER||!WORK_ORDER_STATES.includes(order.status))ERR('INVALID_WORK_ORDER');
  if(!event||typeof event!=='object'||Array.isArray(event)||!id(event.eventId)||!Object.hasOwn(transitionByEvent,event.kind))ERR('INVALID_WORK_ORDER_EVENT');
  const transition=transitionByEvent[event.kind];
  // Authenticate before looking up an idempotency key. Otherwise replaying a
  // known event can disclose the order to a different provider or requester.
  if(transition.role!==role)ERR('WORK_ORDER_ACTOR_DENIED');
  if(role==='requester'&&actorPartyId!==order.requesterPartyId)ERR('WORK_ORDER_ACTOR_DENIED');
  if(role==='host'&&actorPartyId!=='dsh-host')ERR('WORK_ORDER_ACTOR_DENIED');
  if(role==='provider'){
    if(!id(order.providerPartyId)||actorPartyId!==order.providerPartyId||agentServiceId!==order.agentServiceId)ERR('WORK_ORDER_ACTOR_DENIED');
    clock(now);orderNotExpired(order,now);
    if(event.kind!=='claim'){
      if(!id(order.leaseId)||leaseId!==order.leaseId)ERR('WORK_ORDER_LEASE_DENIED');
      if(!Number.isFinite(instant(order.leaseExpiresAt))||instant(order.leaseExpiresAt)<=now)ERR('WORK_ORDER_LEASE_EXPIRED');
    }else{
      if(order.status!=='queued'&&order.leaseId!==event.leaseId)ERR('WORK_ORDER_LEASE_DENIED');
      if(Number.isFinite(instant(event.leaseExpiresAt))&&instant(event.leaseExpiresAt)<=now)ERR('WORK_ORDER_LEASE_EXPIRED');
    }
  }
  const eventKeys=new Set(['eventId','kind',...transition.fields,...(['accept','reject'].includes(event.kind)?['reviewerPartyId']:[])]);
  if(Object.keys(event).some(key=>!eventKeys.has(key)))ERR('INVALID_WORK_ORDER_EVENT');
  const hash=createHash('sha256').update(canonicalEvent(event)).digest('hex');
  const prior=Array.isArray(order.appliedEvents)?order.appliedEvents.find(x=>x.id===event.eventId):null;
  if(prior){if(prior.sha256!==hash)ERR('EVENT_ID_CONFLICT');return structuredClone(order);}
  if(!transition.from.includes(order.status))ERR('INVALID_WORK_ORDER_TRANSITION');
  if(['authorize','dispatch'].includes(event.kind))orderNotExpired(order,now);
  if(transition.fields.some(f=>f==='leaseExpiresAt'?!Number.isFinite(instant(event[f])):f==='deliverableSha256'?!/^[a-f0-9]{64}$/i.test(event[f]??''):!id(event[f])))ERR('MISSING_TRUSTED_RECEIPT');
  if(event.kind==='claim'){
    const expiry=instant(event.leaseExpiresAt);
    if(expiry<=now||(order.expiresAt!==undefined&&expiry>instant(order.expiresAt)))ERR('WORK_ORDER_LEASE_INVALID');
  }
  if(event.kind==='accept'||event.kind==='reject'){
    if(event.reviewerPartyId!==order.requesterPartyId)ERR('REVIEWER_MUST_BE_REQUESTER');
  }
  if(event.kind==='deliver'&&!/^[a-f0-9]{64}$/i.test(event.deliverableSha256))ERR('DELIVERABLE_HASH_INVALID');
  if(event.kind==='cancel' && ['claimed','running'].includes(order.status) && !id(order.dshTaskRef))ERR('TASK_REF_REQUIRED');
  const next=structuredClone(order);
  next.revision+=1;
  next.status=event.kind==='cancel'&&['claimed','running'].includes(order.status)?'stop_requested':event.kind==='cancel'?'cancelled':transition.to;
  for(const field of transition.fields)next[field]=event[field];
  if(event.kind==='accept'||event.kind==='reject')next.reviewerPartyId=event.reviewerPartyId;
  next.appliedEvents=[...(order.appliedEvents??[]),{id:event.eventId,sha256:hash}];
  return next;
}

export { validateMandateTerms, mandateCoversOrder } from './partner.mjs';
