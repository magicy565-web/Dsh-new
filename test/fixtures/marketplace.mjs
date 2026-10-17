import assert from 'node:assert/strict';
import { createWorkerServiceDesk } from '../../server/worker-desk.mjs';
import { createMarketplace } from '../../server/marketplace/service.mjs';
// REAL original WorkerDesk; explicitly synthetic identities, transactional
// memory Store, payment processor, remote execution and metering witnesses.
// These tests do NOT establish model quality, production durability or payment.
export const buyer = { kind: 'buyer', subject: 'enterprise-b', workspaceId: 'factory', role: 'admin', human: true };
export const seller = { kind: 'provider', subject: 'provider-a', workspaceId: 'factory', role: 'owner', human: true };
export const reviewer = { kind: 'reviewer', subject: 'platform-reviewer', workspaceId: 'factory', role: 'admin', human: true };
export const fixed = { id: 'fixed', mode: 'fixed', currency: 'CNY', amountMinor: 29900 };
export const timed = { id: 'time', mode: 'time', currency: 'CNY', minorPerHour: 3600 };
export const tokens = { id: 'token', mode: 'token', currency: 'CNY', inputMinorPerMillion: 1000, outputMinorPerMillion: 4000, cachedInputMinorPerMillion: 100 };
export function memoryStore(initial = { workerOrders: [] }) {
  let state = structuredClone(initial), tail = Promise.resolve();
  return {
    read: () => structuredClone(state),
    update(fn) {
      const result = tail.then(() => { const draft = structuredClone(state); const value = fn(draft); assert.ok(!value?.then, 'transaction must be synchronous'); state = draft; return structuredClone(value); });
      tail = result.catch(() => {}); return result;
    },
  };
}
export async function fixture({ initial, noPayments = false, noMeter = false, install = true } = {}) {
  const store = memoryStore(initial), remote = new Map(), ledger = new Map(), stats = { submits: 0, checkouts: 0, transfers: 0, refunds: 0 };
  const controls = { loseSubmit: false, loseCheckout: false, loseTransfer: false, pendingStop: false, patchPayment: null };
  const adapter = {
    services: ['buyer-discovery', 'sales-assets'], ready: true, budgetEnforced: true, displayName: 'Provider Agent fixture',
    async submit(t) { stats.submits++; remote.set(t.orderId, { ...structuredClone(t), state: 'working' }); if (controls.loseSubmit) throw Error('synthetic response loss'); return { jobId: t.orderId }; },
    async get(jobId, orderId) {
      const r = remote.get(jobId);
      return { jobId, orderId, status: r?.state || 'working',
        ...(r?.state === 'completed' ? { deliverables: [{ name: 'prospects.csv', type: 'table', summary: 'Synthetic sourced prospect fixture' }], evidence: [{ title: 'Fixture source', url: 'https://example.org', detail: 'Test source only' }], prospects: [{ name: 'Synthetic Company', country: 'US', website: 'https://example.org', sourceUrl: 'https://example.org', fitReason: 'Fixture only' }] } : {}) };
    },
    async reconcile(orderId) { return this.get(orderId, orderId); },
    async cancel(jobId) { if (controls.pendingStop) return { status: 'cancel_requested' }; if (remote.has(jobId)) remote.get(jobId).state = 'cancelled'; return { status: 'cancelled' }; },
  };
  const bindingRows = {
    'worker-a': { workerId: 'worker-a', providerSubject: seller.subject, commercialOnly: true, publicOnly: true, verified: true, ready: true, serviceIds: ['buyer-discovery', 'sales-assets'], expiresAt: new Date(Date.now()+86400000).toISOString(), priceModes: ['fixed', 'time', 'token'], meterAuthority: 'trusted-fixture-meter', legacyBudgetCredits: 10, payoutAccountRef: 'acct_provider_a' },
    'worker-c': { workerId: 'worker-c', providerSubject: 'provider-c', commercialOnly: true, publicOnly: true, verified: true, ready: true, serviceIds: ['buyer-discovery'], expiresAt: new Date(Date.now()+86400000).toISOString(), priceModes: ['fixed'], legacyBudgetCredits: 10, payoutAccountRef: 'acct_provider_c' },
  };
  const payments = {
    configured: true, live: false,
    async checkout(e) { stats.checkouts++; ledger.set(e.orderId, { ...structuredClone(e), checkoutId: 'cs_' + e.orderId, receivedMinor: 0, refundedMinor: 0, status: 'unpaid', live: false, paymentId: 'pi_' + e.orderId, sourceRef: 'ch_' + e.orderId }); if (controls.loseCheckout) throw Error('synthetic checkout loss'); return { id: 'cs_' + e.orderId, url: 'https://checkout.stripe.com/test-fixture' }; },
    async reconcileCheckout(e) { const p = ledger.get(e.orderId); assert.equal(p.idempotencyKey,e.idempotencyKey); return { id: p.checkoutId, url: 'https://checkout.stripe.com/test-fixture' }; },
    async verifyEvent(raw, sig) { assert.equal(sig, 'verified-fixture'); return JSON.parse(raw.toString()); },
    async reconcileOperation(e) { return { id: e.kind === 'transfer' ? 'tr_1' : 're_1', amountMinor: e.amountMinor, currency: e.currency, status: 'succeeded' }; },
    async readCheckout(checkoutId) {
      const v = [...ledger.values()].find(x => x.checkoutId === checkoutId);
      return { checkoutId: v.checkoutId, orderId: v.orderId, termsHash: v.termsHash, currency: v.currency, amountMinor: v.amountMinor, receivedMinor: v.receivedMinor, refundedMinor: v.refundedMinor, status: v.status, live: v.live, paymentId: v.paymentId, sourceRef: v.sourceRef, ...controls.patchPayment };
    },
    async refund(e) { stats.refunds++; const p = [...ledger.values()].find(x => x.paymentId === e.paymentId); p.refundedMinor += e.amountMinor; p.status = 'refunded'; return { id: 're_' + stats.refunds, amountMinor: e.amountMinor, currency: e.currency, status: 'succeeded' }; },
    async transfer(e) { stats.transfers++; if (controls.loseTransfer) throw Error('synthetic transfer response loss'); return { id: 'tr_' + stats.transfers, amountMinor: e.amountMinor, currency: e.currency, status: 'succeeded' }; },
  };
  const desk = createWorkerServiceDesk({ store, adapters: { 'worker-a': adapter, 'worker-c': adapter, internal: adapter } });
  const options = { store, workerDesk: desk, workspaceId: 'factory', bindings: workerId => bindingRows[workerId], payments: noPayments ? null : payments, feeBps: 1500, verifyMeter: noMeter ? null : async receipt => { assert.equal(receipt.witness, 'independent-test-witness'); return receipt.event; } };
  const api = install ? await createMarketplace(options) : null;
  async function listing(plans = [fixed]) {
    await api.registerProvider(seller, { name: 'Third-party A', requestId: 'provider-create' });
    const l = await api.saveListing(seller, { workerId: 'worker-a', serviceId: 'buyer-discovery', title: '美国经销商研究', description: 'Third-party service; all test examples synthetic.', deliverables: ['可编辑名单'], acceptance: ['官网、来源、匹配理由'], prices: plans, requestId: 'listing-create' });
    await api.reviewListing(reviewer, { id: l.id, revision: l.revision, approve: true }); return l;
  }
  function orderInput(l, price = l.prices[0]) { return { listingId: l.id, revision: l.revision, priceId: price.id, ...(price.mode === 'fixed' ? {} : { budgetMinor: 100 }), product: 'Public fabric description', market: 'US', objective: 'Find a sourced candidate; synthetic acceptance fixture', deadlineAt: new Date(Date.now()+3600000).toISOString(), requestId: 'order-create', publicDataConfirmed: true }; }
  async function proposed(plans) { const l = await listing(plans); return api.createOrder(buyer, orderInput(l)); }
  async function paid(plans) { const o = await proposed(plans); await api.confirm(buyer, o.id, { confirmed: true, termsHash: o.termsHash }); await api.checkout(buyer, o.id); const p = ledger.get(o.id); p.status = 'paid'; p.receivedMinor = p.amountMinor; await api.syncPayment(o.id, { autoStart: true }); return api.getOrder(buyer, o.id); }
  async function delivered(o) { remote.get(o.id).state = 'completed'; return api.refresh(buyer, o.id); }
  function meter(o, event) { return api.meter({ witness: 'independent-test-witness', event: { orderId: o.id, workerId: 'worker-a', authority: 'trusted-fixture-meter', ...event } }); }
  return { store, desk, api, adapter, options, stats, controls, remote, ledger, bindingRows, listing, orderInput, proposed, paid, delivered, meter, payments };
}
