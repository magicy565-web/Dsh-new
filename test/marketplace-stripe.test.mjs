import test from 'node:test';
import assert from 'node:assert/strict';
import { createStripeMarketplacePayments } from '../server/marketplace/stripe.mjs';

// SDK-shaped fixture, NOT an installed official SDK or a Stripe account test.
const expected={orderId:'order1',termsHash:'hash1',amountMinor:1000,currency:'CNY',title:'Public research',idempotencyKey:'mp:original:once',createdAt:'2026-10-15T00:00:00.000Z',paymentId:'pi_1',sourceRef:'ch_1',destination:'acct_a'};
async function fixture(overrides={}) {
  const calls=[];
  const charge={id:'ch_1',payment_intent:'pi_1',amount:1000,currency:'cny',amount_refunded:0,paid:true,disputed:false,livemode:false};
  const pi={id:'pi_1',metadata:{marketplaceOrderId:'order1',termsHash:'hash1'},amount:1000,amount_received:1000,currency:'cny',livemode:false,status:'succeeded',latest_charge:charge};
  const session={id:'cs_1',mode:'payment',client_reference_id:'order1',metadata:{termsHash:'hash1',marketplaceOperationKey:expected.idempotencyKey},amount_total:1000,currency:'cny',livemode:false,url:'https://checkout.stripe.com/fixture',payment_status:'paid',payment_intent:pi};
  const transfer={id:'tr_1',amount:1000,currency:'cny',destination:'acct_a',source_transaction:'ch_1',livemode:false,reversed:false,amount_reversed:0,metadata:{marketplaceOperationKey:expected.idempotencyKey}};
  const refund={id:'re_1',amount:1000,currency:'cny',payment_intent:'pi_1',status:'succeeded',metadata:{marketplaceOperationKey:expected.idempotencyKey}};
  const stripe={
    accounts:{retrieve:async id=>id?{id,details_submitted:true,capabilities:{transfers:'active'}}:{id:'acct_platform',charges_enabled:true}},
    checkout:{sessions:{create:async(...args)=>{calls.push(['checkout',...args]);return session;},retrieve:async()=>session,list:async args=>({data:[session],has_more:false})}},
    paymentIntents:{retrieve:async()=>pi},charges:{retrieve:async()=>charge},
    transfers:{create:async(...args)=>{calls.push(['transfer',...args]);return transfer;},list:async()=>({data:[transfer],has_more:false})},
    refunds:{create:async(...args)=>{calls.push(['refund',...args]);return refund;},list:async()=>({data:[refund],has_more:false})},
    webhooks:{constructEvent:(raw,sig,secret)=>{assert.ok(Buffer.isBuffer(raw));assert.equal(sig,'fixture-valid');assert.equal(secret,'fixture-webhook-secret-only');return JSON.parse(raw.toString());}},
  };
  Object.assign(stripe,overrides);
  const api=await createStripeMarketplacePayments({stripe,platformAccountId:'acct_platform',webhookSecret:'fixture-webhook-secret-only',returnOrigin:'https://market.example',live:false});
  return {api,stripe,calls,session,pi,charge,transfer,refund};
}
test('checkout uses exact integer amount, metadata and stable original idempotency key',async()=>{const f=await fixture();await f.api.checkout(expected);const[,body,options]=f.calls[0];assert.equal(body.line_items[0].price_data.unit_amount,1000);assert.equal(body.client_reference_id,'order1');assert.equal(options.idempotencyKey,expected.idempotencyKey);assert.equal(body.payment_intent_data.metadata.termsHash,expected.termsHash);});
test('payment verification independently reads checkout, PaymentIntent and charge identities',async()=>{const f=await fixture();const p=await f.api.readCheckout('cs_1');assert.equal(p.status,'paid');assert.equal(p.receivedMinor,1000);f.charge.payment_intent='foreign';await assert.rejects(()=>f.api.readCheckout('cs_1'),e=>e.code==='STRIPE_CHARGE_MISMATCH');});
test('wrong live/test environment and exact quote amount reject checkout',async()=>{const f=await fixture();f.session.livemode=true;await assert.rejects(()=>f.api.checkout(expected));f.session.livemode=false;f.session.amount_total=1001;await assert.rejects(()=>f.api.checkout(expected));});
test('transfer sends only pinned destination and original source charge',async()=>{const f=await fixture();await f.api.transfer(expected);assert.equal(f.calls[0][1].destination,'acct_a');assert.equal(f.calls[0][1].source_transaction,'ch_1');assert.equal(f.calls[0][1].transfer_group,'mp_order1');});
test('partial transfer reversal is not recognized as a full successful payout',async()=>{const f=await fixture();f.transfer.amount_reversed=1;await assert.rejects(()=>f.api.reconcileOperation({...expected,kind:'transfer'}));});
test('incomplete provider payment onboarding fails before initiating transfer',async()=>{const f=await fixture();f.stripe.accounts.retrieve=async id=>({id,details_submitted:false,capabilities:{transfers:'pending'}});await assert.rejects(()=>f.api.transfer(expected));assert.equal(f.calls.length,0);});
test('pending refund remains pending and uses exact original payment',async()=>{const f=await fixture();f.refund.status='pending';const r=await f.api.refund(expected);assert.equal(r.status,'pending');assert.equal(f.calls[0][1].payment_intent,'pi_1');});
test('reconcile searches existing processor records without new money movement',async()=>{const f=await fixture();assert.equal((await f.api.reconcileCheckout(expected)).id,'cs_1');assert.equal((await f.api.reconcileOperation({...expected,kind:'transfer'})).id,'tr_1');assert.equal(f.calls.length,0);});
test('ambiguous reconciliation rejects two matching processor records',async()=>{const f=await fixture();f.stripe.transfers.list=async()=>({data:[f.transfer,{...f.transfer,id:'tr_2'}],has_more:false});await assert.rejects(()=>f.api.reconcileOperation({...expected,kind:'transfer'}),e=>e.code==='PAYMENT_AMBIGUOUS');});
test('webhook delegates verification to official SDK and rejects account or environment drift',async()=>{const f=await fixture();const event={id:'evt_1',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_1'}}};assert.deepEqual(f.api.verifyEvent(Buffer.from(JSON.stringify(event)),'fixture-valid'),{eventId:'evt_1',checkoutId:'cs_1'});assert.throws(()=>f.api.verifyEvent(Buffer.from(JSON.stringify({...event,account:'acct_foreign'})),'fixture-valid'));assert.throws(()=>f.api.verifyEvent(Buffer.from(JSON.stringify(event)),'bad-signature'));});
