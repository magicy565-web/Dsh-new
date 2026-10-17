import { randomUUID } from 'node:crypto';
import { authorize, audit, chargeMinor, clone, digest, fail, id, integer, list, object, pricePlan, requireThat as check, splitMinor, text } from './contracts.mjs';

const ROOT = 'marketplace';
const ACTIVE = ['queued', 'running', 'input_required', 'dispatch_uncertain', 'cancel_requested'];
const TERMINAL = ['accepted', 'cancelled', 'failed', 'result_incomplete', 'budget_dispute'];
const fixedClock = () => Date.now();
const registry = state => state[ROOT];
const row = (items, value) => { const found = items.find(item => item.id === value); check(found, 'NOT_FOUND', 'Record not found.', 404); return found; };
const rowsUnique = items => Array.isArray(items) && items.every((item, index) => id(item?.id) && items.findIndex(other => other.id === item.id) === index);
const installedDesks = new WeakSet();
const installedStores = new WeakSet();

/**
 * Add commerce to the ORIGINAL WorkerDesk and Store. No second Run, queue,
 * Agent loop or execution state machine. One Host is one buyer workspace.
 * bindings() is a synchronous, trusted Host lookup, not a browser registry.
 */
export async function createMarketplace({ store, workerDesk, workspaceId, bindings, payments = null, verifyMeter = null, feeBps = 0, clock = fixedClock }) {
  check(store?.read && store?.update && workerDesk?.create && id(workspaceId) && typeof bindings === 'function', 'HOST_REQUIRED', 'Original Store, WorkerDesk and reviewed identity bindings are required.');
  check(!installedDesks.has(workerDesk) && !installedStores.has(store), 'ALREADY_INSTALLED', 'Only one Marketplace can own the original WorkerDesk.');
  integer(feeBps, 10_000);
  await store.update(state => {
    if (!state[ROOT]) state[ROOT] = { version: 1, workspaceId, providers: [], listings: [], contracts: [], events: [], paymentEvents: [] };
    const m = registry(state);
    check(m.version === 1 && m.workspaceId === workspaceId && ['providers', 'listings', 'contracts'].every(key => rowsUnique(m[key])) && Array.isArray(m.events), 'REGISTRY_INVALID', 'Marketplace registry is invalid or belongs to another workspace.');
    m.paymentEvents ??= [];
    check(Array.isArray(m.paymentEvents), 'REGISTRY_INVALID', 'Payment event registry is invalid.');
    for (const c of m.contracts) { check(c.id === c.orderId && c.termsHash === digest(c.terms) && state.workerOrders.some(order => order.id === c.id), 'REGISTRY_INVALID', 'Contract must refer to the unchanged original order.'); }
  });
  const now = () => new Date(clock()).toISOString();
  const mutate = fn => store.update(state => fn(state, registry(state)));
  const originals = Object.fromEntries(['create', 'approve', 'dispatch', 'refresh', 'accept', 'cancel', 'get', 'list', 'catalog'].map(key => [key, workerDesk[key].bind(workerDesk)]));
  const contract = (state, orderId) => row(registry(state).contracts, orderId);
  const originalOrder = (state, orderId) => row(state.workerOrders, orderId);
  const own = (state, actor, orderId, { write = false, buyerOnly = false } = {}) => {
    authorize(actor, workspaceId, buyerOnly ? ['buyer'] : ['buyer', 'provider', 'reviewer'], write);
    const c = contract(state, orderId);
    check(actor.kind === 'reviewer' || actor.kind === 'buyer' && actor.subject === c.buyerSubject || !buyerOnly && actor.kind === 'provider' && actor.subject === c.providerSubject, 'NOT_FOUND', 'Order not found.', 404);
    check(actor.kind !== 'provider' || c.consent && c.payment?.receivedMinor === c.terms.depositMinor, 'NOT_FOUND', 'Order not found.', 404);
    return c;
  };
  function binding(workerId, subject, serviceId, mode = 'fixed', ready = true) {
    const b = bindings(workerId);
    check(b && !b.then && b.workerId === workerId && b.providerSubject === subject && b.publicOnly === true && b.commercialOnly === true && b.verified === true && Array.isArray(b.serviceIds) && b.serviceIds.includes(serviceId), 'BINDING_REQUIRED', 'The original Host has not verified this provider and Worker.');
    check(Number.isFinite(Date.parse(b.expiresAt)) && Date.parse(b.expiresAt) > clock(), 'BINDING_EXPIRED', 'Worker authorization has expired.');
    check(!ready || b.ready === true, 'WORKER_UNAVAILABLE', 'The third-party Worker is not ready.');
    check(mode === null || b.priceModes?.includes(mode) && (mode === 'fixed' || typeof verifyMeter === 'function' && id(b.meterAuthority)), 'METER_UNAVAILABLE', 'This Worker has no verified meter for the requested mode.');
    integer(b.legacyBudgetCredits, 10_000, 1);
    return b;
  }
  function liveListing(state, listingId, revision, mode, ready = true) {
    const l = row(registry(state).listings, listingId);
    check(l.status === 'published' && l.revision === revision, 'LISTING_CHANGED', 'The reviewed offer changed; review it again.');
    const p = row(registry(state).providers, l.providerId);
    check(p.status === 'active', 'PROVIDER_SUSPENDED', 'Provider cannot accept new work.');
    return { l, p, b: binding(l.workerId, p.subject, l.serviceId, mode, ready) };
  }
  function expose(state, c) {
    const order = originalOrder(state, c.id);
    return clone({ id: c.id, orderId: c.id, status: order.status, objective: order.objective, input: { product: order.product, market: order.market, objective: order.objective },
      terms: c.terms, termsHash: c.termsHash, consented: !!c.consent,
      payment: c.payment, billing: { usage: c.usage, accruedMinor: c.terms.price.mode === 'fixed' ? null : chargeMinor(c.terms.price, c.usage), meterClosed: c.meterClosed, holds: c.holds.filter(x => x.state === 'reserved').length },
      financialOperations: c.operations.map(({ kind, state: status, amountMinor }) => ({ kind, status, amountMinor })),
      dispute: c.dispute, delivery: order.workerReport ?? null, deliveryDigest: order.workerReport ? digest(order.workerReport) : null,
      deliveryArtifactId: order.deliveryArtifactId ?? null, error: order.error ?? null });
  }
  function providerFor(state, actor) {
    const p = registry(state).providers.find(item => item.subject === actor.subject);
    check(p, 'PROVIDER_REQUIRED', 'Create your provider profile first.', 404); return p;
  }
  function paidAndAuthorized(state, c) {
    const o = originalOrder(state, c.id);
    check(c.consent && c.consent.termsHash === c.termsHash && digest(c.terms) === c.termsHash, 'CONSENT_REQUIRED', 'Exact task terms need human confirmation.');
    check(o.workerId === c.terms.workerId && o.budgetCredits === c.terms.legacyBudgetCredits && digest({ product: o.product, market: o.market, objective: o.objective, deadlineAt: o.deadlineAt }) === c.terms.inputDigest, 'ORDER_CHANGED', 'Original order diverged from the confirmed contract.');
    check(digest(o.acceptance) === digest(c.terms.acceptance) && digest(o.deliverableTypes) === digest(c.terms.deliverables), 'ORDER_CHANGED', 'Original acceptance scope changed.');
    check(row(registry(state).providers, c.terms.providerId).status === 'active', 'PROVIDER_SUSPENDED', 'Provider cannot start new work.');
    check(Date.parse(o.deadlineAt) > clock(), 'DEADLINE_EXPIRED', 'Task authorization has expired.');
    check(c.payment?.status === 'paid' && c.payment.receivedMinor === c.terms.depositMinor && c.payment.refundedMinor === 0 && !c.dispute, 'PAYMENT_REQUIRED', 'Verified payment without a refund or dispute is required.');
    binding(c.terms.workerId, c.providerSubject, o.serviceId, c.terms.price.mode);
    return o;
  }
  for (const o of store.read().workerOrders || []) {
    if (!registry(store.read()).contracts.some(c => c.id === o.id) && bindings(o.workerId)?.commercialOnly === true)
      check(['accepted', 'cancelled', 'failed'].includes(o.status), 'COMMERCIAL_WORKER_BUSY', 'Finish the existing legacy task before making its Worker commercial-only.');
  }
  // Stop legacy routes from bypassing commercial authorization. Calls made by
  // this module use the captured ORIGINAL methods, after checking the contract.
  const commercial = orderId => registry(store.read()).contracts.some(c => c.id === orderId);
  const commercialWorker = workerId => !!workerId && bindings(workerId)?.commercialOnly === true;
  for (const name of ['approve', 'dispatch', 'refresh', 'accept', 'cancel']) {
    workerDesk[name] = (...args) => {
      const o = originals.get(args[0]);
      check(!commercial(o.id) && !commercialWorker(o.workerId) && !(name === 'approve' && commercialWorker(args[2]?.workerId)), 'MARKETPLACE_ROUTE_REQUIRED', 'Use the consent-bound Marketplace order action.', 403);
      return originals[name](...args);
    };
  }
  workerDesk.create = (...args) => { check(!commercialWorker(args[0]?.workerId), 'MARKETPLACE_ROUTE_REQUIRED', 'This Worker requires a priced task contract.', 403); return originals.create(...args); };
  workerDesk.get = orderId => { check(!commercial(orderId), 'MARKETPLACE_ROUTE_REQUIRED', 'Read the buyer-scoped Marketplace order.', 403); return originals.get(orderId); };
  workerDesk.list = () => originals.list().filter(o => !commercial(o.id));
  // Recheck paid authorization INSIDE the original Store commit, not only
  // before awaiting the original dispatch transaction. Other Store writes and
  // noncommercial tasks pass through the unchanged original writer.
  const originalUpdate = store.update.bind(store);
  store.update = fn => originalUpdate(state => {
    const before = new Map((state.workerOrders || []).map(o => [o.id, o.status]));
    const result = fn(state);
    for (const c of registry(state).contracts) {
      const o = originalOrder(state, c.id);
      if (before.get(o.id) !== 'dispatching' && o.status === 'dispatching') paidAndAuthorized(state, c);
    }
    return result;
  });
  installedDesks.add(workerDesk); installedStores.add(store);

  async function startPaid(orderId) {
    const state = store.read(), c = contract(state, orderId), o = originalOrder(state, orderId);
    if (o.status !== 'approved') return expose(state, c);
    paidAndAuthorized(state, c);
    // Original dispatch performs the atomic approved -> dispatching transition.
    try { await originals.dispatch(orderId); }
    catch (error) {
      if (error.code !== 'INVALID_STATE') throw error;
      check(originals.get(orderId).status !== 'approved', 'DISPATCH_FAILED', 'Dispatch did not advance.');
    }
    return expose(store.read(), contract(store.read(), orderId));
  }
  async function financialOperation(orderId, kind, amountMinor, invoke) {
    const claimed = await mutate((state, m) => {
      const c = contract(state, orderId), old = c.operations.find(op => op.kind === kind);
      if (old) {
        check(old.amountMinor === amountMinor, 'OPERATION_CONFLICT', 'An existing financial operation has different terms.');
        check(old.state === 'succeeded', 'PAYMENT_UNCERTAIN', 'Reconcile the original financial operation; do not create another.');
        return { duplicate: true, operation: clone(old) };
      }
      check(!c.operations.some(op => ['requested', 'uncertain', 'pending'].includes(op.state)), 'PAYMENT_UNCERTAIN', 'A prior financial operation is unresolved.');
      check(kind !== 'transfer' || originalOrder(state, orderId).status === 'accepted' && !c.dispute, 'SETTLEMENT_BLOCKED', 'A current accepted, undisputed order is required.');
      if (kind === 'transfer') {
        const refunded = c.operations.filter(op => op.kind.startsWith('refund-') && op.state === 'succeeded').reduce((sum, op) => sum + op.amountMinor, 0);
        check(c.payment?.receivedMinor === c.terms.depositMinor && c.payment.refundedMinor === refunded && c.payment.status !== 'disputed', 'PAYMENT_CHANGED', 'Recorded funds changed before transfer.');
        const gross = chargeMinor(c.terms.price, c.usage);
        check(c.meterClosed && amountMinor === splitMinor(gross, c.terms.feeBps).providerMinor && refunded + gross <= c.payment.receivedMinor, 'PAYMENT_CHANGED', 'Transfer no longer matches the closed invoice.');
      }
      if (kind === 'refund-full') check(!c.operations.some(op => op.kind === 'transfer' && op.state !== 'failed'), 'TRANSFER_REVERSAL_REQUIRED', 'A completed transfer must be reversed before refund.');
      const op = { kind, id: randomUUID(), state: 'requested', amountMinor, createdAt: now(), receipt: null };
      c.operations.push(op); audit(state, 'payment.' + kind + '.requested', 'system', orderId, now());
      return { duplicate: false, operation: clone(op), contract: clone(c) };
    });
    if (claimed.duplicate) return claimed.operation;
    const key = 'marketplace:' + orderId + ':' + claimed.operation.id;
    try {
      const receipt = await invoke(claimed.contract, key);
      check(receipt && id(receipt.id) && receipt.amountMinor === amountMinor && receipt.currency === claimed.contract.terms.price.currency && ['succeeded', 'pending'].includes(receipt.status), 'INVALID_PAYMENT_RECEIPT', 'Payment provider returned an inconsistent receipt.');
      await mutate((state) => {
        const c = contract(state, orderId), op = c.operations.find(x => x.id === claimed.operation.id);
        op.state = receipt.status; op.receipt = clone(receipt); op.updatedAt = now();
        audit(state, 'payment.' + kind + '.' + receipt.status, 'system', orderId, now());
      });
      return clone(receipt);
    } catch (error) {
      await mutate(state => { const op = contract(state, orderId).operations.find(x => x.id === claimed.operation.id); if (op.state === 'requested') op.state = 'uncertain'; });
      fail(503, 'PAYMENT_UNCERTAIN', 'Payment outcome is unknown; reconcile the original operation before retrying.');
    }
  }
  const api = {
    status() { return { version: 1, workspaceId, scope: 'single-buyer-workspace', paymentsConfigured: payments?.configured === true, livePayments: payments?.live === true, thirdPartyRuntimeHosted: false, arbitraryCodeUpload: false, privateDelegation: false }; },
    async registerProvider(actor, input) {
      authorize(actor, workspaceId, ['provider'], true); object(input, ['name', 'requestId']);
      const name = text(input.name, 100), requestId = text(input.requestId, 128);
      return mutate(state => {
        const m = registry(state), old = m.providers.find(x => x.subject === actor.subject);
        if (old) { check(old.name === name, 'PROVIDER_EXISTS', 'Provider already exists with a different name.'); return clone(old); }
        const p = { id: randomUUID(), subject: actor.subject, name, status: 'active', requestId, createdAt: now() };
        m.providers.push(p); audit(state, 'provider.created', actor.subject, p.id, now()); return clone(p);
      });
    },
    async saveListing(actor, input) {
      authorize(actor, workspaceId, ['provider'], true);
      object(input, ['id', 'expectedRevision', 'requestId', 'workerId', 'serviceId', 'title', 'description', 'deliverables', 'acceptance', 'prices']);
      const fields = { workerId: text(input.workerId, 128), serviceId: text(input.serviceId, 128), title: text(input.title, 120), description: text(input.description, 2000), deliverables: list(input.deliverables), acceptance: list(input.acceptance) };
      check(Array.isArray(input.prices) && input.prices.length > 0 && input.prices.length <= 3, 'INVALID_PRICE', 'Supply one to three pricing options.', 400);
      const prices = input.prices.map(pricePlan); check(new Set(prices.map(x => x.id)).size === prices.length && new Set(prices.map(x => x.mode)).size === prices.length, 'INVALID_PRICE', 'Pricing IDs and modes must be unique.', 400);
      const requestId = text(input.requestId, 128), fingerprint = digest({ ...fields, prices });
      return mutate(state => {
        const m = registry(state), p = providerFor(state, actor);
        check(p.status === 'active', 'PROVIDER_SUSPENDED', 'Provider is suspended.');
        binding(fields.workerId, actor.subject, fields.serviceId, null, false);
        const previous = m.listings.flatMap(x => x.providerId === p.id ? (x.requests || [{ requestId: x.requestId, fingerprint: x.fingerprint, result: x }]) : []).find(x => x.requestId === requestId);
        if (previous) { check(previous.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 'Request ID has different listing contents.'); return clone(previous.result); }
        const l = input.id ? row(m.listings, input.id) : { id: randomUUID(), providerId: p.id, revision: 0, createdAt: now() };
        check(l.providerId === p.id, 'NOT_FOUND', 'Listing not found.', 404);
        check(!input.id || l.revision === input.expectedRevision, 'REVISION_CONFLICT', 'Listing revision changed.');
        Object.assign(l, fields, { prices, revision: l.revision + 1, status: 'draft', requestId, fingerprint, updatedAt: now() });
        if (!input.id) m.listings.push(l);
        const response = clone(l); delete response.requests;
        l.requests ??= []; l.requests.push({ requestId, fingerprint, result: response });
        check(l.requests.length <= 1000, 'LISTING_HISTORY_LIMIT', 'Archive listing edit history before more revisions.');
        audit(state, 'listing.saved', actor.subject, l.id, now()); return response;
      });
    },
    providerConnections(actor) {
      authorize(actor, workspaceId, ['provider']);
      const state = store.read(), provider = registry(state).providers.find(p => p.subject === actor.subject);
      const known = new Set(originals.catalog().flatMap(s => s.workers.map(w => w.id)));
      for (const l of registry(state).listings.filter(l => l.providerId === provider?.id)) known.add(l.workerId);
      return [...known].flatMap(workerId => {
        const b = bindings(workerId);
        if (!b || b.providerSubject !== actor.subject || !b.verified || !b.publicOnly || !b.commercialOnly) return [];
        return [{ workerId, serviceIds: clone(b.serviceIds), priceModes: clone(b.priceModes || []), ready: b.ready === true && Date.parse(b.expiresAt) > clock() }];
      });
    },
    providerListings(actor) { authorize(actor, workspaceId, ['provider']); const state = store.read(), p = providerFor(state, actor); return registry(state).listings.filter(x => x.providerId === p.id).map(x => { const result = clone(x); delete result.requests; return result; }); },
    async reviewListing(actor, input) {
      authorize(actor, workspaceId, ['reviewer'], true); object(input, ['id', 'revision', 'approve']);
      check(typeof input.approve === 'boolean', 'INVALID_INPUT', 'Explicit review decision required.', 400);
      return mutate(state => {
        const l = row(registry(state).listings, input.id), p = row(registry(state).providers, l.providerId);
        check(l.revision === input.revision && l.status === 'draft', 'REVISION_CONFLICT', 'Review the current listing revision.');
        check(p.subject !== actor.subject, 'SELF_REVIEW', 'Providers cannot review their own listings.', 403);
        binding(l.workerId, p.subject, l.serviceId, null, false);
        l.status = input.approve ? 'published' : 'rejected'; l.reviewedBy = actor.subject; l.reviewedAt = now();
        audit(state, 'listing.' + l.status, actor.subject, l.id, now()); return clone(l);
      });
    },
    reviewQueue(actor) {
      authorize(actor, workspaceId, ['reviewer'], true);
      const state = store.read();
      return registry(state).listings.filter(l => l.status === 'draft').map(l => { const result = clone(l); delete result.requests; return result; });
    },
    async suspendProvider(actor, input) {
      authorize(actor, workspaceId, ['reviewer'], true); object(input, ['id', 'suspended', 'reason']);
      check(typeof input.suspended === 'boolean', 'INVALID_INPUT', 'An explicit suspension decision is required.', 400);
      const reason = text(input.reason, 1000);
      return mutate(state => { const p = row(registry(state).providers, input.id); p.status = input.suspended ? 'suspended' : 'active'; p.reviewReason = reason; audit(state, 'provider.' + p.status, actor.subject, p.id, now()); return { id: p.id, status: p.status }; });
    },
    async unpublish(actor, input) {
      authorize(actor, workspaceId, ['provider'], true); object(input, ['id', 'revision']);
      return mutate(state => { const l = row(registry(state).listings, input.id), p = providerFor(state, actor); check(l.providerId === p.id, 'NOT_FOUND', 'Listing not found.', 404); check(l.revision === input.revision, 'REVISION_CONFLICT', 'Listing changed.'); l.status = 'unpublished'; l.revision++; audit(state, 'listing.unpublished', actor.subject, l.id, now()); return clone(l); });
    },
    catalog(actor, query = '') {
      authorize(actor, workspaceId, ['buyer', 'provider', 'reviewer']);
      check(typeof query === 'string' && query.length <= 120, 'INVALID_INPUT', 'Search is too long.', 400);
      const state = store.read(), m = registry(state);
      return m.listings.filter(l => l.status === 'published' && row(m.providers, l.providerId).status === 'active' && (l.title + ' ' + l.description).toLowerCase().includes(query.toLowerCase())).map(l => {
        const p = row(m.providers, l.providerId);
        const prices = l.prices.map(price => { try { binding(l.workerId, p.subject, l.serviceId, price.mode); return { ...price, available: true }; } catch { return { ...price, available: false }; } });
        return clone({ id: l.id, revision: l.revision, title: l.title, description: l.description, provider: { id: p.id, name: p.name }, workerId: l.workerId, serviceId: l.serviceId, deliverables: l.deliverables, acceptance: l.acceptance, prices, available: prices.some(p => p.available), dataScope: 'public-only' });
      });
    },
    async createOrder(actor, input, {assertCurrent} = {}) {
      if(assertCurrent!==undefined&&typeof assertCurrent!=='function')throw TypeError('Original synchronous Marketplace admission required.');
      authorize(actor, workspaceId, ['buyer']); check(['admin', 'operator'].includes(actor.role), 'ROLE_REQUIRED', 'Viewer cannot propose work.', 403);
      object(input, ['listingId', 'revision', 'priceId', 'budgetMinor', 'product', 'market', 'objective', 'deadlineAt', 'requestId', 'publicDataConfirmed']);
      check(input.publicDataConfirmed === true, 'DATA_SCOPE_REQUIRED', 'Only explicitly shareable public task inputs may leave this workspace.', 403);
      const state = store.read(), l = row(registry(state).listings, input.listingId), price = l.prices.find(p => p.id === input.priceId);
      check(price, 'PRICE_NOT_FOUND', 'Choose an offered price.', 404);
      const { p, b } = liveListing(state, input.listingId, input.revision, price.mode);
      const depositMinor = price.mode === 'fixed' ? price.amountMinor : integer(input.budgetMinor, 100_000_000, 1);
      check(input.budgetMinor === undefined || input.budgetMinor === depositMinor, 'PRICE_CONFLICT', 'Budget does not match the selected fixed price.', 400);
      const requestId = 'mp-' + digest([workspaceId, actor.subject, text(input.requestId, 128)]).slice(0,48);
      const inputs = { product: text(input.product, 240), market: text(input.market, 100), objective: text(input.objective, 2500), deadlineAt: text(input.deadlineAt, 40) };
      check(Number.isFinite(Date.parse(inputs.deadlineAt)), 'INVALID_DEADLINE', 'Use a valid deadline.', 400);
      inputs.deadlineAt = new Date(inputs.deadlineAt).toISOString();
      const terms = { version: 1, listingId: l.id, revision: l.revision, providerId: p.id, providerName: p.name, workerId: l.workerId, price: clone(price), depositMinor, feeBps, legacyBudgetCredits: b.legacyBudgetCredits, inputDigest: digest(inputs), deliverables: clone(l.deliverables), acceptance: clone(l.acceptance), dataScope: 'public-only', externalActions: 'none', deliveryCommitment: price.mode === 'fixed' ? 'agreed-deliverables' : 'best-effort-with-budget', meterAuthority: price.mode === 'fixed' ? null : b.meterAuthority, deadlineAt: inputs.deadlineAt };
      const termsHash = digest(terms);
      const result = await originals.create({ serviceId: l.serviceId, ...inputs, workerId: l.workerId, budgetCredits: b.legacyBudgetCredits, requestId, publicDataConfirmed: true }, actor.subject, { attach: (s, o, duplicate) => {
        if(assertCurrent&&assertCurrent(s)!==true)fail(403,'MARKETPLACE_SCOPE_REQUIRED','Original Marketplace admission was refused.');
        liveListing(s, l.id, l.revision, price.mode);
        const m = registry(s), old = m.contracts.find(c => c.id === o.id);
        if (old) { check(old.termsHash === termsHash && old.buyerSubject === actor.subject, 'IDEMPOTENCY_CONFLICT', 'Order terms do not match the original request.'); return; }
        check(!duplicate && o.status === 'draft', 'ORDER_MAPPING_REQUIRED', 'Cannot adopt an existing legacy order.');
        // Same original order ID; no shadow task status or second execution row.
        m.contracts.push({ id: o.id, orderId: o.id, buyerSubject: actor.subject, providerSubject: p.subject, payoutAccountRef: b.payoutAccountRef ?? null, terms, termsHash, consent: null, checkout: null, payment: null, usage: { activeMs: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, holds: [], meterClosed: price.mode === 'fixed', operations: [], dispute: null, createdAt: now() });
        o.acceptance = clone(l.acceptance); o.deliverableTypes = clone(l.deliverables);
        audit(s, 'order.proposed', actor.subject, o.id, now());
      } });
      return expose(store.read(), contract(store.read(), result.order.id));
    },
    getOrder(actor, orderId) { const state = store.read(); return expose(state, own(state, actor, orderId)); },
    orders(actor) { authorize(actor, workspaceId, ['buyer', 'provider', 'reviewer']); const state = store.read(); return registry(state).contracts.filter(c => actor.kind === 'reviewer' || actor.kind === 'buyer' && c.buyerSubject === actor.subject || actor.kind === 'provider' && c.providerSubject === actor.subject && c.consent && c.payment?.receivedMinor === c.terms.depositMinor).map(c => expose(state, c)); },
    async confirm(actor, orderId, input) {
      object(input, ['termsHash', 'confirmed']);
      check(input.confirmed === true, 'CONSENT_REQUIRED', 'Confirm the full task scope and maximum charge.', 400);
      await mutate(state => {
        const c = own(state, actor, orderId, { write: true, buyerOnly: true }), o = originalOrder(state, orderId);
        check(c.termsHash === input.termsHash && ['draft', 'approved'].includes(o.status), 'TERMS_CHANGED', 'Review the exact current task terms.');
        liveListing(state, c.terms.listingId, c.terms.revision, c.terms.price.mode);
        check(Date.parse(o.deadlineAt) > clock(), 'DEADLINE_EXPIRED', 'Task expired.');
        c.consent ??= { subject: actor.subject, at: now(), termsHash: c.termsHash };
        audit(state, 'order.confirmed', actor.subject, orderId, now());
      });
      if (originals.get(orderId).status === 'draft') await originals.approve(orderId, actor.subject, { confirmed: true });
      return api.getOrder(actor, orderId);
    },
    async checkout(actor, orderId) {
      let state = store.read(), c = own(state, actor, orderId, { write: true, buyerOnly: true });
      check(payments?.configured === true, 'PAYMENTS_UNCONFIGURED', 'No reviewed payment provider is configured.');
      check(c.consent && originals.get(orderId).status === 'approved', 'CONSENT_REQUIRED', 'Confirm the original task before paying.');
      check(Date.parse(c.terms.deadlineAt) > clock(), 'DEADLINE_EXPIRED', 'Task expired before checkout.');
      check(row(registry(state).providers, c.terms.providerId).status === 'active', 'PROVIDER_SUSPENDED', 'Provider cannot accept payment.');
      binding(c.terms.workerId, c.providerSubject, originals.get(orderId).serviceId, c.terms.price.mode);
      const claim = await mutate(s => {
        const current = own(s, actor, orderId, { write: true, buyerOnly: true });
        if (current.checkout) { check(current.checkout.state === 'created', 'PAYMENT_UNCERTAIN', 'Checkout creation is unresolved. Reconcile it; do not create another.'); return { duplicate: true, checkout: clone(current.checkout) }; }
        check(originalOrder(s, orderId).status === 'approved' && current.consent, 'ORDER_CHANGED', 'Order changed before checkout.');
        current.checkout = { state: 'requested', id: null, url: null, operationId: randomUUID(), createdAt: now() }; return { duplicate: false, contract: clone(current) };
      });
      if (claim.duplicate) return claim.checkout;
      try {
        const result = await payments.checkout({ orderId, termsHash: c.termsHash, amountMinor: c.terms.depositMinor, currency: c.terms.price.currency, title: c.terms.deliverables[0], idempotencyKey: 'mp:' + orderId + ':' + claim.contract.checkout.operationId });
        check(result && id(result.id) && typeof result.url === 'string' && new URL(result.url).protocol === 'https:', 'INVALID_CHECKOUT', 'Payment provider returned an invalid checkout.');
        await mutate(s => { const current = contract(s, orderId); current.checkout = { ...current.checkout, state: 'created', id: result.id, url: result.url }; audit(s, 'checkout.created', actor.subject, orderId, now()); });
        return clone(contract(store.read(), orderId).checkout);
      } catch { await mutate(s => { const current = contract(s, orderId); if (current.checkout.state === 'requested') current.checkout.state = 'uncertain'; }); fail(503, 'PAYMENT_UNCERTAIN', 'Checkout outcome is unresolved; reuse its original operation identity.'); }
    },
    async reconcileCheckout(actor, orderId) {
      const s = store.read(), c = own(s, actor, orderId, { write: true, buyerOnly: true });
      check(payments?.reconcileCheckout && c.checkout, 'RECONCILIATION_UNAVAILABLE', 'A processor reconciliation adapter is required.');
      if (c.checkout.id) return clone(c.checkout);
      const expected = { orderId, termsHash: c.termsHash, amountMinor: c.terms.depositMinor, currency: c.terms.price.currency, createdAt: c.checkout.createdAt, idempotencyKey: 'mp:' + orderId + ':' + c.checkout.operationId };
      const found = await payments.reconcileCheckout(expected);
      check(found && id(found.id) && typeof found.url === 'string' && new URL(found.url).protocol === 'https:', 'INVALID_CHECKOUT', 'Invalid reconciled checkout.');
      await mutate(state => { const current = own(state, actor, orderId, { write: true, buyerOnly: true }); check(!current.checkout.id || current.checkout.id === found.id, 'PAYMENT_MISMATCH', 'A different checkout is already bound.'); current.checkout = { ...current.checkout, state: 'created', id: found.id, url: found.url }; audit(state, 'checkout.reconciled', actor.subject, orderId, now()); });
      return clone(contract(store.read(), orderId).checkout);
    },
    async reconcileMovement(actor, orderId, input) {
      authorize(actor, workspaceId, ['reviewer'], true); object(input, ['kind']);
      const s = store.read(), c = contract(s, orderId), op = c.operations.find(x => x.kind === input.kind);
      check(op && payments?.reconcileOperation, 'RECONCILIATION_UNAVAILABLE', 'The original processor operation must be reconciled.');
      if (op.state === 'succeeded') return api.getOrder(actor, orderId);
      const expected = { kind: op.kind, orderId, amountMinor: op.amountMinor, currency: c.terms.price.currency, paymentId: c.payment.paymentId, sourceRef: c.payment.sourceRef, destination: c.payoutAccountRef, idempotencyKey: 'marketplace:' + orderId + ':' + op.id };
      const found = await payments.reconcileOperation(expected);
      check(found && id(found.id) && found.amountMinor === op.amountMinor && found.currency === c.terms.price.currency && ['succeeded', 'pending'].includes(found.status), 'INVALID_PAYMENT_RECEIPT', 'Reconciled movement does not match.');
      await mutate(state => { const current = contract(state, orderId).operations.find(x => x.id === op.id); check(!current.receipt || current.receipt.id === found.id, 'PAYMENT_AMBIGUOUS', 'Two processor movements claim one operation.'); current.state = found.status; current.receipt = clone(found); audit(state, 'payment.reconciled', actor.subject, orderId, now()); });
      return api.getOrder(actor, orderId);
    },
    async webhook(rawBody, signature) {
      check(payments?.verifyEvent, 'PAYMENTS_UNCONFIGURED', 'No payment webhook verifier configured.');
      const event = await payments.verifyEvent(rawBody, signature);
      if (!event) return { accepted: true, matched: false };
      const s = store.read(), c = registry(s).contracts.find(x => x.checkout?.id === event.checkoutId);
      if (!c) return { accepted: true, matched: false };
      check(id(event.eventId), 'INVALID_WEBHOOK', 'Verified event identity required.');
      const old = registry(s).paymentEvents.find(x => x.id === event.eventId);
      if (old) { check(old.checkoutId === event.checkoutId, 'WEBHOOK_CONFLICT', 'Event identity changed.'); return { accepted: true, duplicate: true }; }
      await api.syncPayment(c.id, { autoStart: true });
      await mutate(state => { if (!registry(state).paymentEvents.some(x => x.id === event.eventId)) registry(state).paymentEvents.push({ id: event.eventId, checkoutId: event.checkoutId }); });
      return { accepted: true, matched: true };
    },
    async syncPayment(orderId, { autoStart = false } = {}) {
      const before = store.read(), c = contract(before, orderId);
      check(payments?.configured && c.checkout?.id, 'PAYMENT_REQUIRED', 'A known checkout is required.');
      const p = await payments.readCheckout(c.checkout.id);
      object(p, ['checkoutId', 'orderId', 'termsHash', 'currency', 'amountMinor', 'live', 'receivedMinor', 'refundedMinor', 'status', 'paymentId', 'sourceRef']);
      check(p && p.checkoutId === c.checkout.id && p.orderId === c.id && p.termsHash === c.termsHash && p.currency === c.terms.price.currency && p.amountMinor === c.terms.depositMinor && p.live === payments.live, 'PAYMENT_MISMATCH', 'Payment does not match this exact order, amount, currency or environment.');
      integer(p.receivedMinor); integer(p.refundedMinor);
      check(p.refundedMinor <= p.receivedMinor && p.receivedMinor <= p.amountMinor && ['unpaid', 'paid', 'refunded', 'disputed'].includes(p.status), 'PAYMENT_MISMATCH', 'Invalid payment totals or status.');
      await mutate(s => {
        const current = contract(s, orderId), old = current.payment;
        check(current.checkout.id === p.checkoutId && (!old || old.refundedMinor <= p.refundedMinor && old.receivedMinor <= p.receivedMinor), 'STALE_PAYMENT', 'An older payment observation cannot undo recorded money movements.');
        current.payment = clone(p);
        if (p.status === 'disputed') current.dispute ??= { reason: 'Payment provider dispute', by: 'payment-provider', at: now(), status: 'open' };
        audit(s, 'payment.observed', 'payment-provider', orderId, now());
      });
      if (autoStart && p.status === 'paid' && p.refundedMinor === 0 && originals.get(orderId).status === 'approved') return startPaid(orderId);
      return expose(store.read(), contract(store.read(), orderId));
    },
    async start(actor, orderId) { own(store.read(), actor, orderId, { write: true, buyerOnly: true }); return startPaid(orderId); },
    async refresh(actor, orderId) {
      own(store.read(), actor, orderId);
      if (ACTIVE.includes(originals.get(orderId).status)) await originals.refresh(orderId);
      return api.getOrder(actor, orderId);
    },
    async cancel(actor, orderId) {
      own(store.read(), actor, orderId, { write: true, buyerOnly: true });
      if (originals.get(orderId).status !== 'cancelled') await originals.cancel(orderId);
      return api.getOrder(actor, orderId);
    },
    async accept(actor, orderId, input) {
      object(input, ['confirmed', 'deliveryDigest']);
      const s = store.read(), c = own(s, actor, orderId, { write: true, buyerOnly: true }), o = originalOrder(s, orderId);
      check(input.confirmed === true && o.workerReport && digest(o.workerReport) === input.deliveryDigest, 'DELIVERY_CHANGED', 'Review and accept this exact delivery version.');
      check(!c.dispute && c.meterClosed && !c.holds.some(h => h.state === 'reserved'), 'REVIEW_BLOCKED', 'Resolve the dispute and close verified metering before acceptance.');
      if (o.status !== 'accepted') await originals.accept(orderId, actor.subject, { confirmed: true });
      return api.getOrder(actor, orderId);
    },
    async dispute(actor, orderId, input) {
      object(input, ['reason']); const reason = text(input.reason, 2000);
      await mutate(s => { const c = own(s, actor, orderId, { write: true, buyerOnly: true }); check(!c.operations.some(op => ['requested', 'pending', 'uncertain'].includes(op.state)), 'PAYMENT_UNCERTAIN', 'Reconcile the in-flight money movement before dispute resolution.'); c.dispute ??= { by: actor.subject, reason, at: now(), status: 'open' }; audit(s, 'dispute.opened', actor.subject, orderId, now()); });
      return api.getOrder(actor, orderId);
    },
    async settle(actor, orderId) {
      authorize(actor, workspaceId, ['reviewer'], true);
      await api.syncPayment(orderId);
      const s = store.read(), c = contract(s, orderId), o = originalOrder(s, orderId);
      check(payments?.configured && o.status === 'accepted' && !c.dispute && c.meterClosed, 'SETTLEMENT_BLOCKED', 'Accepted delivery, closed meter and no dispute are required.');
      check(c.payment.receivedMinor === c.terms.depositMinor && c.payment.status !== 'disputed', 'PAYMENT_REQUIRED', 'Verified funds required.');
      const recognizedRefunds = c.operations.filter(op => op.kind.startsWith('refund-') && op.state === 'succeeded').reduce((sum, op) => sum + op.amountMinor, 0);
      check(c.payment.refundedMinor === recognizedRefunds, 'REFUND_MISMATCH', 'Reconcile external refunds before settlement.');
      const gross = Math.min(c.terms.depositMinor, chargeMinor(c.terms.price, c.usage));
      const split = splitMinor(gross, c.terms.feeBps), surplus = c.terms.depositMinor - gross;
      if (surplus) {
        const result = await financialOperation(orderId, 'refund-surplus', surplus, (current, key) => payments.refund({ paymentId: current.payment.paymentId, amountMinor: surplus, currency: current.terms.price.currency, idempotencyKey: key }));
        check(result.status === 'succeeded' || result.state === 'succeeded', 'REFUND_PENDING', 'Wait for the unused-budget refund to complete.');
        await api.syncPayment(orderId);
      }
      // Task execution grants can expire after delivery. Financial obligations do
      // not require reauthorizing the Agent. Pay only the original pinned account;
      // the processor adapter independently verifies its current payout eligibility.
      check(id(c.payoutAccountRef), 'PAYOUT_UNCONFIGURED', 'An original verified provider payout account is required.');
      check(!contract(store.read(), orderId).dispute, 'SETTLEMENT_BLOCKED', 'A dispute now blocks transfer.');
      if (split.providerMinor) await financialOperation(orderId, 'transfer', split.providerMinor, (current, key) => payments.transfer({ orderId, paymentId: current.payment.paymentId, sourceRef: current.payment.sourceRef, destination: current.payoutAccountRef, amountMinor: split.providerMinor, currency: current.terms.price.currency, idempotencyKey: key }));
      return { ...api.getOrder(actor, orderId), settlement: split };
    },
    async refund(actor, orderId) {
      authorize(actor, workspaceId, ['reviewer'], true);
      await api.syncPayment(orderId);
      const state = store.read(), c = contract(state, orderId), o = originalOrder(state, orderId);
      check(['cancelled', 'failed', 'result_incomplete', 'budget_dispute', 'review_required', 'accepted'].includes(o.status), 'REFUND_BLOCKED', 'First stop or review the original execution.');
      check(c.terms.price.mode === 'fixed', 'USAGE_REVIEW_REQUIRED', 'Metered failure/refund needs a separately agreed adjustment; no automatic free-work assumption.');
      check(!['review_required', 'accepted'].includes(o.status) || c.dispute?.status === 'open', 'DISPUTE_REQUIRED', 'Document the delivery dispute before refunding reviewable work.');
      check(!c.operations.some(op => op.kind === 'transfer' && op.state !== 'failed'), 'TRANSFER_REVERSAL_REQUIRED', 'A transfer must be reconciled/reversed before a post-settlement refund.');
      const amount = c.payment.receivedMinor;
      check(amount > 0 && (c.payment.refundedMinor === 0 || c.operations.some(op => op.kind === 'refund-full')), 'REFUND_MISMATCH', 'An unrecognized external refund requires reconciliation.');
      await financialOperation(orderId, 'refund-full', amount, (current, key) => payments.refund({ paymentId: current.payment.paymentId, amountMinor: amount, currency: current.terms.price.currency, idempotencyKey: key }));
      return api.getOrder(actor, orderId);
    },
    /** ONLY verified Host/gateway receipts enter monetary accounting. */
    async meter(receipt) {
      check(typeof verifyMeter === 'function', 'METER_UNAVAILABLE', 'No independent usage verifier is configured.');
      const e = await verifyMeter(receipt);
      object(e, ['id', 'orderId', 'workerId', 'authority', 'kind', 'reservationId', 'maxChargeMinor', 'usage']);
      check(id(e.id) && id(e.orderId) && ['reserve', 'commit', 'release', 'close'].includes(e.kind), 'INVALID_METER', 'Invalid verified meter event.');
      return mutate(s => {
        const c = contract(s, e.orderId), o = originalOrder(s, e.orderId);
        check(c.terms.price.mode !== 'fixed' && c.terms.meterAuthority === e.authority && c.terms.workerId === e.workerId, 'INVALID_METER', 'Meter authority or worker does not match.');
        const eventHash = digest(e), oldEvent = c.holds.flatMap(h => h.events).find(x => x.id === e.id);
        if (oldEvent) { check(oldEvent.hash === eventHash, 'IDEMPOTENCY_CONFLICT', 'Meter event ID changed contents.'); return expose(s, c); }
        check(!c.meterClosed && !c.operations.length, 'METER_CLOSED', 'Meter is closed.');
        if (e.kind === 'reserve') {
          paidAndAuthorized(s, c); check(o.status === 'running', 'NOT_RUNNING', 'Only actual running tasks can reserve metered budget.');
          const cap = integer(e.maxChargeMinor, c.terms.depositMinor, 1);
          check(id(e.reservationId) && !c.holds.some(h => h.id === e.reservationId), 'RESERVATION_CONFLICT', 'Reservation identity already exists.');
          const committed = chargeMinor(c.terms.price, c.usage), reserved = c.holds.filter(h => h.state === 'reserved').reduce((sum, h) => sum + h.maxChargeMinor, 0);
          check(committed + reserved + cap <= c.terms.depositMinor, 'BUDGET_EXHAUSTED', 'Do not start another billable call; the buyer budget is exhausted.');
          c.holds.push({ id: e.reservationId, state: 'reserved', maxChargeMinor: cap, events: [{ id: e.id, hash: eventHash }] });
        } else if (e.kind === 'close') {
          check(['review_required', ...TERMINAL].includes(o.status) && !c.holds.some(h => h.state === 'reserved'), 'METER_PENDING', 'Execution must finish and all reservations must reconcile.');
          c.meterClosed = true;
          c.holds.push({ id: 'close-' + e.id, state: 'closed', maxChargeMinor: 0, events: [{ id: e.id, hash: eventHash }] });
        } else {
          const h = c.holds.find(h => h.id === e.reservationId); check(h?.state === 'reserved', 'RESERVATION_REQUIRED', 'An open pre-call reservation is required.');
          if (e.kind === 'commit') {
            object(e.usage, ['activeMs', 'inputTokens', 'outputTokens', 'cachedInputTokens']);
            const relevant = c.terms.price.mode === 'time' ? ['activeMs'] : ['inputTokens', 'outputTokens', 'cachedInputTokens'];
            check(Object.keys(e.usage).every(key => relevant.includes(key)), 'INVALID_METER', 'Usage fields do not match the price mode.');
            const next = { ...c.usage };
            for (const key of relevant) next[key] = integer(next[key] + integer(e.usage[key] ?? 0, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
            const cost = chargeMinor(c.terms.price, next), prior = chargeMinor(c.terms.price, c.usage);
            check(cost - prior <= h.maxChargeMinor && cost <= c.terms.depositMinor, 'METER_OVER_RESERVATION', 'Provider overage is not silently passed to the buyer.');
            c.usage = next; h.state = 'committed';
          } else h.state = 'released';
          h.events.push({ id: e.id, hash: eventHash });
        }
        audit(s, 'meter.' + e.kind, e.authority, c.id, now()); return expose(s, c);
      });
    },
  };
  return Object.freeze(api);
}
