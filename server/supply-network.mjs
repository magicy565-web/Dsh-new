import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './runtime.mjs';
import { validateJson } from './store.mjs';

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

export function createSupplyNetworkService({ store, clock = Date.now } = {}) {
  if (!store?.read || !store?.update) throw new TypeError('A persistent Workspace store is required.');
  const now = () => new Date(clock()).toISOString();
  function change(actor, action, input, fn) {
    allowed(input, Object.keys(input));
    const requestId = clean(input.requestId, 'requestId', 36);
    if (!UUID.test(requestId)) fail(400, 'SUPPLY_REQUEST_ID_REQUIRED', 'A stable UUID requestId is required.');
    const payloadDigest = digest(input);
    return store.update(state => {
      const db = network(state);
      const existing = db.commands.find(c => c.id === requestId && c.actor === actor.subject);
      if (existing) {
        if (existing.digest !== payloadDigest || existing.action !== action) fail(409, 'SUPPLY_IDEMPOTENCY_CONFLICT', 'This requestId was already used for another command.');
        return existing.result;
      }
      cap(db.commands, 2000);
      const result = fn(db);
      db.commands.push({ id: requestId, actor: actor.subject, action, digest: payloadDigest, result, createdAt: now() });
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
      const receipt = snapshot(store).commands.find(c => c.id === requestId && c.actor === actor.subject);
      if (!receipt) return null;
      if (receipt.action !== action || receipt.digest !== digest(body)) fail(409, 'SUPPLY_IDEMPOTENCY_CONFLICT', 'The command ID was used with a different scope.');
      return receipt.result;
    },
    status() { const db = snapshot(store); return { pilot: true, multiTenant: false, supplierCount: db.suppliers.length, publishedSuppliers: db.suppliers.filter(s => s.published).length, listingCount: db.listings.length, publishedListings: db.listings.filter(l => l.published).length, inquiryCount: db.inquiries.length, shopifyObservation: db.shopifyObservation && { observedAt: db.shopifyObservation.observedAt, shopId: db.shopifyObservation.shopId, count: db.shopifyObservation.products.length, hasNextPage: db.shopifyObservation.nextCursor !== null } }; },
    suppliers() { return { suppliers: snapshot(store).suppliers }; },
    listings() { return { listings: snapshot(store).listings }; },
    inquiries() { return { inquiries: snapshot(store).inquiries }; },
    events() { return { events: snapshot(store).events.slice(-80).reverse() }; },
    shopifyObservation() { const observation = snapshot(store).shopifyObservation; return { observation: observation ? { ...observation } : null }; },
    searchPublic({ query = '', limit = 20 } = {}) {
      if (typeof query !== 'string' || query.length > 120) fail(400, 'SUPPLY_INPUT_INVALID', 'The search query is too long.');
      finiteInt(limit, 'limit', 1, 50);
      const db = snapshot(store), q = query.trim().toLocaleLowerCase();
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
      requireRole(actor); allowed(body, ['requestId', 'listingId', 'quantity', 'destination', 'notes']);
      if (!UUID.test(body.listingId)) fail(400, 'SUPPLY_INPUT_INVALID', 'Select a listing.');
      const quantity = finiteInt(body.quantity, 'quantity', 1, 10_000_000), destination = clean(body.destination, 'destination', 120), notes = clean(body.notes, 'notes', 1200, true);
      return change(actor, 'inquiry.create', body, db => {
        const listing = findOne(db.listings, body.listingId, 'Listing'); cap(db.inquiries, 2000);
        const inquiry = { id: randomUUID(), listingId: listing.id, supplierId: listing.supplierId, listingRevision: listing.revision, quantity, destination, notes, status: 'draft', createdAt: now(), createdBy: actor.subject, publishedAt: null, sentAt: null };
        db.inquiries.push(inquiry); event(db, 'inquiry.draft_created', actor, { supplierId: listing.supplierId, listingId: listing.id }); return { inquiry };
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
