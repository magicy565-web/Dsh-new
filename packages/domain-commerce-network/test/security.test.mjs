import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkOrderEvent,createAgentRegistrationProposal,makeWorkOrderProposal} from '../src/index.mjs';

const NOW=Date.parse('2026-10-28T00:00:00.000Z');
const expiry=offset=>new Date(NOW+offset).toISOString();
const host={role:'host',actorPartyId:'dsh-host',now:NOW};
const requester={role:'requester',actorPartyId:'factory',now:NOW};
const provider={role:'provider',actorPartyId:'provider',agentServiceId:'scout',leaseId:'lease',now:NOW};
const queued=()=>({id:'work',projectId:'project',requesterPartyId:'factory',providerPartyId:'provider',agentServiceId:'scout',status:'queued',revision:3,appliedEvents:[],dshTaskRef:'dsh-task',expiresAt:expiry(3_600_000)});
const claim={kind:'claim',eventId:'claim-event',claimReceiptId:'claim-receipt',leaseId:'lease',leaseExpiresAt:expiry(60_000)};
const start={kind:'start',eventId:'start-event',heartbeatReceiptId:'heartbeat'};
const deliver={kind:'deliver',eventId:'delivery-event',deliverableId:'artifact',deliveryReceiptId:'delivery',deliverableSha256:'a'.repeat(64)};
const claimed=()=>applyWorkOrderEvent(queued(),claim,provider);
const running=()=>applyWorkOrderEvent(claimed(),start,provider);
const proposal=()=>({projectId:'project',requesterPartyId:'factory',agentServiceId:'scout',opportunityId:'opportunity',allowedActions:['public_web_research'],allowedResourceRefs:[],allowSubdelegation:false,maximumMinor:0,currency:'USD',ttlSeconds:3600,acceptanceReviewerPartyId:'factory'});

test('known event replay does not authorize a different requester or provider',()=>{
  const a=claimed();
  for(const principal of [{...provider,actorPartyId:'intruder'},{...provider,agentServiceId:'other-agent'},{...requester,actorPartyId:'intruder'},{role:'provider'}]){
    assert.throws(()=>applyWorkOrderEvent(a,claim,principal),/ACTOR_DENIED/);
  }
  const approved={...queued(),status:'proposed'};
  const event={kind:'authorize',eventId:'approval',approvalReceiptId:'approval-receipt',grantId:'grant',budgetReservationId:'reservation'};
  const result=applyWorkOrderEvent(approved,event,requester);
  assert.throws(()=>applyWorkOrderEvent(result,event,{...requester,actorPartyId:'intruder'}),/ACTOR_DENIED/);
});

test('a provider credential cannot act for a second service owned by the same provider',()=>{
  assert.throws(()=>applyWorkOrderEvent(queued(),claim,{...provider,agentServiceId:'different-service'}),/ACTOR_DENIED/);
  assert.throws(()=>applyWorkOrderEvent({...queued(),providerPartyId:undefined},claim,provider),/ACTOR_DENIED/);
});

test('expired, missing and mismatched leases cannot start or deliver, including replay',()=>{
  const a=running();
  for(const event of [start,deliver]){
    for(const principal of [{...provider,leaseId:undefined},{...provider,leaseId:'old-lease'}]){
      assert.throws(()=>applyWorkOrderEvent(a,event,principal),/LEASE_DENIED/);
    }
    assert.throws(()=>applyWorkOrderEvent(a,event,{...provider,now:NOW+60_000}),/LEASE_EXPIRED/);
    assert.throws(()=>applyWorkOrderEvent({...a,leaseExpiresAt:undefined},event,provider),/LEASE_EXPIRED/);
  }
  assert.throws(()=>applyWorkOrderEvent(claimed(),claim,{...provider,now:NOW+60_000}),/LEASE_EXPIRED/);
  assert.throws(()=>applyWorkOrderEvent({...claimed(),leaseId:'replacement-lease'},claim,provider),/LEASE_DENIED/);
});

test('claim requires a real future deadline bounded by the order TTL',()=>{
  assert.throws(()=>applyWorkOrderEvent(queued(),{...claim,leaseExpiresAt:expiry(3_600_001)},provider),/LEASE_INVALID/);
  assert.throws(()=>applyWorkOrderEvent(queued(),{...claim,leaseExpiresAt:expiry(0)},provider),/LEASE_EXPIRED/);
  assert.throws(()=>applyWorkOrderEvent(queued(),{...claim,leaseExpiresAt:'2026-02-31T00:00:00.000Z'},provider),/MISSING_TRUSTED_RECEIPT/);
  assert.throws(()=>applyWorkOrderEvent(queued(),claim,{...provider,now:undefined}),/TRUSTED_CLOCK_REQUIRED/);
  assert.throws(()=>applyWorkOrderEvent({...queued(),expiresAt:expiry(0)},claim,provider),/WORK_ORDER_EXPIRED/);
});

test('expiry blocks new execution but preserves cancellation and human acceptance',()=>{
  assert.throws(()=>applyWorkOrderEvent({...queued(),status:'authorized',expiresAt:expiry(0)},{kind:'dispatch',eventId:'dispatch',dshTaskRef:'task'},host),/WORK_ORDER_EXPIRED/);
  const cancelled=applyWorkOrderEvent({...queued(),expiresAt:expiry(0)},{kind:'cancel',eventId:'cancel',cancellationRequestId:'cancel-receipt'},requester);
  assert.equal(cancelled.status,'cancelled');
  const delivered=applyWorkOrderEvent(running(),deliver,provider);
  const accepted=applyWorkOrderEvent(delivered,{kind:'accept',eventId:'accept',acceptanceReceiptId:'accept-receipt',reviewerPartyId:'factory'},{...requester,now:NOW+7_200_000});
  assert.equal(accepted.status,'accepted');
});

test('stop request blocks late worker delivery without pretending the worker stopped',()=>{
  const cancelled=applyWorkOrderEvent(running(),{kind:'cancel',eventId:'cancel',cancellationRequestId:'cancel-receipt'},requester);
  assert.equal(cancelled.status,'stop_requested');
  assert.throws(()=>applyWorkOrderEvent(cancelled,deliver,provider),/TRANSITION/);
  assert.throws(()=>applyWorkOrderEvent(cancelled,{kind:'stopped',eventId:'stopped',stopReceiptId:'receipt'},{...host,actorPartyId:'provider'}),/ACTOR_DENIED/);
  assert.equal(applyWorkOrderEvent(cancelled,{kind:'stopped',eventId:'stopped',stopReceiptId:'receipt'},host).status,'cancelled');
});

test('unknown inherited event names and payload authority injection are rejected',()=>{
  for(const kind of ['constructor','toString','__proto__'])assert.throws(()=>applyWorkOrderEvent(queued(),{kind,eventId:'x'},host),/INVALID_WORK_ORDER_EVENT/);
  assert.throws(()=>applyWorkOrderEvent(queued(),{...claim,role:'host'},provider),/INVALID_WORK_ORDER_EVENT/);
  assert.throws(()=>applyWorkOrderEvent(queued(),{...claim,deliverable:{secret:'leak'}},provider),/INVALID_WORK_ORDER_EVENT/);
});

test('pull registration needs no fake inbound endpoint and never self-verifies',()=>{
  const card=createAgentRegistrationProposal({providerPartyId:'provider',agentId:'scout',displayName:'Scout',protocol:'pull_gateway'});
  assert.equal(card.agentCardUrl,null);
  assert.equal(card.verification,'pending_credential_check');
  assert.equal(card.executionEnabled,false);
  for(const url of ['https://worker.localhost/card','https://worker.internal/card','https://worker.local/card']){
    assert.throws(()=>createAgentRegistrationProposal({providerPartyId:'provider',agentId:'scout',displayName:'Scout',protocol:'a2a',agentCardUrl:url}),/UNSAFE_ORIGIN/);
  }
});

test('proposal permissions remain immutable and cannot contain hidden sparse values or private prices',()=>{
  const a=makeWorkOrderProposal(proposal());
  assert.throws(()=>a.allowedActions.push('send_email'),TypeError);
  assert.throws(()=>a.allowedResourceRefs.push('price:floor'),TypeError);
  for(const patch of [{allowedActions:['send_email']},{allowedActions:Array(1)},{allowedResourceRefs:Array(1)},{allowedResourceRefs:['price:floor']},{allowedResourceRefs:['product:../secrets']},{allowedResourceRefs:['approved_document:*']},{allowSubdelegation:true},{maximumMinor:0.5}]){
    assert.throws(()=>makeWorkOrderProposal({...proposal(),...patch}));
  }
});

test('successful and denied events never mutate input records',()=>{
  const a=queued(),snapshot=structuredClone(a);
  const next=applyWorkOrderEvent(a,claim,provider);
  assert.deepEqual(a,snapshot);
  next.appliedEvents[0].id='changed';
  assert.deepEqual(a,snapshot);
  assert.throws(()=>applyWorkOrderEvent(a,claim,{...provider,agentServiceId:'other'}));
  assert.deepEqual(a,snapshot);
});

test('accepted output references require explicit selection and never wildcard an entire predecessor',()=>{
  const p=makeWorkOrderProposal({...proposal(),allowedResourceRefs:['accepted_deliverable:previous-work-order']});
  assert.deepEqual(p.allowedResourceRefs,['accepted_deliverable:previous-work-order']);
  for(const ref of ['deliverable:any','accepted_deliverable:*','accepted_deliverable:','accepted_deliverable:../other']){
    assert.throws(()=>makeWorkOrderProposal({...proposal(),allowedResourceRefs:[ref]}),/RESOURCE_SCOPE_INVALID/);
  }
  // Whether that exact output is actually accepted and belongs to the current
  // workspace/project is deliberately checked by the service, not the syntax rule.
});
