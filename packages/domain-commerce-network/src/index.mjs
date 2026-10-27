import {createHash} from 'node:crypto';

/**
 * Pure Work Order contract; MUST be invoked behind server-authenticated,
 * tenant-scoped storage and approval APIs. This module does not dispatch,
 * authorize, contact buyers, charge money, or execute third-party code.
 */
const id = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const allowedActions = new Set(['public_web_research','read_granted_product_context','draft_outreach','classify_opted_in_replies','summarize_rfq']);
export const WORK_ORDER_STATES = Object.freeze(['proposed','authorized','queued','claimed','running','delivered','accepted','rejected','stop_requested','cancelled','failed']);
const ERR = code => {throw new Error(code);};

/** Untrusted Agent Cards are proposals, never verified skills or authority. */
export function createAgentRegistrationProposal(data) {
  if(!data||!id(data.providerPartyId)||!id(data.agentId))ERR('AGENT_IDENTITY_REQUIRED');
  const value=typeof data.agentCardUrl==='string'?data.agentCardUrl:'';
  let url;try{url=new URL(value);}catch{ERR('AGENT_CARD_INVALID_URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?)$/i.test(url.hostname))ERR('AGENT_CARD_UNSAFE_ORIGIN');
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname))ERR('AGENT_CARD_UNSAFE_ORIGIN');
  if(!['a2a','pull_gateway','managed'].includes(data.protocol))ERR('AGENT_PROTOCOL_UNSUPPORTED');
  if(typeof data.displayName!=='string'||!data.displayName.trim()||data.displayName.length>120)ERR('AGENT_NAME_INVALID');
  return Object.freeze({agentId:data.agentId,providerPartyId:data.providerPartyId,displayName:data.displayName.trim(),
    agentCardUrl:url.toString(),protocol:data.protocol,verification:'pending_endpoint_check',executionEnabled:false});
}

/** Generate only a reviewable proposal, not a runnable dispatch instruction. */
export function makeWorkOrderProposal(input) {
  if(!input||!['projectId','requesterPartyId','agentServiceId','opportunityId'].every(k=>id(input[k])))ERR('WORK_ORDER_REFERENCE_INVALID');
  if(!Array.isArray(input.allowedActions)||!input.allowedActions.length||input.allowedActions.length>10||input.allowedActions.some(a=>!allowedActions.has(a)))ERR('WORK_ORDER_ACTION_OUT_OF_POLICY');
  if(!Array.isArray(input.allowedResourceRefs)||input.allowedResourceRefs.length>100||input.allowedResourceRefs.some(ref=>typeof ref!=='string'||!/^((product|approved_document|market_public):[A-Za-z0-9._:-]{1,128})$/.test(ref)))ERR('RESOURCE_SCOPE_INVALID');
  if(input.allowSubdelegation!==false)ERR('SUBDELEGATION_FORBIDDEN');
  if(!Number.isSafeInteger(input.maximumMinor)||input.maximumMinor<0||input.maximumMinor>100000000)ERR('BUDGET_INVALID');
  if(!/^[A-Z]{3}$/.test(input.currency||''))ERR('CURRENCY_INVALID');
  if(!id(input.acceptanceReviewerPartyId)||input.acceptanceReviewerPartyId!==input.requesterPartyId)ERR('REVIEWER_MUST_BE_REQUESTER');
  if(!Number.isInteger(input.ttlSeconds)||input.ttlSeconds<60||input.ttlSeconds>2592000)ERR('TTL_INVALID');
  return Object.freeze({projectId:input.projectId,requesterPartyId:input.requesterPartyId,
    agentServiceId:input.agentServiceId,opportunityId:input.opportunityId,
    allowedActions:[...new Set(input.allowedActions)].sort(),allowedResourceRefs:[...new Set(input.allowedResourceRefs)].sort(),allowSubdelegation:false,
    maximumMinor:input.maximumMinor,currency:input.currency,ttlSeconds:input.ttlSeconds,
    acceptanceReviewerPartyId:input.requesterPartyId,status:'proposed',dispatchEnabled:false,
    requires:['server_grant_check','human_authorization','budget_reservation','verified_agent_endpoint']});
}

const transitionByEvent = {
  authorize:{from:['proposed'],to:'authorized',role:'requester',fields:['approvalReceiptId','grantId','budgetReservationId']},
  dispatch:{from:['authorized'],to:'queued',role:'host',fields:['dshTaskRef']},
  claim:{from:['queued'],to:'claimed',role:'provider',fields:['claimReceiptId','leaseId']},
  start:{from:['claimed'],to:'running',role:'provider',fields:['heartbeatReceiptId']},
  deliver:{from:['running'],to:'delivered',role:'provider',fields:['deliverableId','deliveryReceiptId','deliverableSha256']},
  accept:{from:['delivered'],to:'accepted',role:'requester',fields:['acceptanceReceiptId']},
  reject:{from:['delivered'],to:'rejected',role:'requester',fields:['rejectionReceiptId']},
  cancel:{from:['proposed','authorized','queued','claimed','running'],to:null,role:'requester',fields:['cancellationRequestId']},
  stopped:{from:['stop_requested'],to:'cancelled',role:'host',fields:['stopReceiptId']},
  fail:{from:['queued','claimed','running','stop_requested'],to:'failed',role:'host',fields:['failureReceiptId']},
};
function canonicalEvent(event){const keys=Object.keys(event).sort();return JSON.stringify(Object.fromEntries(keys.map(k=>[k,event[k]])));}

/**
 * Auth role MUST be derived from server-authenticated principal or verified
 * Agent signature; never accept it from a client JSON body.
 * Authorization requires a server-side grant check, a human approval record,
 * a budget reservation, and an endpoint ownership verification.
 */
export function applyWorkOrderEvent(order,event,{role,actorPartyId}={}){
  if(!order||!id(order.id)||!id(order.requesterPartyId)||!id(order.agentServiceId)||!Number.isSafeInteger(order.revision)||!WORK_ORDER_STATES.includes(order.status))ERR('INVALID_WORK_ORDER');
  if(!event||!id(event.eventId)||!transitionByEvent[event.kind])ERR('INVALID_WORK_ORDER_EVENT');
  const hash=createHash('sha256').update(canonicalEvent(event)).digest('hex');
  const prior=Array.isArray(order.appliedEvents)?order.appliedEvents.find(x=>x.id===event.eventId):null;
  if(prior){if(prior.sha256!==hash)ERR('EVENT_ID_CONFLICT');return structuredClone(order);}
  const transition=transitionByEvent[event.kind];
  if(transition.role!==role)ERR('WORK_ORDER_ACTOR_DENIED');
  if(role==='requester'&&actorPartyId!==order.requesterPartyId)ERR('WORK_ORDER_ACTOR_DENIED');
  if(!transition.from.includes(order.status))ERR('INVALID_WORK_ORDER_TRANSITION');
  if(transition.fields.some(f=>!id(event[f]) && !(f==='deliverableSha256'&&typeof event[f]==='string'&&/^[a-f0-9]{64}$/i.test(event[f]))))ERR('MISSING_TRUSTED_RECEIPT');
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
