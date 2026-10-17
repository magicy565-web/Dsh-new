import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';
import { createMarketplace } from '../server/marketplace/service.mjs';
import { chargeMinor, digest, pricePlan, splitMinor } from '../server/marketplace/contracts.mjs';

import { fixture, memoryStore, buyer, seller, reviewer, fixed, timed, tokens } from './fixtures/marketplace.mjs';
const rejects = (fn, code) => assert.rejects(async () => await fn(), e => e.code === code);

test('fixed price and integer fee split conserve every minor unit', () => {
  assert.equal(chargeMinor(fixed), 29900); assert.deepEqual(splitMinor(29900, 1500), { grossMinor: 29900, feeMinor: 4485, providerMinor: 25415 });
  for (let n=0;n<1000;n++) { const s = splitMinor(n, 1733); assert.equal(s.feeMinor+s.providerMinor,n); }
});
test('time and token totals round only once and distinguish cached input', () => {
  assert.equal(chargeMinor(timed, { activeMs: 1001 }), 2);
  assert.equal(chargeMinor(tokens, { inputTokens: 1000000, outputTokens: 1000000, cachedInputTokens: 1000000 }), 5100);
  assert.equal(chargeMinor(tokens, { inputTokens: 10 }), 1);
});
for (const input of [{ ...fixed, amountMinor: -1 }, { ...fixed, amountMinor: 0.1 }, { ...fixed, minorPerHour: 5 }, { ...tokens, inputMinorPerMillion: undefined }, { ...fixed, currency: 'cny' }]) test('invalid price rejected: ' + JSON.stringify(input), () => assert.throws(() => pricePlan(input)));

test('provider publish -> order -> exact consent -> payment -> original delivery -> settlement', async () => {
  const f = await fixture(), o = await f.paid();
  assert.equal(o.status, 'running'); assert.equal(f.stats.submits, 1);
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().marketplace.contracts[0].id, o.id);
  const d = await f.delivered(o); assert.equal(d.status, 'review_required');
  const a = await f.api.accept(buyer, o.id, { confirmed: true, deliveryDigest: d.deliveryDigest }); assert.equal(a.status, 'accepted');
  assert.equal(f.stats.transfers, 0, 'execution completion/acceptance does not silently transfer money');
  const settled = await f.api.settle(reviewer, o.id); assert.equal(settled.settlement.providerMinor, 25415);
  await f.api.settle(reviewer, o.id); assert.equal(f.stats.transfers, 1, 'same transfer never repeated');
});
test('draft/listing publication do not invoke models, workers or payment', async () => { const f=await fixture(); await f.proposed(); assert.deepEqual(f.stats,{submits:0,checkouts:0,transfers:0,refunds:0}); });
test('new offer is invisible until independent review', async () => {
  const f=await fixture(); await f.api.registerProvider(seller,{name:'A',requestId:'a'});
  const l=await f.api.saveListing(seller,{workerId:'worker-a',serviceId:'buyer-discovery',title:'Research',description:'Public only',deliverables:['CSV'],acceptance:['Sources'],prices:[fixed],requestId:'x'});
  assert.equal(f.api.catalog(buyer).length,0);
  await rejects(()=>f.api.reviewListing({...reviewer,subject:seller.subject},{id:l.id,revision:1,approve:true}),'SELF_REVIEW');
});
test('provider cannot claim another providers registered worker', async () => { const f=await fixture(); await f.api.registerProvider(seller,{name:'A',requestId:'a'}); await rejects(()=>f.api.saveListing(seller,{workerId:'worker-c',serviceId:'buyer-discovery',title:'R',description:'D',deliverables:['CSV'],acceptance:['Sources'],prices:[fixed],requestId:'x'}),'BINDING_REQUIRED'); });
test('unknown executable URL/secret and private task fields rejected', async () => {
  const f=await fixture(), l=await f.listing();
  for(const extra of [{endpoint:'https://attacker.example'}, {apiKey:'do-not-accept'}, {providerId:'other'}, {files:['private-file']}, {model:'replacement'}]) await rejects(()=>f.api.createOrder(buyer,{...f.orderInput(l),...extra}),'INVALID_INPUT');
  await rejects(()=>f.api.createOrder(buyer,{...f.orderInput(l),publicDataConfirmed:false}),'DATA_SCOPE_REQUIRED');
});
test('existing listing and immutable order cannot switch price in flight', async () => {
  const f=await fixture(), l=await f.listing(), input=f.orderInput(l), o=await f.api.createOrder(buyer,input);
  const again=await f.api.createOrder(buyer,input); assert.equal(again.id,o.id);
  await rejects(()=>f.api.createOrder(buyer,{...input,objective:'A different goal'}),'IDEMPOTENCY_CONFLICT');
  await rejects(()=>f.api.confirm(buyer,o.id,{confirmed:true,termsHash:'wrong'}),'TERMS_CHANGED');
});
for(const actor of [{...buyer,subject:'other-buyer'}, {...buyer,workspaceId:'other-company'}, {...seller,subject:'provider-c'}]) test('order isolation for '+actor.kind+':'+actor.subject+':'+actor.workspaceId, async()=>{const f=await fixture(), o=await f.proposed(); await rejects(()=>f.api.getOrder(actor,o.id),actor.workspaceId==='factory'?'NOT_FOUND':'FORBIDDEN');});
test('third party sees only its paid authorized order, not unrelated buyer tasks',async()=>{const f=await fixture(),o=await f.paid(); assert.equal(f.api.getOrder(seller,o.id).id,o.id); assert.equal(f.api.orders({...seller,subject:'provider-c'}).length,0);});
test('agent can propose but cannot confirm, pay, accept or grow permissions',async()=>{
  const f=await fixture(), l=await f.listing(), agent={...buyer,human:false}, o=await f.api.createOrder(agent,f.orderInput(l));
  await rejects(()=>f.api.confirm(agent,o.id,{confirmed:true,termsHash:o.termsHash}),'HUMAN_REQUIRED');
  await rejects(()=>f.api.checkout(agent,o.id),'HUMAN_REQUIRED');
  await rejects(()=>f.api.cancel(agent,o.id),'HUMAN_REQUIRED');
});
test('unpaid task cannot start, and generic WorkerDesk cannot bypass commerce',async()=>{
  const f=await fixture(),o=await f.proposed();
  await rejects(()=>f.desk.approve(o.id,buyer.subject,{confirmed:true}),'MARKETPLACE_ROUTE_REQUIRED');
  await rejects(()=>f.desk.dispatch(o.id),'MARKETPLACE_ROUTE_REQUIRED');
  await rejects(()=>f.desk.get(o.id),'MARKETPLACE_ROUTE_REQUIRED');
  assert.equal(f.desk.list().length,0);
  await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});
  await rejects(()=>f.api.start(buyer,o.id),'PAYMENT_REQUIRED'); assert.equal(f.stats.submits,0);
});
test('legacy noncommercial work continues using the original APIs',async()=>{
  const f=await fixture(); const result=await f.desk.create({serviceId:'sales-assets',workerId:'internal',product:'P',market:'US',objective:'Legacy task',budgetCredits:10,deadlineAt:new Date(Date.now()+3600000).toISOString(),requestId:'legacy',publicDataConfirmed:true},buyer.subject);
  await f.desk.approve(result.order.id,buyer.subject,{confirmed:true}); await f.desk.dispatch(result.order.id); assert.equal(f.desk.get(result.order.id).status,'running');
});
test('concurrent checkouts create at most one external payment object',async()=>{
  const f=await fixture(),o=await f.proposed(); await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});
  await Promise.allSettled([f.api.checkout(buyer,o.id),f.api.checkout(buyer,o.id)]); assert.equal(f.stats.checkouts,1);
});
test('lost checkout response stays uncertain instead of charging again',async()=>{
  const f=await fixture(),o=await f.proposed(); await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});f.controls.loseCheckout=true;
  await rejects(()=>f.api.checkout(buyer,o.id),'PAYMENT_UNCERTAIN'); await rejects(()=>f.api.checkout(buyer,o.id),'PAYMENT_UNCERTAIN'); assert.equal(f.stats.checkouts,1);
});
for(const patch of [{currency:'USD'},{amountMinor:1},{orderId:'other'},{termsHash:'wrong'},{live:true},{refundedMinor:-1}]) test('payment mismatch rejected '+JSON.stringify(patch),async()=>{
  const f=await fixture(),o=await f.paid(); f.controls.patchPayment=patch; await assert.rejects(()=>f.api.syncPayment(o.id)); assert.equal(f.stats.submits,1);
});
test('duplicate successful payment observations cannot dispatch twice',async()=>{const f=await fixture(),o=await f.paid();await Promise.all([f.api.syncPayment(o.id,{autoStart:true}),f.api.syncPayment(o.id,{autoStart:true})]);assert.equal(f.stats.submits,1);});
test('late paid event after cancellation never restarts original order',async()=>{
  const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await f.api.checkout(buyer,o.id);await f.api.cancel(buyer,o.id);
  const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor; await f.api.syncPayment(o.id,{autoStart:true});assert.equal(f.stats.submits,0);assert.equal(f.api.getOrder(buyer,o.id).status,'cancelled');
  await f.api.refund(reviewer,o.id);await f.api.refund(reviewer,o.id);assert.equal(f.stats.refunds,1);
});
test('remote response loss reconciles the original job instead of re-executing',async()=>{
  const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await f.api.checkout(buyer,o.id);const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor;f.controls.loseSubmit=true;
  await rejects(()=>f.api.syncPayment(o.id,{autoStart:true}),'DISPATCH_UNCERTAIN');assert.equal(f.api.getOrder(buyer,o.id).status,'dispatch_uncertain');
  await f.api.start(buyer,o.id);assert.equal(f.stats.submits,1);await f.api.refresh(buyer,o.id);assert.equal(f.api.getOrder(buyer,o.id).status,'running');
});
test('cancel request is not a confirmed stop; late delivery cannot undo it',async()=>{
  const f=await fixture(),o=await f.paid();f.controls.pendingStop=true;await f.api.cancel(buyer,o.id);assert.equal(f.api.getOrder(buyer,o.id).status,'cancel_requested');
  f.remote.get(o.id).state='completed';await f.api.refresh(buyer,o.id);assert.equal(f.api.getOrder(buyer,o.id).status,'cancel_requested');await rejects(()=>f.api.refund(reviewer,o.id),'REFUND_BLOCKED');
});
test('stale delivery hash is rejected and remote completion is not auto-acceptance',async()=>{const f=await fixture(),o=await f.paid();await f.delivered(o);await rejects(()=>f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:'old'}),'DELIVERY_CHANGED');await rejects(()=>f.api.settle(reviewer,o.id),'SETTLEMENT_BLOCKED');});
test('dispute freezes transfer and fixed task refund can be reviewed',async()=>{const f=await fixture(),o=await f.paid();await f.delivered(o);await f.api.dispute(buyer,o.id,{reason:'The delivered list is not relevant.'});await rejects(()=>f.api.settle(reviewer,o.id),'SETTLEMENT_BLOCKED');await f.api.refund(reviewer,o.id);assert.equal(f.stats.refunds,1);assert.equal(f.stats.transfers,0);});
test('external partial refund cannot be ignored to pay full provider amount',async()=>{const f=await fixture(),o=await f.paid(),d=await f.delivered(o);await f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:d.deliveryDigest});const p=f.ledger.get(o.id);p.refundedMinor=100;p.status='refunded';await rejects(()=>f.api.settle(reviewer,o.id),'REFUND_MISMATCH');assert.equal(f.stats.transfers,0);});
test('lost transfer response is never retried as a fresh transfer',async()=>{const f=await fixture(),o=await f.paid(),d=await f.delivered(o);await f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:d.deliveryDigest});f.controls.loseTransfer=true;await rejects(()=>f.api.settle(reviewer,o.id),'PAYMENT_UNCERTAIN');await rejects(()=>f.api.settle(reviewer,o.id),'PAYMENT_UNCERTAIN');assert.equal(f.stats.transfers,1);});
test('missing payment config blocks checkout, not internal Agent or listing browsing',async()=>{const f=await fixture({noPayments:true}),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await rejects(()=>f.api.checkout(buyer,o.id),'PAYMENTS_UNCONFIGURED');assert.equal(f.api.catalog(buyer).length,1);});
test('no trusted meter leaves time/token offers visible but unpurchasable',async()=>{const f=await fixture({noMeter:true}),l=await f.listing([fixed,timed,tokens]);assert.deepEqual(f.api.catalog(buyer)[0].prices.map(p=>p.available),[true,false,false]);await rejects(()=>f.api.createOrder(buyer,f.orderInput(l,timed)),'METER_UNAVAILABLE');});
test('time-only provider can publish without pretending to offer fixed prices',async()=>{const f=await fixture();f.bindingRows['worker-a'].priceModes=['time'];await f.listing([timed]);assert.equal(f.api.catalog(buyer)[0].prices[0].mode,'time');});
test('trusted metering reserves before consumption, reconciles usage and refunds surplus',async()=>{
  const f=await fixture(),o=await f.paid([timed]);assert.equal(o.terms.deliveryCommitment,'best-effort-with-budget');
  await f.meter(o,{id:'reserve',kind:'reserve',reservationId:'call-1',maxChargeMinor:20});
  await f.meter(o,{id:'commit',kind:'commit',reservationId:'call-1',usage:{activeMs:10000}});
  await f.meter(o,{id:'commit',kind:'commit',reservationId:'call-1',usage:{activeMs:10000}});
  assert.equal(f.api.getOrder(buyer,o.id).billing.accruedMinor,10);
  const d=await f.delivered(o);await rejects(()=>f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:d.deliveryDigest}),'REVIEW_BLOCKED');
  await f.meter(o,{id:'closed',kind:'close'});await f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:d.deliveryDigest});
  const result=await f.api.settle(reviewer,o.id);assert.equal(result.settlement.grossMinor,10);assert.equal(f.ledger.get(o.id).refundedMinor,90);assert.equal(f.stats.transfers,1);
});
test('supplier self-reported token counts are not trusted',async()=>{const f=await fixture(),o=await f.paid([tokens]);await assert.rejects(()=>f.api.meter({event:{id:'fake',orderId:o.id,kind:'commit',usage:{inputTokens:1000000}}}));assert.equal(f.api.getOrder(buyer,o.id).billing.accruedMinor,0);});
test('concurrent reservations cannot overspend the order deposit',async()=>{const f=await fixture(),o=await f.paid([tokens]);const results=await Promise.allSettled([f.meter(o,{id:'r1',kind:'reserve',reservationId:'1',maxChargeMinor:60}),f.meter(o,{id:'r2',kind:'reserve',reservationId:'2',maxChargeMinor:60})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);});
test('unreserved/over-reservation meter commits cannot charge buyer',async()=>{const f=await fixture(),o=await f.paid([tokens]);await rejects(()=>f.meter(o,{id:'x',kind:'commit',reservationId:'absent',usage:{inputTokens:1}}),'RESERVATION_REQUIRED');await f.meter(o,{id:'r',kind:'reserve',reservationId:'x',maxChargeMinor:1});await rejects(()=>f.meter(o,{id:'c',kind:'commit',reservationId:'x',usage:{inputTokens:5000}}),'METER_OVER_RESERVATION');assert.equal(f.api.getOrder(buyer,o.id).billing.accruedMinor,0);});
test('changed replayed meter event cannot modify charges',async()=>{const f=await fixture(),o=await f.paid([timed]);await f.meter(o,{id:'r',kind:'reserve',reservationId:'x',maxChargeMinor:20});await rejects(()=>f.meter(o,{id:'r',kind:'reserve',reservationId:'x',maxChargeMinor:30}),'IDEMPOTENCY_CONFLICT');});
test('revoked Worker or changed original order cannot start after funding',async()=>{
  const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await f.api.checkout(buyer,o.id);const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor;await f.api.syncPayment(o.id);f.bindingRows['worker-a'].ready=false;await rejects(()=>f.api.start(buyer,o.id),'WORKER_UNAVAILABLE');f.bindingRows['worker-a'].ready=true;await f.store.update(s=>{s.workerOrders[0].objective='changed';});await rejects(()=>f.api.start(buyer,o.id),'ORDER_CHANGED');assert.equal(f.stats.submits,0);
});
test('unpublish blocks new orders without deleting existing contracts',async()=>{const f=await fixture(),l=await f.listing(),o=await f.api.createOrder(buyer,f.orderInput(l));await f.api.unpublish(seller,{id:l.id,revision:l.revision});assert.equal(f.api.catalog(buyer).length,0);assert.equal(f.api.getOrder(buyer,o.id).id,o.id);await rejects(()=>f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash}),'LISTING_CHANGED');});
test('restored registry preserves exact original order identity and rejects tampered terms',async()=>{const f=await fixture(),o=await f.proposed(),state=f.store.read();const restored=await fixture({initial:state});assert.equal(restored.api.getOrder(buyer,o.id).termsHash,o.termsHash);state.marketplace.contracts[0].terms.price.amountMinor=1;await rejects(()=>fixture({initial:state}),'REGISTRY_INVALID');});
test('a second buyer workspace cannot reuse the same Store instance',async()=>{const f=await fixture();const desk=createWorkerServiceDesk({store:f.store});await rejects(()=>createMarketplace({store:f.store,workerDesk:desk,workspaceId:'other',bindings:()=>null}),'ALREADY_INSTALLED');});
test('persisted registry cannot be adopted by a different buyer workspace after restart',async()=>{const f=await fixture(),store=memoryStore(f.store.read()),desk=createWorkerServiceDesk({store});await rejects(()=>createMarketplace({store,workerDesk:desk,workspaceId:'other',bindings:()=>null}),'REGISTRY_INVALID');});

test('lost checkout can be located without creating another payment',async()=>{const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});f.controls.loseCheckout=true;await rejects(()=>f.api.checkout(buyer,o.id),'PAYMENT_UNCERTAIN');const r=await f.api.reconcileCheckout(buyer,o.id);assert.equal(r.state,'created');assert.equal(f.stats.checkouts,1);});
test('lost transfer receipt reconciles without initiating another movement',async()=>{const f=await fixture(),o=await f.paid(),d=await f.delivered(o);await f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:d.deliveryDigest});f.controls.loseTransfer=true;await rejects(()=>f.api.settle(reviewer,o.id),'PAYMENT_UNCERTAIN');await f.api.reconcileMovement(reviewer,o.id,{kind:'transfer'});await f.api.settle(reviewer,o.id);assert.equal(f.stats.transfers,1);});
test('suspending a provider prevents already-paid but unstarted task dispatch',async()=>{const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await f.api.checkout(buyer,o.id);const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor;await f.api.suspendProvider(reviewer,{id:o.terms.providerId,suspended:true,reason:'Safety review'});await rejects(()=>f.api.syncPayment(o.id,{autoStart:true}),'PROVIDER_SUSPENDED');assert.equal(f.stats.submits,0);});
test('changing acceptance clauses after confirmation cannot launch a paid task',async()=>{const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await f.api.checkout(buyer,o.id);const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor;await f.store.update(s=>{s.workerOrders[0].acceptance=['changed scope'];});await rejects(()=>f.api.syncPayment(o.id,{autoStart:true}),'ORDER_CHANGED');});
test('listing create replay after an edit cannot create a second listing',async()=>{const f=await fixture(),l=await f.listing();const input={id:l.id,expectedRevision:l.revision,workerId:l.workerId,serviceId:l.serviceId,title:'Updated',description:l.description,deliverables:l.deliverables,acceptance:l.acceptance,prices:l.prices,requestId:'edit'};await f.api.saveListing(seller,input);const again=await f.api.saveListing(seller,{workerId:l.workerId,serviceId:l.serviceId,title:l.title,description:l.description,deliverables:l.deliverables,acceptance:l.acceptance,prices:l.prices,requestId:'listing-create'});assert.equal(again.id,l.id);assert.equal(f.store.read().marketplace.listings.length,1);});

test('expired Agent execution grant does not require renewed access to settle accepted work',async()=>{const f=await fixture(),o=await f.paid(),d=await f.delivered(o);await f.api.accept(buyer,o.id,{confirmed:true,deliveryDigest:d.deliveryDigest});f.bindingRows['worker-a'].expiresAt=new Date(Date.now()-1000).toISOString();await f.api.settle(reviewer,o.id);assert.equal(f.stats.transfers,1);assert.equal(f.stats.submits,1);});

test('provider cannot inspect an unpaid Agent-proposed draft',async()=>{const f=await fixture(),o=await f.proposed();await rejects(()=>f.api.getOrder(seller,o.id),'NOT_FOUND');assert.equal(f.api.orders(seller).length,0);});
test('provider connections list only its verified original workers and no payout/credential fields',async()=>{const f=await fixture();const connections=f.api.providerConnections(seller);assert.equal(connections.length,1);assert.equal(connections[0].workerId,'worker-a');assert.deepEqual(Object.keys(connections[0]).sort(),['priceModes','ready','serviceIds','workerId']);assert.equal(f.api.providerConnections({...seller,subject:'unregistered-provider'}).length,0);});
test('full task inputs, not only a hash, are available for buyer confirmation',async()=>{const f=await fixture(),o=await f.proposed();assert.equal(o.input.product,'Public fabric description');assert.equal(o.input.market,'US');assert.equal(o.input.objective,o.objective);assert.equal(o.terms.dataScope,'public-only');});

test('paid authorization is rechecked inside the original dispatch commit after a queued refund update',async()=>{const f=await fixture(),o=await f.proposed();await f.api.confirm(buyer,o.id,{confirmed:true,termsHash:o.termsHash});await f.api.checkout(buyer,o.id);const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor;await f.api.syncPayment(o.id);const refundWrite=f.store.update(s=>{const c=s.marketplace.contracts[0];c.payment.refundedMinor=1;c.payment.status='refunded';});await rejects(()=>f.api.start(buyer,o.id),'PAYMENT_REQUIRED');await refundWrite;assert.equal(f.api.getOrder(buyer,o.id).status,'approved');assert.equal(f.stats.submits,0);});
test('late verified metering closes an existing reservation without renewing expired execution access',async()=>{const f=await fixture(),o=await f.paid([timed]);await f.meter(o,{id:'r',kind:'reserve',reservationId:'call',maxChargeMinor:10});f.bindingRows['worker-a'].expiresAt=new Date(Date.now()-1000).toISOString();await f.meter(o,{id:'c',kind:'commit',reservationId:'call',usage:{activeMs:1000}});await f.delivered(o);await f.meter(o,{id:'close',kind:'close'});assert.equal(f.api.getOrder(buyer,o.id).billing.meterClosed,true);await rejects(()=>f.meter(o,{id:'new',kind:'reserve',reservationId:'new-call',maxChargeMinor:1}),'METER_CLOSED');});
