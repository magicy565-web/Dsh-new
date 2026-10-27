import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAgentRegistrationProposal,makeWorkOrderProposal,applyWorkOrderEvent} from '../src/index.mjs';

const proposal=()=>({projectId:'p1',requesterPartyId:'agency1',agentServiceId:'agent1',opportunityId:'opp1',allowedActions:['public_web_research','draft_outreach'],allowedResourceRefs:['product:sku1'],allowSubdelegation:false,maximumMinor:30000,currency:'CNY',ttlSeconds:3600,acceptanceReviewerPartyId:'agency1'});
const order=()=>({id:'wo1',status:'proposed',revision:1,requesterPartyId:'agency1',agentServiceId:'agent1',appliedEvents:[]});

test('remote Agent Card is only a registration proposal, never verified',()=>{
 const card=createAgentRegistrationProposal({providerPartyId:'provider1',agentId:'agent1',displayName:'US Scout',protocol:'a2a',agentCardUrl:'https://example.org/card.json'});
 assert.equal(card.verification,'pending_endpoint_check');assert.equal(card.executionEnabled,false);
 for(const url of ['http://example.org/x','https://127.0.0.1/card','https://localhost/card','https://169.254.1.1/card','https://bob:pass@example.org/card','https://example.org/x?token=s']){
  assert.throws(()=>createAgentRegistrationProposal({providerPartyId:'provider1',agentId:'agent1',displayName:'Scout',protocol:'a2a',agentCardUrl:url}));
 }
});
test('proposal forbids unknown tools, unscoped resources and auto dispatch',()=>{
 const p=makeWorkOrderProposal(proposal());
 assert.equal(p.status,'proposed');assert.equal(p.dispatchEnabled,false);
 assert.ok(p.requires.includes('human_authorization'));
 for(const patch of [{allowSubdelegation:true},{allowedActions:['send_any_email']},{allowedResourceRefs:['price:secret']},{maximumMinor:-1},{acceptanceReviewerPartyId:'other'}]){
  assert.throws(()=>makeWorkOrderProposal({...proposal(),...patch}));
 }
});
test('delegation FSM requires approval, DSH taskRef, Agent lease, deliverable and human receipt',()=>{
 let a=order();
 const advance=(event,role,actorPartyId)=>{a=applyWorkOrderEvent(a,event,{role,actorPartyId});};
 assert.throws(()=>advance({kind:'dispatch',eventId:'e0',dshTaskRef:'task1'},'host'),/TRANSITION/);
 advance({kind:'authorize',eventId:'e1',approvalReceiptId:'approval1',grantId:'grant1',budgetReservationId:'reserve1'},'requester','agency1');
 advance({kind:'dispatch',eventId:'e2',dshTaskRef:'task1'},'host');
 assert.throws(()=>advance({kind:'claim',eventId:'e3',claimReceiptId:'c1',leaseId:'l1'},'requester','agency1'),/ACTOR_DENIED/);
 advance({kind:'claim',eventId:'e3',claimReceiptId:'c1',leaseId:'l1'},'provider');
 advance({kind:'start',eventId:'e4',heartbeatReceiptId:'heartbeat1'},'provider');
 assert.equal(a.status,'running');
 assert.throws(()=>advance({kind:'deliver',eventId:'e5',deliverableId:'artifact1',deliveryReceiptId:'delivery1',deliverableSha256:'broken'},'provider'));
 advance({kind:'deliver',eventId:'e5',deliverableId:'artifact1',deliveryReceiptId:'delivery1',deliverableSha256:'a'.repeat(64)},'provider');
 assert.equal(a.status,'delivered');
 assert.throws(()=>advance({kind:'accept',eventId:'e6',acceptanceReceiptId:'accept1',reviewerPartyId:'other'},'requester','agency1'),/REVIEWER/);
 advance({kind:'accept',eventId:'e6',acceptanceReceiptId:'accept1',reviewerPartyId:'agency1'},'requester','agency1');
 assert.equal(a.status,'accepted');assert.equal(a.revision,7);
});
test('event replay is idempotent; same id with altered payload cannot be replayed',()=>{
 const a=order();const e={kind:'authorize',eventId:'e1',approvalReceiptId:'a1',grantId:'g1',budgetReservationId:'b1'};
 const one=applyWorkOrderEvent(a,e,{role:'requester',actorPartyId:'agency1'});
 assert.deepEqual(applyWorkOrderEvent(one,e,{role:'requester',actorPartyId:'agency1'}),one);
 assert.throws(()=>applyWorkOrderEvent(one,{...e,grantId:'g2'},{role:'requester',actorPartyId:'agency1'}),/EVENT_ID_CONFLICT/);
});
test('requesting stop never means stopped without a real Host receipt',()=>{
 let a=order();
 a=applyWorkOrderEvent(a,{kind:'authorize',eventId:'e1',approvalReceiptId:'a1',grantId:'g1',budgetReservationId:'b1'},{role:'requester',actorPartyId:'agency1'});
 a=applyWorkOrderEvent(a,{kind:'dispatch',eventId:'e2',dshTaskRef:'task1'},{role:'host'});
 a=applyWorkOrderEvent(a,{kind:'claim',eventId:'e3',claimReceiptId:'c1',leaseId:'l1'},{role:'provider'});
 a=applyWorkOrderEvent(a,{kind:'cancel',eventId:'e4',cancellationRequestId:'cancel1'},{role:'requester',actorPartyId:'agency1'});
 assert.equal(a.status,'stop_requested');
 assert.throws(()=>applyWorkOrderEvent(a,{kind:'stopped',eventId:'e5'},{role:'host'}),/MISSING_TRUSTED_RECEIPT/);
 a=applyWorkOrderEvent(a,{kind:'stopped',eventId:'e5',stopReceiptId:'stop1'},{role:'host'});
 assert.equal(a.status,'cancelled');
});
test('cross-requester attempt is denied even when role string is requester',()=>{
 assert.throws(()=>applyWorkOrderEvent(order(),{kind:'authorize',eventId:'e1',approvalReceiptId:'a1',grantId:'g1',budgetReservationId:'b1'},{role:'requester',actorPartyId:'other'}),/ACTOR_DENIED/);
});
