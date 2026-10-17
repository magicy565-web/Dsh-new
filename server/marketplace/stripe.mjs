import { id, integer, requireThat as check } from './contracts.mjs';

/** An injected OFFICIAL Stripe SDK instance; no hand-written signature verifier,
 * no secret discovery, no global SDK upgrade, no live call on module import.
 * Activation explicitly checks the existing platform account first. */
export async function createStripeMarketplacePayments({ stripe, platformAccountId, webhookSecret, returnOrigin, live = false }) {
  check(stripe?.checkout?.sessions && stripe?.paymentIntents && stripe?.transfers && stripe?.refunds && stripe?.webhooks?.constructEvent && id(platformAccountId), 'STRIPE_UNCONFIGURED', 'An official SDK and an approved platform account are required.');
  const origin = new URL(returnOrigin);
  check(origin.protocol === 'https:' && origin.origin === returnOrigin && !origin.username, 'INVALID_ORIGIN', 'Pin an exact HTTPS return origin.');
  check(typeof webhookSecret === 'string' && webhookSecret.length > 16 && typeof live === 'boolean', 'STRIPE_UNCONFIGURED', 'Explicit webhook and live/test settings are required.');
  const account = await stripe.accounts.retrieve();
  check(account.id === platformAccountId && account.charges_enabled === true, 'STRIPE_ACCOUNT_MISMATCH', 'This payment account is not approved for platform charges.');
  const currency = value => String(value).toUpperCase();
  const currencyArg = value => { check(/^[A-Z]{3}$/.test(value), 'INVALID_CURRENCY', 'Use an uppercase currency code.'); return value.toLowerCase(); };
  const amount = value => integer(value, 100_000_000, 1);
  const metadata = key => ({ marketplaceOperationKey: key });
  async function uniquePageMatch(listMethod, params, predicate) {
    let cursor, matches = [];
    for (let page = 0; page < 10; page++) {
      const result = await listMethod({ ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      matches.push(...result.data.filter(predicate));
      check(matches.length <= 1, 'PAYMENT_AMBIGUOUS', 'More than one payment object matches the original operation.');
      if (!result.has_more) { check(matches.length === 1, 'PAYMENT_UNCONFIRMED', 'The original payment operation has not been found.'); return matches[0]; }
      cursor = result.data.at(-1)?.id;
      check(cursor, 'PAYMENT_UNCONFIRMED', 'Payment pagination did not advance.');
    }
    check(false, 'PAYMENT_UNCONFIRMED', 'Payment listing was incomplete; manual reconciliation is required.');
  }
  function checkoutResult(s, expected) {
    check(s.mode === 'payment' && s.client_reference_id === expected.orderId && s.metadata?.termsHash === expected.termsHash && s.amount_total === expected.amountMinor && currency(s.currency) === expected.currency && s.livemode === live && s.url?.startsWith('https://checkout.stripe.com/'), 'STRIPE_CHECKOUT_MISMATCH', 'Unexpected checkout identity or amount.');
    return { id: s.id, url: s.url };
  }
  function movement(result, expected, kind) {
    check(result.amount === expected.amountMinor && currency(result.currency) === expected.currency && result.metadata?.marketplaceOperationKey === expected.idempotencyKey, 'STRIPE_RECEIPT_MISMATCH', 'Movement does not match the exact operation.');
    if (kind === 'transfer') check((typeof result.destination === 'string' ? result.destination : result.destination?.id) === expected.destination && result.source_transaction === expected.sourceRef && result.reversed !== true && (result.amount_reversed ?? 0) === 0 && result.livemode === live, 'STRIPE_RECEIPT_MISMATCH', 'Transfer destination/source mismatch.');
    else check((typeof result.payment_intent === 'string' ? result.payment_intent : result.payment_intent?.id) === expected.paymentId, 'STRIPE_RECEIPT_MISMATCH', 'Refund belongs to another payment.');
    const status = kind === 'transfer' ? 'succeeded' : result.status === 'succeeded' ? 'succeeded' : 'pending';
    check(kind === 'transfer' || !['failed', 'canceled'].includes(result.status), 'STRIPE_MOVEMENT_FAILED', 'The payment provider did not complete the movement.');
    return { id: result.id, amountMinor: result.amount, currency: currency(result.currency), status };
  }
  return Object.freeze({
    name: 'stripe-connect', configured: true, live,
    async checkout(expected) {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment', client_reference_id: expected.orderId,
        metadata: { ...metadata(expected.idempotencyKey), termsHash: expected.termsHash },
        payment_intent_data: { metadata: { marketplaceOrderId: expected.orderId, termsHash: expected.termsHash } },
        line_items: [{ quantity: 1, price_data: { currency: currencyArg(expected.currency), unit_amount: amount(expected.amountMinor), product_data: { name: expected.title.slice(0, 120) } } }],
        success_url: returnOrigin + '/?marketplaceOrder=' + encodeURIComponent(expected.orderId),
        cancel_url: returnOrigin + '/?marketplaceOrder=' + encodeURIComponent(expected.orderId),
      }, { idempotencyKey: expected.idempotencyKey });
      return checkoutResult(s, expected);
    },
    async reconcileCheckout(expected) {
      const s = await uniquePageMatch(stripe.checkout.sessions.list.bind(stripe.checkout.sessions), { created: { gte: Math.floor(Date.parse(expected.createdAt) / 1000) - 60 } }, x => x.client_reference_id === expected.orderId && x.metadata?.marketplaceOperationKey === expected.idempotencyKey);
      // Completed checkout may no longer have a redirect URL. It is safe to
      // recover its identity, then independently read its payment status.
      return checkoutResult({ ...s, url: s.url || 'https://checkout.stripe.com/' }, expected);
    },
    async readCheckout(checkoutId) {
      const s = await stripe.checkout.sessions.retrieve(checkoutId, { expand: ['payment_intent.latest_charge'] });
      check(s.mode === 'payment' && s.livemode === live && s.id === checkoutId, 'STRIPE_CHECKOUT_MISMATCH', 'Wrong Stripe checkout or environment.');
      let pi = s.payment_intent;
      if (typeof pi === 'string') pi = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
      let charge = pi?.latest_charge;
      if (typeof charge === 'string') charge = await stripe.charges.retrieve(charge);
      check(!pi || pi.metadata?.marketplaceOrderId === s.client_reference_id && pi.metadata?.termsHash === s.metadata?.termsHash && currency(pi.currency) === currency(s.currency) && pi.amount === s.amount_total && pi.livemode === live, 'STRIPE_PAYMENT_MISMATCH', 'PaymentIntent does not match the original contract.');
      check(!charge || (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) === pi?.id && charge.amount === pi.amount && currency(charge.currency) === currency(pi.currency) && charge.livemode === live, 'STRIPE_CHARGE_MISMATCH', 'Charge does not belong to the verified payment.');
      const received = pi?.amount_received ?? 0, refunded = charge?.amount_refunded ?? 0;
      const paid = s.payment_status === 'paid' && pi?.status === 'succeeded' && charge?.paid === true;
      return { checkoutId: s.id, orderId: s.client_reference_id, termsHash: s.metadata?.termsHash, currency: currency(s.currency), amountMinor: s.amount_total, live: s.livemode,
        receivedMinor: received, refundedMinor: refunded, status: charge?.disputed ? 'disputed' : refunded ? 'refunded' : paid ? 'paid' : 'unpaid', paymentId: pi?.id ?? null, sourceRef: charge?.id ?? null };
    },
    async transfer(expected) {
      const destination = await stripe.accounts.retrieve(expected.destination);
      check(destination.id === expected.destination && destination.details_submitted === true && destination.capabilities?.transfers === 'active', 'STRIPE_DESTINATION_BLOCKED', 'Provider onboarding or transfer capability is incomplete.');
      const result = await stripe.transfers.create({ amount: amount(expected.amountMinor), currency: currencyArg(expected.currency), destination: expected.destination, source_transaction: expected.sourceRef, transfer_group: 'mp_' + expected.orderId, metadata: metadata(expected.idempotencyKey) }, { idempotencyKey: expected.idempotencyKey });
      return movement(result, expected, 'transfer');
    },
    async refund(expected) {
      const result = await stripe.refunds.create({ payment_intent: expected.paymentId, amount: amount(expected.amountMinor), metadata: metadata(expected.idempotencyKey) }, { idempotencyKey: expected.idempotencyKey });
      return movement(result, expected, 'refund');
    },
    async reconcileOperation(expected) {
      const transfer = expected.kind === 'transfer';
      const result = transfer
        ? await uniquePageMatch(stripe.transfers.list.bind(stripe.transfers), { transfer_group: 'mp_' + expected.orderId }, x => x.metadata?.marketplaceOperationKey === expected.idempotencyKey)
        : await uniquePageMatch(stripe.refunds.list.bind(stripe.refunds), { payment_intent: expected.paymentId }, x => x.metadata?.marketplaceOperationKey === expected.idempotencyKey);
      return movement(result, expected, transfer ? 'transfer' : 'refund');
    },
    verifyEvent(rawBody, signature) {
      check(Buffer.isBuffer(rawBody) && rawBody.length <= 1_000_000, 'INVALID_WEBHOOK', 'A bounded untouched raw body is required.', 400);
      const e = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      check(e.livemode === live && !e.account, 'WEBHOOK_SCOPE_MISMATCH', 'Only this platform account environment is accepted.', 403);
      const accepted = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
      return accepted.includes(e.type) ? { eventId: e.id, checkoutId: e.data.object.id } : null;
    },
  });
}
