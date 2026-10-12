import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './runtime.mjs';
import { validateJson } from './store.mjs';
import { looksLikeCredential } from './security.mjs';

// Single-enterprise PILOT domain. This is NOT a cross-tenant marketplace.
// Deliberately separate commercial declarations from verified Shopify observations.
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const clean = (v, label, max = 200, optional = false) => {
  if (optional && (v === null || v === undefined || v === '')) return '';
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/u.test(v)) fail(400, 'SUPPLY_INPUT_INVALID', `${label} is invalid.`);
  return v.trim();
};
const finiteInt = (v, label, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail(400, 'SUPPLY_INPUT_INVALID', `${label} is outside the supported range.`);
  return v;
};
const allowed = (v, fields) => {
  try { validateJson(v); } catch { fail(400, 'SUPPLY_INPUT_INVALID', 'Invalid JSON input.'); }
  if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).some(x => !fields.includes(x))) fail(400, 'SUPPLY_INPUT_INVALID', 'Unknown or missing input fields.');
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const amount = v => {
  if (typeof v !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/u.test(v)) fail(400, 'SUPPLY_INPUT_INVALID', 'Use a decimal string for the indicative unit price.');
  return v;
};
const requireRole = (actor, admin = false) => {
  if (!actor?.subject || !(admin ? ['admin'] : ['admin', 'operator']).includes(actor.role)) fail(403, 'SUPPLY_ROLE_REQUIRED', 'This action requires an approved enterprise role.');
};
const digest = body => createHash('sha256').update(JSON.stringify(body)).digest('hex');
const initial = () => ({ version: 1, suppliers: [], listings: [], inquiries: [], events: [], commands: [], shopifyObservation: null });
const network = state => { state.supplyNetwork ??= initial(); if (state.supplyNetwork.version !== 1) fail(409, 'SUPPLY_STORE_UNSUPPORTED', 'The supply network storage requires migration.'); return state.supplyNetwork; };
const snapshot = store => store.read().supplyNetwork || initial();
const findOne = (list, id, label) => { const row = list.find(item => item.id === id); if (!row) fail(404, 'SUPPLY_NOT_FOUND', `${label} was not found.`); return row; };
const cap = (array, limit) => { if (array.length >= limit) fail(409, 'SUPPLY_CAPACITY_LIMIT', 'Pilot storage limit reached; migration and archival required.'); };

export function createSupplyNetworkService({ store, clock = Date.now, workspaceId = 'local', merchantMember = subject => subject === 'local-operator' } = {}) {
  if (!store?.read || !store?.update) throw new TypeError('A persistent Workspace store is required.');
  const now = () => new Date(clock()).toISOString();
  const authorized = actor => {
    if (!actor?.subject || actor.workspaceId && actor.workspaceId !== workspaceId) fail(403, 'SUPPLY_WORKSPACE_REQUIRED', 'Use the authorized workspace identity.');
  };
  const buyer = actor => { authorized(actor); if (!['admin', 'operator', 'buyer'].includes(actor.role)) fail(403, 'SUPPLY_BUYER_REQUIRED', 'An authenticated procurement identity is required.'); };
  const dbSnapshot = () => { const db = snapshot(store); if (db.workspaceId && db.workspaceId !== workspaceId) fail(409, 'SUPPLY_WORKSPACE_CHANGED', 'Preserve the original enterprise supply store.'); return db; };
  const visible = (row, actor) => row.createdBy === actor.subject || ['admin', 'operator'].includes(actor.role) && merchantMember(actor.subject) && row.share?.status === 'active' && row.share.merchantSubject === actor.subject;
  const ownedInquiry = (db, id, actor) => { const row = findOne(db.inquiries, id, 'Inquiry'); if (row.createdBy !== actor.subject) fail(404, 'SUPPLY_NOT_FOUND', 'The owned inquiry was not found.'); return row; };
  const merchantInquiry = (db, id, actor) => {
    authorized(actor); requireRole(actor);
    const row = findOne(db.inquiries, id, 'Inquiry');
    if (row.share?.status !== 'active' || row.share.merchantSubject !== actor.subject || !merchantMember(actor.subject)) fail(404, 'SUPPLY_NOT_FOUND', 'No active share is available to this merchant.');
    return row;
  };
  const consent = (db, row) => {
    const supplier = findOne(db.suppliers, row.supplierId, 'Supplier'), listing = findOne(db.listings, row.listingId, 'Listing');
    if (!supplier.published || !listing.published || listing.revision !== row.listingRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Review the current explicitly published offer before sharing.');
    if (!supplier.merchantSubject || !merchantMember(supplier.merchantSubject)) fail(409, 'SUPPLY_MERCHANT_BINDING_REQUIRED', 'An administrator must bind the specified merchant identity.');
    const product = store.read().businessLibrary?.products.find(p => p.id === listing.productRef?.productId);
    if (!product || product.revision !== listing.productRef.revision || !product.skus.some(s => s.id === listing.productRef.skuId) || product.source?.referenceOnly || product.status === 'archived') fail(409, 'SUPPLY_PRODUCT_BINDING_REQUIRED', 'Review the exact enterprise product and SKU ownership before sharing.');
    return { schema: 'workspace.procurement-share.v1', workspaceId, inquiryId: row.id, revision: row.revision ?? 1,
      buyerSubject: row.createdBy, recipient: { supplierId: supplier.id, displayName: supplier.displayName, merchantSubject: supplier.merchantSubject },
      listingId: listing.id, listingRevision: listing.revision, productRef: listing.productRef,
      quantity: row.quantity, destination: row.destination, notes: row.notes };
  };
  function reference(state, row, actor, conversationId, kind, value) {
    const conversation = state.conversations?.find(c => c.id === conversationId);
    const creations = state.workspaceConversationCreations;
    // Reuse the server-stamped owner and original creation receipt. Earlier
    // keyed conversations have no workspaceId field; their receipt provides it.
    const ownedCreation = conversation?.createdBy === actor.subject && (conversation.creationRequestId
      ? creations?.version === 1 && Array.isArray(creations.receipts) && creations.receipts.some(receipt => receipt.conversationId === conversationId && receipt.subject === actor.subject && receipt.workspaceId === workspaceId && receipt.requestId === conversation.creationRequestId)
      : conversation.workspaceId === workspaceId);
    if (!conversation || !(conversation.subject === actor.subject || actor.nativeAgentId === conversationId || ownedCreation)) fail(404, 'SUPPLY_CONVERSATION_REQUIRED', 'Use this merchant\'s original owned business conversation.');
    const id = 'supply-' + digest([row.id, row.share.reviewHash, kind, value]);
    state.messages ??= [];
    if (!state.messages.some(m => m.id === id)) state.messages.push({ id, conversationId, role: 'assistant', status: 'complete',
      source: 'procurement', supplyInquiryId: row.id, createdAt: now(), content: JSON.stringify({ kind, inquiryId: row.id, ...value }) });
    conversation.updatedAt = now();
    return id;
  }
  function change(actor, action, input, fn) {
    authorized(actor);
    allowed(input, Object.keys(input));
    const requestId = clean(input.requestId, 'requestId', 36);
    if (!UUID.test(requestId)) fail(400, 'SUPPLY_REQUEST_ID_REQUIRED', 'A stable UUID requestId is required.');
    const payloadDigest = digest(input);
    return store.update(state => {
      const db = network(state);
      if (db.workspaceId && db.workspaceId !== workspaceId) fail(409, 'SUPPLY_WORKSPACE_CHANGED', 'This supply store belongs to its original enterprise.');
      db.workspaceId ??= workspaceId;
      const existing = db.commands.find(c => (c.requestId === requestId || c.id === requestId) && c.actor === actor.subject);
      if (existing) {
        if (existing.digest !== payloadDigest || existing.action !== action) fail(409, 'SUPPLY_IDEMPOTENCY_CONFLICT', 'This requestId was already used for another command.');
        return existing.result;
      }
      cap(db.commands, 2000);
      const result = fn(db, state);
      db.commands.push({ id: digest([actor.subject, requestId]), requestId, actor: actor.subject, action, digest: payloadDigest, result, createdAt: now() });
      return result;
    });
  }
  function event(db, kind, actor, details, isPublic = false) {
    cap(db.events, 6000);
    db.events.push({ id: randomUUID(), kind, actor: actor.subject, createdAt: now(), public: isPublic, ...details });
  }
  const publicSupplier = supplier => ({ id: supplier.id, displayName: supplier.displayName, country: supplier.country, website: supplier.website, updatedAt: supplier.updatedAt, verificationLevel: 0, verificationLabel: 'merchant_declaration' });
  const publicListing = (listing, supplier) => ({ id: listing.id, supplier: publicSupplier(supplier), title: listing.title, sku: listing.sku, unitPrice: listing.unitPrice, currency: listing.currency, moq: listing.moq, leadDays: listing.leadDays, incoterm: listing.incoterm, details: listing.details, featured: listing.featured, updatedAt: listing.updatedAt, revision: listing.revision, source: 'merchant_declaration', indicativeOnly: true, verifiedTransaction: false });
  return {
    commandReceipt(action, body, actor) {
      requireRole(actor, true);
      const requestId = clean(body.requestId, 'requestId', 36);
      const receipt = dbSnapshot().commands.find(c => (c.requestId === requestId || c.id === requestId) && c.actor === actor.subject);
      if (!receipt) return null;
      if (receipt.action !== action || receipt.digest !== digest(body)) fail(409, 'SUPPLY_IDEMPOTENCY_CONFLICT', 'The command ID was used with a different scope.');
      return receipt.result;
    },
    status(actor) { if (actor) authorized(actor); const db = dbSnapshot(); return { pilot: true, multiTenant: false, supplierCount: db.suppliers.length, publishedSuppliers: db.suppliers.filter(s => s.published).length, listingCount: db.listings.length, publishedListings: db.listings.filter(l => l.published).length, inquiryCount: actor ? db.inquiries.filter(row => visible(row, actor)).length : 0, shopifyObservation: db.shopifyObservation && { observedAt: db.shopifyObservation.observedAt, shopId: db.shopifyObservation.shopId, count: db.shopifyObservation.products.length, hasNextPage: db.shopifyObservation.nextCursor !== null } }; },
    suppliers() { return { suppliers: snapshot(store).suppliers }; },
    listings() { return { listings: snapshot(store).listings }; },
    inquiries(actor) { authorized(actor); return { inquiries: dbSnapshot().inquiries.filter(row => visible(row, actor)) }; },
    inquiry(id, actor) { authorized(actor); const inquiry = findOne(dbSnapshot().inquiries, id, 'Inquiry'); if (!visible(inquiry, actor)) fail(404, 'SUPPLY_NOT_FOUND', 'The inquiry was not found.'); return { inquiry }; },
    conversationInquiries(conversationId, actor) { authorized(actor); return { inquiries: dbSnapshot().inquiries.filter(row => visible(row, actor) && row.merchantConversation?.conversationId === conversationId && row.merchantConversation.subject === actor.subject) }; },
    events(actor) { authorized(actor); const db = dbSnapshot(); return { events: db.events.filter(e => !e.inquiryId || db.inquiries.some(row => row.id === e.inquiryId && visible(row, actor))).slice(-80).reverse() }; },
    shopifyObservation() { const observation = snapshot(store).shopifyObservation; return { observation: observation ? { ...observation } : null }; },
    searchPublic({ query = '', limit = 20 } = {}) {
      if (typeof query !== 'string' || query.length > 120) fail(400, 'SUPPLY_INPUT_INVALID', 'The search query is too long.');
      finiteInt(limit, 'limit', 1, 50);
      const db = dbSnapshot(), q = query.trim().toLocaleLowerCase();
      const suppliers = new Map(db.suppliers.filter(s => s.published).map(s => [s.id, s]));
      const items = db.listings.filter(x => x.published && suppliers.has(x.supplierId) && (!q || [x.title, x.sku, x.details, suppliers.get(x.supplierId).displayName].some(v => v.toLocaleLowerCase().includes(q)))).slice(0, limit).map(x => publicListing(x, suppliers.get(x.supplierId)));
      return { items, returned: items.length, source: 'workspace_merchant_declaration', noIndependentVerification: true };
    },
    getPublicSupplier(id) {
      if (typeof id !== 'string' || !UUID.test(id)) fail(400, 'SUPPLY_INPUT_INVALID', 'Supplier ID is invalid.');
      const db = snapshot(store), supplier = db.suppliers.find(x => x.id === id && x.published);
      if (!supplier) fail(404, 'SUPPLY_NOT_FOUND', 'No published supplier is available.');
      return { supplier: publicSupplier(supplier), listings: db.listings.filter(x => x.published && x.supplierId === id).slice(0, 100).map(x => publicListing(x, supplier)) };
    },
    publicChanges({ limit = 20 } = {}) {
      finiteInt(limit, 'limit', 1, 50);
      // Events carry only IDs, status and timestamps; never private prices or buyer identities.
      return { events: snapshot(store).events.filter(x => x.public).slice(-limit).reverse().map(x => ({ id: x.id, kind: x.kind, supplierId: x.supplierId, listingId: x.listingId ?? null, createdAt: x.createdAt })) };
    },
    async createSupplier(body, actor) {
      requireRole(actor, true);
      allowed(body, ['requestId', 'displayName', 'country', 'website']);
      const displayName = clean(body.displayName, 'displayName', 120), country = clean(body.country, 'country', 80);
      const website = clean(body.website, 'website', 300, true);
      if (website) { try { const u = new URL(website); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); } catch { fail(400, 'SUPPLY_INPUT_INVALID', 'Supplier website must be a valid HTTPS URL.'); } }
      return change(actor, 'supplier.create', body, db => {
        cap(db.suppliers, 500);
        const createdAt = now(), supplier = { id: randomUUID(), revision: 1, displayName, country, website, published: false, createdAt, updatedAt: createdAt, createdBy: actor.subject, source: 'merchant_declaration' };
        db.suppliers.push(supplier); event(db, 'supplier.created', actor, { supplierId: supplier.id }); return { supplier };
      });
    },
    async publishSupplier(id, body, actor) {
      requireRole(actor, true); allowed(body, ['requestId', 'expectedRevision', 'confirmed']);
      if (!UUID.test(id) || body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Explicit publication confirmation is required.');
      finiteInt(body.expectedRevision, 'expectedRevision', 1, 1_000_000);
      return change(actor, `supplier.publish:${id}`, body, db => {
        const supplier = findOne(db.suppliers, id, 'Supplier');
        if (supplier.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Supplier record has changed.');
        supplier.published = true; supplier.revision++; supplier.updatedAt = now(); event(db, 'supplier.published', actor, { supplierId: id }, true); return { supplier };
      });
    },
    async unpublishSupplier(id, body, actor) {
      requireRole(actor, true); allowed(body, ['requestId', 'expectedRevision', 'confirmed']);
      if (!UUID.test(id) || body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Explicit removal confirmation is required.');
      finiteInt(body.expectedRevision, 'expectedRevision', 1, 1_000_000);
      return change(actor, `supplier.unpublish:${id}`, body, db => {
        const supplier = findOne(db.suppliers, id, 'Supplier');
        if (supplier.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Supplier record has changed.');
        supplier.published = false; supplier.revision++; supplier.updatedAt = now();
        // Revocation must stay revoked if the supplier profile is later re-published.
        for (const listing of db.listings.filter(row => row.supplierId === id && row.published)) {
          listing.published = false; listing.revision++; listing.updatedAt = now();
          event(db, 'listing.unpublished', actor, { supplierId: id, listingId: listing.id }, true);
        }
        event(db, 'supplier.unpublished', actor, { supplierId: id }, true);
        return { supplier };
      });
    },
    async createListing(body, actor) {
      requireRole(actor); allowed(body, ['requestId', 'supplierId', 'title', 'sku', 'unitPrice', 'currency', 'moq', 'leadDays', 'incoterm', 'details', 'featured']);
      if (!UUID.test(body.supplierId)) fail(400, 'SUPPLY_INPUT_INVALID', 'Select a supplier.');
      const listingData = { title: clean(body.title, 'title', 140), sku: clean(body.sku, 'sku', 80), unitPrice: amount(body.unitPrice), currency: clean(body.currency, 'currency', 3), moq: finiteInt(body.moq, 'moq', 1, 10_000_000), leadDays: finiteInt(body.leadDays, 'leadDays', 1, 730), incoterm: clean(body.incoterm, 'incoterm', 8), details: clean(body.details, 'details', 1600, true), featured: body.featured ?? false };
      if (typeof listingData.featured !== 'boolean') fail(400, 'SUPPLY_INPUT_INVALID', 'Featured must be a boolean.');
      if (!/^[A-Z]{3}$/.test(listingData.currency) || !['EXW', 'FOB', 'FCA', 'CIF', 'CFR', 'DAP', 'DDP'].includes(listingData.incoterm)) fail(400, 'SUPPLY_INPUT_INVALID', 'Unsupported currency or Incoterm.');
      return change(actor, 'listing.create', body, db => {
        findOne(db.suppliers, body.supplierId, 'Supplier'); cap(db.listings, 2000);
        if (db.listings.some(x => x.supplierId === body.supplierId && x.sku === listingData.sku)) fail(409, 'SUPPLY_SKU_EXISTS', 'SKU already exists for this supplier.');
        const createdAt = now(), listing = { id: randomUUID(), supplierId: body.supplierId, ...listingData, revision: 1, published: false, createdAt, updatedAt: createdAt, source: 'merchant_declaration' };
        db.listings.push(listing); event(db, 'listing.created', actor, { supplierId: body.supplierId, listingId: listing.id }); return { listing };
      });
    },
    async updateListing(id, body, actor) {
      requireRole(actor); allowed(body, ['requestId', 'expectedRevision', 'unitPrice', 'moq', 'leadDays', 'details', 'featured']);
      if (!UUID.test(id)) fail(400, 'SUPPLY_INPUT_INVALID', 'Listing ID is invalid.');
      finiteInt(body.expectedRevision, 'expectedRevision', 1, 1_000_000);
      const updates = {};
      for (const key of ['unitPrice', 'moq', 'leadDays', 'details', 'featured']) if (Object.hasOwn(body, key)) {
        if (key === 'featured' && typeof body[key] !== 'boolean') fail(400, 'SUPPLY_INPUT_INVALID', 'Featured must be a boolean.');
        updates[key] = key === 'featured' ? body[key] : key === 'unitPrice' ? amount(body[key]) : key === 'details' ? clean(body[key], key, 1600, true) : finiteInt(body[key], key, 1, key === 'moq' ? 10_000_000 : 730);
      }
      if (!Object.keys(updates).length) fail(400, 'SUPPLY_INPUT_INVALID', 'Provide at least one changed field.');
      return change(actor, `listing.update:${id}`, body, db => {
        const listing = findOne(db.listings, id, 'Listing');
        if (listing.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Listing has changed.');
        Object.assign(listing, updates); listing.revision++; listing.updatedAt = now(); event(db, 'listing.updated', actor, { supplierId: listing.supplierId, listingId: id }, listing.published);
        return { listing };
      });
    },
    async publishListing(id, body, actor) {
      requireRole(actor, true); allowed(body, ['requestId', 'expectedRevision', 'confirmed']);
      if (!UUID.test(id) || body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Explicit publication confirmation is required.');
      finiteInt(body.expectedRevision, 'expectedRevision', 1, 1_000_000);
      return change(actor, `listing.publish:${id}`, body, db => {
        const listing = findOne(db.listings, id, 'Listing');
        const supplier = findOne(db.suppliers, listing.supplierId, 'Supplier');
        if (!supplier.published) fail(409, 'SUPPLY_SUPPLIER_PRIVATE', 'Publish the supplier profile first.');
        if (listing.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Listing has changed.');
        listing.published = true; listing.revision++; listing.updatedAt = now(); event(db, 'listing.published', actor, { supplierId: listing.supplierId, listingId: id }, true); return { listing };
      });
    },
    async unpublishListing(id, body, actor) {
      requireRole(actor, true); allowed(body, ['requestId', 'expectedRevision', 'confirmed']);
      if (!UUID.test(id) || body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Explicit removal confirmation is required.');
      finiteInt(body.expectedRevision, 'expectedRevision', 1, 1_000_000);
      return change(actor, `listing.unpublish:${id}`, body, db => {
        const listing = findOne(db.listings, id, 'Listing');
        if (listing.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Listing has changed.');
        listing.published = false; listing.revision++; listing.updatedAt = now();
        event(db, 'listing.unpublished', actor, { supplierId: listing.supplierId, listingId: id }, true);
        return { listing };
      });
    },
    async createInquiry(body, actor) {
      buyer(actor); allowed(body, ['requestId', 'listingId', 'quantity', 'destination', 'notes']);
      if (!UUID.test(body.listingId)) fail(400, 'SUPPLY_INPUT_INVALID', 'Select a listing.');
      const quantity = finiteInt(body.quantity, 'quantity', 1, 10_000_000), destination = clean(body.destination, 'destination', 120), notes = clean(body.notes, 'notes', 1200, true);
      if (looksLikeCredential(notes)) fail(400, 'RAW_CREDENTIAL_REJECTED', 'Do not include credentials in procurement requests.');
      return change(actor, 'inquiry.create', body, db => {
        const listing = findOne(db.listings, body.listingId, 'Listing'); cap(db.inquiries, 2000);
        if (actor.role === 'buyer' && (!listing.published || !db.suppliers.some(s => s.id === listing.supplierId && s.published))) fail(404, 'SUPPLY_NOT_FOUND', 'Only an explicitly published offer is available to this buyer.');
        const inquiry = { id: randomUUID(), workspaceId, revision: 1, listingId: listing.id, supplierId: listing.supplierId, listingRevision: listing.revision, quantity, destination, notes, status: 'draft', createdAt: now(), createdBy: actor.subject, publishedAt: null, sentAt: null, share: null, replies: [] };
        db.inquiries.push(inquiry); event(db, 'inquiry.draft_created', actor, { supplierId: listing.supplierId, listingId: listing.id }); return { inquiry };
      });
    },
    async bindMerchant(id, body, actor) {
      requireRole(actor, true); allowed(body, ['requestId', 'expectedRevision', 'merchantSubject', 'confirmed']);
      if (body.confirmed !== true || !merchantMember(body.merchantSubject)) fail(400, 'SUPPLY_MERCHANT_BINDING_REQUIRED', 'Confirm a configured enterprise merchant identity.');
      return change(actor, `supplier.merchant:${id}`, body, db => {
        const supplier = findOne(db.suppliers, id, 'Supplier');
        if (supplier.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'The supplier changed.');
        if (db.inquiries.some(row => row.supplierId === id && row.share?.status === 'active')) fail(409, 'SUPPLY_ACTIVE_SHARE', 'Revoke existing shares before changing the merchant owner.');
        if (supplier.merchantSubject && supplier.merchantSubject !== body.merchantSubject && db.inquiries.some(row => row.supplierId === id && row.share)) fail(409, 'SUPPLY_ORIGINAL_MERCHANT_REQUIRED', 'Preserve the recipient of existing buyer shares and replies; do not transfer historical procurement data.');
        supplier.merchantSubject = body.merchantSubject; supplier.revision++; supplier.updatedAt = now();
        event(db, 'supplier.merchant_bound', actor, { supplierId: id }); return { supplier };
      });
    },
    async linkProduct(id, body, actor) {
      requireRole(actor, true); allowed(body, ['requestId', 'expectedRevision', 'productId', 'expectedProductRevision', 'skuId', 'confirmed']);
      if (body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Confirm the exact product and SKU owner.');
      return change(actor, `listing.product:${id}`, body, (db, state) => {
        const listing = findOne(db.listings, id, 'Listing'), product = state.businessLibrary?.products.find(p => p.id === body.productId);
        if (listing.revision !== body.expectedRevision || product?.revision !== body.expectedProductRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Reload the current product and listing revisions.');
        const sku = product?.skus.find(s => s.id === body.skuId);
        if (!sku || product.source?.referenceOnly || product.status === 'archived') fail(400, 'SUPPLY_PRODUCT_BINDING_REQUIRED', 'Use a saved enterprise product SKU.');
        listing.productRef = { workspaceId, companyId: product.companyId, productId: product.id, revision: product.revision, skuId: sku.id, skuCode: sku.code };
        listing.revision++; listing.updatedAt = now(); event(db, 'listing.product_bound', actor, { supplierId: listing.supplierId, listingId: id }); return { listing };
      });
    },
    reviewInquiry(id, actor) { buyer(actor); const db = dbSnapshot(), row = ownedInquiry(db, id, actor), review = consent(db, row); return { review, reviewHash: digest(review), alreadyShared: row.share?.status === 'active' }; },
    async shareInquiry(id, body, actor) {
      buyer(actor); allowed(body, ['requestId', 'expectedRevision', 'expectedReviewHash', 'confirmed']);
      if (body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Explicit consent to share this exact procurement request is required.');
      return change(actor, `inquiry.share:${id}`, body, db => {
        const row = ownedInquiry(db, id, actor), review = consent(db, row), reviewHash = digest(review);
        if ((row.revision ?? 1) !== body.expectedRevision || reviewHash !== body.expectedReviewHash) fail(409, 'SUPPLY_STALE_CONSENT', 'Review the exact current recipient and request before sharing.');
        if (row.share?.status === 'active') fail(409, 'SUPPLY_ALREADY_SHARED', 'The original share is active; do not create another delivery.');
        row.shares ??= row.share ? [structuredClone(row.share)] : []; cap(row.shares, 50);
        row.share = { status: 'active', reviewHash, merchantSubject: review.recipient.merchantSubject, snapshot: review, sharedAt: now(), revokedAt: null };
        row.shares.push(structuredClone(row.share));
        row.status = 'shared'; row.revision = (row.revision ?? 1) + 1;
        event(db, 'inquiry.shared', actor, { supplierId: row.supplierId, listingId: row.listingId, inquiryId: id }); return { inquiry: row };
      });
    },
    async revokeInquiry(id, body, actor) {
      buyer(actor); allowed(body, ['requestId', 'expectedRevision', 'confirmed']);
      if (body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Confirm revocation.');
      return change(actor, `inquiry.revoke:${id}`, body, db => {
        const row = ownedInquiry(db, id, actor);
        if (row.revision !== body.expectedRevision || row.share?.status !== 'active') fail(409, 'SUPPLY_REVISION_CONFLICT', 'The original inquiry changed.');
        row.share.status = 'revoked'; row.share.revokedAt = now(); row.status = 'revoked'; row.revision++;
        const history = row.shares?.find(share => share.reviewHash === row.share.reviewHash);
        if (history) { history.status = 'revoked'; history.revokedAt = row.share.revokedAt; }
        event(db, 'inquiry.revoked', actor, { supplierId: row.supplierId, inquiryId: id }); return { inquiry: row };
      });
    },
    async attachInquiry(id, body, actor) {
      requireRole(actor); allowed(body, ['requestId', 'expectedRevision', 'conversationId', 'confirmed']);
      if (body.confirmed !== true) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Confirm the original business conversation.');
      return change(actor, `inquiry.conversation:${id}`, body, (db, state) => {
        const row = merchantInquiry(db, id, actor);
        if (row.revision !== body.expectedRevision) fail(409, 'SUPPLY_REVISION_CONFLICT', 'The inquiry changed.');
        if (row.merchantConversation) fail(409, 'SUPPLY_CONVERSATION_BOUND', 'Preserve the original business conversation.');
        const messageId = reference(state, row, actor, body.conversationId, 'procurement_shared', row.share.snapshot);
        row.merchantConversation = { subject: actor.subject, conversationId: body.conversationId, messageId }; row.revision++;
        return { inquiry: row };
      });
    },
    async replyInquiry(id, body, actor) {
      requireRole(actor); allowed(body, ['requestId', 'expectedRevision', 'expectedShareHash', 'content', 'confirmed']);
      const content = clean(body.content, 'content', 2400);
      if (body.confirmed !== true || looksLikeCredential(content)) fail(400, 'SUPPLY_CONFIRMATION_REQUIRED', 'Confirm a merchant reply without credentials.');
      return change(actor, `inquiry.reply:${id}`, body, (db, state) => {
        const row = merchantInquiry(db, id, actor);
        if (row.revision !== body.expectedRevision || row.share.reviewHash !== body.expectedShareHash) fail(409, 'SUPPLY_REVISION_CONFLICT', 'Review the current active share before replying.');
        row.replies ??= []; cap(row.replies, 50);
        const reply = { id: randomUUID(), requestId: body.requestId, merchantSubject: actor.subject, shareHash: row.share.reviewHash, content, createdAt: now(), source: 'merchant_reply', bindingQuote: false };
        row.replies.push(reply); row.status = 'replied'; row.revision++;
        if (row.merchantConversation) reference(state, row, actor, row.merchantConversation.conversationId, 'merchant_reply', reply);
        event(db, 'inquiry.replied', actor, { supplierId: row.supplierId, inquiryId: id }); return { reply, inquiryId: id, revision: row.revision };
      });
    },
    async recordShopifyObservation(page, actor, requestId, after = null) {
      requireRole(actor, true);
      if (!UUID.test(requestId) || !page || typeof page.shopId !== 'string' || !Array.isArray(page.products) || page.products.length > 30 || !Number.isFinite(Date.parse(page.observedAt))) fail(400, 'SUPPLY_OBSERVATION_INVALID', 'Verified Shopify page is required.');
      return change(actor, 'shopify.observe', { requestId, after }, db => {
        // Observing a Shopify product never changes its supplier mapping or makes it public.
        db.shopifyObservation = { shopId: page.shopId, observedAt: page.observedAt, products: page.products, nextCursor: page.nextCursor ?? null, source: 'shopify_admin_graphql', publication: 'private' };
        event(db, 'shopify.catalog_observed', actor, { supplierId: null }); return { observation: db.shopifyObservation };
      });
    },
  };
}
